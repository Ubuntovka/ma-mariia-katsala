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
  comparison: { kind: 'latest-from-branch'; branch: string; run: AssessmentRunSummary } | null;
  metrics: ReportMetric[];
  rawResults: MetricResult[];
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
    }
    return metric;
  });
  const report: AssessmentReport = {
    schemaVersion: 1,
    status: 'completed',
    target: input.target,
    source: 'ci/cd',
    branch: input.branch,
    resultId: input.resultId,
    comparison: input.history.baselineRun
      ? { kind: 'latest-from-branch', branch: input.baselineBranch, run: input.history.baselineRun }
      : null,
    metrics,
    rawResults: input.results,
  };
  if (input.commitHash !== undefined) report.commitHash = input.commitHash;
  return report;
}

export function formatSummary(report: AssessmentReport, baselineBranch: string): string {
  const lines = [
    'Web UI Assessment', '', 'Assessment completed successfully.',
    `Target: ${report.target}`,
    report.comparison ? `Compared with: latest assessment from ${baselineBranch}` : `Compared with: no previous assessment from ${baselineBranch} was available`,
    '', 'Metrics:',
  ];
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
