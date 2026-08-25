import assert from 'node:assert/strict';
import test from 'node:test';
import { renderHtmlReport, renderHtmlReportWithEmbeddedImages } from '../src/htmlReport.js';
import { buildBatchReport, buildReport } from '../src/report.js';

test('renders a self-contained visual report with profiles and metric comparisons', () => {
  const report = buildReport({
    target: 'https://preview.example.com/checkout?mode=<unsafe>',
    branch: 'feature/checkout',
    commitHash: 'abc123',
    resultId: 'result-42',
    baselineBranch: 'main',
    results: [
      { metric_id: 'm9_edge_density', results: [0.15] },
      { metric_id: 'm13_accessibility', results: [{ violations: [{ id: '<label>', nodes: [{}, {}] }] }] },
      { metric_id: 'm10_feature_congestion', results: [{ feature_congestion: 4.2, map_url: 'https://assets.example.com/map.png' }] },
    ],
    history: {
      baselineRun: { id: 1, branch: 'main' },
      metrics: {
        m9_edge_density: { results: [0.2] },
        m13_accessibility: { results: [{ violations: [{ id: 'label', nodes: [{}] }] }] },
      },
    },
    assessment: { mode: 'profiles', profiles: [{ id: 'accessibility', direction: 'reduce-issues' }] },
    qualityGateMode: 'warn',
  });
  const html = renderHtmlReport(report, { generatedAt: new Date('2026-08-25T10:00:00.000Z') });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /UIQLab Web UI Assessment/);
  assert.match(html, /Quality gate · warn/);
  assert.match(html, /Profile outcomes/);
  assert.match(html, /Edge density/);
  assert.match(html, /Meaningful change/);
  assert.match(html, /<img src="https:\/\/assets\.example\.com\/map\.png"/);
  assert.match(html, /2026-08-25T10:00:00.000Z/);
  assert.match(html, /mode=&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /<label>/);
  assert.doesNotMatch(html, /<a\b/);
});

test('renders every page and the aggregate result for a batch report', () => {
  const page = (target: string, resultId: string) => buildReport({
    target, branch: 'main', resultId, baselineBranch: 'main', results: [], history: {},
    assessment: { mode: 'profiles', profiles: [{ id: 'general-review', direction: 'observe' }] },
    qualityGateMode: 'report',
  });
  const report = buildBatchReport([
    page('https://example.com/', 'home'),
    page('https://example.com/checkout', 'checkout'),
  ], 'main', 'def456');
  const html = renderHtmlReport(report);
  assert.match(html, /Page 1/);
  assert.match(html, /Page 2/);
  assert.match(html, /https:\/\/example\.com\/checkout/);
  assert.match(html, /All 2 page assessments passed/);
});

test('embeds visual metric files so the artifact does not depend on localhost URLs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([137, 80, 78, 71]), {
    headers: { 'content-type': 'image/png' },
  });
  try {
    const report = buildReport({
      target: 'https://example.com', branch: 'main', resultId: 'visual', baselineBranch: 'main',
      results: [{ metric_id: 'm10_feature_congestion', results: [4.2, 'http://localhost:8001/results/map.png'] }],
      history: {},
    });
    const html = await renderHtmlReportWithEmbeddedImages(report);
    assert.match(html, /src="data:image\/png;base64,iVBORw=="/);
    assert.doesNotMatch(html, /src="http:\/\/localhost:8001\/results\/map.png"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('renders useful HTML artifacts for skipped and failed runs', () => {
  const skipped = renderHtmlReport({ status: 'skipped', branch: 'docs', reason: 'Branch does not match.' });
  const failed = renderHtmlReport({ status: 'failed', reason: 'Orchestrator timeout', qualityGate: { mode: 'warn', status: 'fail', reason: 'Technical failure.' } });
  assert.match(skipped, /No assessment was required/);
  assert.match(skipped, /Branch does not match/);
  assert.match(failed, /Assessment could not be completed/);
  assert.match(failed, /Orchestrator timeout/);
  assert.match(failed, /Technical failure/);
});
