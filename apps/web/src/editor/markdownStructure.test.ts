import { describe, expect, it } from 'vitest';
import {
	collectInlineExcludedRanges,
	collectObsidianInlineRanges,
	collectStructuralBlocks,
	collectWikiLinkRanges,
	continueMarkdownStructuredLine,
	indentMarkdownListLine,
	parseFrontmatterBlock,
	parseMarkdownListPrefix,
	parseTableBlock,
	serializeTableRows,
	splitTableRow,
	tableCellSourceRanges,
} from './markdownStructure';

describe('collectStructuralBlocks', () => {
	it('treats only a closed document-start frontmatter block as properties', () => {
		const source = '---\ntags: [one, two]\ndescription: first\n  second\n---\n\n# Heading';
		const frontmatter = parseFrontmatterBlock(source);
		expect(frontmatter?.entries).toEqual([
			{ key: 'tags', value: '[one, two]' },
			{ key: 'description', value: 'first\nsecond' },
		]);
		expect(collectStructuralBlocks(source)).toContainEqual({
			from: 0,
			to: source.indexOf('---', 4) + 3,
			kind: 'frontmatter',
		});
		expect(parseFrontmatterBlock('text\n---\na: b\n---')).toBeNull();
	});

	it('collects the reported mixed inline and block math example without changing source offsets', () => {
		const source =
			'包含变量 $x_1,x_2,\\cdots,x_n$ 的**线性方程**是形如\n\n$$\na_1x_1+a_2x_2+\\cdots+a_nx_n=b\n$$\n\n的方程. 其中 $b$ 与系数 $a_1,a_2,\\cdots,a_n$ 是实数或复数，通常是已知数. 下标 $n$ 则是任意正整数.';
		const blocks = collectStructuralBlocks(source);
		expect(blocks).toHaveLength(1);
		expect(source.slice(blocks[0].from, blocks[0].to)).toBe('$$\na_1x_1+a_2x_2+\\cdots+a_nx_n=b\n$$');
	});

	it('leaves an unclosed display formula visible as source', () => {
		const source = 'before\n\n$$\nx + y\nafter';
		expect(collectStructuralBlocks(source)).toEqual([]);
	});

	it('leaves unclosed fences and details visible as source', () => {
		expect(collectStructuralBlocks('before\n```ts\nconst value = 1')).toEqual([]);
		expect(collectStructuralBlocks('before\n<details>\ncontent')).toEqual([]);
	});

	it('does not parse math or table syntax inside a fenced code block', () => {
		const source = '````md\n$$\n| a | b |\n| - | - |\n$$\n``` still code\n````';
		expect(collectStructuralBlocks(source)).toEqual([{ from: 0, to: source.length, kind: 'fence' }]);
	});

	it('supports single-line math and nested details blocks', () => {
		const source = '$$x^2$$\n<details>\n<details>\nx\n</details>\n</details>';
		const blocks = collectStructuralBlocks(source);
		expect(blocks.map((block) => block.kind)).toEqual(['math', 'details']);
		expect(source.slice(blocks[1].from, blocks[1].to)).toContain('<details>\nx\n</details>');
	});

	it('requires a delimiter row before treating pipes as a table', () => {
		const source = 'not | a table\n\nName | Value\n--- | ---\na \\| b | 2\nafter';
		const blocks = collectStructuralBlocks(source);
		expect(blocks).toHaveLength(1);
		expect(source.slice(blocks[0].from, blocks[0].to)).toBe('Name | Value\n--- | ---\na \\| b | 2');
		expect(source[blocks[0].to]).toBe('\n');
	});
});

describe('collectInlineExcludedRanges', () => {
	it('finds code before math and ignores syntax inside code spans', () => {
		const line = '`$not_math$ **not bold**` and $x_1+\\cdots+x_n$';
		const ranges = collectInlineExcludedRanges(line);
		expect(ranges.map((range) => [range.kind, line.slice(range.from, range.to)])).toEqual([
			['code', '`$not_math$ **not bold**`'],
			['math', '$x_1+\\cdots+x_n$'],
		]);
	});

	it('supports multi-backtick code and escaped dollars', () => {
		const line = '``code ` here`` and \\$5 and $x \\$ y$';
		const ranges = collectInlineExcludedRanges(line);
		expect(ranges.map((range) => range.kind)).toEqual(['code', 'math']);
		expect(line.slice(ranges[1].from, ranges[1].to)).toBe('$x \\$ y$');
	});

	it('does not treat currency or whitespace-padded dollars as math', () => {
		expect(collectInlineExcludedRanges('Price $5 and $10; text $ not math $')).toEqual([]);
	});
});

