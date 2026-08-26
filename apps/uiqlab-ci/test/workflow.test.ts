import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPagesSequentially, pageTarget } from '../src/workflow.js';

test('resolves page paths relative to the public preview base URL', () => {
  assert.equal(pageTarget('https://preview.example.com/', '/checkout'), 'https://preview.example.com/checkout');
  assert.equal(pageTarget('https://example.com/previews/42/', '/checkout'), 'https://example.com/previews/42/checkout');
  assert.equal(pageTarget('https://example.com/previews/42?token=secret#part', '/'), 'https://example.com/previews/42/');
});

test('finishes each page assessment before starting the next page', async () => {
  const events: string[] = [];
  let finishPage: (() => void) | undefined;
  const firstPageFinished = new Promise<void>((resolve) => { finishPage = resolve; });
  const run = assessPagesSequentially(['home', 'checkout'], async (page) => {
    events.push(`start:${page}`);
    if (page === 'home') await firstPageFinished;
    events.push(`finish:${page}`);
    return page.toUpperCase();
  });
  await Promise.resolve();
  assert.deepEqual(events, ['start:home']);
  finishPage?.();
  assert.deepEqual(await run, ['HOME', 'CHECKOUT']);
  assert.deepEqual(events, ['start:home', 'finish:home', 'start:checkout', 'finish:checkout']);
});
