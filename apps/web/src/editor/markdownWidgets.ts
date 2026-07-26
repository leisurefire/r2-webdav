import { EditorView, WidgetType } from '@codemirror/view';
import katex from 'katex';
import { taskMarkerChange } from './markdownEditing';
import { slugifyMarkdownHeading } from './markdownHeadings';
import { markdownHeadingPosition } from './markdownLiveHeadings';
import { renderMarkdown, renderMarkdownInline, renderResolvedMarkdownLink } from './markdownRenderer';
import {
	parseFrontmatterBlock,
	parseTableBlock,
	tableCellSourceRanges,
	type StructuralBlock,
	type WikiLinkRange,
} from './markdownStructure';

export type ResolvedLink = { href: string; title?: string; label: string };

export function parsedWidgetContent(source: string, widgetName: string): { from: number; to: number } | null {
	if (widgetName === 'LinkWidget') {
		if (source.startsWith('[')) {
			const labelEnd = source.indexOf('](');
			if (labelEnd > 1) return { from: 1, to: labelEnd };
		}
		if (source.startsWith('<') && source.endsWith('>')) return { from: 1, to: source.length - 1 };
		return { from: 0, to: source.length };
	}
	if (widgetName === 'InlineMathWidget') {
		const delimiter = source.startsWith('$$') ? 2 : 1;
		return source.length >= delimiter * 2 ? { from: delimiter, to: source.length - delimiter } : null;
	}
	if (widgetName === 'InlineMarkdownWidget' && source.startsWith('==') && source.endsWith('==')) {
		return { from: 2, to: source.length - 2 };
	}
	return null;
}

type SourcePointerMode = 'text' | 'geometry';

function bindSourceNavigation(
	node: HTMLElement,
	from: number,
	source: string,
	mode: SourcePointerMode = 'text',
	interior = false,
): void {
	node.classList.add('cm-live-source-target');
	node.dataset.sourceFrom = String(from);
	node.dataset.sourceTo = String(from + source.length);
	node.dataset.sourceMode = mode;
	if (interior) node.dataset.sourceInterior = 'true';
}

abstract class SourceWidget extends WidgetType {
	ignoreEvent(event: Event): boolean {
		if (!(event instanceof MouseEvent) || event.type !== 'mousedown' || event.button !== 0) return true;
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('button,input,textarea,select,summary')) return true;
		if (target?.closest('a') && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return true;
		return false;
	}
}

export class CheckboxWidget extends WidgetType {
	constructor(
		private readonly checked: boolean,
		private readonly from: number,
		private readonly to: number,
	) {
		super();
	}
	eq(other: CheckboxWidget): boolean {
		return this.checked === other.checked && this.from === other.from && this.to === other.to;
	}
	toDOM(view: EditorView): HTMLElement {
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = this.checked;
		input.className = 'cm-task-checkbox';
		input.addEventListener('change', () =>
			view.dispatch({ changes: taskMarkerChange(this.from, this.to, input.checked) }),
		);
		return input;
	}
}

export class InlineMathWidget extends SourceWidget {
	constructor(
		private readonly expression: string,
		private readonly from: number,
		private readonly to: number,
	) {
		super();
	}
	eq(other: InlineMathWidget): boolean {
		return this.expression === other.expression && this.from === other.from && this.to === other.to;
	}
	toDOM(view: EditorView): HTMLElement {
		const node = document.createElement('span');
		node.className = 'cm-live-inline-block cm-live-inline-math';
		try {
			katex.render(this.expression, node, { displayMode: false, throwOnError: false });
		} catch {
			node.textContent = `$${this.expression}$`;
		}
		bindSourceNavigation(node, this.from + 1, this.expression, 'geometry');
		return node;
	}
}

export class InlineMarkdownWidget extends SourceWidget {
	constructor(
		private readonly source: string,
		private readonly from: number,
		private readonly to: number,
		private readonly kind = 'format',
	) {
		super();
	}
	eq(other: InlineMarkdownWidget): boolean {
		return this.source === other.source && this.from === other.from && this.to === other.to && this.kind === other.kind;
	}
	toDOM(view: EditorView): HTMLElement {
		const node = document.createElement('span');
		node.className = `cm-live-inline-block cm-live-inline-${this.kind}`;
		node.innerHTML = renderMarkdownInline(this.source);
		bindSourceNavigation(node, this.from, this.source);
		return node;
	}
}

