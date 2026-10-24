import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allProtocols, validateProtocol, getProtocol, renderProtocolForPrompt } from './index.js';

test('every protocol graph is well-formed', () => {
  for (const p of allProtocols) {
    const errors = validateProtocol(p);
    assert.deepEqual(errors, [], `${p.id}: ${errors.join('; ')}`);
  }
});

test('every protocol is reachable end-to-end from entry', () => {
  for (const p of allProtocols) {
    const seen = new Set<string>();
    const stack = [p.entry];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const s = p.steps[id];
      for (const b of s.branches ?? []) stack.push(b.next);
      if (s.next) stack.push(s.next);
    }
    const unreachable = Object.keys(p.steps).filter((k) => !seen.has(k));
    assert.deepEqual(unreachable, [], `${p.id} unreachable: ${unreachable.join(',')}`);
  }
});

test('CPR metronome rate is within AHA range', () => {
  const cpr = getProtocol('cardiac_arrest');
  const ar = cpr.steps.compress.ar;
  assert.ok(ar && ar.kind === 'cpr_metronome');
  assert.ok(ar.bpm >= 100 && ar.bpm <= 120);
});

test('prompt rendering includes every step id', () => {
  for (const p of allProtocols) {
    const text = renderProtocolForPrompt(p);
    for (const id of Object.keys(p.steps)) assert.ok(text.includes(`[${id}]`), `${p.id} missing ${id}`);
  }
});
