import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, matchesBranch } from '../src/config.js';

test('matches exact branch names and glob patterns', () => {
  const patterns = ['main', 'feature/ui-*', 'redesign/**'];
  assert.equal(matchesBranch('main', patterns), true);
  assert.equal(matchesBranch('feature/ui-checkout', patterns), true);
  assert.equal(matchesBranch('redesign/account/header', patterns), true);
  assert.equal(matchesBranch('feature/api-only', patterns), false);
});

test('loads CI settings from the shared project config', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-ci-'));
  const filename = join(directory, '.uiqlab.json');
  await writeFile(filename, JSON.stringify({ projectKey: '123e4567-e89b-12d3-a456-426614174000', name: 'shop', ci: { branches: ['main', 'feature/ui-*'], baselineBranch: 'main', metrics: ['m8', 'm14'] } }));
  assert.deepEqual(await loadConfig(filename), { projectKey: '123e4567-e89b-12d3-a456-426614174000', projectName: 'shop', branches: ['main', 'feature/ui-*'], baselineBranch: 'main', metrics: ['m8', 'm14'], timeoutMs: 300000, pollIntervalMs: 2000 });
});
