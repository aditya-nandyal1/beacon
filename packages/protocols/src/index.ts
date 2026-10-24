import { medicalProtocols } from './medical.js';
import { disasterProtocols } from './disaster.js';
import type { Protocol, ProtocolId, ProtocolStep } from './types.js';

export * from './types.js';
export { medicalProtocols, disasterProtocols };

export const allProtocols: Protocol[] = [...medicalProtocols, ...disasterProtocols];

const byId = new Map<ProtocolId, Protocol>(allProtocols.map((p) => [p.id, p]));

export function getProtocol(id: ProtocolId): Protocol {
  const p = byId.get(id);
  if (!p) throw new Error(`Unknown protocol: ${id}`);
  return p;
}

export function isProtocolId(x: unknown): x is ProtocolId {
  return typeof x === 'string' && byId.has(x as ProtocolId);
}

export function getStep(protocolId: ProtocolId, stepId: string): ProtocolStep {
  const p = getProtocol(protocolId);
  const s = p.steps[stepId];
  if (!s) throw new Error(`Unknown step ${stepId} in ${protocolId}`);
  return s;
}

/** Validate a step graph: every `next` / branch target exists, entry exists. */
export function validateProtocol(p: Protocol): string[] {
  const errors: string[] = [];
  if (!p.steps[p.entry]) errors.push(`${p.id}: entry '${p.entry}' missing`);
  for (const s of Object.values(p.steps)) {
    if (s.id !== undefined && !(s.id in p.steps)) errors.push(`${p.id}: step id mismatch ${s.id}`);
    if (s.ask && !s.branches?.length) errors.push(`${p.id}/${s.id}: ask without branches`);
    for (const b of s.branches ?? []) {
      if (!p.steps[b.next]) errors.push(`${p.id}/${s.id}: branch -> missing '${b.next}'`);
    }
    if (s.next && !p.steps[s.next]) errors.push(`${p.id}/${s.id}: next -> missing '${s.next}'`);
    if (s.say.split(/\s+/).length > 32) errors.push(`${p.id}/${s.id}: 'say' too long for speech`);
  }
  return errors;
}

/**
 * Compact text rendering of a protocol for the LLM system prompt. We ship the
 * *whole* graph so the model can answer "what if…" questions, but the model
 * may only move the pointer; it cannot invent steps.
 */
export function renderProtocolForPrompt(p: Protocol): string {
  const lines: string[] = [];
  lines.push(`PROTOCOL ${p.id} — ${p.title}`);
  lines.push(`Scene safety: ${p.sceneSafety.join(' ') || 'n/a'}`);
  lines.push(`Call emergency on entry: ${p.callEmergencyOnEntry}`);
  lines.push(`Entry step: ${p.entry}`);
  for (const s of Object.values(p.steps)) {
    lines.push(`- [${s.id}] SAY: ${s.say}`);
    if (s.detail) lines.push(`    DETAIL: ${s.detail}`);
    if (s.ask) {
      lines.push(`    ASK: ${s.ask}`);
      for (const b of s.branches ?? []) lines.push(`      if "${b.when}" -> ${b.next}`);
    } else if (s.next) lines.push(`    NEXT: ${s.next}`);
    else lines.push(`    NEXT: (end — stay and monitor)`);
    if (s.loop) lines.push(`    LOOP until: ${s.loop.exitWhen.join(' / ')}`);
    if (s.escalate) lines.push(`    ESCALATE: push to call 911 here`);
  }
  lines.push(`Do NOT: ${p.doNot.join(' ')}`);
  lines.push(`Red flags: ${p.redFlags.join(' ')}`);
  return lines.join('\n');
}

/** One-line catalog so the triage model can pick a protocol id. */
export function renderCatalog(): string {
  return allProtocols
    .map((p) => `- ${p.id}: ${p.title}. Triggers: ${p.triggers.join('; ')}`)
    .join('\n');
}
