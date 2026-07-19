import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';

const markdown = new Marked(markedKatex({ throwOnError: false, nonStandard: true }));

const EXTERNAL_LINK_SCHEME = /^(?:https?:)?\/\//i;

export interface MarkdownHeading {
	id: string;
	level: number;
	text: string;
}

export function parseMarkdownInline(value: string): string {
	return markdown.parseInline(value, { async: false, breaks: false, gfm: true });
}

export function markdownLinkOpensNewTab(href: string): boolean {
	return EXTERNAL_LINK_SCHEME.test(href.trim());
}

function sanitizedDocument(parsed: string): Document {
	const sanitized = DOMPurify.sanitize(parsed, {
		ADD_ATTR: ['target'],
		ALLOW_DATA_ATTR: false,
	});
	const documentNode = new DOMParser().parseFromString(`<body>${sanitized}</body>`, 'text/html');
	documentNode.body.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
		if (markdownLinkOpensNewTab(anchor.getAttribute('href') ?? '')) {
			anchor.target = '_blank';
			anchor.rel = 'noopener noreferrer';
		} else {
			anchor.removeAttribute('target');
			anchor.removeAttribute('rel');
		}
	});
	return documentNode;
}

export function renderMarkdownInline(value: string): string {
	return sanitizedDocument(parseMarkdownInline(value)).body.innerHTML;
}

/** Render a link whose destination was resolved from a reference definition. */
export function renderResolvedMarkdownLink(label: string, href: string, title?: string): string {
	const placeholder = 'https://markdown-reference.invalid/';
	const labelDocument = sanitizedDocument(parseMarkdownInline(`[${label}](${placeholder})`));
	const parsed = labelDocument.body.querySelector<HTMLAnchorElement>('a[href]');
	if (!parsed) return sanitizedDocument(parseMarkdownInline(label)).body.innerHTML;
	const anchor = labelDocument.createElement('a');
	anchor.innerHTML = parsed.innerHTML;
	anchor.setAttribute('href', href);
	if (title !== undefined) anchor.setAttribute('title', title);
	return sanitizedDocument(anchor.outerHTML).body.innerHTML;
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
