import * as vscode from 'vscode';
import {
	collectAssessmentRunRequest,
	formatAssessmentRunSummary,
	resolveCurrentCodeLocation,
	submitUrlForEvaluation,
	fetchEvaluationResult,
} from './runAssessment';

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

					// Poll a few times for result
					for (let attempt = 0; attempt < 8; attempt++) {
						try {
							const result = await fetchEvaluationResult(wui_id);
							if (result) {
								vscode.window.showInformationMessage('Evaluation result received.');
								// Optionally show some summarized info
								vscode.window.showInformationMessage(JSON.stringify(result));
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
