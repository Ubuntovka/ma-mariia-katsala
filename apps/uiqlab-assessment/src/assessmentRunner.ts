import { execSync } from 'child_process';
import * as vscode from 'vscode';
import { errorMessage, logDiagnostic } from './diagnostics';
import { showHistoryComparison } from './historyWebview';
import {
	assessProfilesAgainstHistory,
	normalizeProfileAssessmentSelection,
} from './profileAssessment';
import { getOrCreateProjectConfig, type ProjectConfig } from './projectConfig';
import { generateResultsHtml } from './resultsWebview';
import {
	fetchAssessmentExplanation,
	fetchAssessmentHistory,
	formatAssessmentRunSummary,
	pollEvaluationResult,
	submitFileForEvaluation,
	submitUrlForEvaluation,
	toMetricIds,
	type AssessmentHistory,
	type AssessmentMetricResult,
	type AssessmentRunRequest,
	type AssessmentSelection,
	type CustomMetricLlmFeedback,
	type GitInfo,
	type ProfileLlmFeedback,
} from './runAssessment';
import { collectWorkspaceSourceContext } from './sourceContext';

const COMPARABLE_METRICS = new Set(Array.from({ length: 14 }, (_, index) => `m${index + 1}`));

export type RunConfiguredAssessment = (
	request: AssessmentRunRequest,
	shareDeployment: boolean,
	useLlmExplanation: boolean,
	shareSourceCode: boolean,
) => Promise<void>;

