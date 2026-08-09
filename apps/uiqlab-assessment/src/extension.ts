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
import { PNG } from 'pngjs';
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
	jpegAbsoluteDelta: number;
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

export interface SaliencyCenter {
	x: number;
	y: number;
}

export interface M7Comparison {
	jensenShannonDivergence: number;
	salientRegionOverlap: number;
	previousCenter: SaliencyCenter;
	currentCenter: SaliencyCenter;
	centerMovement: number;
	previousRegion: string;
	currentRegion: string;
	interpretation: string;
}

export interface M8Comparison {
	currentWordCount: number;
	previousWordCount: number;
	absoluteDelta: number;
	relativeDeltaPercent?: number;
}

export interface M9Comparison {
	currentDensity: number;
	previousDensity: number;
	percentagePointDelta: number;
	edgeMapIou?: number;
	edgeMapF1?: number;
}

export interface M10Comparison {
	currentCongestion: number;
	previousCongestion: number;
	scalarDelta: number;
	mapMeanAbsoluteDifference?: number;
	highCongestionOverlap?: number;
}

export interface M11Comparison {
	currentEntropy: number;
	previousEntropy: number;
	absoluteDelta: number;
	relativeDeltaPercent?: number;
}

export interface M12Comparison {
	currentEntropy: number;
	previousEntropy: number;
	absoluteDelta: number;
	relativeDeltaPercent?: number;
}

export interface AccessibilityIssue {
	identity: string;
	ruleId: string;
	target: string;
	impact: string;
	description?: string;
}

export interface AccessibilityCountComparison {
	key: string;
	previous: number;
	current: number;
	delta: number;
}

export interface M13Comparison {
	previousCount: number;
	currentCount: number;
	newIssues: AccessibilityIssue[];
	resolvedIssues: AccessibilityIssue[];
	persistentIssues: AccessibilityIssue[];
	byImpact: AccessibilityCountComparison[];
	byRule: AccessibilityCountComparison[];
}

