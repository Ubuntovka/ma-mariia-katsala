import * as assert from 'assert';
import {
	assessProfilesAgainstHistory,
	buildProfileMetricComparisons,
	classifyProfileOutcomes,
	normalizeProfileAssessmentSelection,
	primaryProfileMetricValue,
	summarizeProfileAssessment,
} from '../profileAssessment';

suite('Profile history assessment', () => {
	test('normalizes serialized profile metadata returned by history APIs', () => {
		assert.deepStrictEqual(normalizeProfileAssessmentSelection(
			'{"mode":"profiles","profiles":[{"id":"accessibility","direction":"reduce-issues"}]}',
		), [{ id: 'accessibility', direction: 'reduce-issues' }]);
		assert.deepStrictEqual(normalizeProfileAssessmentSelection({
			mode: 'profiles',
			profiles: [{ id: 'visual-complexity', direction: 'decrease' }],
		}), [{ id: 'visual-complexity', direction: 'decrease' }]);
		assert.strictEqual(normalizeProfileAssessmentSelection({ mode: 'custom' }), undefined);
		assert.strictEqual(normalizeProfileAssessmentSelection('invalid JSON'), undefined);
	});

	test('extracts the same primary scalar values used by CI/CD', () => {
		assert.strictEqual(primaryProfileMetricValue('m3', [{ colorfulness: 42 }]), 42);
		assert.strictEqual(primaryProfileMetricValue('m10', [{ featureCongestion: 3.5 }]), 3.5);
		assert.strictEqual(primaryProfileMetricValue('m14', [{ mean: 7.25, standardDeviation: 1.2 }]), 7.25);
		assert.strictEqual(primaryProfileMetricValue('m13', [{ violations: [
			{ id: 'color-contrast', nodes: [{}, {}] },
			{ id: 'label', nodes: [{}] },
		] }]), 3);
	});

	test('uses materiality thresholds before evaluating a direction', () => {
		const comparisons = buildProfileMetricComparisons(
			[{ metric_id: 'm9', results: [0.31] }],
			{ m9: { results: [0.30] } },
		);
		assert.strictEqual(comparisons[0]?.meaningfulChange, false);
		const outcomes = classifyProfileOutcomes(
			[{ id: 'visual-complexity', direction: 'decrease' }],
			comparisons,
			true,
		);
		assert.strictEqual(outcomes[0]?.outcome, 'unchanged');
		assert.strictEqual(outcomes[0]?.goalStatus, 'unchanged');
	});

	test('marks a visual-complexity decrease as achieved when metrics decrease', () => {
		const summary = assessProfilesAgainstHistory(
			[{ id: 'visual-complexity', direction: 'decrease' }],
			[
				{ metric_id: 'm9', results: [0.20] },
				{ metric_id: 'm10', results: [2.0] },
				{ metric_id: 'm11', results: [4.5] },
				{ metric_id: 'm12', results: [5.0] },
			],
			{
				m9: { results: [0.30] },
				m10: { results: [3.0] },
				m11: { results: [5.0] },
				m12: { results: [5.5] },
			},
			true,
		);
		assert.strictEqual(summary.status, 'achieved');
		assert.strictEqual(summary.title, 'Profile goal achieved');
		assert.deepStrictEqual(summary.outcomes[0]?.alignedMetrics, ['m9', 'm10', 'm11', 'm12']);
	});

	test('evaluates inverse metric movement for a more-spacious layout', () => {
		const outcomes = classifyProfileOutcomes(
			[{ id: 'layout-density', direction: 'more-spacious' }],
			[
				{ id: 'm5', current: 0.40, previous: 0.30, delta: 0.10, meaningfulChange: true },
				{ id: 'm10', current: 2, previous: 3, delta: -1, meaningfulChange: true },
			],
			true,
		);
		assert.strictEqual(outcomes[0]?.goalStatus, 'achieved');
		assert.deepStrictEqual(outcomes[0]?.alignedMetrics, ['m5', 'm10']);
	});

	test('distinguishes opposed, mixed, preserve, and observe outcomes', () => {
		const opposed = classifyProfileOutcomes(
			[{ id: 'accessibility', direction: 'reduce-issues' }],
			[{ id: 'm13', current: 5, previous: 2, delta: 3, meaningfulChange: true }],
			true,
		);
		assert.strictEqual(opposed[0]?.goalStatus, 'not-achieved');

		const mixed = classifyProfileOutcomes(
			[{ id: 'visual-complexity', direction: 'decrease' }],
			[
				{ id: 'm9', current: 1, previous: 2, delta: -1, meaningfulChange: true },
				{ id: 'm10', current: 3, previous: 2, delta: 1, meaningfulChange: true },
			],
			true,
		);
		assert.strictEqual(mixed[0]?.goalStatus, 'partial');

		const preserved = classifyProfileOutcomes(
			[{ id: 'aesthetic-impression', direction: 'preserve' }],
			[{ id: 'm14', current: 7.1, previous: 7, delta: 0.1, meaningfulChange: false }],
			true,
		);
		assert.strictEqual(preserved[0]?.goalStatus, 'achieved');

		const observed = classifyProfileOutcomes(
			[{ id: 'aesthetic-impression', direction: 'observe' }],
			[{ id: 'm14', current: 8, previous: 7, delta: 1, meaningfulChange: true }],
			true,
		);
		assert.strictEqual(observed[0]?.goalStatus, 'observed');
	});

	test('produces an overall partial result for a combination of profile outcomes', () => {
		const summary = summarizeProfileAssessment([
			{
				id: 'accessibility', direction: 'reduce-issues', outcome: 'aligned', goalStatus: 'achieved', reason: 'aligned',
				comparableMetrics: ['m13'], meaningfulMetrics: ['m13'], alignedMetrics: ['m13'], opposedMetrics: [],
			},
			{
				id: 'aesthetic-impression', direction: 'increase', outcome: 'opposed', goalStatus: 'not-achieved', reason: 'opposed',
				comparableMetrics: ['m14'], meaningfulMetrics: ['m14'], alignedMetrics: [], opposedMetrics: ['m14'],
			},
		]);
		assert.strictEqual(summary.status, 'partial');
		assert.strictEqual(summary.title, 'Profile goals partially achieved');
	});
});
