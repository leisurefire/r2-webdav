import type { BookmarkHub } from '@r2-webdav/shared-types';
import { api } from '../api/client';
import { errorMessage, html, refreshIcons, shell, sidebarContext, toast } from '../shell';
import { locale, t } from '../i18n';
import {
	collapseTreeBranch,
	expandTreeBranch,
	renderTreeNodes,
	treeLeadingMarkup,
	workspaceSidebarMarkup,
} from '../ui/helpers';
import { enhanceSelect } from '../ui/dropdown';
import { bindBookmarkPreviews } from '../bookmarks/previews';
import { bookmarkHub, pullBookmarks } from '../bookmarks/store';

interface BookmarkCard {
	title: string;
	url: string;
	domain: string;
	path: string[];
	dateModified: number;
}

interface BookmarkFolder {
	key: string;
	name: string;
	path: string[];
	links: BookmarkCard[];
	folders: BookmarkFolder[];
}

let bookmarkFolderPath: string[] = [];
export const bookmarkExpandedFolders = new Set<string>();

export function bookmarkFolderTree(): BookmarkFolder {
	const build = (nodes: BookmarkHub['nodes'], path: string[]): BookmarkFolder => {
		const links: BookmarkCard[] = [];
		const folders: BookmarkFolder[] = [];
		for (const node of nodes) {
			if (typeof node.url === 'string' && /^https?:\/\//i.test(node.url)) {
				try {
					const parsed = new URL(node.url);
					links.push({
						title: node.title.trim(),
						url: node.url,
						domain: parsed.hostname,
						path,
						dateModified: Number.isFinite(node.dateModified) ? node.dateModified : 0,
					});
				} catch {
					/* Ignore malformed links. */
				}
			} else if (Array.isArray(node.children)) {
				const folderPath = [...path, node.title.trim() || (locale === 'zh' ? '未命名文件夹' : 'Untitled folder')];
				folders.push({
					...build(node.children, folderPath),
					key: folderPath.join('\u001f'),
					name: folderPath.at(-1)!,
					path: folderPath,
				});
			}
		}
		return {
			key: path.join('\u001f'),
			name: path.at(-1) ?? (locale === 'zh' ? '全部链接' : 'All links'),
			path,
			links,
			folders,
		};
	};
	return build(bookmarkHub?.nodes ?? [], []);
}

export function bookmarkCardMarkup(card: BookmarkCard): string {
	let favicon = '';
	try {
		favicon = new URL('/favicon.ico', card.url).href;
	} catch {
		/* The card URL was already validated. */
	}
	return `<a class="bookmark-card" href="${html(card.url)}" target="_blank" rel="noopener noreferrer" title="${html(card.title || card.url)}">
		<div class="bookmark-card-body">${card.title ? `<h3>${html(card.title)}</h3>` : ''}<div class="bookmark-link"><span class="bookmark-favicon"><span data-bookmark-fallback>${html(card.domain.slice(0, 1).toUpperCase())}</span>${favicon ? `<img data-bookmark-icon src="${html(favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer" hidden>` : ''}</span><p>${html(card.url)}</p></div><div class="bookmark-card-meta"><small>${html(card.path.filter(Boolean).join(' / '))}</small><time>${card.dateModified ? new Date(card.dateModified).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en') : ''}</time></div></div>
	</a>`;
}

export function bookmarkPathMarkup(path: string[]): string {
	const rootLabel = locale === 'zh' ? '全部链接' : 'All links';
	const crumbs = [
		`<button class="bookmark-path-item ${path.length ? '' : 'current'}" data-bookmark-path="">${rootLabel}</button>`,
	];
	path.forEach((name, index) => {
		const target = path.slice(0, index + 1).join('\u001f');
		crumbs.push('<span class="bookmark-path-separator" aria-hidden="true">/</span>');
		crumbs.push(
			`<button class="bookmark-path-item ${index === path.length - 1 ? 'current' : ''}" data-bookmark-path="${html(target)}">${html(name)}</button>`,
		);
	});
	return `<nav class="collection-path bookmark-path" aria-label="${locale === 'zh' ? '当前收藏路径' : 'Current collection path'}">${crumbs.join('')}</nav>`;
}

