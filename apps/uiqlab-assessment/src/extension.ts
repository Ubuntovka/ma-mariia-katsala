import * as vscode from 'vscode';
import { createAssessmentRunner } from './assessmentRunner';
import { ASSESSMENT_PROFILES } from './assessmentProfiles';
import { AssessmentSidebarProvider, type SidebarInitialSelection } from './assessmentSidebar';
import { errorMessage, logDiagnostic } from './diagnostics';
import { initializeDiagnostics } from './vscodeDiagnostics';
import { showHistoryComparison } from './historyWebview';
import { getOrCreateProjectConfig, type ProjectConfig } from './projectConfig';
import {
	fetchAssessmentRunComparison,
	fetchProjectAssessmentRuns,
	type AssessmentRunSummary,
} from './runAssessment';

export * from './historyWebview';
export * from './historyRendering';
export * from './metricComparisons';
export * from './resultsWebview';
export * from './webviewFormatting';

async function compareAssessmentRuns(
	projectConfig: ProjectConfig,
	currentRunId: number,
	baselineRunId: number,
): Promise<void> {
	try {
		const comparison = await fetchAssessmentRunComparison(currentRunId, baselineRunId);
		const shown = await showHistoryComparison(
			comparison.currentResults,
			comparison.history,
			comparison.current.assessedTarget ?? projectConfig.name,
			[],
			comparison.current.assessment,
		);
		if (!shown) {
			void vscode.window.showInformationMessage('The selected assessments do not contain any comparable metrics.');
		}
	} catch (error) {
		logDiagnostic('Could not compare assessments', error);
		void vscode.window.showErrorMessage(`Could not compare assessments: ${errorMessage(error)}`);
	}
}

function workspaceRoot(): string {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
}

export function activate(context: vscode.ExtensionContext): void {
	initializeDiagnostics(context);
	const runConfiguredAssessment = createAssessmentRunner(context);
	const loadAssessmentRuns = async (): Promise<AssessmentRunSummary[]> => {
		const projectConfig = await getOrCreateProjectConfig(workspaceRoot());
		return fetchProjectAssessmentRuns(projectConfig.projectKey);
	};
	const loadInitialSelection = async (): Promise<SidebarInitialSelection | undefined> => {
		const projectConfig = await getOrCreateProjectConfig(workspaceRoot());
		if (projectConfig.assessment?.mode === 'custom') {
			return { mode: 'custom', metrics: projectConfig.assessment.metrics };
		}
		if (projectConfig.assessment?.mode === 'profiles') {
			if (projectConfig.assessment.profiles.some((profile) => profile.id === 'general-review')) {
				return { mode: 'custom', metrics: [...ASSESSMENT_PROFILES['general-review'].metrics] };
			}
			return { mode: 'profiles', profiles: projectConfig.assessment.profiles };
		}
		return undefined;
	};
	const compareSelectedRuns = async (currentRunId: number, baselineRunId: number): Promise<void> => {
		const projectConfig = await getOrCreateProjectConfig(workspaceRoot());
		await compareAssessmentRuns(projectConfig, currentRunId, baselineRunId);
	};
	const sidebarProvider = new AssessmentSidebarProvider(
		context,
		runConfiguredAssessment,
		loadAssessmentRuns,
		loadInitialSelection,
		compareSelectedRuns,
	);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(AssessmentSidebarProvider.viewType, sidebarProvider),
		vscode.commands.registerCommand('uiqlab-assessment.runAssessment', async () => {
			await vscode.commands.executeCommand('workbench.view.extension.uiqlab-assessment');
			sidebarProvider.reveal();
		}),
		vscode.commands.registerCommand('uiqlab-assessment.comparePastAssessments', async () => {
			await vscode.commands.executeCommand('workbench.view.extension.uiqlab-assessment');
			sidebarProvider.revealPastComparison();
		}),
	);
}

export function deactivate(): void {
	// VS Code calls this lifecycle hook; all resources are owned by subscriptions.
}
