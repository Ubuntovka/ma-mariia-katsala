import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

export const PROJECT_CONFIG_FILENAME = '.uiqlab.json';

export interface ProjectConfig {
	projectKey: string;
	name: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseProjectConfig(contents: string, configPath: string): ProjectConfig {
	let value: unknown;
	try {
		value = JSON.parse(contents);
	} catch {
		throw new Error(`${configPath} is not valid JSON.`);
	}

	if (!value || typeof value !== 'object') {
		throw new Error(`${configPath} must contain a JSON object.`);
	}

	const config = value as Partial<ProjectConfig>;
	if (typeof config.projectKey !== 'string' || !UUID_PATTERN.test(config.projectKey)) {
		throw new Error(`${configPath} must contain a valid UUID in "projectKey".`);
	}
	if (typeof config.name !== 'string' || config.name.trim().length === 0) {
		throw new Error(`${configPath} must contain a non-empty "name".`);
	}

	return { projectKey: config.projectKey, name: config.name };
}

export async function getOrCreateProjectConfig(workspaceRoot: string): Promise<ProjectConfig> {
	if (!workspaceRoot) {
		throw new Error('Open a workspace folder before running an assessment.');
	}

	const configPath = path.join(workspaceRoot, PROJECT_CONFIG_FILENAME);
	try {
		return parseProjectConfig(await fs.readFile(configPath, 'utf8'), configPath);
	} catch (error: any) {
		if (error?.code !== 'ENOENT') {
			throw error;
		}
	}

	const config: ProjectConfig = {
		projectKey: randomUUID(),
		name: path.basename(workspaceRoot),
	};

	try {
		await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
		return config;
	} catch (error: any) {
		// Another extension window may have created it between our read and write.
		if (error?.code === 'EEXIST') {
			return parseProjectConfig(await fs.readFile(configPath, 'utf8'), configPath);
		}
		throw error;
	}
}
