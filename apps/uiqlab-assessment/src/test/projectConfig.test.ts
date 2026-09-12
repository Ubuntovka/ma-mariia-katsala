import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getOrCreateProjectConfig, PROJECT_CONFIG_FILENAME } from '../projectConfig';

suite('Project configuration', () => {
	test('creates and reuses a project key', async () => {
		const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'uiqlab-config-'));
		const workspaceRoot = path.join(parent, 'UIQLab Demo');
		await fs.mkdir(workspaceRoot);

		try {
			const created = await getOrCreateProjectConfig(workspaceRoot);
			const reused = await getOrCreateProjectConfig(workspaceRoot);
			const stored = JSON.parse(await fs.readFile(path.join(workspaceRoot, PROJECT_CONFIG_FILENAME), 'utf8'));

			assert.match(created.projectKey, /^[0-9a-f-]{36}$/);
			assert.strictEqual(created.name, 'UIQLab Demo');
			assert.deepStrictEqual(reused, created);
			assert.deepStrictEqual(stored, created);
		} finally {
			await fs.rm(parent, { recursive: true, force: true });
		}
	});

	test('rejects an invalid existing project key', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'uiqlab-config-'));
		try {
			await fs.writeFile(
				path.join(workspaceRoot, PROJECT_CONFIG_FILENAME),
				JSON.stringify({ projectKey: 'invalid', name: 'Demo' }),
			);
			await assert.rejects(getOrCreateProjectConfig(workspaceRoot), /valid UUID/);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('resolves configured profiles to unique metric IDs', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'uiqlab-config-'));
		try {
			await fs.writeFile(path.join(workspaceRoot, PROJECT_CONFIG_FILENAME), JSON.stringify({
				projectKey: '123e4567-e89b-12d3-a456-426614174000', name: 'Demo',
				assessment: { mode: 'profiles', profiles: [
					{ id: 'visual-clutter', direction: 'reduce-complexity' },
					{ id: 'text-amount', direction: 'preserve' },
				] },
			}));
			const config = await getOrCreateProjectConfig(workspaceRoot);
			assert.deepStrictEqual(config.assessment, {
				mode: 'profiles',
				profiles: [
					{ id: 'visual-clutter', direction: 'reduce-complexity' },
					{ id: 'text-amount', direction: 'preserve' },
				],
				metrics: ['m9', 'm10', 'm11', 'm8'],
			});
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('rejects invalid profile direction and mixed manual metrics', async () => {
		const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'uiqlab-config-'));
		const filename = path.join(workspaceRoot, PROJECT_CONFIG_FILENAME);
		const base = { projectKey: '123e4567-e89b-12d3-a456-426614174000', name: 'Demo' };
		try {
			await fs.writeFile(filename, JSON.stringify({ ...base, assessment: { mode: 'profiles', profiles: [{ id: 'accessibility', direction: 'increase' }] } }));
			await assert.rejects(getOrCreateProjectConfig(workspaceRoot), /direction for "accessibility"/);
			await fs.writeFile(filename, JSON.stringify({ ...base, assessment: { mode: 'profiles', profiles: [{ id: 'accessibility', direction: 'observe' }] }, ci: { metrics: ['m13'] } }));
			await assert.rejects(getOrCreateProjectConfig(workspaceRoot), /cannot combine assessment profiles with manual metrics/);
		} finally {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});
