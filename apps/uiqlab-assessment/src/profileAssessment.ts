import {
	ASSESSMENT_PROFILES,
	resolveProfiles,
	type AssessmentProfileSelection,
} from './assessmentProfiles';

export type ProfileOutcomeKind = 'aligned' | 'opposed' | 'mixed' | 'unchanged' | 'not-comparable';
export type ProfileGoalStatus = 'achieved' | 'not-achieved' | 'partial' | 'unchanged' | 'observed' | 'not-comparable';

export interface ProfileMetricComparison {
	id: string;
	current?: number;
	previous?: number;
	delta?: number;
	meaningfulChange?: boolean;
}

export interface ProfileOutcome {
	id: string;
	direction: string;
	outcome: ProfileOutcomeKind;
	goalStatus: ProfileGoalStatus;
	reason: string;
	comparableMetrics: string[];
	meaningfulMetrics: string[];
	alignedMetrics: string[];
	opposedMetrics: string[];
}

export interface ProfileAssessmentSummary {
	status: ProfileGoalStatus;
	title: string;
	description: string;
	outcomes: ProfileOutcome[];
}

export function normalizeProfileAssessmentSelection(value: unknown): AssessmentProfileSelection[] | undefined {
	let parsed = value;
	if (typeof parsed === 'string') {
		try { parsed = JSON.parse(parsed) as unknown; } catch { return undefined; }
	}
	if (!isRecord(parsed) || parsed.mode !== 'profiles') { return undefined; }
	try {
		return resolveProfiles(parsed.profiles, 'Stored assessment profiles').profiles;
	} catch {
		return undefined;
	}
}

type ExpectedMovement = 'increase' | 'decrease' | 'preserve' | 'observe';

const VALUE_KEYS: Readonly<Record<string, readonly string[]>> = {
	m1: ['pngbytes', 'pngsize', 'filesize', 'value'],
	m2: ['jpegbytes', 'jpegsize', 'jpegfilesize', 'value'],
	m3: ['colorfulness', 'colorfulnessscore', 'score', 'value'],
	m5: ['whitespace', 'whitespaceproportion', 'proportion', 'score', 'value'],
	m8: ['visiblewordcount', 'wordcount', 'words', 'count', 'value'],
	m9: ['edgedensity', 'density', 'percentage', 'value'],
	m10: ['featurecongestion', 'congestion', 'score', 'value'],
	m11: ['subbandentropy', 'entropy', 'score', 'value'],
	m12: ['shannoninformationentropy', 'shannonentropy', 'entropy', 'score', 'value'],
	m14: ['mean', 'meanscore', 'nimascore', 'score'],
};

// Keep these thresholds identical to apps/uiqlab-ci/src/report.ts.
const MATERIALITY_RULES: Readonly<Record<string, { absolute: number; relative?: number }>> = {
	m1: { absolute: 1024, relative: 10 },
	m2: { absolute: 1024, relative: 10 },
	m3: { absolute: 5, relative: 10 },
	m5: { absolute: 0.03, relative: 10 },
	m8: { absolute: 20, relative: 10 },
	m9: { absolute: 0.02, relative: 10 },
	m10: { absolute: 0.5, relative: 10 },
	m11: { absolute: 0.1, relative: 10 },
	m12: { absolute: 0.1, relative: 10 },
	m13: { absolute: 1 },
	m14: { absolute: 0.25, relative: 5 },
};

function finiteNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) { return value; }
	if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
		return Number(value);
	}
	return undefined;
}

