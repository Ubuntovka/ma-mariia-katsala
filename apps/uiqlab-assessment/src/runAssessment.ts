import { getMetricDefinition } from './metricCatalog';
import { ASSESSMENT_PROFILES, type AssessmentProfileSelection } from './assessmentProfiles';
import { logDiagnostic } from './diagnostics';
import { readUiedDimensions } from './visualMetricComparisons';

export const ASSESSMENTS = [
	'PNG file size',
	'JPEG file size and compression ratio',
	'Colorfulness',
	'CIELab color average & standard deviation',
	'White space proportion',
	'UIED segmentation',
	'UMSI (Unified Model of Saliency and Importance)',
	'Word count',
	'Edge density',
	'Feature congestion',
	'Subband entropy',
	'Shannon\'s information entropy',
	'Accessibility checks',
	'NIMA (Neural IMage Assessment)',
] as const;

export const DATA_SOURCE_OPTIONS = [
	'Deployment URL',
	'Local URL',
] as const;

export type AssessmentName = string;
export type DataSourceOption = (typeof DATA_SOURCE_OPTIONS)[number];

export interface DeploymentUrlDataSource {
	kind: 'deployment-url';
	deploymentUrl: string;
}

export interface LocalUrlDataSource {
	kind: 'local-url';
	localUrl: string;
}

export interface DeploymentUrlComparisonDataSource {
	kind: 'deployment-url-comparison';
	baselineDeploymentUrl: string;
	currentDeploymentUrl: string;
}

export interface AssessmentRunRequest {
	assessments: AssessmentName[];
	assessment?: AssessmentSelection;
	dataSource: DeploymentUrlDataSource | LocalUrlDataSource | DeploymentUrlComparisonDataSource;
	comparison?:
		| { kind: 'latest' }
		| { kind: 'selected'; baselineRunId: number };
}

export interface GitInfo {
	projectKey: string;
	repositoryUrl: string;
	projectName?: string;
	source: 'ide' | 'ci/cd';
	branch?: string;
	commitHash?: string;
	gitDirty?: boolean;
	mergeRequestId?: string;
}

export type AssessmentSelection = { mode: 'custom' } | { mode: 'profiles'; profiles: AssessmentProfileSelection[] };

export interface AssessmentMetricResult {
	metric_id: string;
	results: unknown;
}

export interface EvaluationSubmission {
	result_id?: string;
}

export interface HistoricalMetricResult {
	results: unknown;
	createdAt: string;
}

export interface AssessmentHistory {
	metrics: Record<string, HistoricalMetricResult>;
	screenshotDimensions?: { width: number; height: number };
	currentRun?: AssessmentRunSummary;
	baselineRun?: AssessmentRunSummary;
}

export interface DirectComparisonHistoryOptions {
	createdAt?: string;
	currentResults?: AssessmentMetricResult[];
}

export function createDirectComparisonHistory(
	baselineResults: AssessmentMetricResult[],
	baselineUrl: string,
	currentUrl: string,
	assessment: AssessmentSelection,
	options: DirectComparisonHistoryOptions = {},
): AssessmentHistory {
	const createdAt = options.createdAt ?? new Date().toISOString();
	const baselineDimensions = baselineResults
		.filter((result) => result.metric_id.split('_')[0] === 'm6')
		.map((result) => readUiedDimensions(result.results))
		.find((dimensions) => dimensions !== undefined);
	const currentDimensions = (options.currentResults ?? [])
		.filter((result) => result.metric_id.split('_')[0] === 'm6')
		.map((result) => readUiedDimensions(result.results))
		.find((dimensions) => dimensions !== undefined);
	const screenshotDimensions = baselineDimensions && currentDimensions
		&& baselineDimensions.width === currentDimensions.width
		&& baselineDimensions.height === currentDimensions.height
		? currentDimensions
		: undefined;
	return {
		metrics: Object.fromEntries(baselineResults.map((result) => [result.metric_id, {
			results: result.results,
			createdAt,
		}])),
		...(screenshotDimensions ? { screenshotDimensions } : {}),
		baselineRun: {
			id: -1, createdAt, assessedTarget: baselineUrl, assessment,
			screenshotDimensions: baselineDimensions,
		},
		currentRun: {
			id: -2, createdAt, assessedTarget: currentUrl, assessment,
			screenshotDimensions: currentDimensions,
		},
	};
}

export interface AssessmentRunSummary {
	id: number;
	createdAt: string;
	commitHash?: string;
	gitDirty?: boolean;
	branch?: string;
	assessedTarget?: string;
	screenshotDimensions?: { width: number; height: number };
	assessment?: AssessmentSelection;
}

