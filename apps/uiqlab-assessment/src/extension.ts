import * as vscode from 'vscode';
import {
	collectAssessmentRunRequest,
	formatAssessmentRunSummary,
	resolveCurrentCodeLocation,
	submitUrlForEvaluation,
	fetchEvaluationResult,
	getMetricInfoById,
} from './runAssessment';

function createResultsWebview(
	panel: vscode.WebviewPanel,
	results: any[],
	url: string,
): void {
	const html = generateResultsHtml(results, url);
	panel.webview.html = html;
}

function generateResultsHtml(results: any[], url: string): string {
	const resultItems = (Array.isArray(results) ? results : []).map((r) => {
		const metric = getMetricInfoById(r.metric_id);
		const metricName = metric?.name || r.metric_id;
		const resultValues = Array.isArray(r.results) ? r.results : [r.results];

		return `
		<div class="metric-result">
			<h3>${metricName}</h3>
			<div class="result-values">
				${resultValues.map((val: any, i: number) => 
					`<div class="result-item"><strong>Result ${i + 1}:</strong> ${typeof val === 'object' ? JSON.stringify(val) : val}</div>`
				).join('')}
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
			<p>Web UI Assessment Complete</p>
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
					for (let attempt = 0; attempt < 15; attempt++) {
						try {
							const result = await fetchEvaluationResult(wui_id);
							if (result && Array.isArray(result) && result.length > 0) {
								// Create and show webview with results
								const panel = vscode.window.createWebviewPanel(
									'evaluationResults',
									'Evaluation Results',
									vscode.ViewColumn.One,
									{}
								);
								createResultsWebview(panel, result, request.dataSource.deploymentUrl);
								return;
							}
						} catch (err) {
							// ignore and retry
						}
						// delay
						await new Promise((r) => setTimeout(r, 2000));
					}

					vscode.window.showInformationMessage('Timed out waiting for evaluation result. Check orchestrator/service for progress.');
				} catch (err: any) {
					vscode.window.showErrorMessage(`Failed to submit URL for evaluation: ${err?.message ?? err}`);
				}
			}
		}
	});

	context.subscriptions.push(disposable);
}

export function deactivate() { }
