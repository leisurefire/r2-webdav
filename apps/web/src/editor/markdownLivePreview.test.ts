import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { describe, expect, it } from 'vitest';
import { livePreviewField } from './markdownLivePreview';

const REPORTED_SOURCE =
	'包含变量 $x_1,x_2,\\cdots,x_n$ 的**线性方程**是形如\n\n$$\na_1x_1+a_2x_2+\\cdots+a_nx_n=b\n$$\n\n的方程. 其中 $b$ 与系数 $a_1,a_2,\\cdots,a_n$ 是实数或复数，通常是已知数. 下标 $n$ 则是任意正整数.';

function createState(doc = ''): EditorState {
	return EditorState.create({ doc, extensions: [markdown(), livePreviewField] });
}

function blockReplacements(state: EditorState): Array<{ from: number; to: number }> {
	const blocks: Array<{ from: number; to: number }> = [];
	state.field(livePreviewField).between(0, state.doc.length, (from, to, decoration) => {
		if (decoration.spec.block) blocks.push({ from, to });
	});
	return blocks;
}

describe('live preview block decorations', () => {
	it('loads the reported mixed Markdown and math document', () => {
		const state = createState(REPORTED_SOURCE);
		const blocks = blockReplacements(state);
		expect(blocks).toHaveLength(1);
		expect(state.sliceDoc(blocks[0].from, blocks[0].to)).toBe('$$\na_1x_1+a_2x_2+\\cdots+a_nx_n=b\n$$');
	});

	it('rebuilds a valid block decoration after a paste transaction', () => {
		const initial = createState();
		const transaction = initial.update({
			changes: { from: 0, insert: REPORTED_SOURCE },
			selection: { anchor: REPORTED_SOURCE.length },
		});
		const state = transaction.state;
		expect(blockReplacements(state)).toHaveLength(1);
		expect(state.doc.toString()).toBe(REPORTED_SOURCE);
	});

	it('does not create a block replacement for an unfinished formula', () => {
		expect(blockReplacements(createState('before\n\n$$\nx + y\nafter'))).toEqual([]);
	});
});
