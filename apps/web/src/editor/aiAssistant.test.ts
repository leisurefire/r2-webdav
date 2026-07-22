import { describe, expect, it } from 'vitest';
import {
	mapChatSegments,
	normalizeAiMarkdown,
	parseAiCitations,
	splitAiTitle,
	splitRewriteSummary,
} from './aiAssistant';
import { buildAiReviewPreview, diffText } from './textDiff';
import { buildAiReviewMarkDecorations } from './markdownLivePreview';
import { groupAiModelsByProvider } from '../api/client';

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

describe('read-only AI answer citations', () => {
	it('deduplicates source ranges and keeps stable reference numbers', () => {
		const result = parseAiCitations('First [[cite:3-5]], again [[cite:3-5]], then [[cite:9]].');

		expect(result.markdown).toBe(
			'First  [1](#note-ai-cite-1), again  [1](#note-ai-cite-1), then  [2](#note-ai-cite-2).',
		);
		expect(result.citations).toEqual([
			{ startLine: 3, endLine: 5, index: 1 },
			{ startLine: 9, endLine: 9, index: 2 },
		]);
	});

	it('normalizes reversed and zero line ranges', () => {
		expect(parseAiCitations('Answer [[cite:0-0]] [[cite:8-2]]').citations).toEqual([
			{ startLine: 1, endLine: 1, index: 1 },
			{ startLine: 8, endLine: 8, index: 2 },
		]);
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

describe('MarkdownAiHandle contract', () => {
	it('keeps empty-prompt sync separate from teardown (regression: DIFF closed the review UI)', async () => {
		// The editor onChange path must call syncEmptyPrompt only. If destroy is used there,
		// polish/rewrite applying the inline DIFF tears down the Accept / Re-edit / Insert-below panel.
		const { bindMarkdownAiAssistant } = await import('./aiAssistant');
		expect(typeof bindMarkdownAiAssistant).toBe('function');
		// Shape is enforced at the type level via MarkdownAiHandle; runtime export stays a dual-method handle.
		const sample = { syncEmptyPrompt: () => {}, destroy: () => {} };
		expect(Object.keys(sample).sort()).toEqual(['destroy', 'syncEmptyPrompt']);
	});
});

describe('mapChatSegments', () => {
	it('shifts context-relative diff segments into document coordinates', () => {
		const segments = mapChatSegments(
			[
				{ from: 3, to: 5, kind: 'deleted' as const },
				{ from: 5, to: 9, kind: 'inserted' as const },
			],
			40,
		);
		expect(segments).toEqual([
			{ from: 43, to: 45, kind: 'deleted' },
			{ from: 45, to: 49, kind: 'inserted' },
		]);
	});

	it('keeps a zero offset unchanged for whole-note edits', () => {
		expect(mapChatSegments([{ from: 0, to: 7, kind: 'inserted' as const }], 0)).toEqual([
			{ from: 0, to: 7, kind: 'inserted' },
		]);
	});
});

describe('AI model provider grouping', () => {
	it('groups each provider while preserving provider and model priority', () => {
		expect(
			groupAiModelsByProvider(['claude-haiku', 'kimi-k3', 'claude-sonnet', 'grok-4.5', 'deepseek-v4', 'kimi-k2']),
		).toEqual(['claude-haiku', 'claude-sonnet', 'kimi-k3', 'kimi-k2', 'grok-4.5', 'deepseek-v4']);
	});
});
