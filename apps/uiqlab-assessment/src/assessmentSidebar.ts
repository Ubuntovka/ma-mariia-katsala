import * as vscode from 'vscode';
import {
	AssessmentName,
	AssessmentRunRequest,
	fetchAvailableAssessments,
} from './runAssessment';
import { getMetricDefinition } from './metricCatalog';

interface RunMessage {
	type: 'runAssessment';
	assessments: string[];
	dataSource: 'deployment-url' | 'local-url';
	url: string;
	shareDeployment: boolean;
}

export class AssessmentSidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'uiqlab-assessment.sidebar';
	private view?: vscode.WebviewView;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly runAssessment: (request: AssessmentRunRequest, shareDeployment: boolean) => Promise<void>,
	) { }

	public async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
		this.view = view;
		view.webview.options = { enableScripts: true };
		view.webview.html = this.render(await fetchAvailableAssessments());

		view.webview.onDidReceiveMessage(async (message: RunMessage) => {
			if (message.type !== 'runAssessment') {
				return;
			}

			const assessments = Array.isArray(message.assessments)
				? message.assessments.filter((item): item is string => typeof item === 'string')
				: [];
			if (assessments.length === 0) {
				void vscode.window.showErrorMessage('Select at least one metric to run.');
				return;
			}

			const url = typeof message.url === 'string' ? message.url.trim() : '';
			try {
				new URL(url);
			} catch {
				void vscode.window.showErrorMessage('Enter a valid URL before running the assessment.');
				return;
			}

			await this.context.workspaceState.update('uiqlab.lastUrl', url);
			const request: AssessmentRunRequest = message.dataSource === 'local-url'
				? { assessments, dataSource: { kind: 'local-url', localUrl: url } }
				: { assessments, dataSource: { kind: 'deployment-url', deploymentUrl: url } };

			view.webview.postMessage({ type: 'running', value: true });
			try {
				await this.runAssessment(request, Boolean(message.shareDeployment));
			} finally {
				view.webview.postMessage({ type: 'running', value: false });
			}
		});
	}

	public reveal(): void {
		this.view?.show?.(true);
	}

	private render(assessments: AssessmentName[]): string {
		const nonce = getNonce();
		const lastUrl = this.context.workspaceState.get<string>('uiqlab.lastUrl', '');
		const metricRows = assessments.map((name, index) => {
			const definition = getMetricDefinition(name);
			const id = definition?.id ?? `metric-${index + 1}`;
			const description = definition?.description ?? 'No additional description is available for this metric.';
			return `<div class="metric">
				<label class="metric-label"><input type="checkbox" name="metric" value="${escapeHtml(name)}"><span>${escapeHtml(name)}</span></label>
				<details><summary aria-label="Read about ${escapeHtml(name)}">What does this measure?</summary><p><span class="metric-id">${escapeHtml(id)}</span>${escapeHtml(description)}</p></details>
			</div>`;
		}).join('');

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
	.source-option { border: 1px solid var(--vscode-input-border, transparent); padding: 7px; cursor: pointer; }
	.source-option:has(input:checked) { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
	.source-option input { margin: 0 5px 0 0; }
	label[for="url"] { display: block; font-weight: 600; margin: 12px 0 6px; }
	input[type="url"] { width: 100%; border: 1px solid var(--vscode-input-border, transparent); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 7px 8px; outline: none; }
	input[type="url"]:focus { border-color: var(--vscode-focusBorder); }
	.share { display: flex; gap: 7px; align-items: flex-start; margin-top: 10px; color: var(--vscode-descriptionForeground); font-size: 12px; }
	.section-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 6px; }
	.section-row legend { margin: 0; }
	.link-button { border: 0; padding: 0; color: var(--vscode-textLink-foreground); background: none; font: inherit; font-size: 11px; cursor: pointer; }
	.metric { padding: 8px 0; border-bottom: 1px solid var(--vscode-widget-border); }
	.metric-label { display: flex; gap: 7px; align-items: flex-start; line-height: 1.35; cursor: pointer; }
	.metric-label input { margin-top: 2px; }
	details { margin: 4px 0 0 22px; color: var(--vscode-descriptionForeground); font-size: 11px; }
	summary { color: var(--vscode-textLink-foreground); cursor: pointer; }
	details p { line-height: 1.45; margin: 6px 0 2px; }
	.metric-id { display: inline-block; margin-right: 5px; padding: 1px 4px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 10px; }
	.error { display: none; color: var(--vscode-errorForeground); font-size: 12px; margin: 0 0 8px; }
	button.run { width: 100%; border: 0; background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 8px 12px; font-weight: 600; cursor: pointer; }
	button.run:hover { background: var(--vscode-button-hoverBackground); }
	button.run:disabled { opacity: .65; cursor: wait; }
</style></head><body>
	<h2>Web UI assessment</h2><p class="intro">Configure an assessment here. Your choices remain available while you work.</p>
	<form id="assessment-form">
		<fieldset><legend>Page source</legend><div class="source-options">
			<label class="source-option"><input type="radio" name="source" value="deployment-url" checked>Deployment</label>
			<label class="source-option"><input type="radio" name="source" value="local-url">Local URL</label>
		</div><label for="url" id="url-label">Deployment URL</label><input id="url" type="url" required placeholder="https://example.com" value="${escapeHtml(lastUrl)}">
			<label class="share" id="share-row"><input id="share" type="checkbox" required checked><span>Allow this URL and the selected metrics to be sent to the evaluation service (required to run).</span></label></fieldset>
		<fieldset><div class="section-row"><legend>Metrics</legend><span><button class="link-button" id="select-all" type="button">All</button> · <button class="link-button" id="select-none" type="button">None</button></span></div>${metricRows}</fieldset>
		<p class="error" id="error" role="alert"></p><button class="run" id="run" type="submit">Run assessment</button>
	</form>
<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	const form = document.getElementById('assessment-form'); const url = document.getElementById('url'); const error = document.getElementById('error'); const run = document.getElementById('run');
	const saved = vscode.getState() || {};
	if (saved.source) document.querySelector('input[name="source"][value="' + saved.source + '"]').checked = true;
	if (saved.url) url.value = saved.url;
	if (Array.isArray(saved.metrics)) document.querySelectorAll('input[name="metric"]').forEach(i => i.checked = saved.metrics.includes(i.value));
	if (typeof saved.share === 'boolean') document.getElementById('share').checked = saved.share;
	function source() { return document.querySelector('input[name="source"]:checked').value; }
	function updateSource() { const local = source() === 'local-url'; const share = document.getElementById('share'); document.getElementById('url-label').textContent = local ? 'Local URL' : 'Deployment URL'; url.placeholder = local ? 'http://localhost:3000' : 'https://example.com'; document.getElementById('share-row').style.display = local ? 'none' : 'flex'; share.required = !local; save(); }
	function save() { vscode.setState({ source: source(), url: url.value, metrics: [...document.querySelectorAll('input[name="metric"]:checked')].map(i => i.value), share: document.getElementById('share').checked }); }
	document.querySelectorAll('input').forEach(i => i.addEventListener('change', () => { if (i.name === 'source') updateSource(); else save(); })); url.addEventListener('input', save);
	document.getElementById('select-all').addEventListener('click', () => { document.querySelectorAll('input[name="metric"]').forEach(i => i.checked = true); save(); });
	document.getElementById('select-none').addEventListener('click', () => { document.querySelectorAll('input[name="metric"]').forEach(i => i.checked = false); save(); });
	form.addEventListener('submit', event => { event.preventDefault(); const metrics = [...document.querySelectorAll('input[name="metric"]:checked')].map(i => i.value); if (!metrics.length) { error.textContent = 'Select at least one metric.'; error.style.display = 'block'; return; } if (!url.checkValidity()) { error.textContent = 'Enter a valid URL.'; error.style.display = 'block'; return; } error.style.display = 'none'; save(); vscode.postMessage({ type: 'runAssessment', assessments: metrics, dataSource: source(), url: url.value, shareDeployment: document.getElementById('share').checked }); });
	window.addEventListener('message', event => { if (event.data.type === 'running') { run.disabled = event.data.value; run.textContent = event.data.value ? 'Assessment running…' : 'Run assessment'; } });
	updateSource();
</script></body></html>`;
	}
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

function getNonce(): string {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	return Array.from({ length: 32 }, () => characters.charAt(Math.floor(Math.random() * characters.length))).join('');
}
