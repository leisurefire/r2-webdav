import type { Note, NotePage } from '@r2-webdav/shared-types';
import { api } from '../api/client';
import {
	closeActionMenus,
	confirmAction,
	errorMessage,
	html,
	loadingMarkup,
	pageFromPath,
	refreshIcons,
	toast,
} from '../shell';
import { locale, t } from '../i18n';
import { openFolderDialog, openTextDialog, renderTreeNodes } from '../ui/helpers';
import { trackNoteNetworkOp } from './commits';
import {
	buildNoteFolderTree,
	canMoveNoteFolder,
	flattenNoteFolderTree,
	noteFolderDescendantIds,
	noteFolderPath,
} from './folderTree';
import {
	archivedNotesData,
	archiveExpanded,
	draggingNoteFolderId,
	highlightedNoteFolderId,
	mobileNoteDialogOpen,
	noteContentLoaded,
	noteExpandedFolders,
	noteFolders,
	noteFoldersLoaded,
	noteScopesLoaded,
	noteScopesLoading,
	notesData,
	notesLoadingMore,
	noteSort,
	noteSortValues,
	type NoteSort,
	selectedNoteFolderId,
	setArchiveExpanded,
	setArchivedNotesData,
	setDraggingNoteFolderId,
	setNoteFolders,
	setNoteFoldersLoaded,
	setNoteSort,
	setNotesData,
	setSelectedNoteFolderId,
} from './store';
import {
	effectiveNoteFolderId,
	emptyNotePage,
	ensureFolderNotesLoaded,
	ensureNoteContent,
	knownNoteFolderIds,
	loadArchivedNotes,
	mergeNotesIntoPage,
	moveNoteFolderOptimistically,
	noteScopeKey,
	loadNoteFolders,
	optimisticallyUpdateNote,
} from './scope';
import {
	currentSelectedNoteId,
	deleteNote,
	loadMoreNotes,
	paintNotes,
	renderNotes,
	replaceNotesSidebar,
	setNotesTreeScrollTop,
	sortNotes,
} from './page';
import { syncNoteMetadata, syncNotePinControls } from './editorPane';
import type { NoteChanges } from './outbox';
import { cacheNotes, invalidateNoteCaches } from './cache';

export function noteSortMenuMarkup(): string {
	const labels: Record<NoteSort, string> =
		locale === 'zh'
			? {
					'name-asc': '文件名 A-Z',
					'name-desc': '文件名 Z-A',
					'modified-desc': '修改时间：新到旧',
					'modified-asc': '修改时间：旧到新',
					'created-desc': '创建时间：新到旧',
					'created-asc': '创建时间：旧到新',
				}
			: {
					'name-asc': 'Name A-Z',
					'name-desc': 'Name Z-A',
					'modified-desc': 'Modified: newest',
					'modified-asc': 'Modified: oldest',
					'created-desc': 'Created: newest',
					'created-asc': 'Created: oldest',
				};
	return `<div class="action-menu note-sort-menu" data-action-menu><button class="row-action" data-menu-toggle title="${locale === 'zh' ? '排序方式' : 'Sort notes'}" aria-label="${locale === 'zh' ? '排序方式' : 'Sort notes'}" aria-expanded="false"><i data-lucide="sort-asc"></i></button><div class="action-menu-popover" data-menu-popover role="menu">${noteSortValues.map((value) => `<button class="${noteSort === value ? 'selected' : ''}" data-note-sort-value="${value}" role="menuitemradio" aria-checked="${noteSort === value}"><span>${labels[value]}</span>${noteSort === value ? '<i data-lucide="check"></i>' : ''}</button>`).join('')}</div></div>`;
}

