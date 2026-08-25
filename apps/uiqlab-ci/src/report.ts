import { classifyProfiles, evaluateQualityGate, qualityGateExitCode, type ProfileOutcome, type QualityGateMode, type QualityGateResult } from './qualityGate.js';

export interface MetricResult {
  metric_id: string;
  results: unknown[];
}

export interface AssessmentRunSummary {
  id: number;
  branch?: string;
  [key: string]: unknown;
}

export interface AssessmentHistory {
  metrics?: Record<string, { results: unknown }>;
  baselineRun?: AssessmentRunSummary;
}

export interface ReportMetric {
  id: string;
  name: string;
  current?: number;
  previous?: number;
  delta?: number;
  relativeDeltaPercent?: number;
  meaningfulChange?: boolean;
  materialityRule?: { absoluteChangeAtLeast: number; relativeChangePercentAtLeast?: number };
  raw: unknown[];
}

export interface AssessmentReport {
  schemaVersion: 1;
  status: 'completed';
  target: string;
  source: 'ci/cd';
  branch: string;
  commitHash?: string;
  resultId: string;
  assessment: { mode: 'custom' } | { mode: 'profiles'; profiles: Array<{ id: string; direction: string }> };
  profileOutcomes: ProfileOutcome[];
  qualityGate: QualityGateResult;
  comparison: { kind: 'latest-from-branch'; branch: string; run: AssessmentRunSummary } | null;
  metrics: ReportMetric[];
  rawResults: MetricResult[];
}

export interface BatchAssessmentReport {
  schemaVersion: 2;
  status: 'completed';
  source: 'ci/cd';
  branch: string;
  commitHash?: string;
  qualityGate: { mode: 'per-page'; status: QualityGateResult['status']; reason: string };
  pages: AssessmentReport[];
}

const METRIC_NAMES: Record<string, string> = {
  m1: 'PNG file size', m2: 'JPEG file size', m3: 'Colorfulness',
  m4: 'CIELab color', m5: 'White space proportion', m6: 'UI segmentation',
  m7: 'Visual saliency', m8: 'Word count', m9: 'Edge density',
  m10: 'Feature congestion', m11: 'Subband entropy', m12: 'Shannon entropy',
  m13: 'Accessibility issues', m14: 'NIMA score',
};

const VALUE_KEYS: Record<string, readonly string[]> = {
  m1: ['pngbytes', 'pngsize', 'filesize', 'value'],
  m2: ['jpegbytes', 'jpegsize', 'jpegfilesize', 'value'],
  m3: ['colorfulness', 'colorfulnessscore', 'score', 'value'],
  m5: ['whitespace', 'whitespaceproportion', 'proportion', 'score', 'value'],
  m8: ['visiblewordcount', 'wordcount', 'words', 'count', 'value'],
  m9: ['edgedensity', 'density', 'percentage', 'value'],
  m10: ['featurecongestion', 'congestion', 'score', 'value'],
  m11: ['subbandentropy', 'entropy', 'score', 'value'],
  m12: ['shannoninformationentropy', 'shannonentropy', 'entropy', 'score', 'value'],
  m14: ['mean', 'meanscore', 'nimascore', 'score'],
};

// Keep these thresholds identical to the orchestrator's deterministic
// comparison selection. Accessibility uses the IDE's existing issue-count
// comparison, where one added or resolved issue is meaningful.
const MATERIALITY_RULES: Record<string, { absolute: number; relative?: number }> = {
  m1: { absolute: 1024, relative: 10 },
  m2: { absolute: 1024, relative: 10 },
  m3: { absolute: 5, relative: 10 },
  m5: { absolute: 0.03, relative: 10 },
  m8: { absolute: 20, relative: 10 },
  m9: { absolute: 0.02, relative: 10 },
  m10: { absolute: 0.5, relative: 10 },
  m11: { absolute: 0.1, relative: 10 },
  m12: { absolute: 0.1, relative: 10 },
  m13: { absolute: 1 },
  m14: { absolute: 0.25, relative: 5 },
};

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function parse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function accessibilityCount(input: unknown): number {
  const value = parse(input);
  if (Array.isArray(value)) {
    if (value.length === 1) return accessibilityCount(value[0]);
    return value.reduce((sum: number, item: unknown) => sum + accessibilityCount(item), 0);
  }
  if (!isRecord(value)) return 0;
  if (typeof value.id === 'string' || typeof value.ruleId === 'string' || typeof value.rule_id === 'string') {
    return Array.isArray(value.nodes) ? value.nodes.length : 1;
  }
  for (const key of ['violations', 'issues', 'details', 'result', 'results', 'data', 'accessibility']) {
    if (key in value) return accessibilityCount(value[key]);
  }
  return 0;
}

