import { ASSESSMENT_PROFILES, type AssessmentProfileSelection } from './assessmentProfiles.js';

export type QualityGateMode = 'report' | 'warn' | 'enforce';
export type ProfileOutcomeKind = 'aligned' | 'opposed' | 'mixed' | 'unchanged' | 'not-comparable';
export type GateStatus = 'pass' | 'warning' | 'fail';
export type ProfileGoalStatus = 'achieved' | 'not-achieved' | 'partial' | 'unchanged' | 'observed' | 'not-comparable';
export type ToleranceMovement = 'toward' | 'against' | 'none' | 'undirected';

export interface GateMetricComparison {
  id: string;
  current?: number;
  previous?: number;
  delta?: number;
  meaningfulChange?: boolean;
  relativeDeltaPercent?: number;
}

export interface WithinToleranceMetric {
  id: string;
  delta: number;
  relativeDeltaPercent?: number;
  movement: ToleranceMovement;
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
  withinToleranceMetrics: WithinToleranceMetric[];
}

export interface ProfileGoalSummary {
  status: ProfileGoalStatus;
  title: string;
  description: string;
}

export interface QualityGateResult {
  mode: QualityGateMode;
  status: GateStatus;
  reason: string;
  requireBaseline: boolean;
}

type ExpectedMovement = 'increase' | 'decrease' | 'preserve' | 'observe';

function expectedMovement(profileId: string, direction: string): ExpectedMovement | undefined {
  if (direction === 'observe') return 'observe';
  if (direction === 'preserve') return 'preserve';
  if (profileId === 'visual-complexity') return direction === 'reduce-complexity' ? 'decrease' : 'increase';
  if (profileId === 'screen-whitespace') return direction === 'more-whitespace' ? 'increase' : 'decrease';
  if (profileId === 'text-amount') return direction === 'more-words' ? 'increase' : 'decrease';
  if (profileId === 'colorfulness') return direction === 'more-colorful' ? 'increase' : 'decrease';
  if (profileId === 'accessibility') return 'decrease';
  return undefined;
}

