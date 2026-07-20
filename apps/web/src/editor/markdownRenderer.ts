import DOMPurify from 'dompurify';
import { Marked, type Token } from 'marked';
import markedKatex from 'marked-katex-extension';
import { parseFrontmatterBlock, type FrontmatterEntry } from './markdownStructure';

type ObsidianInlineToken = Token & {
	type: 'obsidian-highlight' | 'obsidian-comment' | 'obsidian-wikilink';
	text: string;
	raw: string;
	embed?: boolean;
	target?: string;
	alias?: string;
	tokens?: Token[];
};

const markdown = new Marked(markedKatex({ throwOnError: false, nonStandard: true }));
markdown.use({
	extensions: [
		{
			name: 'obsidian-highlight',
			level: 'inline',
			start(source) {
				const position = source.indexOf('==');
				return position < 0 ? undefined : position;
			},
			tokenizer(source) {
				const match = /^==(?=\S)([\s\S]*?\S)==(?!=)/.exec(source);
				if (!match) return undefined;
				return {
					type: 'obsidian-highlight',
					raw: match[0],
					text: match[1],
					tokens: this.lexer.inlineTokens(match[1]),
				} as ObsidianInlineToken;
			},
			renderer(token) {
				const value = token as ObsidianInlineToken;
				return `<mark>${this.parser.parseInline(value.tokens ?? [])}</mark>`;
			},
			childTokens: ['tokens'],
		},
		{
			name: 'obsidian-comment',
			level: 'inline',
			start(source) {
				const position = source.indexOf('%%');
				return position < 0 ? undefined : position;
			},
			tokenizer(source) {
				const match = /^%%([\s\S]*?)%%/.exec(source);
				if (!match) return undefined;
				return { type: 'obsidian-comment', raw: match[0], text: match[1] } as ObsidianInlineToken;
			},
			renderer() {
				return '';
			},
		},
		{
			name: 'obsidian-wikilink',
			level: 'inline',
			start(source) {
				const embed = source.indexOf('![[');
				const link = source.indexOf('[[');
				if (embed < 0) return link < 0 ? undefined : link;
				if (link < 0) return embed;
				return Math.min(embed, link);
			},
			tokenizer(source) {
				const match = /^(!?)\[\[([^\]|\r\n]+?)(?:\|([^\]\r\n]+))?\]\]/.exec(source);
				if (!match) return undefined;
				const target = match[2].trim();
				const alias = match[3]?.trim();
				if (!target) return undefined;
				return {
					type: 'obsidian-wikilink',
					raw: match[0],
					text: alias || target,
					embed: match[1] === '!',
					target,
					alias,
				} as ObsidianInlineToken;
			},
			renderer(token) {
				const value = token as ObsidianInlineToken;
				const label = escapeHtml(value.alias || value.target || value.text);
				if (value.embed) {
					return `<span class="markdown-embed" data-embed="${escapeAttribute(value.target || '')}">${label}</span>`;
				}
				return `<a class="markdown-wikilink" href="#${escapeAttribute(value.target || '')}">${label}</a>`;
			},
		},
	],
});

const EXTERNAL_LINK_SCHEME = /^(?:https?:)?\/\//i;

