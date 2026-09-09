import * as vscode from 'vscode';
import { errorMessage, logDiagnostic } from './diagnostics';
import {
	AssessmentRunRequest,
	AssessmentRunSummary,
} from './runAssessment';
import {
	ASSESSMENT_PROFILES,
	SIDEBAR_ASSESSMENT_PROFILE_IDS,
	resolveSidebarAssessmentSelection,
	type AssessmentProfileSelection,
} from './assessmentProfiles';
import { METRIC_DEFINITIONS } from './metricCatalog';
import { formatAssessmentRunLabel } from './sidebarFormatting';

export type SidebarInitialSelection =
	| { mode: 'profiles'; profiles: AssessmentProfileSelection[] }
	| { mode: 'custom'; metrics: string[] };

interface RunMessageBase {
	type: 'runAssessment';
	dataSource: 'deployment-url' | 'local-url';
	url: string;
	baselineUrl?: string;
	shareDeployment: boolean;
	comparisonMode: 'current-latest' | 'current-selected' | 'deployment-urls';
	baselineRunId?: number;
}

type RunMessage =
	| (RunMessageBase & { selectionMode: 'profiles'; profiles: AssessmentProfileSelection[] })
	| (RunMessageBase & { selectionMode: 'custom'; metrics: string[] });

interface ComparePastMessage {
	type: 'comparePastAssessments';
	currentRunId: number;
	baselineRunId: number;
}

type SidebarMessage = RunMessage | ComparePastMessage;

