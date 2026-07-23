import type { Note, NotePage } from '@r2-webdav/shared-types';
import { html, refreshIcons, toast, errorMessage } from '../shell';
import { locale, t, type MessageKey } from '../i18n';
import { openFolderDialog } from '../ui/helpers';
import { flushNoteCommit, noteCommitStates } from './commits';
import { ensureFolderNotesLoaded, optimisticallyUpdateNote } from './scope';
import type { NoteChanges } from './outbox';
import { noteFolderPath } from './folderTree';
import { currentSelectedNoteId, deleteNote, paintNotes, replaceNotesSidebar } from './page';
import { showEditorHighlight } from '../editor/editorHighlights';
import {
	noteExpandedFolders,
	noteFolders,
	notesData,
	mobileNoteDialogOpen,
	setFlushMobileNote,
	setMobileNoteId,
	setSelectedNoteFolderId,
} from './store';
import type { NoteSaveState } from './commits';

export function notePathMarkup(note: Note): string {
	const title = note.title.trim() || (locale === 'zh' ? '无标题便签' : 'Untitled note');
	const crumbs: string[] = [];
	for (const folder of noteFolderPath(noteFolders, note.folderId)) {
		if (crumbs.length) crumbs.push('<span class="note-path-separator" aria-hidden="true">/</span>');
		crumbs.push(
			`<button type="button" class="note-path-item" data-note-path-folder="${html(folder.id)}" title="${html(folder.name)}">${html(folder.name)}</button>`,
		);
	}
	if (crumbs.length) crumbs.push('<span class="note-path-separator" aria-hidden="true">/</span>');
	crumbs.push(`<span class="note-path-item current" data-note-path-title title="${html(title)}">${html(title)}</span>`);
	return `<nav class="collection-path note-location note-head-path note-path" data-note-path-id="${html(note.id)}" aria-label="${locale === 'zh' ? '当前便签路径' : 'Current note path'}">${crumbs.join('')}</nav>`;
}

export function revealNoteFolderInTree(folderId: string | null): void {
	if (folderId) {
		for (const folder of noteFolderPath(noteFolders, folderId)) noteExpandedFolders.add(folder.id);
		setSelectedNoteFolderId(folderId);
	} else {
		setSelectedNoteFolderId(null);
	}
	const selectedId = currentSelectedNoteId();
	if (notesData) replaceNotesSidebar(notesData, selectedId);
	if (folderId) void ensureFolderNotesLoaded(folderId);
	requestAnimationFrame(() => {
		const tree = document.querySelector<HTMLElement>('[data-notes-tree]');
		if (!tree) return;
		const target = folderId
			? tree.querySelector<HTMLElement>(`[data-note-folder-drop="${CSS.escape(folderId)}"]`)
			: tree.querySelector<HTMLElement>(
					'.notes-tree-root-pinned, .notes-tree-root-unpinned, [data-note-folder-drop="root"]',
				);
		const row = target?.matches('.collection-tree-row')
			? target
			: target?.querySelector<HTMLElement>(':scope > .collection-tree-row');
		row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	});
}

export type NoteFont = 'sans' | 'serif';
export type NoteViewPreferences = { fullWidth: boolean; font: NoteFont };
export const NOTE_VIEW_PREFERENCES_KEY = 'r2_note_view_preferences';

export function noteViewPreferences(noteId: string): NoteViewPreferences {
	try {
		const stored = JSON.parse(localStorage.getItem(NOTE_VIEW_PREFERENCES_KEY) ?? '{}') as Record<
			string,
			Partial<NoteViewPreferences>
		>;
		const preferences = stored[noteId];
		return {
			fullWidth: preferences?.fullWidth === true,
			font: preferences?.font === 'serif' ? 'serif' : 'sans',
		};
	} catch {
		return { fullWidth: false, font: 'sans' };
	}
}

