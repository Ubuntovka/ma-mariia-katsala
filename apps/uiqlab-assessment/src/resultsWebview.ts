import {
	getMetricInfoById,
	type AssessmentMetricResult,
	type CustomMetricLlmFeedback,
	type ProfileLlmFeedback,
} from './runAssessment';
import {
	buildWebviewContentSecurityPolicy,
	createWebviewNonce,
	escapeHtml,
	safeWebviewImageUrl,
} from './webviewSecurity';
import { renderExplanationHtml, renderTargetLink } from './webviewFormatting';

function profileFeedbackStatus(status: string): { className: string; label: string; icon: string } {
	switch (status) {
		case 'achieved': return { className: 'achieved', label: 'Goal achieved', icon: '✓' };
		case 'not-achieved': return { className: 'not-achieved', label: 'Goal not achieved', icon: '×' };
		case 'partial': return { className: 'partial', label: 'Partially achieved', icon: '◐' };
		case 'observed': return { className: 'observed', label: 'Change observed', icon: '↕' };
		case 'unchanged': return { className: 'unchanged', label: 'No meaningful change', icon: '—' };
		default: return { className: 'not-comparable', label: 'Not comparable', icon: '?' };
	}
}

/** Render validated, structured profile guidance without interpreting model output as HTML. */
export function renderProfileLlmFeedback(feedback: ProfileLlmFeedback): string {
	const status = profileFeedbackStatus(feedback.goalStatus);
	const changes = Array.isArray(feedback.changes)
		? feedback.changes.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 3)
		: [];
	const suggestions = Array.isArray(feedback.suggestions)
		? feedback.suggestions.filter((item) => item && typeof item.title === 'string' && typeof item.action === 'string').slice(0, 4)
		: [];
	const sourceFiles = Array.isArray(feedback.sourceFiles)
		? feedback.sourceFiles.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 10)
		: [];
	const sourceLabel = feedback.sourceContextUsed && sourceFiles.length > 0
		? `Based on metrics and ${sourceFiles.length} source file${sourceFiles.length === 1 ? '' : 's'}`
		: 'Based on metrics only';
	const changesHtml = changes.length > 0
		? `<div class="feedback-changes">${changes.map((change) => `<div class="change-chip"><span aria-hidden="true">↳</span><span>${escapeHtml(change)}</span></div>`).join('')}</div>`
		: '';
	const suggestionsHtml = suggestions.length > 0
		? `<div class="suggestion-grid">${suggestions.map((suggestion, index) => {
			const files = Array.isArray(suggestion.files)
				? suggestion.files.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 4)
				: [];
			return `<article class="suggestion-card">
				<div class="suggestion-number">${index + 1}</div>
				<div><h3>${escapeHtml(suggestion.title)}</h3><p class="suggestion-action">${escapeHtml(suggestion.action)}</p>${suggestion.rationale ? `<p class="suggestion-rationale">Why: ${escapeHtml(suggestion.rationale)}</p>` : ''}${files.length > 0 ? `<div class="file-chips">${files.map((file) => `<code>${escapeHtml(file)}</code>`).join('')}</div>` : ''}</div>
			</article>`;
		}).join('')}</div>`
		: '<p class="no-suggestions">No code suggestions were returned for this assessment.</p>';

	return `<section class="profile-ai-feedback status-${status.className}" aria-labelledby="profile-ai-title">
		<div class="profile-ai-heading">
			<div class="profile-ai-icon" aria-hidden="true">${status.icon}</div>
			<div><span class="eyebrow">AI profile guidance</span><h2 id="profile-ai-title">${escapeHtml(feedback.goalTitle || 'Profile assessment')}</h2></div>
			<span class="profile-ai-status">${status.label}</span>
		</div>
		<p class="profile-ai-summary">${escapeHtml(feedback.summary)}</p>
		${changesHtml}
		<div class="suggestions-heading"><h3>Suggested next steps</h3><span class="context-badge" title="Source context supplied to the configured LLM provider">${escapeHtml(sourceLabel)}</span></div>
		${suggestionsHtml}
		<p class="ai-note">AI-generated suggestions. Validate changes against the profile goal and metric results below.</p>
	</section>`;
}