function parse(value: unknown): unknown {
	if (typeof value !== 'string') { return value; }
	try { return JSON.parse(value) as unknown; } catch { return value; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function accessibilityCount(input: unknown): number {
	const value = parse(input);
	if (Array.isArray(value)) {
		if (value.length === 1) { return accessibilityCount(value[0]); }
		return value.reduce((sum, item) => sum + accessibilityCount(item), 0);
	}
	if (!isRecord(value)) { return 0; }
	if (typeof value.id === 'string' || typeof value.ruleId === 'string' || typeof value.rule_id === 'string') {
		return Array.isArray(value.nodes) ? value.nodes.length : 1;
	}
	for (const key of ['violations', 'issues', 'details', 'result', 'results', 'data', 'accessibility']) {
		if (key in value) { return accessibilityCount(value[key]); }
	}
	return 0;
}

export function primaryProfileMetricValue(metricId: string, rawValue: unknown): number | undefined {
	const family = metricId.split('_', 1)[0] ?? metricId;
	const value = parse(rawValue);
	if (family === 'm13') { return accessibilityCount(value); }
	const direct = finiteNumber(value);
	if (direct !== undefined) { return direct; }
	if (Array.isArray(value)) {
		return value.length ? primaryProfileMetricValue(family, value[0]) : undefined;
	}
	if (!isRecord(value)) { return undefined; }
	const fields = new Map(Object.entries(value).map(([key, item]) => [
		key.toLowerCase().replace(/[^a-z0-9]/g, ''),
		item,
	]));
	for (const key of VALUE_KEYS[family] ?? []) {
		const candidate = finiteNumber(fields.get(key));
		if (candidate !== undefined) { return candidate; }
	}
	return undefined;
}

export function buildProfileMetricComparisons(
	currentResults: readonly any[],
	historyMetrics: Readonly<Record<string, { results: unknown }>>,
): ProfileMetricComparison[] {
	return currentResults.map((result): ProfileMetricComparison => {
		const metricId = typeof result?.metric_id === 'string' ? result.metric_id : '';
		const id = metricId.split('_', 1)[0] ?? metricId;
		const current = primaryProfileMetricValue(metricId, result?.results);
		const historicalResult = historyMetrics[metricId];
		const previous = historicalResult
			? primaryProfileMetricValue(metricId, historicalResult.results)
			: undefined;
		const comparison: ProfileMetricComparison = { id };
		if (current !== undefined) { comparison.current = current; }
		if (previous !== undefined) { comparison.previous = previous; }
		if (current !== undefined && previous !== undefined) {
			const delta = current - previous;
			comparison.delta = delta;
			const relativeDeltaPercent = previous === 0 ? undefined : (delta / Math.abs(previous)) * 100;
			const rule = MATERIALITY_RULES[id];
			if (rule) {
				comparison.meaningfulChange = Math.abs(delta) >= rule.absolute
					|| (rule.relative !== undefined
						&& relativeDeltaPercent !== undefined
						&& Math.abs(relativeDeltaPercent) >= rule.relative);
			}
		}
		return comparison;
	});
}

function expectedMovement(profileId: string, direction: string, metricId: string): ExpectedMovement | undefined {
	if (direction === 'observe') { return 'observe'; }
	if (direction === 'preserve') { return 'preserve'; }
	if (profileId === 'layout-density') {
		if (metricId === 'm5') { return direction === 'more-spacious' ? 'increase' : 'decrease'; }
		if (metricId === 'm10') { return direction === 'more-spacious' ? 'decrease' : 'increase'; }
		return undefined;
	}
	if (profileId === 'content-density') {
		if (metricId === 'm5') { return direction === 'decrease' ? 'increase' : 'decrease'; }
		return direction === 'decrease' ? 'decrease' : 'increase';
	}
	if (profileId === 'colour-expression') { return direction === 'more-vivid' ? 'increase' : 'decrease'; }
	if (profileId === 'accessibility') { return 'decrease'; }
	if (direction === 'decrease') { return 'decrease'; }
	if (direction === 'increase') { return 'increase'; }
	return undefined;
}

function followsDirection(delta: number, expected: ExpectedMovement): boolean {
	if (expected === 'observe') { return true; }
	if (expected === 'preserve') { return false; }
	return expected === 'increase' ? delta > 0 : delta < 0;
}

function goalStatus(profile: AssessmentProfileSelection, outcome: ProfileOutcomeKind): ProfileGoalStatus {
	if (outcome === 'not-comparable') { return 'not-comparable'; }
	if (profile.direction === 'observe') { return outcome === 'unchanged' ? 'unchanged' : 'observed'; }
	if (outcome === 'aligned') { return 'achieved'; }
	if (outcome === 'opposed') { return 'not-achieved'; }
	if (outcome === 'mixed') { return 'partial'; }
	if (profile.direction === 'preserve') { return 'achieved'; }
	return 'unchanged';
}

export function classifyProfileOutcomes(
	profiles: readonly AssessmentProfileSelection[],
	metrics: readonly ProfileMetricComparison[],
	hasBaseline: boolean,
): ProfileOutcome[] {
	return profiles.map((profile) => {
		const profileMetrics = new Set(ASSESSMENT_PROFILES[profile.id]?.metrics ?? []);
		const comparable = hasBaseline
			? metrics.filter((metric) => profileMetrics.has(metric.id)
				&& metric.current !== undefined
				&& metric.previous !== undefined
				&& metric.delta !== undefined
				&& metric.meaningfulChange !== undefined)
			: [];
		const meaningful = comparable.filter((metric) => metric.meaningfulChange);
		const aligned: string[] = [];
		const opposed: string[] = [];
		for (const metric of meaningful) {
			const expected = expectedMovement(profile.id, profile.direction, metric.id);
			if (expected && followsDirection(metric.delta as number, expected)) { aligned.push(metric.id); }
			else { opposed.push(metric.id); }
		}

		let outcome: ProfileOutcomeKind;
		let reason: string;
		if (!hasBaseline || comparable.length === 0) {
			outcome = 'not-comparable';
			reason = hasBaseline
				? 'No primary profile metrics have comparable scalar values.'
				: 'No compatible baseline is available yet.';
		} else if (meaningful.length === 0) {
			outcome = 'unchanged';
			reason = `No meaningful change across ${comparable.length} comparable primary metric${comparable.length === 1 ? '' : 's'}.`;
		} else if (aligned.length === meaningful.length) {
			outcome = 'aligned';
			reason = `All ${meaningful.length} meaningful change${meaningful.length === 1 ? '' : 's'} follow the chosen direction.`;
		} else if (opposed.length === meaningful.length) {
			outcome = 'opposed';
			reason = `All ${meaningful.length} meaningful change${meaningful.length === 1 ? '' : 's'} move against the chosen direction.`;
		} else {
			outcome = 'mixed';
			reason = `${aligned.length} meaningful change${aligned.length === 1 ? '' : 's'} align and ${opposed.length} oppose the chosen direction.`;
		}

		return {
			id: profile.id,
			direction: profile.direction,
			outcome,
			goalStatus: goalStatus(profile, outcome),
			reason,
			comparableMetrics: comparable.map((metric) => metric.id),
			meaningfulMetrics: meaningful.map((metric) => metric.id),
			alignedMetrics: aligned,
			opposedMetrics: opposed,
		};
	});
}

export function summarizeProfileAssessment(outcomes: ProfileOutcome[]): ProfileAssessmentSummary {
	if (outcomes.length === 0 || outcomes.every((outcome) => outcome.goalStatus === 'not-comparable')) {
		return {
			status: 'not-comparable',
			title: 'Not enough comparison data',
			description: 'A compatible baseline with comparable profile metrics is required to evaluate the selected goals.',
			outcomes,
		};
	}
	const evaluated = outcomes.filter((outcome) => outcome.goalStatus !== 'not-comparable');
	const goalOutcomes = evaluated.filter((outcome) => outcome.direction !== 'observe');
	if (goalOutcomes.length === 0) {
		const changed = evaluated.some((outcome) => outcome.goalStatus === 'observed');
		return {
			status: changed ? 'observed' : 'unchanged',
			title: changed ? 'Changes observed' : 'No meaningful change observed',
			description: changed
				? 'The selected profile metrics changed meaningfully; review the profile and metric details below.'
				: 'The selected profile metrics remained within the materiality thresholds.',
			outcomes,
		};
	}
	if (goalOutcomes.every((outcome) => outcome.goalStatus === 'achieved')) {
		return {
			status: 'achieved',
			title: goalOutcomes.length === 1 ? 'Profile goal achieved' : 'Profile goals achieved',
			description: 'Every evaluated profile moved in its chosen direction or successfully preserved its state.',
			outcomes,
		};
	}
	if (goalOutcomes.every((outcome) => outcome.goalStatus === 'not-achieved' || outcome.goalStatus === 'unchanged')) {
		const opposed = goalOutcomes.some((outcome) => outcome.goalStatus === 'not-achieved');
		return {
			status: opposed ? 'not-achieved' : 'unchanged',
			title: opposed ? 'Profile goals not achieved' : 'No meaningful progress toward the goals',
			description: opposed
				? 'The meaningful changes moved against the selected profile directions.'
				: 'The profile metrics remained within the materiality thresholds.',
			outcomes,
		};
	}
	return {
		status: 'partial',
		title: 'Profile goals partially achieved',
		description: 'Some profile goals were achieved, while others were mixed, unchanged, or moved in the opposite direction.',
		outcomes,
	};
}

export function assessProfilesAgainstHistory(
	profiles: readonly AssessmentProfileSelection[],
	currentResults: readonly any[],
	historyMetrics: Readonly<Record<string, { results: unknown }>>,
	hasBaseline: boolean,
): ProfileAssessmentSummary {
	return summarizeProfileAssessment(classifyProfileOutcomes(
		profiles,
		buildProfileMetricComparisons(currentResults, historyMetrics),
		hasBaseline,
	));
}
