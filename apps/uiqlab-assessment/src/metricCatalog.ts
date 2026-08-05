export interface MetricDefinition {
	id: string;
	name: string;
	description: string;
}

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
	{ id: 'm1', name: 'PNG file size', description: 'Measures the screenshot file size in bytes when saved as a 24-bit RGB PNG. It is used as an indicator of visual complexity and aesthetics.' },
	{ id: 'm2', name: 'JPEG file size and compression ratio', description: 'Converts the screenshot to 24-bit RGB JPEG at 80% quality, then reports its size in bytes and the PNG-to-JPEG compression ratio. Both values can indicate visual complexity and aesthetics.' },
	{ id: 'm3', name: 'Colorfulness', description: 'Quantifies perceived colorfulness with the Hasler–Süsstrunk method, which does not use hue directly. The result is a numeric colorfulness score with a range-based interpretation.' },
	{ id: 'm4', name: 'CIELab color average & standard deviation', description: 'Reports the mean and standard deviation of the screenshot’s CIELAB channels: L* for perceptual lightness, a* for red–green, and b* for blue–yellow.' },
	{ id: 'm5', name: 'White space proportion', description: 'Estimates the proportion and distribution of white space after UIED segmentation. The score ranges from 0 to 1; a higher value indicates more poorly distributed content.' },
	{ id: 'm6', name: 'UIED segmentation', description: 'Detects and segments interface elements with the UIED method. It produces a segmented image and a JSON description of the detected components.' },
	{ id: 'm7', name: 'UMSI (Unified Model of Saliency and Importance)', description: 'Predicts which parts of the interface are visually important using a deep-learning model. It produces an importance heatmap and an overlay on the original screenshot.' },
	{ id: 'm8', name: 'Word count', description: 'Counts all visible words on the page using static analysis of the DOM. This metric is available only for URL or HTML inputs.' },
	{ id: 'm9', name: 'Edge density', description: 'Measures the percentage of grayscale screenshot pixels detected as edges by the Canny detector. A higher percentage indicates more visual clutter; an edge image is also produced.' },
	{ id: 'm10', name: 'Feature congestion', description: 'Measures display clutter by modeling the saliency of visual features in CIELAB space. It produces a numeric congestion value and a visual congestion map.' },
	{ id: 'm11', name: 'Subband entropy', description: 'Measures display clutter through the efficiency of perceptual image encoding in CIELAB space. Higher entropy indicates greater visual clutter.' },
	{ id: 'm12', name: "Shannon's information entropy", description: 'Quantifies information and detail in the grayscale interface image. A higher value indicates more detail or noise and therefore more visual information.' },
	{ id: 'm13', name: 'Accessibility checks', description: 'Runs automated axe-core accessibility checks on a URL. It reports the number of violations and provides JSON details for every detected issue.' },
	{ id: 'm14', name: 'NIMA (Neural IMage Assessment)', description: 'Uses a convolutional neural network to predict human ratings of technical quality and aesthetics. It reports a mean score from 1 (lowest) to 10 (highest), plus standard deviation.' },
] as const;

function normalizeMetricName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function getMetricDefinition(nameOrId: string): MetricDefinition | undefined {
	const baseId = nameOrId.split('_')[0].toLowerCase();
	const normalizedName = normalizeMetricName(nameOrId);
	return METRIC_DEFINITIONS.find((metric) =>
		metric.id === baseId || normalizeMetricName(metric.name) === normalizedName
	);
}
