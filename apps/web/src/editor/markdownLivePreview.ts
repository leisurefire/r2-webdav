import {
	EditorSelection,
	EditorState,
	StateEffect,
	StateField,
	Transaction,
	type SelectionRange,
} from '@codemirror/state';
import { defaultKeymap, deleteCharBackward, deleteCharForward, history, historyKeymap } from '@codemirror/commands';
import {
	EditorView,
	Decoration,
	WidgetType,
	keymap,
	lineNumbers,
	type DecorationSet,
	type MouseSelectionStyle,
	type ViewUpdate,
} from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { GFM } from '@lezer/markdown';
import { tags } from '@lezer/highlight';
import katex from 'katex';
import {
	collectInlineExcludedRanges,
	collectObsidianInlineRanges,
	collectStructuralBlocks,
	collectWikiLinkRanges,
	continueMarkdownStructuredLine,
	indentMarkdownListLine,
	parseFrontmatterBlock,
	parseTableBlock,
	tableCellSourceRanges,
	type StructuralBlock,
	type WikiLinkRange,
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

export function toggleMarkdownWrap(view: EditorView, marker: string): boolean {
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

/** Continue list / blockquote lines on Enter like Obsidian Live Preview. */
export function continueStructuredMarkdownLine(view: EditorView): boolean {
	const selection = view.state.selection.main;
	if (!selection.empty) return false;
	const line = view.state.doc.lineAt(selection.head);
	const continuation = continueMarkdownStructuredLine(line.text, selection.head - line.from);
	if (!continuation) return false;
	view.dispatch({
		changes: {
			from: line.from + continuation.replaceFrom,
			to: line.from + continuation.replaceTo,
			insert: continuation.insert,
		},
		selection: { anchor: line.from + continuation.cursor },
		annotations: Transaction.userEvent.of('input'),
		scrollIntoView: true,
	});
	return true;
}

export function indentStructuredMarkdownLine(view: EditorView, direction: 'indent' | 'outdent'): boolean {
	const selection = view.state.selection.main;
	if (!selection.empty) return false;
	const line = view.state.doc.lineAt(selection.head);
	const next = indentMarkdownListLine(line.text, direction);
	if (next === null || next === line.text) return false;
	const delta = next.length - line.text.length;
	const cursorInLine = selection.head - line.from;
	const cursor = Math.max(0, Math.min(cursorInLine + delta, next.length));
	view.dispatch({
		changes: { from: line.from, to: line.to, insert: next },
		selection: { anchor: line.from + cursor },
		annotations: Transaction.userEvent.of('input'),
	});
	return true;
}

type LinkDefinition = { href: string; title?: string };
type ResolvedLink = LinkDefinition & { label: string };

function isMarkdownHeading(name: string): boolean {
	return /^ATXHeading[1-6]$|^SetextHeading[12]$/.test(name);
}

function slugifyHeadingText(value: string): string {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, '-')
			.replace(/^-|-$/g, '') || 'section'
	);
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
		id = decodeURIComponent(hash.startsWith('#') ? hash.slice(1) : hash);
	} catch {
		return null;
	}
	const slug = slugifyHeadingText(id);
	const headingIndex = renderMarkdownDocument(view.state.doc.toString()).headings.findIndex(
		(heading) => heading.id === id || heading.id === slug || slugifyHeadingText(heading.text) === slug,
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

export function markdownHeadingPosition(view: EditorView, hash: string): number | null {
	return headingPositionForHash(view, hash);
}

export function scrollToMarkdownHeading(view: EditorView, hash: string): boolean {
	const position = headingPositionForHash(view, hash);
	if (position === null) return false;
	view.dispatch({
		selection: { anchor: position },
	});
	view.focus();
	requestAnimationFrame(() => {
		const coords = view.coordsAtPos(position);
		if (!coords) return;
		const scroller = view.scrollDOM;
		const scrollerRect = scroller.getBoundingClientRect();
		const top = scroller.scrollTop + coords.top - scrollerRect.top - 18;
		scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
	});
	return true;
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

type DOMCaret = { offsetNode: Node; offset: number };

function domCaretAtPoint(x: number, y: number): DOMCaret | null {
	const caretDocument = document as Document & {
		caretPositionFromPoint?: (clientX: number, clientY: number) => { offsetNode: Node; offset: number } | null;
		caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
	};
	const caret = caretDocument.caretPositionFromPoint?.(x, y);
	if (caret) return caret;
	const range = caretDocument.caretRangeFromPoint?.(x, y);
	return range ? { offsetNode: range.startContainer, offset: range.startOffset } : null;
}

function textOffsetAtPoint(node: HTMLElement, x: number, y: number): number | null {
	const caret = domCaretAtPoint(x, y);
	if (!caret || (caret.offsetNode !== node && !node.contains(caret.offsetNode))) return null;
	try {
		const prefix = document.createRange();
		prefix.selectNodeContents(node);
		prefix.setEnd(caret.offsetNode, caret.offset);
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
	let position: number;
	if (mode === 'text') {
		const visible = node.textContent ?? '';
		const visibleOffset = textOffsetAtPoint(node, x, y);
		if (visible && visibleOffset !== null) position = from + visibleSourcePosition(source, visible, visibleOffset);
		else position = from + geometricSourcePosition(source, x, y, node.getBoundingClientRect());
	} else {
		position = from + geometricSourcePosition(source, x, y, node.getBoundingClientRect());
	}
	return Math.max(from, Math.min(from + source.length, position));
}

function clampToSourceInterior(from: number, source: string, position: number): number {
	if (source.length < 2) return from;
	return Math.max(from + 1, Math.min(from + source.length - 1, position));
}

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

type PointerPosition = { pos: number; assoc: -1 | 1 };

function pointerSourceTarget(event: MouseEvent): HTMLElement | null {
	return event.target instanceof Element ? event.target.closest<HTMLElement>('.cm-live-source-target') : null;
}

function pointerPosition(view: EditorView, event: MouseEvent): PointerPosition {
	const sourceTarget = pointerSourceTarget(event);
	if (sourceTarget) {
		const from = Number(sourceTarget.dataset.sourceFrom);
		const to = Number(sourceTarget.dataset.sourceTo);
		if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
			const source = view.state.sliceDoc(from, to);
			const mode: SourcePointerMode = sourceTarget.dataset.sourceMode === 'geometry' ? 'geometry' : 'text';
			const mapped = sourcePositionAtPointer(sourceTarget, from, source, event.clientX, event.clientY, mode);
			const pos = sourceTarget.dataset.sourceInterior === 'true' ? clampToSourceInterior(from, source, mapped) : mapped;
			return { pos, assoc: pos <= from ? 1 : -1 };
		}
	}

	const caret = domCaretAtPoint(event.clientX, event.clientY);
	if (caret && view.contentDOM.contains(caret.offsetNode)) {
		try {
			const pos = view.posAtDOM(caret.offsetNode, caret.offset);
			const coords = view.coordsAtPos(pos);
			const assoc = !coords || event.clientX <= (coords.left + coords.right) / 2 ? 1 : -1;
			return { pos, assoc };
		} catch {
			// Fall through when the browser caret lands in an unmappable decoration node.
		}
	}
	return view.posAndSideAtCoords({ x: event.clientX, y: event.clientY }, false);
}

function pointerRange(state: EditorState, position: PointerPosition, clickType: number): SelectionRange {
	if (clickType <= 1) return EditorSelection.cursor(position.pos, position.assoc);
	if (clickType === 2) return state.wordAt(position.pos) ?? EditorSelection.cursor(position.pos, position.assoc);
	const line = state.doc.lineAt(position.pos);
	return EditorSelection.range(line.from, line.to < state.doc.length ? line.to + 1 : line.to);
}

function livePreviewMouseSelectionStyle(view: EditorView, startEvent: MouseEvent): MouseSelectionStyle | null {
	if (startEvent.button !== 0) return null;
	const target = startEvent.target instanceof Element ? startEvent.target : null;
	if (target?.closest('button,input,textarea,select,summary')) return null;
	if (target?.closest('a') && (startEvent.ctrlKey || startEvent.metaKey || startEvent.shiftKey || startEvent.altKey))
		return null;

	let start = pointerPosition(view, startEvent);
	let startSelection = view.state.selection;
	const clickType = Math.max(1, Math.min(startEvent.detail, 3));
	return {
		get(curEvent, extend, multiple) {
			const current = pointerPosition(view, curEvent);
			let range = pointerRange(view.state, current, clickType);
			if (current.pos !== start.pos && !extend) {
				const startRange = pointerRange(view.state, start, clickType);
				const from = Math.min(startRange.from, range.from);
				const to = Math.max(startRange.to, range.to);
				range = current.pos < start.pos ? EditorSelection.range(to, from) : EditorSelection.range(from, to);
			}
			if (extend) return startSelection.replaceRange(startSelection.main.extend(range.from, range.to));
			if (multiple) return startSelection.addRange(range);
			return EditorSelection.create([range]);
		},
		update(update: ViewUpdate) {
			if (!update.docChanged) return;
			start = { ...start, pos: update.changes.mapPos(start.pos) };
			startSelection = startSelection.map(update.changes);
		},
	};
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

class CheckboxWidget extends WidgetType {
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

class InlineMathWidget extends SourceWidget {
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

class InlineMarkdownWidget extends SourceWidget {
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

class LinkWidget extends SourceWidget {
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
				const position = headingPositionForHash(view, href);
				if (position !== null) view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'start' }) });
				return;
			}
			if (/^[a-z][a-z0-9+.-]*:/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
		});
		return anchor;
	}
}

