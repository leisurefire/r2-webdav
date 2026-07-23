import type { FileEntry, FileListing } from '@r2-webdav/shared-types';
import { api } from '../api/client';
import {
	confirmAction,
	errorMessage,
	html,
	loadingMarkup,
	navigate,
	pageFromPath,
	refreshIcons,
	shell,
	sidebarContext,
	toast,
} from '../shell';
import { locale, t } from '../i18n';
import {
	collapseTreeBranch,
	expandTreeBranch,
	openTextDialog,
	treeLeadingMarkup,
	workspaceSidebarMarkup,
} from '../ui/helpers';
import { renderMarkdown } from '../editor/markdownRenderer';

export let currentPath = '';
export let filePathHighlight: string | null = null;
const fileCache = new Map<string, FileListing>();
const validatedFilePaths = new Set<string>();
const fileExpandedPaths = new Set<string>(['']);
const fileTreeLoadingPaths = new Set<string>();
let directoryLoadCleanup: (() => void) | null = null;
let fileTreeExpansionPending: string | null = null;

export function formatBytes(size: number): string {
	if (size < 1024) return `${size} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = size / 1024;
	let index = 0;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index += 1;
	}
	return `${value < 10 ? value.toFixed(1) : value.toFixed(0)} ${units[index]}`;
}

export function fileIcon(entry: FileEntry): string {
	if (entry.type === 'directory') return 'folder';
	if (entry.contentType?.startsWith('image/')) return 'image';
	if (entry.contentType?.startsWith('video/')) return 'film';
	if (entry.contentType?.startsWith('audio/')) return 'music';
	return 'file';
}

export function breadcrumbMarkup(path: string): string {
	const parts = path ? path.split('/') : [];
	let built = '';
	const crumbs = parts.length
		? []
		: [
				`<button class="crumb current ${filePathHighlight === '' ? 'path-highlight' : ''}" data-path="">${locale === 'zh' ? '我的文件' : 'My files'}</button>`,
			];
	parts.forEach((part, index) => {
		built = built ? `${built}/${part}` : part;
		if (index > 0) crumbs.push('<span class="crumb-separator">/</span>');
		crumbs.push(
			`<button class="crumb ${index === parts.length - 1 ? 'current' : ''} ${filePathHighlight === built ? 'path-highlight' : ''}" data-path="${html(built)}">${html(part)}</button>`,
		);
	});
	return crumbs.join('');
}

export function fileSidebarMarkup(listing: FileListing): string {
	const directCurrentChild = (path: string): { path: string; name: string } | null => {
		if (!currentPath || currentPath === path || (path && !currentPath.startsWith(`${path}/`))) return null;
		const remainder = path ? currentPath.slice(path.length + 1) : currentPath;
		const name = remainder.split('/')[0];
		return name ? { name, path: path ? `${path}/${name}` : name } : null;
	};
	const childFolders = (path: string): Array<{ path: string; name: string }> => {
		const known = (cachedFiles(path)?.entries ?? [])
			.filter((entry) => entry.type === 'directory')
			.map((entry) => ({ path: entry.path, name: entry.name }));
		const currentChild = directCurrentChild(path);
		if (currentChild && !known.some((entry) => entry.path === currentChild.path)) known.unshift(currentChild);
		return known;
	};
	const renderFolder = (path: string, name: string, depth: number): string => {
		const expanded = fileExpandedPaths.has(path);
		const children = expanded ? childFolders(path) : [];
		const loading = fileTreeLoadingPaths.has(path);
		return `<div class="file-tree-node note-tree-node note-folder-card ${path === currentPath ? 'active' : ''} ${expanded ? 'expanded' : ''}" style="--tree-depth:${depth}"><button type="button" class="collection-tree-row ${filePathHighlight === path ? 'path-highlight' : ''}" data-file-tree-path="${html(path)}">${treeLeadingMarkup(path === '' ? 'database' : expanded ? 'folder-open' : 'folder', expanded, loading)}<span>${html(name)}</span></button>${expanded && children.length ? `<div class="notes-tree-children">${children.map((child) => renderFolder(child.path, child.name, depth + 1)).join('')}</div>` : ''}</div>`;
	};
	const uploadLabel = locale === 'zh' ? '上传' : 'Upload';
	const mkdirLabel = locale === 'zh' ? '新建文件夹' : 'New folder';
	const syncLabel = locale === 'zh' ? '同步文件' : 'Sync files';
	const tools = `<div class="sidebar-context-tools">
		<button type="button" class="row-action" data-files-upload title="${uploadLabel}" aria-label="${uploadLabel}"><i data-lucide="upload"></i></button>
		<button type="button" class="row-action" data-files-mkdir title="${mkdirLabel}" aria-label="${mkdirLabel}"><i data-lucide="folder-plus"></i></button>
		<button type="button" class="row-action" data-files-refresh title="${syncLabel}" aria-label="${syncLabel}"><i data-lucide="refresh-cw"></i></button>
	</div>`;
	return workspaceSidebarMarkup({
		label: locale === 'zh' ? '存储库结构' : 'Storage structure',
		tools,
		body: renderFolder('', locale === 'zh' ? '我的文件' : 'My files', 0),
		treeClass: 'file-folder-tree',
		treeAttributes: 'data-file-tree',
	});
}

function expandFilePath(path: string): void {
	fileExpandedPaths.add('');
	let built = '';
	for (const part of path.split('/').filter(Boolean)) {
		built = built ? `${built}/${part}` : part;
		fileExpandedPaths.add(built);
	}
}

export function openFileDirectory(path: string, highlight = false, expand = true): void {
	directoryLoadCleanup?.();
	if (expand) expandFilePath(path);
	const showLoading = !validatedFilePaths.has(path);
	if (showLoading) fileTreeLoadingPaths.add(path);
	const row = [...document.querySelectorAll<HTMLElement>('[data-file-tree-path]')].find(
		(item) => item.dataset.fileTreePath === path,
	);
	if (row && showLoading) {
		if (highlight) {
			row.classList.remove('path-highlight');
			void row.offsetWidth;
			row.classList.add('path-highlight');
		}
		const leading = row.querySelector<HTMLElement>('.note-tree-leading');
		const original = leading?.innerHTML ?? '';
		if (leading) {
			leading.innerHTML = '<i class="note-tree-loader" data-lucide="loader-circle"></i>';
			row.classList.add('loading');
			refreshIcons();
		}
		directoryLoadCleanup = () => {
			fileTreeLoadingPaths.delete(path);
			if (row.isConnected && original) {
				const currentLeading = row.querySelector<HTMLElement>('.note-tree-leading');
				if (currentLeading) currentLeading.innerHTML = original;
				row.classList.remove('loading');
				refreshIcons();
			}
		};
	} else if (showLoading)
		directoryLoadCleanup = () => {
			fileTreeLoadingPaths.delete(path);
		};
	else directoryLoadCleanup = null;
	currentPath = path;
	filePathHighlight = highlight ? path : null;
	void renderFiles();
}

export function fileCacheKey(path: string): string {
	return `r2_files_${encodeURIComponent(path || 'root')}`;
}

export function cachedFiles(path: string): FileListing | null {
	if (fileCache.has(path)) return fileCache.get(path)!;
	try {
		const listing = JSON.parse(localStorage.getItem(fileCacheKey(path)) ?? 'null') as FileListing | null;
		if (listing?.path === path && Array.isArray(listing.entries)) fileCache.set(path, listing);
		return listing?.path === path ? listing : null;
	} catch {
		return null;
	}
}

export function cacheFiles(listing: FileListing): void {
	fileCache.set(listing.path, listing);
	localStorage.setItem(fileCacheKey(listing.path), JSON.stringify(listing));
}

export function fileExtension(path: string): string {
	return path.split('/').at(-1)?.split('.').at(-1)?.toLowerCase() ?? '';
}

export function previewContentType(entry: FileEntry): string {
	if (entry.contentType) return entry.contentType;
	const ext = fileExtension(entry.path);
	return (
		(
			{
				txt: 'text/plain',
				json: 'application/json',
				md: 'text/markdown',
				png: 'image/png',
				jpg: 'image/jpeg',
				jpeg: 'image/jpeg',
				gif: 'image/gif',
				webp: 'image/webp',
				svg: 'image/svg+xml',
				mp3: 'audio/mpeg',
				wav: 'audio/wav',
				ogg: 'audio/ogg',
				mp4: 'video/mp4',
				webm: 'video/webm',
				pdf: 'application/pdf',
			} as Record<string, string>
		)[ext] ?? 'application/octet-stream'
	);
}

export function canPreview(entry: FileEntry): boolean {
	return entry.type === 'file' && entry.size <= 100 * 1024;
}

export async function openFilePreview(entry: FileEntry): Promise<void> {
	if (!canPreview(entry)) {
		await api.download(entry.path);
		return;
	}
	const dialog = document.createElement('dialog');
	dialog.className = 'file-preview-dialog';
	dialog.innerHTML = `<div class="file-preview-shell"><header class="file-preview-head"><strong>${html(entry.name)}</strong><span class="muted">${formatBytes(entry.size)}</span><span class="toolbar-spacer"></span><button class="row-action" data-preview-close title="${locale === 'zh' ? '关闭' : 'Close'}" aria-label="${locale === 'zh' ? '关闭' : 'Close'}"><i data-lucide="x"></i></button></header><div class="file-preview-body"><div class="loading-state">${loadingMarkup()}</div></div></div>`;
	document.body.append(dialog);
	refreshIcons();
	const body = dialog.querySelector<HTMLElement>('.file-preview-body')!;
	let objectUrl: string | null = null;
	const close = () => dialog.close();
	dialog.querySelector('[data-preview-close]')?.addEventListener('click', close);
	dialog.addEventListener('close', () => {
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		dialog.remove();
	});
	dialog.showModal();
	try {
		const blob = await api.previewFile(entry.path, entry.etag);
		const type = previewContentType(entry);
		const ext = fileExtension(entry.path);
		if (ext === 'txt' || ext === 'json') {
			let value = await blob.text();
			if (ext === 'json') {
				try {
					value = JSON.stringify(JSON.parse(value), null, 2);
				} catch {
					/* Keep invalid JSON editable. */
				}
			}
			body.innerHTML = `<div class="file-text-editor"><textarea class="file-text-source" spellcheck="false" aria-label="${html(entry.name)}">${html(value)}</textarea><div class="file-preview-actions"><span class="muted" data-file-save-status></span><button class="button primary" data-file-save><i data-lucide="save"></i><span>${locale === 'zh' ? '手动保存' : 'Save manually'}</span></button></div></div>`;
			body.querySelector('[data-file-save]')?.addEventListener('click', async () => {
				const button = body.querySelector<HTMLButtonElement>('[data-file-save]')!;
				const status = body.querySelector<HTMLElement>('[data-file-save-status]')!;
				button.disabled = true;
				status.textContent = locale === 'zh' ? '保存中…' : 'Saving…';
				try {
					await api.saveTextFile(
						entry.path,
						body.querySelector<HTMLTextAreaElement>('.file-text-source')!.value,
						type,
						entry.etag,
					);
					status.textContent = locale === 'zh' ? '已保存' : 'Saved';
					entry.etag = (await api.fileInfo(entry.path)).etag;
				} catch (error) {
					status.textContent = errorMessage(error);
				} finally {
					button.disabled = false;
				}
			});
		} else if (ext === 'md' || type === 'text/markdown') {
			const value = await blob.text();
			body.innerHTML = `<article class="file-markdown-preview">${renderMarkdown(value)}</article><div class="file-preview-actions"><button class="button primary" data-migrate-md><i data-lucide="file-down"></i><span>${locale === 'zh' ? '迁移到便签' : 'Move to notes'}</span></button></div>`;
			body.querySelector('[data-migrate-md]')?.addEventListener('click', async () => {
				if (
					!(await confirmAction(
						locale === 'zh' ? '迁移 Markdown 文件？' : 'Move Markdown file?',
						locale === 'zh'
							? '迁移成功后将删除文件空间中的原文件。'
							: 'The original file will be deleted after import.',
						locale === 'zh' ? '迁移' : 'Move',
					))
				)
					return;
				try {
					await api.createNote(entry.name.replace(/\.md$/i, '') || 'Untitled note', value);
					await api.deleteFile(entry.path);
					await api.clearFilePreview(entry.path);
					dialog.close();
					toast(locale === 'zh' ? '已迁移到便签' : 'Moved to notes');
					navigate('/notes');
				} catch (error) {
					toast(errorMessage(error));
				}
			});
		} else if (type.startsWith('image/')) {
			objectUrl = URL.createObjectURL(blob);
			body.innerHTML = `<div class="file-binary-preview"><img src="${objectUrl}" alt="${html(entry.name)}"></div>`;
		} else if (type.startsWith('audio/')) {
			objectUrl = URL.createObjectURL(blob);
			body.innerHTML = `<div class="file-binary-preview"><audio controls src="${objectUrl}"></audio></div>`;
		} else if (type.startsWith('video/')) {
			objectUrl = URL.createObjectURL(blob);
			body.innerHTML = `<div class="file-binary-preview"><video controls src="${objectUrl}"></video></div>`;
		} else if (type === 'application/pdf') {
			objectUrl = URL.createObjectURL(blob);
			body.innerHTML = `<iframe class="file-pdf-preview" src="${objectUrl}" title="${html(entry.name)}"></iframe>`;
		} else {
			body.innerHTML = `<div class="empty-state"><div>${locale === 'zh' ? '此文件类型暂不支持内嵌预览，请下载查看。' : 'This file type cannot be previewed inline. Download it to view.'}</div></div>`;
		}
		refreshIcons();
	} catch (error) {
		body.innerHTML = `<div class="error-banner">${html(errorMessage(error))}</div>`;
	}
}

export function paintFiles(listing: FileListing): void {
	const content = document.querySelector<HTMLDivElement>('#page-content');
	if (!content || pageFromPath() !== 'files' || listing.path !== currentPath) return;
	const rows = listing.entries
		.map(
			(entry) => `<article class="file-card">
				<button class="file-card-open" data-open="${html(entry.path)}" data-type="${entry.type}"><span class="file-card-icon"><i data-lucide="${fileIcon(entry)}"></i></span><span class="file-card-copy"><strong>${html(entry.name)}</strong><small>${entry.type === 'file' ? formatBytes(entry.size) : locale === 'zh' ? '文件夹' : 'Folder'} · ${new Date(entry.modifiedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small></span></button>
				<div class="file-card-actions action-menu" data-action-menu>
					<button class="row-action" data-menu-toggle title="${locale === 'zh' ? '更多操作' : 'More actions'}" aria-label="${locale === 'zh' ? '更多操作' : 'More actions'}" aria-expanded="false"><i data-lucide="more-horizontal"></i></button>
					<div class="action-menu-popover" data-menu-popover role="menu">
						${entry.type === 'file' ? `<button data-download="${html(entry.path)}" role="menuitem"><i data-lucide="download"></i><span>${locale === 'zh' ? '下载' : 'Download'}</span></button>` : ''}
						<button data-rename="${html(entry.path)}" role="menuitem"><i data-lucide="pencil"></i><span>${locale === 'zh' ? '重命名' : 'Rename'}</span></button>
						<button class="danger" data-delete="${html(entry.path)}" role="menuitem"><i data-lucide="trash-2"></i><span>${t('delete')}</span></button>
					</div>
				</div>
			</article>`,
		)
		.join('');
	const uploadLabel = locale === 'zh' ? '上传' : 'Upload';
	const mkdirLabel = locale === 'zh' ? '新建文件夹' : 'New folder';
	const syncLabel = locale === 'zh' ? '同步文件' : 'Sync files';
	const mobileTools = `<div class="page-context-tools mobile-only-tools">
			<button type="button" class="row-action" data-files-upload title="${uploadLabel}" aria-label="${uploadLabel}"><i data-lucide="upload"></i></button>
			<button type="button" class="row-action" data-files-mkdir title="${mkdirLabel}" aria-label="${mkdirLabel}"><i data-lucide="folder-plus"></i></button>
			<button type="button" class="row-action" data-files-refresh title="${syncLabel}" aria-label="${syncLabel}"><i data-lucide="refresh-cw"></i></button>
		</div>`;
	content.innerHTML = `<div class="file-layout"><div class="toolbar"><div class="breadcrumbs">${breadcrumbMarkup(listing.path)}</div>
			${mobileTools}
			<input type="file" id="file-input" hidden multiple>
		</div><div id="upload-status"></div>
		<div class="file-browser-body">${rows ? `<div class="file-grid">${rows}</div>` : `<div class="notes-empty large file-empty"><i data-lucide="folder-open"></i><span>${locale === 'zh' ? '此文件夹为空' : 'This folder is empty'}</span></div>`}</div></div>`;
	const context = sidebarContext();
	if (context) context.innerHTML = fileSidebarMarkup(listing);
	refreshIcons();
	if (fileTreeExpansionPending !== null && context) {
		const pendingPath = fileTreeExpansionPending;
		const host = [...context.querySelectorAll<HTMLElement>('[data-file-tree-path]')]
			.find((item) => item.dataset.fileTreePath === pendingPath)
			?.closest('.file-tree-node');
		if (host?.querySelector(':scope > .notes-tree-children')) {
			fileTreeExpansionPending = null;
			requestAnimationFrame(() => expandTreeBranch(host, '.notes-tree-children'));
		}
	}
	const highlightedPath = filePathHighlight;
	if (highlightedPath !== null)
		window.setTimeout(() => {
			if (filePathHighlight === highlightedPath) filePathHighlight = null;
		}, 950);
	content
		.querySelectorAll<HTMLElement>('[data-path]')
		.forEach((item) => item.addEventListener('click', () => openFileDirectory(item.dataset.path!, true)));
	context
		?.querySelectorAll<HTMLElement>('[data-file-tree-path]')
		.forEach((item) =>
			item.addEventListener('click', () => {
				const path = item.dataset.fileTreePath ?? '';
				const host = item.closest('.file-tree-node');
				if (path && fileExpandedPaths.has(path)) {
					collapseTreeBranch(host, '.notes-tree-children', () => {
						fileExpandedPaths.delete(path);
						openFileDirectory(path, true, false);
					});
					return;
				}
				if (path) {
					fileExpandedPaths.add(path);
					fileTreeExpansionPending = path;
				}
				openFileDirectory(path, true, false);
			}),
		);
	content.querySelectorAll<HTMLElement>('[data-open]').forEach((item) =>
		item.addEventListener('click', async () => {
			if (item.dataset.type === 'directory') {
				openFileDirectory(item.dataset.open!);
			} else {
				const entry = listing.entries.find((candidate) => candidate.path === item.dataset.open);
				if (entry) await openFilePreview(entry);
			}
		}),
	);
	content
		.querySelectorAll<HTMLElement>('[data-download]')
		.forEach((item) =>
			item.addEventListener('click', () =>
				api.download(item.dataset.download!).catch((error) => toast(errorMessage(error))),
			),
		);
	content.querySelectorAll<HTMLElement>('[data-rename]').forEach((item) =>
		item.addEventListener('click', async () => {
			const source = item.dataset.rename!;
			const name = await openTextDialog(
				locale === 'zh' ? '重命名' : 'Rename',
				locale === 'zh' ? '名称' : 'Name',
				source.split('/').at(-1),
			);
			if (!name || name.includes('/')) return;
			const parent = source.split('/').slice(0, -1).join('/');
			try {
				await api.move(source, parent ? `${parent}/${name}` : name);
				await api.clearFilePreview(source);
				toast(locale === 'zh' ? '已重命名' : 'Renamed');
				await renderFiles(true);
			} catch (error) {
				toast(errorMessage(error));
			}
		}),
	);
	content.querySelectorAll<HTMLElement>('[data-delete]').forEach((item) =>
		item.addEventListener('click', async () => {
			const path = item.dataset.delete!;
			if (
				!(await confirmAction(
					locale === 'zh' ? '删除此项目？' : 'Delete item?',
					locale === 'zh'
						? `${path.split('/').at(-1)} 将被永久删除。`
						: `${path.split('/').at(-1)} will be permanently deleted.`,
					t('delete'),
				))
			)
				return;
			try {
				await api.deleteFile(path);
				await api.clearFilePreview(path);
				toast(locale === 'zh' ? '已删除' : 'Deleted');
				await renderFiles(true);
			} catch (error) {
				toast(errorMessage(error));
			}
		}),
	);
	const roots = [content, context].filter((node): node is HTMLElement => Boolean(node));
	const bindAll = (selector: string, handler: (event: Event) => void) => {
		for (const root of roots) {
			root.querySelectorAll(selector).forEach((node) => node.addEventListener('click', handler));
		}
	};
	bindAll('[data-files-mkdir]', async () => {
		const name = await openTextDialog(
			locale === 'zh' ? '新建文件夹' : 'New folder',
			locale === 'zh' ? '文件夹名称' : 'Folder name',
		);
		if (!name || name.includes('/')) return;
		try {
			await api.mkdir(currentPath ? `${currentPath}/${name}` : name);
			await renderFiles(true);
		} catch (error) {
			toast(errorMessage(error));
		}
	});
	bindAll('[data-files-upload]', () => content.querySelector<HTMLInputElement>('#file-input')?.click());
	content.querySelector<HTMLInputElement>('#file-input')?.addEventListener('change', async (event) => {
		const files = [...((event.target as HTMLInputElement).files ?? [])];
		const status = content.querySelector<HTMLDivElement>('#upload-status')!;
		for (let index = 0; index < files.length; index += 1) {
			const file = files[index];
			const path = currentPath ? `${currentPath}/${file.name}` : file.name;
			try {
				await api.upload(path, file, (progress) => {
					status.innerHTML = `<div class="muted">Uploading ${html(file.name)} (${index + 1}/${files.length})</div><div class="progress-wrap"><div class="progress-bar" style="width:${Math.round(progress * 100)}%"></div></div>`;
				});
			} catch (error) {
				toast(errorMessage(error));
				break;
			}
		}
		status.innerHTML = '';
		await renderFiles(true);
	});
	bindAll('[data-files-refresh]', () => {
		const buttons = roots.flatMap((root) => [...root.querySelectorAll<HTMLButtonElement>('[data-files-refresh]')]);
		buttons.forEach((button) => {
			button.disabled = true;
			button.classList.add('is-syncing');
			button.setAttribute('aria-busy', 'true');
		});
		void renderFiles(true).finally(() =>
			buttons.forEach((button) => {
				button.disabled = false;
				button.classList.remove('is-syncing');
				button.removeAttribute('aria-busy');
			}),
		);
	});
}

export async function renderFiles(forceSync = false): Promise<void> {
	const filesNavigationActive = Boolean(document.querySelector('.nav-button.active[data-route="/files"]'));
	if (!filesNavigationActive || !document.querySelector('#page-content')) shell('files', t('files'));
	const content = document.querySelector<HTMLDivElement>('#page-content')!;
	const cached = cachedFiles(currentPath);
	if (cached) paintFiles(cached);
	const stopDirectoryLoading = directoryLoadCleanup;
	const finishDirectoryLoading = () => {
		if (directoryLoadCleanup !== stopDirectoryLoading) return;
		directoryLoadCleanup?.();
		directoryLoadCleanup = null;
	};
	if (!forceSync && validatedFilePaths.has(currentPath)) {
		finishDirectoryLoading();
		return;
	}
	const requestedPath = currentPath;
	validatedFilePaths.add(requestedPath);
	try {
		const listing = await api.listFiles(requestedPath);
		cacheFiles(listing);
		finishDirectoryLoading();
		paintFiles(listing);
	} catch (error) {
		finishDirectoryLoading();
		if (!cached) content.innerHTML = `<div class="error-banner">${html(errorMessage(error))}</div>`;
		else {
			paintFiles(cached);
			toast(errorMessage(error));
		}
	} finally {
		finishDirectoryLoading();
	}
}
