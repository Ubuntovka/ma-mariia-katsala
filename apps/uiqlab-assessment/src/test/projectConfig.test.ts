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
});