export function noteCardMarkup(note: Note, selected?: Note): string {
	return `<article class="note-card ${note.id === selected?.id ? 'active' : ''}" draggable="true" data-note-card-id="${html(note.id)}"><button class="note-card-open" data-note="${html(note.id)}">
		<div class="note-card-title"><span class="note-card-leading" aria-hidden="true"><i data-lucide="${note.pinned ? 'pin' : 'file'}"></i></span><span class="note-card-label">${html(note.title)}</span></div>
	</button>
	<div class="note-card-actions action-menu" data-action-menu>
			<button class="row-action" data-menu-toggle title="${locale === 'zh' ? '更多操作' : 'More actions'}" aria-label="${locale === 'zh' ? '更多操作' : 'More actions'}" aria-expanded="false"><i data-lucide="more-horizontal"></i></button>
			<div class="action-menu-popover" data-menu-popover role="menu">
				<button data-note-card-move="${html(note.id)}" role="menuitem"><i data-lucide="folder-input"></i><span>${locale === 'zh' ? '移动到目录' : 'Move to folder'}</span></button>
				<button data-note-card-pin="${html(note.id)}" role="menuitem"><i data-lucide="${note.pinned ? 'pin-off' : 'pin'}"></i><span>${note.pinned ? t('unpin') : t('pin')}</span></button>
				<button data-note-card-archive="${html(note.id)}" role="menuitem"><i data-lucide="archive"></i><span>${note.archived ? t('restore') : t('archive')}</span></button>
				<button class="danger" data-note-card-delete="${html(note.id)}" role="menuitem"><i data-lucide="trash-2"></i><span>${t('delete')}</span></button>
			</div>
		</div>
	</article>`;
}

