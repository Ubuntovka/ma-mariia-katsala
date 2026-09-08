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
			'{"mode":"profiles","profiles":[{"id":"accessibility","direction":"fewer-detected-violations"}]}',
		), [{ id: 'accessibility', direction: 'fewer-detected-violations' }]);
		assert.deepStrictEqual(normalizeProfileAssessmentSelection({
			mode: 'profiles',
			profiles: [{ id: 'visual-clutter', direction: 'less-cluttered' }],
		}), [{ id: 'visual-clutter', direction: 'less-cluttered' }]);
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
			[{ id: 'visual-clutter', direction: 'less-cluttered' }],
			comparisons,
			true,
		);
		assert.strictEqual(outcomes[0]?.outcome, 'unchanged');
		assert.strictEqual(outcomes[0]?.goalStatus, 'unchanged');
	});

	test('marks less visual clutter as achieved when its three metrics decrease', () => {
		const summary = assessProfilesAgainstHistory(
			[{ id: 'visual-clutter', direction: 'less-cluttered' }],
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
		assert.deepStrictEqual(summary.outcomes[0]?.alignedMetrics, ['m9', 'm10', 'm11']);
		assert.deepStrictEqual(summary.outcomes[0]?.comparableMetrics, ['m9', 'm10', 'm11']);
	});

	test('evaluates screen white space using only M5', () => {
		const outcomes = classifyProfileOutcomes(
			[{ id: 'screen-whitespace', direction: 'more-whitespace' }],
			[
				{ id: 'm5', current: 0.40, previous: 0.30, delta: 0.10, meaningfulChange: true },
				{ id: 'm10', current: 2, previous: 3, delta: -1, meaningfulChange: true },
			],
			true,
		);
		assert.strictEqual(outcomes[0]?.goalStatus, 'achieved');
		assert.deepStrictEqual(outcomes[0]?.alignedMetrics, ['m5']);
		assert.deepStrictEqual(outcomes[0]?.comparableMetrics, ['m5']);
	});

	test('applies every requested directional movement', () => {
		const cases = [
			{ profile: { id: 'visual-clutter', direction: 'more-cluttered' }, metric: 'm9', delta: 1 },
			{ profile: { id: 'screen-whitespace', direction: 'less-whitespace' }, metric: 'm5', delta: -1 },
			{ profile: { id: 'text-amount', direction: 'more-words' }, metric: 'm8', delta: 1 },
			{ profile: { id: 'text-amount', direction: 'fewer-words' }, metric: 'm8', delta: -1 },
			{ profile: { id: 'colorfulness', direction: 'more-colorful' }, metric: 'm3', delta: 1 },
			{ profile: { id: 'colorfulness', direction: 'less-colorful' }, metric: 'm3', delta: -1 },
		];
		for (const { profile, metric, delta } of cases) {
			const outcome = classifyProfileOutcomes(
				[profile],
				[{ id: metric, current: 10 + delta, previous: 10, delta, meaningfulChange: true }],
				true,
			)[0];
			assert.strictEqual(outcome?.outcome, 'aligned', `${profile.id} (${profile.direction})`);
		}
	});

	test('distinguishes opposed, mixed, preserve, and observe outcomes', () => {
		const opposed = classifyProfileOutcomes(
			[{ id: 'accessibility', direction: 'fewer-detected-violations' }],
			[{ id: 'm13', current: 5, previous: 2, delta: 3, meaningfulChange: true }],
			true,
		);
		assert.strictEqual(opposed[0]?.goalStatus, 'not-achieved');

		const mixed = classifyProfileOutcomes(
			[{ id: 'visual-clutter', direction: 'less-cluttered' }],
			[
				{ id: 'm9', current: 1, previous: 2, delta: -1, meaningfulChange: true },
				{ id: 'm10', current: 3, previous: 2, delta: 1, meaningfulChange: true },
			],
			true,
		);
		assert.strictEqual(mixed[0]?.goalStatus, 'partial');

		const preserved = classifyProfileOutcomes(
			[{ id: 'colorfulness', direction: 'preserve' }],
			[{ id: 'm3', current: 42.1, previous: 42, delta: 0.1, meaningfulChange: false }],
			true,
		);
		assert.strictEqual(preserved[0]?.goalStatus, 'achieved');

		const observed = classifyProfileOutcomes(
			[{ id: 'general-review', direction: 'observe' }],
			[{ id: 'm14', current: 8, previous: 7, delta: 1, meaningfulChange: true }],
			true,
		);
		assert.strictEqual(observed[0]?.goalStatus, 'observed');
	});

	test('produces an overall partial result for a combination of profile outcomes', () => {
		const summary = summarizeProfileAssessment([
			{
				id: 'accessibility', direction: 'fewer-detected-violations', outcome: 'aligned', goalStatus: 'achieved', reason: 'aligned',
				comparableMetrics: ['m13'], meaningfulMetrics: ['m13'], alignedMetrics: ['m13'], opposedMetrics: [],
			},
			{
				id: 'colorfulness', direction: 'more-colorful', outcome: 'opposed', goalStatus: 'not-achieved', reason: 'opposed',
				comparableMetrics: ['m3'], meaningfulMetrics: ['m3'], alignedMetrics: [], opposedMetrics: ['m3'],
			},
		]);
		assert.strictEqual(summary.status, 'partial');
		assert.strictEqual(summary.title, 'Profile goals partially achieved');
	});
});