export interface M14Comparison {
	mean: NumericChange;
	standardDeviation: NumericChange;
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
		jpegAbsoluteDelta: jpegDelta,
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

export function getM4ComparisonUnavailableReason(options: {
	hasCurrentResult: boolean;
	currentValue?: unknown;
	hasHistoricalResult: boolean;
	previousValue?: unknown;
	dimensionsAvailable: boolean;
}): string | undefined {
	if (!options.hasCurrentResult) {
		return 'The current assessment did not return an M4 result.';
	}
	if (!readM4Values(options.currentValue)) {
		return 'The current M4 result did not contain all six numeric CIELAB mean and standard-deviation values.';
	}
	if (!options.dimensionsAvailable) {
		return 'Screenshot dimensions were unavailable, so a dimension-matched historical run could not be selected.';
	}
	if (!options.hasHistoricalResult) {
		return 'No completed previous M4 result was found for the same project, page, and screenshot dimensions.';
	}
	if (!readM4Values(options.previousValue)) {
		return 'The matching previous M4 result did not contain all six numeric CIELAB mean and standard-deviation values.';
	}
	return undefined;
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

function sampledSaliencyMap(png: PNG, step: number): { intensities: number[]; points: SaliencyCenter[] } {
	const intensities: number[] = [];
	const points: SaliencyCenter[] = [];
	for (let y = 0; y < png.height; y += step) {
		for (let x = 0; x < png.width; x += step) {
			const offset = (y * png.width + x) * 4;
			const intensity = 0.2126 * png.data[offset]
				+ 0.7152 * png.data[offset + 1]
				+ 0.0722 * png.data[offset + 2];
			intensities.push(intensity);
			points.push({ x: (x + 0.5) / png.width, y: (y + 0.5) / png.height });
		}
	}
	return { intensities, points };
}

function probabilityMap(intensities: number[]): number[] {
	const minimum = intensities.reduce((result, value) => Math.min(result, value), Number.POSITIVE_INFINITY);
	const adjusted = intensities.map((value) => Math.max(0, value - minimum));
	const total = adjusted.reduce((sum, value) => sum + value, 0);
	return total > 0
		? adjusted.map((value) => value / total)
		: adjusted.map(() => 1 / adjusted.length);
}

function saliencyCenter(probabilities: number[], points: SaliencyCenter[]): SaliencyCenter {
	return probabilities.reduce((center, probability, index) => ({
		x: center.x + probability * points[index].x,
		y: center.y + probability * points[index].y,
	}), { x: 0, y: 0 });
}

function mostSalientLocations(intensities: number[]): Set<number> {
	const count = Math.max(1, Math.ceil(intensities.length * 0.1));
	const indices = intensities.map((_, index) => index);
	indices.sort((left, right) => intensities[right] - intensities[left] || left - right);
	return new Set(indices.slice(0, count));
}

function attentionRegion(center: SaliencyCenter): string {
	if (center.y < 0.25) { return 'header'; }
	if (center.y > 0.75) { return 'footer'; }
	if (center.x < 0.25) { return 'left sidebar'; }
	if (center.x > 0.75) { return 'right sidebar'; }
	return 'main content';
}

export function compareSaliencyHeatmaps(currentPng: Buffer, previousPng: Buffer): M7Comparison | undefined {
	let current: PNG;
	let previous: PNG;
	try {
		current = PNG.sync.read(currentPng);
		previous = PNG.sync.read(previousPng);
	} catch {
		return undefined;
	}
	if (current.width !== previous.width || current.height !== previous.height
		|| current.width === 0 || current.height === 0) {
		return undefined;
	}
	const step = Math.max(1, Math.ceil(Math.sqrt((current.width * current.height) / 76800)));
	const currentSample = sampledSaliencyMap(current, step);
	const previousSample = sampledSaliencyMap(previous, step);
	const currentProbability = probabilityMap(currentSample.intensities);
	const previousProbability = probabilityMap(previousSample.intensities);
	let divergence = 0;
	for (let index = 0; index < currentProbability.length; index++) {
		const currentValue = currentProbability[index];
		const previousValue = previousProbability[index];
		const midpoint = (currentValue + previousValue) / 2;
		if (currentValue > 0) { divergence += 0.5 * currentValue * Math.log2(currentValue / midpoint); }
		if (previousValue > 0) { divergence += 0.5 * previousValue * Math.log2(previousValue / midpoint); }
	}
	const currentSalientLocations = mostSalientLocations(currentSample.intensities);
	const previousSalientLocations = mostSalientLocations(previousSample.intensities);
	let intersection = 0;
	let union = 0;
	for (let index = 0; index < currentSample.intensities.length; index++) {
		const currentSalient = currentSalientLocations.has(index);
		const previousSalient = previousSalientLocations.has(index);
		if (currentSalient && previousSalient) { intersection++; }
		if (currentSalient || previousSalient) { union++; }
	}
	const currentCenter = saliencyCenter(currentProbability, currentSample.points);
	const previousCenter = saliencyCenter(previousProbability, previousSample.points);
	const centerMovement = Math.hypot(
		currentCenter.x - previousCenter.x,
		currentCenter.y - previousCenter.y
	);
	const currentRegion = attentionRegion(currentCenter);
	const previousRegion = attentionRegion(previousCenter);
	const interpretation = currentRegion !== previousRegion
		? `User attention is predicted to shift from the ${previousRegion} to the ${currentRegion}.`
		: centerMovement < 0.03
			? `Predicted user attention remains concentrated in the ${currentRegion}.`
			: `Predicted user attention moves within the ${currentRegion}.`;
	return {
		jensenShannonDivergence: divergence,
		salientRegionOverlap: union > 0 ? intersection / union : 1,
		previousCenter,
		currentCenter,
		centerMovement,
		previousRegion,
		currentRegion,
		interpretation,
	};
}

function readM9Result(value: unknown): { density: number; edgeImageUrl?: string } | undefined {
	if (Array.isArray(value)) {
		const density = finiteNumber(value[0]);
		return density !== undefined && density >= 0 && density <= 1
			? { density, edgeImageUrl: typeof value[1] === 'string' ? value[1] : undefined }
			: undefined;
	}
	if (typeof value !== 'object' || value === null) { return undefined; }
	const fields = new Map(Object.entries(value).map(([key, fieldValue]) => [
		key.toLowerCase().replace(/[^a-z0-9]/g, ''), fieldValue,
	]));
	const density = finiteNumber(
		fields.get('edgedensity') ?? fields.get('density') ?? fields.get('percentage') ?? fields.get('value')
	);
	const edgeImage = fields.get('edgeimage') ?? fields.get('edgeimageurl') ?? fields.get('image');
	return density !== undefined && density >= 0 && density <= 1
		? { density, edgeImageUrl: typeof edgeImage === 'string' ? edgeImage : undefined }
		: undefined;
}

function compareBinaryEdgeMaps(
	currentPng: Buffer,
	previousPng: Buffer
): { iou: number; f1: number } | undefined {
	let current: PNG;
	let previous: PNG;
	try {
		current = PNG.sync.read(currentPng);
		previous = PNG.sync.read(previousPng);
	} catch {
		return undefined;
	}
	if (current.width !== previous.width || current.height !== previous.height) { return undefined; }
	let intersection = 0;
	let currentEdges = 0;
	let previousEdges = 0;
	for (let pixel = 0; pixel < current.width * current.height; pixel++) {
		const offset = pixel * 4;
		const currentEdge = current.data[offset] + current.data[offset + 1] + current.data[offset + 2] >= 3 * 128;
		const previousEdge = previous.data[offset] + previous.data[offset + 1] + previous.data[offset + 2] >= 3 * 128;
		if (currentEdge) { currentEdges++; }
		if (previousEdge) { previousEdges++; }
		if (currentEdge && previousEdge) { intersection++; }
	}
	const union = currentEdges + previousEdges - intersection;
	return {
		iou: union === 0 ? 1 : intersection / union,
		f1: currentEdges + previousEdges === 0 ? 1 : (2 * intersection) / (currentEdges + previousEdges),
	};
}

export function calculateM9Comparison(
	currentValue: unknown,
	previousValue: unknown,
	currentEdgePng?: Buffer,
	previousEdgePng?: Buffer
): M9Comparison | undefined {
	const current = readM9Result(currentValue);
	const previous = readM9Result(previousValue);
	if (!current || !previous) { return undefined; }
	const edgeSimilarity = currentEdgePng && previousEdgePng
		? compareBinaryEdgeMaps(currentEdgePng, previousEdgePng)
		: undefined;
	return {
		currentDensity: current.density,
		previousDensity: previous.density,
		percentagePointDelta: (current.density - previous.density) * 100,
		edgeMapIou: edgeSimilarity?.iou,
		edgeMapF1: edgeSimilarity?.f1,
	};
}

function readM10Result(value: unknown): { congestion: number; mapUrl?: string } | undefined {
	if (Array.isArray(value)) {
		const congestion = finiteNumber(value[0]);
		return congestion !== undefined
			? { congestion, mapUrl: typeof value[1] === 'string' ? value[1] : undefined }
			: undefined;
	}
	if (typeof value !== 'object' || value === null) { return undefined; }
	const fields = new Map(Object.entries(value).map(([key, fieldValue]) => [
		key.toLowerCase().replace(/[^a-z0-9]/g, ''), fieldValue,
	]));
	const congestion = finiteNumber(
		fields.get('featurecongestion') ?? fields.get('congestion') ?? fields.get('score') ?? fields.get('value')
	);
	const map = fields.get('congestionmap') ?? fields.get('mapurl') ?? fields.get('visualization') ?? fields.get('image');
	return congestion !== undefined
		? { congestion, mapUrl: typeof map === 'string' ? map : undefined }
		: undefined;
}

function normalizedIntensityMap(intensities: number[]): number[] {
	const minimum = intensities.reduce((result, value) => Math.min(result, value), Number.POSITIVE_INFINITY);
	const maximum = intensities.reduce((result, value) => Math.max(result, value), Number.NEGATIVE_INFINITY);
	const range = maximum - minimum;
	return range > 0
		? intensities.map((value) => (value - minimum) / range)
		: intensities.map(() => 0);
}

function compareCongestionMaps(
	currentPng: Buffer,
	previousPng: Buffer
): { meanAbsoluteDifference: number; highCongestionOverlap: number } | undefined {
	let current: PNG;
	let previous: PNG;
	try {
		current = PNG.sync.read(currentPng);
		previous = PNG.sync.read(previousPng);
	} catch {
		return undefined;
	}
	if (current.width !== previous.width || current.height !== previous.height) { return undefined; }
	const step = Math.max(1, Math.ceil(Math.sqrt((current.width * current.height) / 76800)));
	const currentValues = normalizedIntensityMap(sampledSaliencyMap(current, step).intensities);
	const previousValues = normalizedIntensityMap(sampledSaliencyMap(previous, step).intensities);
	const meanAbsoluteDifference = currentValues.reduce(
		(sum, value, index) => sum + Math.abs(value - previousValues[index]),
		0
	) / currentValues.length;
	const currentHigh = mostSalientLocations(currentValues);
	const previousHigh = mostSalientLocations(previousValues);
	let intersection = 0;
	let union = 0;
	for (let index = 0; index < currentValues.length; index++) {
		const inCurrent = currentHigh.has(index);
		const inPrevious = previousHigh.has(index);
		if (inCurrent && inPrevious) { intersection++; }
		if (inCurrent || inPrevious) { union++; }
	}
	return {
		meanAbsoluteDifference,
		highCongestionOverlap: union > 0 ? intersection / union : 1,
	};
}

export function calculateM10Comparison(
	currentValue: unknown,
	previousValue: unknown,
	currentMapPng?: Buffer,
	previousMapPng?: Buffer
): M10Comparison | undefined {
	const current = readM10Result(currentValue);
	const previous = readM10Result(previousValue);
	if (!current || !previous) { return undefined; }
	const mapComparison = currentMapPng && previousMapPng
		? compareCongestionMaps(currentMapPng, previousMapPng)
		: undefined;
	return {
		currentCongestion: current.congestion,
		previousCongestion: previous.congestion,
		scalarDelta: current.congestion - previous.congestion,
		mapMeanAbsoluteDifference: mapComparison?.meanAbsoluteDifference,
		highCongestionOverlap: mapComparison?.highCongestionOverlap,
	};
}

function readM11Scalar(value: unknown): number | undefined {
	const direct = finiteNumber(value);
	if (direct !== undefined) { return direct; }
	if (Array.isArray(value)) { return readM11Scalar(value[0]); }
	if (typeof value !== 'object' || value === null) { return undefined; }
	const fields = new Map(Object.entries(value).map(([key, fieldValue]) => [
		key.toLowerCase().replace(/[^a-z0-9]/g, ''), fieldValue,
	]));
	return finiteNumber(
		fields.get('subbandentropy') ?? fields.get('entropy') ?? fields.get('score') ?? fields.get('value')
	);
}

export function calculateM11Comparison(
	currentValue: unknown,
	previousValue: unknown
): M11Comparison | undefined {
	const currentEntropy = readM11Scalar(currentValue);
	const previousEntropy = readM11Scalar(previousValue);
	if (currentEntropy === undefined || previousEntropy === undefined) { return undefined; }
	const absoluteDelta = currentEntropy - previousEntropy;
	return {
		currentEntropy,
		previousEntropy,
		absoluteDelta,
		relativeDeltaPercent: previousEntropy === 0
			? undefined
			: (absoluteDelta / previousEntropy) * 100,
	};
}

function readM12Scalar(value: unknown): number | undefined {
	const direct = finiteNumber(value);
	if (direct !== undefined) { return direct; }
	if (Array.isArray(value)) { return readM12Scalar(value[0]); }
	if (typeof value !== 'object' || value === null) { return undefined; }
	const fields = new Map(Object.entries(value).map(([key, fieldValue]) => [
		key.toLowerCase().replace(/[^a-z0-9]/g, ''), fieldValue,
	]));
	return finiteNumber(
		fields.get('shannoninformationentropy') ?? fields.get('shannonentropy')
			?? fields.get('entropy') ?? fields.get('score') ?? fields.get('value')
	);
}

export function calculateM12Comparison(
	currentValue: unknown,
	previousValue: unknown
): M12Comparison | undefined {
	const currentEntropy = readM12Scalar(currentValue);
	const previousEntropy = readM12Scalar(previousValue);
	if (currentEntropy === undefined || previousEntropy === undefined) { return undefined; }
	const absoluteDelta = currentEntropy - previousEntropy;
	return {
		currentEntropy,
		previousEntropy,
		absoluteDelta,
		relativeDeltaPercent: previousEntropy === 0
			? undefined
			: (absoluteDelta / previousEntropy) * 100,
	};
}

function parseJsonValue(value: unknown): unknown {
	if (typeof value !== 'string') { return value; }
	const trimmed = value.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) { return value; }
	try { return JSON.parse(trimmed); } catch { return value; }
}

function normalizeAccessibilityTarget(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const normalized = value.trim().replace(/\s+/g, ' ');
		return normalized || undefined;
	}
	if (Array.isArray(value)) {
		const parts = value.map(normalizeAccessibilityTarget).filter((part): part is string => Boolean(part));
		return parts.length > 0 ? parts.join(' >>> ') : undefined;
	}
	return undefined;
}

