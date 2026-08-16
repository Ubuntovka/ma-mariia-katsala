export interface AssessmentProfileSelection {
	id: string;
	direction: string;
}

const PROFILES: Readonly<Record<string, { directions: readonly string[]; metrics: readonly string[] }>> = {
	'general-review': { directions: ['observe'], metrics: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14'] },
	'visual-complexity': { directions: ['decrease', 'increase', 'preserve', 'observe'], metrics: ['m9', 'm10', 'm11', 'm12'] },
	'layout-density': { directions: ['more-spacious', 'more-compact', 'preserve', 'observe'], metrics: ['m5', 'm10', 'm6'] },
	'content-density': { directions: ['decrease', 'increase', 'preserve', 'observe'], metrics: ['m8', 'm5', 'm10'] },
	'colour-expression': { directions: ['more-vivid', 'more-restrained', 'preserve', 'observe'], metrics: ['m3', 'm4'] },
	'aesthetic-impression': { directions: ['increase', 'preserve', 'observe'], metrics: ['m14'] },
	accessibility: { directions: ['reduce-issues', 'preserve', 'observe'], metrics: ['m13'] },
};

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
		const definition = typeof id === 'string' ? PROFILES[id] : undefined;
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
