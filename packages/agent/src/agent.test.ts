import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from './models.js';
import { SceneAssessment } from './schemas.js';
import { deterministicTurn } from './coach.js';
import { stableSituation } from './triage.js';

test('extractJson tolerates fences and chatter', () => {
  const j = extractJson('Sure! ```json\n{"a":1}\n``` done');
  assert.deepEqual(j, { a: 1 });
});

test('SceneAssessment accepts a minimal valid payload with defaults', () => {
  const r = SceneAssessment.safeParse({
    situation: 'cardiac_arrest',
    confidence: 0.8,
    severity: 'critical',
    summary: 'A person is lying on the floor not moving.',
    recommendedProtocol: 'cardiac_arrest',
    callEmergencyServices: true,
  });
  assert.ok(r.success);
  assert.equal(r.data.people.length, 0);
});

test('SceneAssessment rejects unknown protocol ids', () => {
  const r = SceneAssessment.safeParse({
    situation: 'zombie_outbreak',
    confidence: 0.8,
    severity: 'critical',
    summary: 'x',
    recommendedProtocol: null,
    callEmergencyServices: true,
  });
  assert.equal(r.success, false);
});

test('deterministic fallback reads the entry step and urges a call for CPR', () => {
  const t = deterministicTurn({
    protocolId: 'cardiac_arrest',
    stepId: null,
    assessment: null,
    history: [],
    utterance: '[incident opened]',
    context: { elapsedSec: 0 },
  });
  assert.equal(t.stepId, 'check_response');
  assert.ok(t.urgeCall);
  assert.ok(t.say.length > 10);
});

test('stableSituation needs agreement across frames', () => {
  assert.equal(stableSituation([{ situation: 'structure_fire', confidence: 0.9 }]), null);
  assert.equal(
    stableSituation([
      { situation: 'structure_fire', confidence: 0.9 },
      { situation: 'none', confidence: 0.9 },
      { situation: 'structure_fire', confidence: 0.8 },
    ]),
    'structure_fire',
  );
});
