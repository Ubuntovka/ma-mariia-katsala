import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { resolveProfiles, type AssessmentProfileSelection } from './assessmentProfiles';

export const PROJECT_CONFIG_FILENAME = '.uiqlab.json';

export interface ProjectConfig {
	projectKey: string;
	name: string;
	assessment?: { mode: 'custom'; metrics: string[] } | { mode: 'profiles'; profiles: AssessmentProfileSelection[]; metrics: string[] };
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

	const config = value as Partial<ProjectConfig> & { assessment?: { mode?: unknown; profiles?: unknown; metrics?: unknown }; ci?: { metrics?: unknown } };
	if (typeof config.projectKey !== 'string' || !UUID_PATTERN.test(config.projectKey)) {
		throw new Error(`${configPath} must contain a valid UUID in "projectKey".`);
	}
	if (typeof config.name !== 'string' || config.name.trim().length === 0) {
		throw new Error(`${configPath} must contain a non-empty "name".`);
	}

	let assessment: ProjectConfig['assessment'];
	if (config.assessment !== undefined) {
		if (!config.assessment || typeof config.assessment !== 'object' || Array.isArray(config.assessment)) {
			throw new Error(`${configPath} "assessment" must be an object.`);
		}
		if (config.assessment.mode === 'profiles') {
			if (config.assessment.metrics !== undefined || config.ci?.metrics !== undefined) {
				throw new Error(`${configPath} cannot combine assessment profiles with manual metrics.`);
			}
			const resolved = resolveProfiles(config.assessment.profiles, `${configPath} assessment.profiles`);
			assessment = { mode: 'profiles', ...resolved };
		} else if (config.assessment.mode === 'custom') {
			if (config.assessment.profiles !== undefined) {
				throw new Error(`${configPath} cannot combine assessment.profiles with custom metrics.`);
			}
			const metrics = config.assessment.metrics;
			if (!Array.isArray(metrics) || metrics.length === 0 || !metrics.every((metric) => typeof metric === 'string' && /^m(?:[1-9]|1[0-4])$/.test(metric))) {
				throw new Error(`${configPath} assessment.metrics must contain one or more IDs from m1 through m14.`);
			}
			if (new Set(metrics).size !== metrics.length) {
				throw new Error(`${configPath} assessment.metrics must not contain duplicates.`);
			}
			assessment = { mode: 'custom', metrics };
		} else {
			throw new Error(`${configPath} assessment.mode must be either "custom" or "profiles".`);
		}
	}

	return { projectKey: config.projectKey, name: config.name, ...(assessment ? { assessment } : {}) };
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
