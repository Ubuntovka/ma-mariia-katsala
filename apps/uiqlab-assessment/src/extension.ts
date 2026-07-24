import * as vscode from 'vscode';
import {
	collectAssessmentRunRequest,
	formatAssessmentRunSummary,
	resolveCurrentCodeLocation,
	submitUrlForEvaluation,
	submitFileForEvaluation,
	fetchEvaluationResult,
	pollEvaluationResult,
	toMetricIds,
	getMetricInfoById,
} from './runAssessment';

function createResultsWebview(
	panel: vscode.WebviewPanel,
	results: any[],
	url: string,
	isComplete: boolean = true
): void {
	const html = generateResultsHtml(results, url, isComplete);
	panel.webview.html = html;
}

function generateResultsHtml(results: any[], url: string, isComplete: boolean = true): string {
	// Filter out results that are completely empty, but keep them if they are the only ones for a metric
	const filteredResults = results.filter((r, i) => {
		if (Array.isArray(r.results) && r.results.length > 0) return true;
		// If it's empty, check if there's any other non-empty result for the same metric_id
		const hasNonEmpty = results.some((other, j) => 
			i !== j && 
			other.metric_id === r.metric_id && 
			Array.isArray(other.results) && 
			other.results.length > 0
		);
		return !hasNonEmpty;
	});

	const resultItems = (filteredResults.length > 0 ? filteredResults : []).map((r) => {
		const metric = getMetricInfoById(r.metric_id);
		const metricName = metric?.name || r.metric_id;
		const resultValues = Array.isArray(r.results) ? r.results : [r.results];

		return `
		<div class="metric-result">
			<h3>${metricName}</h3>
			<div class="result-values">
				${resultValues.map((val: any, i: number) => {
					let displayVal = '';
					if (typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://')) && (val.toLowerCase().endsWith('.png') || val.toLowerCase().endsWith('.jpg') || val.toLowerCase().endsWith('.jpeg'))) {
						displayVal = `<img src="${val}" style="max-width: 100%; border-radius: 4px; margin-top: 5px; border: 1px solid #ddd;" />`;
					} else if (typeof val === 'object' && val !== null) {
						displayVal = `<pre style="white-space: pre-wrap; word-break: break-all; background: #eee; padding: 10px; border-radius: 4px; font-size: 12px;">${JSON.stringify(val, null, 2)}</pre>`;
					} else {
						displayVal = val;
					}
					return `<div class="result-item"><strong>Result ${i + 1}:</strong> ${displayVal}</div>`;
				}).join('')}
			</div>
		</div>
		`;
	}).join('');

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Evaluation Results</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			min-height: 100vh;
			padding: 20px;
			color: #333;
		}
		.container {
			max-width: 900px;
			margin: 0 auto;
			background: white;
			border-radius: 12px;
			box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
			overflow: hidden;
		}
		.header {
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			color: white;
			padding: 30px;
			border-bottom: 4px solid #667eea;
		}
		.header h1 {
			font-size: 28px;
			margin-bottom: 10px;
		}
		.header p {
			opacity: 0.95;
			font-size: 14px;
		}
		.url-display {
			background: rgba(255, 255, 255, 0.2);
			padding: 10px 15px;
			border-radius: 6px;
			margin-top: 10px;
			word-break: break-all;
			font-size: 13px;
			font-family: 'Courier New', monospace;
		}
		.content {
			padding: 30px;
		}
		.metric-result {
			background: #f8f9fa;
			border-left: 4px solid #667eea;
			padding: 20px;
			margin-bottom: 20px;
			border-radius: 6px;
			transition: transform 0.2s, box-shadow 0.2s;
		}
		.metric-result:hover {
			transform: translateX(5px);
			box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
		}
		.metric-result h3 {
			color: #667eea;
			font-size: 18px;
			margin-bottom: 15px;
		}
		.result-values {
			display: flex;
			flex-direction: column;
			gap: 10px;
		}
		.result-item {
			background: white;
			padding: 12px 15px;
			border-radius: 4px;
			font-size: 14px;
			border: 1px solid #e0e0e0;
		}
		.result-item strong {
			color: #764ba2;
			margin-right: 8px;
		}
		.empty-state {
			text-align: center;
			padding: 40px 20px;
			color: #999;
		}
		.empty-state p {
			font-size: 16px;
			margin-bottom: 10px;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h1>📊 Evaluation Results</h1>
			<p>Web UI Assessment ${isComplete ? 'Complete' : 'in Progress...'}</p>
			<div class="url-display">🔗 ${url}</div>
		</div>
		<div class="content">
			${resultItems.length > 0 ? resultItems : '<div class="empty-state"><p>No results available yet. Please try again.</p></div>'}
		</div>
	</div>
</body>
</html>`;
}

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('uiqlab-assessment.runAssessment', async () => {
		const currentCodeLocation = resolveCurrentCodeLocation(vscode.window, vscode.workspace);
		const request = await collectAssessmentRunRequest(vscode.window, currentCodeLocation);

		if (!request) {
			return;
		}

		void vscode.window.showInformationMessage(formatAssessmentRunSummary(request));

		// If user selected a deployment URL data source, offer to share it with the orchestrator
		if (request.dataSource.kind === 'deployment-url') {
			const deploymentUrl = request.dataSource.deploymentUrl;

			// remember last URL in workspaceState
			try {
				context.workspaceState.update('uiqlab.lastUrl', deploymentUrl);
			} catch { }

			// If it's a localhost URL, perform capture via Playwright before upload
			let isLocal = false;
			try {
				const u = new URL(deploymentUrl);
				isLocal = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(u.hostname);
			} catch { }

			if (isLocal) {
				const share = await vscode.window.showQuickPick(['Yes', 'No'], { title: 'Local URL detected. Capture rendered page with Playwright and upload artifacts to orchestrator?', placeHolder: 'Capture locally and upload screenshot+HTML?' });
				if (share === 'Yes') {
					// perform capture with progress
					try {
						await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Capturing local page for assessment', cancellable: true }, async (progress, token) => {
							progress.report({ message: 'Opening headless browser' });
							const { capturePage } = await import('./playwrightCapture.js');
							const p = capturePage(deploymentUrl);
							// hook cancellation
							token.onCancellationRequested(() => {
								// Note: capturePage currently does not accept an AbortSignal; cancellation will just show message
								vscode.window.showInformationMessage('Capture cancelled by user');
							});
							progress.report({ message: 'Waiting for page load and rendering' });
							const result = await p;
							progress.report({ message: 'Uploading artifacts to orchestrator' });
							const resp = await submitFileForEvaluation(result.screenshot, 'capture.png', 'image/png', request.assessments);
							const wui_id = resp?.result_id;
							if (!wui_id) {
								vscode.window.showInformationMessage('Submitted artifacts for evaluation; response did not include an id.');
								return;
							}
							vscode.window.showInformationMessage(`Submitted for evaluation (id: ${wui_id}). Waiting for result...`);
							
							// Poll for result
							const expectedCount = new Set(toMetricIds(request.assessments)).size;
							let panel: vscode.WebviewPanel | undefined;

							const resultData = await pollEvaluationResult(wui_id, expectedCount, {
								onUpdate: (currentResults) => {
									if (!panel) {
										panel = vscode.window.createWebviewPanel('evaluationResults', 'Evaluation Results', vscode.ViewColumn.One, {});
									}
									createResultsWebview(panel, currentResults, deploymentUrl, false);
								},
								isCancelled: () => token.isCancellationRequested
							});

							if (resultData && resultData.length > 0) {
								if (!panel) {
									panel = vscode.window.createWebviewPanel('evaluationResults', 'Evaluation Results', vscode.ViewColumn.One, {});
								}
								createResultsWebview(panel, resultData, deploymentUrl, true);
							} else {
								vscode.window.showInformationMessage('Timed out or cancelled waiting for evaluation result.');
							}
						});
					} catch (err: any) {
						vscode.window.showErrorMessage(`Capture or upload failed: ${err?.message ?? err}`);
					}
					return;
				}
			}

			// Fall back to submitting URL only (existing behavior)
			const share = await vscode.window.showQuickPick(['Yes', 'No'], { title: 'Share deployment URL with orchestrator for evaluation?', placeHolder: 'Send URL and selected metrics to orchestrator?' });
			if (share === 'Yes') {
				try {
					const resp: any = await submitUrlForEvaluation(request.dataSource.deploymentUrl, request.assessments);

					// The orchestrator is expected to return some identifier (wui_id) or similar.
					const wui_id = resp?.result_id;

					if (!wui_id) {
						vscode.window.showInformationMessage('Submitted for evaluation; response did not include an id.');
						return;
					}

					vscode.window.showInformationMessage(`Submitted for evaluation (id: ${wui_id}). Waiting for result...`);

					// Poll for result
					const expectedCount = new Set(toMetricIds(request.assessments)).size;
					let panel: vscode.WebviewPanel | undefined;

					const resultData = await vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: 'Waiting for evaluation results',
						cancellable: true
					}, async (progress, token) => {
						return await pollEvaluationResult(wui_id, expectedCount, {
							onUpdate: (currentResults) => {
								if (!panel) {
									panel = vscode.window.createWebviewPanel('evaluationResults', 'Evaluation Results', vscode.ViewColumn.One, {});
								}
								createResultsWebview(panel, currentResults, deploymentUrl, false);
							},
							isCancelled: () => token.isCancellationRequested
						});
					});

					if (resultData && resultData.length > 0) {
						if (!panel) {
							panel = vscode.window.createWebviewPanel(
								'evaluationResults',
								'Evaluation Results',
								vscode.ViewColumn.One,
								{}
							);
						}
						createResultsWebview(panel, resultData, deploymentUrl, true);
					} else {
						vscode.window.showInformationMessage('Timed out or cancelled waiting for evaluation result. Check orchestrator/service for progress.');
					}
				} catch (err: any) {
					vscode.window.showErrorMessage(`Failed to submit URL for evaluation: ${err?.message ?? err}`);
				}
			}
		} else if (request.dataSource.kind === 'current-code') {
			const location = request.dataSource.location;
			const fileName = location.split(/[\\/]/).pop() || 'artifact';
			const ext = fileName.split('.').pop()?.toLowerCase();

			if (ext !== 'html' && ext !== 'zip' && ext !== 'png') {
				vscode.window.showErrorMessage(`Unsupported file type: .${ext}. Only .html, .zip, and .png are supported.`);
				return;
			}

			let contentType = 'application/octet-stream';
			if (ext === 'html') {
				contentType = 'text/html';
			} else if (ext === 'png') {
				contentType = 'image/png';
			} else if (ext === 'zip') {
				contentType = 'application/zip';
			}

			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: `Uploading ${fileName} for assessment`,
					cancellable: true
				}, async (progress, token) => {
					const fileUri = vscode.Uri.file(location);
					const fileDataRaw = await vscode.workspace.fs.readFile(fileUri);
					const fileData = Buffer.from(fileDataRaw);

					progress.report({ message: 'Sending to orchestrator' });
					const resp = await submitFileForEvaluation(fileData, fileName, contentType, request.assessments);
					const wui_id = resp?.result_id;

					if (!wui_id) {
						vscode.window.showInformationMessage('Submitted file for evaluation; response did not include an id.');
						return;
					}

					vscode.window.showInformationMessage(`Submitted for evaluation (id: ${wui_id}). Waiting for result...`);

					// Poll for result
					const expectedCount = new Set(toMetricIds(request.assessments)).size;
					let panel: vscode.WebviewPanel | undefined;

					const resultData = await pollEvaluationResult(wui_id, expectedCount, {
						onUpdate: (currentResults) => {
							if (!panel) {
								panel = vscode.window.createWebviewPanel('evaluationResults', 'Evaluation Results', vscode.ViewColumn.One, {});
							}
							createResultsWebview(panel, currentResults, fileName, false);
						}
					});

					if (resultData && resultData.length > 0) {
						if (!panel) {
							panel = vscode.window.createWebviewPanel('evaluationResults', 'Evaluation Results', vscode.ViewColumn.One, {});
						}
						createResultsWebview(panel, resultData, fileName, true);
					} else {
						vscode.window.showInformationMessage('Timed out waiting for evaluation result.');
					}
				});
			} catch (err: any) {
				vscode.window.showErrorMessage(`Failed to read or upload file: ${err?.message ?? err}`);
			}
		}
	});

	context.subscriptions.push(disposable);
}

export function deactivate() { }