export class LinkWidget extends SourceWidget {
	constructor(
		private readonly source: string,
		private readonly from: number,
		private readonly to: number,
		private readonly resolved?: ResolvedLink,
	) {
		super();
	}
	eq(other: LinkWidget): boolean {
		return (
			this.source === other.source &&
			this.from === other.from &&
			this.to === other.to &&
			this.resolved?.href === other.resolved?.href &&
			this.resolved?.title === other.resolved?.title &&
			this.resolved?.label === other.resolved?.label
		);
	}
	toDOM(view: EditorView): HTMLElement {
		const container = document.createElement('span');
		container.innerHTML = this.resolved
			? renderResolvedMarkdownLink(this.resolved.label, this.resolved.href, this.resolved.title)
			: renderMarkdownInline(this.source);
		const anchor = container.querySelector<HTMLAnchorElement>('a[href]');
		if (!anchor) {
			container.className = 'cm-live-link-disabled';
			container.replaceChildren(document.createTextNode(container.textContent || this.source));
			bindSourceNavigation(container, this.from, this.source, 'text');
			return container;
		}
		anchor.classList.add('cm-live-link');
		anchor.classList.add('cm-live-inline-block');
		const content = parsedWidgetContent(this.source, 'LinkWidget');
		const contentFrom = content?.from ?? 0;
		const contentTo = content?.to ?? this.source.length;
		bindSourceNavigation(anchor, this.from + contentFrom, this.source.slice(contentFrom, contentTo), 'text');
		// Keep the click from becoming a source-edit cursor move: without this the
		// widget is swapped back to raw Markdown on mousedown and no click fires.
		anchor.addEventListener('mousedown', (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
		});
		anchor.addEventListener('click', (event) => {
			const href = anchor.getAttribute('href') ?? '';
			if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
			event.preventDefault();
			event.stopPropagation();
			if (href.startsWith('#')) {
				const position = markdownHeadingPosition(view, href);
				if (position !== null) view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'start' }) });
				return;
			}
			if (/^[a-z][a-z0-9+.-]*:/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
		});
		return anchor;
	}
}

export class HorizontalRuleWidget extends SourceWidget {
	constructor(
		private readonly from: number,
		private readonly to: number,
	) {
		super();
	}
	eq(other: HorizontalRuleWidget): boolean {
		return this.from === other.from && this.to === other.to;
	}
	toDOM(view: EditorView): HTMLElement {
		const rule = document.createElement('hr');
		rule.className = 'cm-live-hr';
		bindSourceNavigation(rule, this.from, view.state.sliceDoc(this.from, this.to), 'geometry');
		return rule;
	}
}

export class ImageWidget extends SourceWidget {
	constructor(
		private readonly source: string,
		private readonly from: number,
		private readonly to: number,
	) {
		super();
	}
	eq(other: ImageWidget): boolean {
		return this.source === other.source && this.from === other.from && this.to === other.to;
	}
	toDOM(view: EditorView): HTMLElement {
		const container = document.createElement('span');
		container.innerHTML = renderMarkdownInline(this.source);
		const image = container.querySelector('img');
		if (!image) {
			const fallback = document.createElement('span');
			fallback.textContent = this.source;
			bindSourceNavigation(fallback, this.from, this.source, 'geometry');
			return fallback;
		}
		image.className = 'cm-live-image';
		image.classList.add('cm-live-inline-block');
		image.loading = 'lazy';
		bindSourceNavigation(image, this.from, this.source, 'geometry', true);
		return image;
	}
}

export class ListMarkerWidget extends SourceWidget {
	constructor(
		private readonly marker: string,
		private readonly from: number,
		private readonly to: number,
	) {
		super();
	}
	eq(other: ListMarkerWidget): boolean {
		return this.marker === other.marker && this.from === other.from && this.to === other.to;
	}
	toDOM(view: EditorView): HTMLElement {
		const node = document.createElement('span');
		node.className = 'cm-live-list-marker';
		node.textContent = /^\d/.test(this.marker) ? this.marker : '•';
		bindSourceNavigation(node, this.from, this.marker, 'geometry');
		return node;
	}
}

