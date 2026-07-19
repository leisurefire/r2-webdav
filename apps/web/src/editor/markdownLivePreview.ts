import { EditorState, StateField, Transaction } from '@codemirror/state';
import { defaultKeymap, deleteCharBackward, deleteCharForward, history, historyKeymap } from '@codemirror/commands';
import { EditorView, Decoration, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { GFM } from '@lezer/markdown';
import { tags } from '@lezer/highlight';
import katex from 'katex';
import {
	collectInlineExcludedRanges,
	collectObsidianInlineRanges,
	collectStructuralBlocks,
	parseFrontmatterBlock,
	parseTableBlock,
	tableCellSourceRanges,
	type StructuralBlock,
} from './markdownStructure';
import { normalizeClipboardText, prepareClipboardText, readClipboardText } from './markdownClipboard';
import {
	renderMarkdown,
	renderMarkdownDocument,
	renderMarkdownInline,
	renderResolvedMarkdownLink,
} from './markdownRenderer';

export const markdownLanguageSupport = markdown({ extensions: GFM });

// Keep the reset in the same style module as CodeMirror's defaults so its
// documented rule ordering reliably removes the default heading underline.
export const markdownLivePreviewHighlightStyle = HighlightStyle.define([
	...defaultHighlightStyle.specs,
	{ tag: tags.heading, textDecoration: 'none', fontWeight: 'bold' },
]);

type DeleteDirection = 'backward' | 'forward';
type DeleteRange = { from: number; to: number };

function previousCodePointStart(text: string, end: number): number {
	if (end <= 0) return 0;
	const code = text.charCodeAt(end - 1);
	return code >= 0xdc00 && code <= 0xdfff ? end - 2 : end - 1;
}

function nextCodePointEnd(text: string, start: number): number {
	if (start >= text.length) return text.length;
	const code = text.charCodeAt(start);
	return code >= 0xd800 && code <= 0xdbff ? start + 2 : start + 1;
}

function parsedWidgetContent(source: string, widgetName: string): { from: number; to: number } | null {
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

function syntaxNodeContent(source: string, nodeName: string): { from: number; to: number } | null {
	if (nodeName === 'Link' || nodeName === 'Autolink') return parsedWidgetContent(source, 'LinkWidget');
	const marker =
		nodeName === 'StrongEmphasis'
			? source.startsWith('**') && source.endsWith('**')
				? '**'
				: source.startsWith('__') && source.endsWith('__')
					? '__'
					: ''
			: nodeName === 'Strikethrough'
				? source.startsWith('~~') && source.endsWith('~~')
					? '~~'
					: ''
				: nodeName === 'Emphasis'
					? source.startsWith('***') && source.endsWith('***')
						? '***'
						: source.startsWith('___') && source.endsWith('___')
							? '___'
							: source.startsWith('*') && source.endsWith('*')
								? '*'
								: source.startsWith('_') && source.endsWith('_')
									? '_'
									: ''
					: nodeName === 'InlineCode'
						? (/^`+/.exec(source)?.[0] ?? '')
						: '';
	if (!marker || !source.endsWith(marker) || source.length <= marker.length * 2) return null;
	return { from: marker.length, to: source.length - marker.length };
}

function syntaxDeleteRange(state: EditorState, position: number, direction: DeleteDirection): DeleteRange | null {
	let contentRange: DeleteRange | null = null;
	syntaxTree(state).iterate({
		enter(node) {
			if ((direction === 'backward' ? node.to !== position : node.from !== position) || node.from === node.to) return;
			const content = syntaxNodeContent(state.sliceDoc(node.from, node.to), node.name);
			if (!content) return;
			const candidate = { from: node.from + content.from, to: node.from + content.to };
			if (!contentRange || candidate.to - candidate.from < contentRange.to - contentRange.from)
				contentRange = candidate;
		},
	});
	if (contentRange) {
		const outer = contentRange as DeleteRange;
		syntaxTree(state).iterate({
			enter(node) {
				if (node.from < outer.from || node.to !== outer.to) return;
				const content = syntaxNodeContent(state.sliceDoc(node.from, node.to), node.name);
				if (!content) return;
				const candidate = { from: node.from + content.from, to: node.from + content.to };
				if (candidate.to - candidate.from < contentRange!.to - contentRange!.from) contentRange = candidate;
			},
		});
	}
	if (!contentRange) {
		const line = state.doc.lineAt(position);
		const ranges = [
			...collectInlineExcludedRanges(line.text).filter((range) => range.kind === 'math'),
			...collectObsidianInlineRanges(line.text).filter((range) => range.kind === 'highlight'),
		];
		const wrapped = ranges.find((range) =>
			direction === 'backward' ? line.from + range.to === position : line.from + range.from === position,
		);
		if (wrapped) {
			const delimiter = wrapped.kind === 'highlight' ? 2 : line.text.slice(wrapped.from).startsWith('$$') ? 2 : 1;
			contentRange = { from: line.from + wrapped.from + delimiter, to: line.from + wrapped.to - delimiter };
		}
	}
	if (!contentRange || contentRange.to <= contentRange.from) return null;
	return direction === 'backward'
		? { from: previousCodePointStart(state.doc.toString(), contentRange.to), to: contentRange.to }
		: { from: contentRange.from, to: nextCodePointEnd(state.doc.toString(), contentRange.from) };
}

function markerContentRange(
	source: string,
	markerFrom: number,
	markerTo: number,
	direction: DeleteDirection,
): DeleteRange | null {
	const marker = source.slice(markerFrom, markerTo);
	if (!/^[*_~=`]{1,3}$/.test(marker)) return null;
	const opening = source.lastIndexOf(marker, markerFrom - 1);
	if (direction === 'backward' && opening >= 0) {
		const contentEnd = markerFrom;
		if (contentEnd <= opening + marker.length) return null;
		return { from: previousCodePointStart(source, contentEnd), to: contentEnd };
	}
	if (direction === 'forward') {
		const closing = source.indexOf(marker, markerTo);
		if (closing >= markerTo) {
			const contentStart = markerTo;
			if (closing <= contentStart) return null;
			return { from: contentStart, to: nextCodePointEnd(source, contentStart) };
		}
	}
	return null;
}

/** Return the source range represented by one parsed character at the cursor edge. */
export function parsedDeleteRange(state: EditorState, direction: DeleteDirection): DeleteRange | null {
	const selection = state.selection.main;
	if (!selection.empty) return null;
	const position = direction === 'backward' ? selection.from : selection.to;
	const syntaxRange = syntaxDeleteRange(state, position, direction);
	if (syntaxRange) return syntaxRange;
	let result: DeleteRange | null = null;
	state.field(livePreviewField).between(0, state.doc.length, (from, to, decoration) => {
		if (result) return;
		const widget = decoration.spec.widget as WidgetType | undefined;
		if (widget && ((direction === 'backward' && to === position) || (direction === 'forward' && from === position))) {
			const source = state.sliceDoc(from, to);
			const content = parsedWidgetContent(source, widget.constructor.name);
			if (content && content.to > content.from) {
				const edge = direction === 'backward' ? content.to : content.from;
				const offset = direction === 'backward' ? previousCodePointStart(source, edge) : nextCodePointEnd(source, edge);
				result = {
					from: from + (direction === 'backward' ? offset : edge),
					to: from + (direction === 'backward' ? edge : offset),
				};
			}
			return;
		}
		if (!widget && ((direction === 'backward' && to === position) || (direction === 'forward' && from === position))) {
			const markerRange = markerContentRange(state.doc.toString(), from, to, direction);
			if (markerRange) result = markerRange;
		}
	});
	return result;
}

function toggleMarkdownWrap(view: EditorView, marker: string): boolean {
	const selection = view.state.selection.main;
	const { from, to } = selection;
	const selected = view.state.sliceDoc(from, to);
	const before = from >= marker.length ? view.state.sliceDoc(from - marker.length, from) : '';
	const after = view.state.sliceDoc(to, to + marker.length);
	if (before === marker && after === marker) {
		view.dispatch({
			changes: [
				{ from: from - marker.length, to: from },
				{ from: to, to: to + marker.length },
			],
			selection: { anchor: from - marker.length, head: to - marker.length },
			annotations: Transaction.userEvent.of('input.format'),
		});
		return true;
	}
	if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
		const inner = selected.slice(marker.length, -marker.length);
		view.dispatch({
			changes: { from, to, insert: inner },
			selection: { anchor: from, head: from + inner.length },
			annotations: Transaction.userEvent.of('input.format'),
		});
		return true;
	}
	view.dispatch({
		changes: { from, to, insert: `${marker}${selected}${marker}` },
		selection: { anchor: from + marker.length, head: to + marker.length },
		annotations: Transaction.userEvent.of('input.format'),
	});
	return true;
}