export function notesFolderSidebarMarkup(data: NotePage, selected?: Note): string {
	const caret = (expanded: boolean) =>
		`<i class="tree-caret-icon" data-lucide="${expanded ? 'chevron-down' : 'chevron-right'}" aria-hidden="true"></i>`;
	const notesFor = (folderId: string | null) =>
		data.items.filter((note) => !note.archived && effectiveNoteFolderId(note) === folderId);
	type NoteTreeNode = {
		kind: 'folder' | 'note' | 'archive';
		key: string;
		name: string;
		expanded: boolean;
		loading: boolean;
		active: boolean;
		children: NoteTreeNode[];
		note?: Note;
	};
	const noteNodes = (items: Note[]): NoteTreeNode[] =>
		items.map((note) => ({
			kind: 'note',
			key: note.id,
			name: note.title,
			expanded: false,
			loading: false,
			active: note.id === selected?.id,
			children: [],
			note,
		}));
	const rootNotes = notesFor(null);
	// Pinned root notes stay above folders; unpinned root notes stay below folders.
	const pinnedRootNotes = rootNotes.filter((note) => note.pinned);
	const unpinnedRootNotes = rootNotes.filter((note) => !note.pinned);
	const folderNode = (node: ReturnType<typeof buildNoteFolderTree>[number]): NoteTreeNode => {
		const folderNotes = notesFor(node.folder.id);
		const expanded = noteExpandedFolders.has(node.folder.id);
		const scope = noteScopeKey(node.folder.id, false);
		return {
			kind: 'folder',
			key: node.folder.id,
			name: node.folder.name,
			expanded,
			loading: expanded && noteScopesLoading.has(scope),
			active: false,
			children: [...node.children.map(folderNode), ...noteNodes(folderNotes)],
		};
	};
	const folderTree = buildNoteFolderTree(noteFolders).map(folderNode);
	const archiveTree: NoteTreeNode[] = [
		{
			kind: 'archive',
			key: 'archive',
			name: t('archived'),
			expanded: archiveExpanded,
			loading: false,
			active: false,
			children: archiveExpanded ? noteNodes(archivedNotesData?.items ?? []) : [],
		},
	];
	const renderFolderish = (nodes: NoteTreeNode[]) =>
		renderTreeNodes(
			nodes,
			(node) => node.children,
			(node, depth, children) => {
				if (node.kind === 'note') {
					return node.note ? noteCardMarkup(node.note, selected) : '';
				}
				const folder = node.kind === 'folder';
				const icon = folder
					? node.loading
						? '<span class="note-tree-leading" aria-hidden="true"><i class="note-tree-loader" data-lucide="loader-circle"></i></span>'
						: `<span class="note-tree-leading" aria-hidden="true"><i class="tree-folder-icon" data-lucide="${node.expanded ? 'folder-open' : 'folder'}"></i>${caret(node.expanded)}</span>`
					: caret(node.expanded);
				const actions = folder
					? `<div class="note-folder-actions action-menu" data-action-menu><button class="row-action" data-new-note="${html(node.key)}" title="${t('newNote')}" aria-label="${t('newNote')}"><i data-lucide="plus"></i></button><button class="row-action" data-menu-toggle title="${locale === 'zh' ? '更多操作' : 'More actions'}" aria-label="${locale === 'zh' ? '更多操作' : 'More actions'}" aria-expanded="false"><i data-lucide="more-horizontal"></i></button><div class="action-menu-popover" data-menu-popover role="menu"><button data-move-note-folder="${html(node.key)}" role="menuitem"><i data-lucide="folder-input"></i><span>${locale === 'zh' ? '移动目录' : 'Move folder'}</span></button><button data-rename-note-folder="${html(node.key)}" role="menuitem"><i data-lucide="pencil"></i><span>${locale === 'zh' ? '重命名' : 'Rename'}</span></button><button class="danger" data-delete-note-folder="${html(node.key)}" role="menuitem"><i data-lucide="folder-minus"></i><span>${locale === 'zh' ? '解散' : 'Dissolve'}</span></button></div></div>`
					: '';
				const filter = node.kind === 'archive' ? 'data-note-archived' : `data-note-folder-filter="${html(node.key)}"`;
				const drop = node.kind === 'archive' ? 'archive' : node.key;
				const draggable = folder ? ` draggable="true" data-note-folder-id="${html(node.key)}"` : '';
				const highlighted = folder && highlightedNoteFolderId === node.key ? 'path-highlight' : '';
				return `<div class="note-tree-node ${folder ? 'note-folder-card' : 'note-tree-special'} ${node.kind === 'archive' ? 'archive-tree-item' : ''} ${node.active ? 'active' : ''} ${node.expanded ? 'expanded' : ''}" data-note-folder-drop="${html(drop)}" style="--tree-depth:${depth}"${draggable}><button type="button" class="collection-tree-row ${highlighted}" ${filter}>${icon}<span>${html(node.name)}</span></button>${actions}${node.expanded && children ? `<div class="notes-tree-children">${children}</div>` : ''}</div>`;
			},
		);
	const rootStatus =
		noteScopesLoading.has('root') || !noteScopesLoaded.has('root')
			? `<div class="note-scope-status muted">${locale === 'zh' ? '加载中…' : 'Loading…'}</div>`
			: '';
	const pinnedRootMarkup = pinnedRootNotes.length
		? `<div class="notes-tree-children notes-tree-root notes-tree-root-pinned" data-note-folder-drop="root">${pinnedRootNotes.map((note) => noteCardMarkup(note, selected)).join('')}</div>`
		: '';
	const unpinnedRootMarkup = `<div class="notes-tree-children notes-tree-root notes-tree-root-unpinned" data-note-folder-drop="root">${unpinnedRootNotes.map((note) => noteCardMarkup(note, selected)).join('')}${rootStatus}</div>`;
	const folderMarkup = renderFolderish(folderTree);
	const archiveMarkup = renderFolderish(archiveTree);
	return `<aside class="notes-folders" aria-label="${locale === 'zh' ? '便签目录' : 'Note folders'}">
		<div class="notes-folders-head sidebar-context-head"><strong>${locale === 'zh' ? '便签目录' : 'Note folders'}</strong><div class="notes-folder-tools sidebar-context-tools"><button class="row-action" data-new-note title="${t('newNote')}" aria-label="${t('newNote')}"><i data-lucide="plus"></i></button><button class="row-action" data-new-note-folder title="${locale === 'zh' ? '新建目录' : 'New folder'}" aria-label="${locale === 'zh' ? '新建目录' : 'New folder'}"><i data-lucide="folder-plus"></i></button>${noteSortMenuMarkup()}<button type="button" class="row-action" data-notes-refresh title="${locale === 'zh' ? '同步便签' : 'Sync notes'}" aria-label="${locale === 'zh' ? '同步便签' : 'Sync notes'}"><i data-lucide="refresh-cw"></i></button></div></div>
		<div class="notes-tree" data-notes-tree>
			${pinnedRootMarkup}${folderMarkup}${unpinnedRootMarkup}${archiveMarkup}
		</div>
		<div class="notes-load-status" aria-live="polite">${notesLoadingMore ? loadingMarkup(true) : ''}</div>
	</aside>`;
}

