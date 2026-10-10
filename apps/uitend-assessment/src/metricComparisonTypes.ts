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