export class BlockWidget extends SourceWidget {
	constructor(
		private readonly block: StructuralBlock,
		private readonly source: string,
	) {
		super();
	}
	eq(other: BlockWidget): boolean {
		return (
			this.block.kind === other.block.kind &&
			this.block.from === other.block.from &&
			this.block.to === other.block.to &&
			this.source === other.source
		);
	}
	toDOM(view: EditorView): HTMLElement {
		if (this.block.kind === 'table') return this.tableDOM(view);
		const wrapper = document.createElement(this.block.kind === 'details' ? 'details' : 'div');
		wrapper.className = `cm-live-block cm-live-${this.block.kind}`;
		if (this.block.kind === 'fence') {
			const lines = this.source.split('\n');
			const label = /^\s*(?:`{3,}|~{3,})(.*)$/.exec(lines[0])?.[1].trim() ?? '';
			const codeText = lines.slice(1, -1).join('\n');
			const chrome = document.createElement('div');
			chrome.className = 'cm-live-code-chrome';
			const lang = document.createElement('span');
			lang.className = 'cm-live-code-lang';
			lang.textContent = label || 'code';
			const copy = document.createElement('button');
			const zh = navigator.language.toLowerCase().startsWith('zh');
			const copyLabel = zh ? '复制' : 'Copy';
			const copiedLabel = zh ? '已复制' : 'Copied';
			const failedLabel = zh ? '失败' : 'Failed';
			copy.type = 'button';
			copy.className = 'cm-live-code-copy';
			copy.title = zh ? '复制代码' : 'Copy code';
			copy.setAttribute('aria-label', copy.title);
			copy.textContent = copyLabel;
			copy.addEventListener('mousedown', (event) => {
				// Keep the editor selection/source mapping from stealing the click.
				event.preventDefault();
				event.stopPropagation();
			});
			copy.addEventListener('click', async (event) => {
				event.preventDefault();
				event.stopPropagation();
				try {
					await navigator.clipboard.writeText(codeText);
					copy.textContent = copiedLabel;
					copy.classList.add('copied');
				} catch {
					copy.textContent = failedLabel;
				}
				window.setTimeout(() => {
					copy.textContent = copyLabel;
					copy.classList.remove('copied');
				}, 1400);
			});
			chrome.append(lang, copy);
			const code = document.createElement('code');
			code.textContent = codeText;
			const pre = document.createElement('pre');
			pre.append(code);
			wrapper.append(chrome, pre);
			bindSourceNavigation(lang, this.block.from, lines[0], 'geometry');
			const codeFrom = lines[0].length + 1;
			bindSourceNavigation(
				code,
				this.block.from + codeFrom,
				this.source.slice(codeFrom, this.source.lastIndexOf('\n')),
			);
		} else if (this.block.kind === 'math') {
			const opening = /^\s*\$\$/.exec(this.source);
			const closing = /\$\$\s*$/.exec(this.source);
			const contentFrom = opening?.[0].length ?? 0;
			const contentTo = closing?.index ?? this.source.length;
			try {
				katex.render(this.source.slice(contentFrom, contentTo), wrapper, {
					displayMode: true,
					throwOnError: false,
				});
			} catch {
				wrapper.textContent = this.source;
			}
			const renderedFormula = wrapper.querySelector<HTMLElement>('.katex-html');
			if (renderedFormula)
				bindSourceNavigation(
					renderedFormula,
					this.block.from + contentFrom,
					this.source.slice(contentFrom, contentTo),
					'geometry',
				);
			bindSourceNavigation(
				wrapper,
				this.block.from + contentFrom,
				this.source.slice(contentFrom, contentTo),
				'geometry',
			);
		} else if (this.block.kind === 'details') {
			const summaryMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(this.source);
			const summary = summaryMatch?.[1] ?? 'Details';
			const summaryNode = document.createElement('summary');
			summaryNode.innerHTML = renderMarkdownInline(summary);
			const content = document.createElement('div');
			content.innerHTML = renderMarkdown(
				this.source.replace(/<\/?details[^>]*>|<summary>[\s\S]*?<\/summary>/gi, '').trim(),
			);
			wrapper.append(summaryNode, content);
			(wrapper as HTMLDetailsElement).open = true;
			if (summaryMatch) {
				const relativeFrom = summaryMatch.index + summaryMatch[0].indexOf(summaryMatch[1]);
				bindSourceNavigation(summaryNode, this.block.from + relativeFrom, summary);
			}
		} else if (this.block.kind === 'frontmatter') {
			const frontmatter = parseFrontmatterBlock(this.source);
			if (!frontmatter || frontmatter.entries.length === 0) {
				wrapper.textContent = this.source;
			} else {
				const properties = document.createElement('dl');
				for (const entry of frontmatter.entries) {
					const row = document.createElement('div');
					const key = document.createElement('dt');
					key.textContent = entry.key;
					const value = document.createElement('dd');
					value.textContent = entry.value;
					row.append(key, value);
					properties.append(row);
				}
				wrapper.append(properties);
			}
		} else wrapper.innerHTML = renderMarkdown(this.source);
		if (this.block.kind !== 'math') bindSourceNavigation(wrapper, this.block.from, this.source);
		return wrapper;
	}
	private tableDOM(_view: EditorView): HTMLElement {
		const parsed = parseTableBlock(this.source);
		if (!parsed) {
			const fallback = document.createElement('pre');
			fallback.textContent = this.source;
			bindSourceNavigation(fallback, this.block.from, this.source);
			return fallback;
		}
		const table = document.createElement('table');
		table.className = 'cm-live-table';
		const head = document.createElement('thead');
		const body = document.createElement('tbody');
		const sourceLines = this.source.split('\n');
		const lineOffsets: number[] = [];
		let lineOffset = 0;
		for (const line of sourceLines) {
			lineOffsets.push(lineOffset);
			lineOffset += line.length + 1;
		}
		const rows = parsed.rows;
		rows.forEach((cells, rowIndex) => {
			if (rowIndex === parsed.separatorIndex) return;
			const row = document.createElement('tr');
			cells.forEach((value, columnIndex) => {
				const cell = document.createElement(rowIndex < parsed.separatorIndex ? 'th' : 'td');
				cell.dataset.sourceRow = String(rowIndex);
				cell.dataset.sourceColumn = String(columnIndex);
				const alignment = parsed.alignments[columnIndex];
				if (alignment) cell.style.textAlign = alignment;
				cell.innerHTML = renderMarkdownInline(value);
				const range = tableCellSourceRanges(sourceLines[rowIndex] ?? '')[columnIndex];
				if (range) {
					const source = sourceLines[rowIndex].slice(range.from, range.to);
					bindSourceNavigation(cell, this.block.from + lineOffsets[rowIndex] + range.from, source, 'text');
				}
				row.append(cell);
			});
			(rowIndex < parsed.separatorIndex ? head : body).append(row);
		});
		table.append(head, body);
		bindSourceNavigation(table, this.block.from, this.source, 'geometry');
		return table;
	}
}

export class WikiLinkWidget extends SourceWidget {
	constructor(
		private readonly source: string,
		private readonly from: number,
		private readonly to: number,
		private readonly link: WikiLinkRange,
	) {
		super();
	}
	eq(other: WikiLinkWidget): boolean {
		return (
			this.source === other.source &&
			this.from === other.from &&
			this.to === other.to &&
			this.link.kind === other.link.kind &&
			this.link.target === other.link.target &&
			this.link.alias === other.link.alias
		);
	}
	toDOM(view: EditorView): HTMLElement {
		const node = document.createElement(this.link.kind === 'embed' ? 'span' : 'a');
		const label = this.link.alias || this.link.target;
		if (this.link.kind === 'embed') {
			node.className = 'cm-live-inline-block cm-live-embed markdown-embed';
			node.textContent = label;
			node.setAttribute('data-embed', this.link.target);
		} else {
			const anchor = node as HTMLAnchorElement;
			anchor.className = 'cm-live-inline-block cm-live-link cm-live-wikilink markdown-wikilink';
			const headingTarget = this.link.target.includes('#')
				? this.link.target.slice(this.link.target.indexOf('#') + 1)
				: this.link.target;
			anchor.href = `#${slugifyMarkdownHeading(headingTarget)}`;
			anchor.textContent = label;
			anchor.addEventListener('click', (event) => {
				if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
				event.preventDefault();
				const position = markdownHeadingPosition(view, headingTarget);
				if (position === null) return;
				view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'start' }) });
			});
		}
		bindSourceNavigation(node, this.from, this.source, 'text');
		return node;
	}
}