export function bindNotesFolders(content: HTMLElement, data: NotePage): void {
	const toggleFolder = (value: string) => {
		if (value === 'all' || value === 'root') {
			// Root is always visible; only clear the create-target marker.
			setSelectedNoteFolderId(value === 'root' ? null : undefined);
			if (notesData) replaceNotesSidebar(notesData, currentSelectedNoteId());
			void ensureFolderNotesLoaded(null);
			return;
		}
		// Obsidian behavior: click expands a closed folder, click again collapses it.
		// Never auto-switch the open note when toggling folders.
		if (noteExpandedFolders.has(value)) {
			noteExpandedFolders.delete(value);
			if (selectedNoteFolderId === value) setSelectedNoteFolderId(undefined);
			if (notesData) replaceNotesSidebar(notesData, currentSelectedNoteId());
			else void renderNotes(currentSelectedNoteId(), false);
			return;
		}
		noteExpandedFolders.add(value);
		// Remember as create-target only; do not open/select any note.
		setSelectedNoteFolderId(value);
		if (notesData) replaceNotesSidebar(notesData, currentSelectedNoteId());
		else void renderNotes(currentSelectedNoteId(), false);
		// Intent: expanding a folder loads that folder's note index (not global recency).
		void ensureFolderNotesLoaded(value);
	};
	content
		.querySelectorAll<HTMLElement>('[data-note-folder-filter]')
		.forEach((button) =>
			button.addEventListener('click', () => toggleFolder(button.dataset.noteFolderFilter ?? 'all')),
		);
	content.querySelector('[data-new-note-folder]')?.addEventListener('click', async () => {
		const name = await openTextDialog(
			locale === 'zh' ? '新建便签目录' : 'New note folder',
			locale === 'zh' ? '目录名称' : 'Folder name',
		);
		if (!name) return;
		try {
			const parentId = typeof selectedNoteFolderId === 'string' ? selectedNoteFolderId : null;
			const created = await api.createNoteFolder(name, parentId);
			noteFolders.push(created);
			setNoteFoldersLoaded(true);
			if (parentId) noteExpandedFolders.add(parentId);
			// Stay in the current view instead of jumping into the empty folder,
			// which made the note list look like it was wiped.
			if (notesData) paintNotes(notesData, currentSelectedNoteId());
		} catch (error) {
			toast(errorMessage(error));
		}
	});
	content.querySelectorAll<HTMLElement>('[data-rename-note-folder]').forEach((button) =>
		button.addEventListener('click', async (event) => {
			event.stopPropagation();
			const folder = noteFolders.find((item) => item.id === button.dataset.renameNoteFolder);
			if (!folder) return;
			const name = await openTextDialog(
				locale === 'zh' ? '重命名便签目录' : 'Rename note folder',
				locale === 'zh' ? '目录名称' : 'Folder name',
				folder.name,
			);
			if (!name || name === folder.name) return;
			try {
				const updated = await api.updateNoteFolder(folder.id, { name });
				Object.assign(folder, updated);
				if (notesData) replaceNotesSidebar(notesData, currentSelectedNoteId());
			} catch (error) {
				toast(errorMessage(error));
			}
		}),
	);
	content.querySelectorAll<HTMLElement>('[data-delete-note-folder]').forEach((button) =>
		button.addEventListener('click', async (event) => {
			event.stopPropagation();
			const folder = noteFolders.find((item) => item.id === button.dataset.deleteNoteFolder);
			if (
				!folder ||
				!(await confirmAction(
					locale === 'zh' ? '解散便签目录？' : 'Dissolve note folder?',
					locale === 'zh'
						? '目录中的便签和子目录会移到上一级，不会被删除。'
						: 'Notes and subfolders will move up one level and will not be deleted.',
					locale === 'zh' ? '解散' : 'Dissolve',
				))
			)
				return;
			try {
				const parentId = folder.parentId;
				const selectedId = currentSelectedNoteId();
				// Optimistic reparent so notes never disappear behind a global page-1 reload.
				if (notesData) {
					for (const note of notesData.items) {
						if (note.folderId === folder.id) note.folderId = parentId;
					}
				}
				for (const child of noteFolders) {
					if (child.parentId === folder.id) child.parentId = parentId;
				}
				if (parentId) {
					const parent = noteFolders.find((item) => item.id === parentId);
					if (parent) parent.noteCount += folder.noteCount;
				}
				setNoteFolders(noteFolders.filter((item) => item.id !== folder.id));
				noteExpandedFolders.delete(folder.id);
				if (parentId) noteExpandedFolders.add(parentId);
				if (selectedNoteFolderId === folder.id) setSelectedNoteFolderId(parentId ?? null);
				noteScopesLoaded.delete(folder.id);
				noteScopesLoaded.delete(noteScopeKey(parentId, false));
				if (notesData) {
					cacheNotes(notesData, false);
					paintNotes(notesData, selectedId);
				}
				await api.deleteNoteFolder(folder.id);
				await loadNoteFolders(true);
				await ensureFolderNotesLoaded(parentId, true);
				if (notesData) paintNotes(notesData, selectedId);
			} catch (error) {
				toast(errorMessage(error));
				invalidateNoteCaches();
				await renderNotes(currentSelectedNoteId(), true);
			}
		}),
	);
	content.querySelectorAll<HTMLElement>('[data-move-note-folder]').forEach((button) =>
		button.addEventListener('click', async (event) => {
			event.stopPropagation();
			const folder = noteFolders.find((item) => item.id === button.dataset.moveNoteFolder);
			if (!folder) return;
			const destination = await openFolderDialog(
				locale === 'zh' ? '移动目录' : 'Move folder',
				noteFolders,
				folder.parentId ?? null,
				new Set([folder.id, ...noteFolderDescendantIds(noteFolders, folder.id)]),
			);
			if (destination === undefined || destination === (folder.parentId ?? null)) return;
			moveNoteFolderOptimistically(folder.id, destination);
		}),
	);
	const moveNote = (noteId: string, destination: string) => {
		const source = data.items.some((item) => item.id === noteId) ? data : archivedNotesData;
		const note = source?.items.find((item) => item.id === noteId);
		if (!note) return;
		// Reordering inside the same folder is not supported; only cross-folder / archive moves apply.
		if (destination === 'archive') {
			if (note.archived) return;
		} else if (destination === 'root') {
			if (!note.archived && (note.folderId ?? null) === null) return;
		} else if (!note.archived && note.folderId === destination) {
			return;
		}
		const changes: NoteChanges =
			destination === 'archive'
				? { archived: true }
				: { archived: false, folderId: destination === 'root' ? null : destination };
		// optimisticallyUpdateNote bumps updatedAt so the note sorts by edit time in the target folder.
		const leftCurrentView = optimisticallyUpdateNote(source ?? data, note, changes);
		if (typeof changes.folderId === 'string') {
			for (const folder of noteFolderPath(noteFolders, changes.folderId)) noteExpandedFolders.add(folder.id);
		}
		const selectedId = currentSelectedNoteId();
		if (leftCurrentView && selectedId === note.id && notesData) paintNotes(notesData);
		else {
			if (notesData) replaceNotesSidebar(notesData, selectedId);
			if (selectedId === note.id) syncNoteMetadata(note);
		}
	};
	const moveFolder = (folderId: string, destination: string) => {
		const folder = noteFolders.find((item) => item.id === folderId);
		if (!folder || destination === 'archive') return;
		const parentId = destination === 'root' ? null : destination;
		moveNoteFolderOptimistically(folderId, parentId);
	};
	content.querySelectorAll<HTMLElement>('[data-note-folder-id]').forEach((folderNode) => {
		folderNode.addEventListener('dragstart', (event) => {
			if ((event.target as HTMLElement).closest('[data-note-folder-id]') !== folderNode) return;
			if ((event.target as HTMLElement).closest('[data-note-card-id]')) return;
			setDraggingNoteFolderId(folderNode.dataset.noteFolderId ?? null);
			event.dataTransfer?.setData('text/x-truespace-note-folder', draggingNoteFolderId ?? '');
			if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
			folderNode.classList.add('dragging');
		});
		folderNode.addEventListener('dragend', () => {
			if (!folderNode.classList.contains('dragging')) return;
			setDraggingNoteFolderId(null);
			folderNode.classList.remove('dragging');
		});
	});
	content.querySelectorAll<HTMLElement>('[data-note-folder-drop]').forEach((target) => {
		target.addEventListener('dragover', (event) => {
			const destination = target.dataset.noteFolderDrop;
			if (
				draggingNoteFolderId &&
				(!destination ||
					destination === 'archive' ||
					(destination !== 'root' && !canMoveNoteFolder(noteFolders, draggingNoteFolderId, destination)))
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			target.classList.add('drag-over');
		});
		target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
		target.addEventListener('drop', (event) => {
			event.preventDefault();
			event.stopPropagation();
			target.classList.remove('drag-over');
			const destination = target.dataset.noteFolderDrop;
			const folderId = event.dataTransfer?.getData('text/x-truespace-note-folder') || draggingNoteFolderId;
			if (folderId && destination && destination !== 'archive') {
				moveFolder(folderId, destination);
				return;
			}
			const noteId = event.dataTransfer?.getData('text/x-truespace-note');
			if (noteId && destination) moveNote(noteId, destination);
		});
	});
	const tree = content.querySelector<HTMLElement>('[data-notes-tree]');
	tree?.addEventListener('dragover', (event) => {
		if ((event.target as HTMLElement).closest('[data-note-folder-drop]')) return;
		event.preventDefault();
		tree.classList.add('root-drag-over');
	});
	tree?.addEventListener('dragleave', (event) => {
		if (!tree.contains(event.relatedTarget as Node | null)) tree.classList.remove('root-drag-over');
	});
	tree?.addEventListener('drop', (event) => {
		if ((event.target as HTMLElement).closest('[data-note-folder-drop]')) return;
		event.preventDefault();
		tree.classList.remove('root-drag-over');
		const folderId = event.dataTransfer?.getData('text/x-truespace-note-folder') || draggingNoteFolderId;
		if (folderId) moveFolder(folderId, 'root');
		else {
			const noteId = event.dataTransfer?.getData('text/x-truespace-note');
			if (noteId) moveNote(noteId, 'root');
		}
	});
}

export function bindNotesNavigation(content: HTMLElement): void {
	content.querySelectorAll<HTMLElement>('[data-note-archived]').forEach((node) =>
		node.addEventListener('click', () => {
			setArchiveExpanded(!archiveExpanded);
			if (notesData) replaceNotesSidebar(notesData, currentSelectedNoteId());
			if (archiveExpanded) void loadArchivedNotes();
		}),
	);
}

export function bindNoteSidebar(content: HTMLElement, data: NotePage, selected?: Note): void {
	const noteFor = (noteId: string | undefined) =>
		data.items.find((item) => item.id === noteId) ?? archivedNotesData?.items.find((item) => item.id === noteId);
	content.querySelectorAll<HTMLElement>('[data-note]').forEach((node) => {
		node.addEventListener('click', () => {
			const noteId = node.dataset.note;
			const note =
				data.items.find((item) => item.id === noteId) ?? archivedNotesData?.items.find((item) => item.id === noteId);
			// Only a note click switches the open document; also reveal its folder.
			if (note) {
				if (note.folderId && knownNoteFolderIds().has(note.folderId)) {
					for (const folder of noteFolderPath(noteFolders, note.folderId)) noteExpandedFolders.add(folder.id);
					setSelectedNoteFolderId(note.folderId);
				} else {
					setSelectedNoteFolderId(null);
				}
				if (note.archived) setArchiveExpanded(true);
				// Paint immediately with cached meta, then hydrate body if needed.
				paintNotes(note.archived ? (archivedNotesData ?? data) : (notesData ?? data), note.id, true);
				void ensureNoteContent(note).then((full) => {
					if (currentSelectedNoteId() === full.id && pageFromPath() === 'notes') {
						paintNotes(full.archived ? (archivedNotesData ?? data) : (notesData ?? data), full.id, false);
					}
				});
				return;
			}
			if (noteId) {
				void api
					.getNote(noteId)
					.then((full) => {
						noteContentLoaded.add(full.id);
						if (full.archived) {
							if (!archivedNotesData) setArchivedNotesData(emptyNotePage());
							mergeNotesIntoPage(archivedNotesData!, [full], true);
							setArchiveExpanded(true);
							paintNotes(notesData ?? emptyNotePage(), full.id, true);
						} else {
							if (!notesData) setNotesData(emptyNotePage());
							mergeNotesIntoPage(notesData!, [full], true);
							paintNotes(notesData!, full.id, true);
						}
					})
					.catch((error) => toast(errorMessage(error)));
			}
		});
	});
	content.querySelectorAll<HTMLElement>('[data-note-card-id]').forEach((card) => {
		card.addEventListener('dragstart', (event) => {
			event.dataTransfer?.setData('text/x-truespace-note', card.dataset.noteCardId!);
			if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
			card.classList.add('dragging');
		});
		card.addEventListener('dragend', () => card.classList.remove('dragging'));
	});
	const updateFromCard = (noteId: string, changes: NoteChanges): void => {
		const source = data.items.some((item) => item.id === noteId) ? data : archivedNotesData;
		const note = source?.items.find((item) => item.id === noteId);
		if (!note) return;
		const leftCurrentView = optimisticallyUpdateNote(source ?? data, note, changes);
		if (typeof changes.folderId === 'string') {
			for (const folder of noteFolderPath(noteFolders, changes.folderId)) noteExpandedFolders.add(folder.id);
		}
		const selectedId = currentSelectedNoteId();
		if (leftCurrentView && selectedId === note.id && notesData) paintNotes(notesData);
		else {
			if (notesData) replaceNotesSidebar(notesData, selectedId);
			if (changes.pinned !== undefined && selectedId === note.id) syncNotePinControls(note);
			if ((changes.folderId !== undefined || changes.archived !== undefined) && selectedId === note.id)
				syncNoteMetadata(note);
		}
	};
	content.querySelectorAll<HTMLElement>('[data-note-card-pin]').forEach((button) =>
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			const note = noteFor(button.dataset.noteCardPin);
			if (note) updateFromCard(note.id, { pinned: !note.pinned });
		}),
	);
	content.querySelectorAll<HTMLElement>('[data-note-card-move]').forEach((button) =>
		button.addEventListener('click', async (event) => {
			event.stopPropagation();
			const note = noteFor(button.dataset.noteCardMove);
			if (!note) return;
			const destination = await openFolderDialog(
				locale === 'zh' ? '移动便签' : 'Move note',
				noteFolders,
				note.folderId ?? null,
			);
			if (destination === undefined || (!note.archived && destination === (note.folderId ?? null))) return;
			updateFromCard(note.id, { archived: false, folderId: destination });
		}),
	);
	content.querySelectorAll<HTMLElement>('[data-note-card-archive]').forEach((button) =>
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			const note = noteFor(button.dataset.noteCardArchive);
			if (note) updateFromCard(note.id, { archived: !note.archived });
		}),
	);
	content.querySelectorAll<HTMLElement>('[data-note-card-delete]').forEach((button) =>
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			const note = noteFor(button.dataset.noteCardDelete);
			if (note) void deleteNote(note);
		}),
	);
	content.querySelectorAll<HTMLElement>('[data-note-sort-value]').forEach((button) =>
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			const value = button.dataset.noteSortValue as NoteSort;
			if (!noteSortValues.includes(value)) return;
			setNoteSort(value);
			localStorage.setItem('r2_note_sort', value);
			sortNotes(data.items);
			if (archivedNotesData) sortNotes(archivedNotesData.items);
			closeActionMenus();
			paintNotes(notesData ?? data, currentSelectedNoteId());
		}),
	);
	bindNotesFolders(content, data);
	content.querySelectorAll<HTMLElement>('[data-new-note]').forEach((button) =>
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			const now = new Date().toISOString();
			const requestedFolderId = button.dataset.newNote?.trim();
			const folderId = requestedFolderId || (typeof selectedNoteFolderId === 'string' ? selectedNoteFolderId : null);
			if (folderId) noteExpandedFolders.add(folderId);
			const note: Note = {
				id: crypto.randomUUID(),
				title: locale === 'zh' ? '无标题便签' : 'Untitled note',
				content: '',
				pinned: false,
				archived: false,
				createdAt: now,
				updatedAt: now,
				accessedAt: now,
				folderId,
			};
			if (!notesData) {
				setNotesData({ items: [note], page: 1, pageSize: 50, total: 1, hasMore: false });
			} else {
				notesData.items.unshift(note);
				notesData.total += 1;
				sortNotes(notesData.items);
			}
			noteContentLoaded.add(note.id);
			if (folderId) {
				const folder = noteFolders.find((item) => item.id === folderId);
				if (folder) folder.noteCount += 1;
			}
			invalidateNoteCaches();
			cacheNotes(notesData!, false);
			paintNotes(notesData!, note.id, true);
			void trackNoteNetworkOp(
				api.createNote(note.title, note.content, folderId, note.id).catch((error) => {
					// Roll back the optimistic note if the server rejects creation.
					if (notesData) {
						notesData.items = notesData.items.filter((item) => item.id !== note.id);
						notesData.total = Math.max(0, notesData.total - 1);
						if (folderId) {
							const folder = noteFolders.find((item) => item.id === folderId);
							if (folder) folder.noteCount = Math.max(0, folder.noteCount - 1);
						}
						cacheNotes(notesData, false);
						paintNotes(notesData, currentSelectedNoteId());
					}
					toast(errorMessage(error));
				}),
			);
		}),
	);
	const list = content.querySelector<HTMLElement>('[data-notes-tree]');
	list?.addEventListener(
		'scroll',
		(event) => {
			setNotesTreeScrollTop(list.scrollTop);
			if (!event.isTrusted || list.scrollHeight - list.scrollTop - list.clientHeight > 120) return;
			void loadMoreNotes(selected?.id, list.scrollTop);
		},
		{ passive: true },
	);
}