export function saveNoteViewPreferences(noteId: string, changes: Partial<NoteViewPreferences>): NoteViewPreferences {
	const next = { ...noteViewPreferences(noteId), ...changes };
	try {
		const stored = JSON.parse(localStorage.getItem(NOTE_VIEW_PREFERENCES_KEY) ?? '{}') as Record<string, unknown>;
		stored[noteId] = next;
		localStorage.setItem(NOTE_VIEW_PREFERENCES_KEY, JSON.stringify(stored));
	} catch {
		// A blocked or malformed local store should not prevent editing the note.
	}
	return next;
}

export function applyNoteViewPreferences(noteId: string, preferences: NoteViewPreferences): void {
	document.querySelectorAll<HTMLElement>(`[data-note-editor-id="${CSS.escape(noteId)}"]`).forEach((editor) => {
		editor.classList.toggle('note-width-full', preferences.fullWidth);
		editor.classList.toggle('note-font-serif', preferences.font === 'serif');
	});
	document.querySelectorAll<HTMLElement>(`[data-note-toolbar-id="${CSS.escape(noteId)}"]`).forEach((toolbar) => {
		const widthButton = toolbar.querySelector<HTMLButtonElement>('[data-note-full-width]');
		if (widthButton) {
			widthButton.setAttribute('aria-checked', String(preferences.fullWidth));
			widthButton.classList.toggle('selected', preferences.fullWidth);
		}
		toolbar.querySelectorAll<HTMLElement>('[data-note-font]').forEach((button) => {
			const selected = button.dataset.noteFont === preferences.font;
			button.classList.toggle('selected', selected);
			button.setAttribute('aria-checked', String(selected));
		});
	});
}

export function noteActionControlsMarkup(selected: Note, includeRefresh = false): string {
	const saveState = noteCommitStates.get(selected.id)?.status ?? 'synced';
	const preferences = noteViewPreferences(selected.id);
	const exportLabel = locale === 'zh' ? '导出 Markdown' : 'Export Markdown';
	const moveLabel = locale === 'zh' ? '移动到' : 'Move to';
	const moreLabel = locale === 'zh' ? '更多操作' : 'More actions';
	const refreshLabel = locale === 'zh' ? '同步便签' : 'Sync notes';
	const fontLabel = locale === 'zh' ? '字型' : 'Font';
	const serifLabel = locale === 'zh' ? '衬线' : 'Serif';
	const sansLabel = locale === 'zh' ? '非衬线' : 'Sans serif';
	const fullWidthLabel = locale === 'zh' ? '全宽' : 'Full width';
	return `<div class="note-actions" data-note-toolbar-id="${html(selected.id)}">
		<div class="note-actions-meta">
			<span class="note-save-status" data-note-save-status data-state="${saveState}" role="status" aria-label="${noteSaveCopy(saveState)}" title="${noteSaveCopy(saveState)}"></span>
			<time class="note-last-modified" data-note-last-modified datetime="${html(selected.updatedAt)}">${new Date(selected.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}</time>
		</div>
		<div class="note-actions-tools">
			<button type="button" class="row-action" data-note-export title="${exportLabel}" aria-label="${exportLabel}"><i data-lucide="file-down"></i></button>
			<button type="button" class="row-action ${selected.pinned ? 'active' : ''}" data-note-pin title="${selected.pinned ? t('unpin') : t('pin')}" aria-label="${selected.pinned ? t('unpin') : t('pin')}" aria-pressed="${selected.pinned}"><i data-lucide="${selected.pinned ? 'pin-off' : 'pin'}"></i></button>
			<div class="action-menu note-action-more" data-action-menu>
				<button type="button" class="row-action" data-menu-toggle title="${moreLabel}" aria-label="${moreLabel}" aria-expanded="false"><i data-lucide="more-horizontal"></i></button>
				<div class="action-menu-popover note-more-popover" data-menu-popover role="menu">
					<div class="note-font-card" role="group" aria-label="${fontLabel}">
						<button type="button" class="note-font-choice" data-note-font="sans" role="menuitemradio" aria-checked="${preferences.font === 'sans'}" title="${sansLabel}" aria-label="${sansLabel}">
							<span class="note-font-preview note-font-preview-sans">Aa</span>
							<span class="note-font-choice-label">${sansLabel}</span>
						</button>
						<button type="button" class="note-font-choice" data-note-font="serif" role="menuitemradio" aria-checked="${preferences.font === 'serif'}" title="${serifLabel}" aria-label="${serifLabel}">
							<span class="note-font-preview note-font-preview-serif">Aa</span>
							<span class="note-font-choice-label">${serifLabel}</span>
						</button>
					</div>
					<button type="button" class="desktop-only-action" data-note-full-width role="menuitemcheckbox" aria-checked="${preferences.fullWidth}"><i data-lucide="maximize-2"></i><span>${fullWidthLabel}</span><i class="note-menu-check" data-lucide="check" aria-hidden="true"></i></button>
					<button type="button" data-note-move role="menuitem"><i data-lucide="folder-input"></i><span>${moveLabel}</span></button>
					<button type="button" data-note-archive role="menuitem"><i data-lucide="archive"></i><span>${selected.archived ? t('restore') : t('archive')}</span></button>
					<button type="button" class="danger" data-note-delete role="menuitem"><i data-lucide="trash-2"></i><span>${t('delete')}</span></button>
				</div>
			</div>
			${includeRefresh ? `<button type="button" class="button icon-button note-refresh" data-notes-refresh title="${refreshLabel}" aria-label="${refreshLabel}"><i data-lucide="refresh-cw"></i></button>` : ''}
		</div>
	</div>`;
}

