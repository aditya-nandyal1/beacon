/**
 * Beacon protocol model.
 *
 * A protocol is a small, explicit state machine the voice coach walks a bystander
 * through. Steps are deliberately short (one imperative sentence) because they are
 * spoken aloud to someone under stress. The LLM never invents medical steps — it
 * picks which step we are on, reads it, and answers questions around it.
 *
 * Sources (public guidance):
 *  - AHA 2020 Guidelines for CPR & ECC (layperson, hands-only CPR, AED use)
 *  - American College of Surgeons "Stop the Bleed"
 *  - American Red Cross first aid (choking, seizure, burns, anaphylaxis)
 *  - American Stroke Association F.A.S.T.
 *  - FEMA / ready.gov (earthquake, flood, wildfire, structural collapse)
 *  - NFPA (fire — get out, stay out)
 */

export type ProtocolId =
  | 'cardiac_arrest'
  | 'severe_bleeding'
  | 'choking_adult'
  | 'stroke'
  | 'seizure'
  | 'anaphylaxis'
  | 'burns'
  | 'opioid_overdose'
  | 'unresponsive_breathing'
  | 'structure_fire'
  | 'earthquake'
  | 'flood'
  | 'wildfire_smoke'
  | 'vehicle_crash'
  | 'downed_power_line'
  | 'heat_illness'
  | 'hypothermia'
  | 'general_scene_safety';

export type SituationType =
  | ProtocolId
  | 'none'
  | 'unclear';

export type Severity = 'none' | 'low' | 'moderate' | 'high' | 'critical';

export interface ProtocolStep {
  /** Stable id, referenced by the coach and by AR overlays. */
  id: string;
  /** Spoken instruction. ≤ 20 words. Imperative. */
  say: string;
  /** Extra detail the coach may read if the user asks "how?" or "why?". */
  detail?: string;
  /** AR hint the client renders while on this step. */
  ar?: ArHint;
  /**
   * Question the coach asks to decide where to go next. If present, `branches`
   * must be present. If absent, `next` is the default transition.
   */
  ask?: string;
  branches?: Array<{
    /** Natural-language condition, matched by the LLM (e.g. "yes", "no", "not sure"). */
    when: string;
    next: string;
  }>;
  next?: string | null;
  /** Step is a loop (e.g. CPR compressions) until an exit condition. */
  loop?: {
    /** Seconds between automatic re-prompts while looping. */
    remindEverySec: number;
    reminders: string[];
    exitWhen: string[];
  };
  /** If true, the coach should strongly push for calling emergency services here. */
  escalate?: boolean;
}

export type ArHint =
  | { kind: 'cpr_metronome'; bpm: number }
  | { kind: 'hand_position'; target: 'chest_center' }
  | { kind: 'highlight'; targets: Array<'aed' | 'fire_extinguisher' | 'exit' | 'first_aid' | 'high_ground' | 'bleeding_site' | 'hazard'> }
  | { kind: 'timer'; seconds: number; label: string }
  | { kind: 'arrow_to'; target: 'aed' | 'exit' | 'high_ground' | 'away_from_hazard' }
  | { kind: 'recovery_position' }
  | { kind: 'tourniquet_guide' };

export interface Protocol {
  id: ProtocolId;
  title: string;
  /** Short name used in speech, e.g. "CPR". */
  spokenName: string;
  /** What the triage model should look for to pick this protocol. */
  triggers: string[];
  /** Always-true safety preconditions read before step 1. */
  sceneSafety: string[];
  /** Whether emergency services should be contacted immediately on entry. */
  callEmergencyOnEntry: boolean;
  entry: string;
  steps: Record<string, ProtocolStep>;
  /** Things a layperson should NOT do. The coach uses these to answer "should I…?" */
  doNot: string[];
  /** Red flags that mean: stop coaching, repeat "call 911", hand off. */
  redFlags: string[];
}
