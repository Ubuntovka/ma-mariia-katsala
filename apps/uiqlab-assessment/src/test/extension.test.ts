import * as assert from 'assert';
import {
	ASSESSMENTS,
	DATA_SOURCE_OPTIONS,
	collectAssessmentRunRequest,
	formatAssessmentRunSummary,
	resolveCurrentCodeLocation,
	type QuickPickUi,
} from '../runAssessment';

suite('Run Assessment flow', () => {
	test('exposes all assessment names and data source options', () => {
		assert.strictEqual(ASSESSMENTS.length, 14);
		assert.deepStrictEqual(DATA_SOURCE_OPTIONS, ['Deployment URL', 'Take from my current code']);
	});

	test('collects deployment-url requests', async () => {
		const ui = createUiMock([
			['PNG size', 'accessibility'],
			'Deployment URL',
			'https://example.com',
		]);

		const request = await collectAssessmentRunRequest(ui, '/workspace');

		assert.deepStrictEqual(request, {
			assessments: ['PNG size', 'accessibility'],
			dataSource: {
				kind: 'deployment-url',
				deploymentUrl: 'https://example.com',
			},
		});
	});

	test('collects current-code requests', async () => {
		const ui = createUiMock([
			['whitespace'],
			'Take from my current code',
		]);

		const request = await collectAssessmentRunRequest(ui, '/workspace');

		assert.deepStrictEqual(request, {
			assessments: ['whitespace'],
			dataSource: {
				kind: 'current-code',
				location: '/workspace',
			},
		});
	});

	test('resolves current code location from the active editor first', () => {
		assert.strictEqual(
			resolveCurrentCodeLocation(
				{ activeTextEditor: { document: { uri: { fsPath: '/file.ts' } } } },
				{ workspaceFolders: [{ uri: { fsPath: '/workspace' } }] },
			),
			'/file.ts',
		);
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
