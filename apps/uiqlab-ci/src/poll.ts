import { HttpResponseError, jsonRequest } from './http.js';
import { validateMetricResults } from './apiValidation.js';
import type { MetricResult } from './report.js';

const TRANSIENT_RESULT_STATUSES = new Set([500, 502, 503, 504]);

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT',
]);

function isTransientPollingError(error: unknown): boolean {
  if (error instanceof HttpResponseError) return TRANSIENT_RESULT_STATUSES.has(error.status);
  if (error instanceof Error && error.name === 'AbortError') return true;
  if (!(error instanceof Error) || error.name !== 'TypeError') return false;
  const cause = (error as Error & { cause?: unknown }).cause;
  const code = typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { code?: unknown }).code)
    : undefined;
  return code !== undefined && TRANSIENT_NETWORK_CODES.has(code);
}

export async function pollEvaluationResult(
  baseUrl: string,
  resultId: string,
  expectedMetrics: readonly string[],
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
      const results = validateMetricResults(response, expectedMetrics);
      const families = new Set(results.map((item) => item.metric_id.split('_', 1)[0]));
      if (families.size === new Set(expectedMetrics).size) return results;
    } catch (error) {
      if (!isTransientPollingError(error)) throw error;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) await sleep(Math.min(intervalMs, remainingMs));
  }
  throw new Error(`Assessment did not complete within ${Math.round(timeoutMs / 1000)} seconds.`);
}
