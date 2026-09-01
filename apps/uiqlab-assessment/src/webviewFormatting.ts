import { escapeHtml, safeHttpUrl } from './webviewSecurity';

export function renderTargetLink(value: string): string {
	const escapedValue = escapeHtml(value);
	const safeUrl = safeHttpUrl(value);
	if (safeUrl) {
		return `<a class="target-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" title="Open target in browser">${escapedValue}</a>`;
	}
	return `<span>${escapedValue}</span>`;
}

function renderExplanationInline(value: string): string {
	return escapeHtml(value)
		// Some providers put spaces just inside emphasis markers. Accept that
		// common variation as well as standard Markdown.
		.replace(/\*\*\s*(.+?)\s*\*\*/g, '<strong>$1</strong>')
		.replace(/__\s*(.+?)\s*__/g, '<strong>$1</strong>')
		.replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** Render the small Markdown subset commonly returned by explanation models. */
export function renderExplanationHtml(value: string): string {
	const output: string[] = [];
	let paragraph: string[] = [];
	let listType: 'ul' | 'ol' | undefined;
	let listItems: string[] = [];

	const flushParagraph = () => {
		if (paragraph.length > 0) {
			output.push(`<p>${paragraph.map(renderExplanationInline).join('<br>')}</p>`);
			paragraph = [];
		}
	};
	const flushList = () => {
		if (listType && listItems.length > 0) {
			output.push(`<${listType}>${listItems.map((item) => `<li>${renderExplanationInline(item)}</li>`).join('')}</${listType}>`);
		}
		listType = undefined;
		listItems = [];
	};

	for (const line of value.replace(/\r\n?/g, '\n').split('\n')) {
		if (!line.trim()) {
			flushParagraph();
			flushList();
			continue;
		}

		const heading = line.match(/^#{1,3}\s+(.+)$/);
		if (heading) {
			flushParagraph();
			flushList();
			output.push(`<h3>${renderExplanationInline(heading[1])}</h3>`);
			continue;
		}

		const unorderedItem = line.match(/^\s*[-*]\s+(.+)$/);
		const orderedItem = line.match(/^\s*\d+[.)]\s+(.+)$/);
		const nextListType = unorderedItem ? 'ul' : orderedItem ? 'ol' : undefined;
		const item = unorderedItem?.[1] ?? orderedItem?.[1];
		if (nextListType && item) {
			flushParagraph();
			if (listType && listType !== nextListType) { flushList(); }
			listType = nextListType;
			listItems.push(item);
			continue;
		}

		flushList();
		paragraph.push(line);
	}

	flushParagraph();
	flushList();
	return output.join('');
}
