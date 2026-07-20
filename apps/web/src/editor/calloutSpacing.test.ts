import { describe, expect, it } from 'vitest';
import { parseMarkdownBlocks } from './markdownRenderer';

describe('callout ordered list spacing', () => {
	it('keeps tight ordered lists without blank lines', () => {
		const html = parseMarkdownBlocks(`> [!note] 事实核查：北京灌肠与Arabiki
> 1. 原文中称北方灌肠“常用猪血、肉...”，这与东北血肠混淆。北京小吃“炸灌肠”的核心食材是淀粉，并非肉肠。
> 2. 原文将Arabiki视作普通品类，实际上它代表了日本特有的“粗挽き”工艺，是战后为了在有限资源下提升肉类质感的重要创新。`);
		expect(html).toContain('<ol>');
		expect(html).toContain('<li>原文中称');
		expect(html).toContain('<li>原文将Arabiki');
		// Tight lists must not wrap each item in a paragraph.
		expect(html).not.toMatch(/<li>\s*<p>/);
	});

	it('marks blank-separated list items as loose paragraphs for compacting', () => {
		const html = parseMarkdownBlocks(`> [!note] title
> 1. first item
>
> 2. second item`);
		// Marked emits loose list items; compactListItems unwraps these at render time.
		expect(html).toMatch(/<li>\s*<p>first item<\/p>/);
		expect(html).toMatch(/<li>\s*<p>second item<\/p>/);
	});
});