export interface AssessmentRunComparison {
	currentResults: AssessmentMetricResult[];
	history: AssessmentHistory;
	current: AssessmentRunSummary;
	baseline: AssessmentRunSummary;
}

export interface AssessmentExplanation {
	explanation: string;
	profileFeedback?: ProfileLlmFeedback;
	customFeedback?: CustomMetricLlmFeedback;
}

export interface CustomMetricLlmFinding {
	title: string;
	metricIds: string[];
	observation: string;
	interpretation: string;
	recommendation: string;
	files: string[];
}

export interface CustomMetricLlmFeedback {
	summary: string;
	findings: CustomMetricLlmFinding[];
	analysisMode: 'comparison' | 'current-state';
	materialChangeCount: number;
	sourceContextUsed: boolean;
	sourceFiles: string[];
}

export interface ProfileLlmSuggestion {
	title: string;
	action: string;
	rationale: string;
	files: string[];
}

export interface ProfileLlmFeedback {
	goalStatus: string;
	goalTitle: string;
	summary: string;
	changes: string[];
	suggestions: ProfileLlmSuggestion[];
	sourceContextUsed: boolean;
	sourceFiles: string[];
}

export interface AssessmentExplanationContext {
	projectKey: string;
	assessment?: AssessmentSelection;
	profileAssessment?: unknown;
	target?: string;
	sourceContext?: Array<{ path: string; content: string }>;
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

import * as http from 'http';
import * as https from 'https';

const ORCHESTRATOR_BASE = 'http://127.0.0.1:8181';
const DEFAULT_GET_TIMEOUT_MS = 10_000;
const RESULT_REQUEST_TIMEOUT_MS = 130_000;
const RESULT_POLL_TIMEOUT_MS = 300_000;
// The orchestrator receives both the screenshot and rendered HTML when a DOM
// metric is selected. It forwards them to the evaluator as separate requests.
const MAX_MULTIPART_BODY_BYTES = 10 * 1024 * 1024;

import FormData = require('form-data');

function responseErrorDetail(data: string): string {
	try {
		const body = JSON.parse(data) as { detail?: unknown };
		return typeof body.detail === 'string' ? body.detail : '';
	} catch {
		return '';
	}
}


async function httpGetJson<T>(url: string, timeoutMs: number = DEFAULT_GET_TIMEOUT_MS): Promise<T> {
	const parsed = new URL(url);
	const lib = parsed.protocol === 'https:' ? https : http;

	return new Promise<T>((resolve, reject) => {
		const req = lib.get(parsed, (res) => {
			let data = '';
			res.on('data', (chunk) => { data += chunk; });
			res.on('end', () => {
				try {
					if (res.statusCode && res.statusCode >= 400) {
						reject(new Error(`HTTP ${res.statusCode} from ${url}`));
						return;
					}
					resolve(JSON.parse(data));
				} catch (err) {
					reject(err);
				}
			});
		});
		req.on('error', reject);
		req.setTimeout(timeoutMs, () => {
			req.destroy();
			reject(new Error(`Timeout fetching ${url}`));
		});
		req.end();
	});
}

async function httpPostJson<T>(url: string, body: unknown, timeoutMs: number = 130_000): Promise<T> {
	const parsed = new URL(url);
	const lib = parsed.protocol === 'https:' ? https : http;
	const payload = JSON.stringify(body);

	const opts: http.RequestOptions = {
		host: parsed.hostname,
		port: parsed.port,
		path: parsed.pathname + parsed.search,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(payload),
		},
	};

	return new Promise<T>((resolve, reject) => {
		const req = lib.request(opts, (res) => {
			let data = '';
			res.on('data', (chunk) => { data += chunk; });
			res.on('end', () => {
				try {
					if (res.statusCode && res.statusCode >= 400) {
						const detail = responseErrorDetail(data);
						reject(new Error(detail || `HTTP ${res.statusCode} from ${url}`));
						return;
					}
					resolve(JSON.parse(data));
				} catch (err) {
					reject(err);
				}
			});
		});
		req.on('error', reject);
		req.setTimeout(timeoutMs, () => {
			req.destroy();
			reject(new Error(`Timeout posting to ${url}`));
		});
		req.write(payload);
		req.end();
	});
}

export interface MetricInfo {
	name: AssessmentName;
	id: string;
}

let cachedMetrics: MetricInfo[] = [];

/**
 * Get metric info by its ID (e.g., "m1_png_file_size" or "m1").
 */
