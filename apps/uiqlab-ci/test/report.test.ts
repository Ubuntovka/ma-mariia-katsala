import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReport, formatSummary, primaryValue, type AssessmentHistory, type MetricResult } from '../src/report.js';

test('extracts the CI summary values used by the default metrics', () => {
  assert.equal(primaryValue('m10_feature_congestion', [{ feature_congestion: 0.48 }]), 0.48);
  assert.equal(primaryValue('m14_nima', [{ mean: 5.18, standard_deviation: 0.8 }]), 5.18);
  assert.equal(primaryValue('m8_word_count', { visible_word_count: 487 }), 487);
  assert.equal(primaryValue('m13_accessibility', [{ violations: [{ id: 'label', nodes: [{}, {}] }] }]), 2);
});

test('formats comparisons without assigning warning or failure levels', () => {
  const results: MetricResult[] = [
    { metric_id: 'm10_feature_congestion', results: [0.48] },
    { metric_id: 'm14_nima', results: [{ mean: 5.18, standard_deviation: 0.8 }] },
    { metric_id: 'm8_word_count', results: [{ visible_word_count: 487 }] },
    { metric_id: 'm13_accessibility', results: [{ violations: [{ id: 'contrast', nodes: [{}, {}, {}, {}] }] }] },
  ];
  const history: AssessmentHistory = { baselineRun: { id: 4, branch: 'main' }, metrics: {
    m10_feature_congestion: { results: [0.42] }, m14_nima: { results: [{ mean: 5.31, standard_deviation: 0.7 }] },
    m8_word_count: { results: [430] }, m13_accessibility: { results: [{ violations: [{ id: 'contrast', nodes: [{}, {}, {}] }] }] },
  } };
  const report = buildReport({ target: 'https://preview.example.com/pr-42', branch: 'feature/ui', commitHash: 'abc', resultId: 'job', baselineBranch: 'main', results, history });
  const summary = formatSummary(report, 'main');
  assert.match(summary, /Feature congestion: 0.42 → 0.48 \(\+14.3%\)/);
  assert.match(summary, /NIMA score: 5.31 → 5.18 \(-0.13\)/);
  assert.match(summary, /Word count: 430 → 487 \(\+13.3%\)/);
  assert.match(summary, /Accessibility issues: 3 → 4/);
  assert.equal('qualityGate' in report, false);
});
