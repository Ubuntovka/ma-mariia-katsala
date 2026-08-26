import { readFile } from 'node:fs/promises';
import { resolveAssessmentProfiles, type AssessmentProfileSelection } from './assessmentProfiles.js';
import type { QualityGateMode } from './qualityGate.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METRIC_ID = /^m(?:[1-9]|1[0-4])$/;

export interface CiConfig {
  projectKey: string;
  projectName?: string;
  branches: string[];
  baselineBranch: string;
  pages: CiPageConfig[];
  metrics: string[];
  assessment: { mode: 'custom' } | { mode: 'profiles'; profiles: AssessmentProfileSelection[] };
  qualityGateMode: QualityGateMode;
  requireBaseline: boolean;
  timeoutMs: number;
  pollIntervalMs: number;
}

export interface CiPageConfig {
  path: string;
  profiles: AssessmentProfileSelection[];
  metrics: string[];
  qualityGateMode: QualityGateMode;
  requireBaseline: boolean;
}

interface ProjectConfigFile {
  projectKey?: unknown;
  name?: unknown;
  assessment?: {
    mode?: unknown;
    profiles?: unknown;
    metrics?: unknown;
  };
  qualityGate?: { mode?: unknown; requireBaseline?: unknown };
  ci?: {
    branches?: unknown;
    baselineBranch?: unknown;
    pages?: unknown;
    metrics?: unknown;
    timeoutMs?: unknown;
    pollIntervalMs?: unknown;
  };
}

function resolvePages(value: unknown, filename: string): CiPageConfig[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${filename} ci.pages must contain one or more page configurations.`);
  }

  const pages: CiPageConfig[] = [];
  const paths = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const location = `${filename} ci.pages[${index}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`${location} must contain a path, profiles, and qualityGate.mode.`);
    }
    const { path, profiles, profile, direction, qualityGate } = item as {
      path?: unknown;
      profiles?: unknown;
      profile?: unknown;
      direction?: unknown;
      qualityGate?: { mode?: unknown; requireBaseline?: unknown };
    };
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('?') || path.includes('#')) {
      throw new Error(`${location}.path must be a route path starting with "/" and without a query or fragment.`);
    }
    const normalizedPath = path === '/' ? path : path.replace(/\/+$/, '');
    if (normalizedPath.length === 0) {
      throw new Error(`${location}.path must be a route path starting with "/".`);
    }
    if (paths.has(normalizedPath)) {
      throw new Error(`${filename} ci.pages must not contain duplicate path "${normalizedPath}".`);
    }
    if (profiles !== undefined && (profile !== undefined || direction !== undefined)) {
      throw new Error(`${location} cannot combine profiles with the legacy profile/direction fields.`);
    }
    const resolved = resolveAssessmentProfiles(
      profiles ?? [{ id: profile, direction }],
      profiles !== undefined ? `${location}.profiles` : location,
    );
    if (typeof qualityGate !== 'object' || qualityGate === null || Array.isArray(qualityGate)) {
      throw new Error(`${location}.qualityGate must be an object containing mode.`);
    }
    const qualityGateMode = qualityGate.mode;
    if (qualityGateMode !== 'report' && qualityGateMode !== 'warn' && qualityGateMode !== 'enforce') {
      throw new Error(`${location}.qualityGate.mode must be one of: report, warn, enforce.`);
    }
    if (qualityGate.requireBaseline !== undefined && typeof qualityGate.requireBaseline !== 'boolean') {
      throw new Error(`${location}.qualityGate.requireBaseline must be a boolean.`);
    }
    paths.add(normalizedPath);
    pages.push({
      path: normalizedPath,
      profiles: resolved.profiles,
      metrics: resolved.metrics,
      qualityGateMode,
      requireBaseline: qualityGate.requireBaseline ?? false,
    });
  }
  return pages;
}

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export function matchesBranch(branch: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const expression = escapeRegex(pattern)
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\u0000/g, '.*');
    return new RegExp(`^${expression}$`).test(branch);
  });
}