function accessibilityIssueFromNode(rule: Record<string, unknown>, node: Record<string, unknown>): AccessibilityIssue | undefined {
	const ruleId = String(rule.id ?? rule.ruleId ?? rule.rule_id ?? '').trim();
	if (!ruleId) { return undefined; }
	const target = normalizeAccessibilityTarget(
		node.target ?? node.selector ?? node.element ?? node.html
	);
	if (!target) { return undefined; }
	const impact = String(node.impact ?? rule.impact ?? rule.severity ?? 'unknown').toLowerCase();
	const descriptionValue = rule.help ?? rule.description ?? node.failureSummary ?? node.message;
	return {
		identity: `${ruleId}\u0000${target}`,
		ruleId,
		target,
		impact,
		description: typeof descriptionValue === 'string' ? descriptionValue : undefined,
	};
}

function extractAccessibilityIssues(value: unknown): { recognized: boolean; issues: AccessibilityIssue[] } {
	const parsed = parseJsonValue(value);
	if (Array.isArray(parsed)) {
		const issues: AccessibilityIssue[] = [];
		let recognized = parsed.length === 0;
		for (const item of parsed) {
			const extracted = extractAccessibilityIssues(item);
			recognized ||= extracted.recognized;
			issues.push(...extracted.issues);
		}
		return { recognized, issues };
	}
	if (typeof parsed !== 'object' || parsed === null) {
		return { recognized: false, issues: [] };
	}

	const record = parsed as Record<string, unknown>;
	const ruleId = record.id ?? record.ruleId ?? record.rule_id;
	if (typeof ruleId === 'string') {
		const nodes = Array.isArray(record.nodes) ? record.nodes : [record];
		const issues = nodes.flatMap((node) => {
			if (typeof node !== 'object' || node === null) { return []; }
			const issue = accessibilityIssueFromNode(record, node as Record<string, unknown>);
			return issue ? [issue] : [];
		});
		return { recognized: true, issues };
	}

	for (const key of ['violations', 'issues', 'details', 'result', 'results', 'data', 'accessibility']) {
		if (key in record) {
			const extracted = extractAccessibilityIssues(record[key]);
			if (extracted.recognized) { return extracted; }
		}
	}
	return { recognized: false, issues: [] };
}

function uniqueAccessibilityIssues(value: unknown): AccessibilityIssue[] | undefined {
	const extracted = extractAccessibilityIssues(value);
	if (!extracted.recognized) { return undefined; }
	const unique = new Map<string, AccessibilityIssue>();
	for (const issue of extracted.issues) { unique.set(issue.identity, issue); }
	return Array.from(unique.values()).sort((a, b) => a.identity.localeCompare(b.identity));
}

function accessibilityBreakdown(
	current: AccessibilityIssue[],
	previous: AccessibilityIssue[],
	field: 'impact' | 'ruleId'
): AccessibilityCountComparison[] {
	const currentCounts = new Map<string, number>();
	const previousCounts = new Map<string, number>();
	for (const issue of current) { currentCounts.set(issue[field], (currentCounts.get(issue[field]) ?? 0) + 1); }
	for (const issue of previous) { previousCounts.set(issue[field], (previousCounts.get(issue[field]) ?? 0) + 1); }
	const keys = new Set([...currentCounts.keys(), ...previousCounts.keys()]);
	return Array.from(keys, (key) => {
		const currentCount = currentCounts.get(key) ?? 0;
		const previousCount = previousCounts.get(key) ?? 0;
		return { key, previous: previousCount, current: currentCount, delta: currentCount - previousCount };
	}).sort((a, b) => a.key.localeCompare(b.key));
}