class HorizontalRuleWidget extends SourceWidget {
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

class ImageWidget extends SourceWidget {
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

class ListMarkerWidget extends SourceWidget {
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

class BlockWidget extends SourceWidget {
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

class WikiLinkWidget extends SourceWidget {
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
			anchor.href = `#${slugifyHeadingText(headingTarget)}`;
			anchor.textContent = label;
			anchor.addEventListener('click', (event) => {
				if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
				event.preventDefault();
				const position = headingPositionForHash(view, headingTarget);
				if (position === null) return;
				view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'start' }) });
			});
		}
		bindSourceNavigation(node, this.from, this.source, 'text');
		return node;
	}
}

type InlineFormatKind = 'format' | 'code' | 'math' | 'highlight' | 'link' | 'image' | 'comment' | 'wikilink' | 'embed';

type InlineFormatBlock = {
	from: number;
	to: number;
	kind: InlineFormatKind;
	name?: string;
};

const inlineFormatNodeNames = new Set([
	'StrongEmphasis',
	'Emphasis',
	'Strikethrough',
	'InlineCode',
	'Link',
	'Image',
	'Autolink',
	'URL',
]);

function inlineFormatKind(nodeName: string): InlineFormatKind {
	if (nodeName === 'InlineCode') return 'code';
	if (nodeName === 'Link' || nodeName === 'Autolink' || nodeName === 'URL') return 'link';
	if (nodeName === 'Image') return 'image';
	return 'format';
}

