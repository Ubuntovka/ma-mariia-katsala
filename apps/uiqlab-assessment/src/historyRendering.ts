import { getMetricDefinition } from './metricCatalog';
import { ASSESSMENT_PROFILES } from './assessmentProfiles';
import type { ProfileAssessmentSummary, ProfileGoalStatus, ProfileOutcome } from './profileAssessment';
import type { AssessmentMetricResult } from './runAssessment';
import type { AccessibilityIssue } from './metricComparisons';
import { escapeHtml } from './webviewSecurity';

export interface HistoryComparisonContent {
	profileOverviewHtml: string;
	comparisonSummaryHtml: string;
	comparisonHtml: string;
	imageUrls: string[];
}

export function baseMetricId(metricId: string): string {
	return metricId.split('_')[0].toLowerCase();
}

export function requestedHistoryMetricIds(selectedMetricIds: readonly string[], currentResults: readonly AssessmentMetricResult[]): string[] {
	const candidates = selectedMetricIds.length > 0
		? selectedMetricIds
		: currentResults
			.map((result) => result?.metric_id)
			.filter((metricId): metricId is string => typeof metricId === 'string');
	return [...new Set(candidates
		.map(baseMetricId)
		.filter((metricId) => Boolean(getMetricDefinition(metricId))))];
}

export function renderUnavailableHistoryMetricSection(metricId: string, baselineExists: boolean): string {
	const definition = getMetricDefinition(metricId);
	const name = definition?.name ?? metricId.toUpperCase();
	const status = baselineExists ? 'Comparison unavailable' : 'No baseline available';
	const detail = baselineExists
		? 'A historical result exists, but its values could not be compared with this run.'
		: 'This requested metric has no compatible historical result. See Evaluation Results for this run’s output.';
	return `<section class="metric-section metric-unavailable">
		<h2>${escapeHtml(metricId.toUpperCase())} · ${escapeHtml(name)}</h2>
		<div class="baseline-empty"><span class="baseline-empty-icon" aria-hidden="true">—</span><div><strong>${status}</strong><p>${detail}</p></div></div>
	</section>`;
}

export function renderRequestedHistoryMetricSections(
	requestedMetricIds: readonly string[],
	comparableSections: Readonly<Partial<Record<string, string>>>,
	historyMetricIds: readonly string[],
): string {
	const baselineFamilies = new Set(historyMetricIds.map(baseMetricId));
	return requestedMetricIds.map((metricId) =>
		comparableSections[metricId]
			|| renderUnavailableHistoryMetricSection(metricId, baselineFamilies.has(metricId))
	).join('');
}

export function renderAccessibilityIssueList(issues: readonly AccessibilityIssue[]): string {
	if (issues.length === 0) {
		return '<p class="issue-empty">No violations in this group.</p>';
	}
	return `<ol class="issue-list">${issues.map((issue) => `<li class="issue-card">
		<div class="issue-card-heading"><strong class="issue-rule">${escapeHtml(issue.ruleId)}</strong><span class="issue-impact">${escapeHtml(issue.impact)}</span></div>
		<div class="issue-target"><span class="issue-field-label">Affected element</span><code>${escapeHtml(issue.target)}</code></div>
		${issue.description ? `<p class="issue-description">${escapeHtml(issue.description)}</p>` : ''}
	</li>`).join('')}</ol>`;
}

