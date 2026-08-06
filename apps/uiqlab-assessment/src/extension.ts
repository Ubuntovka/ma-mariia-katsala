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

export interface M2Comparison {
	currentJpegBytes: number;
	previousJpegBytes: number;
	jpegRelativeDeltaPercent?: number;
	currentCompressionRatio: number;
	previousCompressionRatio: number;
	compressionRatioAbsoluteDelta: number;
	compressionRatioRelativeDeltaPercent?: number;
}

export type ColorfulnessDirection = 'more colorful' | 'less colorful' | 'unchanged';

export interface M3Comparison {
	currentScore: number;
	previousScore: number;
	scalarDelta: number;
	direction: ColorfulnessDirection;
	currentInterpretation: string;
	previousInterpretation: string;
	rangeChanged: boolean;
}

export interface NumericChange {
	current: number;
	previous: number;
	delta: number;
}

export interface M4Comparison {
	means: { l: NumericChange; a: NumericChange; b: NumericChange };
	standardDeviations: { l: NumericChange; a: NumericChange; b: NumericChange };
	deltaE: number;
}

export interface M5Comparison {
	currentProportion: number;
	previousProportion: number;
	percentagePointDelta: number;
}

export interface NormalizedUiedElement {
	type: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface M6Comparison {
	added: number;
	removed: number;
	moved: number;
	resized: number;
	matched: number;
	addedTypes: string[];
	removedTypes: string[];
	movedTypes: string[];
	resizedTypes: string[];
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

function readM2Values(value: unknown): { jpegBytes: number; compressionRatio: number } | undefined {
	if (Array.isArray(value)) {
		if (value.length === 1 && typeof value[0] === 'object' && value[0] !== null) {
			return readM2Values(value[0]);
		}
		const jpegBytes = finiteNumber(value[0]);
		const compressionRatio = finiteNumber(value[1]);
		return jpegBytes === undefined || compressionRatio === undefined
			? undefined
			: { jpegBytes, compressionRatio };
	}
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const normalizedEntries = Object.entries(value).map(([key, fieldValue]) => [
		key.toLowerCase().replace(/[^a-z0-9]/g, ''),
		fieldValue,
	] as const);
	const jpegBytes = finiteNumber(normalizedEntries.find(([key]) =>
		['jpegbytes', 'jpegsize', 'jpegfilesize', 'jpegfilesizebytes'].includes(key)
	)?.[1]);
	const compressionRatio = finiteNumber(normalizedEntries.find(([key]) =>
		['compressionratio', 'jpegcompressionratio', 'ratio'].includes(key)
	)?.[1]);
	return jpegBytes === undefined || compressionRatio === undefined
		? undefined
		: { jpegBytes, compressionRatio };
}

export function calculateM2Comparison(
	currentValue: unknown,
	previousValue: unknown
): M2Comparison | undefined {
	const current = readM2Values(currentValue);
	const previous = readM2Values(previousValue);
	if (!current || !previous) {
		return undefined;
	}
	const jpegDelta = current.jpegBytes - previous.jpegBytes;
	const ratioDelta = current.compressionRatio - previous.compressionRatio;
	return {
		currentJpegBytes: current.jpegBytes,
		previousJpegBytes: previous.jpegBytes,
		jpegRelativeDeltaPercent: previous.jpegBytes === 0
			? undefined
			: (jpegDelta / previous.jpegBytes) * 100,
		currentCompressionRatio: current.compressionRatio,
		previousCompressionRatio: previous.compressionRatio,
		compressionRatioAbsoluteDelta: ratioDelta,
		compressionRatioRelativeDeltaPercent: previous.compressionRatio === 0
			? undefined
			: (ratioDelta / previous.compressionRatio) * 100,
	};
}

function readM3Scalar(value: unknown): number | undefined {
	const direct = finiteNumber(value);
	if (direct !== undefined) {
		return direct;
	}
	if (Array.isArray(value)) {
		return readM3Scalar(value[0]);
	}
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const scalarEntry = Object.entries(value).find(([key]) =>
		['colorfulness', 'colorfulnessscore', 'score', 'scalar', 'value'].includes(
			key.toLowerCase().replace(/[^a-z0-9]/g, '')
		)
	);
	return scalarEntry ? finiteNumber(scalarEntry[1]) : undefined;
}

export function getColorfulnessInterpretation(score: number): string {
	if (score < 15) { return 'not colorful'; }
	if (score < 33) { return 'slightly colorful'; }
	if (score < 45) { return 'moderately colorful'; }
	if (score < 59) { return 'averagely colorful'; }
	if (score < 82) { return 'quite colorful'; }
	if (score < 109) { return 'highly colorful'; }
	return 'extremely colorful';
}

export function calculateM3Comparison(
	currentValue: unknown,
	previousValue: unknown
): M3Comparison | undefined {
	const currentScore = readM3Scalar(currentValue);
	const previousScore = readM3Scalar(previousValue);
	if (currentScore === undefined || previousScore === undefined) {
		return undefined;
	}
	const scalarDelta = currentScore - previousScore;
	const currentInterpretation = getColorfulnessInterpretation(currentScore);
	const previousInterpretation = getColorfulnessInterpretation(previousScore);
	return {
		currentScore,
		previousScore,
		scalarDelta,
		direction: scalarDelta > 0
			? 'more colorful'
			: scalarDelta < 0
				? 'less colorful'
				: 'unchanged',
		currentInterpretation,
		previousInterpretation,
		rangeChanged: currentInterpretation !== previousInterpretation,
	};
}

interface LabValues {
	lMean: number;
	lSd: number;
	aMean: number;
	aSd: number;
	bMean: number;
	bSd: number;
}

function readM4Values(value: unknown): LabValues | undefined {
	if (Array.isArray(value)) {
		if (value.length === 1 && Array.isArray(value[0])) {
			return readM4Values(value[0]);
		}
		const values = value.slice(0, 6).map(finiteNumber);
		if (values.length < 6 || values.some((item) => item === undefined)) {
			return undefined;
		}
		return {
			lMean: values[0]!, lSd: values[1]!,
			aMean: values[2]!, aSd: values[3]!,
			bMean: values[4]!, bSd: values[5]!,
		};
	}
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const fields = new Map(Object.entries(value).map(([key, fieldValue]) => [
		key.toLowerCase().replace(/[^a-z0-9]/g, ''),
		fieldValue,
	]));
	const pick = (aliases: string[]): number | undefined => {
		for (const alias of aliases) {
			const parsed = finiteNumber(fields.get(alias));
			if (parsed !== undefined) { return parsed; }
		}
		return undefined;
	};
	const parsed = {
		lMean: pick(['lmean', 'laverage', 'lightnessmean', 'lightnessaverage']),
		lSd: pick(['lsd', 'lstd', 'lstandarddeviation', 'lightnesssd', 'lightnessstd', 'lightnessstandarddeviation']),
		aMean: pick(['amean', 'aaverage']),
		aSd: pick(['asd', 'astd', 'astandarddeviation']),
		bMean: pick(['bmean', 'baverage']),
		bSd: pick(['bsd', 'bstd', 'bstandarddeviation']),
	};
	if (Object.values(parsed).some((item) => item === undefined)) {
		return undefined;
	}
	return parsed as LabValues;
}

function numericChange(current: number, previous: number): NumericChange {
	return { current, previous, delta: current - previous };
}

export function calculateM4Comparison(
	currentValue: unknown,
	previousValue: unknown
): M4Comparison | undefined {
	const current = readM4Values(currentValue);
	const previous = readM4Values(previousValue);
	if (!current || !previous) {
		return undefined;
	}
	const means = {
		l: numericChange(current.lMean, previous.lMean),
		a: numericChange(current.aMean, previous.aMean),
		b: numericChange(current.bMean, previous.bMean),
	};
	return {
		means,
		standardDeviations: {
			l: numericChange(current.lSd, previous.lSd),
			a: numericChange(current.aSd, previous.aSd),
			b: numericChange(current.bSd, previous.bSd),
		},
		deltaE: Math.sqrt(
			means.l.delta ** 2
			+ means.a.delta ** 2
			+ means.b.delta ** 2
		),
	};
}

function readM5Proportion(value: unknown): number | undefined {
	let proportion = finiteNumber(value);
	if (proportion === undefined && Array.isArray(value)) {
		proportion = readM5Proportion(value[0]);
	}
	if (proportion === undefined && typeof value === 'object' && value !== null) {
		const entry = Object.entries(value).find(([key]) =>
			['whitespace', 'whitespaceproportion', 'proportion', 'score', 'value'].includes(
				key.toLowerCase().replace(/[^a-z0-9]/g, '')
			)
		);
		proportion = entry ? finiteNumber(entry[1]) : undefined;
	}
	return proportion !== undefined && proportion >= 0 && proportion <= 1
		? proportion
		: undefined;
}

export function calculateM5Comparison(
	currentValue: unknown,
	previousValue: unknown
): M5Comparison | undefined {
	const currentProportion = readM5Proportion(currentValue);
	const previousProportion = readM5Proportion(previousValue);
	if (currentProportion === undefined || previousProportion === undefined) {
		return undefined;
	}
	return {
		currentProportion,
		previousProportion,
		percentagePointDelta: (currentProportion - previousProportion) * 100,
	};
}

function findUiedPayload(value: unknown): { segments: unknown[] } | undefined {
	if (typeof value === 'string') {
		try { return findUiedPayload(JSON.parse(value)); } catch { return undefined; }
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			const payload = findUiedPayload(item);
			if (payload) { return payload; }
		}
		return undefined;
	}
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	if (Array.isArray(candidate.segments)) {
		return { segments: candidate.segments };
	}
	return undefined;
}

function normalizedComponentType(component: Record<string, unknown>): string {
	const rawType = [component.subclass, component.type, component.class, component.category]
		.find((candidate) => candidate !== undefined && candidate !== null
			&& String(candidate).trim() !== '' && !['none', 'null'].includes(String(candidate).toLowerCase()))
		?? 'component';
	const type = String(rawType).trim().toLowerCase().replace(/[_-]+/g, ' ');
	return type || 'component';
}

export function normalizeUiedElements(
	value: unknown,
	dimensions: { width: number; height: number }
): NormalizedUiedElement[] {
	const payload = findUiedPayload(value);
	if (!payload || dimensions.width <= 0 || dimensions.height <= 0) {
		return [];
	}
	return payload.segments.flatMap((item): NormalizedUiedElement[] => {
		if (typeof item !== 'object' || item === null) { return []; }
		const component = item as Record<string, unknown>;
		const positionValue = component.position ?? component.bbox ?? component.bounds ?? component;
		if (typeof positionValue !== 'object' || positionValue === null) { return []; }
		const position = positionValue as Record<string, unknown>;
		const rawX = finiteNumber(position.x) ?? finiteNumber(position.column_min) ?? finiteNumber(position.left);
		const rawY = finiteNumber(position.y) ?? finiteNumber(position.row_min) ?? finiteNumber(position.top);
		const rawRight = finiteNumber(position.column_max) ?? finiteNumber(position.right);
		const rawBottom = finiteNumber(position.row_max) ?? finiteNumber(position.bottom);
		const rawWidth = finiteNumber(position.width) ?? finiteNumber(component.width)
			?? (rawX !== undefined && rawRight !== undefined ? rawRight - rawX : undefined);
		const rawHeight = finiteNumber(position.height) ?? finiteNumber(component.height)
			?? (rawY !== undefined && rawBottom !== undefined ? rawBottom - rawY : undefined);
		if (rawX === undefined || rawY === undefined || rawWidth === undefined || rawHeight === undefined
			|| rawWidth <= 0 || rawHeight <= 0) {
			return [];
		}
		const alreadyNormalized = rawX >= 0 && rawY >= 0 && rawWidth <= 1 && rawHeight <= 1
			&& rawX + rawWidth <= 1 && rawY + rawHeight <= 1;
		return [{
			type: normalizedComponentType(component),
			x: alreadyNormalized ? rawX : rawX / dimensions.width,
			y: alreadyNormalized ? rawY : rawY / dimensions.height,
			width: alreadyNormalized ? rawWidth : rawWidth / dimensions.width,
			height: alreadyNormalized ? rawHeight : rawHeight / dimensions.height,
		}];
	});
}

function componentFamily(type: string): string {
	if (/text|label|paragraph|heading/.test(type)) { return 'text'; }
	if (/image|icon|picture/.test(type)) { return 'image'; }
	if (/button|input|select|checkbox|radio|control/.test(type)) { return 'control'; }
	if (/block|container|section|header|footer|nav/.test(type)) { return 'container'; }
	return type;
}

function compatibleComponentTypes(previous: string, current: string): boolean {
	return previous === current || componentFamily(previous) === componentFamily(current);
}

export function boundingBoxIou(a: NormalizedUiedElement, b: NormalizedUiedElement): number {
	const intersectionWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
	const intersectionHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
	const intersection = intersectionWidth * intersectionHeight;
	const union = a.width * a.height + b.width * b.height - intersection;
	return union > 0 ? intersection / union : 0;
}

function bestElementAssignment(weights: number[][]): Array<[number, number]> {
	if (weights.length === 0 || weights[0]?.length === 0) { return []; }
	const size = Math.max(weights.length, weights[0].length);
	const costs = Array.from({ length: size }, (_, row) =>
		Array.from({ length: size }, (_, column) => 1 - (weights[row]?.[column] ?? 0))
	);
	const u = Array(size + 1).fill(0);
	const v = Array(size + 1).fill(0);
	const matchedRow = Array(size + 1).fill(0);
	const path = Array(size + 1).fill(0);
	for (let row = 1; row <= size; row++) {
		matchedRow[0] = row;
		let column0 = 0;
		const minimum = Array(size + 1).fill(Number.POSITIVE_INFINITY);
		const used = Array(size + 1).fill(false);
		do {
			used[column0] = true;
			const row0 = matchedRow[column0];
			let delta = Number.POSITIVE_INFINITY;
			let column1 = 0;
			for (let column = 1; column <= size; column++) {
				if (used[column]) { continue; }
				const current = costs[row0 - 1][column - 1] - u[row0] - v[column];
				if (current < minimum[column]) {
					minimum[column] = current;
					path[column] = column0;
				}
				if (minimum[column] < delta) {
					delta = minimum[column];
					column1 = column;
				}
			}
			for (let column = 0; column <= size; column++) {
				if (used[column]) {
					u[matchedRow[column]] += delta;
					v[column] -= delta;
				} else {
					minimum[column] -= delta;
				}
			}
			column0 = column1;
		} while (matchedRow[column0] !== 0);
		do {
			const column1 = path[column0];
			matchedRow[column0] = matchedRow[column1];
			column0 = column1;
		} while (column0 !== 0);
	}
	const assignment: Array<[number, number]> = [];
	for (let column = 1; column <= size; column++) {
		const row = matchedRow[column] - 1;
		if (row >= 0 && row < weights.length && column - 1 < weights[0].length) {
			assignment.push([row, column - 1]);
		}
	}
	return assignment;
}

export function compareM6Segmentation(
	currentValue: unknown,
	previousValue: unknown,
	dimensions: { width: number; height: number }
): M6Comparison | undefined {
	const current = normalizeUiedElements(currentValue, dimensions);
	const previous = normalizeUiedElements(previousValue, dimensions);
	if (current.length === 0 && previous.length === 0) { return undefined; }
	const weights = previous.map((oldElement) => current.map((newElement) =>
		compatibleComponentTypes(oldElement.type, newElement.type)
			? boundingBoxIou(oldElement, newElement)
			: 0
	));
	const matches = bestElementAssignment(weights).filter(([oldIndex, newIndex]) =>
		weights[oldIndex][newIndex] >= 0.1
	);
	const matchedPrevious = new Set(matches.map(([oldIndex]) => oldIndex));
	const matchedCurrent = new Set(matches.map(([, newIndex]) => newIndex));
	const movedTypes: string[] = [];
	const resizedTypes: string[] = [];
	for (const [oldIndex, newIndex] of matches) {
		const oldElement = previous[oldIndex];
		const newElement = current[newIndex];
		const positionDistance = Math.hypot(
			oldElement.x - newElement.x,
			oldElement.y - newElement.y
		);
		if (positionDistance > 0.01) { movedTypes.push(newElement.type); }
		const widthChange = Math.abs(newElement.width - oldElement.width);
		const heightChange = Math.abs(newElement.height - oldElement.height);
		if (widthChange > 0.01 || heightChange > 0.01) { resizedTypes.push(newElement.type); }
	}
	const addedTypes = current.filter((_, index) => !matchedCurrent.has(index)).map((item) => item.type);
	const removedTypes = previous.filter((_, index) => !matchedPrevious.has(index)).map((item) => item.type);
	return {
		added: addedTypes.length,
		removed: removedTypes.length,
		moved: movedTypes.length,
		resized: resizedTypes.length,
		matched: matches.length,
		addedTypes,
		removedTypes,
		movedTypes,
		resizedTypes,
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

function findM2HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory
): { comparison: M2Comparison; previousCreatedAt: string } | undefined {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm2') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) {
			continue;
		}
		const comparison = calculateM2Comparison(currentResult.results, historicalResult.results);
		if (comparison) {
			return { comparison, previousCreatedAt: historicalResult.createdAt };
		}
	}
	return undefined;
}

