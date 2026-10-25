import { z } from 'zod';
import { allProtocols } from '@beacon/protocols';

const protocolIds = allProtocols.map((p) => p.id) as [string, ...string[]];

/** Normalized bounding box: x, y, w, h in [0,1] relative to the frame. */
const SEV = ['none', 'low', 'moderate', 'high', 'critical'] as const;
/** Tolerant number in [0,1]: strings, NaN, percentages → sane value. */
const n01 = z.preprocess((v) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n > 1 ? n / 100 : n));
}, z.number().min(0).max(1));
/** Tolerant severity: accepts enum strings, synonyms, or numbers (0–1 or 0–4). */
const sev = z.preprocess((v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return SEV[Math.min(4, Math.max(0, Math.round(v <= 1 ? v * 4 : v)))];
  if (typeof v === 'string') {
    const t = v.toLowerCase().trim();
    if ((SEV as readonly string[]).includes(t)) return t;
    if (t.includes('crit') || t.includes('life')) return 'critical';
    if (t.includes('high') || t.includes('severe') || t.includes('major')) return 'high';
    if (t.includes('mod') || t.includes('med')) return 'moderate';
    if (t.includes('low') || t.includes('minor') || t.includes('mild')) return 'low';
  }
  return 'none';
}, z.enum(SEV));
const bool = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());
export const BBox = z.tuple([n01, n01, n01, n01]);
export type BBox = z.infer<typeof BBox>;

export const PersonState = z.enum(['alert', 'distressed', 'unresponsive', 'unknown']);

export const SceneAssessment = z.object({
  situation: z.enum([...protocolIds, 'none', 'unclear']),
  confidence: n01,
  severity: sev,
  /** One spoken sentence. What a calm dispatcher would say first. */
  summary: z.string().max(240),
  people: z
    .array(
      z.object({
        id: z.string(),
        state: PersonState,
        posture: z.enum(['standing', 'sitting', 'lying', 'unknown']).default('unknown'),
        injuries: z.array(z.string()).default([]),
        bbox: BBox.nullable().default(null),
      }),
    )
    .default([]),
  hazards: z
    .array(
      z.object({
        label: z.string(),
        kind: z.enum(['fire', 'smoke', 'water', 'electrical', 'structural', 'traffic', 'chemical', 'sharp', 'other']),
        urgent: bool.default(false),
        bbox: BBox.nullable().default(null),
      }),
    )
    .default([]),
  resources: z
    .array(
      z.object({
        label: z.string(),
        kind: z.enum(['aed', 'fire_extinguisher', 'exit', 'first_aid', 'phone', 'high_ground', 'tourniquet_material', 'other']),
        bbox: BBox.nullable().default(null),
      }),
    )
    .default([]),
  recommendedProtocol: z.enum(protocolIds).nullable(),
  callEmergencyServices: bool,
  /** Things the model could not determine from a single frame; the coach asks about these. */
  uncertainties: z.array(z.string()).default([]),
  /** For CPR re-checks only. */
  cprFeedback: z
    .object({
      handsOnChestCenter: bool.nullable(),
      armsStraight: bool.nullable(),
      note: z.string().max(120).nullable(),
    })
    .nullable()
    .default(null),
});
export type SceneAssessment = z.infer<typeof SceneAssessment>;

export const CoachTurn = z.object({
  /** ≤ 2 short sentences, imperative, spoken. */
  say: z.string().max(320),
  /** Protocol pointer after this turn. */
  protocolId: z.enum(protocolIds).nullable(),
  stepId: z.string().nullable(),
  /** Set when the coach wants the client to surface the one-tap 911 control. */
  urgeCall: bool.default(false),
  /** Ask nearby trained helpers to come. */
  requestHelpers: bool.default(false),
  /** The incident is resolved / handed to EMS. */
  endIncident: bool.default(false),
  /** Free-text observation to log (e.g. "tourniquet applied 14:02"). */
  logNote: z.string().max(200).nullable().default(null),
});
export type CoachTurn = z.infer<typeof CoachTurn>;

export const ConversationMessage = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  at: z.number(),
});
export type ConversationMessage = z.infer<typeof ConversationMessage>;
