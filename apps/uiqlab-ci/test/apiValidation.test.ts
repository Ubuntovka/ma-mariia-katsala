import assert from 'node:assert/strict';
import test from 'node:test';
import { validateHistoryResponse, validateMetricResults, validateScalarMetricValues, validateSubmissionResponse } from '../src/apiValidation.js';

test('validates submission and history contracts', () => {
  assert.deepEqual(validateSubmissionResponse({ result_id: 'run-42' }), { result_id: 'run-42' });
  assert.throws(() => validateSubmissionResponse({ result_id: '' }), /non-empty result_id/);
  assert.deepEqual(validateHistoryResponse({
    metrics: { m14_nima: { results: [{ mean: 5.2 }] } },
    baselineRun: { id: 7, branch: 'main', commitHash: 'abc' },
  }), {
    metrics: { m14_nima: { results: [{ mean: 5.2 }] } },
    baselineRun: { id: 7, branch: 'main', commitHash: 'abc' },
  });
  assert.throws(() => validateHistoryResponse({ baselineRun: { id: '7' } }), /positive integer id/);
  assert.throws(() => validateHistoryResponse({ metrics: { unknown: { results: [] } } }), /invalid metric entry/);
  assert.throws(() => validateHistoryResponse({
    baselineRun: { id: 7, branch: 'develop' },
  }, { expectedBaselineBranch: 'main' }), /baseline from branch "develop" instead of "main"/);
  assert.throws(() => validateHistoryResponse({
    metrics: { m13_accessibility: { results: [] } },
  }, { expectedMetricIds: ['m14_nima'] }), /unexpected metric "m13_accessibility"/);
});

test('validates expected metric result families and rejects duplicates', () => {
  assert.deepEqual(validateMetricResults([
    { metric_id: 'm9_edge_density', results: [0.2] },
    { metric_id: 'm14_nima', results: [{ mean: 5.2 }] },
  ], ['m9', 'm14']), [
    { metric_id: 'm9_edge_density', results: [0.2] },
    { metric_id: 'm14_nima', results: [{ mean: 5.2 }] },
  ]);
  assert.throws(() => validateMetricResults([
    { metric_id: 'm9_edge_density', results: [0.2] },
    { metric_id: 'm9_other', results: [0.3] },
  ], ['m9']), /duplicate results/);
  assert.throws(() => validateMetricResults([
    { metric_id: 'm8_word_count', results: [12] },
  ], ['m9']), /unexpected metric/);
  assert.throws(() => validateScalarMetricValues([
    { metric_id: 'm14_nima', results: [{ unexpected: 5.2 }] },
  ]), /does not contain a finite primary value/);
  assert.doesNotThrow(() => validateScalarMetricValues([
    { metric_id: 'm14_nima', results: [{ mean: 5.2 }] },
    { metric_id: 'm6_segmentation', results: [{ regions: [] }] },
  ]));
});