export function calculateM13Comparison(
	currentValue: unknown,
	previousValue: unknown
): M13Comparison | undefined {
	const current = uniqueAccessibilityIssues(currentValue);
	const previous = uniqueAccessibilityIssues(previousValue);
	if (!current || !previous) { return undefined; }
	const currentByIdentity = new Map(current.map((issue) => [issue.identity, issue]));
	const previousByIdentity = new Map(previous.map((issue) => [issue.identity, issue]));
	return {
		previousCount: previous.length,
		currentCount: current.length,
		newIssues: current.filter((issue) => !previousByIdentity.has(issue.identity)),
		resolvedIssues: previous.filter((issue) => !currentByIdentity.has(issue.identity)),
		persistentIssues: current.filter((issue) => previousByIdentity.has(issue.identity)),
		byImpact: accessibilityBreakdown(current, previous, 'impact'),
		byRule: accessibilityBreakdown(current, previous, 'ruleId'),
	};
}

function countPhrase(count: number, singular: string, plural: string): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

export function summarizeM13Comparison(comparison: M13Comparison): string {
	const newCount = comparison.newIssues.length;
	const resolvedCount = comparison.resolvedIssues.length;
	if (newCount === 0 && resolvedCount === 0) {
		return comparison.persistentIssues.length === 0
			? 'No accessibility violations were found in either run.'
			: `${countPhrase(comparison.persistentIssues.length, 'accessibility violation remains', 'accessibility violations remain')} persistent.`;
	}
	const resolved = resolvedCount > 0
		? `${countPhrase(resolvedCount, 'accessibility problem was', 'accessibility problems were')} resolved`
		: '';
	const representative = comparison.newIssues.find((issue) => issue.impact === 'critical')
		?? comparison.newIssues.find((issue) => issue.impact === 'serious')
		?? comparison.newIssues[0];
	const introduced = representative
		? newCount === 1
			? `1 new ${representative.impact} ${representative.ruleId} violation appeared on ${representative.target}`
			: `${newCount} new accessibility violations appeared, including a ${representative.impact} ${representative.ruleId} violation on ${representative.target}`
		: '';
	if (resolved && introduced) { return `${resolved}, but ${introduced}.`; }
	return `${resolved || introduced}.`;
}

function readM14Values(value: unknown): { mean: number; standardDeviation: number } | undefined {
	const parsed = parseJsonValue(value);
	if (Array.isArray(parsed)) {
		if (parsed.length === 1) { return readM14Values(parsed[0]); }
		const mean = finiteNumber(parsed[0]);
		const standardDeviation = finiteNumber(parsed[1]);
		return mean === undefined || standardDeviation === undefined
			? undefined
			: { mean, standardDeviation };
	}
	if (typeof parsed !== 'object' || parsed === null) { return undefined; }
	const fields = new Map(Object.entries(parsed).map(([key, fieldValue]) => [
		key.toLowerCase().replace(/[^a-z0-9]/g, ''), fieldValue,
	]));
	const mean = finiteNumber(
		fields.get('mean') ?? fields.get('meanscore') ?? fields.get('nimascore') ?? fields.get('score')
	);
	const standardDeviation = finiteNumber(
		fields.get('standarddeviation') ?? fields.get('stddeviation') ?? fields.get('stddev')
			?? fields.get('stdev') ?? fields.get('std') ?? fields.get('sd')
	);
	return mean === undefined || standardDeviation === undefined
		? undefined
		: { mean, standardDeviation };
}

export function calculateM14Comparison(
	currentValue: unknown,
	previousValue: unknown
): M14Comparison | undefined {
	const current = readM14Values(currentValue);
	const previous = readM14Values(previousValue);
	if (!current || !previous) { return undefined; }
	return {
		mean: {
			current: current.mean,
			previous: previous.mean,
			delta: current.mean - previous.mean,
		},
		standardDeviation: {
			current: current.standardDeviation,
			previous: previous.standardDeviation,
			delta: current.standardDeviation - previous.standardDeviation,
		},
	};
}

function readM8WordCount(value: unknown): number | undefined {
	const parsed = parseJsonValue(value);
	const direct = finiteNumber(parsed);
	if (direct !== undefined) {
		return Number.isInteger(direct) && direct >= 0 ? direct : undefined;
	}
	if (Array.isArray(parsed)) { return readM8WordCount(parsed[0]); }
	if (typeof parsed !== 'object' || parsed === null) { return undefined; }
	const fields = new Map(Object.entries(parsed).map(([key, fieldValue]) => [
		key.toLowerCase().replace(/[^a-z0-9]/g, ''), fieldValue,
	]));
	return readM8WordCount(
		fields.get('wordcount') ?? fields.get('visiblewordcount') ?? fields.get('words')
			?? fields.get('count') ?? fields.get('value')
	);
}

export function calculateM8Comparison(
	currentValue: unknown,
	previousValue: unknown
): M8Comparison | undefined {
	const currentWordCount = readM8WordCount(currentValue);
	const previousWordCount = readM8WordCount(previousValue);
	if (currentWordCount === undefined || previousWordCount === undefined) { return undefined; }
	const absoluteDelta = currentWordCount - previousWordCount;
	return {
		currentWordCount,
		previousWordCount,
		absoluteDelta,
		relativeDeltaPercent: previousWordCount === 0
			? undefined
			: (absoluteDelta / previousWordCount) * 100,
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

function findM11HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory
): { comparison: M11Comparison; previousCreatedAt: string } | undefined {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm11') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) { continue; }
		const comparison = calculateM11Comparison(currentResult.results, historicalResult.results);
		if (comparison) {
			return { comparison, previousCreatedAt: historicalResult.createdAt };
		}
	}
	return undefined;
}

function findM12HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory
): { comparison: M12Comparison; previousCreatedAt: string } | undefined {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm12') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) { continue; }
		const comparison = calculateM12Comparison(currentResult.results, historicalResult.results);
		if (comparison) {
			return { comparison, previousCreatedAt: historicalResult.createdAt };
		}
	}
	return undefined;
}

function findM13HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory
): { comparison: M13Comparison; previousCreatedAt: string } | undefined {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm13') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) { continue; }
		const comparison = calculateM13Comparison(currentResult.results, historicalResult.results);
		if (comparison) {
			return { comparison, previousCreatedAt: historicalResult.createdAt };
		}
	}
	return undefined;
}

