import { ASSESSMENT_PROFILES, type AssessmentProfileSelection } from './assessmentProfiles.js';

export type QualityGateMode = 'report' | 'warn' | 'enforce';
export type ProfileOutcomeKind = 'aligned' | 'opposed' | 'mixed' | 'unchanged' | 'not-comparable';
export type GateStatus = 'pass' | 'warning' | 'fail';

export interface GateMetricComparison {
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
  reason: string;
  comparableMetrics: string[];
  meaningfulMetrics: string[];
  alignedMetrics: string[];
  opposedMetrics: string[];
}

export interface QualityGateResult {
  mode: QualityGateMode;
  status: GateStatus;
  reason: string;
}

type ExpectedMovement = 'increase' | 'decrease' | 'preserve' | 'observe';

function expectedMovement(profileId: string, direction: string, metricId: string): ExpectedMovement | undefined {
  if (direction === 'observe') return 'observe';
  if (direction === 'preserve') return 'preserve';
  if (profileId === 'layout-density') {
    if (metricId === 'm5') return direction === 'more-spacious' ? 'increase' : 'decrease';
    if (metricId === 'm10') return direction === 'more-spacious' ? 'decrease' : 'increase';
    return undefined;
  }
  if (profileId === 'content-density') {
    if (metricId === 'm5') return direction === 'decrease' ? 'increase' : 'decrease';
    return direction === 'decrease' ? 'decrease' : 'increase';
  }
  if (profileId === 'colour-expression') return direction === 'more-vivid' ? 'increase' : 'decrease';
  if (profileId === 'accessibility') return 'decrease';
  if (direction === 'decrease') return 'decrease';
  if (direction === 'increase') return 'increase';
  return undefined;
}

function followsDirection(delta: number, expected: ExpectedMovement): boolean {
  if (expected === 'observe') return true;
  if (expected === 'preserve') return false;
  return expected === 'increase' ? delta > 0 : delta < 0;
}

export function classifyProfiles(
  profiles: readonly AssessmentProfileSelection[],
  metrics: readonly GateMetricComparison[],
  hasBaseline: boolean,
): ProfileOutcome[] {
  return profiles.map((profile) => {
    const definition = ASSESSMENT_PROFILES[profile.id];
    const profileMetrics = new Set(definition?.metrics ?? []);
    const comparable = hasBaseline
      ? metrics.filter((metric) => profileMetrics.has(metric.id) && metric.current !== undefined && metric.previous !== undefined && metric.delta !== undefined && metric.meaningfulChange !== undefined)
      : [];
    const meaningful = comparable.filter((metric) => metric.meaningfulChange);
    const aligned: string[] = [];
    const opposed: string[] = [];
    for (const metric of meaningful) {
      const expected = expectedMovement(profile.id, profile.direction, metric.id);
      if (expected && followsDirection(metric.delta as number, expected)) aligned.push(metric.id);
      else opposed.push(metric.id);
    }

    let outcome: ProfileOutcomeKind;
    let reason: string;
    if (!hasBaseline || comparable.length === 0) {
      outcome = 'not-comparable';
      reason = hasBaseline ? 'No primary profile metrics have comparable scalar values.' : 'No compatible baseline is available; this run establishes the baseline.';
    } else if (meaningful.length === 0) {
      outcome = 'unchanged';
      reason = `No meaningful change across ${comparable.length} comparable primary metric${comparable.length === 1 ? '' : 's'}.`;
    } else if (aligned.length === meaningful.length) {
      outcome = 'aligned';
      reason = `All ${meaningful.length} meaningfully changed primary metric${meaningful.length === 1 ? '' : 's'} follow the expected direction.`;
    } else if (opposed.length === meaningful.length) {
      outcome = 'opposed';
      reason = `All ${meaningful.length} meaningfully changed primary metric${meaningful.length === 1 ? '' : 's'} move against the expected direction.`;
    } else {
      outcome = 'mixed';
      reason = `${aligned.length} meaningfully changed primary metric${aligned.length === 1 ? '' : 's'} align and ${opposed.length} oppose the expected direction.`;
    }
    return {
      id: profile.id,
      direction: profile.direction,
      outcome,
      reason,
      comparableMetrics: comparable.map((metric) => metric.id),
      meaningfulMetrics: meaningful.map((metric) => metric.id),
      alignedMetrics: aligned,
      opposedMetrics: opposed,
    };
  });
}

export function evaluateQualityGate(mode: QualityGateMode, outcomes: readonly ProfileOutcome[]): QualityGateResult {
  const opposed = outcomes.filter((profile) => profile.outcome === 'opposed').length;
  const mixed = outcomes.filter((profile) => profile.outcome === 'mixed').length;
  if (mode === 'enforce' && opposed > 0) {
    return { mode, status: 'fail', reason: `${opposed} profile${opposed === 1 ? '' : 's'} opposed the configured direction.` };
  }
  if (mode !== 'report' && (opposed > 0 || mixed > 0)) {
    return { mode, status: 'warning', reason: `${opposed} opposed and ${mixed} mixed profile outcome${opposed + mixed === 1 ? '' : 's'}.` };
  }
  return { mode, status: 'pass', reason: outcomes.length === 0 ? 'No assessment profiles are configured.' : 'No profile outcome triggers this quality-gate mode.' };
}

export function qualityGateExitCode(gate: QualityGateResult): 0 | 1 | 2 {
  if (gate.status === 'fail') return 1;
  if (gate.status === 'warning') return 2;
  return 0;
}
