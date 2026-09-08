import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBatchReport, buildFailedPageReport, buildReport, formatBatchSummary, formatSummary, primaryValue, type AssessmentHistory, type MetricResult } from '../src/report.js';

test('extracts the CI summary values used by the default metrics', () => {
  assert.equal(primaryValue('m10_feature_congestion', [{ feature_congestion: 0.48 }]), 0.48);
  assert.equal(primaryValue('m14_nima', [{ mean: 5.18, standard_deviation: 0.8 }]), 5.18);
  assert.equal(primaryValue('m8_word_count', { visible_word_count: 487 }), 487);
  assert.equal(primaryValue('m13_accessibility', [{ violations: [{ id: 'label', nodes: [{}, {}] }] }]), 2);
});

test('formats scalar comparisons and applies materiality rules', () => {
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
  assert.match(summary, /Automatically detected violations: 3 → 4/);
  assert.equal(report.metrics.find((metric) => metric.id.startsWith('m10'))?.meaningfulChange, true);
  assert.equal(report.qualityGate.status, 'pass');
});

test('retains selected profiles in the machine-readable report', () => {
  const assessment = { mode: 'profiles' as const, profiles: [{ id: 'image-aesthetic-score', direction: 'observe' }] };
  const report = buildReport({ target: 'https://example.com', branch: 'main', resultId: 'job', baselineBranch: 'main', results: [], history: {}, assessment });
  assert.deepEqual(report.assessment, assessment);
  assert.equal(report.profileOutcomes[0]?.outcome, 'not-comparable');
  assert.equal(report.qualityGate.status, 'pass');
});

test('reports an observed NIMA change without judging aesthetic quality', () => {
  const report = buildReport({
    target: 'https://example.com', branch: 'main', resultId: 'job', baselineBranch: 'main',
    results: [{ metric_id: 'm14_nima', results: [{ mean: 4.5 }] }],
    history: { baselineRun: { id: 1 }, metrics: { m14_nima: { results: [{ mean: 5 }] } } },
    assessment: { mode: 'profiles', profiles: [{ id: 'image-aesthetic-score', direction: 'observe' }] },
  });
  const summary = formatSummary(report, 'main');
  assert.match(summary, /- Image aesthetic score/);
  assert.match(summary, /NIMA score decreased: 5 → 4\.5 \(-0\.5\) — observed for this profile/);
  assert.doesNotMatch(summary, /aesthetic quality (?:improved|worsened)/i);
});

test('includes metric comparisons, profile outcomes and final gate status', () => {
  const assessment = { mode: 'profiles' as const, profiles: [{ id: 'visual-clutter', direction: 'less-cluttered' }] };
  const results: MetricResult[] = [
    { metric_id: 'm9_edge_density', results: [0.15] },
    { metric_id: 'm10_feature_congestion', results: [5.2] },
  ];
  const history: AssessmentHistory = { baselineRun: { id: 1 }, metrics: {
    m9_edge_density: { results: [0.2] },
    m10_feature_congestion: { results: [4.0] },
  } };
  const report = buildReport({ target: 'https://example.com', branch: 'feature/ui', resultId: 'job', baselineBranch: 'main', results, history, assessment, qualityGateMode: 'warn' });
  assert.equal(report.profileOutcomes[0]?.outcome, 'mixed');
  assert.deepEqual(report.profileOutcomes[0]?.alignedMetrics, ['m9']);
  assert.deepEqual(report.profileOutcomes[0]?.opposedMetrics, ['m10']);
  assert.equal(report.qualityGate.status, 'warning');
  const summary = formatSummary(report, 'main');
  assert.match(summary, /Quality gate: WARNING \(warn\)/);
  assert.match(summary, /Exit code: 2/);
  assert.match(summary, /- Visual clutter/);
  assert.match(summary, /Expected direction: less-cluttered/);
  assert.match(summary, /Outcome: MIXED/);
  assert.match(summary, /Edge density decreased: 0\.2 → 0\.15.*aligned with the profile goal/);
  assert.match(summary, /Feature congestion increased: 4 → 5\.2.*opposed to the profile goal/);
  assert.match(formatSummary(report, 'main', 0), /Exit code: 0/);
});

