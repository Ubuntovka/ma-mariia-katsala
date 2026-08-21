export interface AssessmentProfileSelection {
  id: string;
  direction: string;
}

export interface AssessmentProfileDefinition {
  directions: readonly string[];
  metrics: readonly string[];
}

const GENERAL_REVIEW_METRICS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14'] as const;

export const ASSESSMENT_PROFILES: Readonly<Record<string, AssessmentProfileDefinition>> = {
  'general-review': { directions: ['observe'], metrics: GENERAL_REVIEW_METRICS },
  'visual-complexity': { directions: ['decrease', 'increase', 'preserve', 'observe'], metrics: ['m9', 'm10', 'm11', 'm12'] },
  'layout-density': { directions: ['more-spacious', 'more-compact', 'preserve', 'observe'], metrics: ['m5', 'm10', 'm6'] },
  'content-density': { directions: ['decrease', 'increase', 'preserve', 'observe'], metrics: ['m8', 'm5', 'm10'] },
  'colour-expression': { directions: ['more-vivid', 'more-restrained', 'preserve', 'observe'], metrics: ['m3', 'm4'] },
  'aesthetic-impression': { directions: ['increase', 'preserve', 'observe'], metrics: ['m14'] },
  accessibility: { directions: ['reduce-issues', 'preserve', 'observe'], metrics: ['m13'] },
};

export function resolveAssessmentProfiles(
  value: unknown,
  location = 'assessment.profiles',
): { profiles: AssessmentProfileSelection[]; metrics: string[] } {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${location} must contain one or more profile selections.`);
  }

  const profiles: AssessmentProfileSelection[] = [];
  const metrics = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`${location}[${index}] must contain a profile id and direction.`);
    }
    const { id, direction } = item as { id?: unknown; direction?: unknown };
    if (typeof id !== 'string' || !(id in ASSESSMENT_PROFILES)) {
      throw new Error(`${location}[${index}] has unknown profile id "${String(id)}".`);
    }
    const definition = ASSESSMENT_PROFILES[id];
    if (typeof direction !== 'string' || !definition?.directions.includes(direction)) {
      throw new Error(`${location}[${index}] direction for "${id}" must be one of: ${definition?.directions.join(', ')}.`);
    }
    if (profiles.some((profile) => profile.id === id)) {
      throw new Error(`${location} must not select profile "${id}" more than once.`);
    }
    profiles.push({ id, direction });
    definition.metrics.forEach((metric) => metrics.add(metric));
  }
  return { profiles, metrics: [...metrics] };
}