describe('collectObsidianInlineRanges', () => {
	it('finds highlights and comments while ignoring code and math', () => {
		const line = '`==code==` ==visible== $==math==$ %%hidden%%';
		expect(collectObsidianInlineRanges(line).map((range) => [range.kind, line.slice(range.from, range.to)])).toEqual([
			['highlight', '==visible=='],
			['comment', '%%hidden%%'],
		]);
	});

	it('does not treat whitespace-padded highlight delimiters as syntax', () => {
		expect(collectObsidianInlineRanges('== not highlighted ==')).toEqual([]);
	});
});

describe('splitTableRow', () => {
	it('keeps escaped pipes inside cells', () => {
		expect(splitTableRow('| a \\| b | `c|d` |')).toEqual(['a | b', '`c|d`']);
		expect(tableCellSourceRanges('| a \\| b | `c|d` |')).toEqual([
			{ from: 2, to: 8 },
			{ from: 11, to: 16 },
		]);
	});

	it('serializes every cell without exposing pipe delimiters', () => {
		expect(
			serializeTableRows([
				['a | b', '`c|d`'],
				['next', 'line\nbreak'],
			]),
		).toBe('| a \\| b | `c\\|d` |\n| next | line break |');
	});

	it('escapes pipes after an even number of backslashes', () => {
		expect(serializeTableRows([['one \\\\| two', 'already \\| escaped']])).toBe(
			String.raw`| one \\\| two | already \| escaped |`,
		);
	});

	it('parses table alignment and pads short rows', () => {
		expect(parseTableBlock('| Name | Value |\n| :--- | ---: |\n| **A** | 2')).toEqual({
			rows: [
				['Name', 'Value'],
				[':---', '---:'],
				['**A**', '2'],
			],
			separatorIndex: 1,
			alignments: ['left', 'right'],
		});
	});

	it('rejects a table whose header and separator have different column counts', () => {
		expect(parseTableBlock('| Name | Value |\n| --- |')).toBeNull();
	});
});

describe('collectWikiLinkRanges', () => {
	it('finds wiki links and embeds while ignoring code spans', () => {
		const line = '`[[code]]` [[Note]] [[Note|Alias]] ![[Embed]]';
		expect(
			collectWikiLinkRanges(line).map((range) => [
				range.kind,
				line.slice(range.from, range.to),
				range.target,
				range.alias,
			]),
		).toEqual([
			['wikilink', '[[Note]]', 'Note', undefined],
			['wikilink', '[[Note|Alias]]', 'Note', 'Alias'],
			['embed', '![[Embed]]', 'Embed', undefined],
		]);
	});
});

describe('Obsidian list editing helpers', () => {
	it('parses bullet, ordered, and task prefixes', () => {
		expect(parseMarkdownListPrefix('- item')).toMatchObject({ marker: '-', content: 'item', prefixLength: 2 });
		expect(parseMarkdownListPrefix('1. [x] done')).toMatchObject({
			marker: '1.',
			task: 'x',
			content: 'done',
			prefixLength: 7,
		});
	});

	it('continues a list item and exits an empty one', () => {
		expect(continueMarkdownStructuredLine('- hello world', 7)).toEqual({
			insert: '- hello\n-  world',
			replaceFrom: 0,
			replaceTo: 13,
			cursor: 10,
		});
		expect(continueMarkdownStructuredLine('1. [ ] ', 7)).toEqual({
			insert: '',
			replaceFrom: 0,
			replaceTo: 7,
			cursor: 0,
		});
		expect(continueMarkdownStructuredLine('  - ', 4)).toEqual({
			insert: '- ',
			replaceFrom: 0,
			replaceTo: 4,
			cursor: 2,
		});
	});

	it('continues blockquotes and quoted lists', () => {
		expect(continueMarkdownStructuredLine('> quote', 7)).toEqual({
			insert: '> quote\n> ',
			replaceFrom: 0,
			replaceTo: 7,
			cursor: 10,
		});
		expect(continueMarkdownStructuredLine('> - item', 8)).toEqual({
			insert: '> - item\n> - ',
			replaceFrom: 0,
			replaceTo: 8,
			cursor: 13,
		});
	});

	it('indents and outdents list lines', () => {
		expect(indentMarkdownListLine('- item', 'indent')).toBe('  - item');
		expect(indentMarkdownListLine('  - item', 'outdent')).toBe('- item');
		expect(indentMarkdownListLine('> - item', 'indent')).toBe('>   - item');
	});
});