/** Render validated custom-metric analysis as an evidence-to-action sequence. */
export function renderCustomMetricLlmFeedback(feedback: CustomMetricLlmFeedback): string {
	const findings = Array.isArray(feedback.findings)
		? feedback.findings.filter((item) => item
			&& typeof item.title === 'string'
			&& typeof item.observation === 'string'
			&& typeof item.interpretation === 'string'
			&& typeof item.recommendation === 'string').slice(0, 6)
		: [];
	const materialChangeCount = Number.isInteger(feedback.materialChangeCount) && feedback.materialChangeCount >= 0
		? feedback.materialChangeCount
		: 0;
	const sourceFiles = Array.isArray(feedback.sourceFiles)
		? feedback.sourceFiles.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 10)
		: [];
	const sourceLabel = feedback.sourceContextUsed && sourceFiles.length > 0
		? `Based on metrics and ${sourceFiles.length} source file${sourceFiles.length === 1 ? '' : 's'}`
		: 'Based on metrics only';
	const modeLabel = feedback.analysisMode === 'comparison'
		? `Baseline comparison · ${materialChangeCount} material change${materialChangeCount === 1 ? '' : 's'}`
		: 'Current-state analysis';
	const findingCards = findings.length > 0
		? `<div class="custom-finding-list">${findings.map((finding, index) => {
			const metricIds = Array.isArray(finding.metricIds)
				? finding.metricIds.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 6)
				: [];
			const files = Array.isArray(finding.files)
				? finding.files.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 4)
				: [];
			return `<article class="custom-finding-card">
				<div class="custom-finding-index" aria-hidden="true">${index + 1}</div>
				<div class="custom-finding-content">
					<div class="custom-finding-heading"><h3>${escapeHtml(finding.title)}</h3>${metricIds.length > 0 ? `<div class="metric-chips">${metricIds.map((metricId) => `<span>${escapeHtml(metricId)}</span>`).join('')}</div>` : ''}</div>
					<div class="analysis-step evidence-step"><span class="analysis-step-label">Measured evidence</span><p>${escapeHtml(finding.observation)}</p></div>
					<div class="analysis-connector" aria-hidden="true">↓</div>
					<div class="analysis-step interpretation-step"><span class="analysis-step-label">Technical interpretation</span><p>${escapeHtml(finding.interpretation)}</p></div>
					<div class="analysis-connector" aria-hidden="true">↓</div>
					<div class="analysis-step recommendation-step"><span class="analysis-step-label">Practical next step</span><p>${escapeHtml(finding.recommendation)}</p>${files.length > 0 ? `<div class="file-chips">${files.map((file) => `<code>${escapeHtml(file)}</code>`).join('')}</div>` : ''}</div>
				</div>
			</article>`;
		}).join('')}</div>`
		: feedback.analysisMode === 'comparison'
			? `<div class="custom-no-findings"><strong>No material metric changes identified</strong><p>The comparison did not meet the fixed reporting thresholds. Review the metric results below if smaller changes are relevant to the current engineering objective.</p></div>`
			: `<div class="custom-no-findings"><strong>No structured findings returned</strong><p>This assessment has no compatible baseline. Use the current metric values below as the reference point for a subsequent comparison.</p></div>`;

	return `<section class="custom-ai-feedback" aria-labelledby="custom-ai-title">
		<div class="custom-ai-heading">
			<div class="custom-ai-icon" aria-hidden="true">AI</div>
			<div class="custom-ai-title"><span class="custom-eyebrow">AI custom-metric analysis</span><h2 id="custom-ai-title">Technical assessment interpretation</h2></div>
			<div class="custom-ai-badges"><span class="analysis-mode-badge">${modeLabel}</span><span class="context-badge" title="Source context supplied to the configured LLM provider">${escapeHtml(sourceLabel)}</span></div>
		</div>
		<p class="custom-ai-summary">${escapeHtml(feedback.summary)}</p>
		<div class="custom-analysis-key"><span><i class="key-evidence"></i>Observation</span><span><i class="key-interpretation"></i>Interpretation</span><span><i class="key-recommendation"></i>Practical action</span></div>
		${findingCards}
		<p class="ai-note">AI-generated technical analysis. Confirm implemented changes against the metric values and project requirements.</p>
	</section>`;
}

