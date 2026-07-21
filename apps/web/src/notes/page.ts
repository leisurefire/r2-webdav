import type { Note, NotePage } from '@r2-webdav/shared-types';
import { api } from '../api/client';
import { confirmAction, errorMessage, html, loadingMarkup, pageFromPath, refreshIcons, shell, sidebarContext, toast } from '../shell';
import { locale, t } from '../i18n';
import { cacheNotes, cachedNotes, invalidateNoteCaches, noteCacheKey } from './cache';
import { discardNoteCommit, flushAllNoteCommits, flushNoteCommit, noteCommitStates, trackNoteNetworkOp } from './commits';
import { bindNoteEditor, noteEditorMarkup, noteToolbarMarkup, paintNoteSaveStatus } from './editorPane';
import { noteFolderPath } from './folderTree';
import { bindNoteSidebar, bindNotesFolders, bindNotesNavigation, notesFolderSidebarMarkup } from './sidebar';
import {
	ensureFolderNotesLoaded,
	ensureNoteContent,
	emptyNotePage,
	hydrateExpandedNoteScopes,
	loadArchivedNotes,
	loadNoteFolders,
	mergeNotesIntoPage,
	mergePendingNoteStates,
	resetNoteScopes,
} from './scope';
import {
	archivedNotesData,
	archiveExpanded,
	mobileNoteDialogOpen,
	noteContentLoaded,
	noteContentLoading,
	noteFolders,
	notesData,
	notesLoadingMore,
	noteSort,
	noteSortValues,
	currentNotesRequest,
	nextNotesRequest,
	noteScopesLoaded,
	setArchiveExpanded,
	setArchivedNotesData,
	setMobileNoteDialogOpen,
	setNotesData,
	setNotesLoadingMore,
	validatedNotePages,
} from './store';

let notesTreeScrollTop = 0;
export function setNotesTreeScrollTop(next: number): void {
	notesTreeScrollTop = next;
}

export function sortNotes(items: Note[]): void {
	const collator = new Intl.Collator(locale === 'zh' ? 'zh-CN' : 'en', { numeric: true, sensitivity: 'base' });
	items.sort((left, right) => {
		const pinned = Number(right.pinned) - Number(left.pinned);
		if (pinned) return pinned;
		switch (noteSort) {
			case 'name-asc':
				return collator.compare(left.title, right.title);
			case 'name-desc':
				return collator.compare(right.title, left.title);
			case 'modified-asc':
				return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
			case 'created-desc':
				return Date.parse(right.createdAt) - Date.parse(left.createdAt);
			case 'created-asc':
				return Date.parse(left.createdAt) - Date.parse(right.createdAt);
			default:
				return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
		}
	});
}

export function rememberNotesTreeScroll(root: ParentNode | null | undefined = document): void {
	const list = root?.querySelector?.<HTMLElement>('[data-notes-tree]:not(.bookmark-folder-tree)');
	if (list) notesTreeScrollTop = list.scrollTop;
}

export function restoreNotesTreeScroll(root: ParentNode | null | undefined = document): void {
	const list = root?.querySelector?.<HTMLElement>('[data-notes-tree]:not(.bookmark-folder-tree)');
	if (list) list.scrollTop = notesTreeScrollTop;
}

export function currentSelectedNoteId(): string | undefined {
	return document.querySelector<HTMLElement>('.note-editor-desktop[data-note-editor-id]')?.dataset.noteEditorId;
}

export async function deleteNote(selected: Note): Promise<void> {
	if (!(await confirmAction(`${t('delete')}?`, selected.title, t('delete')))) return;
	const deleted = { ...selected };
	const source = selected.archived ? archivedNotesData : notesData;
	const snapshot = source ? { ...source, items: [...source.items] } : null;
	discardNoteCommit(selected.id);
	if (source) {
		source.items = source.items.filter((item) => item.id !== selected.id);
		source.total = Math.max(0, source.total - 1);
	}
	if (!selected.archived && selected.folderId) {
		const folder = noteFolders.find((item) => item.id === selected.folderId);
		if (folder) folder.noteCount = Math.max(0, folder.noteCount - 1);
	}
	invalidateNoteCaches();
	if (notesData) cacheNotes(notesData, false);
	if (archivedNotesData) cacheNotes(archivedNotesData, true, undefined);
	if (mobileNoteDialogOpen) history.back();
	if (notesData) paintNotes(notesData, currentSelectedNoteId() === selected.id ? undefined : currentSelectedNoteId());
	void trackNoteNetworkOp(
		api.deleteNote(deleted.id).catch((error) => {
			if (snapshot && source) {
				source.items = snapshot.items;
				source.total = snapshot.total;
				if (!deleted.archived && deleted.folderId) {
					const folder = noteFolders.find((item) => item.id === deleted.folderId);
					if (folder) folder.noteCount += 1;
				}
				if (notesData) cacheNotes(notesData, false);
				if (archivedNotesData) cacheNotes(archivedNotesData, true, undefined);
				paintNotes(notesData ?? source, deleted.id);
			}
			toast(errorMessage(error));
		}),
	);
}

