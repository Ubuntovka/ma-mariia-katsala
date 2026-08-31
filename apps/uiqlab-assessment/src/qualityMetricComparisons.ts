import { finiteNumber } from './basicMetricComparisons';
import type {
	AccessibilityCountComparison,
	AccessibilityIssue,
	M8Comparison,
	M11Comparison,
	M12Comparison,
	M13Comparison,
	M14Comparison,
} from './metricComparisonTypes';

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

