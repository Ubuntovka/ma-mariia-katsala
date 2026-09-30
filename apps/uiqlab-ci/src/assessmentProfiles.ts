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

export const ASSESSMENT_PROFILES: Readonly<Record<string, AssessmentProfileDefinition>> = {
  'general-review': { displayName: 'General review', directions: ['observe'], metrics: GENERAL_REVIEW_METRICS },
  'visual-complexity': { displayName: 'Visual complexity', directions: ['reduce-complexity', 'increase-complexity', 'preserve', 'observe'], metrics: ['m9', 'm10', 'm11'] },
  'screen-whitespace': { displayName: 'Screen white space', directions: ['more-whitespace', 'less-whitespace', 'preserve', 'observe'], metrics: ['m5'] },
  'text-amount': { displayName: 'Text amount', directions: ['more-words', 'fewer-words', 'preserve', 'observe'], metrics: ['m8'] },
  colorfulness: { displayName: 'Colorfulness', directions: ['more-colorful', 'less-colorful', 'preserve', 'observe'], metrics: ['m3'] },
  accessibility: { displayName: 'Accessibility', directions: ['fewer-detected-violations', 'preserve', 'observe'], metrics: ['m13'] },
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