export function replaceNotesSidebar(data: NotePage, selectedId?: string): void {
	const currents = [...document.querySelectorAll<HTMLElement>('.notes-folders')];
	if (!currents.length) return;
	rememberNotesTreeScroll(currents[0]);
	const scrollTop = notesTreeScrollTop;
	const selected =
		data.items.find((note) => note.id === selectedId) ??
		archivedNotesData?.items.find((note) => note.id === selectedId);
	for (const current of currents) {
		const wrapper = document.createElement('div');
		wrapper.innerHTML = notesFolderSidebarMarkup(data, selected).trim();
		const next = wrapper.firstElementChild;
		if (!(next instanceof HTMLElement)) continue;
		current.replaceWith(next);
		bindNotesNavigation(next);
		bindNoteSidebar(next, data, selected);
		next.querySelectorAll('[data-notes-refresh]').forEach((node) =>
			node.addEventListener('click', () => {
				void flushAllNoteCommits().then(() => renderNotes(selectedId, true));
			}),
		);
		const list = next.querySelector<HTMLElement>('[data-notes-tree]');
		if (list) list.scrollTop = scrollTop;
	}
	refreshIcons();
}

export function paintNotes(data: NotePage, selectedId?: string, openMobile = false): void {
	const content = document.querySelector<HTMLDivElement>('#page-content');
	if (!content) return;
	rememberNotesTreeScroll();
	sortNotes(data.items);
	const archivedSelected = archivedNotesData?.items.find((note) => note.id === selectedId);
	const selected =
		data.items.find((note) => note.id === selectedId) ??
		archivedSelected ??
		data.items.find((note) => note.pinned) ??
		data.items[0];
	if (selected && !noteContentLoaded.has(selected.id) && !noteContentLoading.has(selected.id)) {
		void ensureNoteContent(selected).then((full) => {
			if (!noteContentLoaded.has(full.id)) return;
			if (noteCommitStates.get(full.id)?.pending || noteCommitStates.get(full.id)?.active) return;
			if (currentSelectedNoteId() === full.id && pageFromPath() === 'notes') {
				paintNotes(full.archived ? (archivedNotesData ?? data) : (notesData ?? data), full.id, false);
			}
		});
	}
	const selectedData = archivedSelected ? archivedNotesData! : data;
	const folderSidebar = notesFolderSidebarMarkup(data, selected);
	const context = sidebarContext();
	if (context) context.innerHTML = folderSidebar;
	content.innerHTML = `<div class="notes-layout">
		${selected ? noteToolbarMarkup(selected) : `<div class="notes-inner-toolbar"><span class="muted">${t('noNotes')}</span></div>`}
		<div class="notes-mobile-sidebar">${folderSidebar}</div>
		${selected ? noteEditorMarkup(selected) : `<section class="note-editor note-editor-desktop"><div class="notes-empty large"><i data-lucide="sticky-note"></i><span>${t('noNotes')}</span></div></section>`}
	</div>
		${selected ? `<dialog class="note-dialog" id="note-dialog">${noteEditorMarkup(selected, true)}</dialog>` : ''}`;
	refreshIcons();
	if (context) {
		bindNotesNavigation(context);
		bindNoteSidebar(context, data, selected);
	}
	const mobileSidebar = content.querySelector<HTMLElement>('.notes-mobile-sidebar');
	if (mobileSidebar) {
		bindNotesNavigation(mobileSidebar);
		bindNoteSidebar(mobileSidebar, data, selected);
	}
	restoreNotesTreeScroll();
	const refreshNotes = async () => {
		await flushAllNoteCommits();
		await renderNotes(selected?.id, true);
	};
	content.querySelectorAll('[data-notes-refresh], #notes-refresh').forEach((node) =>
		node.addEventListener('click', () => void refreshNotes()),
	);
	context?.querySelectorAll('[data-notes-refresh], #notes-refresh').forEach((node) =>
		node.addEventListener('click', () => void refreshNotes()),
	);
	if (!selected) return;
	const desktopEditor = content.querySelector<HTMLElement>('.note-editor-desktop');
	if (desktopEditor) bindNoteEditor(desktopEditor, selectedData, selected, false, content);
	const dialog = content.querySelector<HTMLDialogElement>('#note-dialog');
	if (dialog) {
		bindNoteEditor(dialog, selectedData, selected, true);
		if (openMobile && matchMedia('(max-width: 760px)').matches) {
			history.pushState({ noteDialog: selected.id }, '', location.href);
			setMobileNoteDialogOpen(true);
			dialog.showModal();
			dialog.addEventListener('cancel', (event) => {
				event.preventDefault();
				history.back();
			});
		}
	}
}