function findM3HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory
): { comparison: M3Comparison; previousCreatedAt: string } | undefined {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm3') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) {
			continue;
		}
		const comparison = calculateM3Comparison(currentResult.results, historicalResult.results);
		if (comparison) {
			return { comparison, previousCreatedAt: historicalResult.createdAt };
		}
	}
	return undefined;
}

function findM4HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory
): { comparison: M4Comparison; previousCreatedAt: string } | undefined {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm4') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) {
			continue;
		}
		const comparison = calculateM4Comparison(currentResult.results, historicalResult.results);
		if (comparison) {
			return { comparison, previousCreatedAt: historicalResult.createdAt };
		}
	}
	return undefined;
}

function findM5HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory
): { comparison: M5Comparison; previousCreatedAt: string } | undefined {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm5') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) {
			continue;
		}
		const comparison = calculateM5Comparison(currentResult.results, historicalResult.results);
		if (comparison) {
			return { comparison, previousCreatedAt: historicalResult.createdAt };
		}
	}
	return undefined;
}

function findM6HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory,
	dimensions: { width: number; height: number }
): { comparison: M6Comparison; previousCreatedAt: string } | undefined {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm6') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) {
			continue;
		}
		const comparison = compareM6Segmentation(
			currentResult.results,
			historicalResult.results,
			dimensions
		);
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

