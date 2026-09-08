import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyProfiles, evaluateQualityGate, qualityGateExitCode, type ProfileOutcome } from '../src/qualityGate.js';

const visualProfile = [{ id: 'visual-clutter', direction: 'less-cluttered' }];

function metric(id: string, delta: number, meaningfulChange = true) {
  return { id, previous: 10, current: 10 + delta, delta, meaningfulChange };
}

function outcome(kind: ProfileOutcome['outcome']): ProfileOutcome {
  return { id: 'visual-clutter', direction: 'less-cluttered', outcome: kind, reason: kind, comparableMetrics: [], meaningfulMetrics: [], alignedMetrics: [], opposedMetrics: [] };
}

test('classifies every deterministic profile outcome', () => {
  assert.equal(classifyProfiles(visualProfile, [metric('m9', -1), metric('m10', -1)], true)[0]?.outcome, 'aligned');
  assert.equal(classifyProfiles(visualProfile, [metric('m9', 1), metric('m10', 1)], true)[0]?.outcome, 'opposed');
  assert.equal(classifyProfiles(visualProfile, [metric('m9', -1), metric('m10', 1)], true)[0]?.outcome, 'mixed');
  assert.equal(classifyProfiles(visualProfile, [metric('m9', 0.01, false)], true)[0]?.outcome, 'unchanged');
  assert.equal(classifyProfiles(visualProfile, [metric('m9', -1)], false)[0]?.outcome, 'not-comparable');
});

test('uses the expected scalar movement for each goal-specific profile', () => {
  assert.equal(classifyProfiles([{ id: 'screen-whitespace', direction: 'more-whitespace' }], [metric('m5', 1)], true)[0]?.outcome, 'aligned');
  assert.equal(classifyProfiles([{ id: 'visual-clutter', direction: 'more-cluttered' }], [metric('m9', 1)], true)[0]?.outcome, 'aligned');
  assert.equal(classifyProfiles([{ id: 'screen-whitespace', direction: 'less-whitespace' }], [metric('m5', -1)], true)[0]?.outcome, 'aligned');
  assert.equal(classifyProfiles([{ id: 'text-amount', direction: 'more-words' }], [metric('m8', 1)], true)[0]?.outcome, 'aligned');
  assert.equal(classifyProfiles([{ id: 'text-amount', direction: 'fewer-words' }], [metric('m8', -1)], true)[0]?.outcome, 'aligned');
  assert.equal(classifyProfiles([{ id: 'colorfulness', direction: 'more-colorful' }], [metric('m3', 1)], true)[0]?.outcome, 'aligned');
  assert.equal(classifyProfiles([{ id: 'colorfulness', direction: 'less-colorful' }], [metric('m3', -1)], true)[0]?.outcome, 'aligned');
  assert.equal(classifyProfiles([{ id: 'accessibility', direction: 'fewer-detected-violations' }], [metric('m13', -1)], true)[0]?.outcome, 'aligned');
  assert.equal(classifyProfiles([{ id: 'image-aesthetic-score', direction: 'observe' }], [metric('m14', -1)], true)[0]?.outcome, 'aligned');
});

test('applies report mode without warnings or failures', () => {
  const gate = evaluateQualityGate('report', [outcome('opposed'), outcome('mixed')]);
  assert.equal(gate.status, 'pass');
  assert.equal(qualityGateExitCode(gate), 0);
});

test('warn mode returns exit code 2 for mixed or opposed results', () => {
  for (const kind of ['mixed', 'opposed'] as const) {
    const gate = evaluateQualityGate('warn', [outcome(kind)]);
    assert.equal(gate.status, 'warning');
    assert.equal(qualityGateExitCode(gate), 2);
  }
  assert.equal(qualityGateExitCode(evaluateQualityGate('warn', [outcome('aligned')])), 0);
  assert.equal(qualityGateExitCode(evaluateQualityGate('warn', [outcome('mixed')]), 0), 0);
});

test('enforce mode blocks opposed and warns for mixed results', () => {
  const blocked = evaluateQualityGate('enforce', [outcome('opposed')]);
  assert.equal(blocked.status, 'fail');
  assert.equal(qualityGateExitCode(blocked), 1);
  const warning = evaluateQualityGate('enforce', [outcome('mixed')]);
  assert.equal(warning.status, 'warning');
  assert.equal(qualityGateExitCode(warning), 2);
});

test('first run is not comparable and passes in enforce mode', () => {
  const outcomes = classifyProfiles(visualProfile, [metric('m9', -1)], false);
  assert.equal(outcomes[0]?.outcome, 'not-comparable');
  assert.equal(qualityGateExitCode(evaluateQualityGate('enforce', outcomes)), 0);
});

test('fails when a compatible baseline is explicitly required', () => {
  const outcomes = classifyProfiles(visualProfile, [metric('m9', -1)], false);
  const gate = evaluateQualityGate('enforce', outcomes, { requireBaseline: true, hasBaseline: false });
  assert.equal(gate.status, 'fail');
  assert.equal(gate.requireBaseline, true);
  assert.match(gate.reason, /baseline is required/);
  assert.equal(qualityGateExitCode(gate), 1);
});
