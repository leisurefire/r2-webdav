import { describe, expect, it } from 'vitest';
import { parseMarkdownInline } from './markdownRenderer';

describe('parseMarkdownInline', () => {
	it('parses the inline styles supported inside table cells', () => {
		const html = parseMarkdownInline('**bold** *italic* `code` [link](https://example.com) $x^2$');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
		expect(html).toContain('<code>code</code>');
		expect(html).toContain('<a href="https://example.com">link</a>');
		expect(html).toContain('class="katex"');
	});
});
