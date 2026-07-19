import { describe, expect, it } from 'vitest';
import { normalizeClipboardText, readClipboardText } from './markdownClipboard';

describe('Markdown clipboard text', () => {
	it('prefers plain text and normalizes Windows line endings', () => {
		const values: Record<string, string> = {
			'text/plain': '# Plain\r\n\r\nBody',
			'text/markdown': '# Markdown',
		};
		expect(readClipboardText((type) => values[type] ?? '')).toBe('# Plain\n\nBody');
	});

	it('uses Markdown clipboard MIME types when plain text is unavailable', () => {
		const markdown = new Map([['text/markdown', '- [x] pasted']]);
		expect(readClipboardText((type) => markdown.get(type) ?? '')).toBe('- [x] pasted');

		const legacyMarkdown = new Map([['text/x-markdown', '**legacy**']]);
		expect(readClipboardText((type) => legacyMarkdown.get(type) ?? '')).toBe('**legacy**');
	});

	it('normalizes lone carriage returns', () => {
		expect(normalizeClipboardText('one\rtwo')).toBe('one\ntwo');
	});
});
