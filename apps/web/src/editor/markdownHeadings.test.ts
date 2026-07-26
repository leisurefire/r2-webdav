import { describe, expect, it } from 'vitest';
import { createMarkdownHeading, markdownHeadingText } from './markdownHeadings';

describe('markdown headings', () => {
	it('extracts visible labels from ATX and Setext source', () => {
		expect(markdownHeadingText('## **Release** [notes](./notes) ##', 'ATXHeading2')).toBe('Release notes');
		expect(markdownHeadingText('Overview\n--------', 'SetextHeading2')).toBe('Overview');
	});

	it('assigns stable suffixes to duplicate ids', () => {
		const used = new Set<string>();
		expect(createMarkdownHeading('Hello world', 2, used).id).toBe('hello-world');
		expect(createMarkdownHeading('Hello world', 3, used).id).toBe('hello-world-2');
	});
});