export function getMetricInfoById(metricId: string): MetricInfo | undefined {
	return cachedMetrics.find((m) => m.id === metricId || m.id === metricId.split('_')[0]);
}

export function normalizeAvailableMetricItems(items: unknown[]): MetricInfo[] {
	return items.map((item) => {
		if (typeof item !== 'object' || item === null) {
			return undefined;
		}

		const candidate = item as { id?: unknown; name?: unknown };
		if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
			return undefined;
		}

		const definition = getMetricDefinition(candidate.id);
		return {
			id: candidate.id,
			name: definition?.name ?? candidate.name,
		};
	}).filter((metric): metric is MetricInfo => Boolean(metric));
}

/**
 * Fetch available metric indices from the orchestrator and map them to
 * human-readable assessment names. The orchestrator returns an array of
 * metric objects with `id` (like "m1", "m10") and `name` properties.
 */
export async function fetchAvailableAssessments(): Promise<AssessmentName[]> {
	try {
		const resp = await httpGetJson<unknown>(`${ORCHESTRATOR_BASE}/eval/mm`);
		let items: unknown[] = [];

		if (Array.isArray(resp)) {
			items = resp;
		} else if (typeof resp === 'object' && resp !== null) {
			// Handle { metrics: { m1: {...}, m2: {...} } } or { metrics: [...] }
			const fields = resp as Record<string, unknown>;
			const metrics = fields.metrics ?? fields.available_metrics ?? fields.items ?? resp;
			if (Array.isArray(metrics)) {
				items = metrics;
			} else if (typeof metrics === 'object' && metrics !== null) {
				items = Object.values(metrics);
			}
		}

		// Extract metric names from the response objects and cache the mapping.
		// Each item is expected to be: { id: "m1", name: "PNG file size", ... }
		// Resolve built-in metrics by their stable ID. Backend display names can
		// differ slightly from the extension catalog, which previously prevented
		// the sidebar from finding and showing some metric definitions.
		cachedMetrics = normalizeAvailableMetricItems(items);

		const names = cachedMetrics.map((m) => m.name);
		return names.length > 0 ? names : Array.from(ASSESSMENTS) as AssessmentName[];
	} catch (error) {
		// On failure, fall back to full list so user can still proceed.
		logDiagnostic('Could not load available assessments; using the built-in catalog', error);
		return Array.from(ASSESSMENTS) as AssessmentName[];
	}
}

/**
 * Send the deployment URL and selected metrics to the orchestrator for
 * evaluation. Looks up the metric IDs from the cached orchestrator response.
 */
export async function submitUrlForEvaluation(
	deploymentUrl: string,
	selectedAssessments: AssessmentName[],
	gitInfo: GitInfo,
	assessment?: AssessmentSelection
): Promise<EvaluationSubmission> {
	const metrics = toMetricIds(selectedAssessments);

	const payload = {
		url: deploymentUrl,
		metrics,
		...gitInfo,
		...(assessment ? { assessment } : {})
	};
	return await httpPostJson(`${ORCHESTRATOR_BASE}/eval/evaluate_url_input_test`, payload);
}

