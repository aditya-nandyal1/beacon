'use node';

import { v } from 'convex/values';
import { ModelRouter, coachTurn, deterministicTurn, type ConversationMessage, type SceneAssessment } from '@beacon/agent';
import { isProtocolId, type ProtocolId } from '@beacon/protocols';
import { action, internalAction, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { CoachTurn } from '@beacon/agent';

const router = () => new ModelRouter(process.env as Record<string, string | undefined>);

async function runTurn(ctx: ActionCtx, incidentId: Id<'incidents'>, utterance: string, author?: string): Promise<CoachTurn | null> {
  const inc: Doc<'incidents'> | null = await ctx.runQuery(internal.incidents.getInternal, { incidentId });
  if (!inc || inc.status !== 'open') return null;
  const history: Doc<'messages'>[] = await ctx.runQuery(internal.incidents.messagesInternal, { incidentId, limit: 14 });

  if (!utterance.startsWith('[')) {
    await ctx.runMutation(internal.incidents.appendMessage, { incidentId, role: 'user', content: author ? `[${author}] ${utterance}` : utterance });
  }

  const helpersEnRoute: number = await ctx.runQuery(internal.helpers.enRouteCount, { incidentId });

  const input = {
    protocolId: inc.protocolId && isProtocolId(inc.protocolId) ? (inc.protocolId as ProtocolId) : null,
    stepId: inc.stepId,
    assessment: (inc.assessment as SceneAssessment | undefined) ?? null,
    history: history.map((m): ConversationMessage => ({ role: m.role, content: m.content, at: m.at })),
    utterance: author ? `[${author}] ${utterance}` : utterance,
    context: {
      locationText: inc.locationText,
      nearestAed: inc.context?.nearestAed,
      liveAlerts: inc.context?.liveAlerts,
      helpersEnRoute: helpersEnRoute || undefined,
      elapsedSec: (Date.now() - inc.openedAt) / 1000,
    },
  };

  const r = router();
  const out = r.hasAnyProvider
    ? await coachTurn(r, input).catch(() => ({ turn: deterministicTurn(input), provider: 'local', model: 'fallback', latencyMs: 0 }))
    : { turn: deterministicTurn(input), provider: 'local', model: 'fallback', latencyMs: 0 };

  const t = out.turn;
  await ctx.runMutation(internal.incidents.appendMessage, {
    incidentId,
    role: 'assistant',
    content: t.say,
    turn: { ...t, provider: out.provider, model: out.model, latencyMs: out.latencyMs },
  });
  await ctx.runMutation(internal.incidents.applyTurn, {
    incidentId,
    protocolId: t.protocolId,
    stepId: t.stepId,
    helpersRequested: t.requestHelpers,
    endIncident: t.endIncident,
  });
  if (t.logNote) await ctx.runMutation(internal.incidents.appendMessage, { incidentId, role: 'system', content: `[note] ${t.logNote}` });
  if (t.requestHelpers && !inc.helpersRequested) {
    await ctx.scheduler.runAfter(0, internal.helpers.notifyNearby, { incidentId });
  }
  if (t.urgeCall && !inc.calledEmergency) {
    await ctx.scheduler.runAfter(0, internal.alerts.dispatchIncident, { incidentId, reason: 'coach:urge_call' });
  }
  if (t.endIncident) {
    await ctx.scheduler.runAfter(0, internal.afterAction.requestReport, { incidentId });
  }
  return t;
}

/** The user said something (final STT transcript). */
export const respond = action({
  args: { incidentId: v.id('incidents'), utterance: v.string(), sessionId: v.optional(v.string()) },
  handler: async (ctx, { incidentId, utterance, sessionId }): Promise<CoachTurn | null> => {
    const inc: Doc<'incidents'> | null = await ctx.runQuery(internal.incidents.getInternal, { incidentId });
    const author = sessionId && inc && sessionId !== inc.sessionId ? 'helper' : undefined;
    return runTurn(ctx, incidentId, utterance.trim(), author);
  },
});

/** First line the moment an incident opens. */
export const openingLine = internalAction({
  args: { incidentId: v.id('incidents') },
  handler: async (ctx, { incidentId }): Promise<CoachTurn | null> => runTurn(ctx, incidentId, '[incident opened — one calm sentence saying what you see, then read the entry step]'),
});

/** Camera noticed something mid-incident (hand position, new hazard). */
export const interject = internalAction({
  args: { incidentId: v.id('incidents'), event: v.string() },
  handler: async (ctx, { incidentId, event }): Promise<CoachTurn | null> => runTurn(ctx, incidentId, event),
});

/** Client silence timer fired — read the loop reminder for the current step. */
export const nudge = action({
  args: { incidentId: v.id('incidents'), silentSec: v.number() },
  handler: async (ctx, { incidentId, silentSec }): Promise<CoachTurn | null> =>
    runTurn(ctx, incidentId, `[silence ${Math.round(silentSec)}s — give the loop reminder or re-ask the step question, shorter]`),
});
