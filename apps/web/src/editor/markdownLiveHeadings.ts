import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { createMarkdownHeading, markdownHeadingText, type MarkdownHeading } from './markdownHeadings';

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