test('blocks a report when its configured baseline is required but missing', () => {
  const report = buildReport({
    target: 'https://example.com', branch: 'feature/ui', resultId: 'job', baselineBranch: 'main',
    results: [{ metric_id: 'm14_nima', results: [{ mean: 5.2 }] }],
    history: {},
    assessment: { mode: 'profiles', profiles: [{ id: 'image-aesthetic-score', direction: 'observe' }] },
    qualityGateMode: 'enforce',
    requireBaseline: true,
  });
  assert.equal(report.qualityGate.status, 'fail');
  assert.equal(report.qualityGate.requireBaseline, true);
  assert.match(report.qualityGate.reason, /baseline is required/);
});

test('retains completed pages when another page fails technically', () => {
  const completed = buildReport({
    target: 'https://example.com/', branch: 'main', resultId: 'home', baselineBranch: 'main',
    results: [], history: {}, assessment: { mode: 'profiles', profiles: [{ id: 'general-review', direction: 'observe' }] },
    qualityGateMode: 'report',
  });
  const failed = buildFailedPageReport({
    target: 'https://example.com/checkout', branch: 'main', commitHash: 'abc',
    assessment: { mode: 'profiles', profiles: [{ id: 'accessibility', direction: 'fewer-detected-violations' }] },
    qualityGateMode: 'enforce', requireBaseline: true, reason: 'Result endpoint timed out.',
  });
  const batch = buildBatchReport([completed, failed], 'main', 'abc');
  assert.equal(batch.status, 'failed');
  assert.equal(batch.pages[0]?.status, 'completed');
  assert.equal(batch.pages[1]?.status, 'failed');
  assert.equal(batch.qualityGate.status, 'fail');
  assert.match(batch.qualityGate.reason, /1 of 2 page assessments failed technically/);
  const summary = formatBatchSummary(batch, 'main');
  assert.match(summary, /Page 1\/2: https:\/\/example\.com\//);
  assert.match(summary, /Page 2\/2: https:\/\/example\.com\/checkout/);
  assert.match(summary, /Result endpoint timed out/);
});

test('explains why an enforced opposed profile blocks the job', () => {
  const assessment = { mode: 'profiles' as const, profiles: [{ id: 'text-amount', direction: 'more-words' }] };
  const results: MetricResult[] = [
    { metric_id: 'm8_word_count', results: [303] },
  ];
  const history: AssessmentHistory = { baselineRun: { id: 1 }, metrics: {
    m8_word_count: { results: [519] },
  } };
  const report = buildReport({ target: 'https://example.com/projects', branch: 'feature/ui-density', resultId: 'job', baselineBranch: 'main', results, history, assessment, qualityGateMode: 'enforce' });
  const summary = formatSummary(report, 'main');
  assert.match(summary, /Quality gate: FAIL \(enforce\)/);
  assert.match(summary, /Blocking failure: 1 profile opposed the configured direction/);
  assert.match(summary, /Exit code: 1/);
  assert.match(summary, /Outcome: OPPOSED/);
  assert.match(summary, /Word count decreased: 519 → 303.*opposed to the profile goal/);
});

test('aggregates page reports and uses the most severe page quality gate', () => {
  const passing = buildReport({
    target: 'https://example.com/', branch: 'main', resultId: 'home', baselineBranch: 'main',
    results: [], history: {}, assessment: { mode: 'profiles', profiles: [{ id: 'general-review', direction: 'observe' }] },
    qualityGateMode: 'report',
  });
  const warning = buildReport({
    target: 'https://example.com/checkout', branch: 'main', resultId: 'checkout', baselineBranch: 'main',
    results: [{ metric_id: 'm13_accessibility', results: [{ violations: [{ id: 'label', nodes: [{}, {}] }] }] }],
    history: { baselineRun: { id: 1 }, metrics: { m13_accessibility: { results: [{ violations: [{ id: 'label', nodes: [{}] }] }] } } },
    assessment: { mode: 'profiles', profiles: [{ id: 'accessibility', direction: 'fewer-detected-violations' }] },
    qualityGateMode: 'warn',
  });
  const report = buildBatchReport([passing, warning], 'main', 'abc');
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.pages.length, 2);
  assert.equal(report.pages[0]?.qualityGate.mode, 'report');
  assert.equal(report.pages[1]?.qualityGate.mode, 'warn');
  assert.equal(report.qualityGate.mode, 'per-page');
  assert.equal(report.qualityGate.status, 'warning');
  assert.match(report.qualityGate.reason, /1 of 2 page assessments/);
  const summary = formatBatchSummary(report, 'main');
  assert.match(summary, /Pages assessed: 2/);
  assert.match(summary, /Page 1\/2: https:\/\/example\.com\//);
  assert.match(summary, /Page 2\/2: https:\/\/example\.com\/checkout/);
  assert.match(summary, /Overall quality gate: WARNING/);
});

test('applies the gate mode independently to each page', () => {
  const common = {
    branch: 'main', baselineBranch: 'main',
    results: [{ metric_id: 'm13_accessibility', results: [{ violations: [{ id: 'label', nodes: [{}, {}] }] }] }],
    history: { baselineRun: { id: 1 }, metrics: { m13_accessibility: { results: [{ violations: [{ id: 'label', nodes: [{}] }] }] } } },
    assessment: { mode: 'profiles' as const, profiles: [{ id: 'accessibility', direction: 'fewer-detected-violations' }] },
  };
  const reported = buildReport({ ...common, target: 'https://example.com/help', resultId: 'help', qualityGateMode: 'report' });
  const enforced = buildReport({ ...common, target: 'https://example.com/checkout', resultId: 'checkout', qualityGateMode: 'enforce' });
  assert.equal(reported.profileOutcomes[0]?.outcome, 'opposed');
  assert.equal(reported.qualityGate.status, 'pass');
  assert.equal(enforced.profileOutcomes[0]?.outcome, 'opposed');
  assert.equal(enforced.qualityGate.status, 'fail');
  assert.equal(buildBatchReport([reported, enforced], 'main').qualityGate.status, 'fail');
});

test('fails an enforced page when any one of its profiles is opposed', () => {
  const input = {
    target: 'https://example.com/checkout', branch: 'main', resultId: 'checkout', baselineBranch: 'main',
    results: [
      { metric_id: 'm13_accessibility', results: [{ violations: [{ id: 'label', nodes: [{}, {}] }] }] },
      { metric_id: 'm3_colorfulness', results: [{ colorfulness: 50 }] },
    ],
    history: { baselineRun: { id: 1 }, metrics: {
      m13_accessibility: { results: [{ violations: [{ id: 'label', nodes: [{}] }] }] },
      m3_colorfulness: { results: [{ colorfulness: 40 }] },
    } },
    assessment: { mode: 'profiles' as const, profiles: [
      { id: 'accessibility', direction: 'fewer-detected-violations' },
      { id: 'colorfulness', direction: 'more-colorful' },
    ] },
  };
  const enforced = buildReport({ ...input, qualityGateMode: 'enforce' });
  assert.deepEqual(enforced.profileOutcomes.map((profile) => profile.outcome), ['opposed', 'aligned']);
  assert.equal(enforced.qualityGate.status, 'fail');
  assert.match(enforced.qualityGate.reason, /1 profile opposed/);
  assert.equal(buildReport({ ...input, qualityGateMode: 'warn' }).qualityGate.status, 'warning');
  assert.equal(buildReport({ ...input, qualityGateMode: 'report' }).qualityGate.status, 'pass');
});
