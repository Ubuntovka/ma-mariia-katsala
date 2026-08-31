import type { AssessmentHistory, AssessmentMetricResult } from './runAssessment';
import { logDiagnostic } from './diagnostics';
import {
	calculateM1SizeComparison,
	calculateM2Comparison,
	calculateM3Comparison,
	calculateM4Comparison,
	calculateM5Comparison,
	calculateM8Comparison,
	calculateM9Comparison,
	calculateM10Comparison,
	calculateM11Comparison,
	calculateM12Comparison,
	calculateM13Comparison,
	calculateM14Comparison,
	compareM6Segmentation,
	compareSaliencyHeatmaps,
	readM9Result,
	readM10Result,
	type M1SizeComparison,
	type M2Comparison,
	type M3Comparison,
	type M4Comparison,
	type M5Comparison,
	type M6Comparison,
	type M7Comparison,
	type M8Comparison,
	type M9Comparison,
	type M10Comparison,
	type M11Comparison,
	type M12Comparison,
	type M13Comparison,
	type M14Comparison,
} from './metricComparisons';
import { safeWebviewImageUrl } from './webviewSecurity';

export function findM1HistoryComparison(
	currentResults: AssessmentMetricResult[],
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

export function findM2HistoryComparison(
	currentResults: AssessmentMetricResult[],
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

export function findM3HistoryComparison(
	currentResults: AssessmentMetricResult[],
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

export function findM4HistoryComparison(
	currentResults: AssessmentMetricResult[],
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

export function findM5HistoryComparison(
	currentResults: AssessmentMetricResult[],
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

export function findM6HistoryComparison(
	currentResults: AssessmentMetricResult[],
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

export function findM11HistoryComparison(
	currentResults: AssessmentMetricResult[],
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

export function findM12HistoryComparison(
	currentResults: AssessmentMetricResult[],
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

export function findM13HistoryComparison(
	currentResults: AssessmentMetricResult[],
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

export function findM14HistoryComparison(
	currentResults: AssessmentMetricResult[],
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
		const urls = value.map(safeWebviewImageUrl).filter((item): item is string => Boolean(item));
		if (urls.length > 0) { return { heatmap: urls[0], overlay: urls[1] }; }
	}
	if (typeof value !== 'object' || value === null) { return undefined; }
	const fields = value as Record<string, unknown>;
	const heatmap = fields.heatmap ?? fields.saliencyHeatmap ?? fields.saliency_heatmap;
	const overlay = fields.overlay ?? fields.heatmapOverlay ?? fields.heatmap_overlay;
	const heatmapUrl = safeWebviewImageUrl(heatmap);
	return heatmapUrl
		? { heatmap: heatmapUrl, overlay: safeWebviewImageUrl(overlay) }
		: undefined;
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
	const safeUrl = safeWebviewImageUrl(url);
	if (!safeUrl) { throw new Error('Image URL must be an HTTP(S) raster image URL'); }
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10_000);
	try {
		const response = await fetch(safeUrl, { signal: controller.signal });
		if (!response.ok) { throw new Error(`HTTP ${response.status} fetching saliency heatmap`); }
		const content = Buffer.from(await response.arrayBuffer());
		if (content.length > 20 * 1024 * 1024) { throw new Error('Saliency heatmap exceeds 20 MiB'); }
		return content;
	} finally {
		clearTimeout(timeout);
	}
}

export async function findM7HistoryComparison(
	currentResults: AssessmentMetricResult[],
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
		} catch (error) {
			logDiagnostic('Could not compare M7 saliency images', error);
		}
	}
	return undefined;
}

export function findM8HistoryComparison(
	currentResults: AssessmentMetricResult[],
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

export async function findM9HistoryComparison(
	currentResults: AssessmentMetricResult[],
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
			} catch (error) {
				logDiagnostic('Could not compare M9 edge images; using scalar values only', error);
			}
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

export async function findM10HistoryComparison(
	currentResults: AssessmentMetricResult[],
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
			} catch (error) {
				logDiagnostic('Could not compare M10 congestion maps; using scalar values only', error);
			}
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
