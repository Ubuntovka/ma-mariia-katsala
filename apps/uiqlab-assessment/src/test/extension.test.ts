import * as assert from 'assert';
import {
	ASSESSMENTS,
	DATA_SOURCE_OPTIONS,
	collectAssessmentRunRequest,
	formatAssessmentRunSummary,
	normalizeAvailableMetricItems,
	type QuickPickUi,
} from '../runAssessment';
import { getMetricDefinition, METRIC_DEFINITIONS } from '../metricCatalog';
import {
	calculateM1SizeComparison,
	calculateM2Comparison,
	calculateM3Comparison,
	calculateM4Comparison,
	getM4ComparisonUnavailableReason,
	calculateM5Comparison,
	compareM6Segmentation,
	compareSaliencyHeatmaps,
	calculateM8Comparison,
	calculateM9Comparison,
	calculateM10Comparison,
	calculateM11Comparison,
	calculateM12Comparison,
	calculateM13Comparison,
	summarizeM13Comparison,
	calculateM14Comparison,
	normalizeUiedElements,
	getColorfulnessInterpretation,
	generateResultsHtml,
	renderExplanationHtml,
	renderCustomMetricLlmFeedback,
	renderProfileLlmFeedback,
	renderProfileAssessmentOverview,
	renderRequestedHistoryMetricSections,
	renderUnavailableHistoryMetricSection,
	requestedHistoryMetricIds,
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

	test('renders common LLM Markdown without exposing raw formatting markers', () => {
		assert.strictEqual(
			renderExplanationHtml('** Visual Complexity and Content **\n\n- Dense navigation\n- `42` visible items'),
			'<p><strong>Visual Complexity and Content</strong></p><ul><li>Dense navigation</li><li><code>42</code> visible items</li></ul>'
		);
	});

	test('escapes HTML in LLM explanations before adding safe formatting', () => {
		const html = renderExplanationHtml('**Safe** <script>alert("x")</script>');
		assert.strictEqual(html, '<p><strong>Safe</strong> &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
	});

	test('renders structured profile LLM guidance as visual cards and escapes model content', () => {
		const html = renderProfileLlmFeedback({
			goalStatus: 'partial',
			goalTitle: 'Profile goals partially achieved',
			summary: 'Complexity improved, but <script>content</script> density did not.',
			changes: ['Edge density decreased.'],
			suggestions: [{
				title: 'Simplify the content block',
				action: 'Reduce secondary copy and retest the profile.',
				rationale: 'This may move content density toward the selected direction.',
				files: ['src/pages/home.tsx'],
			}],
			sourceContextUsed: true,
			sourceFiles: ['src/pages/home.tsx'],
		});

		assert.match(html, /profile-ai-feedback status-partial/);
		assert.match(html, /Suggested next steps/);
		assert.match(html, /Metrics and 1 source file/);
		assert.match(html, /src\/pages\/home\.tsx/);
		assert.doesNotMatch(html, /<script>/);
		assert.match(html, /&lt;script&gt;content&lt;\/script&gt;/);
	});

	test('renders structured custom-metric analysis as evidence-to-action cards', () => {
		const html = renderCustomMetricLlmFeedback({
			summary: 'Two independent clutter indicators increased relative to the baseline.',
			analysisMode: 'comparison',
			materialChangeCount: 2,
			findings: [{
				title: 'Corroborating visual-density measurements',
				metricIds: ['M9', 'M10'],
				observation: 'Edge density and feature congestion increased.',
				interpretation: 'The measurements indicate increased visual information density.',
				recommendation: 'Isolate one layout change and repeat both measurements. <script>alert(1)</script>',
			}],
		});

		assert.match(html, /custom-ai-feedback/);
		assert.match(html, /Baseline comparison · 2 material changes/);
		assert.match(html, /Measured evidence/);
		assert.match(html, /Technical interpretation/);
		assert.match(html, /Practical next step/);
		assert.match(html, /Practical action/);
		assert.match(html, /M9/);
		assert.doesNotMatch(html, /<script>/);
		assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	});

	test('shows an LLM request error instead of hiding the explanation section', () => {
		const html = generateResultsHtml(
			[{ metric_id: 'm9_edge_density', results: [0.2] }],
			'http://localhost:3000',
			true,
			undefined,
			'The LLM provider did not respond in time.',
		);

		assert.match(html, /AI explanation unavailable/);
		assert.match(html, /The LLM provider did not respond in time/);
	});

	test('renders profile goal feedback as a visual status dashboard', () => {
		const html = renderProfileAssessmentOverview({
			status: 'achieved',
			title: 'Profile goal achieved',
			description: 'The goal was achieved.',
			outcomes: [{
				id: 'visual-complexity',
				direction: 'decrease',
				outcome: 'aligned',
				goalStatus: 'achieved',
				reason: 'All meaningful changes follow the chosen direction.',
				comparableMetrics: ['m9', 'm10'],
				meaningfulMetrics: ['m9', 'm10'],
				alignedMetrics: ['m9', 'm10'],
				opposedMetrics: [],
			}],
		});
		assert.match(html, /profile-overview status-achieved/);
		assert.match(html, /Profile goal achieved/);
		assert.match(html, /outcome-track/);
		assert.match(html, /2 aligned/);
		assert.match(html, /Chosen direction: <strong>decrease<\/strong>/);
	});

	test('keeps every requested metric in history comparison when only some have baselines', () => {
		const requested = requestedHistoryMetricIds(
			Array.from({ length: 14 }, (_, index) => `m${index + 1}`),
			[],
		);
		const html = renderRequestedHistoryMetricSections(
			requested,
			{
				m9: '<section class="metric-section">Comparable M9</section>',
				m10: '<section class="metric-section">Comparable M10</section>',
			},
			['m9_edge_density', 'm10_feature_congestion'],
		);
		assert.strictEqual(requested.length, 14);
		assert.strictEqual((html.match(/<section class="metric-section/g) ?? []).length, 14);
		assert.match(html, /M1 · PNG file size/);
		assert.match(html, /M14 · NIMA \(Neural IMage Assessment\)/);
		assert.match(html, /Comparable M9/);
		assert.match(html, /No baseline available/);
	});

	test('does not duplicate a current value in a no-baseline placeholder', () => {
		const html = renderUnavailableHistoryMetricSection('m8', false);
		assert.match(html, /M8 · Word count/);
		assert.match(html, /No baseline available/);
		assert.doesNotMatch(html, /Current value|current value|<span class="value">/);
	});

	test('distinguishes an unusable baseline from a missing baseline', () => {
		const html = renderUnavailableHistoryMetricSection('m6', true);
		assert.match(html, /Comparison unavailable/);
		assert.doesNotMatch(html, /No baseline available/);
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

	test('formats selected profiles and their directions', () => {
		assert.strictEqual(
			formatAssessmentRunSummary({
				assessments: ['m3', 'm4', 'm13'],
				assessment: {
					mode: 'profiles',
					profiles: [
						{ id: 'colour-expression', direction: 'more-vivid' },
						{ id: 'accessibility', direction: 'reduce-issues' },
					],
				},
				dataSource: {
					kind: 'local-url',
					localUrl: 'http://localhost:3000',
				},
			}),
			'Selected profiles: colour-expression (more-vivid), accessibility (reduce-issues). Local URL: http://localhost:3000.',
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
		assert.strictEqual(comparison.jpegAbsoluteDelta, 200);
		assert.strictEqual(comparison.jpegRelativeDeltaPercent, 20);
		assert.ok(Math.abs(comparison.compressionRatioAbsoluteDelta - 0.4) < 1e-10);
		assert.ok(Math.abs((comparison.compressionRatioRelativeDeltaPercent ?? 0) - 20) < 1e-10);
	});

	test('supports the current UIQLab M2 result array', () => {
		const comparison = calculateM2Comparison([900, 1.5], [1000, 2]);
		assert.strictEqual(comparison?.jpegAbsoluteDelta, -100);
		assert.strictEqual(comparison?.jpegRelativeDeltaPercent, -10);
		assert.strictEqual(comparison?.compressionRatioAbsoluteDelta, -0.5);
		assert.strictEqual(comparison?.compressionRatioRelativeDeltaPercent, -25);
		const zeroBaseline = calculateM2Comparison([250, 1.2], [0, 1]);
		assert.strictEqual(zeroBaseline?.jpegAbsoluteDelta, 250);
		assert.strictEqual(zeroBaseline?.jpegRelativeDeltaPercent, undefined);
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

	test('explains when no dimension-matched historical M4 result is available', () => {
		assert.strictEqual(
			getM4ComparisonUnavailableReason({
				hasCurrentResult: true,
				currentValue: [52, 12, 4, 5, -3, 8],
				hasHistoricalResult: false,
				dimensionsAvailable: true,
			}),
			'No completed previous M4 result was found for the same project, page, and screenshot dimensions.'
		);
	});

	test('explains invalid current and previous M4 output', () => {
		assert.strictEqual(
			getM4ComparisonUnavailableReason({
				hasCurrentResult: true,
				currentValue: [],
				hasHistoricalResult: true,
				previousValue: [50, 10, 1, 6, 1, 8],
				dimensionsAvailable: true,
			}),
			'The current M4 result did not contain all six numeric CIELAB mean and standard-deviation values.'
		);
		assert.strictEqual(
			getM4ComparisonUnavailableReason({
				hasCurrentResult: true,
				currentValue: [52, 12, 4, 5, -3, 8],
				hasHistoricalResult: true,
				previousValue: [],
				dimensionsAvailable: true,
			}),
			'The matching previous M4 result did not contain all six numeric CIELAB mean and standard-deviation values.'
		);
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

	test('compares M8 word count using absolute and relative deltas', () => {
		const comparison = calculateM8Comparison({ visible_word_count: 150 }, ['120']);
		assert.ok(comparison);
		assert.strictEqual(comparison.previousWordCount, 120);
		assert.strictEqual(comparison.currentWordCount, 150);
		assert.strictEqual(comparison.absoluteDelta, 30);
		assert.strictEqual(comparison.relativeDeltaPercent, 25);
	});

	test('reports removed M8 content and omits relative change for a zero baseline', () => {
		const removed = calculateM8Comparison([80], [100]);
		assert.strictEqual(removed?.absoluteDelta, -20);
		assert.strictEqual(removed?.relativeDeltaPercent, -20);
		const zeroBaseline = calculateM8Comparison({ count: 12 }, { words: 0 });
		assert.strictEqual(zeroBaseline?.absoluteDelta, 12);
		assert.strictEqual(zeroBaseline?.relativeDeltaPercent, undefined);
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

	test('compares the M14 NIMA mean and standard deviation independently', () => {
		const comparison = calculateM14Comparison([6.8, 1.2], [6.2, 1.5]);
		assert.ok(comparison);
		assert.strictEqual(comparison.mean.previous, 6.2);
		assert.strictEqual(comparison.mean.current, 6.8);
		assert.ok(Math.abs(comparison.mean.delta - 0.6) < 1e-10);
		assert.strictEqual(comparison.standardDeviation.previous, 1.5);
		assert.strictEqual(comparison.standardDeviation.current, 1.2);
		assert.ok(Math.abs(comparison.standardDeviation.delta + 0.3) < 1e-10);
	});

	test('reads named M14 NIMA fields from JSON results', () => {
		const comparison = calculateM14Comparison(
			JSON.stringify({ mean_score: 7.1, standard_deviation: 0.9 }),
			{ score: 6.9, std: 1.1 }
		);
		assert.ok(comparison);
		assert.ok(Math.abs(comparison.mean.delta - 0.2) < 1e-10);
		assert.ok(Math.abs(comparison.standardDeviation.delta + 0.2) < 1e-10);
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
