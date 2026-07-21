import type { NoteFolder, NotePage } from '@r2-webdav/shared-types';

export type NoteSort = 'name-asc' | 'name-desc' | 'modified-desc' | 'modified-asc' | 'created-desc' | 'created-asc';
export const noteSortValues: NoteSort[] = [
	'name-asc',
	'name-desc',
	'modified-desc',
	'modified-asc',
	'created-desc',
	'created-asc',
];
const savedNoteSort = localStorage.getItem('r2_note_sort') as NoteSort | null;
export let noteSort: NoteSort = savedNoteSort && noteSortValues.includes(savedNoteSort) ? savedNoteSort : 'modified-desc';
export function setNoteSort(next: NoteSort): void {
	noteSort = next;
}
export let notesData: NotePage | null = null;
export function setNotesData(next: NotePage | null): void {
	notesData = next;
}
export let archivedNotesData: NotePage | null = null;
export function setArchivedNotesData(next: NotePage | null): void {
	archivedNotesData = next;
}
export let archiveExpanded = false;
export function setArchiveExpanded(next: boolean): void {
	archiveExpanded = next;
}
export let notesLoadingMore = false;
export function setNotesLoadingMore(next: boolean): void {
	notesLoadingMore = next;
}
let notesRequest = 0;
export function nextNotesRequest(): number {
	return ++notesRequest;
}
export function currentNotesRequest(): number {
	return notesRequest;
}
let archivedNotesRequest = 0;
export function nextArchivedNotesRequest(): number {
	return ++archivedNotesRequest;
}
export function currentArchivedNotesRequest(): number {
	return archivedNotesRequest;
}
export let noteFolders: NoteFolder[] = [];
export function setNoteFolders(next: NoteFolder[]): void {
	noteFolders = next;
}
export let noteFoldersLoaded = false;
export function setNoteFoldersLoaded(next: boolean): void {
	noteFoldersLoaded = next;
}
/** Folder used only as the target for newly created notes. Opening a folder never selects a note. */
export let selectedNoteFolderId: string | null | undefined;
export function setSelectedNoteFolderId(next: string | null | undefined): void {
	selectedNoteFolderId = next;
}
/** Obsidian-style folder expand state; folders start collapsed and only open on user click. */
export const noteExpandedFolders = new Set<string>();
/** Folder scopes whose note index pages are fully loaded ('root' | folder id | 'archive'). */
export const noteScopesLoaded = new Set<string>();
/** Folder scopes currently fetching note indexes. */
export const noteScopesLoading = new Set<string>();
/** Monotonic request ids prevent an older scope response from replacing a forced refresh. */
export const noteScopeRequests = new Map<string, number>();
/** Note ids whose full body has been fetched (meta list omits content). */
export const noteContentLoaded = new Set<string>();
export const noteContentLoading = new Set<string>();
export let draggingNoteFolderId: string | null = null;
export function setDraggingNoteFolderId(next: string | null): void {
	draggingNoteFolderId = next;
}
export const noteFolderMutationVersions = new Map<string, number>();
export let mobileNoteDialogOpen = false;
export function setMobileNoteDialogOpen(next: boolean): void {
	mobileNoteDialogOpen = next;
}
export let flushMobileNote: (() => Promise<void>) | null = null;
export function setFlushMobileNote(next: (() => Promise<void>) | null): void {
	flushMobileNote = next;
}
export let mobileNoteId: string | undefined;
export function setMobileNoteId(next: string | undefined): void {
	mobileNoteId = next;
}
export const validatedNotePages = new Set<string>();
