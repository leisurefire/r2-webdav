import { describe, expect, it } from 'vitest';
import type { Note } from '@r2-webdav/shared-types';
import { reconcileNoteScope, type ProtectedNoteFields } from './sync';

function note(id: string, folderId: string | null, title = id): Note {
	return {
		id,
		title,
		content: `${title} body`,
		pinned: false,
		archived: false,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		accessedAt: '2026-01-01T00:00:00.000Z',
		folderId,
	};
}

describe('incremental note scope reconciliation', () => {
	it('keeps two optimistic moves when an older folder response is empty', () => {
		const first = note('first', 'folder');
		const second = note('second', 'folder');
		const protectedFields: ProtectedNoteFields = new Map([
			['first', new Set(['folderId'])],
			['second', new Set(['folderId'])],
		]);

		const result = reconcileNoteScope([first, second], [], 'folder', protectedFields);

		expect(result.map((item) => item.id)).toEqual(['first', 'second']);
	});

	it('keeps the later optimistic move when the snapshot only contains the first move', () => {
		const first = note('first', 'folder');
		const second = note('second', 'folder');
		const protectedFields: ProtectedNoteFields = new Map([
			['first', new Set(['folderId'])],
			['second', new Set(['folderId'])],
		]);

		const result = reconcileNoteScope([first, second], [note('first', 'folder', 'stale title')], 'folder', protectedFields);

		expect(result.map((item) => item.id)).toEqual(['first', 'second']);
		expect(first.title).toBe('stale title');
	});

	it('does not let a stale root response move a protected note back out of its folder', () => {
		const moved = note('moved', 'folder');
		const protectedFields: ProtectedNoteFields = new Map([['moved', new Set(['folderId'])]]);

		reconcileNoteScope([moved], [note('moved', null)], null, protectedFields);

		expect(moved.folderId).toBe('folder');
	});

	it('removes an unprotected note that no longer belongs to the fetched folder', () => {
		const stale = note('stale', 'folder');
		const other = note('other', null);

		const result = reconcileNoteScope([stale, other], [], 'folder', new Map());

		expect(result).toEqual([other]);
	});
});