function isInsideStructuralBlock(from: number, to: number, blocks: StructuralBlock[]): boolean {
	return blocks.some((block) => from >= block.from && to <= block.to);
}

/**
 * Collect complete inline syntax units. Live preview must operate on these ranges,
 * rather than on lines: a click expands only the formatting unit it lands in.
 */
function collectInlineFormatBlocks(state: EditorState, structuralBlocks: StructuralBlock[]): InlineFormatBlock[] {
	const candidates: InlineFormatBlock[] = [];
	const add = (candidate: InlineFormatBlock) => {
		if (candidate.to <= candidate.from || isInsideStructuralBlock(candidate.from, candidate.to, structuralBlocks))
			return;
		candidates.push(candidate);
	};
	const tree = syntaxTree(state);
	tree.iterate({
		enter(node) {
			if (node.name === 'LinkReference') return false;
			if (inlineFormatNodeNames.has(node.name))
				add({ from: node.from, to: node.to, kind: inlineFormatKind(node.name), name: node.name });
		},
	});

	let lineOffset = 0;
	for (const line of state.doc.toString().split('\n')) {
		for (const range of collectInlineExcludedRanges(line))
			add({
				from: lineOffset + range.from,
				to: lineOffset + range.to,
				kind: range.kind,
			});
		for (const range of collectObsidianInlineRanges(line))
			add({
				from: lineOffset + range.from,
				to: lineOffset + range.to,
				kind: range.kind,
			});
		for (const range of collectWikiLinkRanges(line))
			add({
				from: lineOffset + range.from,
				to: lineOffset + range.to,
				kind: range.kind,
				name: range.kind,
			});
		lineOffset += line.length + 1;
	}

	// Prefer one outer range for nested syntax. Rendering the outer source lets the
	// Markdown renderer handle nested emphasis and prevents overlapping replacements.
	const priority: Record<InlineFormatKind, number> = {
		link: 7,
		image: 6,
		wikilink: 5,
		embed: 5,
		math: 4,
		code: 3,
		highlight: 2,
		format: 1,
		comment: 0,
	};
	const byRange = new Map<string, InlineFormatBlock>();
	for (const candidate of candidates) {
		const key = `${candidate.from}:${candidate.to}`;
		const previous = byRange.get(key);
		if (!previous || priority[candidate.kind] > priority[previous.kind]) byRange.set(key, candidate);
	}
	const unique = [...byRange.values()];
	return unique
		.filter(
			(candidate) =>
				!unique.some(
					(parent) =>
						parent !== candidate &&
						parent.from <= candidate.from &&
						parent.to >= candidate.to &&
						(parent.from < candidate.from || parent.to > candidate.to),
				),
		)
		.sort((left, right) => left.from - right.from || right.to - left.to);
}

