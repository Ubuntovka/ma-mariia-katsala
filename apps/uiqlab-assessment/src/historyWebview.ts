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
	type AccessibilityIssue,
	type NumericChange,
} from './metricComparisons';
import { buildWebviewContentSecurityPolicy, createWebviewNonce, escapeHtml } from './webviewSecurity';
import { renderTargetLink } from './webviewFormatting';
import {
	baseMetricId,
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

function accessibilityIssueList(issues: AccessibilityIssue[]): string {
	if (issues.length === 0) { return '<p>None</p>'; }
	return `<ul class="issue-list">${issues.map((issue) => `
		<li><strong>${escapeHtml(issue.ruleId)}</strong> · ${escapeHtml(issue.impact)}<br><code>${escapeHtml(issue.target)}</code>${issue.description ? `<br><span>${escapeHtml(issue.description)}</span>` : ''}</li>`).join('')}</ul>`;
}

function comparisonRunText(run: AssessmentRunSummary): string {
	if (run.id < 0 && run.assessedTarget) {
		return run.assessedTarget;
	}
	const commit = run.commitHash ? run.commitHash.slice(0, 8) : 'no commit';
	const dirty = run.gitDirty ? ' + working changes' : '';
	return `${commit}${dirty} · ${new Date(run.createdAt).toLocaleString()}`;
}

export async function showHistoryComparison(
	currentResults: AssessmentMetricResult[],
	history: AssessmentHistory,
	url: string,
	selectedMetricIds: string[] = [],
	assessmentSelection?: unknown,
): Promise<boolean> {
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
	const m6Match = dimensions
		? findM6HistoryComparison(currentResults, history, dimensions)
		: undefined;
	const m11Match = findM11HistoryComparison(currentResults, history);
	const m12Match = findM12HistoryComparison(currentResults, history);
	const m13Match = findM13HistoryComparison(currentResults, history);
	const m14Match = findM14HistoryComparison(currentResults, history);
	const m7Match = await findM7HistoryComparison(currentResults, history);
	const m8Match = findM8HistoryComparison(currentResults, history);
	const m9Match = await findM9HistoryComparison(currentResults, history);
	const m10Match = await findM10HistoryComparison(currentResults, history);
	if (!profileOverview && requestedMetricIds.length === 0) {
		return false;
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
				<figure><img src="${escapeHtml(m7Match.previousHeatmapUrl)}" alt="Previous UMSI saliency heatmap"><figcaption>Previous heatmap</figcaption></figure>
				<figure><img src="${escapeHtml(m7Match.currentHeatmapUrl)}" alt="Current UMSI saliency heatmap"><figcaption>Current heatmap</figcaption></figure>
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
			? 'Edge density increased; this generally indicates more visual clutter.'
			: m9Match.comparison.percentagePointDelta < 0
				? 'Edge density decreased; this generally indicates less visual clutter.'
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
				<figure><img src="${escapeHtml(m9Match.previousEdgeImageUrl)}" alt="Previous binary edge map"><figcaption>Previous edge map</figcaption></figure>
				<figure><img src="${escapeHtml(m9Match.currentEdgeImageUrl)}" alt="Current binary edge map"><figcaption>Current edge map</figcaption></figure>
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
			<div class="explanation"><p>The scalar edge density is the primary comparison. A higher density generally indicates more visual clutter. When both binary edge images are available, IoU and F1 additionally show how strongly the detected edge locations overlap, while the images help localize where the clutter pattern changed.</p></div>
		</section>` : '';

	const m10Direction = m10Match
		? m10Match.comparison.scalarDelta > 0
			? 'Feature congestion increased; this generally indicates more display clutter.'
			: m10Match.comparison.scalarDelta < 0
				? 'Feature congestion decreased; this generally indicates less display clutter.'
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
				<figure><img src="${escapeHtml(m10Match.previousMapUrl)}" alt="Previous feature-congestion map"><figcaption>Previous congestion map</figcaption></figure>
				<figure><img src="${escapeHtml(m10Match.currentMapUrl)}" alt="Current feature-congestion map"><figcaption>Current congestion map</figcaption></figure>
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
			<div class="explanation"><p>The scalar feature-congestion score is the primary comparison. Higher values generally indicate more display clutter. When both visualizations are available, each congestion map is normalized independently to 0–1; mean absolute difference measures overall spatial change, while overlap compares the highest-congestion 10% of locations to help localize where clutter shifted.</p></div>
		</section>` : '';

	const m11Direction = m11Match
		? m11Match.comparison.absoluteDelta > 0
			? 'Subband entropy increased; according to the metric definition, this indicates more visual clutter.'
			: m11Match.comparison.absoluteDelta < 0
				? 'Subband entropy decreased; according to the metric definition, this indicates less visual clutter.'
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
			<div class="explanation"><p>Subband entropy estimates visual clutter through the information carried across image subbands. The absolute delta is current minus previous entropy, and the relative delta expresses that change against the previous value. Higher entropy indicates more visual clutter according to the metric definition.</p></div>
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
			<details><summary>New violations · regressions (${m13Match.comparison.newIssues.length})</summary>${accessibilityIssueList(m13Match.comparison.newIssues)}</details>
			<details><summary>Resolved violations · improvements (${m13Match.comparison.resolvedIssues.length})</summary>${accessibilityIssueList(m13Match.comparison.resolvedIssues)}</details>
			<details><summary>Persistent violations (${m13Match.comparison.persistentIssues.length})</summary>${accessibilityIssueList(m13Match.comparison.persistentIssues)}</details>
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
	const nonce = createWebviewNonce();
	const contentSecurityPolicy = buildWebviewContentSecurityPolicy(nonce, historyImageUrls);

	const panel = vscode.window.createWebviewPanel(
		'historyComparison',
		'Assessment History Comparison',
		vscode.ViewColumn.Beside,
		{ enableScripts: false }
	);

	panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy)}">
	<title>Assessment History Comparison</title>
	<style nonce="${nonce}">
		:root {
			--canvas: #f1f4f6;
			--surface: #ffffff;
			--surface-subtle: #eef3f5;
			--surface-muted: #e4eaee;
			--surface-comparison: #dcecf3;
			--surface-warning: #fff8e9;
			--ink: #101b24;
			--ink-soft: #334550;
			--muted: #52626d;
			--header: #102f46;
			--heading: #12364f;
			--accent: #0b746f;
			--accent-strong: #075e5a;
			--comparison: #2d708f;
			--comparison-strong: #1d5874;
			--border: #bcc9d1;
			--success: #14774f;
			--danger: #aa3434;
			--warning: #96600f;
		}
		* { box-sizing: border-box; }
		body { min-height: 100vh; margin: 0; padding: 28px 20px; color: var(--ink); background: var(--canvas); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; }
		.history-shell { max-width: 960px; margin: 0 auto; overflow: hidden; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); box-shadow: 0 16px 40px rgba(16, 47, 70, .18); }
		.comparison-header { padding: 26px 30px 28px; border-bottom: 5px solid var(--comparison); background: var(--header); color: #fff; }
		.page-kicker { display: block; margin-bottom: 7px; color: #78c9be; font-size: 11px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }
		.comparison-header h1 { margin: 0 0 9px; font-size: 30px; font-weight: 650; letter-spacing: -.02em; }
		.comparison-mode { display: flex; align-items: center; gap: 8px; margin: 0; color: #d3dee4; font-size: 15px; font-weight: 550; }
		.comparison-mode span { color: #91bfd1; font-size: 17px; }
		.target-display { margin-top: 16px; padding: 10px 13px; border: 1px solid rgba(255, 255, 255, .28); border-left: 4px solid #65c9bd; border-radius: 6px; background: rgba(255, 255, 255, .08); color: #edf5f7; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 13px; word-break: break-all; }
		.target-link { color: #fff; font-weight: 600; text-decoration-color: #65c9bd; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }
		.target-link:hover { color: #bff3ec; text-decoration-thickness: 2px; }
		.target-link:focus-visible { border-radius: 2px; outline: 2px solid #8de0d5; outline-offset: 3px; }
		.comparison-content { padding: 30px; }
		h2 { margin: 0 0 6px; color: var(--heading); font-size: 21px; font-weight: 700; }
		h3 { margin: 20px 0 10px; color: var(--heading); font-size: 15px; }
		.context { margin: 0 0 16px; padding: 11px 13px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-muted); color: var(--ink-soft); font-size: 13px; line-height: 1.5; }
		.context strong { color: var(--ink-soft); }
		.run-pair { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: stretch; gap: 10px; margin: 0 0 26px; }
		.run-chip { min-width: 0; padding: 14px 15px; border: 1px solid var(--border); border-top: 4px solid #82939d; border-radius: 7px; background: var(--surface-subtle); }
		.run-chip span { display: block; margin-bottom: 5px; color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
		.run-chip strong { display: block; overflow: hidden; color: var(--ink); font-size: 13px; font-weight: 650; line-height: 1.45; text-overflow: ellipsis; }
		.current-run { border-color: var(--comparison); border-top-width: 4px; background: var(--surface-comparison); }
		.current-run span { color: var(--comparison-strong); }
		.run-arrow { display: grid; width: 28px; place-items: center; color: var(--comparison); font-size: 20px; }
		.metric-section { margin: 0 0 20px; padding: 22px; border: 1px solid var(--border); border-left: 5px solid var(--comparison); border-radius: 7px; background: var(--surface-subtle); box-shadow: 0 3px 10px rgba(16, 47, 70, .08); }
		.previous-run { margin: 0 0 16px; color: var(--muted); font-size: 13px; }
		.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px; }
		.card { padding: 16px; border: 1px solid var(--border); border-top: 4px solid #82939d; border-radius: 7px; background: var(--surface); }
		.card:nth-child(2) { border-color: var(--comparison); border-top-width: 4px; background: var(--surface-comparison); }
		.card:nth-child(2) .label, .card:nth-child(2) .value { color: var(--comparison-strong); }
		.regression-card { border-color: var(--vscode-testing-iconFailed, var(--danger)); }
		.improvement-card { border-color: var(--vscode-testing-iconPassed, var(--success)); }
		.label { display: block; margin-bottom: 8px; color: var(--muted); font-size: 12px; font-weight: 750; text-transform: uppercase; letter-spacing: .05em; }
		.value { color: var(--ink); font-size: 23px; font-weight: 700; }
		.text-value { font-size: 18px; }
		.wide-card { grid-column: 1 / -1; }
		.compact-grid { grid-template-columns: minmax(220px, 300px); margin-top: 14px; }
		.table-wrap { overflow-x: auto; margin-bottom: 14px; border: 1px solid var(--border); border-radius: 7px; }
		table { width: 100%; border-collapse: collapse; background: var(--surface); }
		th, td { padding: 11px 13px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); text-align: right; }
		th:last-child, td:last-child { border-right: 0; }
		tbody tr:last-child td { border-bottom: 0; }
		tbody tr:nth-child(even) { background: var(--surface-subtle); }
		th:first-child, td:first-child { text-align: left; }
		thead th { background: var(--surface-muted); color: var(--ink-soft); font-size: 12px; font-weight: 750; text-transform: uppercase; letter-spacing: .05em; }
		thead th:nth-child(3), tbody td:nth-child(3) { background: var(--surface-comparison); color: var(--comparison-strong); font-weight: 700; }
		tbody td:nth-child(2) { font-weight: 600; }
		.variation-summary { margin: 8px 0 18px; color: var(--muted); }
		.structural-summary { margin: 2px 0 16px; color: var(--ink-soft); font-size: 17px; font-weight: 600; }
		details { margin: 0 0 18px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
		summary { cursor: pointer; color: var(--ink-soft); font-weight: 600; }
		.type-details { display: grid; grid-template-columns: max-content 1fr; gap: 7px 14px; margin: 14px 0 0; }
		.type-details dt { color: var(--muted); }
		.type-details dd { margin: 0; }
		.issue-list { margin: 12px 0 0; padding-left: 22px; }
		.issue-list li { margin-bottom: 12px; line-height: 1.45; }
		.issue-list code { color: var(--accent-strong); word-break: break-all; }
		.heatmap-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin-bottom: 18px; }
		figure { margin: 0; }
		figure img { display: block; width: 100%; max-height: 280px; object-fit: contain; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
		figcaption { margin-top: 7px; color: var(--muted); text-align: center; }
		.explanation { padding: 16px; border-left: 4px solid var(--accent); border-radius: 5px; background: var(--surface-comparison); color: var(--ink-soft); line-height: 1.55; }
		.explanation p { margin: 0; }
		.comparison-warning { margin-bottom: 18px; padding: 14px 16px; border-left: 4px solid var(--warning); border-radius: 5px; background: var(--surface-warning); line-height: 1.5; }
		.comparison-warning p { margin: 0; }
		.metric-unavailable { border-left-color: var(--muted); }
		.metric-unavailable h2 { margin-bottom: 14px; }
		.baseline-empty { display: flex; align-items: center; gap: 14px; padding: 16px; border: 1px dashed var(--border); border-radius: 8px; background: var(--surface); }
		.baseline-empty-icon { display: grid; flex: 0 0 34px; width: 34px; height: 34px; place-items: center; border: 1px solid var(--muted); border-radius: 50%; color: var(--muted); font-size: 20px; }
		.baseline-empty strong { display: block; margin-bottom: 3px; font-size: 15px; }
		.baseline-empty p { margin: 0; color: var(--muted); line-height: 1.45; }
		.profile-overview { --goal-color: var(--muted); margin: 0 0 24px; padding: 22px; border: 1px solid var(--goal-color); border-top: 4px solid var(--goal-color); border-radius: 9px; background: var(--surface); }
		.profile-overview.status-achieved, .profile-card.status-achieved { --goal-color: var(--vscode-testing-iconPassed, var(--success)); }
		.profile-overview.status-not-achieved, .profile-card.status-not-achieved { --goal-color: var(--vscode-testing-iconFailed, var(--danger)); }
		.profile-overview.status-partial, .profile-card.status-partial { --goal-color: var(--vscode-editorWarning-foreground, var(--warning)); }
		.profile-overview.status-observed, .profile-card.status-observed { --goal-color: var(--comparison); }
		.profile-overview.status-unchanged, .profile-card.status-unchanged { --goal-color: var(--comparison); }
		.profile-overview.status-not-comparable, .profile-card.status-not-comparable { --goal-color: var(--muted); }
		.goal-summary { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
		.goal-icon { display: grid; flex: 0 0 44px; width: 44px; height: 44px; place-items: center; border: 2px solid var(--goal-color); border-radius: 50%; color: var(--goal-color); font-size: 25px; font-weight: 700; }
		.eyebrow { display: block; margin-bottom: 4px; color: var(--goal-color); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
		.goal-summary h2 { margin-bottom: 5px; }
		.goal-summary p { margin: 0; color: var(--muted); line-height: 1.5; }
		.profile-summary-grid { display: grid; gap: 12px; }
		.profile-card { --goal-color: var(--muted); padding: 16px; border: 1px solid var(--border); border-left: 4px solid var(--goal-color); border-radius: 8px; background: var(--surface-subtle); }
		.profile-card-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
		.profile-card h3 { margin: 0 0 3px; font-size: 16px; }
		.profile-direction { margin: 0; color: var(--muted); font-size: 12px; }
		.status-pill { flex: 0 0 auto; padding: 4px 8px; border: 1px solid var(--goal-color); border-radius: 999px; color: var(--goal-color); font-size: 11px; font-weight: 700; }
		.outcome-track { display: flex; width: 100%; height: 9px; margin: 15px 0 8px; overflow: hidden; border-radius: 999px; background: var(--border); }
		.outcome-track span { flex: 1; min-width: 2px; }
		.track-aligned, .legend-aligned { background: var(--vscode-testing-iconPassed, var(--success)); }
		.track-unchanged, .legend-unchanged { background: var(--muted); }
		.track-opposed, .legend-opposed { background: var(--vscode-testing-iconFailed, var(--danger)); }
		.track-neutral { background: var(--muted); opacity: .5; }
		.outcome-legend, .track-key { display: flex; flex-wrap: wrap; gap: 8px 14px; color: var(--muted); font-size: 11px; }
		.outcome-legend i, .track-key i { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; }
		.profile-reason { margin: 12px 0 0; line-height: 1.45; }
		.track-key { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); }
		@media (max-width: 620px) {
			body { padding: 12px; }
			.comparison-header, .comparison-content { padding: 22px 18px; }
			.run-pair { grid-template-columns: 1fr; }
			.run-arrow { width: auto; height: 20px; transform: rotate(90deg); }
			.profile-card-heading { display: block; }
			.status-pill { display: inline-block; margin-top: 10px; }
		}
	</style>
</head>
<body>
	<div class="history-shell">
		<header class="comparison-header">
			<span class="page-kicker">Assessment history</span>
			<h1>Run comparison</h1>
			<p class="comparison-mode">Baseline <span aria-hidden="true">→</span> Current · ${requestedMetricIds.length} ${requestedMetricIds.length === 1 ? 'metric' : 'metrics'}</p>
			<div class="target-display">Target · ${renderTargetLink(url)}</div>
		</header>
		<main class="comparison-content">
			<p class="context"><strong>Comparison scope · </strong>${dimensions ? `${dimensions.width} × ${dimensions.height} px · only completed runs with identical screenshot dimensions are compared` : 'Screenshot dimensions unavailable'}</p>
			${runContext}
			${profileOverview}
			${requestedMetricSections}
		</main>
	</div>
</body>
</html>`;
	return true;
}
