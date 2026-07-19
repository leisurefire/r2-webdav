import { EditorState } from '@codemirror/state';
import { history, undoDepth } from '@codemirror/commands';
import { tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';
import {
	geometricSourcePosition,
	livePreviewField,
	markdownLanguageSupport,
	markdownLivePreviewHighlightStyle,
	parsedDeleteRange,
	taskMarkerChange,
	visibleSourcePosition,
} from './markdownLivePreview';

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
	it('maps visible formatted text before the source block expands', () => {
		const source = '**bold** and [docs](https://example.com/a-long-destination)';
		expect(visibleSourcePosition(source, 'bold and docs', 4)).toBe(6);
		expect(visibleSourcePosition(source, 'bold and docs', 13)).toBe(source.indexOf('docs') + 4);
	});

	it('maps geometry to the correct source row for a multi-line block', () => {
		const source = 'first line\nsecond line\nthird line';
		expect(geometricSourcePosition(source, 245, 165, { left: 100, right: 300, top: 100, bottom: 200 })).toBe(
			source.indexOf('second line') + 8,
		);
	});

	it('places the heading underline reset after the default highlight rules', () => {
		expect(markdownLivePreviewHighlightStyle.specs.at(-1)).toEqual({
			tag: tags.heading,
			textDecoration: 'none',
			fontWeight: 'bold',
		});
	});

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

	it('renders complete inline format blocks instead of activating an entire line', () => {
		const source = 'left **first** middle *second* then `code` and ~~strike~~';
		const replacements = widgetReplacements(createState(source)).filter(
			({ name }) => name === 'InlineMarkdownWidget',
		);
		expect(replacements.map(({ from, to }) => source.slice(from, to))).toEqual([
			'**first**',
			'*second*',
			'`code`',
			'~~strike~~',
		]);
	});

	it('expands only the inline format block containing the cursor', () => {
		const source = 'left **first** middle **second** right';
		const firstContent = source.indexOf('first') + 2;
		const state = EditorState.create({
			doc: source,
			selection: { anchor: firstContent },
			extensions: [markdownLanguageSupport, livePreviewField],
		});
		const replacements = widgetReplacements(state).filter(({ name }) => name === 'InlineMarkdownWidget');
		expect(replacements.map(({ from, to }) => source.slice(from, to))).toEqual(['**second**']);
	});

	it('keeps formatted neighbors rendered when the cursor is in plain text on the same line', () => {
		const source = 'left **first** middle **second** right';
		const state = EditorState.create({
			doc: source,
			selection: { anchor: source.indexOf('middle') + 3 },
			extensions: [markdownLanguageSupport, livePreviewField],
		});
		const replacements = widgetReplacements(state).filter(({ name }) => name === 'InlineMarkdownWidget');
		expect(replacements.map(({ from, to }) => source.slice(from, to))).toEqual(['**first**', '**second**']);
	});

	it('uses one outer replacement for nested inline formatting', () => {
		const source = 'before **outer *inner* text** after';
		const replacements = widgetReplacements(createState(source)).filter(
			({ name }) => name === 'InlineMarkdownWidget',
		);
		expect(replacements).toHaveLength(1);
		expect(source.slice(replacements[0].from, replacements[0].to)).toBe('**outer *inner* text**');
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

	it('hides the ATX marker and separator whitespace in live headings', () => {
		const source = '#   Heading\n\nbody';
		const replacements: string[] = [];
		const state = EditorState.create({
			doc: source,
			selection: { anchor: source.length },
			extensions: [markdownLanguageSupport, livePreviewField],
		});
		state.field(livePreviewField).between(0, state.doc.length, (from, to, decoration) => {
			if (!decoration.spec.class && !decoration.spec.widget) replacements.push(source.slice(from, to));
		});
		expect(replacements).toEqual(expect.arrayContaining(['#', '   ']));
	});

	it('keeps table blocks addressable from their own rendered region', () => {
		const source = 'intro\n\n| Name | Value |\n| --- | --- |\n| A | 1 |';
		const blocks = blockReplacements(createState(source));
		expect(blocks).toHaveLength(1);
		expect(source.slice(blocks[0].from, blocks[0].to)).toBe('| Name | Value |\n| --- | --- |\n| A | 1 |');
	});

	it('expands only the structural block containing the mapped cursor', () => {
		const source = '| Name | Value |\n| --- | --- |\n| A | 1 |\n\n$$x^2$$';
		const stateAtTable = EditorState.create({
			doc: source,
			selection: { anchor: source.indexOf('A') },
			extensions: [markdownLanguageSupport, livePreviewField],
		});
		const stateAtFormula = EditorState.create({
			doc: source,
			selection: { anchor: source.lastIndexOf('x') },
			extensions: [markdownLanguageSupport, livePreviewField],
		});
		expect(blockReplacements(stateAtTable).map(({ from, to }) => source.slice(from, to))).toEqual(['$$x^2$$']);
		expect(blockReplacements(stateAtFormula).map(({ from, to }) => source.slice(from, to))).toEqual([
			'| Name | Value |\n| --- | --- |\n| A | 1 |',
		]);
	});

	it('replaces a complete blockquote from its own source range', () => {
		const source = 'intro\n\n> quoted text';
		const blocks = blockReplacements(createState(source));
		expect(blocks).toHaveLength(1);
		expect(source.slice(blocks[0].from, blocks[0].to)).toBe('> quoted text');
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

	it('renders ordered task markers with the same source range behavior', () => {
		const source = 'intro\n\n1. [ ] first task';
		const replacements = widgetReplacements(createState(source));
		expect(
			replacements.some(({ name, from, to }) => name === 'CheckboxWidget' && source.slice(from, to) === '[ ]'),
		).toBe(true);
	});
});

describe('parsed character deletion', () => {
	it('deletes the final visible character inside common inline wrappers', () => {
		for (const [source, expected] of [
			['**bold**', { from: 5, to: 6 }],
			['*italic*', { from: 6, to: 7 }],
			['~~strike~~', { from: 7, to: 8 }],
			['`code`', { from: 4, to: 5 }],
			['[docs](https://example.com)', { from: 4, to: 5 }],
			['==mark==', { from: 5, to: 6 }],
		] as const) {
			const state = EditorState.create({
				doc: source,
				selection: { anchor: source.length },
				extensions: [markdownLanguageSupport, livePreviewField],
			});
			expect(parsedDeleteRange(state, 'backward'), source).toEqual(expected);
		}
	});

	it('deletes one complete Unicode character', () => {
		const source = '**ok\u{1f600}**';
		const state = EditorState.create({
			doc: source,
			selection: { anchor: source.length },
			extensions: [markdownLanguageSupport, livePreviewField],
		});
		expect(parsedDeleteRange(state, 'backward')).toEqual({ from: 4, to: 6 });
	});

	it('records parsed deletions in the undo history', () => {
		const source = '**bold**';
		const initial = EditorState.create({
			doc: source,
			selection: { anchor: source.length },
			extensions: [markdownLanguageSupport, livePreviewField, history()],
		});
		const range = parsedDeleteRange(initial, 'backward');
		expect(range).not.toBeNull();
		const changed = initial.update({ changes: range!, userEvent: 'delete.backward' }).state;
		expect(changed.doc.toString()).toBe('**bol**');
		expect(undoDepth(changed)).toBe(1);
	});
});
