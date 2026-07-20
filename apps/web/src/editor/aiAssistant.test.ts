import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { normalizeAiMarkdown, splitAiTitle } from './aiAssistant';
import { buildAiReviewDecorations, markdownLanguageSupport } from './markdownLivePreview';

describe('normalizeAiMarkdown / splitAiTitle', () => {
	it('strips markdown fences and carriage returns', () => {
		expect(normalizeAiMarkdown('```md\r\n# Hello\r\nbody\r\n```')).toBe('# Hello\nbody');
	});

	it('extracts a leading H1 as the note title', () => {
		expect(splitAiTitle('# Travel plan\n\n- pack')).toEqual({ title: 'Travel plan', body: '- pack' });
		expect(splitAiTitle('# Only title')).toEqual({ title: 'Only title', body: '' });
		expect(splitAiTitle('## Not a title\nbody')).toBeNull();
	});
});

describe('AI review decorations', () => {
	it('marks consecutive original and generated lines without throwing', () => {
		const doc = EditorState.create({
			doc: 'alpha\nbeta\ngamma\ndelta',
			extensions: [markdownLanguageSupport],
		}).doc;
		const decorations = buildAiReviewDecorations(doc, {
			deletedFrom: 0,
			insertedFrom: 'alpha\nbeta\n'.length,
			count: 2,
		});
		const classes: string[] = [];
		decorations.between(0, doc.length, (from, _to, value) => {
			classes.push(`${from}:${value.spec.class ?? ''}`);
		});
		expect(classes).toEqual([
			`0:cm-ai-review-deleted`,
			`${doc.line(2).from}:cm-ai-review-deleted`,
			`${doc.line(3).from}:cm-ai-review-inserted`,
			`${doc.line(4).from}:cm-ai-review-inserted`,
		]);
	});
});