export function bookmarkFolderOptions(root: BookmarkFolder): BookmarkFolder[] {
	const result: BookmarkFolder[] = [root];
	const append = (folder: BookmarkFolder) => {
		for (const child of folder.folders) {
			result.push(child);
			append(child);
		}
	};
	append(root);
	return result;
}

export function bookmarkFolderTreeMarkup(root: BookmarkFolder, selectedKey: string): string {
	return renderTreeNodes(
		root.folders,
		(folder) => folder.folders,
		(folder, depth, children) => {
			const hasChildren = folder.folders.length > 0;
			const active = folder.key === selectedKey;
			const expanded = hasChildren && bookmarkExpandedFolders.has(folder.key);
			return `<div class="bookmark-tree-node note-tree-node note-folder-card ${active ? 'active' : ''} ${expanded ? 'expanded' : ''}" style="--tree-depth:${depth}"><button class="bookmark-folder collection-tree-row" data-bookmark-folder="${html(folder.key)}" data-bookmark-has-children="${hasChildren}">${treeLeadingMarkup(expanded ? 'folder-open' : 'folder', expanded)}<span>${html(folder.name)}</span></button>${expanded && children ? `<div class="bookmark-tree-children notes-tree-children">${children}</div>` : ''}</div>`;
		},
	);
}

export function expandBookmarkAncestors(key: string): void {
	const path = key.split('\u001f');
	for (let depth = 1; depth < path.length; depth += 1) {
		bookmarkExpandedFolders.add(path.slice(0, depth).join('\u001f'));
	}
}

