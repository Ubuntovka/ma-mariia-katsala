import * as vscode from 'vscode';
import {
	formatAssessmentRunSummary,
	submitUrlForEvaluation,
	submitFileForEvaluation,
	pollEvaluationResult,
	fetchAssessmentHistory,
	toMetricIds,
	getMetricInfoById,
	GitInfo,
	AssessmentRunRequest,
	AssessmentHistory,
} from './runAssessment';
import { execSync } from 'child_process';
import { getOrCreateProjectConfig, ProjectConfig } from './projectConfig';
import { AssessmentSidebarProvider } from './assessmentSidebar';

function getGitInfo(workspaceRoot: string, projectConfig: ProjectConfig): GitInfo {
	let repositoryUrl = '';
	let branch = '';
	let commitHash = '';
	let gitDirty = false;

	try {
		repositoryUrl = execSync('git remote get-url origin', { cwd: workspaceRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch { }

	try {
		branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workspaceRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch { }

	try {
		commitHash = execSync('git rev-parse HEAD', { cwd: workspaceRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch { }

	try {
		gitDirty = execSync('git status --porcelain', { cwd: workspaceRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0;
	} catch { }

	return {
		projectKey: projectConfig.projectKey,
		repositoryUrl: repositoryUrl || 'local',
		projectName: projectConfig.name,
		source: 'ide',
		branch: branch || undefined,
		commitHash: commitHash || undefined,
		gitDirty,
	};
}

function createResultsWebview(
	panel: vscode.WebviewPanel,
	results: any[],
	url: string,
	isComplete: boolean = true
): void {
	const html = generateResultsHtml(results, url, isComplete);
	panel.webview.html = html;
}

export interface M1SizeComparison {
	currentBytes: number;
	previousBytes: number;
	absoluteDelta: number;
	relativeDeltaPercent?: number;
}

function finiteNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

export function calculateM1SizeComparison(
	currentValue: unknown,
	previousValue: unknown
): M1SizeComparison | undefined {
	const currentBytes = finiteNumber(currentValue);
	const previousBytes = finiteNumber(previousValue);
	if (currentBytes === undefined || previousBytes === undefined) {
		return undefined;
	}
	const absoluteDelta = currentBytes - previousBytes;
	return {
		currentBytes,
		previousBytes,
		absoluteDelta,
		relativeDeltaPercent: previousBytes === 0
			? undefined
			: (absoluteDelta / previousBytes) * 100,
	};
}

function generateResultsHtml(results: any[], url: string, isComplete: boolean = true): string {
	// Filter out results that are completely empty, but keep them if they are the only ones for a metric
	const filteredResults = results.filter((r, i) => {
		if (Array.isArray(r.results) && r.results.length > 0) {
			return true;
		}
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

function findM1HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory
): { comparison: M1SizeComparison; previousCreatedAt: string } | undefined {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm1') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) {
			continue;
		}
		const currentValues = Array.isArray(currentResult.results)
			? currentResult.results
			: [currentResult.results];
		const previousValues = Array.isArray(historicalResult.results)
			? historicalResult.results
			: [historicalResult.results];
		const comparison = calculateM1SizeComparison(currentValues[0], previousValues[0]);
		if (comparison) {
			return { comparison, previousCreatedAt: historicalResult.createdAt };
		}
	}
	return undefined;
}

function signedNumber(value: number, maximumFractionDigits: number = 0): string {
	if (value === 0 || Object.is(value, -0)) {
		return '0';
	}
	return `${value > 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits })}`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function showM1HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory,
	url: string
): void {
	const match = findM1HistoryComparison(currentResults, history);
	const dimensions = history.screenshotDimensions;
	if (!match || !dimensions) {
		return;
	}

	const { comparison, previousCreatedAt } = match;
	const relativeDelta = comparison.relativeDeltaPercent === undefined
		? 'Not available'
		: `${signedNumber(comparison.relativeDeltaPercent, 2)}%`;
	const previousDate = new Date(previousCreatedAt).toLocaleString();
	const panel = vscode.window.createWebviewPanel(
		'm1HistoryComparison',
		'M1 PNG Size Comparison',
		vscode.ViewColumn.Beside,
		{}
	);

	panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>M1 PNG Size Comparison</title>
	<style>
		* { box-sizing: border-box; }
		body { margin: 0; padding: 28px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
		main { max-width: 860px; margin: 0 auto; }
		h1 { margin: 0 0 8px; font-size: 26px; }
		.context { margin: 0 0 24px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
		.path { font-family: var(--vscode-editor-font-family); word-break: break-all; }
		.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }
		.card { padding: 18px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-sideBar-background); }
		.label { display: block; margin-bottom: 8px; color: var(--vscode-descriptionForeground); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
		.value { font-size: 22px; font-weight: 650; }
		.explanation { padding: 18px; border-left: 4px solid var(--vscode-focusBorder); background: var(--vscode-textBlockQuote-background); line-height: 1.55; }
		.explanation h2 { margin: 0 0 8px; font-size: 16px; }
		.explanation p { margin: 0; }
	</style>
</head>
<body>
	<main>
		<h1>M1 · PNG file size change</h1>
		<p class="context"><span class="path">${escapeHtml(url)}</span><br>${dimensions.width} × ${dimensions.height} px · compared with the completed run from ${previousDate}</p>
		<section class="grid" aria-label="PNG size comparison">
			<div class="card"><span class="label">Previous size</span><span class="value">${comparison.previousBytes.toLocaleString()} bytes</span></div>
			<div class="card"><span class="label">Current size</span><span class="value">${comparison.currentBytes.toLocaleString()} bytes</span></div>
			<div class="card"><span class="label">Absolute delta</span><span class="value">${signedNumber(comparison.absoluteDelta)} bytes</span></div>
			<div class="card"><span class="label">Relative delta</span><span class="value">${relativeDelta}</span></div>
		</section>
		<section class="explanation">
			<h2>How to read this comparison</h2>
			<p>M1 reports the PNG screenshot size in bytes. The absolute delta is current size minus previous size; the relative delta expresses that change as a percentage of the previous size and is unavailable when the previous size is zero. Only screenshots with identical pixel dimensions are compared. PNG size has no universal “better” direction, so this page reports the change without labeling it as an improvement or regression.</p>
		</section>
	</main>
</body>
</html>`;
}

export function activate(context: vscode.ExtensionContext) {
	const runConfiguredAssessment = async (request: AssessmentRunRequest, shareDeployment: boolean): Promise<void> => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
		let projectConfig: ProjectConfig;
		try {
			projectConfig = await getOrCreateProjectConfig(workspaceRoot);
		} catch (err: any) {
			vscode.window.showErrorMessage(`Could not load the UIQLab project configuration: ${err?.message ?? err}`);
			return;
		}

		void vscode.window.showInformationMessage(formatAssessmentRunSummary(request));

		// Deployment consent is collected in the persistent sidebar form.
		if (request.dataSource.kind === 'deployment-url') {
			const deploymentUrl = request.dataSource.deploymentUrl;

			// remember last URL in workspaceState
			try {
				context.workspaceState.update('uiqlab.lastUrl', deploymentUrl);
			} catch { }

			if (shareDeployment) {
				try {
					const resultData = await vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: 'Running UIQLab assessment',
						cancellable: true
					}, async (progress, token) => {
						progress.report({ message: 'Step 1 of 3: Submitting the page' });
						const gitInfo = getGitInfo(workspaceRoot, projectConfig);
						const resp: any = await submitUrlForEvaluation(deploymentUrl, request.assessments, gitInfo);
						const wui_id = resp?.result_id;

						if (!wui_id) {
							throw new Error('The evaluation service did not return the tracking information needed to retrieve results.');
						}

						const expectedCount = new Set(toMetricIds(request.assessments)).size;
						let panel: vscode.WebviewPanel | undefined;
						progress.report({ message: `Step 2 of 3: Running assessments (0 of ${expectedCount} complete)` });

						const results = await pollEvaluationResult(wui_id, expectedCount, {
							onUpdate: (currentResults) => {
								const completedCount = new Set(currentResults.map((result: any) => result.metric_id.split('_')[0])).size;
								progress.report({ message: `Step 2 of 3: Running assessments (${Math.min(completedCount, expectedCount)} of ${expectedCount} complete)` });
								if (!panel) {
									panel = vscode.window.createWebviewPanel('evaluationResults', 'Evaluation Results', vscode.ViewColumn.One, {});
								}
								createResultsWebview(panel, currentResults, deploymentUrl, false);
							},
							isCancelled: () => token.isCancellationRequested
						});

						if (results.length > 0) {
							progress.report({ message: 'Step 3 of 3: Displaying results' });
							if (!panel) {
								panel = vscode.window.createWebviewPanel('evaluationResults', 'Evaluation Results', vscode.ViewColumn.One, {});
							}
							createResultsWebview(panel, results, deploymentUrl, true);
						}

						return results;
					});

					if (resultData && resultData.length > 0) {
						vscode.window.showInformationMessage('UIQLab assessment complete. Results are ready.');
					} else {
						vscode.window.showInformationMessage('Timed out or cancelled waiting for evaluation result. Check orchestrator/service for progress.');
					}
				} catch (err: any) {
					vscode.window.showErrorMessage(`Failed to submit URL for evaluation: ${err?.message ?? err}`);
				}
			}
		} else if (request.dataSource.kind === 'local-url') {
			const localUrl = request.dataSource.localUrl;

			try {
				await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Running UIQLab assessment', cancellable: true }, async (progress, token) => {
					progress.report({ message: 'Step 1 of 4: Opening the local page' });
					const { capturePage } = await import('./playwrightCapture.js');
					const p = capturePage(localUrl);
					// hook cancellation
					token.onCancellationRequested(() => {
						// Note: capturePage currently does not accept an AbortSignal; cancellation will just show message
						vscode.window.showInformationMessage('Capture cancelled by user');
					});
					progress.report({ message: 'Step 1 of 4: Waiting for the page to finish rendering' });
					const result = await p;
					progress.report({ message: 'Step 2 of 4: Uploading the captured page' });
					const gitInfo = getGitInfo(workspaceRoot, projectConfig);
					const resp = await submitFileForEvaluation(
						result.screenshot,
						'capture.png',
						'image/png',
						request.assessments,
						gitInfo,
						localUrl,
						result.screenshotDimensions
					);
					const wui_id = resp?.result_id;
					if (!wui_id) {
						throw new Error('The evaluation service did not return the tracking information needed to retrieve results.');
					}
					
					// Poll for result
					const expectedCount = new Set(toMetricIds(request.assessments)).size;
					let panel: vscode.WebviewPanel | undefined;
					progress.report({ message: `Step 3 of 4: Running assessments (0 of ${expectedCount} complete)` });

					const resultData = await pollEvaluationResult(wui_id, expectedCount, {
						onUpdate: (currentResults) => {
							const completedCount = new Set(currentResults.map((currentResult: any) => currentResult.metric_id.split('_')[0])).size;
							progress.report({ message: `Step 3 of 4: Running assessments (${Math.min(completedCount, expectedCount)} of ${expectedCount} complete)` });
							if (!panel) {
								panel = vscode.window.createWebviewPanel('evaluationResults', 'Evaluation Results', vscode.ViewColumn.One, {});
							}
							createResultsWebview(panel, currentResults, localUrl, false);
						},
						isCancelled: () => token.isCancellationRequested
					});

					if (resultData && resultData.length > 0) {
						progress.report({ message: 'Step 4 of 4: Displaying results' });
						if (!panel) {
							panel = vscode.window.createWebviewPanel('evaluationResults', 'Evaluation Results', vscode.ViewColumn.One, {});
						}
						let history: AssessmentHistory | undefined;
						const hasM1Result = resultData.some(
							(result: any) => typeof result?.metric_id === 'string' && result.metric_id.split('_')[0] === 'm1'
						);
						if (hasM1Result) {
							try {
								history = await fetchAssessmentHistory(wui_id);
							} catch { }
						}
						createResultsWebview(panel, resultData, localUrl, true);
						if (history) {
							showM1HistoryComparison(resultData, history, localUrl);
						}
						vscode.window.showInformationMessage('UIQLab assessment complete. Results are ready.');
					} else {
						vscode.window.showInformationMessage('Timed out or cancelled waiting for evaluation result.');
					}
				});
			} catch (err: any) {
				vscode.window.showErrorMessage(`Capture or upload failed: ${err?.message ?? err}`);
			}
		}
	};

	const sidebarProvider = new AssessmentSidebarProvider(context, runConfiguredAssessment);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(AssessmentSidebarProvider.viewType, sidebarProvider),
		vscode.commands.registerCommand('uiqlab-assessment.runAssessment', async () => {
			await vscode.commands.executeCommand('workbench.view.extension.uiqlab-assessment');
			sidebarProvider.reveal();
		}),
	);
}

export function deactivate() { }
