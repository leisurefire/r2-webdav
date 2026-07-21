import type { Note, NotePage } from '@r2-webdav/shared-types';
import { api, ApiError } from '../api/client';
import { errorMessage, pageFromPath, toast } from '../shell';
import { cacheNotes, persistNotePages } from './cache';
import { noteOutbox, persistNoteOutbox, type NoteChanges, type StoredNoteMutation } from './outbox';
import { paintNoteSaveStatus, syncNoteMetadata, syncNotePinControls } from './editorPane';
import { currentSelectedNoteId, replaceNotesSidebar } from './page';
import { updateNoteFolderCounts } from './scope';
import { notesData, archivedNotesData, noteFolders } from './store';
import { sortNotes } from './page';
import type { NoteSyncField, ProtectedNoteFields } from './sync';

export type NoteSaveState = 'pending' | 'syncing' | 'synced' | 'failed';

export interface NoteCommitState {
	note: Note;
	data: NotePage;
	pending: NoteChanges | null;
	inflight: NoteChanges | null;
	active: Promise<boolean> | null;
	idleTimer: number;
	intervalTimer: number;
	status: NoteSaveState;
	failureReported: boolean;
	attempts: number;
	blocked: boolean;
}

export const NOTE_AUTOSAVE_IDLE_DELAY = 2_500;
export const NOTE_AUTOSAVE_INTERVAL = 8_000;
export const NOTE_AUTOSAVE_RETRY_DELAY = 10_000;
export const noteCommitStates = new Map<string, NoteCommitState>();

export function noteCommitState(data: NotePage, note: Note): NoteCommitState {
	let state = noteCommitStates.get(note.id);
	if (state) {
		state.note = note;
		state.data = data;
		return state;
	}
	state = {
		note,
		data,
		pending: null,
		inflight: null,
		active: null,
		idleTimer: 0,
		intervalTimer: 0,
		status: 'pending',
		failureReported: false,
		attempts: 0,
		blocked: false,
	};
	noteCommitStates.set(note.id, state);
	return state;
}

export function restoreNoteOutbox(data: NotePage): void {
	for (const mutation of noteOutbox.values()) {
		const note = data.items.find((item) => item.id === mutation.id);
		if (!note) continue;
		Object.assign(note, mutation.changes, { updatedAt: mutation.updatedAt });
		const state = noteCommitState(data, note);
		const alreadyQueued = Boolean(state.pending || state.inflight || state.active);
		state.pending = { ...(state.pending ?? {}), ...mutation.changes };
		state.attempts = mutation.attempts;
		state.status = 'pending';
		state.blocked = !Number.isFinite(mutation.nextAttemptAt);
		if (!alreadyQueued && !state.blocked) scheduleNoteCommit(state, Math.max(0, mutation.nextAttemptAt - Date.now()));
	}
}

let noteMutationEpoch = 0;
function nextNoteMutationEpoch(): number {
	return ++noteMutationEpoch;
}
export const noteMutationFieldEpochs = new Map<string, Map<NoteSyncField, number>>();

export interface NoteSyncSnapshot {
	epoch: number;
	dirtyFields: Map<string, Set<NoteSyncField>>;
}

export function noteChangeFields(changes: NoteChanges | null): NoteSyncField[] {
	return changes ? (Object.keys(changes) as NoteSyncField[]) : [];
}

export function recordNoteMutation(noteId: string, changes: NoteChanges): void {
	const fields = noteMutationFieldEpochs.get(noteId) ?? new Map<NoteSyncField, number>();
	for (const field of noteChangeFields(changes)) fields.set(field, nextNoteMutationEpoch());
	noteMutationFieldEpochs.set(noteId, fields);
}

export function captureNoteSyncSnapshot(): NoteSyncSnapshot {
	const dirtyFields = new Map<string, Set<NoteSyncField>>();
	for (const [noteId, state] of noteCommitStates) {
		const fields = new Set([...noteChangeFields(state.inflight), ...noteChangeFields(state.pending)]);
		if (fields.size) dirtyFields.set(noteId, fields);
	}
	return { epoch: noteMutationEpoch, dirtyFields };
}

export function protectedNoteFieldsSince(snapshot: NoteSyncSnapshot): ProtectedNoteFields {
	const protectedFields = new Map<string, Set<NoteSyncField>>(
		[...snapshot.dirtyFields].map(([noteId, fields]) => [noteId, new Set(fields)]),
	);
	for (const [noteId, epochs] of noteMutationFieldEpochs) {
		for (const [field, epoch] of epochs) {
			if (epoch <= snapshot.epoch) continue;
			const fields = protectedFields.get(noteId) ?? new Set<NoteSyncField>();
			fields.add(field);
			protectedFields.set(noteId, fields);
		}
	}
	return protectedFields;
}

let pendingNoteNetworkOps = 0;
let notesTreeScrollTop = 0;

export function trackNoteNetworkOp<T>(work: Promise<T>): Promise<T> {
	pendingNoteNetworkOps += 1;
	return work.finally(() => {
		pendingNoteNetworkOps = Math.max(0, pendingNoteNetworkOps - 1);
	});
}

export function hasUnsyncedNoteChanges(): boolean {
	if (pendingNoteNetworkOps > 0) return true;
	for (const state of noteCommitStates.values()) {
		if (
			state.pending ||
			state.inflight ||
			state.active ||
			state.status === 'pending' ||
			state.status === 'syncing' ||
			state.status === 'failed'
		)
			return true;
	}
	return false;
}