function findM14HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory
): { comparison: M14Comparison; previousCreatedAt: string } | undefined {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm14') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) { continue; }
		const comparison = calculateM14Comparison(currentResult.results, historicalResult.results);
		if (comparison) {
			return { comparison, previousCreatedAt: historicalResult.createdAt };
		}
	}
	return undefined;
}

function readM7ImageUrls(value: unknown): { heatmap: string; overlay?: string } | undefined {
	if (Array.isArray(value)) {
		const urls = value.filter((item): item is string =>
			typeof item === 'string' && /^https?:\/\//.test(item)
		);
		if (urls.length > 0) { return { heatmap: urls[0], overlay: urls[1] }; }
	}
	if (typeof value !== 'object' || value === null) { return undefined; }
	const fields = value as Record<string, unknown>;
	const heatmap = fields.heatmap ?? fields.saliencyHeatmap ?? fields.saliency_heatmap;
	const overlay = fields.overlay ?? fields.heatmapOverlay ?? fields.heatmap_overlay;
	return typeof heatmap === 'string'
		? { heatmap, overlay: typeof overlay === 'string' ? overlay : undefined }
		: undefined;
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10_000);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) { throw new Error(`HTTP ${response.status} fetching saliency heatmap`); }
		const content = Buffer.from(await response.arrayBuffer());
		if (content.length > 20 * 1024 * 1024) { throw new Error('Saliency heatmap exceeds 20 MiB'); }
		return content;
	} finally {
		clearTimeout(timeout);
	}
}

async function findM7HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory
): Promise<{
	comparison: M7Comparison;
	previousCreatedAt: string;
	currentHeatmapUrl: string;
	previousHeatmapUrl: string;
} | undefined> {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm7') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) { continue; }
		const currentUrls = readM7ImageUrls(currentResult.results);
		const previousUrls = readM7ImageUrls(historicalResult.results);
		if (!currentUrls || !previousUrls) { continue; }
		try {
			const [currentImage, previousImage] = await Promise.all([
				fetchImageBuffer(currentUrls.heatmap),
				fetchImageBuffer(previousUrls.heatmap),
			]);
			const comparison = compareSaliencyHeatmaps(currentImage, previousImage);
			if (comparison) {
				return {
					comparison,
					previousCreatedAt: historicalResult.createdAt,
					currentHeatmapUrl: currentUrls.heatmap,
					previousHeatmapUrl: previousUrls.heatmap,
				};
			}
		} catch { }
	}
	return undefined;
}

function findM8HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory
): { comparison: M8Comparison; previousCreatedAt: string } | undefined {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm8') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) { continue; }
		const comparison = calculateM8Comparison(currentResult.results, historicalResult.results);
		if (comparison) {
			return { comparison, previousCreatedAt: historicalResult.createdAt };
		}
	}
	return undefined;
}

async function findM9HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory
): Promise<{
	comparison: M9Comparison;
	previousCreatedAt: string;
	currentEdgeImageUrl?: string;
	previousEdgeImageUrl?: string;
} | undefined> {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm9') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) { continue; }
		const current = readM9Result(currentResult.results);
		const previous = readM9Result(historicalResult.results);
		if (!current || !previous) { continue; }
		let currentImage: Buffer | undefined;
		let previousImage: Buffer | undefined;
		if (current.edgeImageUrl && previous.edgeImageUrl) {
			try {
				[currentImage, previousImage] = await Promise.all([
					fetchImageBuffer(current.edgeImageUrl),
					fetchImageBuffer(previous.edgeImageUrl),
				]);
			} catch { }
		}
		const comparison = calculateM9Comparison(
			currentResult.results,
			historicalResult.results,
			currentImage,
			previousImage
		);
		if (comparison) {
			return {
				comparison,
				previousCreatedAt: historicalResult.createdAt,
				currentEdgeImageUrl: current.edgeImageUrl,
				previousEdgeImageUrl: previous.edgeImageUrl,
			};
		}
	}
	return undefined;
}

