import { randomBytes } from 'crypto';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const WEBVIEW_IMAGE_PATH_PATTERN = /\.(?:png|jpe?g|webp)$/i;
const CSP_NONCE_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Return a validated HTTP(S) URL without changing its display form. */
export function safeHttpUrl(value: unknown): string | undefined {
	if (typeof value !== 'string') { return undefined; }
	const candidate = value.trim();
	if (!candidate || CONTROL_CHARACTER_PATTERN.test(candidate)) { return undefined; }
	try {
		const parsed = new URL(candidate);
		if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
			|| parsed.username || parsed.password) {
			return undefined;
		}
		return candidate;
	} catch {
		return undefined;
	}
}

/** Images rendered by assessment webviews must be remote raster files over HTTP(S). */
export function safeWebviewImageUrl(value: unknown): string | undefined {
	const safeUrl = safeHttpUrl(value);
	if (!safeUrl) { return undefined; }
	return WEBVIEW_IMAGE_PATH_PATTERN.test(new URL(safeUrl).pathname) ? safeUrl : undefined;
}

export function createWebviewNonce(): string {
	return randomBytes(18).toString('base64');
}

export function buildWebviewContentSecurityPolicy(
	nonce: string,
	imageUrls: Iterable<string> = [],
): string {
	if (!CSP_NONCE_PATTERN.test(nonce)) {
		throw new Error('Invalid webview CSP nonce');
	}
	const imageOrigins = new Set<string>();
	for (const value of imageUrls) {
		const safeUrl = safeWebviewImageUrl(value);
		if (safeUrl) { imageOrigins.add(new URL(safeUrl).origin); }
	}
	const imageSource = imageOrigins.size > 0 ? [...imageOrigins].join(' ') : "'none'";
	return [
		"default-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		"script-src 'none'",
		"object-src 'none'",
		"frame-src 'none'",
		`style-src 'nonce-${nonce}'`,
		`img-src ${imageSource}`,
	].join('; ');
}