export function scheduleNoteCommit(state: NoteCommitState, delay = NOTE_AUTOSAVE_IDLE_DELAY): void {
	window.clearTimeout(state.idleTimer);
	if (!state.pending) return;
	state.idleTimer = window.setTimeout(() => void savePendingNote(state), delay);
	if (!state.intervalTimer && delay === NOTE_AUTOSAVE_IDLE_DELAY) {
		state.intervalTimer = window.setTimeout(() => {
			state.intervalTimer = 0;
			void savePendingNote(state);
		}, NOTE_AUTOSAVE_INTERVAL);
	}
}

export async function savePendingNote(state: NoteCommitState): Promise<boolean> {
	window.clearTimeout(state.idleTimer);
	window.clearTimeout(state.intervalTimer);
	state.idleTimer = 0;
	state.intervalTimer = 0;
	if (state.active) return state.active;
	if (!state.pending) return true;
	const changes = state.pending;
	state.pending = null;
	state.inflight = changes;
	state.attempts += 1;
	const stored = noteOutbox.get(state.note.id);
	if (stored) {
		stored.changes = { ...changes };
		stored.attempts = state.attempts;
		stored.nextAttemptAt = Date.now();
		persistNoteOutbox();
	}
	state.status = 'syncing';
	paintNoteSaveStatus(state.note.id, state.status);
	state.active = (async () => {
		try {
			const updated = await api.updateNote(state.note.id, changes);
			const localUpdatedAt = state.note.updatedAt;
			Object.assign(state.note, updated);
			if (state.pending) {
				Object.assign(state.note, state.pending);
				state.note.updatedAt = localUpdatedAt;
			}
			const current = state.data.items.find((note) => note.id === updated.id);
			if (current && current !== state.note) Object.assign(current, state.note);
			sortNotes(state.data.items);
			persistNotePages();
			state.failureReported = false;
			if (state.pending) {
				const pending = noteOutbox.get(state.note.id);
				if (pending) {
					pending.changes = { ...state.pending };
					pending.updatedAt = state.note.updatedAt;
					pending.nextAttemptAt = Date.now() + NOTE_AUTOSAVE_IDLE_DELAY;
				}
			} else {
				noteOutbox.delete(state.note.id);
			}
			persistNoteOutbox(true);
			state.status = state.pending ? 'pending' : 'synced';
			paintNoteSaveStatus(state.note.id, state.status);
			syncNoteMetadata(state.note);
			if (changes.pinned !== undefined) syncNotePinControls(state.note);
			if ((changes.folderId !== undefined || changes.archived !== undefined) && pageFromPath() === 'notes')
				replaceNotesSidebar(notesData ?? state.data, currentSelectedNoteId());
			return true;
		} catch (error) {
			state.pending = { ...changes, ...(state.pending ?? {}) };
			// A 4xx (other than 408/429) is a permanent rejection: keep the edits dirty
			// for a manual retry instead of looping requests that can never succeed.
			state.blocked =
				error instanceof ApiError &&
				error.status >= 400 &&
				error.status < 500 &&
				error.status !== 408 &&
				error.status !== 429;
			const pending = noteOutbox.get(state.note.id);
			if (pending) {
				pending.changes = { ...state.pending };
				pending.updatedAt = state.note.updatedAt;
				pending.nextAttemptAt = state.blocked
					? Number.POSITIVE_INFINITY
					: Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(state.attempts, 6));
				persistNoteOutbox();
			}
			state.status = 'failed';
			paintNoteSaveStatus(state.note.id, state.status);
			if (!state.failureReported) {
				state.failureReported = true;
				toast(errorMessage(error));
			}
			return false;
		} finally {
			state.inflight = null;
			state.active = null;
			if (state.pending && !state.blocked) {
				const nextAttemptAt = noteOutbox.get(state.note.id)?.nextAttemptAt ?? Date.now() + NOTE_AUTOSAVE_RETRY_DELAY;
				scheduleNoteCommit(state, Math.max(0, nextAttemptAt - Date.now()));
			}
		}
	})();
	return state.active;
}

export function queueNoteCommit(data: NotePage, note: Note, changes: NoteChanges): void {
	recordNoteMutation(note.id, changes);
	const state = noteCommitState(data, note);
	state.blocked = false;
	state.pending = { ...(state.pending ?? {}), ...changes };
	// Typing during a failed sync must not reset the backoff ladder.
	noteOutbox.set(note.id, {
		id: note.id,
		changes: { ...(state.inflight ?? {}), ...state.pending },
		updatedAt: note.updatedAt,
		attempts: state.attempts,
		nextAttemptAt: Date.now() + NOTE_AUTOSAVE_IDLE_DELAY,
	});
	persistNoteOutbox();
	state.status = 'pending';
	paintNoteSaveStatus(note.id, state.status);
	scheduleNoteCommit(state);
}

export async function flushNoteCommit(noteId: string): Promise<void> {
	const state = noteCommitStates.get(noteId);
	if (!state) return;
	window.clearTimeout(state.idleTimer);
	window.clearTimeout(state.intervalTimer);
	while (state.active || state.pending) {
		if (state.active) {
			await state.active;
			continue;
		}
		if (state.blocked) break;
		if (!(await savePendingNote(state))) break;
	}
}

export async function flushAllNoteCommits(): Promise<void> {
	await Promise.all(Array.from(noteCommitStates.keys(), (noteId) => flushNoteCommit(noteId)));
}

export function discardNoteCommit(noteId: string): void {
	const state = noteCommitStates.get(noteId);
	if (!state) return;
	window.clearTimeout(state.idleTimer);
	window.clearTimeout(state.intervalTimer);
	state.pending = null;
	noteCommitStates.delete(noteId);
	noteOutbox.delete(noteId);
	persistNoteOutbox(true);
}