export function noteToolbarMarkup(selected: Note): string {
	return `<div class="notes-inner-toolbar desktop-only-toolbar">${notePathMarkup(selected)}${noteActionControlsMarkup(selected, false)}</div>`;
}

export function noteEditorMarkup(selected: Note, mobile = false): string {
	const preferences = noteViewPreferences(selected.id);
	return `<section class="note-editor ${mobile ? 'note-editor-mobile' : 'note-editor-desktop'} ${preferences.fullWidth ? 'note-width-full' : ''} ${preferences.font === 'serif' ? 'note-font-serif' : ''}" data-note-editor-id="${html(selected.id)}">
		${!mobile ? noteToolbarMarkup(selected) : ''}
		<form data-note-form>
			${mobile ? `<div class="note-editor-head"><button type="button" class="row-action note-mobile-back" data-note-close title="${locale === 'zh' ? '返回' : 'Back'}" aria-label="${locale === 'zh' ? '返回' : 'Back'}"><i data-lucide="chevron-left"></i></button>${notePathMarkup(selected)}${noteActionControlsMarkup(selected)}</div>` : ''}
			<div class="note-compose" data-note-compose><div class="note-document"><div class="note-source note-source-pending" data-note-source aria-label="${t('markdown')}" aria-busy="true"><div class="note-heading"><input data-note-title value="${html(selected.title)}" maxlength="200" placeholder="${locale === 'zh' ? '无标题便签' : 'Untitled note'}" aria-label="${locale === 'zh' ? '便签标题' : 'Note title'}"></div></div></div><aside class="note-outline" data-note-outline aria-label="${locale === 'zh' ? '章节位置' : 'Section positions'}"></aside></div>
			${
				mobile
					? `<div class="note-mobile-edit-tools" data-mobile-editor-tools aria-label="${locale === 'zh' ? '编辑工具' : 'Editing tools'}">
				<button type="button" data-mobile-format="bold" data-marker="**" title="${locale === 'zh' ? '粗体' : 'Bold'}"><i data-lucide="bold"></i></button>
				<button type="button" data-mobile-format="italic" data-marker="*" title="${locale === 'zh' ? '斜体' : 'Italic'}"><i data-lucide="italic"></i></button>
				<button type="button" data-mobile-format="code" data-marker="\u0060" title="${locale === 'zh' ? '行内代码' : 'Inline code'}"><i data-lucide="code"></i></button>
				<span class="note-mobile-tool-divider"></span>
				<button type="button" data-mobile-ai-action="summarize"><i data-lucide="sparkles"></i><span>${locale === 'zh' ? '总结' : 'Summarize'}</span></button>
				<button type="button" data-mobile-ai-action="polish"><i data-lucide="sparkles"></i><span>${locale === 'zh' ? '润色' : 'Polish'}</span></button>
				<button type="button" data-mobile-ai-action="rewrite"><i data-lucide="sparkles"></i><span>${locale === 'zh' ? '修改' : 'Edit'}</span></button>
			</div>`
					: ''
			}
		</form>
		<button type="button" class="note-ai-chat-trigger" data-note-ai-chat title="${locale === 'zh' ? '询问 AI' : 'Ask AI'}" aria-label="${locale === 'zh' ? '询问 AI' : 'Ask AI'}"><i data-lucide="sparkles"></i></button>
	</section>`;
}

