import * as assert from 'assert';
import {
	ASSESSMENTS,
	DATA_SOURCE_OPTIONS,
	collectAssessmentRunRequest,
	formatAssessmentRunSummary,
	type QuickPickUi,
} from '../runAssessment';
import { getMetricDefinition, METRIC_DEFINITIONS } from '../metricCatalog';
import { calculateNumericDifference, formatNumericDifference } from '../extension';

suite('Run Assessment flow', () => {
	test('exposes all assessment names and data source options', () => {
		assert.strictEqual(ASSESSMENTS.length, 14);
		assert.deepStrictEqual(DATA_SOURCE_OPTIONS, ['Deployment URL', 'Local URL']);
	});

	test('provides an explanation for every assessment metric', () => {
		assert.strictEqual(METRIC_DEFINITIONS.length, ASSESSMENTS.length);
		for (const assessment of ASSESSMENTS) {
			const metric = getMetricDefinition(assessment);
			assert.ok(metric, `Missing metric definition for ${assessment}`);
			assert.ok(metric.description.length > 40, `Description for ${assessment} is too short`);
			assert.strictEqual(getMetricDefinition(metric.id), metric);
		}
	});

	test('collects deployment-url requests', async () => {
		const ui = createUiMock([
			['PNG file size', 'Accessibility checks'],
			'Deployment URL',
			'https://example.com',
		]);

		const request = await collectAssessmentRunRequest(ui);

		assert.deepStrictEqual(request, {
			assessments: ['PNG file size', 'Accessibility checks'],
			dataSource: {
				kind: 'deployment-url',
				deploymentUrl: 'https://example.com',
			},
		});
	});

	test('collects local-url requests', async () => {
		const ui = createUiMock([
			['White space proportion'],
			'Local URL',
			'http://localhost:3000',
		]);

		const request = await collectAssessmentRunRequest(ui);

		assert.deepStrictEqual(request, {
			assessments: ['White space proportion'],
			dataSource: {
				kind: 'local-url',
				localUrl: 'http://localhost:3000',
			},
		});
	});

	test('formats a readable summary', () => {
		assert.strictEqual(
			formatAssessmentRunSummary({
				assessments: ['NIMA', 'accessibility'],
				dataSource: {
					kind: 'deployment-url',
					deploymentUrl: 'https://example.com',
				},
			}),
			'Selected assessments: NIMA, accessibility. Deployment URL: https://example.com.',
		);
	});

	test('calculates differences only for numerical results', () => {
		assert.strictEqual(calculateNumericDifference(12.5, 10), 2.5);
		assert.strictEqual(calculateNumericDifference('8', '10.5'), -2.5);
		assert.strictEqual(calculateNumericDifference('not numeric', 10), undefined);
		assert.strictEqual(calculateNumericDifference({ score: 8 }, { score: 7 }), undefined);
	});

	test('formats numerical differences with a sign', () => {
		assert.strictEqual(formatNumericDifference(2.12345678), '+2.12346');
		assert.strictEqual(formatNumericDifference(-1.5), '-1.5');
		assert.strictEqual(formatNumericDifference(0), '0');
	});
});

function createUiMock(answers: Array<string | string[] | undefined>): QuickPickUi {
	return {
		async showQuickPick(items, options) {
			const answer = answers.shift();

			if (Array.isArray(answer)) {
				for (const item of answer) {
					assert.ok(items.includes(item));
				}
			}

			assert.ok(options.title.length > 0);
			return answer;
		},
		async showInputBox() {
			const answer = answers.shift();
			return typeof answer === 'string' ? answer : undefined;
		},
		async showErrorMessage() {
			return undefined;
		},
	};
}