export function primaryValue(metricId: string, rawValue: unknown): number | undefined {
  const family = metricId.split('_', 1)[0] ?? metricId;
  const value = parse(rawValue);
  if (family === 'm13') return accessibilityCount(value);
  const direct = finiteNumber(value);
  if (direct !== undefined) return direct;
  if (Array.isArray(value)) return value.length ? primaryValue(family, value[0]) : undefined;
  if (!isRecord(value)) return undefined;
  const fields = new Map(Object.entries(value).map(([key, item]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), item]));
  for (const key of VALUE_KEYS[family] ?? []) {
    const candidate = finiteNumber(fields.get(key));
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function formatDelta(delta: number, relative: number | undefined): string {
  const absolute = `${delta >= 0 ? '+' : ''}${formatNumber(delta)}`;
  if (relative === undefined) return ` (${absolute})`;
  return ` (${relative >= 0 ? '+' : ''}${relative.toFixed(1)}%)`;
}

function formatMetricComparison(metric: ReportMetric & { current: number; previous: number; delta: number }): string {
  const values = `${formatNumber(metric.previous)} → ${formatNumber(metric.current)}`;
  const family = metric.id.split('_', 1)[0];
  if (family === 'm13') return values;
  if (family === 'm14') return `${values} (${metric.delta >= 0 ? '+' : ''}${formatNumber(metric.delta)})`;
  return `${values}${formatDelta(metric.delta, metric.relativeDeltaPercent)}`;
}

interface BuildReportInput {
  target: string;
  branch: string;
  commitHash?: string;
  resultId: string;
  baselineBranch: string;
  results: MetricResult[];
  history: AssessmentHistory;
  assessment?: AssessmentReport['assessment'];
  qualityGateMode?: QualityGateMode;
}

export function buildReport(input: BuildReportInput): AssessmentReport {
  const metrics = input.results.map((result): ReportMetric => {
    const metricId = result.metric_id;
    const family = metricId.split('_', 1)[0] ?? metricId;
    const current = primaryValue(metricId, result.results);
    const previousEntry = input.history.metrics?.[metricId];
    const previous = previousEntry ? primaryValue(metricId, previousEntry.results) : undefined;
    const delta = current !== undefined && previous !== undefined ? current - previous : undefined;
    const metric: ReportMetric = {
      id: metricId,
      name: METRIC_NAMES[family] ?? metricId,
      raw: result.results,
    };
    if (current !== undefined) metric.current = current;
    if (previous !== undefined) metric.previous = previous;
    if (delta !== undefined) {
      metric.delta = delta;
      if (previous !== undefined && previous !== 0) {
        metric.relativeDeltaPercent = (delta / Math.abs(previous)) * 100;
      }
      const rule = MATERIALITY_RULES[family];
      if (rule) {
        metric.meaningfulChange = Math.abs(delta) >= rule.absolute
          || (rule.relative !== undefined && metric.relativeDeltaPercent !== undefined && Math.abs(metric.relativeDeltaPercent) >= rule.relative);
        metric.materialityRule = {
          absoluteChangeAtLeast: rule.absolute,
          ...(rule.relative !== undefined ? { relativeChangePercentAtLeast: rule.relative } : {}),
        };
      }
    }
    return metric;
  });
  const assessment = input.assessment ?? { mode: 'custom' };
  const profileOutcomes = assessment.mode === 'profiles'
    ? classifyProfiles(
      assessment.profiles,
      metrics.map((metric) => ({
        id: metric.id.split('_', 1)[0] ?? metric.id,
        ...(metric.current !== undefined ? { current: metric.current } : {}),
        ...(metric.previous !== undefined ? { previous: metric.previous } : {}),
        ...(metric.delta !== undefined ? { delta: metric.delta } : {}),
        ...(metric.meaningfulChange !== undefined ? { meaningfulChange: metric.meaningfulChange } : {}),
      })),
      Boolean(input.history.baselineRun),
    )
    : [];
  const qualityGate = evaluateQualityGate(input.qualityGateMode ?? 'warn', profileOutcomes);
  const report: AssessmentReport = {
    schemaVersion: 1,
    status: 'completed',
    target: input.target,
    source: 'ci/cd',
    branch: input.branch,
    resultId: input.resultId,
    assessment,
    profileOutcomes,
    qualityGate,
    comparison: input.history.baselineRun
      ? { kind: 'latest-from-branch', branch: input.baselineBranch, run: input.history.baselineRun }
      : null,
    metrics,
    rawResults: input.results,
  };
  if (input.commitHash !== undefined) report.commitHash = input.commitHash;
  return report;
}

export function buildBatchReport(
  pages: AssessmentReport[],
  branch: string,
  commitHash?: string,
): BatchAssessmentReport {
  const failed = pages.filter((page) => page.qualityGate.status === 'fail').length;
  const warned = pages.filter((page) => page.qualityGate.status === 'warning').length;
  let qualityGate: BatchAssessmentReport['qualityGate'];
  if (failed > 0) {
    qualityGate = {
      mode: 'per-page',
      status: 'fail',
      reason: `${failed} of ${pages.length} page assessment${pages.length === 1 ? '' : 's'} failed the quality gate.`,
    };
  } else if (warned > 0) {
    qualityGate = {
      mode: 'per-page',
      status: 'warning',
      reason: `${warned} of ${pages.length} page assessment${pages.length === 1 ? '' : 's'} produced a quality warning.`,
    };
  } else {
    qualityGate = {
      mode: 'per-page',
      status: 'pass',
      reason: `All ${pages.length} page assessment${pages.length === 1 ? '' : 's'} passed the quality gate.`,
    };
  }
  const report: BatchAssessmentReport = {
    schemaVersion: 2,
    status: 'completed',
    source: 'ci/cd',
    branch,
    qualityGate,
    pages,
  };
  if (commitHash !== undefined) report.commitHash = commitHash;
  return report;
}

export function formatSummary(report: AssessmentReport, baselineBranch: string): string {
  const gateDecision = report.qualityGate.status === 'fail'
    ? 'Blocking failure: enforce mode fails when any profile is opposed.'
    : report.qualityGate.status === 'warning'
      ? `Non-blocking warning: ${report.qualityGate.mode} mode warns when a profile is mixed or opposed.`
      : 'Passed: no profile outcome triggers the configured gate mode.';
  const lines = [
    'Web UI Assessment', '', `Quality gate: ${report.qualityGate.status.toUpperCase()} (${report.qualityGate.mode})`,
    `Decision: ${gateDecision}`,
    `Exit code: ${qualityGateExitCode(report.qualityGate)}`,
    `Target: ${report.target}`,
    report.comparison ? `Compared with: latest assessment from ${baselineBranch}` : `Compared with: no previous assessment from ${baselineBranch} was available`,
  ];
  if (report.profileOutcomes.length > 0) {
    lines.push('', 'Profiles:');
    for (const profile of report.profileOutcomes) {
      lines.push(`- ${profile.id}`, `  Expected direction: ${profile.direction}`, `  Outcome: ${profile.outcome.toUpperCase()}`, `  Reason: ${profile.reason}`);
      if (profile.meaningfulMetrics.length > 0) {
        lines.push('  Meaningful changes:');
        for (const metricId of profile.meaningfulMetrics) {
          const metric = report.metrics.find((candidate) => candidate.id.split('_', 1)[0] === metricId);
          if (!metric || metric.current === undefined || metric.previous === undefined || metric.delta === undefined) continue;
          const relationship = profile.alignedMetrics.includes(metricId) ? 'aligned with' : 'opposed to';
          const movement = metric.delta > 0 ? 'increased' : 'decreased';
          lines.push(`    - ${metric.name} ${movement}: ${formatMetricComparison({ ...metric, current: metric.current, previous: metric.previous, delta: metric.delta })} — ${relationship} the profile goal`);
        }
      }
    }
  }
  lines.push('', 'Metrics:');
  for (const metric of report.metrics) {
    if (metric.current === undefined) {
      lines.push(`- ${metric.name}: result available in JSON report`);
    } else if (metric.previous === undefined || metric.delta === undefined) {
      lines.push(`- ${metric.name}: ${formatNumber(metric.current)} (no baseline)`);
    } else {
      lines.push(`- ${metric.name}: ${formatMetricComparison({ ...metric, current: metric.current, previous: metric.previous, delta: metric.delta })}`);
    }
  }
  lines.push('', 'Full results are available in the attached JSON report.');
  return lines.join('\n');
}

export function formatBatchSummary(report: BatchAssessmentReport, baselineBranch: string): string {
  const lines = [
    'Web UI Assessment', '',
    `Pages assessed: ${report.pages.length}`,
    `Overall quality gate: ${report.qualityGate.status.toUpperCase()} (${report.qualityGate.mode})`,
    `Decision: ${report.qualityGate.reason}`,
    `Exit code: ${qualityGateExitCode(report.qualityGate)}`,
  ];
  report.pages.forEach((page, index) => {
    const pageLines = formatSummary(page, baselineBranch).split('\n').slice(2);
    lines.push('', `Page ${index + 1}/${report.pages.length}: ${page.target}`, ...pageLines);
  });
  return lines.join('\n');
}
