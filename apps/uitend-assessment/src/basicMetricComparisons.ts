import type {
	M1SizeComparison,
	M2Comparison,
	M3Comparison,
	M4Comparison,
	M5Comparison,
	NumericChange,
} from './metricComparisonTypes';

export function finiteNumber(value: unknown): number | undefined {
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

export function readM4Values(value: unknown): LabValues | undefined {
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