async function findM10HistoryComparison(
	currentResults: any[],
	history: AssessmentHistory
): Promise<{
	comparison: M10Comparison;
	previousCreatedAt: string;
	currentMapUrl?: string;
	previousMapUrl?: string;
} | undefined> {
	for (const currentResult of currentResults) {
		if (typeof currentResult?.metric_id !== 'string' || currentResult.metric_id.split('_')[0] !== 'm10') {
			continue;
		}
		const historicalResult = history.metrics[currentResult.metric_id];
		if (!historicalResult) { continue; }
		const current = readM10Result(currentResult.results);
		const previous = readM10Result(historicalResult.results);
		if (!current || !previous) { continue; }
		let currentMap: Buffer | undefined;
		let previousMap: Buffer | undefined;
		if (current.mapUrl && previous.mapUrl) {
			try {
				[currentMap, previousMap] = await Promise.all([
					fetchImageBuffer(current.mapUrl),
					fetchImageBuffer(previous.mapUrl),
				]);
			} catch { }
		}
		const comparison = calculateM10Comparison(
			currentResult.results,
			historicalResult.results,
			currentMap,
			previousMap
		);
		if (comparison) {
			return {
				comparison,
				previousCreatedAt: historicalResult.createdAt,
				currentMapUrl: current.mapUrl,
				previousMapUrl: previous.mapUrl,
			};
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

function accessibilityBreakdownRows(rows: AccessibilityCountComparison[]): string {
	return rows.map((row) => `<tr><th scope="row">${escapeHtml(row.key)}</th><td>${row.previous}</td><td>${row.current}</td><td>${signedNumber(row.delta)}</td></tr>`).join('');
}

function accessibilityIssueList(issues: AccessibilityIssue[]): string {
	if (issues.length === 0) { return '<p>None</p>'; }
	return `<ul class="issue-list">${issues.map((issue) => `
		<li><strong>${escapeHtml(issue.ruleId)}</strong> · ${escapeHtml(issue.impact)}<br><code>${escapeHtml(issue.target)}</code>${issue.description ? `<br><span>${escapeHtml(issue.description)}</span>` : ''}</li>`).join('')}</ul>`;
}

async function showHistoryComparison(
	currentResults: any[],
	history: AssessmentHistory,
	url: string,
	selectedMetricIds: string[] = []
): Promise<void> {
	const currentM4Result = currentResults.find(
		(result: any) => typeof result?.metric_id === 'string' && result.metric_id.split('_')[0] === 'm4'
	);
	const selectedM4MetricId = selectedMetricIds.find((metricId) => metricId.split('_')[0] === 'm4');
	const m4WasSelected = Boolean(currentM4Result || selectedM4MetricId);
	const m4MetricId = currentM4Result?.metric_id ?? selectedM4MetricId;
	const historicalM4Result = m4MetricId ? history.metrics[m4MetricId] : undefined;
	const m1Match = findM1HistoryComparison(currentResults, history);
	const m2Match = findM2HistoryComparison(currentResults, history);
	const m3Match = findM3HistoryComparison(currentResults, history);
	const m4Match = findM4HistoryComparison(currentResults, history);
	const m5Match = findM5HistoryComparison(currentResults, history);
	const dimensions = history.screenshotDimensions;
	const m6Match = dimensions
		? findM6HistoryComparison(currentResults, history, dimensions)
		: undefined;
	const m11Match = findM11HistoryComparison(currentResults, history);
	const m12Match = findM12HistoryComparison(currentResults, history);
	const m13Match = findM13HistoryComparison(currentResults, history);
	const m14Match = findM14HistoryComparison(currentResults, history);
	const m7Match = await findM7HistoryComparison(currentResults, history);
	const m8Match = findM8HistoryComparison(currentResults, history);
	const m9Match = await findM9HistoryComparison(currentResults, history);
	const m10Match = await findM10HistoryComparison(currentResults, history);
	if (!m1Match && !m2Match && !m3Match && !m4Match && !m4WasSelected && !m5Match && !m6Match && !m7Match && !m8Match && !m9Match && !m10Match && !m11Match && !m12Match && !m13Match && !m14Match) {
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
				<div class="card"><span class="label">Absolute delta</span><span class="value">${signedNumber(m2Match.comparison.jpegAbsoluteDelta)} bytes</span></div>
				<div class="card"><span class="label">Relative change</span><span class="value">${relativeChange(m2Match.comparison.jpegRelativeDeltaPercent)}</span></div>
			</div>
			<h3>Compression ratio</h3>
			<div class="grid">
				<div class="card"><span class="label">Previous ratio</span><span class="value">${m2Match.comparison.previousCompressionRatio.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Current ratio</span><span class="value">${m2Match.comparison.currentCompressionRatio.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Absolute change</span><span class="value">${signedNumber(m2Match.comparison.compressionRatioAbsoluteDelta, 4)}</span></div>
				<div class="card"><span class="label">Relative change</span><span class="value">${relativeChange(m2Match.comparison.compressionRatioRelativeDeltaPercent)}</span></div>
			</div>
			<div class="explanation"><p>M2 changes can indicate altered JPEG compressibility or different visual content. JPEG size shows both the absolute byte delta and the relative change as a percentage of the previous size. File size and compression ratio are compared independently. Neither an increase nor a decrease is automatically better.</p></div>
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
	const currentM4Values = currentM4Result ? readM4Values(currentM4Result.results) : undefined;
	const m4UnavailableReason = m4WasSelected && !m4Match
		? getM4ComparisonUnavailableReason({
			hasCurrentResult: Boolean(currentM4Result),
			currentValue: currentM4Result?.results,
			hasHistoricalResult: Boolean(historicalM4Result),
			previousValue: historicalM4Result?.results,
			dimensionsAvailable: Boolean(dimensions),
		})
		: undefined;
	const m4CurrentValues = currentM4Values ? `
			<h3>Current CIELAB values</h3>
			<div class="table-wrap"><table><thead><tr><th>Channel</th><th>Mean</th><th>Standard deviation</th></tr></thead><tbody>
				<tr><th scope="row">L* · lightness</th><td>${currentM4Values.lMean.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td><td>${currentM4Values.lSd.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td></tr>
				<tr><th scope="row">a* · green–red</th><td>${currentM4Values.aMean.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td><td>${currentM4Values.aSd.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td></tr>
				<tr><th scope="row">b* · blue–yellow</th><td>${currentM4Values.bMean.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td><td>${currentM4Values.bSd.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td></tr>
			</tbody></table></div>` : '';
	const m4UnavailableSection = m4UnavailableReason ? `
		<section class="metric-section">
			<h2>M4 · CIELAB mean and standard deviation</h2>
			<p class="structural-summary">History comparison unavailable</p>
			<div class="comparison-warning"><p>${escapeHtml(m4UnavailableReason)}</p></div>
			${m4CurrentValues}
			<div class="explanation"><p>M4 remains visible because it was selected for the current assessment. A comparison is only calculated when both runs provide six numeric CIELAB values and the previous completed run matches the same project, page, metric, and screenshot dimensions.</p></div>
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

	const m7Section = m7Match ? `
		<section class="metric-section">
			<h2>M7 · UMSI saliency shift</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m7Match.previousCreatedAt).toLocaleString()}</p>
			<div class="heatmap-grid">
				<figure><img src="${escapeHtml(m7Match.previousHeatmapUrl)}" alt="Previous UMSI saliency heatmap"><figcaption>Previous heatmap</figcaption></figure>
				<figure><img src="${escapeHtml(m7Match.currentHeatmapUrl)}" alt="Current UMSI saliency heatmap"><figcaption>Current heatmap</figcaption></figure>
			</div>
			<div class="grid">
				<div class="card"><span class="label">Jensen–Shannon divergence</span><span class="value">${m7Match.comparison.jensenShannonDivergence.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Top-10% salient-region overlap</span><span class="value">${(m7Match.comparison.salientRegionOverlap * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span></div>
				<div class="card"><span class="label">Saliency-centre movement</span><span class="value">${(m7Match.comparison.centerMovement * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</span></div>
				<div class="card"><span class="label">Attention regions</span><span class="value text-value">${m7Match.comparison.previousRegion} → ${m7Match.comparison.currentRegion}</span></div>
			</div>
			<p class="structural-summary">${m7Match.comparison.interpretation}</p>
			<div class="explanation"><p>The current and previous saliency heatmaps are converted to intensity maps and normalized so every map sums to one. Jensen–Shannon divergence measures the overall distribution change, overlap compares the most salient 10% of locations, and centre movement tracks the probability-weighted attention centre. The overlay images are visual aids and are not used in the calculation. A shift in predicted attention has no universal better direction without a design goal.</p></div>
		</section>` : '';

	const m8Direction = m8Match
		? m8Match.comparison.absoluteDelta > 0
			? `${m8Match.comparison.absoluteDelta.toLocaleString()} ${m8Match.comparison.absoluteDelta === 1 ? 'word was' : 'words were'} added to the visible content.`
			: m8Match.comparison.absoluteDelta < 0
				? `${Math.abs(m8Match.comparison.absoluteDelta).toLocaleString()} ${m8Match.comparison.absoluteDelta === -1 ? 'word was' : 'words were'} removed from the visible content.`
				: 'The visible word count did not change.'
		: '';
	const m8Section = m8Match ? `
		<section class="metric-section">
			<h2>M8 · Word count</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m8Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous count</span><span class="value">${m8Match.comparison.previousWordCount.toLocaleString()} words</span></div>
				<div class="card"><span class="label">Current count</span><span class="value">${m8Match.comparison.currentWordCount.toLocaleString()} words</span></div>
				<div class="card"><span class="label">Absolute delta</span><span class="value">${signedNumber(m8Match.comparison.absoluteDelta)} words</span></div>
				<div class="card"><span class="label">Relative delta</span><span class="value">${relativeChange(m8Match.comparison.relativeDeltaPercent)}</span></div>
			</div>
			<p class="structural-summary">${m8Direction}</p>
			<div class="explanation"><p>M8 counts words in the visible page content. The absolute delta is current minus previous word count, and the relative delta expresses the change against the previous count. Added or removed content is reported without labeling either more or fewer words as inherently better.</p></div>
		</section>` : '';

	const m9Direction = m9Match
		? m9Match.comparison.percentagePointDelta > 0
			? 'Edge density increased; this generally indicates more visual clutter.'
			: m9Match.comparison.percentagePointDelta < 0
				? 'Edge density decreased; this generally indicates less visual clutter.'
				: 'Edge density did not change.'
		: '';
	const m9EdgeMapCards = m9Match?.comparison.edgeMapIou !== undefined
		&& m9Match.comparison.edgeMapF1 !== undefined ? `
			<div class="grid">
				<div class="card"><span class="label">Binary edge-map IoU</span><span class="value">${(m9Match.comparison.edgeMapIou * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span></div>
				<div class="card"><span class="label">Binary edge-map F1</span><span class="value">${(m9Match.comparison.edgeMapF1 * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span></div>
			</div>` : '';
	const m9EdgeImages = m9Match?.currentEdgeImageUrl && m9Match.previousEdgeImageUrl ? `
			<div class="heatmap-grid">
				<figure><img src="${escapeHtml(m9Match.previousEdgeImageUrl)}" alt="Previous binary edge map"><figcaption>Previous edge map</figcaption></figure>
				<figure><img src="${escapeHtml(m9Match.currentEdgeImageUrl)}" alt="Current binary edge map"><figcaption>Current edge map</figcaption></figure>
			</div>` : '';
	const m9Section = m9Match ? `
		<section class="metric-section">
			<h2>M9 · Edge density</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m9Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous edge density</span><span class="value">${(m9Match.comparison.previousDensity * 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%</span></div>
				<div class="card"><span class="label">Current edge density</span><span class="value">${(m9Match.comparison.currentDensity * 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%</span></div>
				<div class="card"><span class="label">Absolute difference</span><span class="value">${signedNumber(m9Match.comparison.percentagePointDelta, 3)} pp</span></div>
			</div>
			<p class="structural-summary">${m9Direction}</p>
			${m9EdgeImages}
			${m9EdgeMapCards}
			<div class="explanation"><p>The scalar edge density is the primary comparison. A higher density generally indicates more visual clutter. When both binary edge images are available, IoU and F1 additionally show how strongly the detected edge locations overlap, while the images help localize where the clutter pattern changed.</p></div>
		</section>` : '';

	const m10Direction = m10Match
		? m10Match.comparison.scalarDelta > 0
			? 'Feature congestion increased; this generally indicates more display clutter.'
			: m10Match.comparison.scalarDelta < 0
				? 'Feature congestion decreased; this generally indicates less display clutter.'
				: 'Feature congestion did not change.'
		: '';
	const m10MapCards = m10Match?.comparison.mapMeanAbsoluteDifference !== undefined
		&& m10Match.comparison.highCongestionOverlap !== undefined ? `
			<div class="grid">
				<div class="card"><span class="label">Normalized map MAD</span><span class="value">${m10Match.comparison.mapMeanAbsoluteDifference.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Top-10% congestion overlap</span><span class="value">${(m10Match.comparison.highCongestionOverlap * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span></div>
			</div>` : '';
	const m10MapImages = m10Match?.currentMapUrl && m10Match.previousMapUrl ? `
			<div class="heatmap-grid">
				<figure><img src="${escapeHtml(m10Match.previousMapUrl)}" alt="Previous feature-congestion map"><figcaption>Previous congestion map</figcaption></figure>
				<figure><img src="${escapeHtml(m10Match.currentMapUrl)}" alt="Current feature-congestion map"><figcaption>Current congestion map</figcaption></figure>
			</div>` : '';
	const m10Section = m10Match ? `
		<section class="metric-section">
			<h2>M10 · Feature congestion</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m10Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous congestion</span><span class="value">${m10Match.comparison.previousCongestion.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Current congestion</span><span class="value">${m10Match.comparison.currentCongestion.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Scalar delta</span><span class="value">${signedNumber(m10Match.comparison.scalarDelta, 4)}</span></div>
			</div>
			<p class="structural-summary">${m10Direction}</p>
			${m10MapImages}
			${m10MapCards}
			<div class="explanation"><p>The scalar feature-congestion score is the primary comparison. Higher values generally indicate more display clutter. When both visualizations are available, each congestion map is normalized independently to 0–1; mean absolute difference measures overall spatial change, while overlap compares the highest-congestion 10% of locations to help localize where clutter shifted.</p></div>
		</section>` : '';

	const m11Direction = m11Match
		? m11Match.comparison.absoluteDelta > 0
			? 'Subband entropy increased; according to the metric definition, this indicates more visual clutter.'
			: m11Match.comparison.absoluteDelta < 0
				? 'Subband entropy decreased; according to the metric definition, this indicates less visual clutter.'
				: 'Subband entropy did not change.'
		: '';
	const m11Section = m11Match ? `
		<section class="metric-section">
			<h2>M11 · Subband entropy</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m11Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous entropy</span><span class="value">${m11Match.comparison.previousEntropy.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Current entropy</span><span class="value">${m11Match.comparison.currentEntropy.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Absolute delta</span><span class="value">${signedNumber(m11Match.comparison.absoluteDelta, 4)}</span></div>
				<div class="card"><span class="label">Relative delta</span><span class="value">${relativeChange(m11Match.comparison.relativeDeltaPercent)}</span></div>
			</div>
			<p class="structural-summary">${m11Direction}</p>
			<div class="explanation"><p>Subband entropy estimates visual clutter through the information carried across image subbands. The absolute delta is current minus previous entropy, and the relative delta expresses that change against the previous value. Higher entropy indicates more visual clutter according to the metric definition.</p></div>
		</section>` : '';

	const m12Direction = m12Match
		? m12Match.comparison.absoluteDelta > 0
			? 'Shannon entropy increased, indicating more detail, information, or noise.'
			: m12Match.comparison.absoluteDelta < 0
				? 'Shannon entropy decreased, indicating less detail, information, or noise.'
				: 'Shannon entropy did not change.'
		: '';
	const m12Section = m12Match ? `
		<section class="metric-section">
			<h2>M12 · Shannon information entropy</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m12Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous entropy</span><span class="value">${m12Match.comparison.previousEntropy.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Current entropy</span><span class="value">${m12Match.comparison.currentEntropy.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
				<div class="card"><span class="label">Absolute delta</span><span class="value">${signedNumber(m12Match.comparison.absoluteDelta, 4)}</span></div>
				<div class="card"><span class="label">Relative delta</span><span class="value">${relativeChange(m12Match.comparison.relativeDeltaPercent)}</span></div>
			</div>
			<p class="structural-summary">${m12Direction}</p>
			<div class="explanation"><p>Shannon information entropy quantifies the information and detail in the grayscale interface image. The absolute delta is current minus previous entropy, and the relative delta expresses that change against the previous value. Higher entropy can reflect more detail, information, or noise, but it is not automatically worse: research also connects entropy with aesthetics and orderliness.</p></div>
		</section>` : '';

	const m13Section = m13Match ? `
		<section class="metric-section">
			<h2>M13 · Accessibility checks</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m13Match.previousCreatedAt).toLocaleString()}</p>
			<div class="grid">
				<div class="card"><span class="label">Previous issues</span><span class="value">${m13Match.comparison.previousCount}</span></div>
				<div class="card"><span class="label">Current issues</span><span class="value">${m13Match.comparison.currentCount}</span></div>
				<div class="card regression-card"><span class="label">New · regressions</span><span class="value">${m13Match.comparison.newIssues.length}</span></div>
				<div class="card improvement-card"><span class="label">Resolved · improvements</span><span class="value">${m13Match.comparison.resolvedIssues.length}</span></div>
				<div class="card"><span class="label">Persistent</span><span class="value">${m13Match.comparison.persistentIssues.length}</span></div>
			</div>
			<p class="structural-summary">${escapeHtml(summarizeM13Comparison(m13Match.comparison))}</p>
			<h3>Counts by impact / severity</h3>
			<div class="table-wrap"><table><thead><tr><th>Impact</th><th>Previous</th><th>Current</th><th>Delta</th></tr></thead><tbody>${accessibilityBreakdownRows(m13Match.comparison.byImpact)}</tbody></table></div>
			<h3>Counts by rule</h3>
			<div class="table-wrap"><table><thead><tr><th>Rule</th><th>Previous</th><th>Current</th><th>Delta</th></tr></thead><tbody>${accessibilityBreakdownRows(m13Match.comparison.byRule)}</tbody></table></div>
			<details><summary>New violations · regressions (${m13Match.comparison.newIssues.length})</summary>${accessibilityIssueList(m13Match.comparison.newIssues)}</details>
			<details><summary>Resolved violations · improvements (${m13Match.comparison.resolvedIssues.length})</summary>${accessibilityIssueList(m13Match.comparison.resolvedIssues)}</details>
			<details><summary>Persistent violations (${m13Match.comparison.persistentIssues.length})</summary>${accessibilityIssueList(m13Match.comparison.persistentIssues)}</details>
			<div class="explanation"><p>Each issue is identified by its accessibility rule ID and affected element target. Current issues absent from the previous run are new regressions; previous issues absent from the current run are resolved improvements; their intersection is persistent. Totals are also grouped independently by impact level and rule, so a stable overall count cannot hide one resolved issue being replaced by a different new issue.</p></div>
		</section>` : '';

	const m14MeanDirection = m14Match
		? m14Match.comparison.mean.delta > 0
			? 'The mean score increased, normally indicating better predicted image quality or aesthetics.'
			: m14Match.comparison.mean.delta < 0
				? 'The mean score decreased, normally indicating lower predicted image quality or aesthetics.'
				: 'The mean predicted image-quality score did not change.'
		: '';
	const m14SpreadDirection = m14Match
		? m14Match.comparison.standardDeviation.delta > 0
			? 'Predicted ratings became more spread out, indicating greater disagreement.'
			: m14Match.comparison.standardDeviation.delta < 0
				? 'Predicted ratings became less spread out, indicating greater agreement.'
				: 'The spread of predicted ratings did not change.'
		: '';
	const m14Section = m14Match ? `
		<section class="metric-section">
			<h2>M14 · NIMA</h2>
			<p class="previous-run">Compared with the completed run from ${new Date(m14Match.previousCreatedAt).toLocaleString()}</p>
			<div class="table-wrap"><table><thead><tr><th>Output</th><th>Previous</th><th>Current</th><th>Delta</th></tr></thead><tbody>
				${labComparisonRow('Mean score', m14Match.comparison.mean)}
				${labComparisonRow('Standard deviation', m14Match.comparison.standardDeviation)}
			</tbody></table></div>
			<p class="structural-summary">${m14MeanDirection}</p>
			<p class="variation-summary">${m14SpreadDirection}</p>
			<div class="explanation"><p>NIMA predicts a distribution of aesthetic image ratings. The mean and standard deviation are compared independently. A higher mean normally indicates better predicted image quality or aesthetics. Standard deviation measures disagreement or spread among predicted ratings and is not itself a quality score.</p></div>
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
		.regression-card { border-color: var(--vscode-testing-iconFailed); }
		.improvement-card { border-color: var(--vscode-testing-iconPassed); }
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
		.issue-list { margin: 12px 0 0; padding-left: 22px; }
		.issue-list li { margin-bottom: 12px; line-height: 1.45; }
		.issue-list code { color: var(--vscode-textPreformat-foreground); word-break: break-all; }
		.heatmap-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin-bottom: 18px; }
		figure { margin: 0; }
		figure img { display: block; width: 100%; max-height: 280px; object-fit: contain; border: 1px solid var(--vscode-widget-border); border-radius: 6px; }
		figcaption { margin-top: 7px; color: var(--vscode-descriptionForeground); text-align: center; }
		.explanation { padding: 18px; border-left: 4px solid var(--vscode-focusBorder); background: var(--vscode-textBlockQuote-background); line-height: 1.55; }
		.explanation p { margin: 0; }
		.comparison-warning { margin-bottom: 18px; padding: 14px 16px; border-left: 4px solid var(--vscode-editorWarning-foreground); background: var(--vscode-textBlockQuote-background); line-height: 1.5; }
		.comparison-warning p { margin: 0; }
	</style>
</head>
<body>
	<main>
		<h1>Assessment history comparison</h1>
		<p class="context"><span class="path">${escapeHtml(url)}</span><br>${dimensions ? `${dimensions.width} × ${dimensions.height} px · only completed runs with identical screenshot dimensions are compared` : 'Screenshot dimensions unavailable'}</p>
		${m1Section}
		${m2Section}
		${m3Section}
		${m4Section}
		${m4UnavailableSection}
		${m5Section}
		${m6Section}
		${m7Section}
		${m8Section}
		${m9Section}
		${m10Section}
		${m11Section}
		${m12Section}
		${m13Section}
		${m14Section}
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
						result.screenshotDimensions,
						result.html
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
								&& ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14'].includes(result.metric_id.split('_')[0])
						);
						if (hasComparableResult) {
							try {
								history = await fetchAssessmentHistory(wui_id);
							} catch { }
						}
						createResultsWebview(panel, resultData, localUrl, true);
						if (history) {
							await showHistoryComparison(resultData, history, localUrl, toMetricIds(request.assessments));
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
