import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';

const markdown = new Marked(markedKatex({ throwOnError: false, nonStandard: true }));

export interface MarkdownHeading {
	id: string;
	level: number;
	text: string;
}

export function parseMarkdownInline(value: string): string {
	return markdown.parseInline(value, { async: false, breaks: false, gfm: true });
}

function sanitizedDocument(parsed: string): Document {
	const sanitized = DOMPurify.sanitize(parsed, {
		ADD_ATTR: ['target'],
		ALLOW_DATA_ATTR: false,
	});
	const documentNode = new DOMParser().parseFromString(`<body>${sanitized}</body>`, 'text/html');
	documentNode.body.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
		anchor.target = '_blank';
		anchor.rel = 'noopener noreferrer';
	});
	return documentNode;
}

export function renderMarkdownInline(value: string): string {
	return sanitizedDocument(parseMarkdownInline(value)).body.innerHTML;
}

export function renderMarkdownDocument(value: string): { html: string; headings: MarkdownHeading[] } {
	const parsed = markdown.parse(value, { async: false, breaks: true, gfm: true });
	const documentNode = sanitizedDocument(parsed);
	const headings: MarkdownHeading[] = [];
	const usedIds = new Set<string>();
	documentNode.body.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6').forEach((heading) => {
		const level = Number(heading.tagName.slice(1));
		const base =
			heading.textContent
				?.trim()
				.toLowerCase()
				.replace(/[^\p{L}\p{N}]+/gu, '-')
				.replace(/^-|-$/g, '') || 'section';
		let id = base;
		let suffix = 2;
		while (usedIds.has(id)) id = `${base}-${suffix++}`;
		usedIds.add(id);
		heading.id = id;
		headings.push({ id, level, text: heading.textContent?.trim() ?? id });
	});
	return { html: documentNode.body.innerHTML, headings };
}

export function renderMarkdown(value: string): string {
	return renderMarkdownDocument(value).html;
}
