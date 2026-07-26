import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import {
	createMarkdownHeading,
	markdownHeadingText,
	slugifyMarkdownHeading,
	type MarkdownHeading,
} from './markdownHeadings';

export type PositionedMarkdownHeading = MarkdownHeading & { from: number };

export function isMarkdownHeadingNode(name: string): boolean {
	return /^ATXHeading[1-6]$|^SetextHeading[12]$/.test(name);
}

export function collectLiveMarkdownHeadings(state: EditorState): PositionedMarkdownHeading[] {
	const headings: PositionedMarkdownHeading[] = [];
	const usedIds = new Set<string>();
	syntaxTree(state).iterate({
		enter(node) {
			if (!isMarkdownHeadingNode(node.name)) return;
			const level = node.name.startsWith('ATXHeading')
				? Number(node.name.slice('ATXHeading'.length))
				: Number(node.name.slice('SetextHeading'.length));
			const source = state.sliceDoc(node.from, node.to);
			headings.push({
				...createMarkdownHeading(markdownHeadingText(source, node.name), level, usedIds),
				from: node.from,
			});
		},
	});
	return headings;
}

export function markdownHeadingPosition(view: EditorView, hash: string): number | null {
	let id: string;
	try {
		id = decodeURIComponent(hash.startsWith('#') ? hash.slice(1) : hash);
	} catch {
		return null;
	}
	const slug = slugifyMarkdownHeading(id);
	const heading = collectLiveMarkdownHeadings(view.state).find(
		(item) => item.id === id || item.id === slug || slugifyMarkdownHeading(item.text) === slug,
	);
	return heading?.from ?? null;
}

export function scrollToMarkdownHeading(view: EditorView, hash: string): boolean {
	const position = markdownHeadingPosition(view, hash);
	if (position === null) return false;
	view.dispatch({ selection: { anchor: position } });
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