function relativeChange(value: number | undefined): string {
	return value === undefined ? 'Not available' : `${signedNumber(value, 2)}%`;
}

function labComparisonRow(channel: string, change: NumericChange): string {
	return `<tr><th scope="row">${channel}</th><td>${change.previous.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td><td>${change.current.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td><td>${signedNumber(change.delta, 3)}</td></tr>`;
}

function variationDirection(change: NumericChange): string {
	return change.delta > 0 ? 'increased' : change.delta < 0 ? 'decreased' : 'unchanged';
}

function typeBreakdown(types: string[]): string {
	const counts = new Map<string, number>();
	for (const type of types) { counts.set(type, (counts.get(type) ?? 0) + 1); }
	return Array.from(counts, ([type, count]) => `${escapeHtml(type)} (${count})`).join(', ') || 'none';
}

function structuralAction(count: number, action: string, types: string[]): string {
	if (count === 1 && types.length === 1) {
		return `1 ${escapeHtml(types[0])} element ${action}`;
	}
	const breakdown = count > 0 ? ` (${typeBreakdown(types)})` : '';
	return `${count} components ${action}${breakdown}`;
}

function showHistoryComparison(
	currentResults: any[],
	history: AssessmentHistory,
	url: string
): void {
	const m1Match = findM1HistoryComparison(currentResults, history);
	const m2Match = findM2HistoryComparison(currentResults, history);
	const m3Match = findM3HistoryComparison(currentResults, history);
	const m4Match = findM4HistoryComparison(currentResults, history);
	const m5Match = findM5HistoryComparison(currentResults, history);
	const dimensions = history.screenshotDimensions;
	const m6Match = dimensions
		? findM6HistoryComparison(currentResults, history, dimensions)
		: undefined;
	if ((!m1Match && !m2Match && !m3Match && !m4Match && !m5Match && !m6Match) || !dimensions) {
		return;
	}

	const m1Section = m1Match ? `
		<section class="metric-section">
			<h2>M1 · PNG file size change</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m1Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous size</span><span class="value">${m1Match.comparison.previousBytes.toLocaleString()} bytes</span></div>
				<div class="card"><span class="label">Current size</span><span class="value">${m1Match.comparison.currentBytes.toLocaleString()} bytes</span></div>
				<div class="card"><span class="label">Absolute delta</span><span class="value">${signedNumber(m1Match.comparison.absoluteDelta)} bytes</span></div>
				<div class="card"><span class="label">Relative delta</span><span class="value">${relativeChange(m1Match.comparison.relativeDeltaPercent)}</span></div>
			</div>
			<div class="explanation"><p>M1 reports the PNG screenshot size in bytes. The absolute delta is current size minus previous size; the relative delta expresses that change as a percentage of the previous size. PNG size has no universal “better” direction, so this reports the change without labeling it as an improvement or regression.</p></div>
		</section>` : '';

	const m2Section = m2Match ? `
		<section class="metric-section">
			<h2>M2 · JPEG file size and compression ratio</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m2Match.previousCreatedAt).toLocaleString()}</p>
			<h3>JPEG file size</h3>
			<div class="grid">
				<div class="card"><span class="label">Previous size</span><span class="value">${m2Match.comparison.previousJpegBytes.toLocaleString()} bytes</span></div>
				<div class="card"><span class="label">Current size</span><span class="value">${m2Match.comparison.currentJpegBytes.toLocaleString()} bytes</span></div>
				<div class="card"><span class="label">Relative change</span><span class="value">${relativeChange(m2Match.comparison.jpegRelativeDeltaPercent)}</span></div>
			</div>
			<h3>Compression ratio</h3>
			<div class="grid">
				<div class="card"><span class="label">Previous ratio</span><span class="value">${m2Match.comparison.previousCompressionRatio.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Current ratio</span><span class="value">${m2Match.comparison.currentCompressionRatio.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Absolute change</span><span class="value">${signedNumber(m2Match.comparison.compressionRatioAbsoluteDelta, 4)}</span></div>
				<div class="card"><span class="label">Relative change</span><span class="value">${relativeChange(m2Match.comparison.compressionRatioRelativeDeltaPercent)}</span></div>
			</div>
			<div class="explanation"><p>M2 changes can indicate altered JPEG compressibility or different visual content. JPEG byte size and compression ratio are compared independently. Neither an increase nor a decrease is automatically better.</p></div>
		</section>` : '';

	const m3RangeMovement = m3Match
		? m3Match.comparison.rangeChanged
			? `${m3Match.comparison.previousInterpretation} → ${m3Match.comparison.currentInterpretation}`
			: `Remained ${m3Match.comparison.currentInterpretation}`
		: '';
	const m3Section = m3Match ? `
		<section class="metric-section">
			<h2>M3 · Colorfulness</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m3Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous score</span><span class="value">${m3Match.comparison.previousScore.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span></div>
				<div class="card"><span class="label">Current score</span><span class="value">${m3Match.comparison.currentScore.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span></div>
				<div class="card"><span class="label">Scalar delta</span><span class="value">${signedNumber(m3Match.comparison.scalarDelta, 3)}</span></div>
				<div class="card"><span class="label">Colorfulness movement</span><span class="value text-value">${m3Match.comparison.direction}</span></div>
				<div class="card wide-card"><span class="label">Interpretation range</span><span class="value text-value">${m3RangeMovement}</span></div>
			</div>
			<div class="explanation"><p>M3 is the Hasler–Süsstrunk colorfulness score. A positive delta means the screenshot is more colorful and a negative delta means it is less colorful. Crossing an interpretation threshold is reported separately. More or less colorful is not automatically an improvement or regression.</p></div>
		</section>` : '';

	const m4VariationSummary = m4Match
		? `L* variation ${variationDirection(m4Match.comparison.standardDeviations.l)}, a* variation ${variationDirection(m4Match.comparison.standardDeviations.a)}, and b* variation ${variationDirection(m4Match.comparison.standardDeviations.b)}.`
		: '';
	const m4Section = m4Match ? `
		<section class="metric-section">
			<h2>M4 · CIELAB mean and standard deviation</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m4Match.previousCreatedAt).toLocaleString()}</p>
			<h3>Mean color</h3>
			<div class="table-wrap"><table><thead><tr><th>Channel</th><th>Previous</th><th>Current</th><th>Delta</th></tr></thead><tbody>
				${labComparisonRow('L* · lightness', m4Match.comparison.means.l)}
				${labComparisonRow('a* · green–red', m4Match.comparison.means.a)}
				${labComparisonRow('b* · blue–yellow', m4Match.comparison.means.b)}
			</tbody></table></div>
			<div class="grid compact-grid"><div class="card"><span class="label">Mean-color distance · ΔE</span><span class="value">${m4Match.comparison.deltaE.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span></div></div>
			<h3>Color-distribution variation · standard deviation</h3>
			<div class="table-wrap"><table><thead><tr><th>Channel</th><th>Previous SD</th><th>Current SD</th><th>Delta</th></tr></thead><tbody>
				${labComparisonRow('L* · lightness', m4Match.comparison.standardDeviations.l)}
				${labComparisonRow('a* · green–red', m4Match.comparison.standardDeviations.a)}
				${labComparisonRow('b* · blue–yellow', m4Match.comparison.standardDeviations.b)}
			</tbody></table></div>
			<p class="variation-summary">${m4VariationSummary}</p>
			<div class="explanation"><p>The L* mean describes average brightness, while a* and b* locate the average palette on the green–red and blue–yellow axes. ΔE is the Euclidean distance between the previous and current mean Lab colors. Standard-deviation changes describe shifts in color distribution and variation within each channel. These changes have no universal better direction.</p></div>
		</section>` : '';

	const m5Assessment = m5Match?.comparison.percentagePointDelta === 0
		? 'No measured change'
		: 'Potential layout change';
	const m5Section = m5Match ? `
		<section class="metric-section">
			<h2>M5 · White-space proportion</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m5Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous proportion</span><span class="value">${m5Match.comparison.previousProportion.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span></div>
				<div class="card"><span class="label">Current proportion</span><span class="value">${m5Match.comparison.currentProportion.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span></div>
				<div class="card"><span class="label">Absolute difference</span><span class="value">${signedNumber(m5Match.comparison.percentagePointDelta, 2)} pp</span></div>
				<div class="card"><span class="label">Assessment</span><span class="value text-value">${m5Assessment}</span></div>
			</div>
			<div class="explanation"><p>M5 is the proportion of the screenshot classified as white space. The difference is shown in percentage points: for example, 0.32 to 0.38 is +6 pp. The source associates higher values with poorly distributed content, but white space may also be an intentional layout choice. A change is therefore highlighted as a potential layout change, not an automatic regression.</p></div>
		</section>` : '';

	const m6HasChanges = m6Match
		? m6Match.comparison.added + m6Match.comparison.removed
			+ m6Match.comparison.moved + m6Match.comparison.resized > 0
		: false;
	const m6Summary = m6Match
		? m6HasChanges
			? `${structuralAction(m6Match.comparison.added, 'added', m6Match.comparison.addedTypes)}, ${structuralAction(m6Match.comparison.removed, 'removed', m6Match.comparison.removedTypes)}, ${structuralAction(m6Match.comparison.moved, 'moved', m6Match.comparison.movedTypes)}, and ${structuralAction(m6Match.comparison.resized, 'resized', m6Match.comparison.resizedTypes)}.`
			: 'No structural changes detected.'
		: '';
	const m6Section = m6Match ? `
		<section class="metric-section">
			<h2>M6 · UIED structural changes</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m6Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Added</span><span class="value">${m6Match.comparison.added}</span></div>
				<div class="card"><span class="label">Removed</span><span class="value">${m6Match.comparison.removed}</span></div>
				<div class="card"><span class="label">Moved</span><span class="value">${m6Match.comparison.moved}</span></div>
				<div class="card"><span class="label">Resized</span><span class="value">${m6Match.comparison.resized}</span></div>
			</div>
			<p class="structural-summary">${m6Summary}</p>
			<details><summary>Component-type details</summary><dl class="type-details">
				<dt>Added</dt><dd>${typeBreakdown(m6Match.comparison.addedTypes)}</dd>
				<dt>Removed</dt><dd>${typeBreakdown(m6Match.comparison.removedTypes)}</dd>
				<dt>Moved</dt><dd>${typeBreakdown(m6Match.comparison.movedTypes)}</dd>
				<dt>Resized</dt><dd>${typeBreakdown(m6Match.comparison.resizedTypes)}</dd>
			</dl></details>
			<div class="explanation"><p>This is structural change detection. UIED components are converted to normalized screenshot coordinates, paired by compatible component type and the best one-to-one bounding-box IoU assignment, then classified as added, removed, moved, or resized. The segmented preview image is not used for matching.</p></div>
		</section>` : '';

	const panel = vscode.window.createWebviewPanel(
		'historyComparison',
		'Assessment History Comparison',
		vscode.ViewColumn.Beside,
		{}
	);

	panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Assessment History Comparison</title>
	<style>
		* { box-sizing: border-box; }
		body { margin: 0; padding: 28px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
		main { max-width: 860px; margin: 0 auto; }
		h1 { margin: 0 0 8px; font-size: 26px; }
		h2 { margin: 0 0 6px; font-size: 21px; }
		h3 { margin: 20px 0 10px; font-size: 15px; }
		.context { margin: 0 0 24px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
		.path { font-family: var(--vscode-editor-font-family); word-break: break-all; }
		.metric-section { padding: 22px 0; border-top: 1px solid var(--vscode-widget-border); }
		.previous-run { margin: 0 0 16px; color: var(--vscode-descriptionForeground); }
		.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 18px; }
		.card { padding: 18px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-sideBar-background); }
		.label { display: block; margin-bottom: 8px; color: var(--vscode-descriptionForeground); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
		.value { font-size: 22px; font-weight: 650; }
		.text-value { font-size: 18px; }
		.wide-card { grid-column: 1 / -1; }
		.compact-grid { grid-template-columns: minmax(220px, 300px); margin-top: 14px; }
		.table-wrap { overflow-x: auto; margin-bottom: 14px; }
		table { width: 100%; border-collapse: collapse; background: var(--vscode-sideBar-background); }
		th, td { padding: 11px 13px; border: 1px solid var(--vscode-widget-border); text-align: right; }
		th:first-child, td:first-child { text-align: left; }
		thead th { color: var(--vscode-descriptionForeground); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
		.variation-summary { margin: 8px 0 18px; color: var(--vscode-descriptionForeground); }
		.structural-summary { margin: 2px 0 16px; font-size: 17px; font-weight: 600; }
		details { margin: 0 0 18px; padding: 12px 14px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; }
		summary { cursor: pointer; font-weight: 600; }
		.type-details { display: grid; grid-template-columns: max-content 1fr; gap: 7px 14px; margin: 14px 0 0; }
		.type-details dt { color: var(--vscode-descriptionForeground); }
		.type-details dd { margin: 0; }
		.explanation { padding: 18px; border-left: 4px solid var(--vscode-focusBorder); background: var(--vscode-textBlockQuote-background); line-height: 1.55; }
		.explanation p { margin: 0; }
	</style>
</head>
<body>
	<main>
		<h1>Assessment history comparison</h1>
		<p class="context"><span class="path">${escapeHtml(url)}</span><br>${dimensions.width} × ${dimensions.height} px · only completed runs with identical screenshot dimensions are compared</p>
		${m1Section}
		${m2Section}
		${m3Section}
		${m4Section}
		${m5Section}
		${m6Section}
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
						const hasComparableResult = resultData.some(
							(result: any) => typeof result?.metric_id === 'string'
								&& ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].includes(result.metric_id.split('_')[0])
						);
						if (hasComparableResult) {
							try {
								history = await fetchAssessmentHistory(wui_id);
							} catch { }
						}
						createResultsWebview(panel, resultData, localUrl, true);
						if (history) {
							showHistoryComparison(resultData, history, localUrl);
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