type LinkDefinition = { href: string; title?: string };
type ResolvedLink = LinkDefinition & { label: string };

function isMarkdownHeading(name: string): boolean {
	return /^ATXHeading[1-6]$|^SetextHeading[12]$/.test(name);
}

function normalizeReferenceLabel(value: string): string {
	return value
		.replace(/\\([\\[\]])/g, '$1')
		.trim()
		.replace(/\s+/g, ' ')
		.toLocaleLowerCase();
}

function markdownDestination(value: string): string {
	const trimmed = value.trim();
	const destination = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed;
	return destination.replace(/\\([\\()<>{}\[\]])/g, '$1');
}

function markdownLinkTitle(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'")) ||
		(trimmed.startsWith('(') && trimmed.endsWith(')'))
	)
		return trimmed.slice(1, -1);
	return trimmed;
}

function headingPositionForHash(view: EditorView, hash: string): number | null {
	let id: string;
	try {
		id = decodeURIComponent(hash.slice(1));
	} catch {
		return null;
	}
	const headingIndex = renderMarkdownDocument(view.state.doc.toString()).headings.findIndex(
		(heading) => heading.id === id,
	);
	if (headingIndex < 0) return null;
	let index = 0;
	let position: number | null = null;
	syntaxTree(view.state).iterate({
		enter(node) {
			if (!isMarkdownHeading(node.name)) return;
			if (index === headingIndex) position = node.from;
			index += 1;
		},
	});
	return position;
}