function readGitValue(workspaceRoot: string, command: string, diagnosticContext: string): string {
	try {
		return execSync(command, { cwd: workspaceRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch (error) {
		logDiagnostic(diagnosticContext, error);
		return '';
	}
}

function getGitInfo(workspaceRoot: string, projectConfig: ProjectConfig): GitInfo {
	const repositoryUrl = readGitValue(workspaceRoot, 'git remote get-url origin', 'Could not read Git remote');
	const branch = readGitValue(workspaceRoot, 'git rev-parse --abbrev-ref HEAD', 'Could not read Git branch');
	const commitHash = readGitValue(workspaceRoot, 'git rev-parse HEAD', 'Could not read Git commit');
	const status = readGitValue(workspaceRoot, 'git status --porcelain', 'Could not read Git status');
	return {
		projectKey: projectConfig.projectKey,
		repositoryUrl: repositoryUrl || 'local',
		projectName: projectConfig.name,
		source: 'ide',
		branch: branch || undefined,
		commitHash: commitHash || undefined,
		gitDirty: status.length > 0,
	};
}

function ensureResultsPanel(panel: vscode.WebviewPanel | undefined): vscode.WebviewPanel {
	return panel ?? vscode.window.createWebviewPanel(
		'evaluationResults',
		'Evaluation Results',
		vscode.ViewColumn.One,
		{ enableScripts: false },
	);
}

function renderResults(
	panel: vscode.WebviewPanel,
	results: AssessmentMetricResult[],
	target: string,
	isComplete: boolean,
	explanation?: string | null,
	explanationError?: string,
	profileFeedback?: ProfileLlmFeedback,
	customFeedback?: CustomMetricLlmFeedback,
): void {
	panel.webview.html = generateResultsHtml(
		results,
		target,
		isComplete,
		explanation,
		explanationError,
		profileFeedback,
		customFeedback,
	);
}

async function buildExplanationContext(
	assessmentSelection: AssessmentSelection,
	currentResults: AssessmentMetricResult[],
	history: AssessmentHistory | undefined,
	target: string,
	workspaceRoot: string,
	shareSourceCode: boolean,
) {
	const sourceContext = shareSourceCode
		? await collectWorkspaceSourceContext(workspaceRoot, target)
		: [];
	const selectedProfiles = normalizeProfileAssessmentSelection(assessmentSelection);
	if (!selectedProfiles) {
		return { assessment: assessmentSelection, target, ...(sourceContext.length > 0 ? { sourceContext } : {}) };
	}
	return {
		assessment: assessmentSelection,
		profileAssessment: assessProfilesAgainstHistory(
			selectedProfiles,
			currentResults,
			history?.metrics ?? {},
			Boolean(history?.baselineRun),
		),
		target,
		...(sourceContext.length > 0 ? { sourceContext } : {}),
	};
}

async function chooseHistory(
	resultId: string,
	comparison: AssessmentRunRequest['comparison'],
): Promise<AssessmentHistory | undefined> {
	try {
		return await fetchAssessmentHistory(
			resultId,
			comparison?.kind === 'selected' ? comparison.baselineRunId : undefined,
		);
	} catch (error) {
		if (comparison?.kind === 'selected') {
			void vscode.window.showErrorMessage(`Could not load the selected assessment: ${errorMessage(error)}`);
		} else {
			logDiagnostic('Could not load assessment history', error);
		}
		return undefined;
	}
}

function hasComparableResult(results: AssessmentMetricResult[]): boolean {
	return results.some((result) => COMPARABLE_METRICS.has(result.metric_id.split('_')[0]));
}

async function submitAssessment(
	request: AssessmentRunRequest,
	assessmentSelection: AssessmentSelection,
	workspaceRoot: string,
	projectConfig: ProjectConfig,
	progress: vscode.Progress<{ message?: string }>,
	token: vscode.CancellationToken,
): Promise<{ resultId: string; target: string; totalSteps: number }> {
	const gitInfo = getGitInfo(workspaceRoot, projectConfig);
	if (request.dataSource.kind === 'deployment-url') {
		progress.report({ message: 'Step 1 of 3: Submitting the page' });
		const response = await submitUrlForEvaluation(
			request.dataSource.deploymentUrl,
			request.assessments,
			gitInfo,
			assessmentSelection,
		);
		if (!response.result_id) { throw new Error('The evaluation service did not return a result ID.'); }
		return { resultId: response.result_id, target: request.dataSource.deploymentUrl, totalSteps: 3 };
	}

	const target = request.dataSource.localUrl;
	progress.report({ message: 'Step 1 of 4: Opening the local page' });
	const { capturePage } = await import('./playwrightCapture.js');
	token.onCancellationRequested(() => {
		void vscode.window.showInformationMessage('Capture cancellation requested; waiting for the browser capture to stop.');
	});
	progress.report({ message: 'Step 1 of 4: Waiting for the page to finish rendering' });
	const capture = await capturePage(target);
	if (token.isCancellationRequested) { throw new vscode.CancellationError(); }
	progress.report({ message: 'Step 2 of 4: Uploading the captured page' });
	const response = await submitFileForEvaluation(
		capture.screenshot,
		'capture.png',
		'image/png',
		request.assessments,
		gitInfo,
		target,
		capture.screenshotDimensions,
		capture.html,
		assessmentSelection,
	);
	if (!response.result_id) { throw new Error('The evaluation service did not return a result ID.'); }
	return { resultId: response.result_id, target, totalSteps: 4 };
}

export function createAssessmentRunner(context: vscode.ExtensionContext): RunConfiguredAssessment {
	return async (request, shareDeployment, useLlmExplanation, shareSourceCode): Promise<void> => {
		if (request.dataSource.kind === 'deployment-url' && !shareDeployment) { return; }
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
		let projectConfig: ProjectConfig;
		try {
			projectConfig = await getOrCreateProjectConfig(workspaceRoot);
		} catch (error) {
			void vscode.window.showErrorMessage(`Could not load the UIQLab project configuration: ${errorMessage(error)}`);
			return;
		}
		const assessmentSelection: AssessmentSelection = request.assessment
			?? (projectConfig.assessment?.mode === 'profiles'
				? { mode: 'profiles', profiles: projectConfig.assessment.profiles }
				: { mode: 'custom' });
		void vscode.window.showInformationMessage(formatAssessmentRunSummary(request));

		if (request.dataSource.kind === 'deployment-url') {
			void context.workspaceState.update('uiqlab.lastUrl', request.dataSource.deploymentUrl).then(
				undefined,
				(error) => logDiagnostic('Could not persist the last assessment URL', error),
			);
		}

		try {
			const results = await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Running UIQLab assessment',
				cancellable: true,
			}, async (progress, token) => {
				const submission = await submitAssessment(
					request, assessmentSelection, workspaceRoot, projectConfig, progress, token,
				);
				const expectedCount = new Set(toMetricIds(request.assessments)).size;
				const assessmentStep = submission.totalSteps - 1;
				let panel: vscode.WebviewPanel | undefined;
				progress.report({ message: `Step ${assessmentStep} of ${submission.totalSteps}: Running assessments (0 of ${expectedCount} complete)` });
				const currentResults = await pollEvaluationResult(submission.resultId, expectedCount, {
					onUpdate: (updates) => {
						const completedCount = new Set(updates.map((result) => result.metric_id.split('_')[0])).size;
						progress.report({ message: `Step ${assessmentStep} of ${submission.totalSteps}: Running assessments (${Math.min(completedCount, expectedCount)} of ${expectedCount} complete)` });
						panel = ensureResultsPanel(panel);
						renderResults(panel, updates, submission.target, false);
					},
					isCancelled: () => token.isCancellationRequested,
					onError: (error) => logDiagnostic('Evaluation result polling failed; retrying', error),
				});
				if (currentResults.length === 0) { return currentResults; }

				progress.report({ message: `Step ${submission.totalSteps} of ${submission.totalSteps}: ${useLlmExplanation ? 'Explaining results' : 'Preparing results'}` });
				panel = ensureResultsPanel(panel);
				const history = hasComparableResult(currentResults)
					? await chooseHistory(submission.resultId, request.comparison)
					: undefined;
				let explanation: string | undefined;
				let explanationError: string | undefined;
				let profileFeedback: ProfileLlmFeedback | undefined;
				let customFeedback: CustomMetricLlmFeedback | undefined;
				if (useLlmExplanation) {
					try {
						const explanationContext = await buildExplanationContext(
							assessmentSelection, currentResults, history, submission.target, workspaceRoot, shareSourceCode,
						);
						const response = await fetchAssessmentExplanation(currentResults, history, explanationContext);
						explanation = response.explanation;
						profileFeedback = response.profileFeedback;
						customFeedback = response.customFeedback;
					} catch (error) {
						explanationError = errorMessage(error);
						logDiagnostic('Could not generate the assessment explanation', error);
					}
				}
				renderResults(panel, currentResults, submission.target, true, explanation, explanationError, profileFeedback, customFeedback);
				if (history) {
					await showHistoryComparison(currentResults, history, submission.target, toMetricIds(request.assessments), request.assessment);
				}
				return currentResults;
			});

			void vscode.window.showInformationMessage(results.length > 0
				? 'UIQLab assessment complete. Results are ready.'
				: 'Timed out or cancelled waiting for evaluation results.');
		} catch (error) {
			if (error instanceof vscode.CancellationError) { return; }
			const operation = request.dataSource.kind === 'local-url' ? 'Capture or upload failed' : 'Failed to submit URL for evaluation';
			void vscode.window.showErrorMessage(`${operation}: ${errorMessage(error)}`);
			logDiagnostic(operation, error);
		}
	};
}
