import type { NotePage } from '@r2-webdav/shared-types';
import { archivedNotesData, notesData, validatedNotePages } from './store';

export function noteFolderCachePart(folderId: string | null | undefined): string {
	return folderId === undefined ? 'all' : folderId === null ? 'root' : encodeURIComponent(folderId);
}

export function noteCacheKey(archived = false, folderId: string | null | undefined = undefined): string {
	return `r2_notes_v3_${archived ? 'archived' : 'active'}_${noteFolderCachePart(folderId)}`;
}

export function cacheNotes(data: NotePage, archived = false, folderId: string | null | undefined = undefined): void {
	localStorage.setItem(noteCacheKey(archived, folderId), JSON.stringify(data));
}

export function invalidateNoteCaches(): void {
	for (let index = localStorage.length - 1; index >= 0; index -= 1) {
		const key = localStorage.key(index);
		if (key?.startsWith('r2_notes_v3_')) localStorage.removeItem(key);
	}
	validatedNotePages.clear();
}

export function persistNotePages(): void {
	if (notesData) cacheNotes(notesData, false);
	if (archivedNotesData) cacheNotes(archivedNotesData, true, undefined);
}

export function cachedNotes(archived = false, folderId: string | null | undefined = undefined): NotePage | null {
	try {
		return JSON.parse(localStorage.getItem(noteCacheKey(archived, folderId)) ?? 'null') as NotePage | null;
	} catch {
		return null;
	}
}