function selectionTouchesRange(state: EditorState, from: number, to: number): boolean {
	return state.selection.ranges.some((selection) =>
		selection.empty ? selection.from >= from && selection.from <= to : selection.from < to && selection.to > from,
	);
}

function selectionTouchesInlineRange(state: EditorState, from: number, to: number): boolean {
	return state.selection.ranges.some((selection) =>
		selection.empty ? selection.from > from && selection.from < to : selection.from < to && selection.to > from,
	);
}

function containingRange(ranges: Array<{ from: number; to: number }>, from: number, to: number) {
	return ranges
		.filter((range) => range.from <= from && range.to >= to)
		.sort((left, right) => left.to - left.from - (right.to - right.from))[0];
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
		const inlineBlocks = collectInlineFormatBlocks(state, blocks);
		const inlineExclusions = inlineBlocks.map(({ from, to }) => ({ from, to }));
		const listItems: Array<{ from: number; to: number }> = [];
		const headings: Array<{ from: number; to: number }> = [];
		tree.iterate({
			enter(node) {
				if (node.name === 'ListItem') listItems.push({ from: node.from, to: node.to });
				if (isMarkdownHeading(node.name)) headings.push({ from: node.from, to: node.to });
			},
		});
		const references = new Map<string, LinkDefinition>();
		tree.iterate({
			enter(node) {
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
		const resolvedLinks = new Map<string, ResolvedLink>();
		tree.iterate({
			enter(node) {
				if (node.name !== 'Link' || node.node.getChild('URL')) return;
				const marks = node.node.getChildren('LinkMark');
				const labelStart = marks[0]?.to ?? node.from + 1;
				const labelEnd = marks[1]?.from ?? labelStart;
				const label = state.sliceDoc(labelStart, labelEnd);
				const referenceLabel = node.node.getChild('LinkLabel');
				const key = normalizeReferenceLabel(
					referenceLabel ? state.sliceDoc(referenceLabel.from + 1, referenceLabel.to - 1) || label : label,
				);
				const definition = references.get(key);
				if (definition) resolvedLinks.set(`${node.from}:${node.to}`, { ...definition, label });
			},
		});
		const decorations: { from: number; to: number; value: Decoration }[] = [];
		const add = (from: number, to: number, value: Decoration) => decorations.push({ from, to, value });
		for (const block of blocks) {
			const touched = selectionTouchesRange(state, block.from, block.to);
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
		for (const inline of inlineBlocks) {
			if (selectionTouchesInlineRange(state, inline.from, inline.to)) continue;
			const source = text.slice(inline.from, inline.to);
			if (inline.kind === 'comment') add(inline.from, inline.to, Decoration.replace({}));
			else if (inline.kind === 'math') {
				add(
					inline.from,
					inline.to,
					Decoration.replace({ widget: new InlineMathWidget(source.slice(1, -1), inline.from, inline.to) }),
				);
			} else if (inline.kind === 'link') {
				add(
					inline.from,
					inline.to,
					Decoration.replace({
						widget: new LinkWidget(source, inline.from, inline.to, resolvedLinks.get(`${inline.from}:${inline.to}`)),
					}),
				);
			} else if (inline.kind === 'image')
				add(inline.from, inline.to, Decoration.replace({ widget: new ImageWidget(source, inline.from, inline.to) }));
			else if (inline.kind === 'wikilink' || inline.kind === 'embed') {
				const wiki = collectWikiLinkRanges(source)[0];
				if (wiki)
					add(
						inline.from,
						inline.to,
						Decoration.replace({
							widget: new WikiLinkWidget(source, inline.from, inline.to, {
								...wiki,
								from: 0,
								to: source.length,
							}),
						}),
					);
			} else
				add(
					inline.from,
					inline.to,
					Decoration.replace({ widget: new InlineMarkdownWidget(source, inline.from, inline.to, inline.kind) }),
				);
		}
		for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
			const line = state.doc.line(lineNo);
			const block = blocks.find((item) => line.from >= item.from && line.from < item.to);
			if (block) continue;
			const lineText = line.text;
			const listLine = /^(\s*)(?:[-+*]|\d+[.)])\s+/.exec(lineText);
			if (listLine) {
				const indent = listLine[1]!.replace(/\t/g, '  ').length;
				const depth = Math.min(8, Math.max(1, Math.floor(indent / 2) + 1));
				add(line.from, line.from, Decoration.line({ class: `cm-live-list-line cm-live-list-depth-${depth}` }));
			}
			const task = /^(\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]\s+/.exec(lineText);
			if (task) {
				const markerFrom = line.from + task[1].length;
				const markerTo = markerFrom + 3;
				const itemRange = containingRange(listItems, markerFrom, Math.min(line.to, markerTo + 1)) ?? {
					from: line.from,
					to: line.to,
				};
				if (!selectionTouchesRange(state, itemRange.from, itemRange.to))
					add(
						markerFrom,
						markerTo,
						Decoration.replace({
							widget: new CheckboxWidget(task[2].toLowerCase() === 'x', markerFrom, markerTo),
						}),
					);
			}
		}
		const isInsideInlineBlock = (from: number, to: number) =>
			inlineExclusions.some((range) => from >= range.from && to <= range.to);
		tree.iterate({
			from: 0,
			to: state.doc.length,
			enter: (node) => {
				if (isInsideInlineBlock(node.from, node.to)) return;
				const block = blocks.find((item) => node.from < item.to && node.to > item.from);
				if (block) return;
				const isActive = selectionTouchesRange(state, node.from, node.to);
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
				if (node.name === 'LinkReference') {
					if (!isActive) add(node.from, node.to, Decoration.replace({}));
					return false;
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
					const activationRange =
						node.name === 'HeaderMark'
							? containingRange(headings, node.from, node.to)
							: node.name === 'ListMark'
								? containingRange(listItems, node.from, node.to)
								: undefined;
					const markerActive = activationRange
						? selectionTouchesRange(state, activationRange.from, activationRange.to)
						: isActive;
					if (!markerActive && node.name === 'QuoteMark') {
						add(node.from, node.to, Decoration.replace({}));
					} else if (!markerActive && node.name === 'ListMark') {
						add(
							node.from,
							node.to,
							Decoration.replace({
								widget: new ListMarkerWidget(state.sliceDoc(node.from, node.to), node.from, node.to),
							}),
						);
					} else if (!markerActive) add(node.from, node.to, Decoration.replace({}));
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
	onHeadingsChange?: (headings: ReturnType<typeof renderMarkdownDocument>['headings']) => void;
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
		{ key: 'Enter', run: continueStructuredMarkdownLine },
		{ key: 'Tab', run: (view) => indentStructuredMarkdownLine(view, 'indent') },
		{ key: 'Shift-Tab', run: (view) => indentStructuredMarkdownLine(view, 'outdent') },
		{ key: 'Mod-b', run: (view) => toggleMarkdownWrap(view, '**') },
		{ key: 'Mod-i', run: (view) => toggleMarkdownWrap(view, '*') },
		{ key: 'Mod-Shift-s', run: (view) => toggleMarkdownWrap(view, '~~') },
		{ key: 'Mod-`', run: (view) => toggleMarkdownWrap(view, '`') },
		...defaultKeymap,
		...historyKeymap,
	]);
	const clearNewOnPointer = EditorView.domEventHandlers({
		mousedown(_event, view) {
			const marks = view.state.field(newContentField, false);
			if (!marks || marks.size === 0) return;
			view.dispatch({ effects: newContentEffect.of({ from: 0, to: 0 }) });
		},
	});
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
							effects: newContentEffect.of({ from: range.from, to: range.from + markdown.length }),
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
				effects: newContentEffect.of({ from: selection.from, to: selection.from + insert.length }),
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
			newContentField,
			aiReviewField,
			selectionHoldField,
			clearNewOnPointer,
			EditorView.mouseSelectionStyle.of(livePreviewMouseSelectionStyle),
			history(),
			editingKeymap,
			clipboardHandlers,
			EditorView.clipboardInputFilter.of(normalizeClipboardText),
			lineNumbers(),
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
				if (update.docChanged) {
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
				}
				if (options.onHeadingsChange && update.docChanged) {
					options.onHeadingsChange(renderMarkdownDocument(update.state.doc.toString()).headings);
				}
			}),
		],
	});
	const view = new EditorView({ state, parent });
	// Defer the initial headings callback so callers can finish assigning `const view = ...`
	// before the outline code references the EditorView instance.
	queueMicrotask(() => {
		if (!view.dom.isConnected) return;
		options.onHeadingsChange?.(renderMarkdownDocument(view.state.doc.toString()).headings);
	});
	return view;
}

