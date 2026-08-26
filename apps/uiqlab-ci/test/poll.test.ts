import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pollEvaluationResult } from '../src/poll.js';

function mockFetch(statuses: number[]): { count: () => number; restore: () => void } {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    const status = statuses.shift() ?? 200;
    return new Response(
      status === 200
        ? JSON.stringify([{ metric_id: 'm14_nima', results: [{ mean: 5.2 }] }])
        : JSON.stringify({ detail: 'still processing' }),
      { status, headers: { 'content-type': 'application/json' } },
    );
  };
  return {
    count: () => requestCount,
    restore: () => { globalThis.fetch = originalFetch; },
  };
}

test('retries transient result errors and returns a later completed result', async () => {
  const fetchMock = mockFetch([500, 502, 503, 504, 200]);

  try {
    const results = await pollEvaluationResult('http://orchestrator', 'result-id', ['m14'], 2_000, 1);

    assert.equal(fetchMock.count(), 5);
    assert.equal(results[0]?.metric_id, 'm14_nima');
  } finally {
    fetchMock.restore();
  }
});

test('does not retry a non-transient result error', async () => {
  const fetchMock = mockFetch([404, 200]);

  try {
    await assert.rejects(
      pollEvaluationResult('http://orchestrator', 'missing', ['m14'], 2_000, 1),
      /HTTP 404/,
    );
    assert.equal(fetchMock.count(), 1);
  } finally {
    fetchMock.restore();
  }
});

test('keeps retrying transient errors until the assessment deadline', async () => {
  const fetchMock = mockFetch(Array.from({ length: 100 }, () => 503));

  try {
    await assert.rejects(
      pollEvaluationResult('http://orchestrator', 'slow-result', ['m14'], 25, 1),
      /Assessment did not complete within/,
    );
    assert.ok(fetchMock.count() > 1);
  } finally {
    fetchMock.restore();
  }
});

test('treats an aborted result request as pending and retries', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) {
      const error = new Error('request timed out');
      error.name = 'AbortError';
      throw error;
    }
    return new Response(JSON.stringify([{ metric_id: 'm14_nima', results: [{ mean: 5.2 }] }]));
  };
  try {
    const results = await pollEvaluationResult('http://orchestrator', 'slow-result', ['m14'], 2_000, 1);
    assert.equal(requests, 2);
    assert.equal(results[0]?.metric_id, 'm14_nima');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects malformed and unexpected metric responses', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify([{ metric_id: 'm14_nima' }]));
    await assert.rejects(
      pollEvaluationResult('http://orchestrator', 'bad-result', ['m14'], 2_000, 1),
      /must contain metric_id and a results array/,
    );
    globalThis.fetch = async () => new Response(JSON.stringify([{ metric_id: 'm13_accessibility', results: [] }]));
    await assert.rejects(
      pollEvaluationResult('http://orchestrator', 'wrong-result', ['m14'], 2_000, 1),
      /unexpected metric/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
