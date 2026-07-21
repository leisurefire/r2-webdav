import type { Note, NotePage } from '@r2-webdav/shared-types';
import { api } from '../api/client';
import { errorMessage, pageFromPath, toast } from '../shell';
import { cacheNotes, cachedNotes, noteCacheKey, persistNotePages } from './cache';
import {
	captureNoteSyncSnapshot,
	discardNoteCommit,
	noteCommitStates,
	protectedNoteFieldsSince,
	queueNoteCommit,
	restoreNoteOutbox,
	trackNoteNetworkOp,
} from './commits';
import { canMoveNoteFolder, noteFolderPath } from './folderTree';
import { currentSelectedNoteId, replaceNotesSidebar, sortNotes } from './page';
import type { NoteChanges } from './outbox';
import {
	archiveExpanded,
	archivedNotesData,
	noteContentLoaded,
	noteContentLoading,
	noteExpandedFolders,
	noteFolderMutationVersions,
	noteFolders,
	noteFoldersLoaded,
	currentArchivedNotesRequest,
	nextArchivedNotesRequest,
	noteScopeRequests,
	noteScopesLoaded,
	noteScopesLoading,
	notesData,
	selectedNoteFolderId,
	setArchiveExpanded,
	setArchivedNotesData,
	setNoteFolders,
	setNoteFoldersLoaded,
	setNotesData,
	setSelectedNoteFolderId,
	validatedNotePages,
} from './store';
import { mergeRemoteNote, reconcileNoteScope } from './sync';

export function resetNoteScopes(): void {
	noteScopesLoaded.clear();
	noteScopesLoading.clear();
}

export function noteScopeKey(folderId: string | null | undefined, archived = false): string {
	if (archived) return 'archive';
	return folderId === null || folderId === undefined ? 'root' : folderId;
}

export function knownNoteFolderIds(): Set<string> {
	return new Set(noteFolders.map((folder) => folder.id));
}

/** Map deleted/unknown folder membership onto root so notes stay visible in the tree. */
export function effectiveNoteFolderId(note: Note): string | null {
	if (note.archived) return null;
	const folderId = note.folderId ?? null;
	if (!folderId) return null;
	return knownNoteFolderIds().has(folderId) ? folderId : null;
}

export function emptyNotePage(): NotePage {
	return { items: [], page: 1, pageSize: 50, total: 0, hasMore: false };
}

export function mergeNotesIntoPage(page: NotePage, incoming: Note[], markContentLoaded: boolean): void {
	const byId = new Map(page.items.map((note) => [note.id, note]));
	for (const note of incoming) {
		const existing = byId.get(note.id);
		if (existing) {
			const keepContent =
				!markContentLoaded && noteContentLoaded.has(existing.id) ? existing.content : note.content;
			Object.assign(existing, note, { content: keepContent });
			if (markContentLoaded) noteContentLoaded.add(existing.id);
		} else {
			page.items.push(note);
			byId.set(note.id, note);
			if (markContentLoaded) noteContentLoaded.add(note.id);
			else if (note.content) noteContentLoaded.add(note.id);
		}
	}
	sortNotes(page.items);
	page.total = Math.max(page.total, page.items.length);
	page.hasMore = false;
}

export async function fetchNoteScopePages(
	folderId: string | null | undefined,
	archived: boolean,
): Promise<{ items: Note[]; total: number }> {
	const items: Note[] = [];
	let page = 1;
	let total = 0;
	let hasMore = true;
	// Active tree scopes pass folderId null (root) or uuid. Archive passes undefined (no folder filter).
	const scopeFolder = archived ? undefined : folderId;
	while (hasMore) {
		const next = await api.notes(page, archived, scopeFolder, { limit: 50, content: false });
		items.push(...next.items);
		total = next.total;
		hasMore = next.hasMore;
		page += 1;
		if (page > 100) break;
	}
	return { items, total };
}

