import { getProtocol, isProtocolId, type ProtocolId } from '@beacon/protocols';
import { extractJson, type ImageInput, type ModelRouter } from './models.js';
import { TRIAGE_RECHECK_SUFFIX, TRIAGE_SYSTEM } from './prompts.js';
import { SceneAssessment } from './schemas.js';

export interface TriageInput {
  image: ImageInput;
  /** Active protocol, when re-checking during an incident. */
  activeProtocol?: ProtocolId | null;
  activeStep?: string | null;
  /** Rolling summary of recent assessments to damp flicker. */
  recentSituations?: string[];
}

export interface TriageOutput {
  assessment: SceneAssessment;
  provider: string;
  model: string;
  latencyMs: number;
  /** True when the assessment should open a new incident. */
  shouldOpenIncident: boolean;
}

/** Confidence needed before we interrupt the user. Tuned per severity. */
const OPEN_THRESHOLDS: Record<SceneAssessment['severity'], number> = {
  none: 1.01,
  low: 0.9,
  moderate: 0.75,
  high: 0.6,
  critical: 0.5,
};

export async function triageFrame(router: ModelRouter, input: TriageInput): Promise<TriageOutput> {
  const isRecheck = Boolean(input.activeProtocol);
  const system = TRIAGE_SYSTEM + (isRecheck ? TRIAGE_RECHECK_SUFFIX : '');

  const stateLine = isRecheck
    ? `Active protocol: ${input.activeProtocol} at step ${input.activeStep ?? '?'}.`
    : 'No active incident.';
  const history = input.recentSituations?.length ? `Recent frames: ${input.recentSituations.join(', ')}.` : '';

  const userText = `${stateLine} ${history}\nAssess this frame. Return only the JSON object.`;

  let raw = await router.complete({
    system,
    messages: [{ role: 'user', content: userText, image: input.image }],
    maxTokens: 900,
    temperature: 0.1,
    tier: isRecheck ? 'fast' : 'main',
    timeoutMs: isRecheck ? 8_000 : 14_000,
  });

  let parsed = safeParse(raw.text);
  if (!parsed.success) {
    // One repair attempt: ask the model to fix its own JSON.
    raw = await router.complete({
      system,
      messages: [
        { role: 'user', content: userText, image: input.image },
        { role: 'assistant', content: raw.text },
        { role: 'user', content: `That was not valid JSON for the schema (${parsed.error}). Return only the corrected JSON object.` },
      ],
      maxTokens: 900,
      temperature: 0,
      tier: isRecheck ? 'fast' : 'main',
    });
    parsed = safeParse(raw.text);
    if (!parsed.success) throw new Error(`Triage output invalid: ${parsed.error}`);
  }

  const a = normalize(parsed.data);
  const shouldOpenIncident =
    !isRecheck && a.situation !== 'none' && a.situation !== 'unclear' && a.confidence >= OPEN_THRESHOLDS[a.severity];

  return { assessment: a, provider: raw.provider, model: raw.model, latencyMs: raw.latencyMs, shouldOpenIncident };
}

function safeParse(text: string): { success: true; data: SceneAssessment } | { success: false; error: string } {
  try {
    const json = extractJson(text);
    const r = SceneAssessment.safeParse(json);
    if (r.success) return { success: true, data: r.data };
    return { success: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/** Post-process: keep protocol and situation consistent, clamp boxes, dedupe. */
function normalize(a: SceneAssessment): SceneAssessment {
  const out = { ...a };
  if (out.situation !== 'none' && out.situation !== 'unclear' && isProtocolId(out.situation)) {
    out.recommendedProtocol = out.recommendedProtocol ?? out.situation;
    const p = getProtocol(out.situation);
    if (p.callEmergencyOnEntry) out.callEmergencyServices = true;
  }
  if (out.situation === 'none') {
    out.severity = 'none';
    out.recommendedProtocol = null;
    out.callEmergencyServices = false;
  }
  const clamp = (b: [number, number, number, number] | null) =>
    b ? (b.map((n) => Math.min(1, Math.max(0, n))) as [number, number, number, number]) : null;
  out.people = out.people.map((p) => ({ ...p, bbox: clamp(p.bbox) }));
  out.hazards = out.hazards.map((h) => ({ ...h, bbox: clamp(h.bbox) }));
  out.resources = out.resources.map((r) => ({ ...r, bbox: clamp(r.bbox) }));
  return out;
}

/**
 * Temporal smoothing: an incident should open when the last N assessments
 * agree, not on a single noisy frame. Returns the situation that has majority
 * across the window, or null.
 */
export function stableSituation(window: Array<{ situation: string; confidence: number }>, minAgree = 2): string | null {
  if (window.length < minAgree) return null;
  const counts = new Map<string, number>();
  for (const w of window) counts.set(w.situation, (counts.get(w.situation) ?? 0) + 1);
  for (const [s, n] of counts) if (n >= minAgree && s !== 'none' && s !== 'unclear') return s;
  return null;
}
