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
  timeoutMs: number;
  pollIntervalMs: number;
}

export interface CiPageConfig {
  path: string;
  profile: AssessmentProfileSelection;
  metrics: string[];
  qualityGateMode: QualityGateMode;
}

interface ProjectConfigFile {
  projectKey?: unknown;
  name?: unknown;
  assessment?: {
    mode?: unknown;
    profiles?: unknown;
    metrics?: unknown;
  };
  qualityGate?: { mode?: unknown };
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
      throw new Error(`${location} must contain a path, profile, direction, and qualityGate.mode.`);
    }
    const { path, profile, direction, qualityGate } = item as {
      path?: unknown;
      profile?: unknown;
      direction?: unknown;
      qualityGate?: { mode?: unknown };
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
    const resolved = resolveAssessmentProfiles(
      [{ id: profile, direction }],
      location,
    );
    const selection = resolved.profiles[0];
    if (!selection) throw new Error(`${location} must contain a profile and direction.`);
    if (typeof qualityGate !== 'object' || qualityGate === null || Array.isArray(qualityGate)) {
      throw new Error(`${location}.qualityGate must be an object containing mode.`);
    }
    const qualityGateMode = qualityGate.mode;
    if (qualityGateMode !== 'report' && qualityGateMode !== 'warn' && qualityGateMode !== 'enforce') {
      throw new Error(`${location}.qualityGate.mode must be one of: report, warn, enforce.`);
    }
    paths.add(normalizedPath);
    pages.push({ path: normalizedPath, profile: selection, metrics: resolved.metrics, qualityGateMode });
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
    throw new Error(`${filename} cannot combine ci.pages with ci.metrics; every page gets its metrics from its profile.`);
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
    timeoutMs: typeof parsed.ci?.timeoutMs === 'number' ? parsed.ci.timeoutMs : 300_000,
    pollIntervalMs: typeof parsed.ci?.pollIntervalMs === 'number' ? parsed.ci.pollIntervalMs : 2_000,
  };
  if (typeof parsed.name === 'string') result.projectName = parsed.name;
  return result;
}
