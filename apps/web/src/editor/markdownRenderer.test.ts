import { describe, expect, it } from 'vitest';
import { markdownLinkOpensNewTab, parseMarkdownInline } from './markdownRenderer';

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
});