function followsDirection(delta: number, expected: ExpectedMovement): boolean {
  if (expected === 'observe') return true;
  if (expected === 'preserve') return false;
  return expected === 'increase' ? delta > 0 : delta < 0;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function toleranceMovement(delta: number, expected: ExpectedMovement | undefined): ToleranceMovement {
  if (delta === 0) return 'none';
  if (expected !== 'increase' && expected !== 'decrease') return 'undirected';
  return followsDirection(delta, expected) ? 'toward' : 'against';
}

function toleranceNote(metrics: readonly WithinToleranceMetric[]): string {
  const toward = metrics.filter((metric) => metric.movement === 'toward').length;
  const against = metrics.filter((metric) => metric.movement === 'against').length;
  const undirected = metrics.filter((metric) => metric.movement === 'undirected').length;
  const parts = [
    ...(toward > 0 ? [`${plural(toward, 'metric')} changed toward the goal`] : []),
    ...(against > 0 ? [`${plural(against, 'metric')} changed against the goal`] : []),
    ...(undirected > 0 ? [`${plural(undirected, 'metric')} changed`] : []),
  ];
  return parts.length === 0 ? '' : ` ${parts.join(', ')}, but not significantly.`;
}

// Keep in sync with goalStatus in apps/uiqlab-assessment/src/profileAssessment.ts.
function goalStatus(direction: string, outcome: ProfileOutcomeKind): ProfileGoalStatus {
  if (outcome === 'not-comparable') return 'not-comparable';
  if (direction === 'observe') return outcome === 'unchanged' ? 'unchanged' : 'observed';
  if (outcome === 'aligned') return 'achieved';
  if (outcome === 'opposed') return 'not-achieved';
  if (outcome === 'mixed') return 'partial';
  if (direction === 'preserve') return 'achieved';
  return 'unchanged';
}

export function classifyProfiles(
  profiles: readonly AssessmentProfileSelection[],
  metrics: readonly GateMetricComparison[],
  hasBaseline: boolean,
): ProfileOutcome[] {
  return profiles.map((profile) => {
    const definition = ASSESSMENT_PROFILES[profile.id];
    const profileMetrics = new Set(definition?.metrics ?? []);
    const expected = expectedMovement(profile.id, profile.direction);
    const comparable = hasBaseline
      ? metrics.filter((metric) => profileMetrics.has(metric.id) && metric.current !== undefined && metric.previous !== undefined && metric.delta !== undefined && metric.meaningfulChange !== undefined)
      : [];
    const meaningful = comparable.filter((metric) => metric.meaningfulChange);
    const aligned: string[] = [];
    const opposed: string[] = [];
    for (const metric of meaningful) {
      if (expected && followsDirection(metric.delta as number, expected)) aligned.push(metric.id);
      else opposed.push(metric.id);
    }
    const withinTolerance = comparable
      .filter((metric) => !metric.meaningfulChange)
      .map((metric): WithinToleranceMetric => ({
        id: metric.id,
        delta: metric.delta as number,
        ...(metric.relativeDeltaPercent !== undefined ? { relativeDeltaPercent: metric.relativeDeltaPercent } : {}),
        movement: toleranceMovement(metric.delta as number, expected),
      }));

    let outcome: ProfileOutcomeKind;
    let reason: string;
    const ofComparable = `${meaningful.length} of ${plural(comparable.length, 'comparable primary metric')}`;
    if (!hasBaseline || comparable.length === 0) {
      outcome = 'not-comparable';
      reason = hasBaseline ? 'No primary profile metrics have comparable scalar values.' : 'No compatible baseline is available; this run establishes the baseline.';
    } else if (meaningful.length === 0) {
      outcome = 'unchanged';
      reason = `No meaningful change across ${plural(comparable.length, 'comparable primary metric')}.`;
    } else if (aligned.length === meaningful.length) {
      outcome = 'aligned';
      reason = expected === 'observe'
        ? `${ofComparable} changed meaningfully.`
        : `${ofComparable} changed meaningfully, all in the expected direction.`;
    } else if (opposed.length === meaningful.length) {
      outcome = 'opposed';
      reason = `${ofComparable} changed meaningfully, all against the expected direction.`;
    } else {
      outcome = 'mixed';
      reason = `${ofComparable} changed meaningfully: ${aligned.length} in the expected direction and ${opposed.length} against it.`;
    }
    if (outcome !== 'not-comparable') reason += toleranceNote(withinTolerance);
    return {
      id: profile.id,
      direction: profile.direction,
      outcome,
      goalStatus: goalStatus(profile.direction, outcome),
      reason,
      comparableMetrics: comparable.map((metric) => metric.id),
      meaningfulMetrics: meaningful.map((metric) => metric.id),
      alignedMetrics: aligned,
      opposedMetrics: opposed,
      withinToleranceMetrics: withinTolerance,
    };
  });
}

// Mirrors the status rules of summarizeProfileAssessment in apps/uiqlab-assessment/src/profileAssessment.ts.
export function summarizeProfileGoals(outcomes: readonly ProfileOutcome[]): ProfileGoalSummary {
  if (outcomes.length === 0 || outcomes.every((outcome) => outcome.goalStatus === 'not-comparable')) {
    return {
      status: 'not-comparable',
      title: 'Not enough comparison data',
      description: 'A compatible baseline with comparable profile metrics is required to evaluate the selected goals.',
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
        ? 'The selected profile metrics changed meaningfully; review the profile and metric details.'
        : 'None of the selected profile metrics changed significantly.',
    };
  }
  if (goalOutcomes.every((outcome) => outcome.goalStatus === 'achieved')) {
    return {
      status: 'achieved',
      title: goalOutcomes.length === 1 ? 'Profile goal achieved' : 'Profile goals achieved',
      description: 'Every evaluated profile moved in its chosen direction or successfully preserved its state.',
    };
  }
  if (goalOutcomes.every((outcome) => outcome.goalStatus === 'not-achieved' || outcome.goalStatus === 'unchanged')) {
    const opposed = goalOutcomes.some((outcome) => outcome.goalStatus === 'not-achieved');
    return {
      status: opposed ? 'not-achieved' : 'unchanged',
      title: opposed ? 'Profile goals not achieved' : 'No meaningful progress toward the goals',
      description: opposed
        ? 'The meaningful changes moved against the selected profile directions.'
        : 'None of the profile metrics changed significantly. The quality gate checks for movement against the goals, so unchanged profiles do not warn or fail.',
    };
  }
  return {
    status: 'partial',
    title: 'Profile goals partially achieved',
    description: 'Some profile goals were achieved, while others were mixed, unchanged, or moved in the opposite direction.',
  };
}

export function evaluateQualityGate(
  mode: QualityGateMode,
  outcomes: readonly ProfileOutcome[],
  options: { requireBaseline?: boolean; hasBaseline?: boolean } = {},
): QualityGateResult {
  const requireBaseline = options.requireBaseline ?? false;
  if (requireBaseline && !options.hasBaseline) {
    return {
      mode,
      status: 'fail',
      reason: 'A compatible baseline is required, but none is available.',
      requireBaseline,
    };
  }
  const opposed = outcomes.filter((profile) => profile.outcome === 'opposed').length;
  const mixed = outcomes.filter((profile) => profile.outcome === 'mixed').length;
  if (mode === 'enforce' && opposed > 0) {
    return { mode, status: 'fail', reason: `${opposed} profile${opposed === 1 ? '' : 's'} opposed the configured direction.`, requireBaseline };
  }
  if (mode !== 'report' && (opposed > 0 || mixed > 0)) {
    return { mode, status: 'warning', reason: `${opposed} opposed and ${mixed} mixed profile outcome${opposed + mixed === 1 ? '' : 's'}.`, requireBaseline };
  }
  return { mode, status: 'pass', reason: outcomes.length === 0 ? 'No assessment profiles are configured.' : 'No profile outcome triggers this quality-gate mode.', requireBaseline };
}

export function qualityGateExitCode(
  gate: Pick<QualityGateResult, 'status'>,
  warningExitCode: 0 | 2 = 2,
): 0 | 1 | 2 {
  if (gate.status === 'fail') return 1;
  if (gate.status === 'warning') return warningExitCode;
  return 0;
}
