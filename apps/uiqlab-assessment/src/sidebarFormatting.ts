import type { AssessmentRunSummary } from './runAssessment';

export function formatAssessmentRunLabel(run: AssessmentRunSummary): string {
	const pagePath = run.assessedTarget || '/';
	const dateTime = new Date(run.createdAt).toLocaleString();
	if (!run.commitHash) { return `${pagePath} · ${dateTime}`; }
	const sourceState = `commit ${run.commitHash.slice(0, 8)}${run.gitDirty ? ' + changes' : ''}`;
	return `${pagePath} · ${dateTime} · ${sourceState}`;
}
