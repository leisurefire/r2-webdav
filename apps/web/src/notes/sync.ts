import type { Note } from '@r2-webdav/shared-types';

export type NoteSyncField = 'title' | 'content' | 'pinned' | 'archived' | 'folderId';
export type ProtectedNoteFields = ReadonlyMap<string, ReadonlySet<NoteSyncField>>;

/** Merge one remote row without allowing a request that started earlier to undo local edits. */
export function mergeRemoteNote(
	existing: Note,
	incoming: Note,
	protectedFields: ReadonlySet<NoteSyncField> = new Set(),
	contentLoaded = false,
): void {
	const local = { ...existing };
	const localContent = existing.content;
	Object.assign(existing, incoming);
	if (contentLoaded && !protectedFields.has('content')) existing.content = localContent;
	for (const field of protectedFields) {
		switch (field) {
			case 'title':
				existing.title = local.title;
				break;
			case 'content':
				existing.content = local.content;
				break;
			case 'pinned':
				existing.pinned = local.pinned;
				break;
			case 'archived':
				existing.archived = local.archived;
				break;
			case 'folderId':
				existing.folderId = local.folderId;
				break;
		}
	}
	if (protectedFields.size) existing.updatedAt = local.updatedAt;
}

function noteIsInScope(note: Note, folderId: string | null): boolean {
	return !note.archived && (note.folderId ?? null) === folderId;
}

/**
 * Reconcile a folder index incrementally. The response is a snapshot from an
 * earlier point in time, so locally protected rows remain visible even when
 * they are absent from that snapshot.
 */
export function reconcileNoteScope(
	current: Note[],
	incoming: Note[],
	folderId: string | null,
	protectedFields: ProtectedNoteFields,
	contentLoadedIds: ReadonlySet<string> = new Set(),
): Note[] {
	const incomingById = new Map(incoming.map((note) => [note.id, note]));
	const result = current.filter((note) => {
		if (!noteIsInScope(note, folderId)) return true;
		const fields = protectedFields.get(note.id);
		return Boolean(fields?.has('folderId') || fields?.has('archived') || incomingById.has(note.id));
	});
	const byId = new Map(result.map((note) => [note.id, note]));
	for (const remote of incoming) {
		const existing = byId.get(remote.id);
		const fields = protectedFields.get(remote.id) ?? new Set<NoteSyncField>();
		if (existing) {
			mergeRemoteNote(existing, remote, fields, contentLoadedIds.has(remote.id));
			continue;
		}
		result.push(remote);
		byId.set(remote.id, remote);
	}
	return result;
}
