import { getProtocol, isProtocolId, type ProtocolId } from '@beacon/protocols';
import { extractJson, type ModelRouter } from './models.js';
import { coachSystemPrompt } from './prompts.js';
import { CoachTurn, type ConversationMessage, type SceneAssessment } from './schemas.js';

export interface CoachInput {
  protocolId: ProtocolId | null;
  stepId: string | null;
  assessment: SceneAssessment | null;
  history: ConversationMessage[];
  /** The user's latest utterance, or a system event such as "[silence 20s]" / "[incident opened]". */
  utterance: string;
  context: { locationText?: string; nearestAed?: string; liveAlerts?: string[]; helpersEnRoute?: number; elapsedSec: number };
}

export interface CoachOutput {
  turn: CoachTurn;
  provider: string;
  model: string;
  latencyMs: number;
}

export async function coachTurn(router: ModelRouter, input: CoachInput): Promise<CoachOutput> {
  const system = coachSystemPrompt({
    protocolId: input.protocolId,
    stepId: input.stepId,
    assessment: input.assessment,
    context: input.context,
  });

  const messages = [
    ...input.history.slice(-12).filter((m) => m.role !== 'system').map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: input.utterance },
  ];
  // Anthropic requires alternating roles starting with user; collapse accidental doubles.
  const collapsed = collapseRoles(messages);

  let raw = await router.complete({ system, messages: collapsed, maxTokens: 400, temperature: 0.3, timeoutMs: 10_000 });
  let parsed = safeParse(raw.text, input);
  if (!parsed.success) {
    raw = await router.complete({
      system,
      messages: [...collapsed, { role: 'assistant', content: raw.text }, { role: 'user', content: `Invalid (${parsed.error}). Return only the corrected JSON.` }],
      maxTokens: 400,
      temperature: 0,
    });
    parsed = safeParse(raw.text, input);
    if (!parsed.success) {
      // Last resort: deterministic fallback so the user is never left in silence.
      return { turn: deterministicTurn(input), provider: 'local', model: 'fallback', latencyMs: 0 };
    }
  }
  return { turn: parsed.data, provider: raw.provider, model: raw.model, latencyMs: raw.latencyMs };
}

function safeParse(text: string, input: CoachInput): { success: true; data: CoachTurn } | { success: false; error: string } {
  try {
    const r = CoachTurn.safeParse(extractJson(text));
    if (!r.success) return { success: false, error: r.error.issues.map((i) => i.message).join('; ') };
    const t = r.data;
    // Guard rails: the model may only point at real steps.
    if (t.protocolId && !isProtocolId(t.protocolId)) return { success: false, error: `unknown protocol ${t.protocolId}` };
    if (t.protocolId && isProtocolId(t.protocolId)) {
      const proto = getProtocol(t.protocolId);
      if (!t.stepId || !proto.steps[t.stepId]) t.stepId = proto.entry;
    }
    if (!t.protocolId) t.stepId = null;
    if (!t.say.trim()) return { success: false, error: 'empty say' };
    // Keep speech short even if the model got chatty.
    t.say = clampSentences(t.say, 2);
    void input;
    return { success: true, data: t };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/** Read the current step verbatim. Used when every model path fails. */
export function deterministicTurn(input: CoachInput): CoachTurn {
  if (input.protocolId) {
    const p = getProtocol(input.protocolId);
    const step = p.steps[input.stepId ?? p.entry];
    const say = step.ask ? `${step.say} ${step.ask}` : step.say;
    return {
      say: clampSentences(say, 2),
      protocolId: input.protocolId,
      stepId: step.id,
      urgeCall: Boolean(step.escalate || p.callEmergencyOnEntry),
      requestHelpers: false,
      endIncident: false,
      logNote: 'coach fallback: model unavailable',
    };
  }
  return {
    say: 'I am here. Tell me what you see — is anyone hurt, is there fire, or is there water?',
    protocolId: null,
    stepId: null,
    urgeCall: false,
    requestHelpers: false,
    endIncident: false,
    logNote: 'coach fallback: model unavailable',
  };
}

function clampSentences(s: string, max: number): string {
  const parts = s.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) ?? [s];
  return parts.slice(0, max).join(' ').trim();
}

function collapseRoles(msgs: Array<{ role: 'user' | 'assistant'; content: string }>) {
  const out: typeof msgs = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n${m.content}`;
    else out.push({ ...m });
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: '[incident opened]' });
  return out;
}