export async function loadMoreNotes(selectedId?: string, scrollTop = 0): Promise<void> {
	// Scopes are fully fetched on expand; scroll only hydrates archive when still paginated.
	if (!archiveExpanded || !archivedNotesData?.hasMore || notesLoadingMore) return;
	setNotesLoadingMore(true);
	const status = document.querySelector<HTMLElement>('.notes-load-status');
	if (status) status.innerHTML = loadingMarkup(true);
	const current = archivedNotesData;
	try {
		const next = await api.notes(current.page + 1, true, undefined, { limit: 50, content: false });
		if (archivedNotesData !== current || !archiveExpanded || pageFromPath() !== 'notes') return;
		mergeNotesIntoPage(current, next.items, false);
		current.page = next.page;
		current.pageSize = next.pageSize;
		current.total = next.total;
		current.hasMore = next.hasMore;
		if (!next.hasMore) noteScopesLoaded.add('archive');
		cacheNotes(current, true);
		if (notesData) replaceNotesSidebar(notesData, selectedId);
		const list = document.querySelector<HTMLElement>('[data-notes-tree]');
		if (list) list.scrollTop = scrollTop;
	} catch (error) {
		toast(errorMessage(error));
	} finally {
		setNotesLoadingMore(false);
		const currentStatus = document.querySelector<HTMLElement>('.notes-load-status');
		if (currentStatus) currentStatus.replaceChildren();
	}
}

export async function renderNotes(selectedId?: string, forceSync = false, openMobile = false): Promise<void> {
	shell('notes', t('notes'));
	await loadNoteFolders(forceSync);
	// Tree indexes load by intent: root always, expanded folders on demand.
	const treeFolderId = null as string | null;
	const cached = forceSync ? null : cachedNotes(false);
	if (cached) {
		mergePendingNoteStates(cached, false, undefined);
		setNotesData(cached);
		// Cached pages are treated as a partial index until scopes revalidate.
		paintNotes(cached, selectedId, openMobile);
	} else if (!notesData) {
		setNotesData(emptyNotePage());
		paintNotes(notesData!, selectedId, openMobile);
	}
	const cacheKey = noteCacheKey(false);
	if (!forceSync && validatedNotePages.has(cacheKey) && cached && noteScopesLoaded.has('root')) {
		setNotesData(cached);
		await hydrateExpandedNoteScopes(false);
		if (selectedId) {
			const selected =
				notesData!.items.find((note) => note.id === selectedId) ??
				archivedNotesData?.items.find((note) => note.id === selectedId);
			if (selected) await ensureNoteContent(selected);
		}
		if (archiveExpanded) await loadArchivedNotes(false);
		return;
	}
	validatedNotePages.add(cacheKey);
	const request = nextNotesRequest();
	try {
		if (forceSync) resetNoteScopes();
		await hydrateExpandedNoteScopes(forceSync);
		if (request !== currentNotesRequest()) return;
		if (!notesData) setNotesData(emptyNotePage());
		mergePendingNoteStates(notesData!, false, undefined);
		cacheNotes(notesData!, false);
		if (selectedId) {
			let selected =
				notesData!.items.find((note) => note.id === selectedId) ??
				archivedNotesData?.items.find((note) => note.id === selectedId);
			if (!selected) {
				try {
					const full = await api.getNote(selectedId);
					noteContentLoaded.add(full.id);
					if (full.archived) {
						if (!archivedNotesData) setArchivedNotesData(emptyNotePage());
						mergeNotesIntoPage(archivedNotesData!, [full], true);
						setArchiveExpanded(true);
					} else {
						mergeNotesIntoPage(notesData!, [full], true);
					}
					selected = full;
				} catch {
					// Selected note may have been deleted.
				}
			} else {
				await ensureNoteContent(selected);
			}
		}
		if (pageFromPath() === 'notes') paintNotes(notesData!, selectedId, openMobile);
		if (archiveExpanded) await loadArchivedNotes(forceSync);
	} catch (error) {
		validatedNotePages.delete(cacheKey);
		if (!cached && !(notesData?.items.length))
			document.querySelector('#page-content')!.innerHTML =
				`<div class="error-banner">${html(errorMessage(error))}</div>`;
		else toast(errorMessage(error));
	}
}
