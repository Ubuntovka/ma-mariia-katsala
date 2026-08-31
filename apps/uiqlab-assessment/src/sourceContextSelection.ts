import * as path from 'path';

export function isEligibleSourcePath(relativePath: string): boolean {
	const normalized = relativePath.split(path.sep).join('/').toLowerCase();
	if (!/\.(html?|css|scss|sass|less|js|jsx|ts|tsx|vue|svelte)$/.test(normalized)) { return false; }
	if (/(^|\/)(node_modules|dist|build|\.next|\.nuxt|coverage|\.git)(\/|$)/.test(normalized)) { return false; }
	return !/\.(min\.js|map)$/.test(normalized);
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
