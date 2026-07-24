import * as vscode from 'vscode';
import {
	collectAssessmentRunRequest,
	formatAssessmentRunSummary,
	resolveCurrentCodeLocation,
} from './runAssessment';

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('uiqlab-assessment.runAssessment', async () => {
		const currentCodeLocation = resolveCurrentCodeLocation(vscode.window, vscode.workspace);
		const request = await collectAssessmentRunRequest(vscode.window, currentCodeLocation);

		if (!request) {
			return;
		}

		void vscode.window.showInformationMessage(formatAssessmentRunSummary(request));
	});

	context.subscriptions.push(disposable);
}

export function deactivate() { }
