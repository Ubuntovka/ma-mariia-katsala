import * as assert from 'assert';
import {
	ASSESSMENT_PROFILES,
	SIDEBAR_ASSESSMENT_PROFILE_IDS,
	resolveCustomMetrics,
	resolveProfiles,
	resolveSidebarAssessmentSelection,
	resolveSidebarProfiles,
} from '../assessmentProfiles';

suite('Assessment profiles', () => {
	test('matches the seven CI/CD profiles, directions, and metric sets', () => {
		assert.deepStrictEqual(ASSESSMENT_PROFILES, {
			'general-review': {
				directions: ['observe'],
				metrics: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14'],
			},
			'visual-complexity': {
				directions: ['decrease', 'increase', 'preserve', 'observe'],
				metrics: ['m9', 'm10', 'm11', 'm12'],
			},
			'layout-density': {
				directions: ['more-spacious', 'more-compact', 'preserve', 'observe'],
				metrics: ['m5', 'm10', 'm6'],
			},
			'content-density': {
				directions: ['decrease', 'increase', 'preserve', 'observe'],
				metrics: ['m8', 'm5', 'm10'],
			},
			'colour-expression': {
				directions: ['more-vivid', 'more-restrained', 'preserve', 'observe'],
				metrics: ['m3', 'm4'],
			},
			'aesthetic-impression': {
				directions: ['increase', 'preserve', 'observe'],
				metrics: ['m14'],
			},
			accessibility: {
				directions: ['reduce-issues', 'preserve', 'observe'],
				metrics: ['m13'],
			},
		});
	});

	test('resolves several sidebar profiles to a unique ordered metric union', () => {
		assert.deepStrictEqual(SIDEBAR_ASSESSMENT_PROFILE_IDS, [
			'visual-complexity',
			'layout-density',
			'content-density',
			'colour-expression',
			'aesthetic-impression',
			'accessibility',
		]);
		assert.deepStrictEqual(resolveSidebarProfiles([
			{ id: 'visual-complexity', direction: 'decrease' },
			{ id: 'layout-density', direction: 'more-spacious' },
		], 'Selected profiles'), {
			profiles: [
				{ id: 'visual-complexity', direction: 'decrease' },
				{ id: 'layout-density', direction: 'more-spacious' },
			],
			metrics: ['m9', 'm10', 'm11', 'm12', 'm5', 'm6'],
		});
	});

	test('rejects missing profiles and directions not supported by CI/CD', () => {
		assert.throws(() => resolveProfiles([], 'Selected profiles'), /one or more profile selections/);
		assert.throws(
			() => resolveProfiles([{ id: 'accessibility', direction: 'increase' }], 'Selected profiles'),
			/direction for "accessibility" must be one of: reduce-issues, preserve, observe/,
		);
		assert.throws(
			() => resolveSidebarProfiles([{ id: 'general-review', direction: 'observe' }], 'Selected profiles'),
			/cannot select the general-review profile/,
		);
	});

	test('accepts any unique custom selection from m1 through m14', () => {
		assert.deepStrictEqual(resolveCustomMetrics(['m1', 'm7', 'm14'], 'Selected metrics'), ['m1', 'm7', 'm14']);
		assert.throws(() => resolveCustomMetrics([], 'Selected metrics'), /one or more metric IDs/);
		assert.throws(() => resolveCustomMetrics(['m15'], 'Selected metrics'), /IDs from m1 through m14/);
		assert.throws(() => resolveCustomMetrics(['m3', 'm3'], 'Selected metrics'), /duplicate metric IDs/);
	});

	test('isolates custom metrics from previously selected profiles', () => {
		assert.deepStrictEqual(resolveSidebarAssessmentSelection({
			selectionMode: 'custom',
			metrics: ['m1', 'm2', 'm14'],
			profiles: [{ id: 'accessibility', direction: 'reduce-issues' }],
		}), {
			metrics: ['m1', 'm2', 'm14'],
			assessment: { mode: 'custom' },
		});
	});

	test('isolates profiles from previously selected custom metrics', () => {
		assert.deepStrictEqual(resolveSidebarAssessmentSelection({
			selectionMode: 'profiles',
			metrics: ['m1', 'm2'],
			profiles: [{ id: 'accessibility', direction: 'observe' }],
		}), {
			metrics: ['m13'],
			assessment: {
				mode: 'profiles',
				profiles: [{ id: 'accessibility', direction: 'observe' }],
			},
		});
	});
});