export async function ensureFolderNotesLoaded(folderId: string | null, force = false): Promise<void> {
	const scope = noteScopeKey(folderId, false);
	if (!force && noteScopesLoaded.has(scope)) return;
	if (noteScopesLoading.has(scope)) return;
	const request = (noteScopeRequests.get(scope) ?? 0) + 1;
	noteScopeRequests.set(scope, request);
	const syncSnapshot = captureNoteSyncSnapshot();
	noteScopesLoading.add(scope);
	if (notesData && pageFromPath() === 'notes') replaceNotesSidebar(notesData, currentSelectedNoteId());
	try {
		const { items, total } = await fetchNoteScopePages(folderId, false);
		if (noteScopeRequests.get(scope) !== request) return;
		if (!notesData) setNotesData(emptyNotePage());
		const known = knownNoteFolderIds();
		// Heal orphans first so they participate in the root scope instead of vanishing.
		for (const note of notesData!.items) {
			if (note.folderId && !known.has(note.folderId)) {
				// Queue through the normal commit path so the heal is tracked, retried,
				// and protected from stale snapshots like any other local mutation.
				optimisticallyUpdateNote(notesData!, note, { folderId: null });
			}
		}
		// Apply the remote snapshot plus every local mutation that happened while it was in flight.
		notesData!.items = reconcileNoteScope(
			notesData!.items,
			items,
			folderId,
			protectedNoteFieldsSince(syncSnapshot),
			noteContentLoaded,
		);
		restoreNoteOutbox(notesData!);
		sortNotes(notesData!.items);
		notesData!.total = Math.max(total, notesData!.items.length);
		noteScopesLoaded.add(scope);
		cacheNotes(notesData!, false);
		if (pageFromPath() === 'notes' && notesData) replaceNotesSidebar(notesData, currentSelectedNoteId());
	} catch (error) {
		toast(errorMessage(error));
	} finally {
		if (noteScopeRequests.get(scope) === request) {
			noteScopesLoading.delete(scope);
			if (pageFromPath() === 'notes' && notesData) replaceNotesSidebar(notesData, currentSelectedNoteId());
		}
	}
}

export async function hydrateExpandedNoteScopes(force = false): Promise<void> {
	await ensureFolderNotesLoaded(null, force);
	for (const folderId of [...noteExpandedFolders]) {
		if (noteFolders.some((folder) => folder.id === folderId)) await ensureFolderNotesLoaded(folderId, force);
	}
}

export async function ensureNoteContent(note: Note): Promise<Note> {
	if (noteContentLoaded.has(note.id) || noteContentLoading.has(note.id)) return note;
	const syncSnapshot = captureNoteSyncSnapshot();
	noteContentLoading.add(note.id);
	try {
		const full = await api.getNote(note.id);
		mergeRemoteNote(note, full, protectedNoteFieldsSince(syncSnapshot).get(note.id));
		noteContentLoaded.add(note.id);
		if (!note.archived && notesData) cacheNotes(notesData, false);
		if (note.archived && archivedNotesData) cacheNotes(archivedNotesData, true);
		return note;
	} catch (error) {
		toast(errorMessage(error));
		return note;
	} finally {
		noteContentLoading.delete(note.id);
	}
}

export async function loadNoteFolders(force = false): Promise<void> {
	if (noteFoldersLoaded && !force) return;
	try {
		setNoteFolders(await api.noteFolders());
		setNoteFoldersLoaded(true);
		if (selectedNoteFolderId && !noteFolders.some((folder) => folder.id === selectedNoteFolderId))
			setSelectedNoteFolderId(undefined);
	} catch (error) {
		if (force) toast(errorMessage(error));
	}
}

export function moveNoteFolderOptimistically(folderId: string, parentId: string | null): void {
	const folder = noteFolders.find((item) => item.id === folderId);
	if (!folder || parentId === (folder.parentId ?? null) || !canMoveNoteFolder(noteFolders, folderId, parentId)) return;
	const previousParentId = folder.parentId ?? null;
	const version = (noteFolderMutationVersions.get(folderId) ?? 0) + 1;
	noteFolderMutationVersions.set(folderId, version);
	folder.parentId = parentId;
	folder.updatedAt = new Date().toISOString();
	for (const ancestor of noteFolderPath(noteFolders, parentId)) noteExpandedFolders.add(ancestor.id);
	noteExpandedFolders.add(folder.id);
	if (notesData) replaceNotesSidebar(notesData, currentSelectedNoteId());
	void trackNoteNetworkOp(api.updateNoteFolder(folderId, { parentId }))
		.then((updated) => {
			if (noteFolderMutationVersions.get(folderId) !== version) return;
			const current = noteFolders.find((item) => item.id === folderId);
			if (current) Object.assign(current, updated);
			if (notesData) replaceNotesSidebar(notesData, currentSelectedNoteId());
		})
		.catch((error) => {
			if (noteFolderMutationVersions.get(folderId) === version) {
				const current = noteFolders.find((item) => item.id === folderId);
				if (current) current.parentId = previousParentId;
				if (notesData) replaceNotesSidebar(notesData, currentSelectedNoteId());
			}
			toast(errorMessage(error));
		});
}

