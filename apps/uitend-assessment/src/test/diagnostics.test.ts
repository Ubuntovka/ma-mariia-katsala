import * as assert from 'assert';
import {
	configureDiagnosticSink,
	errorMessage,
	logDiagnostic,
} from '../diagnostics';

suite('Diagnostics', () => {
	teardown(() => configureDiagnosticSink(undefined));

	test('normalizes unknown errors without using loose types', () => {
		assert.strictEqual(errorMessage(new Error('request failed')), 'request failed');
		assert.strictEqual(errorMessage('plain failure'), 'plain failure');
		assert.strictEqual(errorMessage({ code: 'E_TEST' }), '{"code":"E_TEST"}');

		const circular: { self?: unknown } = {};
		circular.self = circular;
		assert.strictEqual(errorMessage(circular), '[object Object]');
	});

	test('routes non-fatal diagnostics through the configured sink', () => {
		const messages: string[] = [];
		configureDiagnosticSink((message) => messages.push(message));
		logDiagnostic('Polling failed', new Error('connection reset'));
		assert.deepStrictEqual(messages, ['[warning] Polling failed: connection reset']);
	});
});
