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
  assert.deepEqual(await loadConfig(filename), { projectKey: '123e4567-e89b-12d3-a456-426614174000', projectName: 'shop', branches: ['main', 'feature/ui-*'], baselineBranch: 'main', pages: [], metrics: ['m8', 'm14'], assessment: { mode: 'custom' }, qualityGateMode: 'warn', requireBaseline: false, timeoutMs: 300000, pollIntervalMs: 2000 });
});

test('resolves profiles to unique metric IDs and retains their intent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-ci-'));
  const filename = join(directory, '.uiqlab.json');
  await writeFile(filename, JSON.stringify({
    projectKey: '123e4567-e89b-12d3-a456-426614174000',
    ci: { branches: ['main'] },
    assessment: { mode: 'profiles', profiles: [
      { id: 'visual-clutter', direction: 'reduce-complexity' },
      { id: 'screen-whitespace', direction: 'more-whitespace' },
    ] },
  }));
  const config = await loadConfig(filename);
  assert.deepEqual(config.metrics, ['m9', 'm10', 'm11', 'm5']);
  assert.deepEqual(config.assessment, { mode: 'profiles', profiles: [
    { id: 'visual-clutter', direction: 'reduce-complexity' },
    { id: 'screen-whitespace', direction: 'more-whitespace' },
  ] });
  assert.equal(config.qualityGateMode, 'warn');
});

test('loads ordered CI pages with independently resolved profile groups and gates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-ci-'));
  const filename = join(directory, '.uiqlab.json');
  await writeFile(filename, JSON.stringify({
    projectKey: '123e4567-e89b-12d3-a456-426614174000',
    ci: { branches: ['main'], pages: [
      { path: '/', profiles: [{ id: 'general-review', direction: 'observe' }], qualityGate: { mode: 'report' } },
      { path: '/checkout/', profiles: [
        { id: 'accessibility', direction: 'fewer-detected-violations' },
        { id: 'text-amount', direction: 'fewer-words' },
      ], qualityGate: { mode: 'enforce', requireBaseline: true } },
      { path: '/catalog', profiles: [
        { id: 'colorfulness', direction: 'more-colorful' },
        { id: 'screen-whitespace', direction: 'observe' },
      ], qualityGate: { mode: 'warn' } },
    ] },
  }));
  const config = await loadConfig(filename);
  assert.deepEqual(config.pages, [
    { path: '/', profiles: [{ id: 'general-review', direction: 'observe' }], metrics: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14'], qualityGateMode: 'report', requireBaseline: false },
    { path: '/checkout', profiles: [
      { id: 'accessibility', direction: 'fewer-detected-violations' },
      { id: 'text-amount', direction: 'fewer-words' },
    ], metrics: ['m13', 'm8'], qualityGateMode: 'enforce', requireBaseline: true },
    { path: '/catalog', profiles: [
      { id: 'colorfulness', direction: 'more-colorful' },
      { id: 'screen-whitespace', direction: 'observe' },
    ], metrics: ['m3', 'm5'], qualityGateMode: 'warn', requireBaseline: false },
  ]);
});

test('keeps singular page profile configuration compatible', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-ci-'));
  const filename = join(directory, '.uiqlab.json');
  await writeFile(filename, JSON.stringify({
    projectKey: '123e4567-e89b-12d3-a456-426614174000',
    ci: { branches: ['main'], pages: [
      { path: '/', profile: 'accessibility', direction: 'fewer-detected-violations', qualityGate: { mode: 'enforce' } },
    ] },
  }));
  assert.deepEqual((await loadConfig(filename)).pages[0], {
    path: '/', profiles: [{ id: 'accessibility', direction: 'fewer-detected-violations' }], metrics: ['m13'], qualityGateMode: 'enforce', requireBaseline: false,
  });
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
    { path: '/checkout/', profile: 'visual-clutter', direction: 'reduce-complexity', qualityGate: { mode: 'warn' } },
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
  await writeFile(filename, JSON.stringify({ ...base, ci: { ...base.ci, pages: [{ path: '/', profile: 'accessibility', direction: 'observe', qualityGate: { mode: 'warn', requireBaseline: 'yes' } }] } }));
  await assert.rejects(loadConfig(filename), /qualityGate\.requireBaseline must be a boolean/);
  await writeFile(filename, JSON.stringify({ ...base, ci: { ...base.ci, pages: [{ path: '/', profiles: [{ id: 'accessibility', direction: 'observe' }], profile: 'visual-clutter', direction: 'reduce-complexity', qualityGate: { mode: 'warn' } }] } }));
  await assert.rejects(loadConfig(filename), /cannot combine profiles with the legacy profile\/direction fields/);
  await writeFile(filename, JSON.stringify({ ...base, ci: { ...base.ci, pages: [{ path: '/', profiles: [
    { id: 'accessibility', direction: 'observe' },
    { id: 'accessibility', direction: 'preserve' },
  ], qualityGate: { mode: 'warn' } }] } }));
  await assert.rejects(loadConfig(filename), /must not select profile "accessibility" more than once/);
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
  await writeFile(filename, JSON.stringify({ ...base, qualityGate: { mode: 'enforce', requireBaseline: true } }));
  assert.equal((await loadConfig(filename)).requireBaseline, true);
  await writeFile(filename, JSON.stringify({ ...base, qualityGate: { mode: 'enforce', requireBaseline: 1 } }));
  await assert.rejects(loadConfig(filename), /qualityGate\.requireBaseline must be a boolean/);
});

test('rejects unknown profiles and invalid directions clearly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-ci-'));
  const filename = join(directory, '.uiqlab.json');
  const base = { projectKey: '123e4567-e89b-12d3-a456-426614174000', ci: { branches: ['main'] } };
  await writeFile(filename, JSON.stringify({ ...base, assessment: { mode: 'profiles', profiles: [{ id: 'unknown', direction: 'observe' }] } }));
  await assert.rejects(loadConfig(filename), /unknown profile id "unknown"/);
  await writeFile(filename, JSON.stringify({ ...base, assessment: { mode: 'profiles', profiles: [{ id: 'accessibility', direction: 'increase' }] } }));
  await assert.rejects(loadConfig(filename), /direction for "accessibility" must be one of: fewer-detected-violations, preserve, observe/);
});

test('rejects mixing profiles with manual metrics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uiqlab-ci-'));
  const filename = join(directory, '.uiqlab.json');
  await writeFile(filename, JSON.stringify({
    projectKey: '123e4567-e89b-12d3-a456-426614174000',
    ci: { branches: ['main'], metrics: ['m9'] },
    assessment: { mode: 'profiles', profiles: [{ id: 'visual-clutter', direction: 'observe' }] },
  }));
  await assert.rejects(loadConfig(filename), /cannot combine assessment profiles with manual metrics/);
});