export function taskMarkerChange(
	from: number,
	to: number,
	checked: boolean,
): { from: number; to: number; insert: string } {
	return { from, to, insert: checked ? '[x]' : '[ ]' };
}

function selectSource(view: EditorView, from: number, to = from): void {
	const start = Math.max(0, Math.min(from, view.state.doc.length));
	const end = Math.max(start, Math.min(to, view.state.doc.length));
	view.dispatch({
		selection: { anchor: start, head: end },
		effects: EditorView.scrollIntoView(start, { y: 'nearest' }),
	});
	view.focus();
}

export type ScreenRect = { left: number; right: number; top: number; bottom: number };

function clampUnit(value: number): number {
	return Math.max(0, Math.min(value, 1));
}

/** Map a visible text boundary back to its matching boundary in Markdown source. */
export function visibleSourcePosition(source: string, visible: string, visibleOffset: number): number {
	const target = Math.max(0, Math.min(visibleOffset, visible.length));
	let sourceOffset = 0;
	for (let visibleIndex = 0; visibleIndex < visible.length; visibleIndex += 1) {
		const char = visible[visibleIndex];
		let match = -1;
		if (/\s/.test(char)) {
			for (let index = sourceOffset; index < source.length; index += 1) {
				if (/\s/.test(source[index])) {
					match = index;
					break;
				}
			}
		} else match = source.indexOf(char, sourceOffset);
		if (match < 0) return Math.round((target / Math.max(1, visible.length)) * source.length);
		if (visibleIndex === target) return match;
		sourceOffset = match + 1;
		if (visibleIndex + 1 === target) return sourceOffset;
	}
	return sourceOffset;
}

/** Map a pointer to the source line and column represented by a rendered rectangle. */
export function geometricSourcePosition(source: string, x: number, y: number, rect: ScreenRect): number {
	const lines = source.split('\n');
	const xRatio = clampUnit((x - rect.left) / Math.max(1, rect.right - rect.left));
	const yRatio = clampUnit((y - rect.top) / Math.max(1, rect.bottom - rect.top));
	const lineIndex = Math.min(lines.length - 1, Math.floor(yRatio * lines.length));
	let offset = 0;
	for (let index = 0; index < lineIndex; index += 1) offset += lines[index].length + 1;
	return offset + Math.round(xRatio * lines[lineIndex].length);
}

function hasInteractiveTarget(target: EventTarget | null): boolean {
	return target instanceof Element && !!target.closest('a,button,input,textarea,select,summary');
}

function textOffsetAtPoint(node: HTMLElement, x: number, y: number): number | null {
	const caretDocument = document as Document & {
		caretPositionFromPoint?: (clientX: number, clientY: number) => { offsetNode: Node; offset: number } | null;
		caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
	};
	const caret = caretDocument.caretPositionFromPoint?.(x, y);
	const offsetNode = caret?.offsetNode ?? caretDocument.caretRangeFromPoint?.(x, y)?.startContainer;
	const offset = caret?.offset ?? caretDocument.caretRangeFromPoint?.(x, y)?.startOffset;
	if (!offsetNode || offset === undefined || (offsetNode !== node && !node.contains(offsetNode))) return null;
	try {
		const prefix = document.createRange();
		prefix.selectNodeContents(node);
		prefix.setEnd(offsetNode, offset);
		return prefix.toString().length;
	} catch {
		return null;
	}
}

type SourcePointerMode = 'text' | 'geometry';

