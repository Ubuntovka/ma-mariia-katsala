export interface AssessmentProfileSelection {
	id: string;
	direction: string;
}

export interface AssessmentProfileDefinition {
	displayName: string;
	directions: readonly string[];
	metrics: readonly string[];
}

const GENERAL_REVIEW_METRICS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14'] as const;

// Keep this catalog identical to apps/uiqlab-ci/src/assessmentProfiles.ts.
// Profile IDs and direction values are persisted as assessment metadata, so
// the sidebar uses these stable values directly rather than defining UI-only
// variants.
export const ASSESSMENT_PROFILES: Readonly<Record<string, AssessmentProfileDefinition>> = {
	'general-review': { displayName: 'General review', directions: ['observe'], metrics: GENERAL_REVIEW_METRICS },
	'visual-clutter': { displayName: 'Visual clutter', directions: ['less-cluttered', 'more-cluttered', 'preserve', 'observe'], metrics: ['m9', 'm10', 'm11'] },
	'screen-whitespace': { displayName: 'Screen white space', directions: ['more-whitespace', 'less-whitespace', 'preserve', 'observe'], metrics: ['m5'] },
	'text-amount': { displayName: 'Text amount', directions: ['more-words', 'fewer-words', 'preserve', 'observe'], metrics: ['m8'] },
	colorfulness: { displayName: 'Colorfulness', directions: ['more-colorful', 'less-colorful', 'preserve', 'observe'], metrics: ['m3'] },
	'image-aesthetic-score': { displayName: 'Image aesthetic score', directions: ['observe'], metrics: ['m14'] },
	accessibility: { displayName: 'Accessibility', directions: ['fewer-detected-violations', 'preserve', 'observe'], metrics: ['m13'] },
};

export const SIDEBAR_ASSESSMENT_PROFILE_IDS = Object.freeze(
	Object.keys(ASSESSMENT_PROFILES).filter((id) => id !== 'general-review'),
);

export function resolveProfiles(value: unknown, location: string): { profiles: AssessmentProfileSelection[]; metrics: string[] } {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${location} must contain one or more profile selections.`);
	}
	const profiles: AssessmentProfileSelection[] = [];
	const metrics = new Set<string>();
	value.forEach((item, index) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new Error(`${location}[${index}] must contain a profile id and direction.`);
		}
		const { id, direction } = item as { id?: unknown; direction?: unknown };
		const definition = typeof id === 'string' ? ASSESSMENT_PROFILES[id] : undefined;
		if (!definition) {
			throw new Error(`${location}[${index}] has unknown profile id "${String(id)}".`);
		}
		if (typeof direction !== 'string' || !definition.directions.includes(direction)) {
			throw new Error(`${location}[${index}] direction for "${id}" must be one of: ${definition.directions.join(', ')}.`);
		}
		if (profiles.some((profile) => profile.id === id)) {
			throw new Error(`${location} must not select profile "${id}" more than once.`);
		}
		profiles.push({ id: id as string, direction });
		definition.metrics.forEach((metric) => metrics.add(metric));
	});
	return { profiles, metrics: [...metrics] };
}

export function resolveSidebarProfiles(value: unknown, location: string): { profiles: AssessmentProfileSelection[]; metrics: string[] } {
	const resolved = resolveProfiles(value, location);
	if (resolved.profiles.some((profile) => !SIDEBAR_ASSESSMENT_PROFILE_IDS.includes(profile.id))) {
		throw new Error(`${location} cannot select the general-review profile. Choose specific profiles or custom metrics.`);
	}
	return resolved;
}

export function resolveCustomMetrics(value: unknown, location: string): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${location} must contain one or more metric IDs.`);
	}
	if (!value.every((metric): metric is string => typeof metric === 'string' && /^m(?:[1-9]|1[0-4])$/.test(metric))) {
		throw new Error(`${location} must contain IDs from m1 through m14.`);
	}
	if (new Set(value).size !== value.length) {
		throw new Error(`${location} must not contain duplicate metric IDs.`);
	}
	return [...value];
}

export function resolveSidebarAssessmentSelection(
	value: { selectionMode?: unknown; profiles?: unknown; metrics?: unknown },
): {
	metrics: string[];
	assessment: { mode: 'custom' } | { mode: 'profiles'; profiles: AssessmentProfileSelection[] };
} {
	if (value.selectionMode === 'custom') {
		return {
			metrics: resolveCustomMetrics(value.metrics, 'Selected metrics'),
			assessment: { mode: 'custom' },
		};
	}
	if (value.selectionMode === 'profiles') {
		const resolved = resolveSidebarProfiles(value.profiles, 'Selected profiles');
		return {
			metrics: resolved.metrics,
			assessment: { mode: 'profiles', profiles: resolved.profiles },
		};
	}
	throw new Error('Choose profiles or custom metrics.');
}
