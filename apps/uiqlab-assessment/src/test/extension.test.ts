import * as assert from 'assert';
import {
	ASSESSMENTS,
	DATA_SOURCE_OPTIONS,
	collectAssessmentRunRequest,
	formatAssessmentRunSummary,
	type QuickPickUi,
} from '../runAssessment';
import { getMetricDefinition, METRIC_DEFINITIONS } from '../metricCatalog';
import {
	calculateM1SizeComparison,
	calculateM2Comparison,
	calculateM3Comparison,
	calculateM4Comparison,
	calculateM5Comparison,
	compareM6Segmentation,
	compareSaliencyHeatmaps,
	calculateM9Comparison,
	calculateM10Comparison,
	calculateM11Comparison,
	calculateM12Comparison,
	calculateM13Comparison,
	summarizeM13Comparison,
	normalizeUiedElements,
	getColorfulnessInterpretation,
} from '../extension';
import { getPngDimensions } from '../playwrightCapture';
import { PNG } from 'pngjs';

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

	test('reports M3 scalar and interpretation-range movement', () => {
		const comparison = calculateM3Comparison([46], [32]);
		assert.ok(comparison);
		assert.strictEqual(comparison.scalarDelta, 14);
		assert.strictEqual(comparison.direction, 'more colorful');
		assert.strictEqual(comparison.previousInterpretation, 'slightly colorful');
		assert.strictEqual(comparison.currentInterpretation, 'averagely colorful');
		assert.strictEqual(comparison.rangeChanged, true);
	});

	test('reports M3 movement within the same interpretation range', () => {
		const comparison = calculateM3Comparison(
			{ colorfulness: 20 },
			{ score: 25 }
		);
		assert.strictEqual(comparison?.direction, 'less colorful');
		assert.strictEqual(comparison?.rangeChanged, false);
		assert.strictEqual(comparison?.currentInterpretation, 'slightly colorful');
	});

	test('uses UIQLab colorfulness interpretation thresholds', () => {
		assert.strictEqual(getColorfulnessInterpretation(14.99), 'not colorful');
		assert.strictEqual(getColorfulnessInterpretation(15), 'slightly colorful');
		assert.strictEqual(getColorfulnessInterpretation(33), 'moderately colorful');
		assert.strictEqual(getColorfulnessInterpretation(45), 'averagely colorful');
		assert.strictEqual(getColorfulnessInterpretation(59), 'quite colorful');
		assert.strictEqual(getColorfulnessInterpretation(82), 'highly colorful');
		assert.strictEqual(getColorfulnessInterpretation(109), 'extremely colorful');
	});

	test('compares all M4 Lab channels and calculates mean-color delta E', () => {
		const comparison = calculateM4Comparison(
			[52, 12, 4, 5, -3, 8],
			[50, 10, 1, 6, 1, 8]
		);
		assert.ok(comparison);
		assert.strictEqual(comparison.means.l.delta, 2);
		assert.strictEqual(comparison.means.a.delta, 3);
		assert.strictEqual(comparison.means.b.delta, -4);
		assert.strictEqual(comparison.standardDeviations.l.delta, 2);
		assert.strictEqual(comparison.standardDeviations.a.delta, -1);
		assert.strictEqual(comparison.standardDeviations.b.delta, 0);
		assert.ok(Math.abs(comparison.deltaE - Math.sqrt(29)) < 1e-10);
	});

	test('supports named M4 numeric fields', () => {
		const comparison = calculateM4Comparison(
			{ lMean: 60, lSd: 8, aMean: 2, aSd: 3, bMean: -1, bSd: 4 },
			{ lMean: 58, lSd: 7, aMean: 1, aSd: 3, bMean: -1, bSd: 5 }
		);
		assert.strictEqual(comparison?.means.l.delta, 2);
		assert.strictEqual(comparison?.standardDeviations.b.delta, -1);
	});

	test('calculates M5 white-space change in percentage points', () => {
		const comparison = calculateM5Comparison([0.38], [0.32]);
		assert.ok(comparison);
		assert.strictEqual(comparison.previousProportion, 0.32);
		assert.strictEqual(comparison.currentProportion, 0.38);
		assert.ok(Math.abs(comparison.percentagePointDelta - 6) < 1e-10);
	});

	test('rejects M5 proportions outside zero to one', () => {
		assert.strictEqual(calculateM5Comparison([1.1], [0.5]), undefined);
		assert.strictEqual(calculateM5Comparison([-0.1], [0.5]), undefined);
	});

	test('normalizes UIED component boxes using screenshot dimensions', () => {
		const elements = normalizeUiedElements({ segments: [{
			class: 'Text',
			position: { column_min: 120, row_min: 80, column_max: 540, row_max: 130 },
		}] }, { width: 1000, height: 500 });
		assert.deepStrictEqual(elements, [{
			type: 'text',
			x: 0.12,
			y: 0.16,
			width: 0.42,
			height: 0.1,
		}]);
	});

	test('detects added, removed, moved, and resized UIED elements', () => {
		const previous = { segments: [
			{ type: 'header', position: { column_min: 0, row_min: 0, column_max: 1000, row_max: 100 } },
			{ class: 'Text', position: { column_min: 100, row_min: 200, column_max: 500, row_max: 250 } },
			{ type: 'button', position: { column_min: 100, row_min: 300, column_max: 200, row_max: 340 } },
		] };
		const current = { segments: [
			{ type: 'header', position: { column_min: 0, row_min: 20, column_max: 1000, row_max: 140 } },
			{ class: 'Text', position: { column_min: 120, row_min: 200, column_max: 520, row_max: 250 } },
			{ type: 'image', position: { column_min: 700, row_min: 300, column_max: 900, row_max: 500 } },
		] };
		const comparison = compareM6Segmentation(current, previous, { width: 1000, height: 1000 });
		assert.ok(comparison);
		assert.deepStrictEqual({
			added: comparison.added,
			removed: comparison.removed,
			moved: comparison.moved,
			resized: comparison.resized,
		}, { added: 1, removed: 1, moved: 2, resized: 1 });
		assert.deepStrictEqual(comparison.movedTypes.sort(), ['header', 'text']);
	});

	test('compares normalized M7 saliency maps and detects attention movement', () => {
		const previous = createSyntheticHeatmap(1);
		const current = createSyntheticHeatmap(4);
		const comparison = compareSaliencyHeatmaps(current, previous);
		assert.ok(comparison);
		assert.ok(Math.abs(comparison.jensenShannonDivergence - 1) < 1e-10);
		assert.strictEqual(comparison.salientRegionOverlap, 0);
		assert.strictEqual(comparison.previousRegion, 'header');
		assert.strictEqual(comparison.currentRegion, 'main content');
		assert.ok(Math.abs(comparison.centerMovement - 0.3) < 1e-10);
		assert.strictEqual(
			comparison.interpretation,
			'User attention is predicted to shift from the header to the main content.'
		);
	});

	test('reports identical M7 heatmaps as fully overlapping', () => {
		const heatmap = createSyntheticHeatmap(2);
		const comparison = compareSaliencyHeatmaps(heatmap, heatmap);
		assert.strictEqual(comparison?.jensenShannonDivergence, 0);
		assert.strictEqual(comparison?.salientRegionOverlap, 1);
		assert.strictEqual(comparison?.centerMovement, 0);
	});

	test('uses the M9 scalar as the primary percentage-point comparison', () => {
		const comparison = calculateM9Comparison(['0.20'], ['0.15']);
		assert.ok(comparison);
		assert.strictEqual(comparison.currentDensity, 0.2);
		assert.strictEqual(comparison.previousDensity, 0.15);
		assert.ok(Math.abs(comparison.percentagePointDelta - 5) < 1e-10);
		assert.strictEqual(comparison.edgeMapIou, undefined);
	});

	test('optionally compares M9 binary edge maps with IoU and F1', () => {
		const previousEdges = createBinaryEdgeMap([0, 1]);
		const currentEdges = createBinaryEdgeMap([1, 2]);
		const comparison = calculateM9Comparison(
			['0.20'],
			['0.15'],
			currentEdges,
			previousEdges
		);
		assert.ok(comparison);
		assert.ok(Math.abs((comparison.edgeMapIou ?? 0) - 1 / 3) < 1e-10);
		assert.strictEqual(comparison.edgeMapF1, 0.5);
	});

	test('compares the M10 scalar and normalized congestion maps', () => {
		const previousMap = createSyntheticHeatmap(1);
		const currentMap = createSyntheticHeatmap(4);
		const comparison = calculateM10Comparison(
			[6, 'current-map.png'],
			[4, 'previous-map.png'],
			currentMap,
			previousMap
		);
		assert.ok(comparison);
		assert.strictEqual(comparison.scalarDelta, 2);
		assert.ok(Math.abs((comparison.mapMeanAbsoluteDifference ?? 0) - 0.2) < 1e-10);
		assert.strictEqual(comparison.highCongestionOverlap, 0);
	});

	test('reports identical M10 congestion maps as unchanged', () => {
		const map = createSyntheticHeatmap(3);
		const comparison = calculateM10Comparison([4], [4], map, map);
		assert.strictEqual(comparison?.scalarDelta, 0);
		assert.strictEqual(comparison?.mapMeanAbsoluteDifference, 0);
		assert.strictEqual(comparison?.highCongestionOverlap, 1);
	});

	test('compares M11 subband entropy using absolute and relative deltas', () => {
		const comparison = calculateM11Comparison([3.6], [3]);
		assert.ok(comparison);
		assert.strictEqual(comparison.currentEntropy, 3.6);
		assert.strictEqual(comparison.previousEntropy, 3);
		assert.ok(Math.abs(comparison.absoluteDelta - 0.6) < 1e-10);
		assert.ok(Math.abs((comparison.relativeDeltaPercent ?? 0) - 20) < 1e-10);
	});

	test('omits the M11 relative delta when the previous entropy is zero', () => {
		const comparison = calculateM11Comparison({ subband_entropy: 2 }, { entropy: 0 });
		assert.strictEqual(comparison?.absoluteDelta, 2);
		assert.strictEqual(comparison?.relativeDeltaPercent, undefined);
	});

	test('compares M12 Shannon entropy using absolute and relative deltas', () => {
		const comparison = calculateM12Comparison({ shannon_entropy: 7.5 }, { entropy: 6 });
		assert.ok(comparison);
		assert.strictEqual(comparison.currentEntropy, 7.5);
		assert.strictEqual(comparison.previousEntropy, 6);
		assert.strictEqual(comparison.absoluteDelta, 1.5);
		assert.strictEqual(comparison.relativeDeltaPercent, 25);
	});

	test('omits the M12 relative delta when the previous entropy is zero', () => {
		const comparison = calculateM12Comparison([2], [0]);
		assert.strictEqual(comparison?.absoluteDelta, 2);
		assert.strictEqual(comparison?.relativeDeltaPercent, undefined);
	});

	test('compares M13 accessibility issues by rule ID and affected target', () => {
		const previous = [3, { violations: [
			{ id: 'color-contrast', impact: 'serious', nodes: [{ target: ['#checkout'] }] },
			{ id: 'label', impact: 'critical', nodes: [{ target: ['#email'] }] },
			{ id: 'button-name', impact: 'serious', nodes: [{ target: ['#cancel'] }] },
		] }];
		const current = [3, JSON.stringify({ violations: [
			{ id: 'color-contrast', impact: 'serious', nodes: [{ target: ['#checkout'] }, { target: ['#pay'] }] },
			{ id: 'button-name', impact: 'critical', nodes: [{ target: ['#cancel'] }] },
		] })];
		const comparison = calculateM13Comparison(current, previous);
		assert.ok(comparison);
		assert.strictEqual(comparison.currentCount, 3);
		assert.strictEqual(comparison.previousCount, 3);
		assert.deepStrictEqual(comparison.newIssues.map((issue) => issue.identity), ['color-contrast\u0000#pay']);
		assert.deepStrictEqual(comparison.resolvedIssues.map((issue) => issue.identity), ['label\u0000#email']);
		assert.strictEqual(comparison.persistentIssues.length, 2);
		assert.deepStrictEqual(
			comparison.byRule.find((row) => row.key === 'color-contrast'),
			{ key: 'color-contrast', previous: 1, current: 2, delta: 1 }
		);
		assert.deepStrictEqual(
			comparison.byImpact.find((row) => row.key === 'critical'),
			{ key: 'critical', previous: 1, current: 1, delta: 0 }
		);
	});

	test('summarizes resolved M13 issues and a representative new serious regression', () => {
		const comparison = calculateM13Comparison(
			{ violations: [{ id: 'color-contrast', impact: 'serious', nodes: [{ target: ['#checkout-button'] }] }] },
			{ violations: [
				{ id: 'label', impact: 'critical', nodes: [{ target: ['#email'] }] },
				{ id: 'button-name', impact: 'serious', nodes: [{ target: ['#cancel'] }] },
			] }
		);
		assert.ok(comparison);
		assert.strictEqual(
			summarizeM13Comparison(comparison),
			'2 accessibility problems were resolved, but 1 new serious color-contrast violation appeared on #checkout-button.'
		);
	});

	test('reads actual dimensions from a PNG header', () => {
		const pngHeader = Buffer.alloc(24);
		Buffer.from('89504e470d0a1a0a', 'hex').copy(pngHeader);
		pngHeader.writeUInt32BE(1440, 16);
		pngHeader.writeUInt32BE(900, 20);
		assert.deepStrictEqual(getPngDimensions(pngHeader), { width: 1440, height: 900 });
	});
});

function createSyntheticHeatmap(salientRow: number): Buffer {
	const png = new PNG({ width: 10, height: 10 });
	for (let y = 0; y < png.height; y++) {
		for (let x = 0; x < png.width; x++) {
			const offset = (y * png.width + x) * 4;
			const value = y === salientRow ? 255 : 0;
			png.data[offset] = value;
			png.data[offset + 1] = value;
			png.data[offset + 2] = value;
			png.data[offset + 3] = 255;
		}
	}
	return PNG.sync.write(png);
}

function createBinaryEdgeMap(edgePixels: number[]): Buffer {
	const png = new PNG({ width: 4, height: 1 });
	for (let x = 0; x < png.width; x++) {
		const offset = x * 4;
		const value = edgePixels.includes(x) ? 255 : 0;
		png.data[offset] = value;
		png.data[offset + 1] = value;
		png.data[offset + 2] = value;
		png.data[offset + 3] = 255;
	}
	return PNG.sync.write(png);
}

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