function sourcePositionAtPointer(
	node: HTMLElement,
	from: number,
	source: string,
	x: number,
	y: number,
	mode: SourcePointerMode,
): number {
	if (mode === 'text') {
		const visible = node.textContent ?? '';
		const visibleOffset = textOffsetAtPoint(node, x, y);
		if (visible && visibleOffset !== null) return from + visibleSourcePosition(source, visible, visibleOffset);
	}
	return from + geometricSourcePosition(source, x, y, node.getBoundingClientRect());
}

function bindSourceNavigation(
	node: HTMLElement,
	view: EditorView,
	from: number,
	source: string,
	mode: SourcePointerMode = 'text',
	interactive = false,
): void {
	node.addEventListener('mousedown', (event) => {
		if (!(event instanceof MouseEvent) || event.button !== 0) return;
		if (interactive && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
		if (!interactive && hasInteractiveTarget(event.target)) return;
		const position = sourcePositionAtPointer(node, from, source, event.clientX, event.clientY, mode);
		event.preventDefault();
		event.stopPropagation();
		selectSource(view, position);
	});
}

class CheckboxWidget extends WidgetType {
	constructor(
		private readonly checked: boolean,
		private readonly from: number,
		private readonly to: number,
	) {
		super();
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

class InlineMathWidget extends WidgetType {
	constructor(
		private readonly expression: string,
		private readonly from: number,
		private readonly to: number,
	) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		const node = document.createElement('span');
		node.className = 'cm-live-inline-math';
		try {
			katex.render(this.expression, node, { displayMode: false, throwOnError: false });
		} catch {
			node.textContent = `$${this.expression}$`;
		}
		bindSourceNavigation(node, view, this.from + 1, this.expression, 'geometry');
		return node;
	}
}

class InlineMarkdownWidget extends WidgetType {
	constructor(
		private readonly source: string,
		private readonly from: number,
		private readonly to: number,
	) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		const node = document.createElement('span');
		node.className = 'cm-live-inline-rendered';
		node.innerHTML = renderMarkdownInline(this.source);
		const delimiter = this.source.startsWith('==') && this.source.endsWith('==') ? 2 : 0;
		bindSourceNavigation(
			node,
			view,
			this.from + delimiter,
			this.source.slice(delimiter, this.source.length - delimiter),
		);
		return node;
	}
}

class LinkWidget extends WidgetType {
	constructor(
		private readonly source: string,
		private readonly from: number,
		private readonly to: number,
		private readonly resolved?: ResolvedLink,
	) {
		super();
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
			bindSourceNavigation(container, view, this.from, this.source, 'text');
			return container;
		}
		anchor.classList.add('cm-live-link');
		const content = parsedWidgetContent(this.source, 'LinkWidget');
		const contentFrom = content?.from ?? 0;
		const contentTo = content?.to ?? this.source.length;
		bindSourceNavigation(
			anchor,
			view,
			this.from + contentFrom,
			this.source.slice(contentFrom, contentTo),
			'text',
			true,
		);
		anchor.addEventListener('click', (event) => {
			const href = anchor.getAttribute('href') ?? '';
			if (
				!href.startsWith('#') ||
				event.button !== 0 ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey ||
				event.altKey
			)
				return;
			const position = headingPositionForHash(view, href);
			if (position === null) return;
			event.preventDefault();
			view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'start' }) });
		});
		return anchor;
	}
}

class HorizontalRuleWidget extends WidgetType {
	constructor(
		private readonly from: number,
		private readonly to: number,
	) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		const rule = document.createElement('hr');
		rule.className = 'cm-live-hr';
		bindSourceNavigation(rule, view, this.from, view.state.sliceDoc(this.from, this.to), 'geometry');
		return rule;
	}
}

class ImageWidget extends WidgetType {
	constructor(
		private readonly source: string,
		private readonly from: number,
		private readonly to: number,
	) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		const container = document.createElement('span');
		container.innerHTML = renderMarkdownInline(this.source);
		const image = container.querySelector('img');
		if (!image) {
			const fallback = document.createElement('span');
			fallback.textContent = this.source;
			bindSourceNavigation(fallback, view, this.from, this.source, 'geometry');
			return fallback;
		}
		image.className = 'cm-live-image';
		image.loading = 'lazy';
		bindSourceNavigation(image, view, this.from, this.source, 'geometry');
		return image;
	}
}

class ListMarkerWidget extends WidgetType {
	constructor(
		private readonly marker: string,
		private readonly from: number,
		private readonly to: number,
	) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		const node = document.createElement('span');
		node.className = 'cm-live-list-marker';
		node.textContent = /^\d/.test(this.marker) ? this.marker : '•';
		bindSourceNavigation(node, view, this.from, this.marker, 'geometry');
		return node;
	}
}