export async function submitFileForEvaluation(
	fileData: Buffer,
	fileName: string,
	contentType: string,
	selectedAssessments: AssessmentName[],
	gitInfo: GitInfo,
	assessedTarget?: string,
	screenshotDimensions?: { width: number; height: number },
	htmlContent?: string,
	assessment?: AssessmentSelection
): Promise<EvaluationSubmission> {
	if (!Buffer.isBuffer(fileData)) {
		throw new Error('fileData must be a Buffer');
	}

	const form = new FormData();
	const metricIds = toMetricIds(selectedAssessments);
	const needsHtml = metricIds.some((metricId) => metricId.split('_')[0] === 'm8');
	if (needsHtml && htmlContent === undefined) {
		throw new Error('Word count requires the captured HTML artifact');
	}

	form.append('file', fileData, {
		filename: fileName,
		contentType: contentType,
	});
	if (needsHtml && htmlContent !== undefined) {
		form.append('html', Buffer.from(htmlContent, 'utf8'), {
			filename: 'capture.html',
			contentType: 'text/html',
		});
	}
	metricIds.forEach((m) => {
		form.append('mm', m);
	});

	form.append('projectKey', gitInfo.projectKey);
	if (gitInfo.repositoryUrl) { form.append('repositoryUrl', gitInfo.repositoryUrl); }
	if (gitInfo.projectName) { form.append('projectName', gitInfo.projectName); }
	if (gitInfo.source) { form.append('source', gitInfo.source); }
	if (gitInfo.branch) { form.append('branch', gitInfo.branch); }
	if (gitInfo.commitHash) { form.append('commitHash', gitInfo.commitHash); }
	if (gitInfo.gitDirty !== undefined) { form.append('gitDirty', String(gitInfo.gitDirty)); }
	if (gitInfo.mergeRequestId) { form.append('mergeRequestId', gitInfo.mergeRequestId); }
	if (assessedTarget) { form.append('assessedTarget', assessedTarget); }
	if (screenshotDimensions) {
		form.append('screenshotWidth', String(screenshotDimensions.width));
		form.append('screenshotHeight', String(screenshotDimensions.height));
	}
	if (assessment) { form.append('assessment', JSON.stringify(assessment)); }

	const parsed = new URL(`${ORCHESTRATOR_BASE}/eval/evaluate_with_artifacts`);
	const lib = parsed.protocol === 'https:' ? (await import('https')) : (await import('http'));

	const headers = form.getHeaders();
	const bodyLength = form.getLengthSync();
	if (bodyLength > MAX_MULTIPART_BODY_BYTES) {
		throw new Error(
			`Captured page upload is ${bodyLength} bytes, exceeding the 10 MiB orchestrator limit.`,
		);
	}
	headers['content-length'] = String(bodyLength);
	const opts: http.RequestOptions = {
		host: parsed.hostname,
		port: parsed.port,
		path: parsed.pathname + parsed.search,
		method: 'POST',
		headers,
	};

	return new Promise<EvaluationSubmission>((resolve, reject) => {
		const req = lib.request(opts, (res) => {
			let data = '';
			res.on('data', (chunk) => { data += chunk; });
			res.on('end', () => {
			  try {
			    if (res.statusCode && res.statusCode >= 400) {
			      reject(new Error(`HTTP ${res.statusCode} from ${parsed.toString()}`));
			      return;
			    }
			    resolve(JSON.parse(data));
			  } catch (err) {
			    reject(err);
			  }
			});
		});
		req.on('error', reject);
		form.pipe(req);
	});
}

export function toMetricIds(selectedAssessments: AssessmentName[]): string[] {
	return selectedAssessments.map((name) => {
		const cached = cachedMetrics.find((m) => m.name === name);
		if (cached) {
			return cached.id;
		}
		const idx = (ASSESSMENTS as readonly string[]).indexOf(name);
		if (idx >= 0) {
			return `m${idx + 1}`;
		}
		return name;
	});
}

export async function fetchEvaluationResult(wui_id: string, timeoutMs: number = RESULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
	return await httpGetJson<unknown>(
		`${ORCHESTRATOR_BASE}/eval/result/${encodeURIComponent(wui_id)}`,
		timeoutMs,
	);
}

export async function fetchAssessmentHistory(wui_id: string, baselineRunId?: number): Promise<AssessmentHistory> {
	const query = baselineRunId === undefined ? '' : `?baseline_run_id=${encodeURIComponent(String(baselineRunId))}`;
	return await httpGetJson(
		`${ORCHESTRATOR_BASE}/eval/result/${encodeURIComponent(wui_id)}/history${query}`,
		10_000
	);
}

export async function fetchProjectAssessmentRuns(projectKey: string): Promise<AssessmentRunSummary[]> {
	return await httpGetJson(
		`${ORCHESTRATOR_BASE}/eval/projects/${encodeURIComponent(projectKey)}/assessment-runs`,
		10_000
	);
}

export async function fetchAssessmentRunComparison(
	currentRunId: number,
	baselineRunId: number
): Promise<AssessmentRunComparison> {
	return await httpGetJson(
		`${ORCHESTRATOR_BASE}/eval/assessment-runs/${currentRunId}/comparison?baseline_run_id=${baselineRunId}`,
		20_000
	);
}

export async function fetchAssessmentExplanation(
	currentResults: AssessmentMetricResult[],
	history: AssessmentHistory | undefined,
	context: AssessmentExplanationContext,
): Promise<AssessmentExplanation> {
	const response = await httpPostJson<AssessmentExplanation>(
		`${ORCHESTRATOR_BASE}/eval/explanation`,
		{ currentResults, history: history ?? { metrics: {} }, ...context },
		210_000
	);
	if (typeof response.explanation !== 'string' || !response.explanation.trim()) {
		throw new Error('The explanation service returned an empty response.');
	}
	return { ...response, explanation: response.explanation.trim() };
}

export function isAssessmentMetricResult(value: unknown): value is AssessmentMetricResult {
	if (typeof value !== 'object' || value === null) { return false; }
	return typeof (value as { metric_id?: unknown }).metric_id === 'string'
		&& Object.prototype.hasOwnProperty.call(value, 'results');
}