export function generateResultsHtml(
	results: AssessmentMetricResult[],
	url: string,
	isComplete: boolean = true,
	explanation?: string | null,
	explanationError?: string,
	profileFeedback?: ProfileLlmFeedback,
	customFeedback?: CustomMetricLlmFeedback,
): string {
	const inputResults = Array.isArray(results) ? results : [];
	const imageUrls = new Set<string>();
	// Filter out results that are completely empty, but keep them if they are the only ones for a metric
	const filteredResults = inputResults.filter((r, i) => {
		if (Array.isArray(r?.results) && r.results.length > 0) {
			return true;
		}
		// If it's empty, check if there's any other non-empty result for the same metric_id
		const hasNonEmpty = inputResults.some((other, j) =>
			i !== j &&
			other?.metric_id === r?.metric_id &&
			Array.isArray(other.results) &&
			other.results.length > 0
		);
		return !hasNonEmpty;
	});

	const resultItems = (filteredResults.length > 0 ? filteredResults : []).map((r) => {
		const metricId = typeof r?.metric_id === 'string' ? r.metric_id : 'Unknown metric';
		const metric = getMetricInfoById(metricId);
		const metricName = metric?.name || metricId;
		const resultValues = Array.isArray(r?.results) ? r.results : [r?.results];

		return `
		<div class="metric-result">
			<h3>${escapeHtml(metricName)}</h3>
			<div class="result-values">
				${resultValues.map((val: unknown, i: number) => {
			let displayVal = '';
			const imageUrl = safeWebviewImageUrl(val);
			if (imageUrl) {
				imageUrls.add(imageUrl);
				displayVal = `<img class="result-image" src="${escapeHtml(imageUrl)}" alt="Result ${i + 1} visual output" />`;
			} else if (typeof val === 'object' && val !== null) {
				let serialized: string;
				try {
					serialized = JSON.stringify(val, null, 2) ?? String(val);
				} catch {
					serialized = '[Result could not be serialized]';
				}
				displayVal = `<pre class="result-json">${escapeHtml(serialized)}</pre>`;
			} else {
				displayVal = escapeHtml(String(val ?? ''));
			}
			return `<div class="result-item"><strong>Result ${i + 1}:</strong> ${displayVal}</div>`;
		}).join('')}
			</div>
		</div>
		`;
	}).join('');
	const explanationHtml = profileFeedback
		? renderProfileLlmFeedback(profileFeedback)
		: customFeedback
			? renderCustomMetricLlmFeedback(customFeedback)
			: explanationError
				? `<section class="ai-explanation unavailable"><h2>AI explanation unavailable</h2><p>${escapeHtml(explanationError)} The assessment results are still shown below.</p></section>`
				: explanation === undefined ? '' : explanation
					? `<section class="ai-explanation"><h2>Plain-language explanation</h2>${renderExplanationHtml(explanation)}<p class="ai-note">AI-generated interpretation. Verify important decisions against the metric values below.</p></section>`
					: `<section class="ai-explanation unavailable"><h2>Plain-language explanation</h2><p>${escapeHtml(explanationError || 'The AI explanation is unavailable.')} The assessment results are still shown below.</p></section>`;
	const nonce = createWebviewNonce();
	const contentSecurityPolicy = buildWebviewContentSecurityPolicy(nonce, imageUrls);

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy)}">
	<title>Evaluation Results</title>
	<style nonce="${nonce}">
		:root {
			--canvas: #f1f4f6;
			--surface: #ffffff;
			--surface-subtle: #eef3f5;
			--surface-accent: #e5f3f0;
			--surface-muted: #e4eaee;
			--surface-warning: #fff8e9;
			--surface-evidence: #edf0f2;
			--surface-interpretation: #e8f2f7;
			--surface-recommendation: #e5f3f0;
			--step-evidence: #60717b;
			--step-interpretation: #1f688c;
			--step-recommendation: #0b746f;
			--ink: #101b24;
			--ink-soft: #334550;
			--muted: #52626d;
			--header: #102f46;
			--navy: #12364f;
			--navy-light: #1f5875;
			--accent: #0b746f;
			--accent-strong: #075e5a;
			--accent-soft: #d2ebe7;
			--border: #bcc9d1;
			--success: #14774f;
			--danger: #aa3434;
			--warning: #96600f;
		}
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
			background: var(--canvas);
			min-height: 100vh;
			padding: 28px 20px;
			color: var(--ink);
		}
		.container {
			max-width: 960px;
			margin: 0 auto;
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: 10px;
			box-shadow: 0 16px 40px rgba(16, 47, 70, .18);
			overflow: hidden;
		}
		.header {
			background: var(--header);
			color: white;
			padding: 28px 30px 30px;
			border-bottom: 5px solid var(--accent);
		}
		.header h1 {
			font-size: 30px;
			font-weight: 650;
			letter-spacing: -.02em;
			margin-bottom: 8px;
		}
		.header p {
			color: #cbd7df;
			font-size: 15px;
		}
		.assessment-status { display: flex; align-items: center; gap: 7px; }
		.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #69c7a2; box-shadow: 0 0 0 3px rgba(105, 199, 162, .14); }
		.assessment-status.in-progress .status-dot { background: #e7b75d; box-shadow: 0 0 0 3px rgba(231, 183, 93, .14); }
		.url-display {
			background: rgba(255, 255, 255, .08);
			border: 1px solid rgba(255, 255, 255, .28);
			border-left: 4px solid #65c9bd;
			padding: 10px 13px;
			border-radius: 6px;
			margin-top: 16px;
			word-break: break-all;
			font-size: 13px;
			font-family: 'SFMono-Regular', Consolas, monospace;
			color: #edf5f7;
		}
		.target-link { color: #fff; font-weight: 600; text-decoration-color: #65c9bd; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }
		.target-link:hover { color: #bff3ec; text-decoration-thickness: 2px; }
		.target-link:focus-visible { border-radius: 2px; outline: 2px solid #8de0d5; outline-offset: 3px; }
		.content {
			padding: 30px;
		}
		.ai-explanation {
			margin-bottom: 24px;
			padding: 20px;
			border: 1px solid #bedbd7;
			border-left: 5px solid var(--accent);
			border-radius: 7px;
			background: var(--surface-accent);
			line-height: 1.6;
		}
		.ai-explanation h2 { margin-bottom: 12px; color: var(--navy); font-size: 20px; }
		.ai-explanation h3 { margin: 14px 0 6px; font-size: 16px; }
		.ai-explanation p { margin: 0 0 10px; }
		.ai-explanation ul, .ai-explanation ol { margin: 0 0 10px 22px; }
		.ai-explanation code { padding: 1px 4px; border-radius: 3px; background: rgba(23, 53, 77, .08); }
		.ai-explanation p:last-child { margin-bottom: 0; }
		.ai-explanation.unavailable { background: var(--surface-warning); border-color: var(--warning); }
		.ai-note { color: var(--muted); font-size: 12px; }
		.profile-ai-feedback {
			margin-bottom: 26px;
			padding: 22px;
			border: 1px solid var(--border);
			border-top: 5px solid var(--accent);
			border-radius: 10px;
			background: var(--surface);
		}
		.profile-ai-feedback.status-achieved { border-top-color: var(--success); }
		.profile-ai-feedback.status-not-achieved { border-top-color: var(--danger); }
		.profile-ai-feedback.status-partial { border-top-color: var(--warning); }
		.profile-ai-heading { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; }
		.profile-ai-heading .eyebrow { color: var(--accent-strong); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
		.profile-ai-heading h2 { margin-top: 3px; color: var(--navy); font-size: 20px; }
		.profile-ai-icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; background: var(--accent); color: white; font-size: 21px; font-weight: 700; }
		.status-achieved .profile-ai-icon { background: var(--success); }
		.status-not-achieved .profile-ai-icon { background: var(--danger); }
		.status-partial .profile-ai-icon { background: var(--warning); }
		.profile-ai-status, .context-badge { padding: 5px 9px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-strong); font-size: 12px; font-weight: 700; white-space: nowrap; }
		.status-achieved .profile-ai-status { background: #def2e8; color: #176a49; }
		.status-not-achieved .profile-ai-status { background: #f9e5e5; color: #963838; }
		.status-partial .profile-ai-status { background: #faedcf; color: #87550e; }
		.profile-ai-summary { margin: 18px 0 14px; font-size: 16px; line-height: 1.55; color: var(--ink-soft); }
		.feedback-changes { display: grid; gap: 8px; margin-bottom: 20px; }
		.change-chip { display: grid; grid-template-columns: auto 1fr; gap: 8px; padding: 9px 11px; border-radius: 6px; background: var(--surface-muted); color: var(--ink-soft); font-size: 13px; line-height: 1.45; }
		.change-chip > span:first-child { color: var(--muted); font-weight: 700; }
		.suggestions-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 18px 0 10px; }
		.suggestions-heading h3 { color: var(--navy); font-size: 16px; }
		.context-badge { background: var(--surface-muted); color: var(--ink-soft); font-weight: 600; }
		.suggestion-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 11px; margin-bottom: 14px; }
		.suggestion-card { display: grid; grid-template-columns: auto 1fr; gap: 11px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
		.suggestion-number { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px; background: var(--accent); color: white; font-size: 12px; font-weight: 700; }
		.suggestion-card h3 { margin: 2px 0 6px; color: var(--navy-light); font-size: 14px; }
		.suggestion-action { color: var(--ink); font-size: 13px; line-height: 1.45; }
		.suggestion-rationale { margin-top: 7px; color: var(--muted); font-size: 12px; line-height: 1.4; }
		.file-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
		.file-chips code { max-width: 100%; overflow: hidden; padding: 3px 6px; border-radius: 4px; background: var(--surface-muted); color: var(--ink-soft); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
		.no-suggestions { margin-bottom: 14px; color: var(--muted); font-size: 13px; }
		.profile-ai-feedback .ai-note { margin-top: 4px; }
		.custom-ai-feedback { margin-bottom: 26px; padding: 22px; border: 1px solid var(--border); border-top: 5px solid var(--accent); border-radius: 10px; background: var(--surface); }
		.custom-ai-heading { display: grid; grid-template-areas: "icon title" "icon badges"; grid-template-columns: auto minmax(0, 1fr); align-items: start; column-gap: 12px; row-gap: 8px; }
		.custom-ai-title { grid-area: title; min-width: 0; }
		.custom-ai-badges { display: flex; grid-area: badges; flex-wrap: wrap; justify-content: flex-start; gap: 6px; }
		.custom-ai-icon { display: grid; grid-area: icon; width: 40px; height: 40px; place-items: center; border-radius: 9px; background: var(--navy-light); color: #fff; font-size: 12px; font-weight: 800; letter-spacing: .04em; }
		.custom-eyebrow { color: var(--accent-strong); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
		.custom-ai-heading h2 { margin-top: 3px; color: var(--navy); font-size: 20px; }
		.analysis-mode-badge { padding: 5px 9px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-strong); font-size: 12px; font-weight: 700; white-space: nowrap; }
		.custom-ai-summary { margin: 18px 0 14px; color: var(--ink-soft); font-size: 16px; line-height: 1.55; }
		.custom-analysis-key { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 14px; padding: 9px 11px; border-radius: 6px; background: var(--surface-muted); color: var(--muted); font-size: 11px; }
		.custom-analysis-key i { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; }
		.key-evidence { background: var(--step-evidence); }
		.key-interpretation { background: var(--step-interpretation); }
		.key-recommendation { background: var(--step-recommendation); }
		.custom-finding-list { display: grid; gap: 12px; margin-bottom: 14px; }
		.custom-finding-card { display: grid; grid-template-columns: auto 1fr; gap: 12px; padding: 16px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); }
		.custom-finding-index { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 7px; background: var(--navy-light); color: #fff; font-size: 12px; font-weight: 700; }
		.custom-finding-content { min-width: 0; }
		.custom-finding-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin: 2px 0 12px; }
		.custom-finding-heading h3 { color: var(--navy); font-size: 15px; line-height: 1.35; }
		.metric-chips { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
		.metric-chips span { padding: 3px 6px; border: 1px solid #bcd6d3; border-radius: 4px; background: var(--surface-accent); color: var(--accent-strong); font-family: 'SFMono-Regular', Consolas, monospace; font-size: 10px; font-weight: 700; }
		.analysis-step { padding: 10px 12px; border-left: 3px solid; border-radius: 5px; }
		.analysis-step-label { display: block; margin-bottom: 4px; font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
		.analysis-step p { color: var(--ink); font-size: 13px; line-height: 1.5; }
		.evidence-step { border-color: var(--step-evidence); background: var(--surface-evidence); }
		.evidence-step .analysis-step-label { color: var(--step-evidence); }
		.interpretation-step { border-color: var(--step-interpretation); background: var(--surface-interpretation); }
		.interpretation-step .analysis-step-label { color: var(--step-interpretation); }
		.recommendation-step { border-color: var(--step-recommendation); background: var(--surface-recommendation); }
		.recommendation-step .analysis-step-label { color: var(--step-recommendation); }
		.analysis-connector { height: 17px; padding-left: 14px; color: #8a969e; font-size: 13px; line-height: 17px; }
		.custom-no-findings { margin-bottom: 14px; padding: 14px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface-subtle); }
		.custom-no-findings strong { display: block; margin-bottom: 4px; color: var(--navy); font-size: 14px; }
		.custom-no-findings p { color: var(--muted); font-size: 13px; line-height: 1.45; }
		.custom-ai-feedback .ai-note { margin-top: 4px; }
		.results-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 12px; }
		.results-heading h2 { color: var(--navy); font-size: 20px; }
		.results-count { padding: 5px 9px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-muted); color: var(--ink-soft); font-size: 12px; font-weight: 750; }
		@media (max-width: 620px) {
			body { padding: 12px; }
			.header, .content { padding: 22px 18px; }
			.profile-ai-heading { grid-template-columns: auto 1fr; }
			.profile-ai-status { grid-column: 1 / -1; width: fit-content; }
			.suggestions-heading { align-items: flex-start; flex-direction: column; }
			.custom-ai-badges { gap: 5px; }
			.custom-finding-heading { align-items: flex-start; flex-direction: column; }
			.metric-chips { justify-content: flex-start; }
		}
		.metric-result {
			background: var(--surface-subtle);
			border: 1px solid var(--border);
			border-left: 5px solid var(--accent);
			padding: 20px;
			margin-bottom: 20px;
			border-radius: 6px;
			transition: border-color .2s, box-shadow .2s;
		}
		.metric-result:hover {
			border-color: #b8cbc9;
			border-left-color: var(--accent-strong);
			box-shadow: 0 5px 14px rgba(16, 47, 70, .14);
		}
		.metric-result h3 {
			color: var(--navy);
			font-size: 19px;
			font-weight: 700;
			margin-bottom: 15px;
		}
		.result-values {
			display: flex;
			flex-direction: column;
			gap: 10px;
		}
		.result-item {
			background: var(--surface);
			padding: 12px 15px;
			border-radius: 4px;
			font-size: 15px;
			font-weight: 500;
			border: 1px solid var(--border);
			line-height: 1.5;
		}
		.result-item strong {
			color: var(--accent-strong);
			margin-right: 8px;
		}
		.result-image { display: block; max-width: 100%; margin-top: 10px; border: 1px solid var(--border); border-radius: 6px; }
		.result-json { margin-top: 10px; padding: 12px; overflow-x: auto; border: 1px solid var(--border); border-radius: 5px; background: var(--surface-muted); color: var(--ink-soft); font-size: 12px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
		.empty-state {
			text-align: center;
			padding: 40px 20px;
			color: var(--muted);
		}
		.empty-state p {
			font-size: 16px;
			margin-bottom: 10px;
		}
		@media (prefers-reduced-motion: reduce) {
			.metric-result { transition: none; }
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h1>Evaluation Results</h1>
			<p class="assessment-status ${isComplete ? 'complete' : 'in-progress'}"><span class="status-dot" aria-hidden="true"></span>Web UI Assessment ${isComplete ? 'Complete' : 'in Progress...'}</p>
			<div class="url-display">Target · ${renderTargetLink(url)}</div>
		</div>
		<div class="content">
			${explanationHtml}
			${resultItems.length > 0 ? `<div class="results-heading"><h2>Metric results</h2><span class="results-count">${filteredResults.length} ${filteredResults.length === 1 ? 'metric' : 'metrics'}</span></div>` : ''}
			${resultItems.length > 0 ? resultItems : '<div class="empty-state"><p>No results available yet. Please try again.</p></div>'}
		</div>
	</div>
</body>
</html>`;
}
