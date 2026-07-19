import { describe, expect, it } from 'vitest';
import { normalizeClipboardText, prepareClipboardText, readClipboardText } from './markdownClipboard';

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

	it('normalizes multiline LaTeX display delimiters', () => {
		expect(prepareClipboardText('\\[\r\n\\begin{aligned}\r\nx &= 1 \\\\\r\ny &= 2\r\n\\end{aligned}\r\n\\]')).toBe(
			'$$\n\\begin{aligned}\nx &= 1 \\\\ny &= 2\n\\end{aligned}\n$$',
		);
	});

	it('keeps display delimiter examples inside fenced code unchanged', () => {
		expect(prepareClipboardText('```latex\n\\[\nx + y\n\\]\n```')).toBe('```latex\n\\[\nx + y\n\\]\n```');
	});

	it('separates a pasted display formula from adjacent line content', () => {
		expect(prepareClipboardText('$$\nx + y\n$$', 'x', 'y')).toBe('\n$$\nx + y\n$$\n');
		expect(prepareClipboardText('$$\nx + y\n$$', '\n', '\n')).toBe('$$\nx + y\n$$');
	});
});
