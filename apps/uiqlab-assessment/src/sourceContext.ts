import * as path from 'path';
import * as vscode from 'vscode';

export interface SourceContextFile {
	path: string;
	content: string;
}

const SOURCE_INCLUDE = '**/*.{html,htm,css,scss,sass,less,js,jsx,ts,tsx,vue,svelte}';
const SOURCE_EXCLUDE = '{**/node_modules/**,**/dist/**,**/build/**,**/.next/**,**/.nuxt/**,**/coverage/**,**/.git/**,**/*.min.js,**/*.map}';
const MAX_FILES = 10;
const MAX_FILE_BYTES = 24 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024;

export function isEligibleSourcePath(relativePath: string): boolean {
	const normalized = relativePath.split(path.sep).join('/').toLowerCase();
	if (!/\.(html?|css|scss|sass|less|js|jsx|ts|tsx|vue|svelte)$/.test(normalized)) { return false; }
	if (/(^|\/)(node_modules|dist|build|\.next|\.nuxt|coverage|\.git)(\/|$)/.test(normalized)) { return false; }
	return !/\.(min\.js|map)$/.test(normalized);
}

function normalizedRelativePath(workspaceRoot: string, filename: string): string {
	return path.relative(workspaceRoot, filename).split(path.sep).join('/');
}

function routeTokens(target: string): string[] {
	try {
		return new URL(target).pathname
			.split('/')
			.map((part) => part.toLowerCase().replace(/[^a-z0-9]/g, ''))
			.filter((part) => part.length > 1);
	} catch {
		return [];
	}
}

export function scoreSourceCandidate(relativePath: string, target: string, isActive: boolean): number {
	const normalized = relativePath.toLowerCase().replace(/[^a-z0-9/]/g, '');
	let score = isActive ? 1000 : 0;
	for (const token of routeTokens(target)) {
		if (normalized.includes(token)) { score += 100; }
	}
	if (/(^|\/)(page|index|app|layout)\.(tsx?|jsx?|vue|svelte|html?)$/.test(relativePath.toLowerCase())) { score += 30; }
	if (/(^|\/)(components?|pages?|routes?|app|src)\//.test(relativePath.toLowerCase())) { score += 10; }
	if (/\.(css|scss|sass|less)$/.test(relativePath.toLowerCase())) { score += 5; }
	return score;
}

export async function collectWorkspaceSourceContext(
	workspaceRoot: string,
	target: string,
): Promise<SourceContextFile[]> {
	if (!workspaceRoot) { return []; }
	const activeFilename = vscode.window.activeTextEditor?.document.uri.scheme === 'file'
		? vscode.window.activeTextEditor.document.uri.fsPath
		: undefined;
	const discovered = await vscode.workspace.findFiles(SOURCE_INCLUDE, SOURCE_EXCLUDE, 250);
	const candidates = new Map<string, vscode.Uri>();
	for (const uri of discovered) { candidates.set(uri.fsPath, uri); }
	if (activeFilename && activeFilename.startsWith(`${workspaceRoot}${path.sep}`)) {
		const activeUri = vscode.Uri.file(activeFilename);
		if (isEligibleSourcePath(normalizedRelativePath(workspaceRoot, activeFilename))) {
			candidates.set(activeFilename, activeUri);
		}
	}
	const ordered = [...candidates.values()].map((uri) => {
		const relativePath = normalizedRelativePath(workspaceRoot, uri.fsPath);
		return {
			uri,
			relativePath,
			score: scoreSourceCandidate(relativePath, target, uri.fsPath === activeFilename),
		};
	}).filter((candidate) => !candidate.relativePath.startsWith('../'))
		.sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath));

	const files: SourceContextFile[] = [];
	let totalBytes = 0;
	for (const candidate of ordered) {
		if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) { break; }
		try {
			const stat = await vscode.workspace.fs.stat(candidate.uri);
			if (stat.size <= 0 || stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_TOTAL_BYTES) { continue; }
			const bytes = await vscode.workspace.fs.readFile(candidate.uri);
			const content = Buffer.from(bytes).toString('utf8');
			if (content.includes('\0')) { continue; }
			files.push({ path: candidate.relativePath, content });
			totalBytes += bytes.byteLength;
		} catch { }
	}
	return files;
}
