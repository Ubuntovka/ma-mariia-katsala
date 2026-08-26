import { primaryValue, type AssessmentHistory, type MetricResult } from './report.js';

const METRIC_FAMILY = /^m(?:[1-9]|1[0-4])$/;
const SCALAR_METRIC_FAMILIES = new Set(['m1', 'm2', 'm3', 'm5', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14']);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function metricFamily(metricId: string): string {
  return metricId.split('_', 1)[0] ?? metricId;
}

export function validateSubmissionResponse(value: unknown): { result_id: string } {
  const response = record(value);
  const resultId = response?.result_id;
  if (typeof resultId !== 'string' || resultId.trim().length === 0 || resultId.length > 500) {
    throw new Error('Orchestrator submission response must contain a non-empty result_id string.');
  }
  return { result_id: resultId };
}

export function validateMetricResults(
  value: unknown,
  expectedMetrics: readonly string[],
): MetricResult[] {
  if (!Array.isArray(value)) throw new Error('Orchestrator result response must be an array.');
  const expectedFamilies = new Set(expectedMetrics.map(metricFamily));
  const returnedFamilies = new Set<string>();
  return value.map((item, index) => {
    const candidate = record(item);
    if (!candidate || typeof candidate.metric_id !== 'string' || !Array.isArray(candidate.results)) {
      throw new Error(`Orchestrator result response item ${index} must contain metric_id and a results array.`);
    }
    const family = metricFamily(candidate.metric_id);
    if (!METRIC_FAMILY.test(family) || !expectedFamilies.has(family)) {
      throw new Error(`Orchestrator returned unexpected metric "${candidate.metric_id}".`);
    }
    if (returnedFamilies.has(family)) {
      throw new Error(`Orchestrator returned duplicate results for metric family "${family}".`);
    }
    returnedFamilies.add(family);
    return { metric_id: candidate.metric_id, results: candidate.results };
  });
}

export function validateScalarMetricValues(results: readonly MetricResult[]): void {
  for (const result of results) {
    const family = metricFamily(result.metric_id);
    if (SCALAR_METRIC_FAMILIES.has(family) && primaryValue(result.metric_id, result.results) === undefined) {
      throw new Error(`Orchestrator metric "${result.metric_id}" does not contain a finite primary value.`);
    }
  }
}

export function validateHistoryResponse(
  value: unknown,
  options: { expectedMetricIds?: readonly string[]; expectedBaselineBranch?: string } = {},
): AssessmentHistory {
  const response = record(value);
  if (!response) throw new Error('Orchestrator history response must be an object.');
  const history: AssessmentHistory = {};
  if (response.metrics !== undefined) {
    const metrics = record(response.metrics);
    if (!metrics) throw new Error('Orchestrator history metrics must be an object.');
    const validated: NonNullable<AssessmentHistory['metrics']> = {};
    const expectedMetricIds = options.expectedMetricIds ? new Set(options.expectedMetricIds) : undefined;
    for (const [metricId, entry] of Object.entries(metrics)) {
      const family = metricFamily(metricId);
      const metric = record(entry);
      if (!METRIC_FAMILY.test(family) || !metric || !Array.isArray(metric.results)) {
        throw new Error(`Orchestrator history contains an invalid metric entry "${metricId}".`);
      }
      if (expectedMetricIds && !expectedMetricIds.has(metricId)) {
        throw new Error(`Orchestrator history returned unexpected metric "${metricId}".`);
      }
      validated[metricId] = { results: metric.results };
    }
    validateScalarMetricValues(Object.entries(validated).map(([metric_id, entry]) => ({
      metric_id,
      results: entry.results as unknown[],
    })));
    history.metrics = validated;
  }
  if (response.baselineRun !== undefined) {
    const baseline = record(response.baselineRun);
    if (!baseline || !Number.isInteger(baseline.id) || (baseline.id as number) <= 0) {
      throw new Error('Orchestrator history baselineRun must contain a positive integer id.');
    }
    if (baseline.branch !== undefined && typeof baseline.branch !== 'string') {
      throw new Error('Orchestrator history baselineRun.branch must be a string.');
    }
    if (options.expectedBaselineBranch !== undefined && baseline.branch !== options.expectedBaselineBranch) {
      throw new Error(`Orchestrator returned a baseline from branch "${String(baseline.branch)}" instead of "${options.expectedBaselineBranch}".`);
    }
    history.baselineRun = baseline as NonNullable<AssessmentHistory['baselineRun']>;
  }
  return history;
}