export interface MarkdownHeading {
	id: string;
	level: number;
	text: string;
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function parseMarkdownInline(value: string): string {
	return markdown.parseInline(value, { async: false, breaks: false, gfm: true });
}

export function markdownLinkOpensNewTab(href: string): boolean {
	return EXTERNAL_LINK_SCHEME.test(href.trim());
}

function calloutTitle(type: string): string {
	return type.replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** Minimal stroke icons for Obsidian callout types (kept inline for preview HTML). */
const CALLOUT_ICONS: Record<string, string> = {
	note: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
	abstract: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
	info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
	todo: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m9 12 2 2 4-4"/>',
	tip: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12c.6.6 1 1.5 1 2.4V18h6v-1.6c0-.9.4-1.8 1-2.4A7 7 0 0 0 12 2z"/>',
	success: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
	question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
	warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
	failure: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
	danger: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
	bug: '<rect x="8" y="6" width="8" height="12" rx="2"/><path d="m19 9-3 2"/><path d="m5 9 3 2"/><path d="m19 15-3-2"/><path d="m5 15 3-2"/><path d="M12 6V3"/>',
	example: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
	quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/>',
};

const CALLOUT_ICON_ALIASES: Record<string, string> = {
	summary: 'abstract',
	tldr: 'abstract',
	hint: 'tip',
	important: 'tip',
	check: 'success',
	done: 'success',
	help: 'question',
	faq: 'question',
	caution: 'warning',
	attention: 'warning',
	fail: 'failure',
	missing: 'failure',
	error: 'danger',
	cite: 'quote',
};


function appendCalloutTitle(target: HTMLElement, type: string, label: string): void {
	const icon = document.createElement('span');
	icon.className = 'markdown-callout-icon';
	icon.setAttribute('aria-hidden', 'true');
	icon.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${(CALLOUT_ICONS[CALLOUT_ICON_ALIASES[type] ?? type] ?? CALLOUT_ICONS.note)}</svg>`;
	const text = document.createElement('span');
	text.textContent = label;
	target.append(icon, text);
}

function appendFrontmatter(documentNode: Document, entries: FrontmatterEntry[]): void {
	if (entries.length === 0) return;
	const properties = documentNode.createElement('dl');
	properties.className = 'markdown-frontmatter';
	for (const entry of entries) {
		const row = documentNode.createElement('div');
		const key = documentNode.createElement('dt');
		key.textContent = entry.key;
		const value = documentNode.createElement('dd');
		value.textContent = entry.value;
		row.append(key, value);
		properties.append(row);
	}
	documentNode.body.prepend(properties);
}

function decorateCallouts(documentNode: Document): void {
	documentNode.body.querySelectorAll('blockquote').forEach((blockquote) => {
		const paragraph = blockquote.firstElementChild;
		const firstText = paragraph?.firstChild;
		if (!paragraph || paragraph.tagName !== 'P' || firstText?.nodeType !== 3) return;
		const match = /^\s*\[!([a-z0-9_-]+)\]([+-])?(?:[ \t]+([^\r\n]*))?/i.exec(firstText.textContent ?? '');
		if (!match) return;
		const type = match[1].toLowerCase();
		firstText.textContent = (firstText.textContent ?? '').slice(match[0].length);
		if (!firstText.textContent) firstText.remove();
		if (paragraph.firstChild?.nodeName === 'BR') paragraph.firstChild.remove();
		if (!paragraph.textContent?.trim() && paragraph.childElementCount === 0) paragraph.remove();

		const label = match[3]?.trim() || calloutTitle(type);
		const callout = documentNode.createElement('aside');
		callout.className = `markdown-callout markdown-callout-${type}`;
		callout.dataset.callout = type;
		if (match[2]) {
			const details = documentNode.createElement('details');
			details.className = callout.className;
			details.dataset.callout = type;
			details.open = match[2] === '+';
			const summary = documentNode.createElement('summary');
			summary.className = 'markdown-callout-title';
			appendCalloutTitle(summary, type, label);
			const content = documentNode.createElement('div');
			while (blockquote.firstChild) content.append(blockquote.firstChild);
			details.append(summary, content);
			blockquote.replaceWith(details);
			return;
		}
		const title = documentNode.createElement('div');
		title.className = 'markdown-callout-title';
		appendCalloutTitle(title, type, label);
		callout.append(title);
		while (blockquote.firstChild) callout.append(blockquote.firstChild);
		blockquote.replaceWith(callout);
	});
}

function sanitizedDocument(parsed: string): Document {
	const sanitized = DOMPurify.sanitize(parsed, {
		ADD_ATTR: ['target', 'data-embed'],
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
	decorateCallouts(documentNode);
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
	const normalized = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
	const frontmatter = parseFrontmatterBlock(normalized);
	const body = frontmatter ? normalized.slice(frontmatter.to) : normalized;
	const parsed = markdown.parse(body, { async: false, breaks: true, gfm: true });
	const documentNode = sanitizedDocument(parsed);
	if (frontmatter) appendFrontmatter(documentNode, frontmatter.entries);
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