export async function loadConfig(filename: string): Promise<CiConfig> {
  let parsed: ProjectConfigFile;
  try {
    parsed = JSON.parse(await readFile(filename, 'utf8')) as ProjectConfigFile;
  } catch (error) {
    throw new Error(`Cannot read ${filename}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed.projectKey !== 'string' || !UUID.test(parsed.projectKey)) {
    throw new Error(`${filename} must contain a valid projectKey UUID.`);
  }
  const branches = parsed.ci?.branches;
  if (!Array.isArray(branches) || branches.length === 0) {
    throw new Error(`${filename} must contain a non-empty ci.branches array.`);
  }
  if (!branches.every((item): item is string => typeof item === 'string' && item.length > 0)) {
    throw new Error(`${filename} ci.branches must contain branch-name patterns.`);
  }
  const assessment = parsed.assessment;
  if (assessment !== undefined && (typeof assessment !== 'object' || assessment === null || Array.isArray(assessment))) {
    throw new Error(`${filename} assessment must be an object.`);
  }
  if (assessment?.mode !== undefined && assessment.mode !== 'custom' && assessment.mode !== 'profiles') {
    throw new Error(`${filename} assessment.mode must be either "custom" or "profiles".`);
  }
  if (assessment?.mode === 'profiles' && (assessment.metrics !== undefined || parsed.ci?.metrics !== undefined)) {
    throw new Error(`${filename} cannot combine assessment profiles with manual metrics.`);
  }
  if (assessment?.mode === 'custom' && assessment.profiles !== undefined) {
    throw new Error(`${filename} cannot combine assessment.profiles with custom metrics.`);
  }

  const pages = resolvePages(parsed.ci?.pages, filename);
  if (pages.length > 0 && parsed.ci?.metrics !== undefined) {
    throw new Error(`${filename} cannot combine ci.pages with ci.metrics; every page gets its metrics from its profiles.`);
  }

  const resolvedProfiles = assessment?.mode === 'profiles'
    ? resolveAssessmentProfiles(assessment.profiles, `${filename} assessment.profiles`)
    : undefined;
  const metricsValue = resolvedProfiles?.metrics ?? assessment?.metrics ?? parsed.ci?.metrics ?? ['m8', 'm10', 'm13', 'm14'];
  if (!Array.isArray(metricsValue) || metricsValue.length === 0 || !metricsValue.every((item): item is string => typeof item === 'string' && METRIC_ID.test(item))) {
    throw new Error(`${filename} custom metrics must contain one or more IDs from m1 through m14.`);
  }
  if (new Set(metricsValue).size !== metricsValue.length) {
    throw new Error(`${filename} custom metrics must not contain duplicate metric IDs.`);
  }
  for (const setting of ['timeoutMs', 'pollIntervalMs'] as const) {
    const value = parsed.ci?.[setting];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
      throw new Error(`${filename} ci.${setting} must be a positive number.`);
    }
  }
  if (parsed.qualityGate !== undefined && (typeof parsed.qualityGate !== 'object' || parsed.qualityGate === null || Array.isArray(parsed.qualityGate))) {
    throw new Error(`${filename} qualityGate must be an object.`);
  }
  const qualityGateMode = parsed.qualityGate?.mode ?? 'warn';
  if (qualityGateMode !== 'report' && qualityGateMode !== 'warn' && qualityGateMode !== 'enforce') {
    throw new Error(`${filename} qualityGate.mode must be one of: report, warn, enforce.`);
  }
  if (parsed.qualityGate?.requireBaseline !== undefined && typeof parsed.qualityGate.requireBaseline !== 'boolean') {
    throw new Error(`${filename} qualityGate.requireBaseline must be a boolean.`);
  }
  const result: CiConfig = {
    projectKey: parsed.projectKey,
    branches,
    baselineBranch: typeof parsed.ci?.baselineBranch === 'string' ? parsed.ci.baselineBranch : 'main',
    pages,
    metrics: metricsValue,
    assessment: resolvedProfiles
      ? { mode: 'profiles', profiles: resolvedProfiles.profiles }
      : { mode: 'custom' },
    qualityGateMode,
    requireBaseline: parsed.qualityGate?.requireBaseline ?? false,
    timeoutMs: typeof parsed.ci?.timeoutMs === 'number' ? parsed.ci.timeoutMs : 300_000,
    pollIntervalMs: typeof parsed.ci?.pollIntervalMs === 'number' ? parsed.ci.pollIntervalMs : 2_000,
  };
  if (typeof parsed.name === 'string') result.projectName = parsed.name;
  return result;
}
