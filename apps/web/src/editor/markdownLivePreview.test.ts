import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { livePreviewField, markdownLanguageSupport, taskMarkerChange } from './markdownLivePreview';

const REPORTED_SOURCE =
	'包含变量 $x_1,x_2,\\cdots,x_n$ 的**线性方程**是形如\n\n$$\na_1x_1+a_2x_2+\\cdots+a_nx_n=b\n$$\n\n的方程. 其中 $b$ 与系数 $a_1,a_2,\\cdots,a_n$ 是实数或复数，通常是已知数. 下标 $n$ 则是任意正整数.';

function createState(doc = ''): EditorState {
	return EditorState.create({ doc, extensions: [markdownLanguageSupport, livePreviewField] });
}

function blockReplacements(state: EditorState): Array<{ from: number; to: number }> {
	const blocks: Array<{ from: number; to: number }> = [];
	state.field(livePreviewField).between(0, state.doc.length, (from, to, decoration) => {
		if (decoration.spec.block) blocks.push({ from, to });
	});
	return blocks;
}

function widgetReplacements(state: EditorState): Array<{ from: number; to: number; name: string }> {
	const replacements: Array<{ from: number; to: number; name: string }> = [];
	state.field(livePreviewField).between(0, state.doc.length, (from, to, decoration) => {
		if (decoration.spec.widget) replacements.push({ from, to, name: decoration.spec.widget.constructor.name });
	});
	return replacements;
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

	it('renders inactive links as navigable widgets', () => {
		const source = 'intro\n\n[docs](https://example.com) and <https://example.org>\nwww.example.net/path';
		const replacements = widgetReplacements(createState(source));
		expect(replacements.filter(({ name }) => name === 'LinkWidget')).toHaveLength(3);
		expect(replacements.map(({ from, to }) => source.slice(from, to))).toEqual([
			'[docs](https://example.com)',
			'<https://example.org>',
			'www.example.net/path',
		]);
	});

	it('renders inline math inside a link without overlapping widgets', () => {
		const source = 'intro\n\n[formula $x^2$](https://example.com)';
		const replacements = widgetReplacements(createState(source));
		expect(replacements).toEqual([
			{
				from: source.indexOf('['),
				to: source.length,
				name: 'LinkWidget',
			},
		]);
	});

	it('styles Setext headings through the same heading decoration path', () => {
		const source = 'intro\n\nSection\n===';
		const state = createState(source);
		let hasHeading = false;
		state.field(livePreviewField).between(0, state.doc.length, (_from, _to, decoration) => {
			if (decoration.spec.class === 'cm-live-heading cm-live-h1') hasHeading = true;
		});
		expect(hasHeading).toBe(true);
	});

	it('resolves reference links and hides their definitions in preview mode', () => {
		const source = 'intro\n\n[docs][guide]\n\n[guide]: https://example.com "Docs"';
		const replacements = widgetReplacements(createState(source));
		expect(
			replacements.some(({ name, from, to }) => name === 'LinkWidget' && source.slice(from, to) === '[docs][guide]'),
		).toBe(true);
		expect(replacements.some(({ from, to }) => source.slice(from, to) === '[guide]: https://example.com "Docs"')).toBe(
			false,
		);
	});

	it('replaces the complete task marker without nesting brackets', () => {
		const initial = EditorState.create({ doc: '- [ ] done' });
		const checked = initial.update({ changes: taskMarkerChange(2, 5, true) }).state;
		const unchecked = checked.update({ changes: taskMarkerChange(2, 5, false) }).state;
		expect(checked.doc.toString()).toBe('- [x] done');
		expect(unchecked.doc.toString()).toBe('- [ ] done');
	});
});
