import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { collectInlineFormatBlocks, selectionTouchesRange } from './markdownDecorations';
import { markdownLanguageSupport } from './markdownEditor';

function state(doc: string, anchor = 0): EditorState {
	return EditorState.create({ doc, selection: { anchor }, extensions: [markdownLanguageSupport] });
}

describe('markdown decoration ranges', () => {
	it('keeps only the outer range for nested inline syntax', () => {
		const source = 'before **outer *inner* text** after';
		const blocks = collectInlineFormatBlocks(state(source), []);
		expect(blocks.map(({ from, to, kind }) => ({ source: source.slice(from, to), kind }))).toEqual([
			{ source: '**outer *inner* text**', kind: 'format' },
		]);
	});

	it('does not collect inline ranges owned by a structural widget', () => {
		const source = '| Name | Value |\n| --- | --- |\n| **A** | 1 |';
		expect(collectInlineFormatBlocks(state(source), [{ from: 0, to: source.length, kind: 'table' }])).toEqual([]);
	});

	it('treats an empty cursor on either range boundary as touching the range', () => {
		const source = '**bold**';
		expect(selectionTouchesRange(state(source, 0), 0, source.length)).toBe(true);
		expect(selectionTouchesRange(state(source, source.length), 0, source.length)).toBe(true);
	});
});
