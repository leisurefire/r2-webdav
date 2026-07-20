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

		const callout = documentNode.createElement('aside');
		callout.className = `markdown-callout markdown-callout-${type}`;
		const title = documentNode.createElement('div');
		title.className = 'markdown-callout-title';
		title.textContent = match[3]?.trim() || calloutTitle(type);
		if (match[2]) {
			const details = documentNode.createElement('details');
			details.className = callout.className;
			details.open = match[2] === '+';
			const summary = documentNode.createElement('summary');
			summary.className = 'markdown-callout-title';
			summary.textContent = title.textContent;
			const content = documentNode.createElement('div');
			while (blockquote.firstChild) content.append(blockquote.firstChild);
			details.append(summary, content);
			blockquote.replaceWith(details);
			return;
		}
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