class BlockWidget extends WidgetType {
	constructor(
		private readonly block: StructuralBlock,
		private readonly source: string,
	) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		if (this.block.kind === 'table') return this.tableDOM(view);
		const wrapper = document.createElement(this.block.kind === 'details' ? 'details' : 'div');
		wrapper.className = `cm-live-block cm-live-${this.block.kind}`;
		if (this.block.kind === 'fence') {
			const lines = this.source.split('\n');
			const label = /^\s*(?:`{3,}|~{3,})(.*)$/.exec(lines[0])?.[1].trim() ?? '';
			const chrome = document.createElement('div');
			chrome.className = 'cm-live-code-chrome';
			chrome.textContent = label || 'code';
			const code = document.createElement('code');
			code.textContent = lines.slice(1, -1).join('\n');
			const pre = document.createElement('pre');
			pre.append(code);
			wrapper.append(chrome, pre);
			bindSourceNavigation(chrome, view, this.block.from, lines[0], 'geometry');
			const codeFrom = lines[0].length + 1;
			bindSourceNavigation(
				code,
				view,
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
					view,
					this.block.from + contentFrom,
					this.source.slice(contentFrom, contentTo),
					'geometry',
				);
			bindSourceNavigation(
				wrapper,
				view,
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
				bindSourceNavigation(summaryNode, view, this.block.from + relativeFrom, summary);
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
		if (this.block.kind !== 'math') bindSourceNavigation(wrapper, view, this.block.from, this.source);
		return wrapper;
	}
	private tableDOM(view: EditorView): HTMLElement {
		const parsed = parseTableBlock(this.source);
		if (!parsed) {
			const fallback = document.createElement('pre');
			fallback.textContent = this.source;
			bindSourceNavigation(fallback, view, this.block.from, this.source);
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
		table.addEventListener('mousedown', (event) => {
			if (!(event instanceof MouseEvent) || event.button !== 0 || hasInteractiveTarget(event.target)) return;
			const { clientX, clientY } = event;
			const cell = (event.target as Element | null)?.closest<HTMLElement>('th[data-source-row],td[data-source-row]');
			let position =
				this.block.from + geometricSourcePosition(this.source, clientX, clientY, table.getBoundingClientRect());
			if (cell) {
				const rowIndex = Number(cell.dataset.sourceRow);
				const columnIndex = Number(cell.dataset.sourceColumn);
				const range = tableCellSourceRanges(sourceLines[rowIndex] ?? '')[columnIndex];
				if (range) {
					const source = sourceLines[rowIndex].slice(range.from, range.to);
					position = sourcePositionAtPointer(
						cell,
						this.block.from + lineOffsets[rowIndex] + range.from,
						source,
						clientX,
						clientY,
						'text',
					);
				}
			}
			event.preventDefault();
			event.stopPropagation();
			selectSource(view, position);
		});
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
				row.append(cell);
			});
			(rowIndex < parsed.separatorIndex ? head : body).append(row);
		});
		table.append(head, body);
		return table;
	}
}

export function buildLivePreviewDecorations(state: EditorState): DecorationSet {
	try {
		const text = state.doc.toString();
		const structuralBlocks = collectStructuralBlocks(text);
		const tree = syntaxTree(state);
		const quoteBlocks: StructuralBlock[] = [];
		tree.iterate({
			enter(node) {
				if (node.name !== 'Blockquote') return;
				if (!structuralBlocks.some((block) => node.from < block.to && node.to > block.from))
					quoteBlocks.push({ from: node.from, to: node.to, kind: 'quote' });
				return false;
			},
		});
		const blocks = [...structuralBlocks, ...quoteBlocks].sort((left, right) => left.from - right.from);
		const renderedInlineRanges: Array<{ from: number; to: number }> = [];
		tree.iterate({
			enter(node) {
				if (node.name === 'Link' || node.name === 'Image' || node.name === 'Autolink' || node.name === 'URL') {
					renderedInlineRanges.push({ from: node.from, to: node.to });
					return false;
				}
				if (node.name === 'LinkReference') return false;
			},
		});
		const decorations: { from: number; to: number; value: Decoration }[] = [];
		const add = (from: number, to: number, value: Decoration) => decorations.push({ from, to, value });
		const active = new Set<number>();
		for (const range of state.selection.ranges) {
			const line = state.doc.lineAt(range.from);
			active.add(line.from);
			active.add(state.doc.lineAt(range.to).from);
		}
		for (const block of blocks) {
			const touched = state.selection.ranges.some((range) => range.from <= block.to && range.to >= block.from);
			if (!touched)
				add(
					block.from,
					block.to,
					Decoration.replace({ widget: new BlockWidget(block, text.slice(block.from, block.to)), block: true }),
				);
			else {
				let position = block.from;
				while (position <= block.to && position <= state.doc.length) {
					const line = state.doc.lineAt(position);
					add(line.from, line.from, Decoration.line({ class: `cm-live-raw-block cm-live-raw-${block.kind}` }));
					if (line.to >= block.to || line.to === state.doc.length) break;
					position = line.to + 1;
				}
			}
		}
		const inlineExclusions: Array<{ from: number; to: number }> = [];
		for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
			const line = state.doc.line(lineNo);
			const isActive = active.has(line.from);
			const block = blocks.find((item) => line.from >= item.from && line.from < item.to);
			if (block) continue;
			const lineText = line.text;
			const task = /^(\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]\s+/.exec(lineText);
			if (task) {
				const markerFrom = line.from + task[1].length;
				const markerTo = markerFrom + 3;
				inlineExclusions.push({ from: markerFrom, to: markerTo });
				if (!isActive)
					add(
						markerFrom,
						markerTo,
						Decoration.replace({
							widget: new CheckboxWidget(task[2].toLowerCase() === 'x', markerFrom, markerTo),
						}),
					);
			}
			const excludedRanges = collectInlineExcludedRanges(lineText);
			for (const range of excludedRanges) {
				const from = line.from + range.from;
				const to = line.from + range.to;
				const renderedByParent = renderedInlineRanges.some((item) => from >= item.from && to <= item.to);
				if (range.kind !== 'math' || renderedByParent) continue;
				inlineExclusions.push({ from, to });
				if (isActive) continue;
				add(
					from,
					to,
					Decoration.replace({
						widget: new InlineMathWidget(lineText.slice(range.from + 1, range.to - 1), from, to),
					}),
				);
			}
			for (const range of collectObsidianInlineRanges(lineText)) {
				const from = line.from + range.from;
				const to = line.from + range.to;
				const renderedByParent = renderedInlineRanges.some((item) => from >= item.from && to <= item.to);
				if (renderedByParent) continue;
				inlineExclusions.push({ from, to });
				if (isActive) continue;
				add(
					from,
					to,
					range.kind === 'comment'
						? Decoration.replace({})
						: Decoration.replace({
								widget: new InlineMarkdownWidget(lineText.slice(range.from, range.to), from, to),
							}),
				);
			}
		}
		const overlapsExcluded = (from: number, to: number) =>
			inlineExclusions.some((range) => from < range.to && to > range.from);
		const references = new Map<string, LinkDefinition>();
		tree.iterate({
			enter: (node) => {
				if (node.name !== 'LinkReference') return;
				const label = node.node.getChild('LinkLabel');
				const destination = node.node.getChild('URL');
				if (label && destination) {
					const title = node.node.getChild('LinkTitle');
					references.set(normalizeReferenceLabel(state.sliceDoc(label.from + 1, label.to - 1)), {
						href: markdownDestination(state.sliceDoc(destination.from, destination.to)),
						...(title ? { title: markdownLinkTitle(state.sliceDoc(title.from, title.to)) } : {}),
					});
				}
				return false;
			},
		});
		tree.iterate({
			from: 0,
			to: state.doc.length,
			enter: (node) => {
				if (overlapsExcluded(node.from, node.to)) return;
				const block = blocks.find((item) => node.from < item.to && node.to > item.from);
				if (block) return;
				const line = state.doc.lineAt(node.from);
				const isActive = active.has(line.from);
				if (node.name === 'HorizontalRule') {
					if (!isActive)
						add(node.from, node.to, Decoration.replace({ widget: new HorizontalRuleWidget(node.from, node.to) }));
					return;
				}
				if (isMarkdownHeading(node.name)) {
					const level = node.name.at(-1);
					add(node.from, node.to, Decoration.mark({ class: `cm-live-heading cm-live-h${level}` }));
					if (!isActive) {
						const headerMark = node.node.getChild('HeaderMark');
						if (headerMark) {
							let contentStart = headerMark.to;
							while (contentStart < node.to && /\s/.test(state.sliceDoc(contentStart, contentStart + 1)))
								contentStart += 1;
							if (contentStart > headerMark.to) add(headerMark.to, contentStart, Decoration.replace({}));
						}
					}
					return;
				}
				if (node.name === 'Link') {
					if (!isActive) {
						const destination = node.node.getChild('URL');
						let resolved: ResolvedLink | undefined;
						if (!destination) {
							const marks = node.node.getChildren('LinkMark');
							const labelStart = marks[0]?.to ?? node.from + 1;
							const labelEnd = marks[1]?.from ?? labelStart;
							const label = state.sliceDoc(labelStart, labelEnd);
							const referenceLabel = node.node.getChild('LinkLabel');
							const key = normalizeReferenceLabel(
								referenceLabel ? state.sliceDoc(referenceLabel.from + 1, referenceLabel.to - 1) || label : label,
							);
							const definition = references.get(key);
							if (definition) resolved = { ...definition, label };
						}
						add(
							node.from,
							node.to,
							Decoration.replace({
								widget: new LinkWidget(state.sliceDoc(node.from, node.to), node.from, node.to, resolved),
							}),
						);
					} else add(node.from, node.to, Decoration.mark({ class: 'cm-live-link' }));
					return false;
				}
				if (node.name === 'Autolink') {
					if (!isActive)
						add(
							node.from,
							node.to,
							Decoration.replace({
								widget: new LinkWidget(state.sliceDoc(node.from, node.to), node.from, node.to),
							}),
						);
					else add(node.from, node.to, Decoration.mark({ class: 'cm-live-link' }));
					return false;
				}
				if (node.name === 'LinkReference') {
					if (!isActive) add(node.from, node.to, Decoration.replace({}));
					return false;
				}
				if (node.name === 'URL') {
					if (!isActive)
						add(
							node.from,
							node.to,
							Decoration.replace({
								widget: new LinkWidget(state.sliceDoc(node.from, node.to), node.from, node.to),
							}),
						);
					else add(node.from, node.to, Decoration.mark({ class: 'cm-live-link' }));
					return false;
				}
				if (node.name === 'Strikethrough') {
					add(node.from, node.to, Decoration.mark({ class: 'cm-live-strike' }));
					return;
				}
				if (
					node.name === 'StrongEmphasis' ||
					node.name === 'Emphasis' ||
					node.name === 'InlineCode' ||
					node.name === 'Image'
				) {
					if (node.name === 'Image' && !isActive) {
						add(
							node.from,
							node.to,
							Decoration.replace({
								widget: new ImageWidget(state.sliceDoc(node.from, node.to), node.from, node.to),
							}),
						);
						return false;
					}
					const className =
						node.name === 'StrongEmphasis'
							? 'cm-live-strong'
							: node.name === 'Emphasis'
								? 'cm-live-em'
								: node.name === 'InlineCode'
									? 'cm-live-inline-code'
									: 'cm-live-link';
					add(node.from, node.to, Decoration.mark({ class: className }));
					return;
				}
				if (
					node.name === 'HeaderMark' ||
					node.name === 'EmphasisMark' ||
					node.name === 'CodeMark' ||
					node.name === 'LinkMark' ||
					node.name === 'StrikethroughMark' ||
					node.name === 'QuoteMark' ||
					node.name === 'ListMark'
				) {
					if (!isActive && node.name === 'QuoteMark') {
						add(node.from, node.to, Decoration.replace({}));
					} else if (!isActive && node.name === 'ListMark') {
						add(
							node.from,
							node.to,
							Decoration.replace({
								widget: new ListMarkerWidget(state.sliceDoc(node.from, node.to), node.from, node.to),
							}),
						);
					} else if (!isActive) add(node.from, node.to, Decoration.replace({}));
				}
			},
		});
		return Decoration.set(
			decorations.map((item) => item.value.range(item.from, item.to)),
			true,
		);
	} catch {
		return Decoration.none;
	}
}

export const livePreviewField = StateField.define<DecorationSet>({
	create: buildLivePreviewDecorations,
	update(decorations, transaction) {
		return transaction.docChanged ||
			transaction.selection ||
			syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
			? buildLivePreviewDecorations(transaction.state)
			: decorations;
	},
	provide: (field) => EditorView.decorations.from(field),
});

type MarkdownLivePreviewOptions = {
	onChange: (value: string, immediate: boolean) => void;
	onImageTooLarge?: () => void;
	onImageReadError?: () => void;
};

function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener('load', () => resolve(String(reader.result)));
		reader.addEventListener('error', () => reject(reader.error));
		reader.readAsDataURL(file);
	});
}

function clipboardText(event: ClipboardEvent): string {
	const data = event.clipboardData;
	if (!data) return '';
	const text = readClipboardText((type) => data.getData(type));
	if (text) return text;
	const html = data.getData('text/html');
	if (!html) return '';
	const fragment = document.createElement('div');
	fragment.innerHTML = html;
	fragment.querySelectorAll('br').forEach((breakNode) => breakNode.replaceWith('\n'));
	return normalizeClipboardText(fragment.innerText || fragment.textContent || '');
}

export function createMarkdownLivePreview(
	parent: HTMLElement,
	value: string,
	options: MarkdownLivePreviewOptions,
): EditorView {
	localStorage.setItem('wysiwygMode', 'true');
	const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
	const pendingImageRanges = new Map<number, { from: number; to: number; empty: boolean }>();
	let nextImagePasteId = 0;
	const parsedDelete =
		(direction: DeleteDirection) =>
		(view: EditorView): boolean => {
			const range = parsedDeleteRange(view.state, direction);
			if (!range) return direction === 'backward' ? deleteCharBackward(view) : deleteCharForward(view);
			view.dispatch({
				changes: range,
				annotations: Transaction.userEvent.of(direction === 'backward' ? 'delete.backward' : 'delete.forward'),
			});
			return true;
		};
	const editingKeymap = keymap.of([
		{ key: 'Backspace', run: parsedDelete('backward') },
		{ key: 'Delete', run: parsedDelete('forward') },
		{ key: 'Mod-b', run: (view) => toggleMarkdownWrap(view, '**') },
		{ key: 'Mod-i', run: (view) => toggleMarkdownWrap(view, '*') },
		{ key: 'Mod-Shift-s', run: (view) => toggleMarkdownWrap(view, '~~') },
		{ key: 'Mod-`', run: (view) => toggleMarkdownWrap(view, '`') },
		...defaultKeymap,
		...historyKeymap,
	]);
	const clipboardHandlers = EditorView.domEventHandlers({
		paste(event, view) {
			if ((event.target as HTMLElement | null)?.closest('.cm-live-table textarea')) return false;
			const image = [...(event.clipboardData?.files ?? [])].find((file) => file.type.startsWith('image/'));
			if (image) {
				event.preventDefault();
				if (image.size > 256 * 1024) {
					options.onImageTooLarge?.();
					return true;
				}
				const id = ++nextImagePasteId;
				const selection = view.state.selection.main;
				pendingImageRanges.set(id, { from: selection.from, to: selection.to, empty: selection.empty });
				void readFileAsDataUrl(image)
					.then((dataUrl) => {
						const range = pendingImageRanges.get(id);
						pendingImageRanges.delete(id);
						if (!range || !view.dom.isConnected) return;
						const alt = image.name || 'image';
						const markdown = `![${alt.replaceAll(']', '\\]')}](${dataUrl})`;
						view.dispatch({
							changes: { from: range.from, to: range.to, insert: markdown },
							selection: { anchor: range.from + markdown.length },
							annotations: Transaction.userEvent.of('input.paste'),
							scrollIntoView: true,
						});
						view.focus();
					})
					.catch(() => {
						pendingImageRanges.delete(id);
						options.onImageReadError?.();
					});
				return true;
			}

			const text = clipboardText(event);
			if (!text) return false;
			event.preventDefault();
			const selection = view.state.selection.main;
			const insert = prepareClipboardText(
				text,
				selection.from > 0 ? view.state.sliceDoc(selection.from - 1, selection.from) : '',
				selection.to < view.state.doc.length ? view.state.sliceDoc(selection.to, selection.to + 1) : '',
			);
			view.dispatch({
				changes: { from: selection.from, to: selection.to, insert },
				selection: { anchor: selection.from + insert.length },
				annotations: Transaction.userEvent.of('input.paste'),
				scrollIntoView: true,
			});
			view.focus();
			return true;
		},
	});
	const state = EditorState.create({
		doc: value,
		extensions: [
			markdownLanguageSupport,
			syntaxHighlighting(markdownLivePreviewHighlightStyle),
			livePreviewField,
			history(),
			editingKeymap,
			clipboardHandlers,
			EditorView.clipboardInputFilter.of(normalizeClipboardText),
			EditorView.lineWrapping,
			EditorView.theme(
				{
					'&': { height: '100%' },
					'.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
					'.cm-content': {
						padding: '22px 24px',
						minHeight: '100%',
						lineHeight: '1.75',
						caretColor: 'var(--input-caret)',
					},
					'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--input-caret) !important' },
				},
				{ dark: darkMode },
			),
			EditorView.updateListener.of((update) => {
				if (!update.docChanged) return;
				for (const [id, range] of pendingImageRanges) {
					const mappedFrom = update.changes.mapPos(range.from, range.empty ? 1 : -1);
					pendingImageRanges.set(id, {
						from: mappedFrom,
						to: range.empty ? mappedFrom : update.changes.mapPos(range.to, 1),
						empty: range.empty,
					});
				}
				const immediate = update.transactions.some(
					(transaction) => transaction.isUserEvent('input.paste') || transaction.isUserEvent('delete.cut'),
				);
				options.onChange(update.state.doc.toString(), immediate);
			}),
		],
	});
	return new EditorView({ state, parent });
}
