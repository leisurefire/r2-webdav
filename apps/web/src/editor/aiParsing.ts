import type { NoteChatChange } from '../api/client';
import type { AiReviewSegment } from './markdownAiReview';

export function normalizeAiMarkdown(value: string): string {
	const trimmed = value.trim();
	const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
	return (fenced?.[1] ?? trimmed).replaceAll('\r', '');
}

const CHAT_EDIT_MARKER = '[[R2_EDIT]]';
const CHAT_ANSWER_MARKER = '[[R2_ANSWER]]';

export type ChatAiEnvelope =
	| { kind: 'edit'; content: string }
	| { kind: 'answer'; content: string }
	| { kind: 'legacy'; content: string };

export function parseChatAiEnvelope(value: string): ChatAiEnvelope {
	const normalized = value.replaceAll('\r', '').trim();
	if (normalized.startsWith(CHAT_EDIT_MARKER)) {
		return { kind: 'edit', content: normalized.slice(CHAT_EDIT_MARKER.length).trim() };
	}
	if (normalized.startsWith(CHAT_ANSWER_MARKER)) {
		return { kind: 'answer', content: normalized.slice(CHAT_ANSWER_MARKER.length).trim() };
	}
	return { kind: 'legacy', content: normalized };
}

export type ChatEditPatchResult =
	| { ok: true; markdown: string; patchCount: number }
	| { ok: false; reason: 'format' | 'missing' | 'ambiguous' | 'overlap' };

export function applyChatEditPatches(original: string, payload: string): ChatEditPatchResult {
	const normalized = payload.replaceAll('\r', '').trim();
	const block = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g;
	const patches: Array<{ from: number; to: number; replacement: string }> = [];
	let consumed = '';
	let cursor = 0;
	for (const match of normalized.matchAll(block)) {
		const index = match.index ?? 0;
		consumed += normalized.slice(cursor, index);
		cursor = index + match[0].length;
		const search = match[1];
		const replacement = match[2];
		if (!search) return { ok: false, reason: 'format' };
		const from = original.indexOf(search);
		if (from < 0) return { ok: false, reason: 'missing' };
		if (original.indexOf(search, from + 1) >= 0) return { ok: false, reason: 'ambiguous' };
		patches.push({ from, to: from + search.length, replacement });
	}
	consumed += normalized.slice(cursor);
	if (!patches.length || consumed.trim()) return { ok: false, reason: 'format' };
	patches.sort((left, right) => left.from - right.from);
	for (let index = 1; index < patches.length; index += 1) {
		if (patches[index]!.from < patches[index - 1]!.to) return { ok: false, reason: 'overlap' };
	}
	let markdown = original;
	for (const patch of [...patches].reverse()) {
		markdown = `${markdown.slice(0, patch.from)}${patch.replacement}${markdown.slice(patch.to)}`;
	}
	return { ok: true, markdown, patchCount: patches.length };
}

export function splitAiTitle(value: string): { title: string; body: string } | null {
	const match = /^#\s+(.+?)\s*#*\s*(?:\r?\n+|$)([\s\S]*)$/.exec(value.trim());
	if (!match) return null;
	const title = match[1].trim();
	if (!title) return null;
	return { title, body: match[2].replace(/^\s*\n/, '').trimEnd() };
}

export function splitRewriteSummary(value: string): { summary: string; body: string } {
	const trimmed = value.trim();
	if (!trimmed) return { summary: '', body: '' };
	const blank = /^(.*?)\n\s*\n([\s\S]*)$/.exec(trimmed);
	if (blank) return { summary: blank[1].trim(), body: blank[2].trim() };
	const lineBreak = trimmed.indexOf('\n');
	if (lineBreak > 0) {
		return { summary: trimmed.slice(0, lineBreak).trim(), body: trimmed.slice(lineBreak + 1).trim() };
	}
	return { summary: '', body: trimmed };
}

export interface AiCitation {
	startLine: number;
	endLine: number;
	index: number;
}

export function parseAiCitations(value: string): { markdown: string; citations: AiCitation[] } {
	const citations: AiCitation[] = [];
	const keys = new Map<string, number>();
	const markdown = value.replace(/\[\[cite:(\d+)(?:-(\d+))?\]\]/gi, (_match, startRaw, endRaw) => {
		const startLine = Math.max(1, Number(startRaw));
		const endLine = Math.max(startLine, Number(endRaw ?? startRaw));
		const key = `${startLine}-${endLine}`;
		let index = keys.get(key);
		if (!index) {
			index = citations.length + 1;
			keys.set(key, index);
			citations.push({ startLine, endLine, index });
		}
		return ` [${index}](#note-ai-cite-${index})`;
	});
	return { markdown, citations };
}

export function mapChatSegments(
	segments: Array<{ from: number; to: number; kind: 'deleted' | 'inserted' }>,
	offset: number,
): AiReviewSegment[] {
	return segments.map((segment) => ({ from: segment.from + offset, to: segment.to + offset, kind: segment.kind }));
}

export function canSafelyRevert(currentDocument: string, change: NoteChatChange): boolean {
	if (change.status === 'reverted' || change.from < 0 || change.to < change.from || change.to > currentDocument.length)
		return false;
	return currentDocument.slice(change.from, change.to) === change.generated;
}
