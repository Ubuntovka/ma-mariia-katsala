import { HttpResponseError, jsonRequest } from './http.js';
import type { MetricResult } from './report.js';

const TRANSIENT_RESULT_STATUSES = new Set([500, 502, 503, 504]);

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isMetricResult(value: unknown): value is MetricResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<MetricResult>;
  return typeof candidate.metric_id === 'string' && Array.isArray(candidate.results);
}

export async function pollEvaluationResult(
  baseUrl: string,
  resultId: string,
  metricCount: number,
  timeoutMs: number,
  intervalMs: number,
): Promise<MetricResult[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      const response = await jsonRequest<unknown>(
        `${baseUrl}/eval/result/${encodeURIComponent(resultId)}`,
        {},
        Math.min(130_000, remainingMs),
      );
      if (!Array.isArray(response)) throw new Error('Orchestrator result response must be an array.');
      const results = response.filter(isMetricResult);
      const families = new Set(results.map((item) => item.metric_id.split('_', 1)[0]));
      if (families.size >= metricCount) return results;
    } catch (error) {
      if (!(error instanceof HttpResponseError) || !TRANSIENT_RESULT_STATUSES.has(error.status)) {
        throw error;
      }
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) await sleep(Math.min(intervalMs, remainingMs));
  }
  throw new Error(`Assessment did not complete within ${Math.round(timeoutMs / 1000)} seconds.`);
}
