'use node';

import { v } from 'convex/values';
import { ModelRouter, triageFrame, stableSituation, type SceneAssessment } from '@beacon/agent';
import { getProtocol, isProtocolId } from '@beacon/protocols';
import { action } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';

type FrameResult =
  | { ok: false; reason: string; assessment: null; incidentId: Id<'incidents'> | null }
  | { ok: true; assessment: SceneAssessment; incidentId: Id<'incidents'> | null; provider: string; latencyMs: number };

const router = () => new ModelRouter(process.env as Record<string, string | undefined>);

/**
 * analyzeFrame — the heartbeat of Beacon.
 *
 * Called by the PWA every ~2.5s while scanning and every ~6s during an
 * incident. The frame is processed in memory and discarded; only the
 * structured assessment is persisted.
 */
export const analyzeFrame = action({
  args: {
    sessionId: v.string(),
    jpegBase64: v.string(),
    incidentId: v.optional(v.id('incidents')),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (ctx, { sessionId, jpegBase64, incidentId, lat, lng }): Promise<FrameResult> => {
    const r = router();
    if (!r.hasAnyProvider) {
      return { ok: false, reason: 'no_model_provider', assessment: null, incidentId: incidentId ?? null };
    }

    const incident: Doc<'incidents'> | null = incidentId ? await ctx.runQuery(internal.incidents.getInternal, { incidentId }) : null;
    const recent: Doc<'observations'>[] = await ctx.runQuery(internal.incidents.recentObservations, { sessionId, limit: 3 });

    let out: Awaited<ReturnType<typeof triageFrame>>;
    try {
      out = await triageFrame(r, {
        image: { base64: jpegBase64, mediaType: 'image/jpeg' },
        activeProtocol: incident?.status === 'open' && incident.protocolId && isProtocolId(incident.protocolId) ? incident.protocolId : null,
        activeStep: incident?.stepId ?? null,
        recentSituations: recent.map((o) => o.situation),
      });
    } catch (e) {
      return { ok: false, reason: `triage_failed: ${(e as Error).message}`, assessment: null, incidentId: incidentId ?? null };
    }

    const a = out.assessment;

    await ctx.runMutation(internal.incidents.recordObservation, {
      sessionId,
      incidentId: incident?.status === 'open' ? incident._id : undefined,
      situation: a.situation,
      confidence: a.confidence,
      severity: a.severity,
      assessment: a,
      provider: out.provider,
      model: out.model,
      latencyMs: out.latencyMs,
    });

    let openedId: Id<'incidents'> | null = null;

    if (!incident || incident.status !== 'open') {
      // Open an incident when this frame AND a recent frame agree (temporal
      // smoothing), or immediately when a single frame is critical + confident.
      const window = [{ situation: a.situation, confidence: a.confidence }, ...recent.map((o) => ({ situation: o.situation, confidence: o.confidence }))];
      const stable = stableSituation(window, 2);
      const immediate = a.severity === 'critical' && a.confidence >= 0.8;
      if (out.shouldOpenIncident && (stable === a.situation || immediate)) {
        const protocolId = a.recommendedProtocol && isProtocolId(a.recommendedProtocol) ? a.recommendedProtocol : null;
        openedId = await ctx.runMutation(internal.incidents.open, {
          sessionId,
          situation: a.situation,
          protocolId,
          stepId: protocolId ? getProtocol(protocolId).entry : null,
          severity: a.severity,
          summary: a.summary,
          assessment: a,
          lat,
          lng,
        });
        await ctx.scheduler.runAfter(0, internal.enrichment.enrichIncident, { incidentId: openedId });
        await ctx.scheduler.runAfter(0, internal.coach.openingLine, { incidentId: openedId });
        if (a.callEmergencyServices) {
          await ctx.scheduler.runAfter(0, internal.alerts.dispatchIncident, { incidentId: openedId, reason: 'auto:critical_detection' });
        }
      }
    } else if (a.cprFeedback && (a.cprFeedback.handsOnChestCenter === false || a.cprFeedback.armsStraight === false)) {
      // Live CPR form correction, spoken as a short interjection.
      await ctx.scheduler.runAfter(0, internal.coach.interject, {
        incidentId: incident._id,
        event: `[camera: ${a.cprFeedback.note ?? 'hand position looks off'}]`,
      });
    } else if (a.hazards.some((h) => h.urgent) && !hasSameUrgentHazard(incident.assessment as SceneAssessment | undefined, a)) {
      await ctx.scheduler.runAfter(0, internal.coach.interject, {
        incidentId: incident._id,
        event: `[camera: new urgent hazard — ${a.hazards.filter((h) => h.urgent).map((h) => h.label).join(', ')}]`,
      });
    }

    return {
      ok: true,
      assessment: a,
      incidentId: openedId ?? (incident?.status === 'open' ? incident._id : null),
      provider: out.provider,
      latencyMs: out.latencyMs,
    };
  },
});

function hasSameUrgentHazard(prev: SceneAssessment | undefined, next: SceneAssessment): boolean {
  if (!prev) return false;
  const prevSet = new Set(prev.hazards.filter((h) => h.urgent).map((h) => h.kind));
  return next.hazards.filter((h) => h.urgent).every((h) => prevSet.has(h.kind));
}