export class AssessmentSidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'uiqlab-assessment.sidebar';
	private view?: vscode.WebviewView;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly runAssessment: (
			request: AssessmentRunRequest,
			shareDeployment: boolean,
		) => Promise<void>,
		private readonly fetchAssessmentRuns: () => Promise<AssessmentRunSummary[]>,
		private readonly fetchInitialSelection: () => Promise<SidebarInitialSelection | undefined>,
		private readonly comparePastAssessments: (
			currentRunId: number,
			baselineRunId: number,
		) => Promise<void>,
	) { }

	public async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
		this.view = view;
		view.webview.options = { enableScripts: true };
		const [assessmentRuns, initialSelection] = await Promise.all([
			this.fetchAssessmentRuns().catch(() => []),
			this.fetchInitialSelection().catch(() => undefined),
		]);
		view.webview.html = this.render(assessmentRuns, initialSelection);

		view.webview.onDidReceiveMessage(async (message: SidebarMessage) => {
			if (message.type === 'comparePastAssessments') {
				if (!Number.isInteger(message.currentRunId) || !Number.isInteger(message.baselineRunId)) {
					void vscode.window.showErrorMessage('Choose two assessments to compare.');
					return;
				}
				void view.webview.postMessage({ type: 'running', value: true });
				try {
					await this.comparePastAssessments(message.currentRunId, message.baselineRunId);
				} catch (error) {
					logDiagnostic('Could not compare assessments from the sidebar', error);
					void vscode.window.showErrorMessage(`Could not compare assessments: ${errorMessage(error)}`);
				} finally {
					void view.webview.postMessage({ type: 'running', value: false });
				}
				return;
			}
			if (message.type !== 'runAssessment') {
				return;
			}

			let selection: ReturnType<typeof resolveSidebarAssessmentSelection>;
			try {
				selection = resolveSidebarAssessmentSelection(message);
			} catch (error) {
				void vscode.window.showErrorMessage(errorMessage(error) || 'Choose at least one profile or metric to run.');
				return;
			}

			const url = typeof message.url === 'string' ? message.url.trim() : '';
			const baselineUrl = typeof message.baselineUrl === 'string' ? message.baselineUrl.trim() : '';
			try {
				new URL(url);
				if (message.comparisonMode === 'deployment-urls') {
					new URL(baselineUrl);
				}
			} catch {
				void vscode.window.showErrorMessage(
					message.comparisonMode === 'deployment-urls'
						? 'Enter two valid deployment URLs before running the assessment.'
						: 'Enter a valid URL before running the assessment.',
				);
				return;
			}

			await this.context.workspaceState.update('uiqlab.lastUrl', url);
			const comparison = message.comparisonMode === 'current-selected'
				? { kind: 'selected' as const, baselineRunId: Number(message.baselineRunId) }
				: { kind: 'latest' as const };
			if (comparison.kind === 'selected' && !Number.isInteger(comparison.baselineRunId)) {
				void vscode.window.showErrorMessage('Choose a previous assessment to compare with the current state.');
				return;
			}
			const request: AssessmentRunRequest = message.comparisonMode === 'deployment-urls'
				? {
					assessments: selection.metrics,
					assessment: selection.assessment,
					dataSource: {
						kind: 'deployment-url-comparison',
						baselineDeploymentUrl: baselineUrl,
						currentDeploymentUrl: url,
					},
				}
				: message.dataSource === 'local-url'
				? {
					assessments: selection.metrics,
					assessment: selection.assessment,
					dataSource: { kind: 'local-url', localUrl: url },
					comparison,
				}
				: {
					assessments: selection.metrics,
					assessment: selection.assessment,
					dataSource: { kind: 'deployment-url', deploymentUrl: url },
					comparison,
				};

			view.webview.postMessage({ type: 'running', value: true });
			try {
				await this.runAssessment(
					request,
					Boolean(message.shareDeployment),
				);
			} finally {
				void view.webview.postMessage({ type: 'running', value: false });
				try {
					const runs = (await this.fetchAssessmentRuns()).map(toSidebarAssessmentRun);
					void view.webview.postMessage({ type: 'assessmentRuns', runs });
				} catch (error) {
					logDiagnostic('Could not refresh assessment history in the sidebar', error);
				}
			}
		});
	}

	public reveal(): void {
		this.view?.show?.(true);
	}

	public revealPastComparison(): void {
		this.reveal();
		void this.view?.webview.postMessage({ type: 'setComparisonMode', value: 'past-past' });
	}

	private render(
		assessmentRuns: AssessmentRunSummary[],
		initialSelection: SidebarInitialSelection | undefined,
	): string {
		const nonce = getNonce();
		const lastUrl = this.context.workspaceState.get<string>('uiqlab.lastUrl', '');
		const initialMode = initialSelection?.mode ?? 'profiles';
		const initialProfiles = initialSelection?.mode === 'profiles' ? initialSelection.profiles.slice(0, 1) : [];
		const initialMetrics = new Set(initialSelection?.mode === 'custom' ? initialSelection.metrics : []);
		const selectedProfiles = new Map(initialProfiles.map((profile) => [profile.id, profile.direction]));
		const profileRows = SIDEBAR_ASSESSMENT_PROFILE_IDS.map((id) => {
			const definition = ASSESSMENT_PROFILES[id];
			const profileName = definition.displayName;
			const selectedDirection = selectedProfiles.get(id) ?? definition.directions[0];
			const options = definition.directions.map((direction) =>
				`<option value="${escapeHtml(direction)}"${direction === selectedDirection ? ' selected' : ''}>${escapeHtml(direction)}</option>`
			).join('');
			const profileMetrics = definition.metrics.map((metricId) => {
				const metric = METRIC_DEFINITIONS.find((candidate) => candidate.id === metricId);
				return `<li><span class="profile-metric-id">${escapeHtml(metricId.toUpperCase())}</span><span>${escapeHtml(metric?.name ?? metricId)}</span></li>`;
			}).join('');
			return `<div class="profile">
				<label class="profile-label"><input type="radio" name="profile" value="${escapeHtml(id)}"${selectedProfiles.has(id) ? ' checked' : ''}><span>${escapeHtml(profileName)}</span></label>
				<label class="direction-label"><span>Direction</span><select data-profile-direction="${escapeHtml(id)}"${selectedProfiles.has(id) ? '' : ' disabled'}>${options}</select></label>
				<details class="profile-details"><summary aria-label="Read about ${escapeHtml(profileName)}">About this profile</summary><div class="profile-details-content">
					<p>${escapeHtml(PROFILE_DESCRIPTIONS[id] ?? '')}</p>
					<p class="profile-metrics-heading">Metrics used</p><ul>${profileMetrics}</ul>
				</div></details>
			</div>`;
		}).join('');
		const metricRows = METRIC_DEFINITIONS.map((metric) =>
			`<div class="metric">
				<label class="metric-label"><input type="checkbox" name="metric" value="${escapeHtml(metric.id)}"${initialMetrics.has(metric.id) ? ' checked' : ''}><span><span class="metric-id">${escapeHtml(metric.id)}</span>${escapeHtml(metric.name)}</span></label>
				<details><summary aria-label="Read about ${escapeHtml(metric.name)}">What does this measure?</summary><p>${escapeHtml(metric.description)}</p></details>
			</div>`
		).join('');
		const runOptions = JSON.stringify(assessmentRuns.map(toSidebarAssessmentRun)).replace(/</g, '\\u003c');

		return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
	:root { color-scheme: light dark; }
	* { box-sizing: border-box; }
	body { margin: 0; padding: 14px 12px 24px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
	h2 { font-size: 16px; margin: 0 0 4px; }
	.intro { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.45; margin: 0 0 18px; }
	fieldset { border: 0; padding: 0; margin: 0 0 18px; min-width: 0; }
	legend { font-weight: 600; margin-bottom: 8px; }
	.source-options { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
	.selection-options { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
	.comparison-options { display: grid; gap: 6px; }
	.source-option { border: 1px solid var(--vscode-input-border, transparent); padding: 7px; cursor: pointer; }
	.source-option:has(input:checked) { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
	.source-option input { margin: 0 5px 0 0; }
	label[for="url"] { display: block; font-weight: 600; margin: 12px 0 6px; }
	input[type="url"] { width: 100%; border: 1px solid var(--vscode-input-border, transparent); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 7px 8px; outline: none; }
	select { width: 100%; border: 1px solid var(--vscode-input-border, transparent); background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); padding: 7px 8px; outline: none; }
	.select-label { display: block; margin: 10px 0 6px; font-weight: 600; }
	.mode-panel { margin-top: 8px; padding: 4px 0; }
	.hidden { display: none; }
	.empty-history { color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.4; }
	input[type="url"]:focus { border-color: var(--vscode-focusBorder); }
	.share { display: flex; gap: 7px; align-items: flex-start; margin-top: 10px; color: var(--vscode-descriptionForeground); font-size: 12px; }
	.preference { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; }
	.preference-copy { min-width: 0; }
	.preference-title { display: block; font-weight: 600; line-height: 1.35; }
	.preference-description { display: block; margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.4; }
	.preference + .preference { border-top: 1px solid var(--vscode-widget-border); }
	.ai-privacy-notice { margin-top: 8px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; background: var(--vscode-textBlockQuote-background); color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.45; }
	.ai-privacy-notice summary { padding: 9px 10px; color: var(--vscode-foreground); font-size: 12px; font-weight: 600; cursor: pointer; }
	.ai-privacy-notice summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -2px; }
	.ai-privacy-content { padding: 0 10px 10px; }
	.ai-privacy-notice p { margin: 0; }
	.ai-privacy-notice p + p { margin-top: 6px; }
	.switch { position: relative; display: inline-block; flex: 0 0 auto; width: 34px; height: 18px; }
	.switch input { width: 1px; height: 1px; opacity: 0; }
	.slider { position: absolute; inset: 0; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 9px; background: var(--vscode-input-background); cursor: pointer; transition: background .15s; }
	.slider::before { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--vscode-descriptionForeground); transition: transform .15s, background .15s; }
	.switch input:checked + .slider { border-color: var(--vscode-focusBorder); background: var(--vscode-button-background); }
	.switch input:checked + .slider::before { transform: translateX(16px); background: var(--vscode-button-foreground); }
	.switch input:focus-visible + .slider { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
	.switch input:disabled + .slider { cursor: default; opacity: .85; }
	.profile { padding: 9px 0; border-bottom: 1px solid var(--vscode-widget-border); }
	.profile-label { display: flex; gap: 7px; align-items: flex-start; font-weight: 600; line-height: 1.35; cursor: pointer; }
	.profile-label input { margin-top: 2px; }
	.direction-label { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; margin: 7px 0 0 22px; color: var(--vscode-descriptionForeground); font-size: 11px; }
	.direction-label select { padding: 5px 7px; }
	.profile-details-content { padding: 2px 0 1px; }
	.profile-details .profile-metrics-heading { margin-top: 9px; color: var(--vscode-foreground); font-weight: 600; }
	.profile-details ul { display: grid; gap: 4px; margin: 5px 0 2px; padding: 0; list-style: none; }
	.profile-details li { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 5px; align-items: baseline; line-height: 1.35; }
	.profile-metric-id { color: var(--vscode-foreground); font-family: var(--vscode-editor-font-family); font-size: 10px; font-weight: 600; text-transform: uppercase; }
	.selection-panel { margin-top: 6px; }
	.section-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin: 10px 0 4px; }
	.section-row strong { font-size: 12px; }
	.link-button { border: 0; padding: 0; color: var(--vscode-textLink-foreground); background: none; font: inherit; font-size: 11px; cursor: pointer; }
	.metric { padding: 7px 0; border-bottom: 1px solid var(--vscode-widget-border); }
	.metric-label { display: flex; gap: 7px; align-items: flex-start; line-height: 1.35; cursor: pointer; }
	.metric-label input { margin-top: 2px; }
	.metric-id { display: inline-block; min-width: 28px; margin-right: 5px; color: var(--vscode-descriptionForeground); font-size: 10px; text-transform: uppercase; }
	details { margin: 4px 0 0 22px; color: var(--vscode-descriptionForeground); font-size: 11px; }
	summary { color: var(--vscode-textLink-foreground); cursor: pointer; }
	details p { line-height: 1.45; margin: 6px 0 2px; }
	.error { display: none; color: var(--vscode-errorForeground); font-size: 12px; margin: 0 0 8px; }
	button.run { width: 100%; border: 0; background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 8px 12px; font-weight: 600; cursor: pointer; }
	button.run:hover { background: var(--vscode-button-hoverBackground); }
	button.run:disabled { opacity: .65; cursor: wait; }
</style></head><body>
	<h2>Web UI assessment</h2><p class="intro">Configure an assessment here. Your choices remain available while you work.</p>
	<form id="assessment-form" novalidate>
		<fieldset><legend>What do you want to compare?</legend><div class="comparison-options">
			<!-- Comparison modes hidden for the thesis experiments. Restore after the experiments.
			<label class="source-option"><input type="radio" name="comparison" value="current-latest">Current state vs latest assessment</label>
			<label class="source-option"><input type="radio" name="comparison" value="current-selected">Current state vs selected assessment</label>
			<label class="source-option"><input type="radio" name="comparison" value="past-past">Two previous assessments</label>
			-->
			<label class="source-option"><input type="radio" name="comparison" value="deployment-urls" checked>Two deployed URLs</label>
		</div>
		<div class="mode-panel hidden" id="selected-baseline-panel"><label class="select-label" for="selected-baseline">Previous assessment</label><select id="selected-baseline"></select><p class="empty-history hidden" id="selected-empty">No previous assessment matches this page.</p></div>
		<div class="mode-panel hidden" id="past-comparison-panel">
			<label class="select-label" for="past-current">Assessment A · current side</label><select id="past-current"></select>
			<label class="select-label" for="past-baseline">Assessment B · baseline side</label><select id="past-baseline"></select>
			<p class="empty-history hidden" id="past-empty">Two compatible completed assessments are required.</p>
		</div></fieldset>
		<div id="current-assessment-fields">
		<fieldset><legend>Page source</legend><div id="single-source-fields"><div class="source-options">
			<label class="source-option"><input type="radio" name="source" value="deployment-url" checked>Deployment</label>
			<label class="source-option"><input type="radio" name="source" value="local-url">Local URL</label>
		</div><label for="url" id="url-label">Deployment URL</label><input id="url" type="url" required placeholder="https://example.com" value="${escapeHtml(lastUrl)}"></div>
		<div class="hidden" id="deployment-url-fields">
			<label for="baseline-url" class="select-label">Baseline deployment URL</label><input id="baseline-url" type="url" placeholder="https://before.example.com">
			<label for="comparison-url" class="select-label">Current deployment URL</label><input id="comparison-url" type="url" placeholder="https://after.example.com" value="${escapeHtml(lastUrl)}">
		</div>
			<label class="share" id="share-row"><input id="share" type="checkbox" required checked><span>Allow this URL and the selected metrics to be sent to the evaluation service (required to run).</span></label></fieldset>
		<fieldset><legend>What do you want to assess?</legend><div class="selection-options">
			<label class="source-option"><input type="radio" name="assessment-mode" value="profiles"${initialMode === 'profiles' ? ' checked' : ''}>Profiles</label>
			<label class="source-option"><input type="radio" name="assessment-mode" value="custom"${initialMode === 'custom' ? ' checked' : ''}>Custom metrics</label>
		</div>
		<div class="selection-panel${initialMode === 'profiles' ? '' : ' hidden'}" id="profiles-panel">${profileRows}</div>
		<div class="selection-panel${initialMode === 'custom' ? '' : ' hidden'}" id="metrics-panel">
			<div class="section-row"><strong>Metrics</strong><span><button class="link-button" id="select-all-metrics" type="button">All</button> · <button class="link-button" id="select-no-metrics" type="button">None</button></span></div>${metricRows}
		</div></fieldset>
		<fieldset><legend>Explanation</legend><div class="preference">
			<div class="preference-copy"><label class="preference-title" for="llm-explanation">AI-generated explanation</label><span class="preference-description" id="llm-explanation-description">${initialMode === 'profiles' ? 'A prepared explanation is always included for profile assessments.' : 'AI explanations are disabled for custom metric assessments.'}</span></div>
			<label class="switch" aria-label="AI-generated explanation availability"><input id="llm-explanation" type="checkbox"${initialMode === 'profiles' ? ' checked' : ''} disabled><span class="slider"></span></label>
		</div><details class="ai-privacy-notice">
			<summary>Experiment explanation notice</summary>
			<div class="ai-privacy-content">
				<p>For profile assessments, the explanation is loaded from a prepared PostgreSQL record for the selected experiment project, profile, and direction. Custom metric assessments do not request an AI explanation. No live LLM provider is contacted.</p>
				<p>The prepared explanation uses assessment metrics only. Measured assessment results remain authoritative.</p>
			</div>
		</details></fieldset>
		</div>
		<p class="error" id="error" role="alert"></p><button class="run" id="run" type="submit">Run assessment</button>
	</form>
<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	let assessmentRuns = ${runOptions};
	const form = document.getElementById('assessment-form'); const url = document.getElementById('url'); const baselineUrl = document.getElementById('baseline-url'); const comparisonUrl = document.getElementById('comparison-url'); const error = document.getElementById('error'); const run = document.getElementById('run');
	const saved = vscode.getState() || {};
	if (saved.source) document.querySelector('input[name="source"][value="' + saved.source + '"]').checked = true;
	if (saved.url) url.value = saved.url;
	if (saved.baselineUrl) baselineUrl.value = saved.baselineUrl;
	if (saved.comparisonUrl) comparisonUrl.value = saved.comparisonUrl;
	if (Array.isArray(saved.profiles)) { const profile = saved.profiles.find(item => item && typeof item.id === 'string'); document.querySelectorAll('input[name="profile"]').forEach(i => { i.checked = Boolean(profile && profile.id === i.value); const direction = document.querySelector('select[data-profile-direction="' + i.value + '"]'); if (i.checked && typeof profile.direction === 'string' && [...direction.options].some(option => option.value === profile.direction)) direction.value = profile.direction; }); }
	if (Array.isArray(saved.metrics)) document.querySelectorAll('input[name="metric"]').forEach(i => i.checked = saved.metrics.includes(i.value));
	if (typeof saved.share === 'boolean') document.getElementById('share').checked = saved.share;
	if (saved.comparison) { const comparison = document.querySelector('input[name="comparison"][value="' + saved.comparison + '"]'); if (comparison) comparison.checked = true; }
	if (saved.selectionMode) { const selectionMode = document.querySelector('input[name="assessment-mode"][value="' + saved.selectionMode + '"]'); if (selectionMode) selectionMode.checked = true; }
	function source() { return document.querySelector('input[name="source"]:checked').value; }
	function comparison() { return document.querySelector('input[name="comparison"]:checked').value; }
	function selectionMode() { return document.querySelector('input[name="assessment-mode"]:checked').value; }
	function normalizedTarget(value) { try { const parsed = new URL(value); const path = parsed.pathname.replace(/\\/+$/, ''); return path || '/'; } catch { return ''; } }
	function setOptions(select, items, savedId) { const existingId = Number(select.value); const preferredId = items.some(item => item.id === existingId) ? existingId : Number(savedId); select.textContent = ''; for (const item of items) { const option = document.createElement('option'); option.value = String(item.id); option.textContent = item.label; option.selected = preferredId === item.id; select.appendChild(option); } select.disabled = items.length === 0; }
	function compatible(a, b) { return a.id !== b.id && a.target === b.target && a.width === b.width && a.height === b.height; }
	function updateHistoricalSelectors() { const target = normalizedTarget(url.value); const local = source() === 'local-url'; const currentCandidates = assessmentRuns.filter(item => (!target || item.target === target) && (local ? item.width !== undefined : item.width === undefined)); setOptions(document.getElementById('selected-baseline'), currentCandidates, saved.selectedBaseline); document.getElementById('selected-empty').classList.toggle('hidden', currentCandidates.length > 0); const currentSelect = document.getElementById('past-current'); setOptions(currentSelect, assessmentRuns, saved.pastCurrent); const selectedCurrent = assessmentRuns.find(item => item.id === Number(currentSelect.value)); const baselines = selectedCurrent ? assessmentRuns.filter(item => compatible(selectedCurrent, item)) : []; setOptions(document.getElementById('past-baseline'), baselines, saved.pastBaseline); document.getElementById('past-empty').classList.toggle('hidden', assessmentRuns.length >= 2 && baselines.length > 0); }
	function updateMode() { const mode = comparison(); const past = mode === 'past-past'; const deployedUrls = mode === 'deployment-urls'; document.getElementById('current-assessment-fields').classList.toggle('hidden', past); document.getElementById('selected-baseline-panel').classList.toggle('hidden', mode !== 'current-selected'); document.getElementById('past-comparison-panel').classList.toggle('hidden', !past); document.getElementById('single-source-fields').classList.toggle('hidden', deployedUrls); document.getElementById('deployment-url-fields').classList.toggle('hidden', !deployedUrls); url.required = !past && !deployedUrls; baselineUrl.required = deployedUrls; comparisonUrl.required = deployedUrls; run.textContent = past ? 'Compare assessments' : 'Run and compare'; updateSource(); updateHistoricalSelectors(); save(); }
	function updateProfileDirections() { document.querySelectorAll('input[name="profile"]').forEach(input => { document.querySelector('select[data-profile-direction="' + input.value + '"]').disabled = !input.checked; }); }
	function updateExplanationAvailability(profiles) { const input = document.getElementById('llm-explanation'); input.checked = profiles; input.setAttribute('aria-label', profiles ? 'AI-generated explanation is always included for profiles' : 'AI-generated explanation is disabled for custom metrics'); document.getElementById('llm-explanation-description').textContent = profiles ? 'A prepared explanation is always included for profile assessments.' : 'AI explanations are disabled for custom metric assessments.'; }
	function updateSelectionMode() { const profiles = selectionMode() === 'profiles'; document.getElementById('profiles-panel').classList.toggle('hidden', !profiles); document.getElementById('metrics-panel').classList.toggle('hidden', profiles); if (profiles) { document.querySelectorAll('input[name="metric"]').forEach(input => input.checked = false); } else { document.querySelectorAll('input[name="profile"]').forEach(input => { input.checked = false; }); } updateProfileDirections(); updateExplanationAvailability(profiles); save(); }
	function updateSource() { const deployedUrls = comparison() === 'deployment-urls'; const local = !deployedUrls && source() === 'local-url'; const share = document.getElementById('share'); document.getElementById('url-label').textContent = local ? 'Local URL' : 'Deployment URL'; url.placeholder = local ? 'http://localhost:3000' : 'https://example.com'; document.getElementById('share-row').style.display = local ? 'none' : 'flex'; document.querySelector('#share-row span').textContent = deployedUrls ? 'Allow both URLs and the selected metrics to be sent to the evaluation service (required to run).' : 'Allow this URL and the selected metrics to be sent to the evaluation service (required to run).'; share.required = !local; updateHistoricalSelectors(); save(); }
	function selectedId(id) { const value = document.getElementById(id).value; return value ? Number(value) : null; }
	function selectedProfiles() { return [...document.querySelectorAll('input[name="profile"]:checked')].map(input => ({ id: input.value, direction: document.querySelector('select[data-profile-direction="' + input.value + '"]').value })); }
	function selectedMetrics() { return [...document.querySelectorAll('input[name="metric"]:checked')].map(input => input.value); }
	function save() { vscode.setState({ source: source(), comparison: comparison(), selectionMode: selectionMode(), url: url.value, baselineUrl: baselineUrl.value, comparisonUrl: comparisonUrl.value, profiles: selectedProfiles(), metrics: selectedMetrics(), share: document.getElementById('share').checked, selectedBaseline: selectedId('selected-baseline'), pastCurrent: selectedId('past-current'), pastBaseline: selectedId('past-baseline') }); }
	document.querySelectorAll('input').forEach(i => i.addEventListener('change', () => { if (i.name === 'source') updateSource(); else if (i.name === 'comparison') updateMode(); else if (i.name === 'assessment-mode') updateSelectionMode(); else { if (i.name === 'profile') updateProfileDirections(); save(); } })); document.querySelectorAll('select[data-profile-direction]').forEach(select => select.addEventListener('change', save)); url.addEventListener('input', () => { updateHistoricalSelectors(); save(); }); baselineUrl.addEventListener('input', save); comparisonUrl.addEventListener('input', save);
	document.getElementById('past-current').addEventListener('change', () => { updateHistoricalSelectors(); save(); }); document.getElementById('past-baseline').addEventListener('change', save); document.getElementById('selected-baseline').addEventListener('change', save);
	document.getElementById('select-all-metrics').addEventListener('click', () => { document.querySelectorAll('input[name="metric"]').forEach(input => input.checked = true); save(); }); document.getElementById('select-no-metrics').addEventListener('click', () => { document.querySelectorAll('input[name="metric"]').forEach(input => input.checked = false); save(); });
	form.addEventListener('submit', event => { event.preventDefault(); const mode = comparison(); if (mode === 'past-past') { const currentRunId = selectedId('past-current'); const baselineRunId = selectedId('past-baseline'); if (!Number.isInteger(currentRunId) || !Number.isInteger(baselineRunId)) { error.textContent = 'Choose two compatible assessments.'; error.style.display = 'block'; return; } error.style.display = 'none'; save(); vscode.postMessage({ type: 'comparePastAssessments', currentRunId, baselineRunId }); return; } const activeSelectionMode = selectionMode(); const profiles = selectedProfiles(); const metrics = selectedMetrics(); if (activeSelectionMode === 'profiles' && profiles.length !== 1) { error.textContent = 'Select one profile.'; error.style.display = 'block'; return; } if (activeSelectionMode === 'custom' && !metrics.length) { error.textContent = 'Select at least one metric.'; error.style.display = 'block'; return; } const deployedUrls = mode === 'deployment-urls'; if (deployedUrls ? !baselineUrl.checkValidity() || !comparisonUrl.checkValidity() : !url.checkValidity()) { error.textContent = deployedUrls ? 'Enter two valid deployment URLs.' : 'Enter a valid URL.'; error.style.display = 'block'; return; } const baselineRunId = mode === 'current-selected' ? selectedId('selected-baseline') : undefined; if (mode === 'current-selected' && !Number.isInteger(baselineRunId)) { error.textContent = 'Choose a previous assessment.'; error.style.display = 'block'; return; } const assessmentSelection = activeSelectionMode === 'profiles' ? { selectionMode: 'profiles', profiles } : { selectionMode: 'custom', metrics }; error.style.display = 'none'; save(); vscode.postMessage({ type: 'runAssessment', ...assessmentSelection, dataSource: deployedUrls ? 'deployment-url' : source(), url: deployedUrls ? comparisonUrl.value : url.value, baselineUrl: deployedUrls ? baselineUrl.value : undefined, comparisonMode: mode, baselineRunId, shareDeployment: document.getElementById('share').checked }); });
	window.addEventListener('message', event => { if (event.data.type === 'running') { run.disabled = event.data.value; if (event.data.value) run.textContent = comparison() === 'past-past' ? 'Comparing…' : comparison() === 'deployment-urls' ? 'Comparing deployments…' : 'Assessment running…'; else updateMode(); } if (event.data.type === 'setComparisonMode') { const input = document.querySelector('input[name="comparison"][value="' + event.data.value + '"]'); if (input) { input.checked = true; updateMode(); } } if (event.data.type === 'assessmentRuns' && Array.isArray(event.data.runs)) { assessmentRuns = event.data.runs; updateHistoricalSelectors(); save(); } });
	updateSource();
	updateSelectionMode(); updateHistoricalSelectors(); updateMode();
</script></body></html>`;
	}
}

function toSidebarAssessmentRun(run: AssessmentRunSummary): {
	id: number;
	label: string;
	target: string;
	width?: number;
	height?: number;
} {
	return {
		id: run.id,
		label: formatAssessmentRunLabel(run),
		target: run.assessedTarget ?? '',
		width: run.screenshotDimensions?.width,
		height: run.screenshotDimensions?.height,
	};
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

const PROFILE_DESCRIPTIONS: Readonly<Record<string, string>> = {
	'visual-clutter': 'Tracks visual clutter using edge density, feature congestion, and subband entropy.',
	'screen-whitespace': 'Measures the proportion of the screen occupied by white space.',
	'text-amount': 'Measures the amount of visible text using the page word count.',
	colorfulness: 'Measures the interface colorfulness score.',
	accessibility: 'Reports automatically detected axe-core violations; it does not assess overall accessibility.',
};

function getNonce(): string {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	return Array.from({ length: 32 }, () => characters.charAt(Math.floor(Math.random() * characters.length))).join('');
}
