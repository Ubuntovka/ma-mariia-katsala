import * as vscode from 'vscode';
import { configureDiagnosticSink } from './diagnostics';

export function initializeDiagnostics(context: vscode.ExtensionContext): void {
	const outputChannel = vscode.window.createOutputChannel('UITend Assessment', { log: true });
	configureDiagnosticSink((message) => outputChannel.appendLine(message));
	context.subscriptions.push(outputChannel, {
		dispose: () => configureDiagnosticSink(undefined),
	});
}
