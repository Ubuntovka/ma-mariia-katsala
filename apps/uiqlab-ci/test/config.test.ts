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
  assert.deepEqual(await loadConfig(filename), { projectKey: '123e4567-e89b-12d3-a456-426614174000', projectName: 'shop', branches: ['main', 'feature/ui-*'], baselineBranch: 'main', pages: [], metrics: ['m8', 'm14'], assessment: { mode: 'custom' }, qualityGateMode: 'warn', timeoutMs: 300000, pollIntervalMs: 2000 });
});

test('resolves profiles to unique metric IDs and retains their intent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-ci-'));
  const filename = join(directory, '.uiqlab.json');
  await writeFile(filename, JSON.stringify({
    projectKey: '123e4567-e89b-12d3-a456-426614174000',
    ci: { branches: ['main'] },
    assessment: { mode: 'profiles', profiles: [
      { id: 'visual-complexity', direction: 'decrease' },
      { id: 'layout-density', direction: 'more-spacious' },
    ] },
  }));
  const config = await loadConfig(filename);
  assert.deepEqual(config.metrics, ['m9', 'm10', 'm11', 'm12', 'm5', 'm6']);
  assert.deepEqual(config.assessment, { mode: 'profiles', profiles: [
    { id: 'visual-complexity', direction: 'decrease' },
    { id: 'layout-density', direction: 'more-spacious' },
  ] });
  assert.equal(config.qualityGateMode, 'warn');
});

test('loads ordered CI pages with one resolved profile per page', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-ci-'));
  const filename = join(directory, '.uiqlab.json');
  await writeFile(filename, JSON.stringify({
    projectKey: '123e4567-e89b-12d3-a456-426614174000',
    ci: { branches: ['main'], pages: [
      { path: '/', profile: 'general-review', direction: 'observe', qualityGate: { mode: 'report' } },
      { path: '/checkout/', profile: 'accessibility', direction: 'reduce-issues', qualityGate: { mode: 'enforce' } },
      { path: '/catalog', profile: 'colour-expression', direction: 'more-vivid', qualityGate: { mode: 'warn' } },
    ] },
  }));
  const config = await loadConfig(filename);
  assert.deepEqual(config.pages, [
    { path: '/', profile: { id: 'general-review', direction: 'observe' }, metrics: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14'], qualityGateMode: 'report' },
    { path: '/checkout', profile: { id: 'accessibility', direction: 'reduce-issues' }, metrics: ['m13'], qualityGateMode: 'enforce' },
    { path: '/catalog', profile: { id: 'colour-expression', direction: 'more-vivid' }, metrics: ['m3', 'm4'], qualityGateMode: 'warn' },
  ]);
});

test('rejects invalid or duplicate CI page configurations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-ci-'));
  const filename = join(directory, '.uiqlab.json');
  const base = { projectKey: '123e4567-e89b-12d3-a456-426614174000', ci: { branches: ['main'] } };
  await writeFile(filename, JSON.stringify({ ...base, ci: { ...base.ci, pages: [] } }));
  await assert.rejects(loadConfig(filename), /ci\.pages must contain one or more page configurations/);
  await writeFile(filename, JSON.stringify({ ...base, ci: { ...base.ci, pages: [{ path: 'checkout', profile: 'accessibility', direction: 'observe', qualityGate: { mode: 'warn' } }] } }));
  await assert.rejects(loadConfig(filename), /path must be a route path starting with/);
  await writeFile(filename, JSON.stringify({ ...base, ci: { ...base.ci, pages: [
    { path: '/checkout', profile: 'accessibility', direction: 'observe', qualityGate: { mode: 'warn' } },
    { path: '/checkout/', profile: 'visual-complexity', direction: 'decrease', qualityGate: { mode: 'warn' } },
  ] } }));
  await assert.rejects(loadConfig(filename), /must not contain duplicate path "\/checkout"/);
  await writeFile(filename, JSON.stringify({ ...base, ci: { ...base.ci, pages: [{ path: '/', profile: 'accessibility', direction: 'increase', qualityGate: { mode: 'warn' } }] } }));
  await assert.rejects(loadConfig(filename), /direction for "accessibility" must be one of/);
  await writeFile(filename, JSON.stringify({ ...base, ci: { ...base.ci, metrics: ['m13'], pages: [{ path: '/', profile: 'accessibility', direction: 'observe', qualityGate: { mode: 'warn' } }] } }));
  await assert.rejects(loadConfig(filename), /cannot combine ci\.pages with ci\.metrics/);
  await writeFile(filename, JSON.stringify({ ...base, ci: { ...base.ci, pages: [{ path: '/', profile: 'accessibility', direction: 'observe' }] } }));
  await assert.rejects(loadConfig(filename), /qualityGate must be an object containing mode/);
  await writeFile(filename, JSON.stringify({ ...base, ci: { ...base.ci, pages: [{ path: '/', profile: 'accessibility', direction: 'observe', qualityGate: { mode: 'strict' } }] } }));
  await assert.rejects(loadConfig(filename), /qualityGate\.mode must be one of: report, warn, enforce/);
});

test('loads all quality gate modes and rejects unknown modes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-ci-'));
  const filename = join(directory, '.uiqlab.json');
  const base = { projectKey: '123e4567-e89b-12d3-a456-426614174000', ci: { branches: ['main'] } };
  for (const mode of ['report', 'warn', 'enforce'] as const) {
    await writeFile(filename, JSON.stringify({ ...base, qualityGate: { mode } }));
    assert.equal((await loadConfig(filename)).qualityGateMode, mode);
  }
  await writeFile(filename, JSON.stringify({ ...base, qualityGate: { mode: 'strict' } }));
  await assert.rejects(loadConfig(filename), /qualityGate\.mode must be one of: report, warn, enforce/);
});

test('rejects unknown profiles and invalid directions clearly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-ci-'));
  const filename = join(directory, '.uiqlab.json');
  const base = { projectKey: '123e4567-e89b-12d3-a456-426614174000', ci: { branches: ['main'] } };
  await writeFile(filename, JSON.stringify({ ...base, assessment: { mode: 'profiles', profiles: [{ id: 'unknown', direction: 'observe' }] } }));
  await assert.rejects(loadConfig(filename), /unknown profile id "unknown"/);
  await writeFile(filename, JSON.stringify({ ...base, assessment: { mode: 'profiles', profiles: [{ id: 'accessibility', direction: 'increase' }] } }));
  await assert.rejects(loadConfig(filename), /direction for "accessibility" must be one of: reduce-issues, preserve, observe/);
});

test('rejects mixing profiles with manual metrics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-ci-'));
  const filename = join(directory, '.uiqlab.json');
  await writeFile(filename, JSON.stringify({
    projectKey: '123e4567-e89b-12d3-a456-426614174000',
    ci: { branches: ['main'], metrics: ['m9'] },
    assessment: { mode: 'profiles', profiles: [{ id: 'visual-complexity', direction: 'observe' }] },
  }));
  await assert.rejects(loadConfig(filename), /cannot combine assessment profiles with manual metrics/);
});
