import type { AssessmentRunSummary } from './runAssessment';

export const SIDEBAR_THEME_CSS = `
	:root {
		color-scheme: light dark;
		--uitend-sidebar-background: var(--vscode-sideBar-background, var(--vscode-editor-background, #ffffff));
		--uitend-surface-background: var(--vscode-input-background, #ffffff);
		--uitend-surface-border: var(--vscode-input-border, var(--vscode-widget-border, #d0d7de));
		--uitend-subtle-background: var(--vscode-textBlockQuote-background, var(--vscode-editorWidget-background, #f6f8fa));
		--uitend-hover-background: var(--vscode-list-hoverBackground, #f3f4f6);
	}
	body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; }
	body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }
`;

export function formatAssessmentRunLabel(run: AssessmentRunSummary): string {
	const pagePath = run.assessedTarget || '/';
	const dateTime = new Date(run.createdAt).toLocaleString();
	if (!run.commitHash) { return `${pagePath} · ${dateTime}`; }
	const sourceState = `commit ${run.commitHash.slice(0, 8)}${run.gitDirty ? ' + changes' : ''}`;
	return `${pagePath} · ${dateTime} · ${sourceState}`;
}
