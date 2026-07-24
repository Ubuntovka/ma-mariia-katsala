export const ASSESSMENTS = [
	'PNG size',
	'JPEG size/compression',
	'colorfulness',
	'color average/standard deviation',
	'whitespace',
	'UI Interpretation',
	'UMSI',
	'word count',
	'edges',
	'congestion',
	'subband entropy',
	'Shannon entropy',
	'accessibility',
	'NIMA',
] as const;

export const DATA_SOURCE_OPTIONS = [
	'Deployment URL',
	'Take from my current code',
] as const;

export type AssessmentName = (typeof ASSESSMENTS)[number];
export type DataSourceOption = (typeof DATA_SOURCE_OPTIONS)[number];

export interface DeploymentUrlDataSource {
	kind: 'deployment-url';
	deploymentUrl: string;
}

export interface CurrentCodeDataSource {
	kind: 'current-code';
	location: string;
}

export interface AssessmentRunRequest {
	assessments: AssessmentName[];
	dataSource: DeploymentUrlDataSource | CurrentCodeDataSource;
}

export interface QuickPickUi {
	showQuickPick(
		items: readonly string[],
		options: {
			title: string;
			placeHolder?: string;
			canPickMany?: boolean;
		}
	): Thenable<string | readonly string[] | undefined>;
	showInputBox(options: {
		title: string;
		prompt: string;
		placeHolder?: string;
		ignoreFocusOut?: boolean;
		validateInput?: (value: string) => string | undefined;
	}): Thenable<string | undefined>;
	showErrorMessage(message: string): Thenable<void>;
}

export interface WorkspaceLike {
	workspaceFolders?: readonly { uri: { fsPath: string } }[];
}

export interface WindowLike {
	activeTextEditor?: { document: { uri: { fsPath: string } } } | undefined;
}

export function resolveCurrentCodeLocation(window: WindowLike, workspace: WorkspaceLike): string | undefined {
	return window.activeTextEditor?.document.uri.fsPath ?? workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export async function collectAssessmentRunRequest(ui: QuickPickUi, currentCodeLocation: string | undefined): Promise<AssessmentRunRequest | undefined> {
	const selectedAssessments = await ui.showQuickPick(ASSESSMENTS, {
		title: 'Which assessments do you want to run?',
		placeHolder: 'Select one or more assessments',
		canPickMany: true,
	});

	if (selectedAssessments === undefined) {
		return undefined;
	}

	if (!Array.isArray(selectedAssessments)) {
		await ui.showErrorMessage('Select at least one assessment to run.');
		return undefined;
	}

	if (selectedAssessments.length === 0) {
		await ui.showErrorMessage('Select at least one assessment to run.');
		return undefined;
	}

	const dataSource = await ui.showQuickPick(DATA_SOURCE_OPTIONS, {
		title: 'How to get data?',
		placeHolder: 'Choose a data source',
	});

	if (dataSource === undefined) {
		return undefined;
	}

	if (dataSource === 'Deployment URL') {
		const deploymentUrl = await ui.showInputBox({
			title: 'Deployment URL',
			prompt: 'Enter the deployment URL to assess',
			placeHolder: 'https://example.com',
			ignoreFocusOut: true,
			validateInput: (value) => isValidUrl(value) ? undefined : 'Enter a valid URL.',
		});

		if (deploymentUrl === undefined) {
			return undefined;
		}

		return {
			assessments: toAssessmentNames(selectedAssessments),
			dataSource: {
				kind: 'deployment-url',
				deploymentUrl,
			},
		};
	}

	if (!currentCodeLocation) {
		await ui.showErrorMessage('Open a workspace or file before choosing "Take from my current code".');
		return undefined;
	}

	return {
		assessments: toAssessmentNames(selectedAssessments),
		dataSource: {
			kind: 'current-code',
			location: currentCodeLocation,
		},
	};
}

export function formatAssessmentRunSummary(request: AssessmentRunRequest): string {
	const dataSourceText = request.dataSource.kind === 'deployment-url'
		? `Deployment URL: ${request.dataSource.deploymentUrl}`
		: `Current code: ${request.dataSource.location}`;

	return `Selected assessments: ${request.assessments.join(', ')}. ${dataSourceText}.`;
}

function isValidUrl(value: string): boolean {
	try {
		return Boolean(new URL(value));
	} catch {
		return false;
	}
}

function toAssessmentNames(values: readonly string[]): AssessmentName[] {
	const assessments = values.filter(isAssessmentName);

	if (assessments.length !== values.length) {
		throw new Error('Unexpected assessment selection.');
	}

	return assessments;
}

function isAssessmentName(value: string): value is AssessmentName {
	return ASSESSMENTS.some((assessment) => assessment === value);
}