export function updateNoteFolderCounts(previous: Note, updated: Note): void {
	if (!previous.archived && previous.folderId) {
		const folder = noteFolders.find((item) => item.id === previous.folderId);
		if (folder) folder.noteCount = Math.max(0, folder.noteCount - 1);
	}
	if (!updated.archived && updated.folderId) {
		const folder = noteFolders.find((item) => item.id === updated.folderId);
		if (folder) folder.noteCount += 1;
	}
}

export function optimisticallyUpdateNote(data: NotePage, note: Note, changes: NoteChanges): boolean {
	const previous = { ...note };
	const dataIsArchived = data === archivedNotesData;
	Object.assign(note, changes, { updatedAt: new Date().toISOString() });
	if (previous.folderId !== note.folderId || previous.archived !== note.archived)
		updateNoteFolderCounts(previous, note);
	const index = data.items.findIndex((item) => item.id === note.id);
	// Folder selection only marks the active folder for new notes; the tree always
	// keeps uncategorized root notes and other folders visible.
	const leftCurrentView = note.archived !== dataIsArchived;
	if (index >= 0 && leftCurrentView) {
		data.items.splice(index, 1);
		data.total = Math.max(0, data.total - 1);
	}
	if (previous.archived !== note.archived) {
		const target = note.archived ? archivedNotesData : notesData;
		const visibleInTarget = true;
		if (target && target !== data && visibleInTarget && !target.items.some((item) => item.id === note.id)) {
			target.items.push(note);
			target.total += 1;
			sortNotes(target.items);
		}
	}
	sortNotes(data.items);
	queueNoteCommit(data, note, changes);
	if (previous.folderId !== note.folderId) {
		// A single moved note must not mark an unloaded destination scope as complete.
		const target = noteScopeKey(note.folderId ?? null, false);
		if (noteScopesLoaded.has(target)) {
			// Destination already fully indexed; membership update is enough.
		} else if (noteExpandedFolders.has(note.folderId ?? '') || note.folderId == null) {
			void ensureFolderNotesLoaded(note.folderId ?? null);
		}
	}
	persistNotePages();
	return leftCurrentView;
}

export function mergePendingNoteStates(data: NotePage, archived: boolean, folderId: string | null | undefined): void {
	restoreNoteOutbox(data);
	for (const state of noteCommitStates.values()) {
		if (!state.pending && !state.active) continue;
		const remote = data.items.find((note) => note.id === state.note.id);
		const visible =
			state.note.archived === archived && (folderId === undefined || (state.note.folderId ?? null) === folderId);
		if (remote && visible) {
			Object.assign(remote, state.inflight ?? {}, state.pending ?? {}, { updatedAt: state.note.updatedAt });
			state.note = remote;
			state.data = data;
		} else if (remote && !visible) {
			data.items.splice(data.items.indexOf(remote), 1);
			data.total = Math.max(0, data.total - 1);
		}
	}
	sortNotes(data.items);
}

export async function loadArchivedNotes(force = false): Promise<void> {
	const cached = force ? null : cachedNotes(true, undefined);
	if (cached) {
		mergePendingNoteStates(cached, true, undefined);
		setArchivedNotesData(cached);
		if (notesData && pageFromPath() === 'notes') replaceNotesSidebar(notesData, currentSelectedNoteId());
	}
	const cacheKey = noteCacheKey(true, undefined);
	if (!force && noteScopesLoaded.has('archive') && cached) return;
	if (!force && validatedNotePages.has(cacheKey) && cached && noteScopesLoaded.has('archive')) return;
	validatedNotePages.add(cacheKey);
	const request = nextArchivedNotesRequest();
	noteScopesLoading.add('archive');
	try {
		const { items, total } = await fetchNoteScopePages(undefined, true);
		if (request !== currentArchivedNotesRequest() || pageFromPath() !== 'notes') return;
		const page = emptyNotePage();
		mergeNotesIntoPage(page, items, false);
		page.total = total;
		mergePendingNoteStates(page, true, undefined);
		setArchivedNotesData(page);
		noteScopesLoaded.add('archive');
		cacheNotes(page, true, undefined);
		if (notesData) replaceNotesSidebar(notesData, currentSelectedNoteId());
	} catch (error) {
		validatedNotePages.delete(cacheKey);
		if (!cached) toast(errorMessage(error));
	} finally {
		noteScopesLoading.delete('archive');
	}
}
