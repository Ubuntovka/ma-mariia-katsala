import * as vscode from 'vscode';
import {
	assessProfilesAgainstHistory,
	normalizeProfileAssessmentSelection,
} from './profileAssessment';
import type { AssessmentHistory, AssessmentMetricResult, AssessmentRunSummary } from './runAssessment';
import {
	findM1HistoryComparison,
	findM2HistoryComparison,
	findM3HistoryComparison,
	findM4HistoryComparison,
	findM5HistoryComparison,
	findM6HistoryComparison,
	findM7HistoryComparison,
	findM8HistoryComparison,
	findM9HistoryComparison,
	findM10HistoryComparison,
	findM11HistoryComparison,
	findM12HistoryComparison,
	findM13HistoryComparison,
	findM14HistoryComparison,
} from './historyComparisonData';
import {
	readM4Values,
	getM4ComparisonUnavailableReason,
	summarizeM13Comparison,
	type AccessibilityCountComparison,
	type NumericChange,
} from './metricComparisons';
import { escapeHtml } from './webviewSecurity';
import { generateResultsHtml } from './resultsWebview';
import { renderTargetLink } from './webviewFormatting';
import {
	baseMetricId,
	type HistoryComparisonContent,
	renderAccessibilityIssueList,
	renderProfileAssessmentOverview,
	renderRequestedHistoryMetricSections,
	requestedHistoryMetricIds,
} from './historyRendering';

function signedNumber(value: number, maximumFractionDigits: number = 0): string {
	if (value === 0 || Object.is(value, -0)) {
		return '0';
	}
	return `${value > 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits })}`;
}

function relativeChange(value: number | undefined): string {
	return value === undefined ? 'Not available' : `${signedNumber(value, 2)}%`;
}

function labComparisonRow(channel: string, change: NumericChange): string {
	return `<tr><th scope="row">${channel}</th><td>${change.previous.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td><td>${change.current.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td><td>${signedNumber(change.delta, 3)}</td></tr>`;
}

function variationDirection(change: NumericChange): string {
	return change.delta > 0 ? 'increased' : change.delta < 0 ? 'decreased' : 'unchanged';
}

function typeBreakdown(types: string[]): string {
	const counts = new Map<string, number>();
	for (const type of types) { counts.set(type, (counts.get(type) ?? 0) + 1); }
	return Array.from(counts, ([type, count]) => `${escapeHtml(type)} (${count})`).join(', ') || 'none';
}

function structuralAction(count: number, action: string, types: string[]): string {
	if (count === 1 && types.length === 1) {
		return `1 ${escapeHtml(types[0])} element ${action}`;
	}
	const breakdown = count > 0 ? ` (${typeBreakdown(types)})` : '';
	return `${count} components ${action}${breakdown}`;
}

function accessibilityBreakdownRows(rows: AccessibilityCountComparison[]): string {
	return rows.map((row) => `<tr><th scope="row">${escapeHtml(row.key)}</th><td>${row.previous}</td><td>${row.current}</td><td>${signedNumber(row.delta)}</td></tr>`).join('');
}

function linkedComparisonImage(url: string, alt: string): string {
	const safeUrl = escapeHtml(url);
	return `<a class="image-zoom-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(alt)} at full size" title="Open full-size image"><img src="${safeUrl}" alt="${escapeHtml(alt)}"></a>`;
}

function comparisonRunText(run: AssessmentRunSummary): string {
	if (run.id < 0 && run.assessedTarget) {
		return run.assessedTarget;
	}
	const commit = run.commitHash ? run.commitHash.slice(0, 8) : 'no commit';
	const dirty = run.gitDirty ? ' + working changes' : '';
	return `${commit}${dirty} · ${new Date(run.createdAt).toLocaleString()}`;
}

function comparisonPreviewTarget(label: string, run: AssessmentRunSummary | undefined): string {
	const target = run?.assessedTarget
		? renderTargetLink(run.assessedTarget)
		: escapeHtml(run ? comparisonRunText(run) : 'Not available');
	return `<span class="comparison-preview-item"><span class="comparison-preview-label">${label}</span><span class="comparison-preview-target">${target}</span></span>`;
}