export function noteSaveCopy(state: NoteSaveState): string {
	if (locale === 'zh') {
		return { pending: '待同步', syncing: '同步中', synced: '已同步', failed: '同步失败' }[state];
	}
	return { pending: 'Pending', syncing: 'Syncing', synced: 'Synced', failed: 'Sync failed' }[state];
}

export function paintNoteSaveStatus(noteId: string, state: NoteSaveState): void {
	document.querySelectorAll<HTMLElement>(`[data-note-toolbar-id="${CSS.escape(noteId)}"]`).forEach((toolbar) => {
		const status = toolbar.querySelector<HTMLElement>('[data-note-save-status]');
		if (!status) return;
		status.dataset.state = state;
		status.textContent = '';
		status.title = noteSaveCopy(state);
		status.setAttribute('aria-label', noteSaveCopy(state));
	});
}

export function syncNoteTitle(note: Note, source?: HTMLInputElement): void {
	document.querySelectorAll<HTMLElement>('[data-note-card-id]').forEach((card) => {
		if (card.dataset.noteCardId === note.id) {
			const title = card.querySelector<HTMLElement>('.note-card-label');
			if (title) title.textContent = note.title;
		}
	});
	document.querySelectorAll<HTMLElement>('[data-note-editor-id]').forEach((editor) => {
		if (editor.dataset.noteEditorId !== note.id) return;
		const input = editor.querySelector<HTMLInputElement>('[data-note-title]');
		if (input && input !== source && input !== document.activeElement) input.value = note.title;
	});
	document
		.querySelectorAll<HTMLElement>(`.note-location[data-note-path-id="${CSS.escape(note.id)}"]`)
		.forEach((location) => {
			const locationTitle = location?.querySelector<HTMLElement>('[data-note-path-title]');
			const title = note.title.trim() || (locale === 'zh' ? '无标题便签' : 'Untitled note');
			if (locationTitle) {
				locationTitle.textContent = title;
				locationTitle.title = title;
			}
			if (location) {
				const path = noteFolderPath(noteFolders, note.folderId).map((item) => item.name);
				location.title = [...path, title].join(' / ');
			}
		});
}

export function syncNotePinControls(note: Note): void {
	document
		.querySelectorAll<HTMLButtonElement>(`[data-note-toolbar-id="${CSS.escape(note.id)}"] [data-note-pin]`)
		.forEach((button) => {
			const label = note.pinned ? t('unpin') : t('pin');
			button.classList.toggle('active', note.pinned);
			button.title = label;
			button.setAttribute('aria-label', label);
			button.setAttribute('aria-pressed', String(note.pinned));
			button.innerHTML = `<i data-lucide="${note.pinned ? 'pin-off' : 'pin'}"></i>`;
		});
	refreshIcons();
}