function profileDisplayName(id: string): string {
	const words = id.replace(/-/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function goalStatusPresentation(status: ProfileGoalStatus): { label: string; icon: string } {
	switch (status) {
		case 'achieved': return { label: 'Goal achieved', icon: '✓' };
		case 'not-achieved': return { label: 'Goal not achieved', icon: '×' };
		case 'partial': return { label: 'Partially achieved', icon: '◐' };
		case 'observed': return { label: 'Change observed', icon: '↕' };
		case 'unchanged': return { label: 'No meaningful change', icon: '—' };
		case 'not-comparable': return { label: 'Not comparable', icon: '?' };
	}
}

function renderProfileOutcomeTrack(outcome: ProfileOutcome): string {
	if (outcome.comparableMetrics.length === 0) {
		return '<div class="outcome-track"><span class="track-neutral"></span></div>';
	}
	const total = outcome.comparableMetrics.length;
	const unchangedCount = Math.max(0, total - outcome.alignedMetrics.length - outcome.opposedMetrics.length);
	const segments = [
		...Array.from({ length: outcome.alignedMetrics.length }, () => '<span class="track-aligned"></span>'),
		...Array.from({ length: unchangedCount }, () => '<span class="track-unchanged"></span>'),
		...Array.from({ length: outcome.opposedMetrics.length }, () => '<span class="track-opposed"></span>'),
	].join('');
	return `<div class="outcome-track" aria-label="${outcome.alignedMetrics.length} aligned, ${outcome.opposedMetrics.length} opposed, ${total - outcome.meaningfulMetrics.length} unchanged">
		${segments}
	</div>`;
}

function renderProfileMetrics(outcome: ProfileOutcome): string {
	const assessedMetrics = ASSESSMENT_PROFILES[outcome.id]?.metrics ?? outcome.comparableMetrics;
	const items = assessedMetrics.map((metricId) => {
		const definition = getMetricDefinition(metricId);
		const metricName = definition?.name ?? metricId.toUpperCase();
		let className = 'not-comparable';
		let icon = '?';
		let contribution = 'Not comparable';
		if (outcome.alignedMetrics.includes(metricId)) {
			className = 'aligned';
			icon = '✓';
			contribution = outcome.direction === 'observe' ? 'Contributed to observed change' : 'Contributed to goal';
		} else if (outcome.opposedMetrics.includes(metricId)) {
			className = 'opposed';
			icon = '×';
			contribution = 'Worked against goal';
		} else if (outcome.comparableMetrics.includes(metricId)) {
			className = 'unchanged';
			icon = '—';
			contribution = 'No meaningful change';
		}
		return `<li class="profile-metric metric-${className}">
			<span class="profile-metric-name"><strong>${escapeHtml(metricId.toUpperCase())}</strong>${escapeHtml(metricName)}</span>
			<span class="profile-metric-impact"><i aria-hidden="true">${icon}</i>${contribution}</span>
		</li>`;
	}).join('');
	return `<div class="profile-metrics"><p class="profile-metrics-title">Metrics assessed</p><ul>${items}</ul></div>`;
}

export function renderProfileAssessmentOverview(summary: ProfileAssessmentSummary): string {
	const overall = goalStatusPresentation(summary.status);
	const outcomeCards = summary.outcomes.map((outcome) => {
		const presentation = goalStatusPresentation(outcome.goalStatus);
		const metricLegend = outcome.comparableMetrics.length > 0
			? `<div class="outcome-legend"><span><i class="legend-aligned"></i>${outcome.alignedMetrics.length} aligned</span><span><i class="legend-unchanged"></i>${outcome.comparableMetrics.length - outcome.meaningfulMetrics.length} unchanged</span><span><i class="legend-opposed"></i>${outcome.opposedMetrics.length} opposed</span></div>`
			: '<div class="outcome-legend"><span>No comparable primary metrics</span></div>';
		return `<article class="profile-card status-${outcome.goalStatus}">
			<div class="profile-card-heading"><div><h3>${escapeHtml(profileDisplayName(outcome.id))}</h3><p class="profile-direction">Chosen direction: <strong>${escapeHtml(outcome.direction)}</strong></p></div><span class="status-pill"><span aria-hidden="true">${presentation.icon}</span> ${presentation.label}</span></div>
			${renderProfileOutcomeTrack(outcome)}
			${metricLegend}
			${renderProfileMetrics(outcome)}
			<p class="profile-reason">${escapeHtml(outcome.reason)}</p>
		</article>`;
	}).join('');

	return `<section class="profile-overview status-${summary.status}" aria-labelledby="profile-goal-title">
		<div class="goal-summary">
			<div class="goal-icon" aria-hidden="true">${overall.icon}</div>
			<div><span class="eyebrow">Profile goal assessment</span><h2 id="profile-goal-title">${escapeHtml(summary.title)}</h2><p>${escapeHtml(summary.description)}</p></div>
		</div>
		<div class="profile-summary-grid">${outcomeCards}</div>
		<div class="track-key"><span><i class="legend-aligned"></i>Follows direction</span><span><i class="legend-unchanged"></i>No meaningful change</span><span><i class="legend-opposed"></i>Opposes direction</span></div>
	</section>`;
}