/**
 * Temporary highlight for freshly pasted or AI-inserted content.
 * The highlight clears on any further user edit or pointer interaction.
 */
const newContentEffect = StateEffect.define<{ from: number; to: number }>();

const newContentField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, transaction) {
		let next = deco.map(transaction.changes);
		for (const effect of transaction.effects) {
			if (effect.is(newContentEffect)) {
				if (effect.value.to > effect.value.from)
					next = next.update({
						add: [Decoration.mark({ class: 'cm-live-new-content' }).range(effect.value.from, effect.value.to)],
					});
				else next = Decoration.none;
			}
		}
		if (
			transaction.docChanged &&
			!transaction.isUserEvent('input.paste') &&
			!transaction.effects.some((effect) => effect.is(newContentEffect))
		)
			next = Decoration.none;
		return next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

/**
 * AI review mode: character-level deleted/inserted marks inside a unified preview.
 * Segments are stored with absolute document positions and remapped across edits.
 */
export type AiReviewSegment = { from: number; to: number; kind: 'deleted' | 'inserted' };

const aiReviewSetEffect = StateEffect.define<AiReviewSegment[] | null>();

export function buildAiReviewMarkDecorations(segments: AiReviewSegment[]): DecorationSet {
	const ranges = segments
		.filter((segment) => segment.to > segment.from)
		.map((segment) =>
			Decoration.mark({
				class: segment.kind === 'deleted' ? 'cm-ai-review-deleted' : 'cm-ai-review-inserted',
			}).range(segment.from, segment.to),
		);
	return ranges.length ? Decoration.set(ranges, true) : Decoration.none;
}

const aiReviewField = StateField.define<{ segments: AiReviewSegment[] | null; decorations: DecorationSet }>({
	create: () => ({ segments: null, decorations: Decoration.none }),
	update(value, transaction) {
		let segments = value.segments;
		let rebuild = false;
		for (const effect of transaction.effects) {
			if (effect.is(aiReviewSetEffect)) {
				segments = effect.value;
				rebuild = true;
			}
		}
		if (!segments || segments.length === 0) {
			if (!rebuild && value.segments === null) return value;
			return { segments: null, decorations: Decoration.none };
		}
		if (transaction.docChanged) {
			segments = segments
				.map((segment) => ({
					from: transaction.changes.mapPos(segment.from, 1),
					to: transaction.changes.mapPos(segment.to, -1),
					kind: segment.kind,
				}))
				.filter((segment) => segment.to > segment.from);
			rebuild = true;
		}
		if (!rebuild) return value;
		return { segments, decorations: buildAiReviewMarkDecorations(segments) };
	},
	provide: (field) => EditorView.decorations.from(field, (state) => state.decorations),
});

/** Highlight a freshly inserted range (paste or AI insert) until the next edit/click. */
export function markNewContent(view: EditorView, from: number, to: number): void {
	if (to <= from) return;
	view.dispatch({ effects: newContentEffect.of({ from, to }) });
}

/** Show the AI review decoration for a character-level rewrite preview. */
export function showAiReview(view: EditorView, segments: AiReviewSegment[]): void {
	view.dispatch({ effects: aiReviewSetEffect.of(segments) });
}

/** Clear the AI review decoration (accept, undo, or abort). */
export function clearAiReview(view: EditorView): void {
	view.dispatch({ effects: aiReviewSetEffect.of(null) });
}

/**
 * Persist a soft selection highlight while the AI panel steals focus.
 * Active (editor focused / panel open): light blue; inactive: light gray.
 */
const selectionHoldEffect = StateEffect.define<{ from: number; to: number } | null>();

const selectionHoldField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, transaction) {
		let next = deco.map(transaction.changes);
		for (const effect of transaction.effects) {
			if (effect.is(selectionHoldEffect)) {
				if (!effect.value || effect.value.to <= effect.value.from) next = Decoration.none;
				else
					next = Decoration.set([
						Decoration.mark({ class: 'cm-ai-selection-hold' }).range(effect.value.from, effect.value.to),
					]);
			}
		}
		return next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

/** Show a durable selection highlight independent of native focus. */
export function holdSelectionHighlight(view: EditorView, from: number, to: number): void {
	if (to <= from) {
		view.dispatch({ effects: selectionHoldEffect.of(null) });
		return;
	}
	view.dispatch({ effects: selectionHoldEffect.of({ from, to }) });
}

/** Clear the durable selection highlight. */
export function clearSelectionHold(view: EditorView): void {
	view.dispatch({ effects: selectionHoldEffect.of(null) });
}
