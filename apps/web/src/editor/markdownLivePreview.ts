import { EditorState, StateField, Transaction, type Extension } from '@codemirror/state';
import { defaultKeymap, deleteCharBackward, deleteCharForward, history, historyKeymap } from '@codemirror/commands';
import { EditorView, Decoration, WidgetType, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { GFM } from '@lezer/markdown';
import { tags } from '@lezer/highlight';
import {
	collectInlineExcludedRanges,
	collectObsidianInlineRanges,
	collectStructuralBlocks,
	collectWikiLinkRanges,
	type StructuralBlock,
	type WikiLinkRange,
} from './markdownStructure';
import { normalizeClipboardText, prepareClipboardText, readClipboardText } from './markdownClipboard';
import {
	editorHighlightField,
	editorHighlightPointerHandler,
	persistentContentHighlightEffect,
} from './editorHighlights';
export {
	clearSelectionHold,
	holdSelectionHighlight,
	markNewContent,
	showEditorHighlight,
	type EditorHighlightKind,
} from './editorHighlights';
import type { MarkdownHeading } from './markdownHeadings';
import {
	collectLiveMarkdownHeadings,
	isMarkdownHeadingNode,
	markdownHeadingPosition,
	scrollToMarkdownHeading,
} from './markdownLiveHeadings';
import {
	continueStructuredMarkdownLine,
	indentStructuredMarkdownLine,
	taskMarkerChange,
	toggleMarkdownWrap,
} from './markdownEditing';
import {
	BlockWidget,
	CheckboxWidget,
	HorizontalRuleWidget,
	ImageWidget,
	InlineMarkdownWidget,
	InlineMathWidget,
	LinkWidget,
	ListMarkerWidget,
	WikiLinkWidget,
	parsedWidgetContent,
} from './markdownWidgets';
import { aiReviewField } from './markdownAiReview';
import { livePreviewMouseSelectionStyle } from './markdownPointer';
export { buildAiReviewMarkDecorations, clearAiReview, showAiReview, type AiReviewSegment } from './markdownAiReview';
export {
	continueStructuredMarkdownLine,
	indentStructuredMarkdownLine,
	taskMarkerChange,
	toggleMarkdownWrap,
} from './markdownEditing';
export { markdownHeadingPosition, scrollToMarkdownHeading } from './markdownLiveHeadings';
export { geometricSourcePosition, visibleSourcePosition, type ScreenRect } from './markdownPointer';

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

type LinkDefinition = { href: string; title?: string };
type ResolvedLink = LinkDefinition & { label: string };

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
				if (isMarkdownHeadingNode(node.name)) headings.push({ from: node.from, to: node.to });
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
				if (isMarkdownHeadingNode(node.name)) {
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
	onHeadingsChange?: (headings: MarkdownHeading[]) => void;
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
							effects: persistentContentHighlightEffect(range.from, range.from + markdown.length),
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
				effects: persistentContentHighlightEffect(selection.from, selection.from + insert.length),
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
			editorHighlightField,
			aiReviewField,
			editorHighlightPointerHandler,
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
					options.onHeadingsChange(collectLiveMarkdownHeadings(update.state));
				}
			}),
		],
	});
	const view = new EditorView({ state, parent });
	// Defer the initial headings callback so callers can finish assigning `const view = ...`
	// before the outline code references the EditorView instance.
	queueMicrotask(() => {
		if (!view.dom.isConnected) return;
		options.onHeadingsChange?.(collectLiveMarkdownHeadings(view.state));
	});
	return view;
}
