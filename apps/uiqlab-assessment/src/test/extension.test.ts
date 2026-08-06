import * as assert from 'assert';
import {
	ASSESSMENTS,
	DATA_SOURCE_OPTIONS,
	collectAssessmentRunRequest,
	formatAssessmentRunSummary,
	type QuickPickUi,
} from '../runAssessment';
import { getMetricDefinition, METRIC_DEFINITIONS } from '../metricCatalog';
import { calculateM1SizeComparison, calculateM2Comparison } from '../extension';
import { getPngDimensions } from '../playwrightCapture';

suite('Run Assessment flow', () => {
	test('exposes all assessment names and data source options', () => {
		assert.strictEqual(ASSESSMENTS.length, 14);
		assert.deepStrictEqual(DATA_SOURCE_OPTIONS, ['Deployment URL', 'Local URL']);
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

	test('calculates absolute and relative M1 PNG size deltas', () => {
		assert.deepStrictEqual(calculateM1SizeComparison(1250, 1000), {
			currentBytes: 1250,
			previousBytes: 1000,
			absoluteDelta: 250,
			relativeDeltaPercent: 25,
		});
	});

	test('does not calculate an M1 comparison for non-numeric values', () => {
		assert.strictEqual(calculateM1SizeComparison('not numeric', 1000), undefined);
		assert.strictEqual(calculateM1SizeComparison(1000, { bytes: 900 }), undefined);
	});

	test('handles decreases and a zero-byte previous result', () => {
		assert.strictEqual(calculateM1SizeComparison(750, 1000)?.absoluteDelta, -250);
		assert.strictEqual(calculateM1SizeComparison(750, 1000)?.relativeDeltaPercent, -25);
		assert.strictEqual(calculateM1SizeComparison(100, 0)?.relativeDeltaPercent, undefined);
	});

	test('compares both M2 numeric-object fields independently', () => {
		const comparison = calculateM2Comparison(
			{ jpegBytes: 1200, compressionRatio: 2.4 },
			{ jpegBytes: 1000, compressionRatio: 2 }
		);
		assert.ok(comparison);
		assert.strictEqual(comparison.currentJpegBytes, 1200);
		assert.strictEqual(comparison.previousJpegBytes, 1000);
		assert.strictEqual(comparison.jpegRelativeDeltaPercent, 20);
		assert.ok(Math.abs(comparison.compressionRatioAbsoluteDelta - 0.4) < 1e-10);
		assert.ok(Math.abs((comparison.compressionRatioRelativeDeltaPercent ?? 0) - 20) < 1e-10);
	});

	test('supports the current UIQLab M2 result array', () => {
		const comparison = calculateM2Comparison([900, 1.5], [1000, 2]);
		assert.strictEqual(comparison?.jpegRelativeDeltaPercent, -10);
		assert.strictEqual(comparison?.compressionRatioAbsoluteDelta, -0.5);
		assert.strictEqual(comparison?.compressionRatioRelativeDeltaPercent, -25);
	});

	test('reads actual dimensions from a PNG header', () => {
		const pngHeader = Buffer.alloc(24);
		Buffer.from('89504e470d0a1a0a', 'hex').copy(pngHeader);
		pngHeader.writeUInt32BE(1440, 16);
		pngHeader.writeUInt32BE(900, 20);
		assert.deepStrictEqual(getPngDimensions(pngHeader), { width: 1440, height: 900 });
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