export function syncNoteMetadata(note: Note): void {
	syncNoteTitle(note);
	document.querySelectorAll<HTMLElement>(`.note-path[data-note-path-id="${CSS.escape(note.id)}"]`).forEach((path) => {
		if (path) {
			const wrapper = document.createElement('div');
			wrapper.innerHTML = notePathMarkup(note);
			const next = wrapper.firstElementChild;
			if (next instanceof HTMLElement) {
				path.replaceWith(next);
				bindNotePath(next, note);
			}
		}
	});
	document
		.querySelectorAll<HTMLTimeElement>(`[data-note-toolbar-id="${CSS.escape(note.id)}"] [data-note-last-modified]`)
		.forEach((time) => {
			time.dateTime = note.updatedAt;
			time.textContent = new Date(note.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en');
		});
}

export function bindNotePath(root: HTMLElement, _note: Note): void {
	root.querySelectorAll<HTMLElement>('[data-note-path-folder]').forEach((button) =>
		button.addEventListener('click', (event) => {
			event.preventDefault();
			history.pushState({}, '', '/notes');
			const value = button.dataset.notePathFolder ?? 'root';
			// Keep the open note; path clicks only navigate the tree.
			revealNoteFolderInTree(value === 'root' ? null : value);
		}),
	);
}

export function reorderVisibleNoteCards(data: NotePage): void {
	const order = new Map(data.items.map((note, index) => [note.id, index]));
	document
		.querySelectorAll<HTMLElement>('.notes-tree-root, .note-tree-node > .notes-tree-children')
		.forEach((parent) => {
			const cards = Array.from(parent.children).filter(
				(child): child is HTMLElement => child instanceof HTMLElement && child.matches('[data-note-card-id]'),
			);
			cards.sort(
				(left, right) =>
					(order.get(left.dataset.noteCardId ?? '') ?? Number.MAX_SAFE_INTEGER) -
					(order.get(right.dataset.noteCardId ?? '') ?? Number.MAX_SAFE_INTEGER),
			);
			cards.forEach((card) => parent.append(card));
		});
}

export function bindNoteEditor(
	root: HTMLElement,
	data: NotePage,
	selected: Note,
	mobile: boolean,
	actionRoot: ParentNode = root,
): void {
	const source = root.querySelector<HTMLElement>('[data-note-source]')!;
	let draftContent = selected.content.replaceAll('\r', '');
	const title = root.querySelector<HTMLInputElement>('[data-note-title]')!;
	const actionHosts = mobile
		? [...root.querySelectorAll<HTMLElement>('[data-note-toolbar-id]')]
		: [...actionRoot.querySelectorAll<HTMLElement>('.notes-inner-toolbar [data-note-toolbar-id]')];
	const actionButtons = (selector: string): HTMLElement[] =>
		actionHosts.flatMap((host) => [...host.querySelectorAll<HTMLElement>(selector)]);
	const pendingState = noteCommitStates.get(selected.id);
	if (pendingState) paintNoteSaveStatus(selected.id, pendingState.status);
	title.addEventListener('input', () => {
		const nextTitle = title.value.trim() || (locale === 'zh' ? '无标题便签' : 'Untitled note');
		optimisticallyUpdateNote(data, selected, { title: nextTitle });
		syncNoteTitle(selected, title);
		reorderVisibleNoteCards(data);
	});
	title.addEventListener('blur', () => {
		title.value = selected.title;
	});
	const compose = root.querySelector<HTMLElement>('[data-note-compose]');
	const outline = root.querySelector<HTMLElement>('[data-note-outline]');
	void import('../editor/markdownLivePreview')
		.then(({ createMarkdownLivePreview, scrollToMarkdownHeading, markdownHeadingPosition }) => {
			if (!source.isConnected) return;
			const view = createMarkdownLivePreview(source, draftContent, {
				onChange: (value, immediate) => {
					draftContent = value.replaceAll('\r', '');
					syncAiEmptyPrompt?.();
					optimisticallyUpdateNote(data, selected, { content: draftContent });
					reorderVisibleNoteCards(data);
					if (immediate) void flushNoteCommit(selected.id);
				},
				onHeadingsChange: (headings) => {
					if (!outline || !compose) return;
					try {
						const hasOutline = headings.length > 0;
						compose.classList.toggle('has-outline', hasOutline);
						outline.classList.toggle('empty', !hasOutline);
						compose.classList.remove('outline-collapsed');
						outline.classList.remove('collapsed', 'open');
						if (!hasOutline) {
							outline.replaceChildren();
							return;
						}

						const scroller = view.scrollDOM;
						const rail = document.createElement('div');
						rail.className = 'note-outline-rail';
						rail.setAttribute('role', 'navigation');
						rail.setAttribute('aria-label', locale === 'zh' ? '章节位置' : 'Section positions');

						const panel = document.createElement('div');
						panel.className = 'note-outline-panel';
						panel.setAttribute('role', 'menu');

						const markButtons: HTMLButtonElement[] = [];
						const itemButtons: HTMLButtonElement[] = [];
						const anchors = headings
							.map((heading) => {
								const from = markdownHeadingPosition(view, heading.id);
								return from === null ? null : { id: heading.id, from };
							})
							.filter((item): item is { id: string; from: number } => item !== null);

						const centerInScrollable = (container: HTMLElement, target: HTMLElement | null | undefined) => {
							if (!target || container.scrollHeight <= container.clientHeight + 1) return;
							const containerRect = container.getBoundingClientRect();
							const targetRect = target.getBoundingClientRect();
							const top =
								container.scrollTop +
								(targetRect.top - containerRect.top) -
								(container.clientHeight - targetRect.height) / 2;
							container.scrollTop = Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight));
						};

						let lastActiveId: string | null = null;
						const setActive = (activeId: string | null) => {
							for (const button of markButtons) {
								button.classList.toggle('active', button.dataset.headingId === activeId);
							}
							for (const button of itemButtons) {
								button.classList.toggle('active', button.dataset.headingId === activeId);
							}
							if (activeId === lastActiveId) return;
							lastActiveId = activeId;
							// Keep the current section visible/centered when the rail or panel overflows.
							const activeMark = markButtons.find((button) => button.dataset.headingId === activeId);
							const activeItem = itemButtons.find((button) => button.dataset.headingId === activeId);
							centerInScrollable(rail, activeMark);
							centerInScrollable(panel, activeItem);
						};

						const refreshActive = () => {
							if (!anchors.length) {
								setActive(null);
								return;
							}
							const top = scroller.scrollTop + 36;
							let activeId = anchors[0]!.id;
							for (const anchor of anchors) {
								// lineBlockAt is document-relative and stays valid while off-screen.
								const offset = view.lineBlockAt(anchor.from).top;
								if (offset <= top) activeId = anchor.id;
								else break;
							}
							setActive(activeId);
						};

						for (const heading of headings) {
							const mark = document.createElement('button');
							mark.type = 'button';
							mark.className = 'note-outline-mark';
							mark.dataset.headingId = heading.id;
							mark.style.setProperty('--outline-level', String(heading.level));
							mark.title = heading.text;
							mark.setAttribute('aria-label', heading.text);
							mark.addEventListener('click', (event) => {
								event.stopPropagation();
								scrollToMarkdownHeading(view, heading.id);
								const headingFrom = markdownHeadingPosition(view, heading.id);
								if (headingFrom !== null) {
									const line = view.state.doc.lineAt(headingFrom);
									showEditorHighlight(view, line.from, line.to, 'transient');
								}
								mark.classList.remove('section-pulse');
								void mark.offsetWidth;
								mark.classList.add('section-pulse');
								// Mobile: first tap expands the panel; second tap (or any mark) jumps.
								if (matchMedia('(hover: none)').matches) outline.classList.add('open');
								refreshActive();
							});
							markButtons.push(mark);
							rail.append(mark);

							const item = document.createElement('button');
							item.type = 'button';
							item.className = 'note-outline-item';
							item.dataset.headingId = heading.id;
							item.style.setProperty('--outline-level', String(heading.level));
							item.setAttribute('role', 'menuitem');
							const label = document.createElement('span');
							label.textContent = heading.text;
							item.append(label);
							item.addEventListener('click', (event) => {
								event.stopPropagation();
								scrollToMarkdownHeading(view, heading.id);
								const headingFrom = markdownHeadingPosition(view, heading.id);
								if (headingFrom !== null) {
									const line = view.state.doc.lineAt(headingFrom);
									showEditorHighlight(view, line.from, line.to, 'transient');
								}
								item.classList.remove('section-pulse');
								void item.offsetWidth;
								item.classList.add('section-pulse');
								outline.classList.remove('open');
								refreshActive();
							});
							itemButtons.push(item);
							panel.append(item);
						}

						outline.replaceChildren(rail, panel);

						const syncOutlineScroll = () => {
							const activeMark = markButtons.find((button) => button.classList.contains('active'));
							const activeItem = itemButtons.find((button) => button.classList.contains('active'));
							centerInScrollable(rail, activeMark);
							centerInScrollable(panel, activeItem);
						};
						const openPanel = () => {
							outline.classList.add('open');
							// Panel may have been hidden; re-center after it participates in layout.
							requestAnimationFrame(syncOutlineScroll);
						};
						const closePanel = () => {
							if (!outline.matches(':hover') && !outline.contains(document.activeElement))
								outline.classList.remove('open');
						};
						outline.addEventListener('mouseenter', openPanel);
						outline.addEventListener('mouseleave', () => {
							if (!matchMedia('(hover: none)').matches) outline.classList.remove('open');
						});
						rail.addEventListener('focusin', openPanel);
						panel.addEventListener('focusout', () => closePanel());
						// Touch: tapping the rail area toggles the floating list.
						rail.addEventListener('click', (event) => {
							if (!(event.target instanceof Element)) return;
							if (event.target.closest('.note-outline-mark')) return;
							if (matchMedia('(hover: none)').matches) outline.classList.toggle('open');
						});

						const previous = outline as HTMLElement & {
							_outlineScroll?: () => void;
							_outlineOutside?: (event: Event) => void;
						};
						if (previous._outlineScroll) scroller.removeEventListener('scroll', previous._outlineScroll);
						if (previous._outlineOutside) document.removeEventListener('pointerdown', previous._outlineOutside);
						const onScroll = () => refreshActive();
						const onOutside = (event: Event) => {
							if (!(event.target instanceof Node) || outline.contains(event.target)) return;
							outline.classList.remove('open');
						};
						previous._outlineScroll = onScroll;
						previous._outlineOutside = onOutside;
						scroller.addEventListener('scroll', onScroll, { passive: true });
						document.addEventListener('pointerdown', onOutside);
						refreshActive();
					} catch (error) {
						console.error('Note outline failed', error);
					}
				},
				onImageTooLarge: () =>
					toast(locale === 'zh' ? '图片超过 256 KB，暂不允许粘贴' : 'Images over 256 KB cannot be pasted yet'),
				onImageReadError: () => toast(locale === 'zh' ? '无法读取粘贴的图片' : 'Could not read the pasted image'),
			});
			const heading = source.querySelector<HTMLElement>('.note-heading');
			if (heading) view.scrollDOM.insertBefore(heading, view.contentDOM);
			view.requestMeasure();
			requestAnimationFrame(() => {
				if (!source.isConnected) return;
				view.requestMeasure();
				requestAnimationFrame(() => {
					if (!source.isConnected) return;
					source.classList.remove('note-source-pending');
					source.removeAttribute('aria-busy');
				});
			});
			let syncAiEmptyPrompt: (() => void) | undefined;
			void import('../editor/aiAssistant').then(({ bindMarkdownAiAssistant }) => {
				if (!source.isConnected) return;
				const ai = bindMarkdownAiAssistant(view, source, locale, {
					onError: (error) => toast(errorMessage(error)),
					noteId: selected.id,
					noteTitle: () => title.value.trim() || (locale === 'zh' ? '无标题便签' : 'Untitled note'),
					onTitleChange: (nextTitle) => {
						optimisticallyUpdateNote(data, selected, { title: nextTitle });
						title.value = nextTitle;
						syncNoteTitle(selected, title);
						reorderVisibleNoteCards(data);
					},
				});
				// onChange must call syncEmptyPrompt only — never destroy (that closed the review UI after DIFF).
				syncAiEmptyPrompt = ai.syncEmptyPrompt;
			});
		})
		.catch((error) => {
			console.error('Markdown editor failed to load', error);
			source.classList.remove('note-source-pending');
			source.removeAttribute('aria-busy');
			for (const host of actionHosts) {
				const status = host.querySelector<HTMLElement>('[data-note-save-status]');
				if (!status) continue;
				status.dataset.state = 'failed';
				status.title = locale === 'zh' ? '编辑器加载失败' : 'Editor failed to load';
				status.setAttribute('aria-label', status.title);
			}
			toast(locale === 'zh' ? '编辑器加载失败，无法同步修改' : 'Editor failed to load; changes cannot sync');
		});
	actionButtons('[data-note-export]').forEach((button) =>
		button.addEventListener('click', () => {
			const objectUrl = URL.createObjectURL(new Blob([draftContent], { type: 'text/markdown;charset=utf-8' }));
			const anchor = document.createElement('a');
			anchor.href = objectUrl;
			anchor.download = `${(title.value.trim() || 'note').replace(/[\\/:*?"<>|]/g, '_')}.md`;
			anchor.click();
			URL.revokeObjectURL(objectUrl);
		}),
	);
	const updateStructure = (changes: NoteChanges) => {
		const leftCurrentView = optimisticallyUpdateNote(data, selected, changes);
		if (typeof changes.folderId === 'string') {
			for (const folder of noteFolderPath(noteFolders, changes.folderId)) noteExpandedFolders.add(folder.id);
		}
		if (leftCurrentView) {
			if (mobile && mobileNoteDialogOpen) history.back();
			else if (notesData) paintNotes(notesData);
			return;
		}
		syncNoteMetadata(selected);
		if (notesData) replaceNotesSidebar(notesData, selected.id);
	};
	actionButtons('[data-note-move]').forEach((button) =>
		button.addEventListener('click', async () => {
			const destination = await openFolderDialog(
				locale === 'zh' ? '移动便签' : 'Move note',
				noteFolders,
				selected.folderId ?? null,
			);
			if (destination === undefined || (!selected.archived && destination === (selected.folderId ?? null))) return;
			updateStructure({ archived: false, folderId: destination });
		}),
	);
	const pathRoots = new Set<HTMLElement>();
	root.querySelectorAll<HTMLElement>('.note-path').forEach((path) => pathRoots.add(path));
	actionRoot.querySelectorAll<HTMLElement>('.note-path').forEach((path) => pathRoots.add(path));
	for (const path of pathRoots) bindNotePath(path, selected);
	root
		.querySelector<HTMLFormElement>('[data-note-form]')
		?.addEventListener('submit', (event) => event.preventDefault());
	actionButtons('[data-note-pin]').forEach((button) =>
		button.addEventListener('click', () => {
			optimisticallyUpdateNote(data, selected, { pinned: !selected.pinned });
			if (notesData) replaceNotesSidebar(notesData, selected.id);
			syncNotePinControls(selected);
		}),
	);
	actionButtons('[data-note-full-width]').forEach((button) =>
		button.addEventListener('click', () => {
			const preferences = noteViewPreferences(selected.id);
			applyNoteViewPreferences(
				selected.id,
				saveNoteViewPreferences(selected.id, { fullWidth: !preferences.fullWidth }),
			);
		}),
	);
	actionButtons('[data-note-font]').forEach((button) =>
		button.addEventListener('click', () => {
			const font = button.dataset.noteFont;
			if (font !== 'sans' && font !== 'serif') return;
			applyNoteViewPreferences(selected.id, saveNoteViewPreferences(selected.id, { font }));
		}),
	);
	actionButtons('[data-note-archive]').forEach((button) =>
		button.addEventListener('click', () => updateStructure({ archived: !selected.archived })),
	);
	actionButtons('[data-note-delete]').forEach((button) =>
		button.addEventListener('click', () => void deleteNote(selected)),
	);
	root.querySelector('[data-note-close]')?.addEventListener('click', () => {
		if (mobileNoteDialogOpen) history.back();
		else
			void flushNoteCommit(selected.id).then(() => {
				root.closest('dialog')?.close();
				paintNotes(notesData ?? data, selected.id);
			});
	});
	if (mobile) {
		setFlushMobileNote(() => flushNoteCommit(selected.id));
		setMobileNoteId(selected.id);
	}
}