export async function buildHistoryComparisonContent(
	currentResults: AssessmentMetricResult[],
	history: AssessmentHistory,
	selectedMetricIds: string[] = [],
	assessmentSelection?: unknown,
): Promise<HistoryComparisonContent | undefined> {
	const requestedMetricIds = requestedHistoryMetricIds(selectedMetricIds, currentResults);
	const historyMetricIds = Object.keys(history.metrics);
	const historyMetricFamilies = new Set(historyMetricIds.map(baseMetricId));
	const selectedProfiles = normalizeProfileAssessmentSelection(
		assessmentSelection ?? history.currentRun?.assessment,
	);
	const profileOverview = selectedProfiles
		? renderProfileAssessmentOverview(assessProfilesAgainstHistory(
			selectedProfiles,
			currentResults,
			history.metrics,
			Boolean(history.baselineRun),
		))
		: '';
	const currentM4Result = currentResults.find(
		(result: AssessmentMetricResult) => typeof result?.metric_id === 'string' && result.metric_id.split('_')[0] === 'm4'
	);
	const selectedM4MetricId = requestedMetricIds.find((metricId) => metricId === 'm4');
	const m4WasSelected = Boolean(currentM4Result || selectedM4MetricId);
	const m4MetricId = currentM4Result?.metric_id ?? selectedM4MetricId;
	const historicalM4Result = m4MetricId ? history.metrics[m4MetricId] : undefined;
	const m1Match = findM1HistoryComparison(currentResults, history);
	const m2Match = findM2HistoryComparison(currentResults, history);
	const m3Match = findM3HistoryComparison(currentResults, history);
	const m4Match = findM4HistoryComparison(currentResults, history);
	const m5Match = findM5HistoryComparison(currentResults, history);
	const dimensions = history.screenshotDimensions;
	const m6Match = findM6HistoryComparison(currentResults, history, dimensions);
	const m11Match = findM11HistoryComparison(currentResults, history);
	const m12Match = findM12HistoryComparison(currentResults, history);
	const m13Match = findM13HistoryComparison(currentResults, history);
	const m14Match = findM14HistoryComparison(currentResults, history);
	const m7Match = await findM7HistoryComparison(currentResults, history);
	const m8Match = findM8HistoryComparison(currentResults, history);
	const m9Match = await findM9HistoryComparison(currentResults, history);
	const m10Match = await findM10HistoryComparison(currentResults, history);
	if (!profileOverview && requestedMetricIds.length === 0) {
		return undefined;
	}
	const runContext = history.currentRun || history.baselineRun
		? `<div class="run-pair">
			${history.baselineRun ? `<div class="run-chip baseline-run"><span>Baseline</span><strong>${escapeHtml(comparisonRunText(history.baselineRun))}</strong></div>` : ''}
			${history.currentRun && history.baselineRun ? '<div class="run-arrow" aria-hidden="true">→</div>' : ''}
			${history.currentRun ? `<div class="run-chip current-run"><span>Current</span><strong>${escapeHtml(comparisonRunText(history.currentRun))}</strong></div>` : ''}
		</div>`
		: '';

	const m1Section = m1Match ? `
		<section class="metric-section">
			<h2>M1 · PNG file size change</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m1Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous size</span><span class="value">${m1Match.comparison.previousBytes.toLocaleString()} bytes</span></div>
				<div class="card"><span class="label">Current size</span><span class="value">${m1Match.comparison.currentBytes.toLocaleString()} bytes</span></div>
				<div class="card"><span class="label">Absolute delta</span><span class="value">${signedNumber(m1Match.comparison.absoluteDelta)} bytes</span></div>
				<div class="card"><span class="label">Relative delta</span><span class="value">${relativeChange(m1Match.comparison.relativeDeltaPercent)}</span></div>
			</div>
			<div class="explanation"><p>M1 reports the PNG screenshot size in bytes. The absolute delta is current size minus previous size; the relative delta expresses that change as a percentage of the previous size. PNG size has no universal “better” direction, so this reports the change without labeling it as an improvement or regression.</p></div>
		</section>` : '';

	const m2Section = m2Match ? `
		<section class="metric-section">
			<h2>M2 · JPEG file size and compression ratio</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m2Match.previousCreatedAt).toLocaleString()}</p>
			<h3>JPEG file size</h3>
			<div class="grid">
				<div class="card"><span class="label">Previous size</span><span class="value">${m2Match.comparison.previousJpegBytes.toLocaleString()} bytes</span></div>
				<div class="card"><span class="label">Current size</span><span class="value">${m2Match.comparison.currentJpegBytes.toLocaleString()} bytes</span></div>
				<div class="card"><span class="label">Absolute delta</span><span class="value">${signedNumber(m2Match.comparison.jpegAbsoluteDelta)} bytes</span></div>
				<div class="card"><span class="label">Relative change</span><span class="value">${relativeChange(m2Match.comparison.jpegRelativeDeltaPercent)}</span></div>
			</div>
			<h3>Compression ratio</h3>
			<div class="grid">
				<div class="card"><span class="label">Previous ratio</span><span class="value">${m2Match.comparison.previousCompressionRatio.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Current ratio</span><span class="value">${m2Match.comparison.currentCompressionRatio.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Absolute change</span><span class="value">${signedNumber(m2Match.comparison.compressionRatioAbsoluteDelta, 4)}</span></div>
				<div class="card"><span class="label">Relative change</span><span class="value">${relativeChange(m2Match.comparison.compressionRatioRelativeDeltaPercent)}</span></div>
			</div>
			<div class="explanation"><p>M2 changes can indicate altered JPEG compressibility or different visual content. JPEG size shows both the absolute byte delta and the relative change as a percentage of the previous size. File size and compression ratio are compared independently. Neither an increase nor a decrease is automatically better.</p></div>
		</section>` : '';

	const m3RangeMovement = m3Match
		? m3Match.comparison.rangeChanged
			? `${m3Match.comparison.previousInterpretation} → ${m3Match.comparison.currentInterpretation}`
			: `Remained ${m3Match.comparison.currentInterpretation}`
		: '';
	const m3Section = m3Match ? `
		<section class="metric-section">
			<h2>M3 · Colorfulness</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m3Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous score</span><span class="value">${m3Match.comparison.previousScore.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span></div>
				<div class="card"><span class="label">Current score</span><span class="value">${m3Match.comparison.currentScore.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span></div>
				<div class="card"><span class="label">Scalar delta</span><span class="value">${signedNumber(m3Match.comparison.scalarDelta, 3)}</span></div>
				<div class="card"><span class="label">Colorfulness movement</span><span class="value text-value">${m3Match.comparison.direction}</span></div>
				<div class="card wide-card"><span class="label">Interpretation range</span><span class="value text-value">${m3RangeMovement}</span></div>
			</div>
			<div class="explanation"><p>M3 is the Hasler–Süsstrunk colorfulness score. A positive delta means the screenshot is more colorful and a negative delta means it is less colorful. Crossing an interpretation threshold is reported separately. More or less colorful is not automatically an improvement or regression.</p></div>
		</section>` : '';

	const m4VariationSummary = m4Match
		? `L* variation ${variationDirection(m4Match.comparison.standardDeviations.l)}, a* variation ${variationDirection(m4Match.comparison.standardDeviations.a)}, and b* variation ${variationDirection(m4Match.comparison.standardDeviations.b)}.`
		: '';
	const m4Section = m4Match ? `
		<section class="metric-section">
			<h2>M4 · CIELAB mean and standard deviation</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m4Match.previousCreatedAt).toLocaleString()}</p>
			<h3>Mean color</h3>
			<div class="table-wrap"><table><thead><tr><th>Channel</th><th>Previous</th><th>Current</th><th>Delta</th></tr></thead><tbody>
				${labComparisonRow('L* · lightness', m4Match.comparison.means.l)}
				${labComparisonRow('a* · green–red', m4Match.comparison.means.a)}
				${labComparisonRow('b* · blue–yellow', m4Match.comparison.means.b)}
			</tbody></table></div>
			<div class="grid compact-grid"><div class="card"><span class="label">Mean-color distance · ΔE</span><span class="value">${m4Match.comparison.deltaE.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span></div></div>
			<h3>Color-distribution variation · standard deviation</h3>
			<div class="table-wrap"><table><thead><tr><th>Channel</th><th>Previous SD</th><th>Current SD</th><th>Delta</th></tr></thead><tbody>
				${labComparisonRow('L* · lightness', m4Match.comparison.standardDeviations.l)}
				${labComparisonRow('a* · green–red', m4Match.comparison.standardDeviations.a)}
				${labComparisonRow('b* · blue–yellow', m4Match.comparison.standardDeviations.b)}
			</tbody></table></div>
			<p class="variation-summary">${m4VariationSummary}</p>
			<div class="explanation"><p>The L* mean describes average brightness, while a* and b* locate the average palette on the green–red and blue–yellow axes. ΔE is the Euclidean distance between the previous and current mean Lab colors. Standard-deviation changes describe shifts in color distribution and variation within each channel. These changes have no universal better direction.</p></div>
		</section>` : '';
	const currentM4Values = currentM4Result ? readM4Values(currentM4Result.results) : undefined;
	const m4UnavailableReason = m4WasSelected && !m4Match
		? getM4ComparisonUnavailableReason({
			hasCurrentResult: Boolean(currentM4Result),
			currentValue: currentM4Result?.results,
			hasHistoricalResult: Boolean(historicalM4Result),
			previousValue: historicalM4Result?.results,
			dimensionsAvailable: Boolean(dimensions),
		})
		: undefined;
	const m4CurrentValues = currentM4Values ? `
			<h3>Current CIELAB values</h3>
			<div class="table-wrap"><table><thead><tr><th>Channel</th><th>Mean</th><th>Standard deviation</th></tr></thead><tbody>
				<tr><th scope="row">L* · lightness</th><td>${currentM4Values.lMean.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td><td>${currentM4Values.lSd.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td></tr>
				<tr><th scope="row">a* · green–red</th><td>${currentM4Values.aMean.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td><td>${currentM4Values.aSd.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td></tr>
				<tr><th scope="row">b* · blue–yellow</th><td>${currentM4Values.bMean.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td><td>${currentM4Values.bSd.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td></tr>
			</tbody></table></div>` : '';
	const m4UnavailableSection = m4UnavailableReason ? `
		<section class="metric-section">
			<h2>M4 · CIELAB mean and standard deviation</h2>
			<p class="structural-summary">History comparison unavailable</p>
			<div class="comparison-warning"><p>${escapeHtml(m4UnavailableReason)}</p></div>
			${m4CurrentValues}
			<div class="explanation"><p>M4 remains visible because it was selected for the current assessment. A comparison is only calculated when both runs provide six numeric CIELAB values and the previous completed run matches the same project, page, metric, and screenshot dimensions.</p></div>
		</section>` : '';

	const m5Assessment = m5Match?.comparison.percentagePointDelta === 0
		? 'No measured change'
		: 'Potential layout change';
	const m5Section = m5Match ? `
		<section class="metric-section">
			<h2>M5 · White-space proportion</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m5Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous proportion</span><span class="value">${m5Match.comparison.previousProportion.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span></div>
				<div class="card"><span class="label">Current proportion</span><span class="value">${m5Match.comparison.currentProportion.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span></div>
				<div class="card"><span class="label">Absolute difference</span><span class="value">${signedNumber(m5Match.comparison.percentagePointDelta, 2)} pp</span></div>
				<div class="card"><span class="label">Assessment</span><span class="value text-value">${m5Assessment}</span></div>
			</div>
			<div class="explanation"><p>M5 is the proportion of the screenshot classified as white space. The difference is shown in percentage points: for example, 0.32 to 0.38 is +6 pp. The source associates higher values with poorly distributed content, but white space may also be an intentional layout choice. A change is therefore highlighted as a potential layout change, not an automatic regression.</p></div>
		</section>` : '';

	const m6HasChanges = m6Match
		? m6Match.comparison.added + m6Match.comparison.removed
		+ m6Match.comparison.moved + m6Match.comparison.resized > 0
		: false;
	const m6Summary = m6Match
		? m6HasChanges
			? `${structuralAction(m6Match.comparison.added, 'added', m6Match.comparison.addedTypes)}, ${structuralAction(m6Match.comparison.removed, 'removed', m6Match.comparison.removedTypes)}, ${structuralAction(m6Match.comparison.moved, 'moved', m6Match.comparison.movedTypes)}, and ${structuralAction(m6Match.comparison.resized, 'resized', m6Match.comparison.resizedTypes)}.`
			: 'No structural changes detected.'
		: '';
	const m6Section = m6Match ? `
		<section class="metric-section">
			<h2>M6 · UIED structural changes</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m6Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Added</span><span class="value">${m6Match.comparison.added}</span></div>
				<div class="card"><span class="label">Removed</span><span class="value">${m6Match.comparison.removed}</span></div>
				<div class="card"><span class="label">Moved</span><span class="value">${m6Match.comparison.moved}</span></div>
				<div class="card"><span class="label">Resized</span><span class="value">${m6Match.comparison.resized}</span></div>
			</div>
			<p class="structural-summary">${m6Summary}</p>
			<details><summary>Component-type details</summary><dl class="type-details">
				<dt>Added</dt><dd>${typeBreakdown(m6Match.comparison.addedTypes)}</dd>
				<dt>Removed</dt><dd>${typeBreakdown(m6Match.comparison.removedTypes)}</dd>
				<dt>Moved</dt><dd>${typeBreakdown(m6Match.comparison.movedTypes)}</dd>
				<dt>Resized</dt><dd>${typeBreakdown(m6Match.comparison.resizedTypes)}</dd>
			</dl></details>
			<div class="explanation"><p>This is structural change detection. UIED components are converted to normalized screenshot coordinates, paired by compatible component type and the best one-to-one bounding-box IoU assignment, then classified as added, removed, moved, or resized. The segmented preview image is not used for matching.</p></div>
		</section>` : '';

	const m7Section = m7Match ? `
		<section class="metric-section">
			<h2>M7 · UMSI saliency shift</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m7Match.previousCreatedAt).toLocaleString()}</p>
			<div class="heatmap-grid">
				<figure>${linkedComparisonImage(m7Match.previousHeatmapUrl, 'previous UMSI saliency heatmap')}<figcaption>Previous heatmap</figcaption></figure>
				<figure>${linkedComparisonImage(m7Match.currentHeatmapUrl, 'current UMSI saliency heatmap')}<figcaption>Current heatmap</figcaption></figure>
			</div>
			<div class="grid">
				<div class="card"><span class="label">Jensen–Shannon divergence</span><span class="value">${m7Match.comparison.jensenShannonDivergence.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Top-10% salient-region overlap</span><span class="value">${(m7Match.comparison.salientRegionOverlap * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span></div>
				<div class="card"><span class="label">Saliency-centre movement</span><span class="value">${(m7Match.comparison.centerMovement * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</span></div>
				<div class="card"><span class="label">Attention regions</span><span class="value text-value">${m7Match.comparison.previousRegion} → ${m7Match.comparison.currentRegion}</span></div>
			</div>
			<p class="structural-summary">${m7Match.comparison.interpretation}</p>
			<div class="explanation"><p>The current and previous saliency heatmaps are converted to intensity maps and normalized so every map sums to one. Jensen–Shannon divergence measures the overall distribution change, overlap compares the most salient 10% of locations, and centre movement tracks the probability-weighted attention centre. The overlay images are visual aids and are not used in the calculation. A shift in predicted attention has no universal better direction without a design goal.</p></div>
		</section>` : '';

	const m8Direction = m8Match
		? m8Match.comparison.absoluteDelta > 0
			? `${m8Match.comparison.absoluteDelta.toLocaleString()} ${m8Match.comparison.absoluteDelta === 1 ? 'word was' : 'words were'} added to the visible content.`
			: m8Match.comparison.absoluteDelta < 0
				? `${Math.abs(m8Match.comparison.absoluteDelta).toLocaleString()} ${m8Match.comparison.absoluteDelta === -1 ? 'word was' : 'words were'} removed from the visible content.`
				: 'The visible word count did not change.'
		: '';
	const m8Section = m8Match ? `
		<section class="metric-section">
			<h2>M8 · Word count</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m8Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous count</span><span class="value">${m8Match.comparison.previousWordCount.toLocaleString()} words</span></div>
				<div class="card"><span class="label">Current count</span><span class="value">${m8Match.comparison.currentWordCount.toLocaleString()} words</span></div>
				<div class="card"><span class="label">Absolute delta</span><span class="value">${signedNumber(m8Match.comparison.absoluteDelta)} words</span></div>
				<div class="card"><span class="label">Relative delta</span><span class="value">${relativeChange(m8Match.comparison.relativeDeltaPercent)}</span></div>
			</div>
			<p class="structural-summary">${m8Direction}</p>
			<div class="explanation"><p>M8 counts words in the visible page content. The absolute delta is current minus previous word count, and the relative delta expresses the change against the previous count. Added or removed content is reported without labeling either more or fewer words as inherently better.</p></div>
		</section>` : '';

	const m9Direction = m9Match
		? m9Match.comparison.percentagePointDelta > 0
			? 'Edge density increased; this generally indicates more visual complexity.'
			: m9Match.comparison.percentagePointDelta < 0
				? 'Edge density decreased; this generally indicates less visual complexity.'
				: 'Edge density did not change.'
		: '';
	const m9EdgeMapCards = m9Match?.comparison.edgeMapIou !== undefined
		&& m9Match.comparison.edgeMapF1 !== undefined ? `
			<div class="grid">
				<div class="card"><span class="label">Binary edge-map IoU</span><span class="value">${(m9Match.comparison.edgeMapIou * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span></div>
				<div class="card"><span class="label">Binary edge-map F1</span><span class="value">${(m9Match.comparison.edgeMapF1 * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span></div>
			</div>` : '';
	const m9EdgeImages = m9Match?.currentEdgeImageUrl && m9Match.previousEdgeImageUrl ? `
			<div class="heatmap-grid">
				<figure>${linkedComparisonImage(m9Match.previousEdgeImageUrl, 'previous binary edge map')}<figcaption>Previous edge map</figcaption></figure>
				<figure>${linkedComparisonImage(m9Match.currentEdgeImageUrl, 'current binary edge map')}<figcaption>Current edge map</figcaption></figure>
			</div>` : '';
	const m9Section = m9Match ? `
		<section class="metric-section">
			<h2>M9 · Edge density</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m9Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous edge density</span><span class="value">${(m9Match.comparison.previousDensity * 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%</span></div>
				<div class="card"><span class="label">Current edge density</span><span class="value">${(m9Match.comparison.currentDensity * 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%</span></div>
				<div class="card"><span class="label">Absolute difference</span><span class="value">${signedNumber(m9Match.comparison.percentagePointDelta, 3)} pp</span></div>
			</div>
			<p class="structural-summary">${m9Direction}</p>
			${m9EdgeImages}
			${m9EdgeMapCards}
			<div class="explanation"><p>The scalar edge density is the primary comparison. A higher density generally indicates more visual complexity. When both binary edge images are available, IoU and F1 additionally show how strongly the detected edge locations overlap, while the images help localize where the complexity pattern changed.</p></div>
		</section>` : '';

	const m10Direction = m10Match
		? m10Match.comparison.scalarDelta > 0
			? 'Feature congestion increased; this generally indicates more visual complexity.'
			: m10Match.comparison.scalarDelta < 0
				? 'Feature congestion decreased; this generally indicates less visual complexity.'
				: 'Feature congestion did not change.'
		: '';
	const m10MapCards = m10Match?.comparison.mapMeanAbsoluteDifference !== undefined
		&& m10Match.comparison.highCongestionOverlap !== undefined ? `
			<div class="grid">
				<div class="card"><span class="label">Normalized map MAD</span><span class="value">${m10Match.comparison.mapMeanAbsoluteDifference.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Top-10% congestion overlap</span><span class="value">${(m10Match.comparison.highCongestionOverlap * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span></div>
			</div>` : '';
	const m10MapImages = m10Match?.currentMapUrl && m10Match.previousMapUrl ? `
			<div class="heatmap-grid">
				<figure>${linkedComparisonImage(m10Match.previousMapUrl, 'previous feature-congestion map')}<figcaption>Previous congestion map</figcaption></figure>
				<figure>${linkedComparisonImage(m10Match.currentMapUrl, 'current feature-congestion map')}<figcaption>Current congestion map</figcaption></figure>
			</div>` : '';
	const m10Section = m10Match ? `
		<section class="metric-section">
			<h2>M10 · Feature congestion</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m10Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous congestion</span><span class="value">${m10Match.comparison.previousCongestion.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Current congestion</span><span class="value">${m10Match.comparison.currentCongestion.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Scalar delta</span><span class="value">${signedNumber(m10Match.comparison.scalarDelta, 4)}</span></div>
			</div>
			<p class="structural-summary">${m10Direction}</p>
			${m10MapImages}
			${m10MapCards}
			<div class="explanation"><p>The scalar feature-congestion score is the primary comparison. Higher values generally indicate more visual complexity. When both visualizations are available, each congestion map is normalized independently to 0–1; mean absolute difference measures overall spatial change, while overlap compares the highest-congestion 10% of locations to help localize where complexity shifted.</p></div>
		</section>` : '';

	const m11Direction = m11Match
		? m11Match.comparison.absoluteDelta > 0
			? 'Subband entropy increased; according to the metric definition, this indicates more visual complexity.'
			: m11Match.comparison.absoluteDelta < 0
				? 'Subband entropy decreased; according to the metric definition, this indicates less visual complexity.'
				: 'Subband entropy did not change.'
		: '';
	const m11Section = m11Match ? `
		<section class="metric-section">
			<h2>M11 · Subband entropy</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m11Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous entropy</span><span class="value">${m11Match.comparison.previousEntropy.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Current entropy</span><span class="value">${m11Match.comparison.currentEntropy.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Absolute delta</span><span class="value">${signedNumber(m11Match.comparison.absoluteDelta, 4)}</span></div>
				<div class="card"><span class="label">Relative delta</span><span class="value">${relativeChange(m11Match.comparison.relativeDeltaPercent)}</span></div>
			</div>
			<p class="structural-summary">${m11Direction}</p>
			<div class="explanation"><p>Subband entropy estimates visual complexity through the information carried across image subbands. The absolute delta is current minus previous entropy, and the relative delta expresses that change against the previous value. Higher entropy indicates more visual complexity according to the metric definition.</p></div>
		</section>` : '';

	const m12Direction = m12Match
		? m12Match.comparison.absoluteDelta > 0
			? 'Shannon entropy increased, indicating more detail, information, or noise.'
			: m12Match.comparison.absoluteDelta < 0
				? 'Shannon entropy decreased, indicating less detail, information, or noise.'
				: 'Shannon entropy did not change.'
		: '';
	const m12Section = m12Match ? `
		<section class="metric-section">
			<h2>M12 · Shannon information entropy</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m12Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous entropy</span><span class="value">${m12Match.comparison.previousEntropy.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Current entropy</span><span class="value">${m12Match.comparison.currentEntropy.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Absolute delta</span><span class="value">${signedNumber(m12Match.comparison.absoluteDelta, 4)}</span></div>
				<div class="card"><span class="label">Relative delta</span><span class="value">${relativeChange(m12Match.comparison.relativeDeltaPercent)}</span></div>
			</div>
			<p class="structural-summary">${m12Direction}</p>
			<div class="explanation"><p>Shannon information entropy quantifies the information and detail in the grayscale interface image. The absolute delta is current minus previous entropy, and the relative delta expresses that change against the previous value. Higher entropy can reflect more detail, information, or noise, but it is not automatically worse: research also connects entropy with aesthetics and orderliness.</p></div>
		</section>` : '';

	const m13Section = m13Match ? `
		<section class="metric-section">
			<h2>M13 · Accessibility checks</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m13Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous issues</span><span class="value">${m13Match.comparison.previousCount}</span></div>
				<div class="card"><span class="label">Current issues</span><span class="value">${m13Match.comparison.currentCount}</span></div>
				<div class="card regression-card"><span class="label">New · regressions</span><span class="value">${m13Match.comparison.newIssues.length}</span></div>
				<div class="card improvement-card"><span class="label">Resolved · improvements</span><span class="value">${m13Match.comparison.resolvedIssues.length}</span></div>
				<div class="card"><span class="label">Persistent</span><span class="value">${m13Match.comparison.persistentIssues.length}</span></div>
			</div>
			<p class="structural-summary">${escapeHtml(summarizeM13Comparison(m13Match.comparison))}</p>
			<h3>Counts by impact / severity</h3>
			<div class="table-wrap"><table><thead><tr><th>Impact</th><th>Previous</th><th>Current</th><th>Delta</th></tr></thead><tbody>${accessibilityBreakdownRows(m13Match.comparison.byImpact)}</tbody></table></div>
			<h3>Counts by rule</h3>
			<div class="table-wrap"><table><thead><tr><th>Rule</th><th>Previous</th><th>Current</th><th>Delta</th></tr></thead><tbody>${accessibilityBreakdownRows(m13Match.comparison.byRule)}</tbody></table></div>
			<details class="issue-group issue-group-new"><summary><span>New violations</span><span class="issue-group-note">Regressions · ${m13Match.comparison.newIssues.length}</span></summary>${renderAccessibilityIssueList(m13Match.comparison.newIssues)}</details>
			<details class="issue-group issue-group-resolved"><summary><span>Resolved violations</span><span class="issue-group-note">Improvements · ${m13Match.comparison.resolvedIssues.length}</span></summary>${renderAccessibilityIssueList(m13Match.comparison.resolvedIssues)}</details>
			<details class="issue-group issue-group-persistent"><summary><span>Persistent violations</span><span class="issue-group-note">Still present · ${m13Match.comparison.persistentIssues.length}</span></summary>${renderAccessibilityIssueList(m13Match.comparison.persistentIssues)}</details>
			<div class="explanation"><p>Each issue is identified by its accessibility rule ID and affected element target. Current issues absent from the previous run are new regressions; previous issues absent from the current run are resolved improvements; their intersection is persistent. Totals are also grouped independently by impact level and rule, so a stable overall count cannot hide one resolved issue being replaced by a different new issue.</p></div>
		</section>` : '';

	const m14MeanDirection = m14Match
		? m14Match.comparison.mean.delta > 0
			? 'The mean score increased, normally indicating better predicted image quality or aesthetics.'
			: m14Match.comparison.mean.delta < 0
				? 'The mean score decreased, normally indicating lower predicted image quality or aesthetics.'
				: 'The mean predicted image-quality score did not change.'
		: '';
	const m14SpreadDirection = m14Match
		? m14Match.comparison.standardDeviation.delta > 0
			? 'Predicted ratings became more spread out, indicating greater disagreement.'
			: m14Match.comparison.standardDeviation.delta < 0
				? 'Predicted ratings became less spread out, indicating greater agreement.'
				: 'The spread of predicted ratings did not change.'
		: '';
	const m14Section = m14Match ? `
		<section class="metric-section">
			<h2>M14 · NIMA</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m14Match.previousCreatedAt).toLocaleString()}</p>
			<div class="table-wrap"><table><thead><tr><th>Output</th><th>Previous</th><th>Current</th><th>Delta</th></tr></thead><tbody>
				${labComparisonRow('Mean score', m14Match.comparison.mean)}
				${labComparisonRow('Standard deviation', m14Match.comparison.standardDeviation)}
			</tbody></table></div>
			<p class="structural-summary">${m14MeanDirection}</p>
			<p class="variation-summary">${m14SpreadDirection}</p>
			<div class="explanation"><p>NIMA predicts a distribution of aesthetic image ratings. The mean and standard deviation are compared independently. A higher mean normally indicates better predicted image quality or aesthetics. Standard deviation measures disagreement or spread among predicted ratings and is not itself a quality score.</p></div>
		</section>` : '';
	const requestedMetricSections = renderRequestedHistoryMetricSections(
		requestedMetricIds,
		{
			m1: m1Section,
			m2: m2Section,
			m3: m3Section,
			m4: m4Section || (historyMetricFamilies.has('m4') ? m4UnavailableSection : ''),
			m5: m5Section,
			m6: m6Section,
			m7: m7Section,
			m8: m8Section,
			m9: m9Section,
			m10: m10Section,
			m11: m11Section,
			m12: m12Section,
			m13: m13Section,
			m14: m14Section,
		},
		historyMetricIds,
	);
	const historyImageUrls = [
		m7Match?.previousHeatmapUrl,
		m7Match?.currentHeatmapUrl,
		m9Match?.previousEdgeImageUrl,
		m9Match?.currentEdgeImageUrl,
		m10Match?.previousMapUrl,
		m10Match?.currentMapUrl,
	].filter((value): value is string => Boolean(value));
	return {
		profileOverviewHtml: profileOverview,
		comparisonSummaryHtml: `${comparisonPreviewTarget('Baseline', history.baselineRun)}<span class="comparison-preview-arrow" aria-hidden="true">→</span>${comparisonPreviewTarget('Current', history.currentRun)}`,
		comparisonHtml: `<p class="context"><strong>Comparison scope · </strong>${dimensions ? `${dimensions.width} × ${dimensions.height} px · only completed runs with identical screenshot dimensions are compared` : 'Screenshot dimensions unavailable'}</p>${runContext}${requestedMetricSections}`,
		imageUrls: historyImageUrls,
	};
}

export async function showHistoryComparison(
	currentResults: AssessmentMetricResult[],
	history: AssessmentHistory,
	url: string,
	selectedMetricIds: string[] = [],
	assessmentSelection?: unknown,
): Promise<boolean> {
	const comparison = await buildHistoryComparisonContent(
		currentResults,
		history,
		selectedMetricIds,
		assessmentSelection,
	);
	if (!comparison) { return false; }
	const panel = vscode.window.createWebviewPanel(
		'evaluationResults',
		'Evaluation Results',
		vscode.ViewColumn.One,
		{ enableScripts: false },
	);
	panel.webview.html = generateResultsHtml(
		currentResults,
		url,
		true,
		undefined,
		undefined,
		undefined,
		undefined,
		comparison,
	);
	return true;
}
