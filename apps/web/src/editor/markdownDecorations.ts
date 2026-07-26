import { EditorState, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { isMarkdownHeadingNode } from './markdownLiveHeadings';
import {
	collectInlineExcludedRanges,
	collectObsidianInlineRanges,
	collectStructuralBlocks,
	collectWikiLinkRanges,
	type StructuralBlock,
} from './markdownStructure';
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
} from './markdownWidgets';

type LinkDefinition = { href: string; title?: string };
type ResolvedLink = LinkDefinition & { label: string };
type InlineFormatKind = 'format' | 'code' | 'math' | 'highlight' | 'link' | 'image' | 'comment' | 'wikilink' | 'embed';

export type InlineFormatBlock = {
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

function normalizeReferenceLabel(value: string): string {
	return value.replace(/\\([\\[\]])/g, '$1').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
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

function inlineFormatKind(nodeName: string): InlineFormatKind {
	if (nodeName === 'InlineCode') return 'code';
	if (nodeName === 'Link' || nodeName === 'Autolink' || nodeName === 'URL') return 'link';
	if (nodeName === 'Image') return 'image';
	return 'format';
}

function isInsideStructuralBlock(from: number, to: number, blocks: StructuralBlock[]): boolean {
	return blocks.some((block) => from >= block.from && to <= block.to);
}

export function collectInlineFormatBlocks(state: EditorState, structuralBlocks: StructuralBlock[]): InlineFormatBlock[] {
	const candidates: InlineFormatBlock[] = [];
	const add = (candidate: InlineFormatBlock) => {
		if (candidate.to <= candidate.from || isInsideStructuralBlock(candidate.from, candidate.to, structuralBlocks)) return;
		candidates.push(candidate);
	};
	syntaxTree(state).iterate({
		enter(node) {
			if (node.name === 'LinkReference') return false;
			if (inlineFormatNodeNames.has(node.name))
				add({ from: node.from, to: node.to, kind: inlineFormatKind(node.name), name: node.name });
		},
	});

	let lineOffset = 0;
	for (const line of state.doc.toString().split('\n')) {
		for (const range of collectInlineExcludedRanges(line))
			add({ from: lineOffset + range.from, to: lineOffset + range.to, kind: range.kind });
		for (const range of collectObsidianInlineRanges(line))
			add({ from: lineOffset + range.from, to: lineOffset + range.to, kind: range.kind });
		for (const range of collectWikiLinkRanges(line))
			add({ from: lineOffset + range.from, to: lineOffset + range.to, kind: range.kind, name: range.kind });
		lineOffset += line.length + 1;
	}

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

export function selectionTouchesRange(state: EditorState, from: number, to: number): boolean {
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

type DocumentDecorationAnalysis = {
	tree: ReturnType<typeof syntaxTree>;
	text: string;
	blocks: StructuralBlock[];
	inlineBlocks: InlineFormatBlock[];
	inlineExclusions: Array<{ from: number; to: number }>;
	listItems: Array<{ from: number; to: number }>;
	headings: Array<{ from: number; to: number }>;
	resolvedLinks: Map<string, ResolvedLink>;
};

const documentAnalysisCache = new WeakMap<object, DocumentDecorationAnalysis>();

function analyzeDocument(state: EditorState): DocumentDecorationAnalysis {
	const tree = syntaxTree(state);
	const cached = documentAnalysisCache.get(state.doc);
	if (cached?.tree === tree) return cached;
	const text = state.doc.toString();
	const structuralBlocks = collectStructuralBlocks(text);
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
	const analysis = { tree, text, blocks, inlineBlocks, inlineExclusions, listItems, headings, resolvedLinks };
	documentAnalysisCache.set(state.doc, analysis);
	return analysis;
}

export function buildLivePreviewDecorations(state: EditorState): DecorationSet {
	try {
		const { tree, text, blocks, inlineBlocks, inlineExclusions, listItems, headings, resolvedLinks } =
			analyzeDocument(state);
		const decorations: { from: number; to: number; value: Decoration }[] = [];
		const add = (from: number, to: number, value: Decoration) => decorations.push({ from, to, value });
		for (const block of blocks) {
			const touched = selectionTouchesRange(state, block.from, block.to);
			if (!touched)
				add(block.from, block.to, Decoration.replace({ widget: new BlockWidget(block, text.slice(block.from, block.to)), block: true }));
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
			else if (inline.kind === 'math')
				add(inline.from, inline.to, Decoration.replace({ widget: new InlineMathWidget(source.slice(1, -1), inline.from, inline.to) }));
			else if (inline.kind === 'link')
				add(inline.from, inline.to, Decoration.replace({ widget: new LinkWidget(source, inline.from, inline.to, resolvedLinks.get(`${inline.from}:${inline.to}`)) }));
			else if (inline.kind === 'image')
				add(inline.from, inline.to, Decoration.replace({ widget: new ImageWidget(source, inline.from, inline.to) }));
			else if (inline.kind === 'wikilink' || inline.kind === 'embed') {
				const wiki = collectWikiLinkRanges(source)[0];
				if (wiki)
					add(inline.from, inline.to, Decoration.replace({ widget: new WikiLinkWidget(source, inline.from, inline.to, { ...wiki, from: 0, to: source.length }) }));
			} else
				add(inline.from, inline.to, Decoration.replace({ widget: new InlineMarkdownWidget(source, inline.from, inline.to, inline.kind) }));
		}
		for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
			const line = state.doc.line(lineNo);
			if (blocks.find((item) => line.from >= item.from && line.from < item.to)) continue;
			const listLine = /^(\s*)(?:[-+*]|\d+[.)])\s+/.exec(line.text);
			if (listLine) {
				const indent = listLine[1]!.replace(/\t/g, '  ').length;
				const depth = Math.min(8, Math.max(1, Math.floor(indent / 2) + 1));
				add(line.from, line.from, Decoration.line({ class: `cm-live-list-line cm-live-list-depth-${depth}` }));
			}
			const task = /^(\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]\s+/.exec(line.text);
			if (task) {
				const markerFrom = line.from + task[1].length;
				const markerTo = markerFrom + 3;
				const itemRange = containingRange(listItems, markerFrom, Math.min(line.to, markerTo + 1)) ?? { from: line.from, to: line.to };
				if (!selectionTouchesRange(state, itemRange.from, itemRange.to))
					add(markerFrom, markerTo, Decoration.replace({ widget: new CheckboxWidget(task[2].toLowerCase() === 'x', markerFrom, markerTo) }));
			}
		}
		const isInsideInlineBlock = (from: number, to: number) =>
			inlineExclusions.some((range) => from >= range.from && to <= range.to);
		tree.iterate({
			from: 0,
			to: state.doc.length,
			enter(node) {
				if (isInsideInlineBlock(node.from, node.to)) return;
				if (blocks.find((item) => node.from < item.to && node.to > item.from)) return;
				const isActive = selectionTouchesRange(state, node.from, node.to);
				if (node.name === 'HorizontalRule') {
					if (!isActive) add(node.from, node.to, Decoration.replace({ widget: new HorizontalRuleWidget(node.from, node.to) }));
					return;
				}
				if (isMarkdownHeadingNode(node.name)) {
					const level = node.name.at(-1);
					add(node.from, node.to, Decoration.mark({ class: `cm-live-heading cm-live-h${level}` }));
					if (!isActive) {
						const headerMark = node.node.getChild('HeaderMark');
						if (headerMark) {
							let contentStart = headerMark.to;
							while (contentStart < node.to && /\s/.test(state.sliceDoc(contentStart, contentStart + 1))) contentStart += 1;
							if (contentStart > headerMark.to) add(headerMark.to, contentStart, Decoration.replace({}));
						}
					}
					return;
				}
				if (node.name === 'LinkReference') {
					if (!isActive) add(node.from, node.to, Decoration.replace({}));
					return false;
				}
				if (['HeaderMark', 'EmphasisMark', 'CodeMark', 'LinkMark', 'StrikethroughMark', 'QuoteMark', 'ListMark'].includes(node.name)) {
					const activationRange = node.name === 'HeaderMark'
						? containingRange(headings, node.from, node.to)
						: node.name === 'ListMark'
							? containingRange(listItems, node.from, node.to)
							: undefined;
					const markerActive = activationRange ? selectionTouchesRange(state, activationRange.from, activationRange.to) : isActive;
					if (!markerActive && node.name === 'QuoteMark') add(node.from, node.to, Decoration.replace({}));
					else if (!markerActive && node.name === 'ListMark')
						add(node.from, node.to, Decoration.replace({ widget: new ListMarkerWidget(state.sliceDoc(node.from, node.to), node.from, node.to) }));
					else if (!markerActive) add(node.from, node.to, Decoration.replace({}));
				}
			},
		});
		return Decoration.set(decorations.map((item) => item.value.range(item.from, item.to)), true);
	} catch {
		return Decoration.none;
	}
}

export const livePreviewField = StateField.define<DecorationSet>({
	create: buildLivePreviewDecorations,
	update(decorations, transaction) {
		return transaction.docChanged || transaction.selection || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
			? buildLivePreviewDecorations(transaction.state)
			: decorations;
	},
	provide: (field) => EditorView.decorations.from(field),
});