function isAssessmentMetricResultArray(value: unknown): value is AssessmentMetricResult[] {
	return Array.isArray(value) && value.every(isAssessmentMetricResult);
}

/**
 * Poll for evaluation results until the expected number of unique metrics is reached
 * or the overall polling deadline / maximum number of attempts is reached.
 */
export async function pollEvaluationResult(
	wui_id: string,
	expectedCount: number,
	options: {
		maxAttempts?: number;
		intervalMs?: number;
		timeoutMs?: number;
		requestTimeoutMs?: number;
		onUpdate?: (results: AssessmentMetricResult[]) => void;
		isCancelled?: () => boolean;
		fetchResult?: (wuiId: string, timeoutMs: number) => Promise<unknown>;
		onError?: (error: unknown) => void;
	} = {}
): Promise<AssessmentMetricResult[]> {
	const {
		maxAttempts = 150,
		intervalMs = 2000,
		timeoutMs = RESULT_POLL_TIMEOUT_MS,
		requestTimeoutMs = RESULT_REQUEST_TIMEOUT_MS,
		onUpdate,
		isCancelled,
		fetchResult = fetchEvaluationResult,
		onError,
	} = options;

	let lastResult: AssessmentMetricResult[] = [];
	const deadline = Date.now() + timeoutMs;
	for (let attempt = 0; attempt < maxAttempts && Date.now() < deadline; attempt++) {
		if (isCancelled && isCancelled()) {
			break;
		}
		try {
			const remainingMs = Math.max(1, deadline - Date.now());
			const result = await fetchResult(
				wui_id,
				Math.min(requestTimeoutMs, remainingMs),
			);
			if (isAssessmentMetricResultArray(result) && result.length > 0) {
				lastResult = result;
				if (onUpdate) {
					onUpdate(result);
				}
				// Count unique base metric IDs (e.g., "m1" from "m1_png_file_size")
				const uniqueMetricIds = new Set(result.map((item) => item.metric_id.split('_')[0]));
				if (uniqueMetricIds.size >= expectedCount) {
					return result;
				}
			}
		} catch (error) {
			onError?.(error);
		}
		const remainingMs = deadline - Date.now();
		if (remainingMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remainingMs)));
		}
	}
	return lastResult;
}

export async function collectAssessmentRunRequest(ui: QuickPickUi): Promise<AssessmentRunRequest | undefined> {
	// Request available assessments from the orchestrator first
	const available = await fetchAvailableAssessments();

	const selectedAssessments = await ui.showQuickPick(available, {
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
		await ui.showErrorMessage('No assessments are available.');
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

	if (dataSource === 'Local URL') {
		const localUrl = await ui.showInputBox({
			title: 'Local URL',
			prompt: 'Enter the local URL to assess (e.g., http://localhost:3000)',
			placeHolder: 'http://localhost:3000',
			ignoreFocusOut: true,
			validateInput: (value) => isValidUrl(value) ? undefined : 'Enter a valid URL.',
		});

		if (localUrl === undefined) {
			return undefined;
		}

		return {
			assessments: toAssessmentNames(selectedAssessments),
			dataSource: {
				kind: 'local-url',
				localUrl,
			},
		};
	}

	return undefined;
}

export function formatAssessmentRunSummary(request: AssessmentRunRequest): string {
	const dataSourceText = request.dataSource.kind === 'deployment-url'
		? `Deployment URL: ${request.dataSource.deploymentUrl}`
		: request.dataSource.kind === 'local-url'
			? `Local URL: ${request.dataSource.localUrl}`
			: `Deployment URLs: ${request.dataSource.baselineDeploymentUrl} → ${request.dataSource.currentDeploymentUrl}`;
	const selectionText = request.assessment?.mode === 'profiles'
		? `Selected profiles: ${request.assessment.profiles.map((profile) => `${ASSESSMENT_PROFILES[profile.id]?.displayName ?? profile.id} (${profile.direction})`).join(', ')}`
		: `Selected assessments: ${request.assessments.join(', ')}`;

	return `${selectionText}. ${dataSourceText}.`;
}

function isValidUrl(value: string): boolean {
	try {
		return Boolean(new URL(value));
	} catch {
		return false;
	}
}

function toAssessmentNames(values: readonly string[]): AssessmentName[] {
	// Accept provided values as assessment names. They may come from the UI
	// (possibly driven by the orchestrator) or tests — avoid strict runtime
	// validation here so dynamic names are supported.
	return Array.from(values) as AssessmentName[];
}
