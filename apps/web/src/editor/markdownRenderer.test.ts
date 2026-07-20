import { describe, expect, it } from 'vitest';
import { markdownLinkOpensNewTab, parseMarkdownBlocks, parseMarkdownInline } from './markdownRenderer';

describe('parseMarkdownInline', () => {
	it('parses the inline styles supported inside table cells', () => {
		const html = parseMarkdownInline('**bold** *italic* `code` [link](https://example.com) $x^2$');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
		expect(html).toContain('<code>code</code>');
		expect(html).toContain('<a href="https://example.com">link</a>');
		expect(html).toContain('class="katex"');
	});

	it('only opens network links in a new tab', () => {
		expect(markdownLinkOpensNewTab('https://example.com')).toBe(true);
		expect(markdownLinkOpensNewTab('//example.com/path')).toBe(true);
		expect(markdownLinkOpensNewTab('#section')).toBe(false);
		expect(markdownLinkOpensNewTab('/notes/readme.md')).toBe(false);
		expect(markdownLinkOpensNewTab('mailto:test@example.com')).toBe(false);
	});

	it('renders Obsidian highlight and hides inline comments', () => {
		const html = parseMarkdownInline('==important== %%private%%');
		expect(html).toContain('<mark>important</mark>');
		expect(html).not.toContain('private');
	});
});

describe('parseMarkdownBlocks', () => {
	it('keeps single source newlines visible in note previews', () => {
		expect(parseMarkdownBlocks('first line\nsecond line')).toContain('first line<br>second line');
	});
});
