import { describe, expect, it } from 'vitest';
import { normalizeAiMarkdown, splitAiTitle, splitRewriteSummary } from './aiAssistant';
import { buildAiReviewPreview, diffText } from './textDiff';
import { buildAiReviewMarkDecorations } from './markdownLivePreview';

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

describe('character-level AI review preview', () => {
	it('keeps equal prefixes and marks deletes/inserts', () => {
		const ops = diffText('hello world', 'hello earth');
		expect(ops[0]).toEqual({ type: 'equal', text: 'hello ' });
		expect(ops.some((op) => op.type === 'delete')).toBe(true);
		expect(ops.some((op) => op.type === 'insert')).toBe(true);
		// Reconstruct both sides from ops.
		expect(
			ops
				.filter((op) => op.type !== 'insert')
				.map((op) => op.text)
				.join(''),
		).toBe('hello world');
		expect(
			ops
				.filter((op) => op.type !== 'delete')
				.map((op) => op.text)
				.join(''),
		).toBe('hello earth');
	});

	it('builds an inline preview with deleted and inserted spans', () => {
		const preview = buildAiReviewPreview('cat sat', 'cat ate');
		expect(preview.segments.some((segment) => segment.kind === 'deleted')).toBe(true);
		expect(preview.segments.some((segment) => segment.kind === 'inserted')).toBe(true);
		const decorations = buildAiReviewMarkDecorations(preview.segments);
		const classes: string[] = [];
		decorations.between(0, preview.text.length, (_from, _to, value) => {
			classes.push(String(value.spec.class ?? ''));
		});
		expect(classes.join(' ')).toContain('cm-ai-review-deleted');
		expect(classes.join(' ')).toContain('cm-ai-review-inserted');
	});

	it('leaves identical text unmarked', () => {
		const preview = buildAiReviewPreview('same', 'same');
		expect(preview.text).toBe('same');
		expect(preview.segments).toEqual([]);
	});
});

describe('splitRewriteSummary', () => {
	it('takes the first paragraph as the status note', () => {
		expect(splitRewriteSummary('已按照你的要求添加了代码，请查看。\n\n```js\n1\n```')).toEqual({
			summary: '已按照你的要求添加了代码，请查看。',
			body: '```js\n1\n```',
		});
	});
});
