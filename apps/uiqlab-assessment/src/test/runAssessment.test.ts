import * as assert from 'assert';
import {
	ASSESSMENTS,
	DATA_SOURCE_OPTIONS,
	collectAssessmentRunRequest,
	createDirectComparisonHistory,
	formatAssessmentRunSummary,
	isAssessmentMetricResult,
	normalizeAvailableMetricItems,
	normalizeServiceBaseUrl,
	pollEvaluationResult,
	type QuickPickUi,
} from '../runAssessment';
import { getMetricDefinition, METRIC_DEFINITIONS } from '../metricCatalog';
import { formatAssessmentRunLabel } from '../sidebarFormatting';

suite('Run assessment requests', () => {
	test('exposes all assessment names and data source options', () => {
		assert.strictEqual(ASSESSMENTS.length, 14);
		assert.deepStrictEqual(DATA_SOURCE_OPTIONS, ['Deployment URL', 'Local URL']);
	});

	test('normalizes configured service URLs and rejects incomplete URLs', () => {
		assert.strictEqual(
			normalizeServiceBaseUrl(' https://orchestrator.example/// '),
			'https://orchestrator.example',
		);
		assert.throws(() => normalizeServiceBaseUrl('orchestrator.example'), /http:\/\/ or https:\/\//);
		assert.throws(() => normalizeServiceBaseUrl('ftp://orchestrator.example'), /http:\/\/ or https:\/\//);
	});

	test('allows result requests to wait beyond the former 100 ms timeout', async () => {
		let suppliedRequestTimeout = 0;
		const results = await pollEvaluationResult('result-1', 2, {
			timeoutMs: 5_000,
			intervalMs: 0,
			fetchResult: async (_resultId, requestTimeoutMs) => {
				suppliedRequestTimeout = requestTimeoutMs;
				return [
					{ metric_id: 'm1_png_file_size', results: [100] },
					{ metric_id: 'm2_jpeg_file_size', results: [80] },
				];
			},
		});

		assert.strictEqual(results.length, 2);
		assert.ok(suppliedRequestTimeout > 100);
	});

	test('caps each result request at the remaining overall polling deadline', async () => {
		const requestedTimeouts: number[] = [];
		await pollEvaluationResult('result-2', 1, {
			timeoutMs: 25,
			requestTimeoutMs: 130_000,
			intervalMs: 0,
			maxAttempts: 1,
			fetchResult: async (_resultId, requestTimeoutMs) => {
				requestedTimeouts.push(requestTimeoutMs);
				return [];
			},
		});

		assert.strictEqual(requestedTimeouts.length, 1);
		assert.ok(requestedTimeouts[0] > 0 && requestedTimeouts[0] <= 25);
	});

	test('rejects malformed metric results at the API boundary', async () => {
		assert.strictEqual(isAssessmentMetricResult({ metric_id: 'm1', results: [100] }), true);
		assert.strictEqual(isAssessmentMetricResult({ metric_id: 1, results: [100] }), false);
		assert.strictEqual(isAssessmentMetricResult({ metric_id: 'm1' }), false);

		const results = await pollEvaluationResult('malformed-result', 1, {
			maxAttempts: 1,
			intervalMs: 0,
			fetchResult: async () => [{ metric_id: 1, results: [] }],
		});
		assert.deepStrictEqual(results, []);
	});

	test('reports transient polling errors before retrying', async () => {
		const errors: unknown[] = [];
		await pollEvaluationResult('temporary-failure', 1, {
			maxAttempts: 1,
			intervalMs: 0,
			fetchResult: async () => { throw new Error('temporary network failure'); },
			onError: (error) => errors.push(error),
		});
		assert.strictEqual(errors.length, 1);
		assert.match(String(errors[0]), /temporary network failure/);
	});

	test('provides an explanation for every assessment metric', () => {
		assert.strictEqual(METRIC_DEFINITIONS.length, ASSESSMENTS.length);
		for (const assessment of ASSESSMENTS) {
			const metric = getMetricDefinition(assessment);
			assert.ok(metric, `Missing metric definition for ${assessment}`);
			assert.ok(metric.description.length > 40, `Description for ${assessment} is too short`);
			assert.strictEqual(getMetricDefinition(metric.id), metric);
		}
	});

	test('uses catalog names for backend metrics so sidebar definitions resolve by ID', () => {
		const metrics = normalizeAvailableMetricItems([
			{ id: 'm2', name: 'JPEG file size and compression ratio (80)' },
			{ id: 'm3', name: 'Colorfulness (Hassler & Süsstrunk)' },
			{ id: 'm4', name: 'CIELAB color average and standard deviation' },
		]);

		assert.deepStrictEqual(metrics.map((metric) => metric.name), [
			'JPEG file size and compression ratio',
			'Colorfulness',
			'CIELab color average & standard deviation',
		]);
		for (const metric of metrics) {
			assert.ok(getMetricDefinition(metric.name), `Missing sidebar definition for ${metric.id}`);
		}
	});

	test('collects deployment-url requests', async () => {
		const ui = createUiMock([
			['PNG file size', 'Accessibility checks'],
			'Deployment URL',
			'https://example.com',
		]);

		const request = await collectAssessmentRunRequest(ui);

		assert.deepStrictEqual(request, {
			assessments: ['PNG file size', 'Accessibility checks'],
			dataSource: {
				kind: 'deployment-url',
				deploymentUrl: 'https://example.com',
			},
		});
	});

	test('collects local-url requests', async () => {
		const ui = createUiMock([
			['White space proportion'],
			'Local URL',
			'http://localhost:3000',
		]);

		const request = await collectAssessmentRunRequest(ui);

		assert.deepStrictEqual(request, {
			assessments: ['White space proportion'],
			dataSource: {
				kind: 'local-url',
				localUrl: 'http://localhost:3000',
			},
		});
	});

	test('formats a readable summary', () => {
		assert.strictEqual(
			formatAssessmentRunSummary({
				assessments: ['NIMA', 'accessibility'],
				dataSource: {
					kind: 'deployment-url',
					deploymentUrl: 'https://example.com',
				},
			}),
			'Selected assessments: NIMA, accessibility. Deployment URL: https://example.com.',
		);
	});

	test('formats a two-deployment comparison summary', () => {
		assert.strictEqual(
			formatAssessmentRunSummary({
				assessments: ['Colorfulness', 'Accessibility checks'],
				dataSource: {
					kind: 'deployment-url-comparison',
					baselineDeploymentUrl: 'https://before.example.com',
					currentDeploymentUrl: 'https://after.example.com',
				},
			}),
			'Selected assessments: Colorfulness, Accessibility checks. Deployment URLs: https://before.example.com → https://after.example.com.',
		);
	});

	test('uses the first deployed URL results as direct comparison history', () => {
		const assessment = { mode: 'custom' as const };
		const history = createDirectComparisonHistory(
			[
				{ metric_id: 'm1_png_file_size', results: [1200] },
				{ metric_id: 'm3_colorfulness', results: [42] },
			],
			'https://before.example.com',
			'https://after.example.com',
			assessment,
			{ createdAt: '2026-09-04T12:00:00.000Z' },
		);

		assert.deepStrictEqual(history.metrics, {
			m1_png_file_size: { results: [1200], createdAt: '2026-09-04T12:00:00.000Z' },
			m3_colorfulness: { results: [42], createdAt: '2026-09-04T12:00:00.000Z' },
		});
		assert.strictEqual(history.baselineRun?.assessedTarget, 'https://before.example.com');
		assert.strictEqual(history.currentRun?.assessedTarget, 'https://after.example.com');
		assert.strictEqual(history.baselineRun?.assessment, assessment);
	});

	test('uses embedded UIED image dimensions for direct deployment comparisons', () => {
		const history = createDirectComparisonHistory(
			[{
				metric_id: 'm6_uied_segmentation',
				results: ['https://example.com/segmented.png', {
					img_shape: [941, 1920, 3],
					segments: [],
				}],
			}],
			'https://before.example.com',
			'https://after.example.com',
			{ mode: 'custom' },
			{ currentResults: [{
				metric_id: 'm6_uied_segmentation',
				results: ['https://example.com/current-segmented.png', {
					img_shape: [941, 1920, 3],
					segments: [],
				}],
			}] },
		);

		assert.deepStrictEqual(history.screenshotDimensions, { width: 1920, height: 941 });
		assert.deepStrictEqual(history.baselineRun?.screenshotDimensions, { width: 1920, height: 941 });
		assert.deepStrictEqual(history.currentRun?.screenshotDimensions, { width: 1920, height: 941 });
	});

	test('labels previous assessments with the page path, date time, and working state', () => {
		const createdAt = '2026-08-28T10:15:00.000Z';
		assert.strictEqual(
			formatAssessmentRunLabel({
				id: 12,
				createdAt,
				commitHash: '1234567890abcdef',
				gitDirty: true,
				assessedTarget: '/checkout',
				screenshotDimensions: { width: 1440, height: 900 },
			}),
			`/checkout · ${new Date(createdAt).toLocaleString()} · commit 12345678 + changes`,
		);
		assert.strictEqual(
			formatAssessmentRunLabel({
				id: 13,
				createdAt,
				commitHash: 'abcdef1234567890',
				gitDirty: false,
				assessedTarget: '/checkout',
			}),
			`/checkout · ${new Date(createdAt).toLocaleString()} · commit abcdef12`,
		);
		assert.strictEqual(
			formatAssessmentRunLabel({
				id: 14,
				createdAt,
				assessedTarget: '/checkout',
			}),
			`/checkout · ${new Date(createdAt).toLocaleString()}`,
		);
	});

	test('formats selected profiles and their directions', () => {
		assert.strictEqual(
			formatAssessmentRunSummary({
				assessments: ['m3', 'm4', 'm13'],
				assessment: {
					mode: 'profiles',
					profiles: [
						{ id: 'colorfulness', direction: 'more-colorful' },
						{ id: 'accessibility', direction: 'fewer-detected-violations' },
					],
				},
				dataSource: {
					kind: 'local-url',
					localUrl: 'http://localhost:3000',
				},
			}),
			'Selected profiles: Colorfulness (more-colorful), Accessibility (fewer-detected-violations). Local URL: http://localhost:3000.',
		);
	});
});

function createUiMock(answers: Array<string | string[] | undefined>): QuickPickUi {
	return {
		async showQuickPick(items, options) {
			const answer = answers.shift();

			if (Array.isArray(answer)) {
				for (const item of answer) {
					assert.ok(items.includes(item));
				}
			}

			assert.ok(options.title.length > 0);
			return answer;
		},
		async showInputBox() {
			const answer = answers.shift();
			return typeof answer === 'string' ? answer : undefined;
		},
		async showErrorMessage() {
			return undefined;
		},
	};
}
