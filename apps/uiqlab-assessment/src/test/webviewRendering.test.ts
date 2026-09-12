import * as assert from 'assert';
import {
	generateResultsHtml,
	renderCustomMetricLlmFeedback,
	renderProfileLlmFeedback,
} from '../resultsWebview';
import {
	renderProfileAssessmentOverview,
	renderAccessibilityIssueList,
	renderRequestedHistoryMetricSections,
	renderUnavailableHistoryMetricSection,
	requestedHistoryMetricIds,
} from '../historyRendering';
import { renderExplanationHtml } from '../webviewFormatting';
import {
	buildWebviewContentSecurityPolicy,
	safeHttpUrl,
	safeWebviewImageUrl,
} from '../webviewSecurity';

suite('Webview rendering', () => {
	test('renders common LLM Markdown without exposing raw formatting markers', () => {
		assert.strictEqual(
			renderExplanationHtml('** Visual Complexity and Content **\n\n- Dense navigation\n- `42` visible items'),
			'<p><strong>Visual Complexity and Content</strong></p><ul><li>Dense navigation</li><li><code>42</code> visible items</li></ul>'
		);
	});

	test('escapes HTML in LLM explanations before adding safe formatting', () => {
		const html = renderExplanationHtml('**Safe** <script>alert("x")</script>');
		assert.strictEqual(html, '<p><strong>Safe</strong> &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
	});

	test('renders structured profile LLM guidance as visual cards and escapes model content', () => {
		const html = renderProfileLlmFeedback({
			goalStatus: 'partial',
			goalTitle: 'Profile goals partially achieved',
			summary: 'Complexity improved, but <script>content</script> density did not.',
			changes: ['Edge density decreased.'],
			suggestions: [{
				title: 'Simplify the content block',
				action: 'Reduce secondary copy and retest the profile.',
				rationale: 'This may move text amount toward the selected direction.',
				files: ['src/pages/home.tsx'],
			}],
			sourceContextUsed: true,
			sourceFiles: ['src/pages/home.tsx'],
		});

		assert.match(html, /profile-ai-feedback status-partial/);
		assert.match(html, /<h2 id="profile-ai-title">AI-generated explanation<\/h2>/);
		assert.match(html, /profile-ai-goal">Profile goals partially achieved/);
		assert.match(html, /Suggested next steps/);
		assert.match(html, /Based on metrics and 1 source file/);
		assert.match(html, /src\/pages\/home\.tsx/);
		assert.doesNotMatch(html, /<script>/);
		assert.match(html, /&lt;script&gt;content&lt;\/script&gt;/);
	});

	test('labels profile guidance that uses metrics without shared source files', () => {
		const html = renderProfileLlmFeedback({
			goalStatus: 'achieved',
			goalTitle: 'Profile goal achieved',
			summary: 'The selected metrics moved in the requested direction.',
			changes: [],
			suggestions: [],
			sourceContextUsed: false,
			sourceFiles: [],
		});

		assert.match(html, /Based on metrics only/);
	});

	test('preserves the unsuccessful frozen-response presentation and complete suggestion cards', () => {
		const html = renderProfileLlmFeedback({
			goalStatus: 'not-achieved',
			goalTitle: 'Profile goals not achieved',
			summary: 'Prepared explanation.',
			changes: ['Evidence one.', 'Evidence two.', 'Evidence three.'],
			suggestions: Array.from({ length: 4 }, (_, index) => ({
				title: `Suggestion ${index + 1}`,
				action: `Action ${index + 1}`,
				rationale: `Reason ${index + 1}`,
				files: [],
			})),
			sourceContextUsed: false,
			sourceFiles: [],
		});

		assert.match(html, /profile-ai-feedback status-not-achieved/);
		assert.match(html, /<div class="profile-ai-icon" aria-hidden="true">×<\/div>/);
		assert.match(html, /<span class="profile-ai-status">Goal not achieved<\/span>/);
		assert.match(html, /profile-ai-goal">Profile goals not achieved/);
		assert.strictEqual((html.match(/class="change-chip"/g) ?? []).length, 3);
		assert.strictEqual((html.match(/class="suggestion-card"/g) ?? []).length, 4);
		assert.match(html, /Suggested next steps/);
		assert.match(html, /Based on metrics only/);
		assert.match(html, /Why: Reason 4/);
		assert.match(html, /AI-generated suggestions\. Validate changes against the profile goal and metric results below\./);
	});

	test('renders structured custom-metric analysis as evidence-to-action cards', () => {
		const html = renderCustomMetricLlmFeedback({
			summary: 'A potential user may experience a denser interface with more competing visual information.',
			analysisMode: 'comparison',
			materialChangeCount: 2,
			sourceContextUsed: true,
			sourceFiles: ['src/pages/dashboard.tsx'],
			findings: [{
				title: 'Corroborating visual-density measurements',
				metricIds: ['M9', 'M10'],
				observation: 'Edge density and feature congestion increased.',
				interpretation: 'The measurements indicate increased visual information density.',
				recommendation: 'Isolate one layout change and repeat both measurements. <script>alert(1)</script>',
				files: ['src/pages/dashboard.tsx'],
			}],
		});

		assert.match(html, /custom-ai-feedback/);
		assert.match(html, /AI-generated technical explanation/);
		assert.match(html, /Baseline comparison · 2 material changes/);
		assert.match(html, /Based on metrics and 1 source file/);
		assert.match(html, /potential user may experience a denser interface/);
		assert.match(html, /src\/pages\/dashboard\.tsx/);
		assert.match(html, /Measured evidence/);
		assert.match(html, /Technical interpretation/);
		assert.match(html, /Practical next step/);
		assert.match(html, /Practical action/);
		assert.match(html, /M9/);
		assert.doesNotMatch(html, /<script>/);
		assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	});

	test('shows an LLM request error instead of hiding the explanation section', () => {
		const html = generateResultsHtml(
			[{ metric_id: 'm9_edge_density', results: [0.2] }],
			'http://localhost:3000',
			true,
			undefined,
			'The LLM provider did not respond in time.',
		);

		assert.match(html, /AI explanation unavailable/);
		assert.match(html, /The LLM provider did not respond in time/);
	});

	test('renders the result page with the white assessment palette and clear hierarchy', () => {
		const html = generateResultsHtml(
			[{ metric_id: 'm9_edge_density', results: [0.2] }],
			'http://localhost:3000',
		);

		assert.match(html, /--navy: #12364f/);
		assert.match(html, /--accent: #0b746f/);
		assert.match(html, /--canvas: #f1f4f6/);
		assert.doesNotMatch(html, /body\.vscode-dark/);
		assert.match(html, /assessment-status complete/);
		assert.match(html, /class="target-link" href="http:\/\/localhost:3000"/);
		assert.match(html, /target="_blank" rel="noopener noreferrer"/);
		assert.match(html, /Raw metrics/);
		assert.match(html, /1 metric/);
		assert.doesNotMatch(html, /#667eea|#764ba2|linear-gradient\(/);
		assert.doesNotMatch(generateResultsHtml([], 'javascript:alert(1)'), /class="target-link"/);
	});

	test('renders explanation, profile evaluation, comparison, and collapsed raw metrics in one page', () => {
		const html = generateResultsHtml(
			[{ metric_id: 'm9_edge_density', results: [0.2] }],
			'http://localhost:3000',
			true,
			'Current visual density is lower than the baseline.',
			undefined,
			undefined,
			undefined,
			{
				profileOverviewHtml: '<section class="profile-overview">Profile evaluation</section>',
				comparisonSummaryHtml: '<span>Baseline link → Current link</span>',
				comparisonHtml: '<section class="metric-section">Comparison value</section>',
				imageUrls: [],
			},
		);

		const explanationIndex = html.indexOf('AI-generated explanation');
		const profileIndex = html.indexOf('Profile evaluation');
		const comparisonIndex = html.indexOf('Comparison details');
		const rawMetricsIndex = html.indexOf('<span class="raw-metrics-label">Raw metrics</span>');
		assert.ok(explanationIndex > -1);
		assert.ok(explanationIndex < profileIndex);
		assert.ok(profileIndex < comparisonIndex);
		assert.ok(comparisonIndex < rawMetricsIndex);
		assert.doesNotMatch(html, /<details class="raw-metrics" open>/);
		assert.match(html, /class="raw-metrics-toggle"[^>]*>▶<\/span>/);
		assert.match(html, /raw-metrics\[open\] \.raw-metrics-toggle \{ transform: rotate\(90deg\)/);
		assert.match(html, /--surface-llm: #fbf9f3/);
		assert.match(html, /--surface-comparison-block: #edf5f8/);
		assert.match(html, /\.profile-overview \{[^}]*background: var\(--surface-comparison-block\)/);
		assert.match(html, /<details class="comparison-block">/);
		assert.match(html, /Baseline link → Current link/);
		assert.doesNotMatch(html, /<details class="comparison-block" open>/);
	});

	test('keeps raw metrics expanded while an assessment is in progress', () => {
		const html = generateResultsHtml(
			[{ metric_id: 'm9_edge_density', results: [0.2] }],
			'http://localhost:3000',
			false,
		);
		assert.match(html, /<details class="raw-metrics" open>/);
	});

	test('escapes every backend-controlled result value before rendering it', () => {
		const html = generateResultsHtml([{
			metric_id: 'unknown</h3><script>alert(1)</script>',
			results: [
				'</div><script>alert(2)</script>',
				{ payload: '</pre><img src=x onerror=alert(3)>' },
				'https://images.example/result.png" onerror="alert(4)',
			],
		}], 'https://example.com/" onclick="alert(5)');

		assert.doesNotMatch(html, /<script>|<img src=x|onclick="alert|onerror="alert/);
		assert.match(html, /unknown&lt;\/h3&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
		assert.match(html, /&lt;\/div&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
		assert.match(html, /&lt;\/pre&gt;&lt;img src=x onerror=alert\(3\)&gt;/);
		assert.match(html, /&quot; onerror=&quot;alert\(4\)/);
	});

	test('renders only validated HTTP images and scopes CSP to their origins', () => {
		const html = generateResultsHtml([{
			metric_id: 'm9_edge_density',
			results: [
				'https://images.example/output.PNG?revision=2',
				'data:image/png;base64,unsafe',
				'javascript:alert(1).png',
				'https://user:password@images.example/private.png',
			],
		}], 'https://example.com');
		const nonceMatch = html.match(/<style nonce="([^"]+)">/);

		assert.ok(nonceMatch, 'Expected a nonce on the result webview style element');
		assert.match(html, /<meta http-equiv="Content-Security-Policy"/);
		assert.match(html, /default-src &#39;none&#39;/);
		assert.match(html, /script-src &#39;none&#39;/);
		assert.ok(html.includes(`style-src &#39;nonce-${nonceMatch[1]}&#39;`));
		assert.match(html, /img-src https:\/\/images\.example/);
		assert.match(html, /src="https:\/\/images\.example\/output\.PNG\?revision=2"/);
		assert.match(html, /class="image-zoom-link" href="https:\/\/images\.example\/output\.PNG\?revision=2" target="_blank"/);
		assert.match(html, /Open full size ↗/);
		assert.doesNotMatch(html, /<img[^>]+(?:data:|javascript:|user:password)/);
	});

	test('centralizes URL and CSP validation for results and history webviews', () => {
		assert.strictEqual(safeHttpUrl('http://localhost:3000'), 'http://localhost:3000');
		assert.strictEqual(safeHttpUrl('file:///tmp/result.png'), undefined);
		assert.strictEqual(safeHttpUrl('https://user:secret@example.com/result.png'), undefined);
		assert.strictEqual(safeWebviewImageUrl('https://example.com/result.webp?run=1'), 'https://example.com/result.webp?run=1');
		assert.strictEqual(safeWebviewImageUrl('https://example.com/result.svg'), undefined);

		const policy = buildWebviewContentSecurityPolicy('fixed-nonce', [
			'https://images.example/a.png',
			'https://images.example/b.jpg',
			'javascript:alert(1)',
		]);
		assert.match(policy, /default-src 'none'/);
		assert.match(policy, /script-src 'none'/);
		assert.match(policy, /style-src 'nonce-fixed-nonce'/);
		assert.match(policy, /img-src https:\/\/images\.example/);
		assert.doesNotMatch(policy, /javascript:/);
		assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
		assert.throws(
			() => buildWebviewContentSecurityPolicy("bad'; img-src *", []),
			/Invalid webview CSP nonce/,
		);
	});

	test('renders profile goal feedback as a visual status dashboard', () => {
		const html = renderProfileAssessmentOverview({
			status: 'achieved',
			title: 'Profile goal achieved',
			description: 'The goal was achieved.',
			outcomes: [{
				id: 'visual-clutter',
				direction: 'reduce-complexity',
				outcome: 'aligned',
				goalStatus: 'achieved',
				reason: 'All meaningful changes follow the chosen direction.',
				comparableMetrics: ['m9', 'm10'],
				meaningfulMetrics: ['m9', 'm10'],
				alignedMetrics: ['m9', 'm10'],
				opposedMetrics: [],
			}],
		});
		assert.match(html, /profile-overview status-achieved/);
		assert.match(html, /Profile goal achieved/);
		assert.match(html, /Visual complexity/);
		assert.doesNotMatch(html, /Visual clutter/);
		assert.match(html, /outcome-track/);
		assert.match(html, /2 aligned/);
		assert.match(html, /Chosen direction: <strong>reduce-complexity<\/strong>/);
		assert.match(html, /Metrics assessed/);
		assert.match(html, /<strong>M9<\/strong>Edge density/);
		assert.match(html, /<strong>M10<\/strong>Feature congestion/);
		assert.strictEqual((html.match(/Contributed to goal/g) ?? []).length, 2);
	});

	test('renders accessibility violations as compact structured issue cards', () => {
		const html = renderAccessibilityIssueList([{
			identity: 'skip-link::a[href="#calendar"]',
			ruleId: 'skip-link',
			target: 'a[href="#calendar"]',
			impact: 'moderate',
			description: 'The skip-link target should exist and be focusable',
		}]);
		assert.match(html, /class="issue-card"/);
		assert.match(html, /class="issue-rule">skip-link/);
		assert.match(html, /class="issue-impact">moderate/);
		assert.match(html, /Affected element/);
		assert.match(html, /a\[href=&quot;#calendar&quot;\]/);
		assert.match(html, /class="issue-description">The skip-link target should exist and be focusable/);
		assert.doesNotMatch(html, /<br>|<ul/);
	});

	test('keeps every requested metric in history comparison when only some have baselines', () => {
		const requested = requestedHistoryMetricIds(
			Array.from({ length: 14 }, (_, index) => `m${index + 1}`),
			[],
		);
		const html = renderRequestedHistoryMetricSections(
			requested,
			{
				m9: '<section class="metric-section">Comparable M9</section>',
				m10: '<section class="metric-section">Comparable M10</section>',
			},
			['m9_edge_density', 'm10_feature_congestion'],
		);
		assert.strictEqual(requested.length, 14);
		assert.strictEqual((html.match(/<section class="metric-section/g) ?? []).length, 14);
		assert.match(html, /M1 · PNG file size/);
		assert.match(html, /M14 · NIMA \(Neural IMage Assessment\)/);
		assert.match(html, /Comparable M9/);
		assert.match(html, /No baseline available/);
	});

	test('does not duplicate a current value in a no-baseline placeholder', () => {
		const html = renderUnavailableHistoryMetricSection('m8', false);
		assert.match(html, /M8 · Word count/);
		assert.match(html, /No baseline available/);
		assert.doesNotMatch(html, /Current value|current value|<span class="value">/);
	});

	test('distinguishes an unusable baseline from a missing baseline', () => {
		const html = renderUnavailableHistoryMetricSection('m6', true);
		assert.match(html, /Comparison unavailable/);
		assert.doesNotMatch(html, /No baseline available/);
	});
});
