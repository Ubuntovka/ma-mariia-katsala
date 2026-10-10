export class HttpResponseError extends Error {
  constructor(
    readonly status: number,
    url: string,
    body: string,
  ) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 500)}`);
    this.name = 'HttpResponseError';
  }
}

export async function jsonRequest<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 130_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    if (!response.ok) throw new HttpResponseError(response.status, url, body);
    try { return JSON.parse(body) as T; } catch { throw new Error(`Invalid JSON from ${url}`); }
  } finally {
    clearTimeout(timer);
  }
}