export function paintBookmarkView(): void {
	const content = document.querySelector<HTMLDivElement>('#page-content');
	if (!content) return;
	const root = bookmarkFolderTree();
	let folder = root;
	for (const name of bookmarkFolderPath) folder = folder.folders.find((item) => item.name === name) ?? root;
	if (folder === root && bookmarkFolderPath.length) bookmarkFolderPath = [];
	const cards = folder.links;
	const selectedFolderKey = bookmarkFolderPath.join('\u001f');
	if (selectedFolderKey) expandBookmarkAncestors(selectedFolderKey);
	const folderOptions = bookmarkFolderOptions(root)
		.map(
			(item) =>
				`<option value="${html(item.key)}" ${item.path.join('\u001f') === bookmarkFolderPath.join('\u001f') ? 'selected' : ''}>${html(item.path.length ? item.path.join(' / ') : item.name)}</option>`,
		)
		.join('');
	const folderTree = bookmarkFolderTreeMarkup(root, selectedFolderKey);
	const refreshLabel = locale === 'zh' ? '拉取链接' : 'Refresh links';
	content.innerHTML = `<div class="links-layout">
		<div class="notes-inner-toolbar mobile-only-tools"><div class="bookmark-folder-select-wrap"><select class="input bookmark-folder-select" aria-label="${locale === 'zh' ? '选择链接目录' : 'Choose link folder'}">${folderOptions}</select></div></div>
		<div class="bookmarks-main">${bookmarkPathMarkup(bookmarkFolderPath)}<div class="bookmarks-grid ${cards.length ? '' : 'empty'}">${cards.length ? cards.map((card) => bookmarkCardMarkup(card)).join('') : `<div class="notes-empty large"><i data-lucide="bookmark"></i><span>${locale === 'zh' ? '暂无保存链接' : 'No saved links'}</span></div>`}</div></div>
	</div>`;
	const context = sidebarContext();
	if (context)
		context.innerHTML = workspaceSidebarMarkup({
			label: locale === 'zh' ? '链接目录' : 'Link folders',
			tools: `<div class="sidebar-context-tools"><button type="button" class="row-action" data-links-refresh title="${refreshLabel}" aria-label="${refreshLabel}"><i data-lucide="refresh-cw"></i></button></div>`,
			body: `<div class="bookmark-tree-node note-tree-node note-folder-card ${folder === root ? 'active' : ''} expanded"><button class="bookmark-folder collection-tree-row bookmark-folder-root" data-bookmark-folder="" data-bookmark-has-children="${root.folders.length > 0}" style="--tree-depth:0">${treeLeadingMarkup('bookmark', true)}<span>${locale === 'zh' ? '全部链接' : 'All links'}</span></button>${folderTree || `<span class="muted bookmark-folder-empty">${locale === 'zh' ? '暂无文件夹' : 'No folders'}</span>`}</div>`,
			treeClass: 'bookmark-folder-tree',
		});
	refreshIcons();
	const folderSelect = content.querySelector<HTMLSelectElement>('.bookmark-folder-select');
	if (folderSelect) enhanceSelect(folderSelect, { className: 'bookmark-folder-custom-select' });
	bindBookmarkPreviews(content);
	const path = content.querySelector<HTMLElement>('.bookmark-path');
	if (path) path.scrollLeft = path.scrollWidth;
	context?.querySelectorAll<HTMLElement>('[data-bookmark-folder]').forEach((button) =>
		button.addEventListener('click', () => {
			const key = button.dataset.bookmarkFolder ?? '';
			const node = button.closest('.bookmark-tree-node');
			const wasExpanded = Boolean(node?.classList.contains('expanded'));
			const apply = () => {
				const expanding = key && button.dataset.bookmarkHasChildren === 'true' && !wasExpanded;
				if (key && button.dataset.bookmarkHasChildren === 'true') {
					if (wasExpanded) bookmarkExpandedFolders.delete(key);
					else bookmarkExpandedFolders.add(key);
				}
				if (key) expandBookmarkAncestors(key);
				bookmarkFolderPath = key ? key.split('\u001f') : [];
				paintBookmarkView();
				if (expanding) {
					const nextHost = [...(sidebarContext()?.querySelectorAll<HTMLElement>('[data-bookmark-folder]') ?? [])]
						.find((item) => item.dataset.bookmarkFolder === key)
						?.closest('.bookmark-tree-node');
					expandTreeBranch(nextHost, '.bookmark-tree-children');
				}
			};
			if (key && button.dataset.bookmarkHasChildren === 'true' && wasExpanded) {
				collapseTreeBranch(node, '.bookmark-tree-children', apply);
				return;
			}
			apply();
		}),
	);
	content.querySelectorAll<HTMLElement>('[data-bookmark-path]').forEach((button) =>
		button.addEventListener('click', () => {
			const key = button.dataset.bookmarkPath ?? '';
			bookmarkFolderPath = key ? key.split('\u001f') : [];
			paintBookmarkView();
		}),
	);
	folderSelect?.addEventListener('change', (event) => {
		const key = (event.target as HTMLSelectElement).value;
		bookmarkFolderPath = key ? key.split('\u001f') : [];
		paintBookmarkView();
	});
	const refreshLinks = async () => {
		const buttons = [
			...content.querySelectorAll<HTMLButtonElement>('[data-links-refresh]'),
			...(context?.querySelectorAll<HTMLButtonElement>('[data-links-refresh]') ?? []),
		];
		buttons.forEach((button) => {
			button.disabled = true;
			button.classList.add('is-syncing');
			button.setAttribute('aria-busy', 'true');
		});
		try {
			await pullBookmarks(true);
			paintBookmarkView();
		} finally {
			buttons.forEach((button) => {
				button.disabled = false;
				button.classList.remove('is-syncing');
				button.removeAttribute('aria-busy');
			});
		}
	};
	content
		.querySelectorAll('[data-links-refresh]')
		.forEach((node) => node.addEventListener('click', () => void refreshLinks()));
	context
		?.querySelectorAll('[data-links-refresh]')
		.forEach((node) => node.addEventListener('click', () => void refreshLinks()));
}

export async function renderLinks(forceSync = false): Promise<void> {
	if (!document.querySelector('.links-layout')) shell('links', t('links'));
	if (forceSync || !bookmarkHub) await pullBookmarks(true);
	paintBookmarkView();
}
