import { PNG } from 'pngjs';
import { finiteNumber } from './basicMetricComparisons';
import type {
	M6Comparison,
	M7Comparison,
	M9Comparison,
	M10Comparison,
	NormalizedUiedElement,
	SaliencyCenter,
} from './metricComparisonTypes';
import { safeWebviewImageUrl } from './webviewSecurity';

interface UiedPayload {
	segments: unknown[];
	dimensions?: { width: number; height: number };
}

function uiedShapeDimensions(value: unknown): { width: number; height: number } | undefined {
	if (!Array.isArray(value) || value.length < 2) { return undefined; }
	const height = finiteNumber(value[0]);
	const width = finiteNumber(value[1]);
	return width !== undefined && height !== undefined && width > 0 && height > 0
		? { width, height }
		: undefined;
}

function findUiedPayload(value: unknown): UiedPayload | undefined {
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
		return {
			segments: candidate.segments,
			dimensions: uiedShapeDimensions(candidate.img_shape),
		};
	}
	return undefined;
}

export function readUiedDimensions(value: unknown): { width: number; height: number } | undefined {
	return findUiedPayload(value)?.dimensions;
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
	dimensions?: { width: number; height: number }
): NormalizedUiedElement[] {
	const payload = findUiedPayload(value);
	const effectiveDimensions = payload?.dimensions ?? dimensions;
	if (!payload || !effectiveDimensions
		|| effectiveDimensions.width <= 0 || effectiveDimensions.height <= 0) {
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
			x: alreadyNormalized ? rawX : rawX / effectiveDimensions.width,
			y: alreadyNormalized ? rawY : rawY / effectiveDimensions.height,
			width: alreadyNormalized ? rawWidth : rawWidth / effectiveDimensions.width,
			height: alreadyNormalized ? rawHeight : rawHeight / effectiveDimensions.height,
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
	dimensions?: { width: number; height: number }
): M6Comparison | undefined {
	const currentDimensions = readUiedDimensions(currentValue) ?? dimensions;
	const previousDimensions = readUiedDimensions(previousValue) ?? dimensions;
	if (currentDimensions && previousDimensions
		&& (currentDimensions.width !== previousDimensions.width
			|| currentDimensions.height !== previousDimensions.height)) {
		return undefined;
	}
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

export function readM9Result(value: unknown): { density: number; edgeImageUrl?: string } | undefined {
	if (Array.isArray(value)) {
		const density = finiteNumber(value[0]);
		return density !== undefined && density >= 0 && density <= 1
			? { density, edgeImageUrl: safeWebviewImageUrl(value[1]) }
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
		? { density, edgeImageUrl: safeWebviewImageUrl(edgeImage) }
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

export function readM10Result(value: unknown): { congestion: number; mapUrl?: string } | undefined {
	if (Array.isArray(value)) {
		const congestion = finiteNumber(value[0]);
		return congestion !== undefined
			? { congestion, mapUrl: safeWebviewImageUrl(value[1]) }
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
		? { congestion, mapUrl: safeWebviewImageUrl(map) }
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
