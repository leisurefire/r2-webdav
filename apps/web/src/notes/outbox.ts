import type { Note } from '@r2-webdav/shared-types';

export type NoteChanges = Partial<Pick<Note, 'title' | 'content' | 'pinned' | 'archived' | 'folderId'>>;

export const NOTE_OUTBOX_KEY = 'r2_notes_outbox_v1';
export interface StoredNoteMutation {
	id: string;
	changes: NoteChanges;
	updatedAt: string;
	attempts: number;
	nextAttemptAt: number;
}
export const noteOutbox = new Map<string, StoredNoteMutation>();

try {
	const stored = JSON.parse(localStorage.getItem(NOTE_OUTBOX_KEY) ?? '[]') as StoredNoteMutation[];
	for (const item of stored) {
		if (item?.id && item.changes && typeof item.updatedAt === 'string') noteOutbox.set(item.id, item);
	}
} catch {
	localStorage.removeItem(NOTE_OUTBOX_KEY);
}

let outboxPersistTimer = 0;
export function persistNoteOutbox(immediate = false): void {
	if (outboxPersistTimer) {
		window.clearTimeout(outboxPersistTimer);
		outboxPersistTimer = 0;
	}
	const write = () => {
		if (noteOutbox.size) localStorage.setItem(NOTE_OUTBOX_KEY, JSON.stringify([...noteOutbox.values()]));
		else localStorage.removeItem(NOTE_OUTBOX_KEY);
	};
	if (immediate) write();
	// Debounce the hot path (typing); transitions that add/remove entries flush immediately.
	else outboxPersistTimer = window.setTimeout(write, 1_000);
}
