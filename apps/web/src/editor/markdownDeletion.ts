import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { WidgetType } from '@codemirror/view';
import { livePreviewField } from './markdownDecorations';
import { collectInlineExcludedRanges, collectObsidianInlineRanges } from './markdownStructure';
import { parsedWidgetContent } from './markdownWidgets';

export type DeleteDirection = 'backward' | 'forward';
export type DeleteRange = { from: number; to: number };

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

function syntaxNodeContent(source: string, nodeName: string): DeleteRange | null {
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
			if (!contentRange || candidate.to - candidate.from < contentRange.to - contentRange.from) contentRange = candidate;
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

function markerContentRange(source: string, markerFrom: number, markerTo: number, direction: DeleteDirection): DeleteRange | null {
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
