export type DiagnosticSink = (message: string) => void;

let diagnosticSink: DiagnosticSink | undefined;

export function configureDiagnosticSink(sink: DiagnosticSink | undefined): void {
	diagnosticSink = sink;
}

export function errorMessage(error: unknown): string {
	if (error instanceof Error) { return error.message; }
	if (typeof error === 'string') { return error; }
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

export function logDiagnostic(context: string, error: unknown): void {
	diagnosticSink?.(`[warning] ${context}: ${errorMessage(error)}`);
}
