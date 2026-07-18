import {
	Archive,
	Bookmark,
	CalendarDays,
	Check,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	Cloud,
	Copy,
	Database,
	Download,
	Eye,
	File,
	FileDown,
	Film,
	Folder,
	FolderOpen,
	FolderPlus,
	Image,
	Inbox,
	Languages,
	Laptop,
	LogOut,
	Music,
	PanelLeftClose,
	PanelLeftOpen,
	Pencil,
	Pin,
	PinOff,
	Plus,
	RefreshCw,
	Save,
	Settings,
	Smartphone,
	StickyNote,
	Trash2,
	Upload,
	User,
	X,
	createIcons,
} from 'lucide';
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';
import type {
	BookmarkHub,
	CalendarEvent,
	CalendarSummary,
	DeviceSession,
	FileEntry,
	FileListing,
	Note,
	NoteFolder,
	NotePage,
} from '@r2-webdav/shared-types';
import { Lunar, Solar } from 'lunar-typescript';
import { API_BASE, ApiError, api, hasSession } from './api/client';
import { bindBookmarkPreviews } from './bookmarks/previews';
import './styles.css';
import './styles/bookmarks.css';
import './styles/notes.css';
import './styles/responsive.css';

type Page = 'files' | 'calendar' | 'notes' | 'devices' | 'settings';
const app = document.querySelector<HTMLDivElement>('#app')!;
marked.use(markedKatex({ throwOnError: false, nonStandard: true }));
type Locale = 'en' | 'zh';
let locale: Locale =
	(localStorage.getItem('r2_locale') as Locale | null) ??
	(navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');
const messages = {
	en: {
		workspace: 'TrueSpace',
		files: 'Files',
		calendar: 'Calendar',
		notes: 'Notes',
		devices: 'Devices',
		settings: 'Settings',
		filesDesc: 'Browse and manage everything in your file space.',
		calendarDesc: 'Plan your schedule and keep your calendars in sync.',
		notesDesc: 'Capture ideas and keep the important ones close.',
		devicesDesc: 'Review and revoke every device signed in to this account.',
		settingsDesc: 'Connection details and preferences for TrueSpace.',
		settingsConnection: 'Connection',
		settingsLanguage: 'Language',
		settingsLanguageHint: 'Choose the language used across TrueSpace.',
		webdavUrl: 'WebDAV URL',
		caldavUrl: 'CalDAV URL',
		copy: 'Copy',
		copied: 'Copied',
		english: 'English',
		chinese: 'Chinese',
		connected: 'Your space is ready',
		logout: 'Log out',
		account: 'Account',
		logoutConfirm: 'Are you sure you want to log out?',
		loading: 'Loading…',
		language: '中文',
		newNote: 'New note',
		active: 'Active',
		bookmarks: 'Link collection',
		archived: 'Archived',
		noNotes: 'No notes here yet',
		save: 'Save changes',
		pin: 'Pin',
		unpin: 'Unpin',
		archive: 'Archive',
		restore: 'Restore',
		delete: 'Delete',
		preview: 'Preview',
		markdown: 'Markdown',
		previous: 'Previous',
		next: 'Next',
		page: 'Page',
		currentDevice: 'Current device',
		lastActive: 'Last active',
		expires: 'Expires',
		revoke: 'Revoke',
		welcome: 'Welcome back',
		signIn: 'Sign in to continue to TrueSpace.',
		username: 'Username',
		password: 'Password',
		continue: 'Continue',
		signingIn: 'Signing in…',
		secureAccess: 'Secure access',
		hero: 'Your files, notes, and time—together.',
		heroCopy: 'A calm home for your files, notes, collections, and calendars.',
	},
	zh: {
		workspace: 'TrueSpace',
		files: '文件',
		calendar: '日历',
		notes: '便签',
		devices: '设备',
		settings: '设置',
		filesDesc: '浏览和管理文件空间中的全部内容。',
		calendarDesc: '规划日程，并在不同设备间保持同步。',
		notesDesc: '随手记录想法，并将重要内容置顶。',
		devicesDesc: '查看并撤销此账户已登录的所有设备。',
		settingsDesc: '管理 TrueSpace 的连接信息与使用偏好。',
		settingsConnection: '连接',
		settingsLanguage: '语言',
		settingsLanguageHint: '选择工作区界面使用的语言。',
		webdavUrl: 'WebDAV 地址',
		caldavUrl: 'CalDAV 地址',
		copy: '复制',
		copied: '已复制',
		english: 'English',
		chinese: '中文',
		connected: '空间已就绪',
		logout: '退出登录',
		account: '账户',
		logoutConfirm: '确定要退出当前账户吗？',
		loading: '加载中…',
		language: 'English',
		newNote: '新建便签',
		active: '便签',
		bookmarks: '链接收藏',
		archived: '已归档',
		noNotes: '这里还没有便签',
		save: '保存更改',
		pin: '置顶',
		unpin: '取消置顶',
		archive: '归档',
		restore: '恢复',
		delete: '删除',
		preview: '预览',
		markdown: 'Markdown',
		previous: '上一页',
		next: '下一页',
		page: '第',
		currentDevice: '当前设备',
		lastActive: '最近访问',
		expires: '到期时间',
		revoke: '移除',
		welcome: '欢迎回来',
		signIn: '登录后继续访问 TrueSpace。',
		username: '用户名',
		password: '密码',
		continue: '继续',
		signingIn: '登录中…',
		secureAccess: '安全访问',
		hero: '文件、便签与日程，尽在一处。',
		heroCopy: '让文件、便签、收藏与日历自然地待在一起。',
	},
} as const;
type MessageKey = keyof (typeof messages)['en'];
const t = (key: MessageKey): string => messages[locale][key];
document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
let currentPath = '';
let sidebarCollapsed = localStorage.getItem('r2_sidebar_collapsed') === '1';
let calendarCursor = new Date();
calendarCursor.setDate(1);
type DateRange = { from: number; to: number };
const calendarCache: {
	calendars: CalendarSummary[] | null;
	events: Map<string, CalendarEvent>;
	loadedRanges: DateRange[];
} = { calendars: null, events: new Map(), loadedRanges: [] };
let calendarRequest = 0;
const calendarValidatedRanges: DateRange[] = [];
const fileCache = new Map<string, FileListing>();
const validatedFilePaths = new Set<string>();
const validatedNotePages = new Set<string>();

const html = (value: unknown): string =>
	String(value ?? '').replace(
		/[&<>"']/g,
		(char) =>
			({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#039;',
			})[char]!,
	);

function refreshIcons(): void {
	createIcons({
		icons: {
			Archive,
			Bookmark,
			CalendarDays,
			Check,
			ChevronLeft,
			ChevronRight,
			ChevronUp,
			Cloud,
			Copy,
			Database,
				Download,
				Eye,
				File,
				FileDown,
			Film,
			Folder,
			FolderOpen,
			FolderPlus,
			Image,
			Inbox,
			Languages,
			Laptop,
			LogOut,
			Music,
			PanelLeftClose,
			PanelLeftOpen,
			Pencil,
			Pin,
			PinOff,
			Plus,
				RefreshCw,
				Save,
			Settings,
			Smartphone,
			StickyNote,
			Trash2,
			Upload,
			User,
			X,
		},
	});
}

function toast(message: string): void {
	document.querySelector('.toast')?.remove();
	const node = document.createElement('div');
	node.className = 'toast';
	node.textContent = message;
	document.body.append(node);
	window.setTimeout(() => node.remove(), 3200);
}

function errorMessage(error: unknown): string {
	if (error instanceof ApiError && error.status === 401) {
		localStorage.removeItem('r2_session_token');
		navigate('/login');
	}
	return error instanceof Error ? error.message : 'Something went wrong';
}

function loadingMarkup(compact = false): string {
	return `<div class="true-loading ${compact ? 'compact' : ''}" role="status" aria-label="${html(t('loading'))}"><span class="true-loading-line"></span><span class="true-loading-line"></span><span class="true-loading-line"></span><span class="visually-hidden">${html(t('loading'))}</span></div>`;
}

function pageFromPath(): Page {
	const page = location.pathname.slice(1) as Page;
	return ['files', 'calendar', 'notes', 'devices', 'settings'].includes(page) ? page : 'files';
}

function navigate(path: string): void {
	history.pushState({}, '', path);
	void render();
}

function shell(page: Page, _title: string, content = loadingMarkup()): void {
	app.innerHTML = `<div class="app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}">
		<aside class="sidebar">
			<div class="sidebar-head">
				<div class="brand" aria-label="TrueSpace"><span class="brand-full">TrueSpace</span></div>
				<button class="sidebar-toggle" id="sidebar-toggle" title="${sidebarCollapsed ? (locale === 'zh' ? '展开侧栏' : 'Expand sidebar') : locale === 'zh' ? '折叠侧栏' : 'Collapse sidebar'}" aria-label="${sidebarCollapsed ? (locale === 'zh' ? '展开侧栏' : 'Expand sidebar') : locale === 'zh' ? '折叠侧栏' : 'Collapse sidebar'}"><i data-lucide="${sidebarCollapsed ? 'panel-left-open' : 'panel-left-close'}"></i></button>
			</div>
			<nav class="nav" aria-label="Primary navigation">
				<button class="nav-button ${page === 'files' ? 'active' : ''}" data-route="/files" title="${t('files')}"><i data-lucide="folder"></i><span>${t('files')}</span></button>
				<button class="nav-button ${page === 'calendar' ? 'active' : ''}" data-route="/calendar" title="${t('calendar')}"><i data-lucide="calendar-days"></i><span>${t('calendar')}</span></button>
				<button class="nav-button ${page === 'notes' ? 'active' : ''}" data-route="/notes" title="${bookmarkHub ? (locale === 'zh' ? '收藏空间' : 'Collection') : t('notes')}"><i data-lucide="sticky-note"></i><span>${bookmarkHub ? (locale === 'zh' ? '收藏空间' : 'Collection') : t('notes')}</span></button>
			</nav>
			<div class="sidebar-footer"><div class="account-menu-wrap">
				<div class="account-popover" id="account-popover" hidden>
					<button data-route="/settings"><i data-lucide="settings"></i><span>${t('settings')}</span></button>
					<button data-route="/devices"><i data-lucide="laptop"></i><span>${t('devices')}</span></button>
					<div class="account-menu-separator"></div>
					<button class="account-logout" id="account-logout"><i data-lucide="log-out"></i><span>${t('logout')}</span></button>
				</div>
				<button class="user-menu-button" id="user-menu-toggle" aria-expanded="false" aria-haspopup="menu">
					<span class="user-avatar"><i data-lucide="user"></i></span><span class="user-copy"><strong>leisurefire</strong></span><i class="user-chevron" data-lucide="chevron-up"></i>
				</button>
			</div></div>
		</aside>
		<main class="workspace"><div class="content" id="page-content">${content}</div></main>
	</div>`;
	document
		.querySelectorAll<HTMLElement>('[data-route]')
		.forEach((item) => item.addEventListener('click', () => navigate(item.dataset.route!)));
	const accountPopover = document.querySelector<HTMLElement>('#account-popover');
	const accountToggle = document.querySelector<HTMLButtonElement>('#user-menu-toggle');
	const accountWrap = document.querySelector<HTMLElement>('.account-menu-wrap');
	const closeAccountMenu = () => {
		if (accountPopover) accountPopover.hidden = true;
		accountToggle?.setAttribute('aria-expanded', 'false');
		accountWrap?.classList.remove('open');
	};
	accountToggle?.addEventListener('click', (event) => {
		event.stopPropagation();
		const opening = accountPopover?.hidden ?? false;
		if (accountPopover) accountPopover.hidden = !opening;
		accountToggle.setAttribute('aria-expanded', String(opening));
		accountWrap?.classList.toggle('open', opening);
		if (opening) window.setTimeout(() => document.addEventListener('click', closeAccountMenu, { once: true }), 0);
	});
	document.querySelector('#account-logout')?.addEventListener('click', () => void confirmLogout());
	document.querySelector('#sidebar-toggle')?.addEventListener('click', () => {
		sidebarCollapsed = !sidebarCollapsed;
		localStorage.setItem('r2_sidebar_collapsed', sidebarCollapsed ? '1' : '0');
		document.querySelector('.app-shell')?.classList.toggle('sidebar-collapsed', sidebarCollapsed);
		const toggle = document.querySelector<HTMLButtonElement>('#sidebar-toggle');
		const label = sidebarCollapsed
			? locale === 'zh'
				? '展开侧栏'
				: 'Expand sidebar'
			: locale === 'zh'
				? '折叠侧栏'
				: 'Collapse sidebar';
		if (toggle) {
			toggle.title = label;
			toggle.setAttribute('aria-label', label);
			toggle.innerHTML = `<i data-lucide="${sidebarCollapsed ? 'panel-left-open' : 'panel-left-close'}"></i>`;
			refreshIcons();
		}
	});
	refreshIcons();
}

function formatBytes(size: number): string {
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

function fileIcon(entry: FileEntry): string {
	if (entry.type === 'directory') return 'folder';
	if (entry.contentType?.startsWith('image/')) return 'image';
	if (entry.contentType?.startsWith('video/')) return 'film';
	if (entry.contentType?.startsWith('audio/')) return 'music';
	return 'file';
}

function breadcrumbMarkup(path: string): string {
	const parts = path ? path.split('/') : [];
	let built = '';
	const crumbs = [
		`<button class="crumb ${parts.length === 0 ? 'current' : ''}" data-path="">${locale === 'zh' ? '我的文件' : 'My files'}</button>`,
	];
	parts.forEach((part, index) => {
		built = built ? `${built}/${part}` : part;
		crumbs.push('<span class="crumb-separator">/</span>');
		crumbs.push(
			`<button class="crumb ${index === parts.length - 1 ? 'current' : ''}" data-path="${html(built)}">${html(part)}</button>`,
		);
	});
	return crumbs.join('');
}

function openTextDialog(title: string, label: string, initial = ''): Promise<string | null> {
	return new Promise((resolve) => {
		const dialog = document.createElement('dialog');
		dialog.innerHTML = `<form method="dialog" class="dialog-body"><h2>${html(title)}</h2><div class="field"><label for="dialog-value">${html(label)}</label><input class="input" id="dialog-value" value="${html(initial)}" required autocomplete="off"></div><div class="dialog-actions"><button class="button" value="cancel">Cancel</button><button class="button primary" value="confirm">Save</button></div></form>`;
		document.body.append(dialog);
		dialog.addEventListener('close', () => {
			const value =
				dialog.returnValue === 'confirm' ? dialog.querySelector<HTMLInputElement>('#dialog-value')!.value.trim() : null;
			dialog.remove();
			resolve(value);
		});
		dialog.showModal();
		dialog.querySelector<HTMLInputElement>('input')?.select();
	});
}

function confirmAction(title: string, message: string, confirmLabel = 'Delete'): Promise<boolean> {
	return new Promise((resolve) => {
		const dialog = document.createElement('dialog');
		dialog.innerHTML = `<form method="dialog" class="dialog-body"><h2>${html(title)}</h2><p class="muted">${html(message)}</p><div class="dialog-actions"><button class="button" value="cancel">${locale === 'zh' ? '取消' : 'Cancel'}</button><button class="button danger" value="confirm">${html(confirmLabel)}</button></div></form>`;
		document.body.append(dialog);
		dialog.addEventListener('close', () => {
			const confirmed = dialog.returnValue === 'confirm';
			dialog.remove();
			resolve(confirmed);
		});
		dialog.showModal();
	});
}

async function confirmLogout(): Promise<void> {
	if (!(await confirmAction(t('logout'), t('logoutConfirm'), t('logout')))) return;
	try {
		await api.logout();
	} catch {
		// The local token is cleared by api.logout even when the server cannot be reached.
	} finally {
		location.replace('/login');
	}
}

function fileCacheKey(path: string): string {
	return `r2_files_${encodeURIComponent(path || 'root')}`;
}

function cachedFiles(path: string): FileListing | null {
	if (fileCache.has(path)) return fileCache.get(path)!;
	try {
		const listing = JSON.parse(localStorage.getItem(fileCacheKey(path)) ?? 'null') as FileListing | null;
		if (listing?.path === path && Array.isArray(listing.entries)) fileCache.set(path, listing);
		return listing?.path === path ? listing : null;
	} catch {
		return null;
	}
}

function cacheFiles(listing: FileListing): void {
	fileCache.set(listing.path, listing);
	localStorage.setItem(fileCacheKey(listing.path), JSON.stringify(listing));
}

function fileExtension(path: string): string {
	return path.split('/').at(-1)?.split('.').at(-1)?.toLowerCase() ?? '';
}

function previewContentType(entry: FileEntry): string {
	if (entry.contentType) return entry.contentType;
	const ext = fileExtension(entry.path);
	return ({ txt: 'text/plain', json: 'application/json', md: 'text/markdown',
		png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
		mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

function canPreview(entry: FileEntry): boolean {
	return entry.type === 'file' && entry.size <= 100 * 1024;
}

async function openFilePreview(entry: FileEntry): Promise<void> {
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
				try { value = JSON.stringify(JSON.parse(value), null, 2); } catch { /* Keep invalid JSON editable. */ }
			}
			body.innerHTML = `<div class="file-text-editor"><textarea class="file-text-source" spellcheck="false" aria-label="${html(entry.name)}">${html(value)}</textarea><div class="file-preview-actions"><span class="muted" data-file-save-status></span><button class="button primary" data-file-save><i data-lucide="save"></i><span>${locale === 'zh' ? '手动保存' : 'Save manually'}</span></button></div></div>`;
			body.querySelector('[data-file-save]')?.addEventListener('click', async () => {
				const button = body.querySelector<HTMLButtonElement>('[data-file-save]')!;
				const status = body.querySelector<HTMLElement>('[data-file-save-status]')!;
				button.disabled = true;
				status.textContent = locale === 'zh' ? '保存中…' : 'Saving…';
				try {
					await api.saveTextFile(entry.path, body.querySelector<HTMLTextAreaElement>('.file-text-source')!.value, type, entry.etag);
					status.textContent = locale === 'zh' ? '已保存' : 'Saved';
					entry.etag = (await api.fileInfo(entry.path)).etag;
				} catch (error) {
					status.textContent = errorMessage(error);
				} finally { button.disabled = false; }
			});
		} else if (ext === 'md' || type === 'text/markdown') {
			const value = await blob.text();
			body.innerHTML = `<article class="file-markdown-preview">${renderMarkdown(value)}</article><div class="file-preview-actions"><button class="button primary" data-migrate-md><i data-lucide="file-down"></i><span>${locale === 'zh' ? '迁移到收藏空间' : 'Move to collection'}</span></button></div>`;
			body.querySelector('[data-migrate-md]')?.addEventListener('click', async () => {
				if (!(await confirmAction(locale === 'zh' ? '迁移 Markdown 文件？' : 'Move Markdown file?', locale === 'zh' ? '迁移成功后将删除文件空间中的原文件。' : 'The original file will be deleted after import.', locale === 'zh' ? '迁移' : 'Move'))) return;
				try {
					await api.createNote(entry.name.replace(/\.md$/i, '') || 'Untitled note', value);
					await api.deleteFile(entry.path);
					await api.clearFilePreview(entry.path);
					dialog.close();
					toast(locale === 'zh' ? '已迁移到收藏空间' : 'Moved to collection');
					navigate('/notes');
				} catch (error) { toast(errorMessage(error)); }
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

function paintFiles(listing: FileListing): void {
	const content = document.querySelector<HTMLDivElement>('#page-content');
	if (!content || pageFromPath() !== 'files' || listing.path !== currentPath) return;
	const rows = listing.entries
		.map(
			(entry) => `<article class="file-card">
				<button class="file-card-open" data-open="${html(entry.path)}" data-type="${entry.type}"><span class="file-card-icon"><i data-lucide="${fileIcon(entry)}"></i></span><span class="file-card-copy"><strong>${html(entry.name)}</strong><small>${entry.type === 'file' ? formatBytes(entry.size) : locale === 'zh' ? '文件夹' : 'Folder'} · ${new Date(entry.modifiedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small></span></button>
				<div class="file-card-actions">
					${entry.type === 'file' ? `<button class="row-action" data-download="${html(entry.path)}" title="${locale === 'zh' ? '下载' : 'Download'}" aria-label="${locale === 'zh' ? '下载' : 'Download'}"><i data-lucide="download"></i></button>` : ''}
					<button class="row-action" data-rename="${html(entry.path)}" title="${locale === 'zh' ? '重命名' : 'Rename'}" aria-label="${locale === 'zh' ? '重命名' : 'Rename'}"><i data-lucide="pencil"></i></button>
					<button class="row-action danger" data-delete="${html(entry.path)}" title="${t('delete')}" aria-label="${t('delete')}"><i data-lucide="trash-2"></i></button>
				</div>
			</article>`,
		)
		.join('');
	content.innerHTML = `<div class="toolbar"><div class="breadcrumbs">${breadcrumbMarkup(listing.path)}</div><span class="toolbar-spacer"></span>
			<button class="button icon-button" id="files-refresh" title="${locale === 'zh' ? '刷新文件' : 'Refresh files'}" aria-label="${locale === 'zh' ? '刷新文件' : 'Refresh files'}"><i data-lucide="refresh-cw"></i></button>
			<button class="button" id="mkdir"><i data-lucide="folder-plus"></i><span>${locale === 'zh' ? '新建文件夹' : 'New folder'}</span></button>
			<input type="file" id="file-input" hidden multiple>
		</div><div id="upload-status"></div><button class="button primary floating-primary-action" id="upload" title="${locale === 'zh' ? '上传' : 'Upload'}" aria-label="${locale === 'zh' ? '上传' : 'Upload'}"><i data-lucide="upload"></i><span>${locale === 'zh' ? '上传' : 'Upload'}</span></button>
		${rows ? `<div class="file-grid">${rows}</div>` : `<div class="empty-state"><div><i data-lucide="folder-open"></i><div>${locale === 'zh' ? '此文件夹为空' : 'This folder is empty'}</div></div></div>`}`;
	refreshIcons();
	content.querySelectorAll<HTMLElement>('[data-path]').forEach((item) =>
		item.addEventListener('click', () => {
			currentPath = item.dataset.path!;
			void renderFiles();
		}),
	);
	content.querySelectorAll<HTMLElement>('[data-open]').forEach((item) =>
		item.addEventListener('click', async () => {
			if (item.dataset.type === 'directory') {
				currentPath = item.dataset.open!;
				await renderFiles();
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
	content.querySelector('#mkdir')?.addEventListener('click', async () => {
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
	content
		.querySelector('#upload')
		?.addEventListener('click', () => content.querySelector<HTMLInputElement>('#file-input')?.click());
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
	content.querySelector('#files-refresh')?.addEventListener('click', () => void renderFiles(true));
}

async function renderFiles(forceSync = false): Promise<void> {
	shell('files', t('files'));
	const content = document.querySelector<HTMLDivElement>('#page-content')!;
	const cached = cachedFiles(currentPath);
	if (cached) paintFiles(cached);
	if (!forceSync && validatedFilePaths.has(currentPath)) return;
	const requestedPath = currentPath;
	validatedFilePaths.add(requestedPath);
	try {
		const listing = await api.listFiles(requestedPath);
		cacheFiles(listing);
		paintFiles(listing);
	} catch (error) {
		if (!cached) content.innerHTML = `<div class="error-banner">${html(errorMessage(error))}</div>`;
		else toast(errorMessage(error));
	}
}

function localDateKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function inputDate(value: string): string {
	const date = new Date(value);
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 16);
}

function eventCacheKey(event: CalendarEvent): string {
	return `${event.uid}@${event.start}`;
}

function lunarDate(date: Date): { short: string; full: string } {
	const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
	const lunar = solar.getLunar();
	const festival = [...solar.getFestivals(), ...lunar.getFestivals()][0];
	const jieQi = lunar.getJieQi();
	const day = lunar.getDayInChinese();
	const month = `${lunar.getMonthInChinese()}月`;
	return {
		short: festival || jieQi || (lunar.getDay() === 1 ? month : day),
		full: `农历${month}${day}${festival ? ` · ${festival}` : jieQi ? ` · ${jieQi}` : ''}`,
	};
}

function mergeRangeInto(target: DateRange[], range: DateRange): void {
	const ranges = [...target, range].sort((a, b) => a.from - b.from);
	const merged = ranges.reduce<DateRange[]>((result, current) => {
		const last = result.at(-1);
		if (!last || current.from > last.to) result.push({ ...current });
		else last.to = Math.max(last.to, current.to);
		return result;
	}, []);
	target.splice(0, target.length, ...merged);
}

function mergeLoadedRange(range: DateRange): void {
	mergeRangeInto(calendarCache.loadedRanges, range);
	mergeRangeInto(calendarValidatedRanges, range);
}

function missingRanges(loadedRanges: DateRange[], range: DateRange): DateRange[] {
	const missing: DateRange[] = [];
	let cursor = range.from;
	for (const loaded of loadedRanges) {
		if (loaded.to <= cursor || loaded.from >= range.to) continue;
		if (loaded.from > cursor) missing.push({ from: cursor, to: Math.min(loaded.from, range.to) });
		cursor = Math.max(cursor, loaded.to);
		if (cursor >= range.to) break;
	}
	if (cursor < range.to) missing.push({ from: cursor, to: range.to });
	return missing;
}

function persistCalendarCache(): void {
	localStorage.setItem(
		'r2_calendar_cache',
		JSON.stringify({
			calendars: calendarCache.calendars,
			events: [...calendarCache.events.values()],
			loadedRanges: calendarCache.loadedRanges,
		}),
	);
}

function hydrateCalendarCache(): void {
	try {
		const cached = JSON.parse(localStorage.getItem('r2_calendar_cache') ?? 'null') as {
			calendars?: CalendarSummary[];
			events?: CalendarEvent[];
			loadedRanges?: DateRange[];
		} | null;
		if (!cached) return;
		if (Array.isArray(cached.calendars)) calendarCache.calendars = cached.calendars;
		if (Array.isArray(cached.events))
			cached.events.forEach((event) => calendarCache.events.set(eventCacheKey(event), event));
		if (Array.isArray(cached.loadedRanges)) calendarCache.loadedRanges = cached.loadedRanges;
	} catch {
		localStorage.removeItem('r2_calendar_cache');
	}
}

function invalidateCalendarCache(): void {
	calendarValidatedRanges.length = 0;
}

hydrateCalendarCache();

async function eventDialog(
	calendar: CalendarSummary,
	existing?: CalendarEvent,
	defaultDate?: Date,
): Promise<'saved' | 'deleted' | null> {
	return new Promise((resolve) => {
		const start = existing ? new Date(existing.seriesStart ?? existing.start) : new Date(defaultDate ?? new Date());
		if (!existing) start.setHours(9, 0, 0, 0);
		const duration = existing ? Math.max(1, Date.parse(existing.end) - Date.parse(existing.start)) : 60 * 60_000;
		const end = new Date(start.getTime() + duration);
		let kind: 'event' | 'birthday' = existing?.kind === 'birthday' ? 'birthday' : 'event';
		let calendarSystem: 'solar' | 'lunar' = existing?.calendarSystem === 'lunar' ? 'lunar' : 'solar';
		const initialLunar =
			existing?.lunarDate ??
			(() => {
				const lunar = Solar.fromYmd(start.getFullYear(), start.getMonth() + 1, start.getDate()).getLunar();
				return {
					year: lunar.getYear(),
					month: Math.abs(lunar.getMonth()),
					day: lunar.getDay(),
					leap: lunar.getMonth() < 0,
				};
			})();
		const copy =
			locale === 'zh'
				? {
						newEvent: '新建日程',
						editEvent: '编辑日程',
						event: '日程',
						birthday: '生日',
						title: '标题',
						solar: '公历',
						lunar: '农历',
						calendar: '日期类型',
						type: '类型',
						starts: '开始',
						ends: '结束',
						allDay: '全天',
						location: '地点',
						description: '备注',
						year: '年',
						month: '月',
						day: '日',
						leap: '闰月',
						repeat: '重复',
						yearly: '每年',
						delete: '删除',
						cancel: '取消',
						save: '保存',
						invalidLunar: '所选农历日期不存在',
					}
				: {
						newEvent: 'New event',
						editEvent: 'Edit event',
						event: 'Event',
						birthday: 'Birthday',
						title: 'Title',
						solar: 'Gregorian',
						lunar: 'Lunar',
						calendar: 'Calendar',
						type: 'Type',
						starts: 'Starts',
						ends: 'Ends',
						allDay: 'All day',
						location: 'Location',
						description: 'Notes',
						year: 'Year',
						month: 'Month',
						day: 'Day',
						leap: 'Leap month',
						repeat: 'Repeat',
						yearly: 'Every year',
						delete: 'Delete',
						cancel: 'Cancel',
						save: 'Save',
						invalidLunar: 'The selected lunar date does not exist',
					};
		const monthNames =
			locale === 'zh'
				? ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月']
				: Array.from({ length: 12 }, (_, index) => `Month ${index + 1}`);
		const dayNames =
			locale === 'zh'
				? [
						'初一',
						'初二',
						'初三',
						'初四',
						'初五',
						'初六',
						'初七',
						'初八',
						'初九',
						'初十',
						'十一',
						'十二',
						'十三',
						'十四',
						'十五',
						'十六',
						'十七',
						'十八',
						'十九',
						'二十',
						'廿一',
						'廿二',
						'廿三',
						'廿四',
						'廿五',
						'廿六',
						'廿七',
						'廿八',
						'廿九',
						'三十',
					]
				: Array.from({ length: 30 }, (_, index) => `Day ${index + 1}`);
		const timeValue = (date: Date) =>
			`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
		const dialog = document.createElement('dialog');
		dialog.className = 'event-dialog';
		dialog.innerHTML = `<form class="dialog-body" id="event-form"><h2>${existing ? copy.editEvent : copy.newEvent}</h2>
			<div class="event-dialog-options">
				<div class="field"><label>${copy.type}</label><div class="segment-control compact"><button type="button" data-event-kind="event">${copy.event}</button><button type="button" data-event-kind="birthday">${copy.birthday}</button></div></div>
				<div class="field"><label>${copy.calendar}</label><div class="segment-control compact"><button type="button" data-calendar-system="solar">${copy.solar}</button><button type="button" data-calendar-system="lunar">${copy.lunar}</button></div></div>
			</div>
			<div class="field"><label for="event-title">${copy.title}</label><input class="input" id="event-title" value="${html(existing?.title ?? '')}" required></div>
			<div id="event-solar-fields"><div class="event-time-grid"><div class="field"><label for="event-start">${copy.starts}</label><input class="input" type="datetime-local" id="event-start" value="${inputDate(start.toISOString())}" required></div><div class="field event-end-field"><label for="event-end">${copy.ends}</label><input class="input" type="datetime-local" id="event-end" value="${inputDate(end.toISOString())}" required></div></div></div>
			<div id="event-lunar-fields" hidden><div class="lunar-date-grid"><div class="field"><label for="event-lunar-year">${copy.year}</label><input class="input" type="number" min="1900" max="2100" id="event-lunar-year" value="${initialLunar.year}" required></div><div class="field"><label for="event-lunar-month">${copy.month}</label><select class="input" id="event-lunar-month">${monthNames.map((name, index) => `<option value="${index + 1}" ${initialLunar.month === index + 1 ? 'selected' : ''}>${name}</option>`).join('')}</select></div><div class="field"><label for="event-lunar-day">${copy.day}</label><select class="input" id="event-lunar-day">${dayNames.map((name, index) => `<option value="${index + 1}" ${initialLunar.day === index + 1 ? 'selected' : ''}>${name}</option>`).join('')}</select></div></div><label class="checkbox-row"><input type="checkbox" id="event-lunar-leap" ${initialLunar.leap ? 'checked' : ''}> ${copy.leap}</label><div class="event-time-grid lunar-time-fields"><div class="field"><label for="event-start-time">${copy.starts}</label><input class="input" type="time" id="event-start-time" value="${timeValue(start)}" required></div><div class="field event-end-field"><label for="event-end-time">${copy.ends}</label><input class="input" type="time" id="event-end-time" value="${timeValue(end)}" required></div></div></div>
			<div class="field event-all-day-field"><label class="checkbox-row"><input type="checkbox" id="event-all-day" ${existing?.allDay ? 'checked' : ''}> ${copy.allDay}</label></div>
			<div class="birthday-repeat" id="birthday-repeat" hidden><span>${copy.repeat}</span><strong>${copy.yearly}</strong></div>
			<div class="field"><label for="event-location">${copy.location}</label><input class="input" id="event-location" value="${html(existing?.location ?? '')}"></div>
			<div class="field"><label for="event-description">${copy.description}</label><textarea class="input" id="event-description">${html(existing?.description ?? '')}</textarea></div>
			<div class="dialog-actions">${existing ? `<button type="button" class="button danger danger-zone" id="event-delete">${copy.delete}</button>` : ''}<button type="button" class="button" id="event-cancel">${copy.cancel}</button><button class="button primary">${copy.save}</button></div>
		</form>`;
		document.body.append(dialog);
		const setState = () => {
			dialog
				.querySelectorAll<HTMLElement>('[data-event-kind]')
				.forEach((button) => button.classList.toggle('active', button.dataset.eventKind === kind));
			dialog
				.querySelectorAll<HTMLElement>('[data-calendar-system]')
				.forEach((button) => button.classList.toggle('active', button.dataset.calendarSystem === calendarSystem));
			const solarFields = dialog.querySelector<HTMLElement>('#event-solar-fields')!;
			const lunarFields = dialog.querySelector<HTMLElement>('#event-lunar-fields')!;
			solarFields.hidden = calendarSystem !== 'solar';
			lunarFields.hidden = calendarSystem !== 'lunar';
			dialog.querySelectorAll<HTMLElement>('.event-end-field').forEach((field) => (field.hidden = kind === 'birthday'));
			dialog.querySelector<HTMLElement>('.event-all-day-field')!.hidden = kind === 'birthday';
			dialog.querySelector<HTMLElement>('#birthday-repeat')!.hidden = kind !== 'birthday';
			dialog.querySelector<HTMLElement>('.lunar-time-fields')!.hidden = kind === 'birthday';
			const allDay = dialog.querySelector<HTMLInputElement>('#event-all-day')!;
			if (kind === 'birthday') allDay.checked = true;
		};
		dialog.querySelectorAll<HTMLElement>('[data-event-kind]').forEach((button) =>
			button.addEventListener('click', () => {
				kind = button.dataset.eventKind as 'event' | 'birthday';
				setState();
			}),
		);
		dialog.querySelectorAll<HTMLElement>('[data-calendar-system]').forEach((button) =>
			button.addEventListener('click', () => {
				calendarSystem = button.dataset.calendarSystem as 'solar' | 'lunar';
				setState();
			}),
		);
		setState();
		const finish = (result: 'saved' | 'deleted' | null) => {
			dialog.close();
			dialog.remove();
			resolve(result);
		};
		dialog.querySelector('#event-cancel')?.addEventListener('click', () => finish(null));
		dialog.querySelector('#event-delete')?.addEventListener('click', async () => {
			if (!existing || !(await confirmAction(`${copy.delete}?`, existing.title))) return;
			try {
				await api.deleteEvent(calendar.id, existing.uid);
				finish('deleted');
			} catch (error) {
				toast(errorMessage(error));
			}
		});
		dialog.querySelector<HTMLFormElement>('#event-form')?.addEventListener('submit', async (event) => {
			event.preventDefault();
			const value = (id: string) => dialog.querySelector<HTMLInputElement>(id)!.value;
			try {
				const allDay = kind === 'birthday' || dialog.querySelector<HTMLInputElement>('#event-all-day')!.checked;
				let eventStart: Date;
				let eventEnd: Date;
				let lunarDate: CalendarEvent['lunarDate'];
				if (calendarSystem === 'lunar') {
					const year = Number(value('#event-lunar-year'));
					const month = Number(value('#event-lunar-month'));
					const day = Number(value('#event-lunar-day'));
					const leap = dialog.querySelector<HTMLInputElement>('#event-lunar-leap')!.checked;
					let solar;
					try {
						solar = Lunar.fromYmd(year, leap ? -month : month, day).getSolar();
					} catch {
						toast(copy.invalidLunar);
						return;
					}
					const [startHour, startMinute] = (kind === 'birthday' ? '00:00' : value('#event-start-time'))
						.split(':')
						.map(Number);
					const [endHour, endMinute] = (kind === 'birthday' ? '00:00' : value('#event-end-time'))
						.split(':')
						.map(Number);
					eventStart = new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay(), startHour, startMinute);
					eventEnd = new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay(), endHour, endMinute);
					if (allDay || eventEnd <= eventStart) eventEnd.setDate(eventEnd.getDate() + 1);
					lunarDate = { year, month, day, leap };
				} else {
					eventStart = new Date(value('#event-start'));
					eventEnd = kind === 'birthday' ? new Date(eventStart) : new Date(value('#event-end'));
					if (allDay) {
						eventStart.setHours(0, 0, 0, 0);
						eventEnd = new Date(eventStart);
						eventEnd.setDate(eventEnd.getDate() + 1);
					}
				}
				await api.putEvent(calendar.id, {
					uid: existing?.uid,
					title: value('#event-title'),
					start: eventStart.toISOString(),
					end: eventEnd.toISOString(),
					allDay,
					location: value('#event-location'),
					description: dialog.querySelector<HTMLTextAreaElement>('#event-description')!.value,
					kind,
					calendarSystem,
					recurrence: kind === 'birthday' ? 'yearly' : undefined,
					lunarDate,
				});
				finish('saved');
			} catch (error) {
				toast(errorMessage(error));
			}
		});
		dialog.addEventListener('cancel', () => finish(null), { once: true });
		dialog.showModal();
		dialog.querySelector<HTMLInputElement>('#event-title')?.focus();
	});
}

function paintCalendarGrid(calendar: CalendarSummary, gridStart: Date): void {
	const grid = document.querySelector<HTMLDivElement>('#month-grid');
	if (!grid) return;
	const today = localDateKey(new Date());
	const events = [...calendarCache.events.values()];
	const cells: string[] = [];
	for (let offset = 0; offset < 42; offset += 1) {
		const date = new Date(gridStart);
		date.setDate(gridStart.getDate() + offset);
		const key = localDateKey(date);
		const lunar = lunarDate(date);
		const dayEvents = events.filter((item) => localDateKey(new Date(item.start)) === key);
		cells.push(
			`<div class="day-cell ${date.getMonth() !== calendarCursor.getMonth() ? 'outside' : ''} ${key === today ? 'today' : ''}" data-day="${key}"><div class="day-meta" title="${html(lunar.full)}"><span class="day-number">${date.getDate()}</span><span class="lunar-day">${html(lunar.short)}</span></div>${dayEvents.map((item) => `<button class="event-chip ${item.kind === 'birthday' ? 'birthday' : ''}" data-event="${html(eventCacheKey(item))}" title="${html(item.title)}">${item.allDay ? '' : `${new Date(item.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} `}${html(item.title)}</button>`).join('')}</div>`,
		);
	}
	grid.innerHTML = cells.join('');
	grid.querySelectorAll<HTMLElement>('[data-day]').forEach((cell) =>
		cell.addEventListener('dblclick', async (event) => {
			if ((event.target as HTMLElement).closest('[data-event]')) return;
			if (await eventDialog(calendar, undefined, new Date(`${cell.dataset.day}T00:00:00`))) {
				invalidateCalendarCache();
				await renderCalendar(true);
			}
		}),
	);
	grid.querySelectorAll<HTMLElement>('[data-event]').forEach((item) =>
		item.addEventListener('click', async () => {
			const event = calendarCache.events.get(item.dataset.event!);
			if (event && (await eventDialog(calendar, event))) {
				invalidateCalendarCache();
				await renderCalendar(true);
			}
		}),
	);
}

async function renderCalendar(forceSync = false): Promise<void> {
	if (!document.querySelector('#calendar-view')) shell('calendar', t('calendar'));
	const content = document.querySelector<HTMLDivElement>('#page-content')!;
	try {
		calendarCache.calendars ??= await api.calendars();
		if (calendarCache.calendars.length === 0) {
			content.innerHTML = `<div class="empty-state"><div>${locale === 'zh' ? '没有日历' : 'No calendars'}</div></div>`;
			return;
		}
		const calendar = calendarCache.calendars[0];
		if (!content.querySelector('#calendar-view')) {
			content.innerHTML = `<div class="calendar-toolbar"><button class="button icon-button" id="cal-prev"><i data-lucide="chevron-left"></i></button><button class="button" id="cal-today">${locale === 'zh' ? '今天' : 'Today'}</button><button class="button icon-button" id="cal-next"><i data-lucide="chevron-right"></i></button><h2 id="calendar-title"></h2><span class="sync-status" id="calendar-sync"><span class="status-dot"></span>${locale === 'zh' ? '已缓存' : 'Cached'}</span><span class="toolbar-spacer"></span><button class="button icon-button" id="cal-refresh"><i data-lucide="refresh-cw"></i></button></div><div class="calendar" id="calendar-view"><div class="weekday-row">${(locale === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map((day) => `<div class="weekday">${day}</div>`).join('')}</div><div class="month-grid" id="month-grid"></div></div><button class="button primary floating-primary-action" id="new-event" title="${locale === 'zh' ? '新建日程' : 'New event'}" aria-label="${locale === 'zh' ? '新建日程' : 'New event'}"><i data-lucide="plus"></i><span>${locale === 'zh' ? '新建日程' : 'New event'}</span></button>`;
			content.querySelector('#cal-prev')?.addEventListener('click', () => {
				calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
				void renderCalendar();
			});
			content.querySelector('#cal-next')?.addEventListener('click', () => {
				calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
				void renderCalendar();
			});
			content.querySelector('#cal-today')?.addEventListener('click', () => {
				const today = new Date();
				calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
				void renderCalendar();
			});
			content.querySelector('#cal-refresh')?.addEventListener('click', () => {
				invalidateCalendarCache();
				void renderCalendar(true);
			});
			content.querySelector('#new-event')?.addEventListener('click', async () => {
				if (await eventDialog(calendar)) {
					invalidateCalendarCache();
					await renderCalendar(true);
				}
			});
			refreshIcons();
		}

		const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
		const gridStart = new Date(first);
		gridStart.setDate(1 - first.getDay());
		const gridEnd = new Date(gridStart);
		gridEnd.setDate(gridEnd.getDate() + 42);
		const visibleRange = { from: gridStart.getTime(), to: gridEnd.getTime() };
		document.querySelector('#calendar-title')!.textContent = calendarCursor.toLocaleDateString([], {
			month: 'long',
			year: 'numeric',
		});
		paintCalendarGrid(calendar, gridStart);

		const ranges = forceSync ? [visibleRange] : missingRanges(calendarValidatedRanges, visibleRange);
		const syncStatus = document.querySelector<HTMLSpanElement>('#calendar-sync')!;
		if (ranges.length === 0) {
			syncStatus.innerHTML = '<span class="status-dot"></span>Cached';
			return;
		}
		const requestId = ++calendarRequest;
		syncStatus.classList.add('syncing');
		syncStatus.innerHTML = '<span class="status-dot"></span>Syncing';
		const responses = await Promise.all(
			ranges.map((range) =>
				api.events(calendar.id, new Date(range.from).toISOString(), new Date(range.to).toISOString()),
			),
		);
		if (forceSync) {
			for (const [uid, event] of calendarCache.events) {
				if (Date.parse(event.end) > visibleRange.from && Date.parse(event.start) < visibleRange.to)
					calendarCache.events.delete(uid);
			}
		}
		responses.flat().forEach((event) => calendarCache.events.set(eventCacheKey(event), event));
		ranges.forEach(mergeLoadedRange);
		persistCalendarCache();
		if (requestId !== calendarRequest || pageFromPath() !== 'calendar') return;
		paintCalendarGrid(calendar, gridStart);
		syncStatus.classList.remove('syncing');
		syncStatus.innerHTML = '<span class="status-dot"></span>Up to date';
	} catch (error) {
		const syncStatus = document.querySelector<HTMLSpanElement>('#calendar-sync');
		if (syncStatus) {
			syncStatus.classList.remove('syncing');
			syncStatus.textContent = 'Sync failed';
			toast(errorMessage(error));
		} else content.innerHTML = `<div class="error-banner">${html(errorMessage(error))}</div>`;
	}
}

type NotesView = 'active' | 'bookmarks' | 'archived';
let notesView: NotesView = 'active';
let notesArchived = false;
let notesData: NotePage | null = null;
let notesLoadingMore = false;
let notesRequest = 0;
let noteFolders: NoteFolder[] = [];
let noteFoldersLoaded = false;
let selectedNoteFolderId: string | null | undefined;
let mobileNoteDialogOpen = false;
let flushMobileNote: (() => Promise<void>) | null = null;
let mobileNoteId: string | undefined;
let bookmarkHub: BookmarkHub | null = null;
let bookmarkChecked = localStorage.getItem('r2_bookmarks_checked') === '1';

function readBookmarkCache(): BookmarkHub | null {
	try {
		return JSON.parse(localStorage.getItem('r2_bookmarks_cache') ?? 'null') as BookmarkHub | null;
	} catch {
		return null;
	}
}

bookmarkHub = readBookmarkCache();

function cacheBookmarks(value: BookmarkHub | null): void {
	bookmarkHub = value;
	bookmarkChecked = true;
	localStorage.setItem('r2_bookmarks_checked', '1');
	if (value) localStorage.setItem('r2_bookmarks_cache', JSON.stringify(value));
	else localStorage.removeItem('r2_bookmarks_cache');
	const nav = document.querySelector<HTMLElement>('[data-route="/notes"]');
	const label = value ? (locale === 'zh' ? '收藏空间' : 'Collection') : t('notes');
	if (nav) {
		nav.title = label;
		const text = nav.querySelector('span');
		if (text) text.textContent = label;
	}
}

async function pullBookmarks(force = false): Promise<void> {
	if (!force && bookmarkChecked) return;
	try {
		cacheBookmarks(await api.bookmarks());
	} catch (error) {
		if (force) toast(errorMessage(error));
	}
}

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
const bookmarkExpandedFolders = new Set<string>();

function bookmarkFolderTree(): BookmarkFolder {
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

function bookmarkCardMarkup(card: BookmarkCard): string {
	let favicon = '';
	try { favicon = new URL('/favicon.ico', card.url).href; } catch { /* The card URL was already validated. */ }
	return `<a class="bookmark-card" href="${html(card.url)}" target="_blank" rel="noopener noreferrer" title="${html(card.title || card.url)}">
		<div class="bookmark-card-body">${card.title ? `<h3>${html(card.title)}</h3>` : ''}<div class="bookmark-link"><span class="bookmark-favicon"><span data-bookmark-fallback>${html(card.domain.slice(0, 1).toUpperCase())}</span>${favicon ? `<img data-bookmark-icon src="${html(favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer" hidden>` : ''}</span><p>${html(card.url)}</p></div><div class="bookmark-card-meta"><small>${html(card.path.filter(Boolean).join(' / '))}</small><time>${card.dateModified ? new Date(card.dateModified).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en') : ''}</time></div></div>
	</a>`;
}

function bookmarkPathMarkup(path: string[]): string {
	const rootLabel = locale === 'zh' ? '全部链接' : 'All links';
	const crumbs = [`<button class="bookmark-path-item" data-bookmark-path="">${rootLabel}</button>`];
	path.forEach((name, index) => {
		const target = path.slice(0, index + 1).join('\u001f');
		crumbs.push('<span class="bookmark-path-separator" aria-hidden="true">/</span>');
		crumbs.push(
			`<button class="bookmark-path-item ${index === path.length - 1 ? 'current' : ''}" data-bookmark-path="${html(target)}">${html(name)}</button>`,
		);
	});
	return `<nav class="bookmark-path" aria-label="${locale === 'zh' ? '当前收藏路径' : 'Current collection path'}">${crumbs.join('')}</nav>`;
}

function bookmarkFolderOptions(root: BookmarkFolder): BookmarkFolder[] {
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

function bookmarkFolderTreeMarkup(root: BookmarkFolder, selectedKey: string): string {
	const renderFolders = (folders: BookmarkFolder[], depth: number): string =>
		folders
			.map((folder) => {
				const active = folder.key === selectedKey;
				const expanded = bookmarkExpandedFolders.has(folder.key) || active;
				return `<div class="bookmark-tree-node ${expanded ? 'expanded' : ''}" style="--bookmark-depth:${depth}"><button class="bookmark-folder ${active ? 'active' : ''}" data-bookmark-folder="${html(folder.key)}"><span class="tree-caret" aria-hidden="true">&gt;</span><span>${html(folder.name)}</span><small>${folder.links.length}</small></button>${expanded && folder.folders.length ? `<div class="bookmark-tree-children">${renderFolders(folder.folders, depth + 1)}</div>` : ''}</div>`;
			})
			.join('');

	return renderFolders(root.folders, 0);
}

function noteFolderCachePart(folderId = selectedNoteFolderId): string {
	return folderId === undefined ? 'all' : folderId === null ? 'root' : encodeURIComponent(folderId);
}

function noteCacheKey(archived = notesArchived, folderId = selectedNoteFolderId): string {
	return `r2_notes_v3_${archived ? 'archived' : 'active'}_${noteFolderCachePart(folderId)}`;
}

function cacheNotes(data: NotePage, archived = notesArchived, folderId = selectedNoteFolderId): void {
	localStorage.setItem(noteCacheKey(archived, folderId), JSON.stringify(data));
}

function invalidateNoteCaches(): void {
	for (let index = localStorage.length - 1; index >= 0; index -= 1) {
		const key = localStorage.key(index);
		if (key?.startsWith('r2_notes_v3_')) localStorage.removeItem(key);
	}
	validatedNotePages.clear();
}

function cachedNotes(): NotePage | null {
	try {
		return JSON.parse(localStorage.getItem(noteCacheKey()) ?? 'null') as NotePage | null;
	} catch {
		return null;
	}
}

async function loadNoteFolders(force = false): Promise<void> {
	if (noteFoldersLoaded && !force) return;
	try {
		noteFolders = await api.noteFolders();
		noteFoldersLoaded = true;
		if (selectedNoteFolderId && !noteFolders.some((folder) => folder.id === selectedNoteFolderId)) selectedNoteFolderId = undefined;
	} catch (error) {
		if (force) toast(errorMessage(error));
	}
}

interface MarkdownHeading {
	id: string;
	level: number;
	text: string;
}

function renderMarkdownDocument(value: string): { html: string; headings: MarkdownHeading[] } {
	const parsed = marked.parse(value, { async: false, breaks: true, gfm: true });
	const sanitized = DOMPurify.sanitize(parsed, {
		ADD_ATTR: ['target'],
		ALLOW_DATA_ATTR: false,
	});
	const documentNode = new DOMParser().parseFromString(`<body>${sanitized}</body>`, 'text/html');
	const headings: MarkdownHeading[] = [];
	const usedIds = new Set<string>();
	documentNode.body.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6').forEach((heading) => {
		const level = Number(heading.tagName.slice(1));
		const base = heading.textContent?.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-') .replace(/^-|-$/g, '') || 'section';
		let id = base;
		let suffix = 2;
		while (usedIds.has(id)) id = `${base}-${suffix++}`;
		usedIds.add(id);
		heading.id = id;
		headings.push({ id, level, text: heading.textContent?.trim() ?? id });
	});
	documentNode.body.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
		anchor.target = '_blank';
		anchor.rel = 'noopener noreferrer';
	});
	return { html: documentNode.body.innerHTML, headings };
}

function renderMarkdown(value: string): string {
	return renderMarkdownDocument(value).html;
}

function noteFolderSelectMarkup(selectedFolderId: string | null | undefined): string {
	return `<select class="note-folder-select" data-note-folder-select aria-label="${locale === 'zh' ? '便签目录' : 'Note folder'}"><option value="" ${selectedFolderId ? '' : 'selected'}>${locale === 'zh' ? '未分类' : 'Unfiled'}</option>${noteFolders.map((folder) => `<option value="${html(folder.id)}" ${selectedFolderId === folder.id ? 'selected' : ''}>${html(folder.name)}</option>`).join('')}</select>`;
}

function noteLocationMarkup(note: Note): string {
	const folder = note.folderId
		? noteFolders.find((item) => item.id === note.folderId)?.name
		: locale === 'zh'
			? '未分类'
			: 'Unfiled';
	const parts = [folder, note.title].filter((part): part is string => Boolean(part?.trim()));
	return `<div class="note-location" title="${html(parts.join(' / '))}">${parts.map((part, index) => `${index ? '<span aria-hidden="true">/</span>' : ''}<span>${html(part)}</span>`).join('')}</div>`;
}

function noteEditorMarkup(selected: Note, mobile = false): string {
	return `<section class="note-editor ${mobile ? 'note-editor-mobile' : 'note-editor-desktop'}">
		<form data-note-form>
			<div class="note-editor-head">${mobile ? `<button type="button" class="row-action note-mobile-back" data-note-close title="${locale === 'zh' ? '返回' : 'Back'}" aria-label="${locale === 'zh' ? '返回' : 'Back'}"><i data-lucide="chevron-left"></i></button>` : ''}<div class="note-heading"><div class="note-location-wrap">${noteLocationMarkup(selected)}</div><input data-note-title value="${html(selected.title)}" aria-label="Title"></div><span class="note-save-status" data-note-save-status aria-live="polite"></span>${noteFolderSelectMarkup(selected.folderId)}<time>${new Date(selected.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}</time><div class="note-actions">
				<button type="button" class="row-action note-mode active" data-note-mode="preview" title="${t('preview')}" aria-label="${t('preview')}"><i data-lucide="eye"></i></button>
				<button type="button" class="row-action note-mode" data-note-mode="edit" title="${locale === 'zh' ? '编辑' : 'Edit'}" aria-label="${locale === 'zh' ? '编辑' : 'Edit'}"><i data-lucide="pencil"></i></button>
				<button type="button" class="row-action" data-note-export title="${locale === 'zh' ? '导出 Markdown' : 'Export Markdown'}" aria-label="${locale === 'zh' ? '导出 Markdown' : 'Export Markdown'}"><i data-lucide="file-down"></i></button>
				<button type="button" class="row-action" data-note-pin title="${selected.pinned ? t('unpin') : t('pin')}"><i data-lucide="${selected.pinned ? 'pin-off' : 'pin'}"></i></button>
				<button type="button" class="row-action" data-note-archive title="${selected.archived ? t('restore') : t('archive')}"><i data-lucide="archive"></i></button>
				<button type="button" class="row-action danger" data-note-delete title="${t('delete')}"><i data-lucide="trash-2"></i></button>
			</div></div>
			<div class="note-compose previewing" data-note-compose><div class="note-document"><textarea class="note-source" data-note-source spellcheck="true" aria-label="${t('markdown')}">${html(selected.content)}</textarea><article class="note-render" data-note-render aria-label="${t('preview')}" title="${locale === 'zh' ? '点击进入编辑' : 'Click to edit'}"></article></div><aside class="note-outline" data-note-outline aria-label="${locale === 'zh' ? '章节位置' : 'Section positions'}"></aside></div>
		</form>
	</section>`;
}

function bindNoteEditor(root: HTMLElement, data: NotePage, selected: Note, mobile: boolean): void {
	const compose = root.querySelector<HTMLDivElement>('[data-note-compose]')!;
	const noteRender = root.querySelector<HTMLElement>('[data-note-render]')!;
	const source = root.querySelector<HTMLTextAreaElement>('[data-note-source]')!;
	const outline = root.querySelector<HTMLElement>('[data-note-outline]')!;
	let draftContent = selected.content.replaceAll('\r', '');
	const title = root.querySelector<HTMLInputElement>('[data-note-title]')!;
	const status = root.querySelector<HTMLElement>('[data-note-save-status]');
	const AUTOSAVE_IDLE_DELAY = 2_500;
	const AUTOSAVE_EDITING_INTERVAL = 8_000;
	let idleSaveTimer = 0;
	let slowSaveTimer = 0;
	let lastSavedAt = 0;
	let pending: Partial<Pick<Note, 'title' | 'content'>> | null = null;
	let activeSave: Promise<boolean> | null = null;
	const paintSaveStatus = (value: string) => {
		if (status) status.textContent = value;
	};
	const savePending = (): Promise<boolean> => {
		window.clearTimeout(idleSaveTimer);
		window.clearTimeout(slowSaveTimer);
		if (activeSave) return activeSave;
		if (!pending) return Promise.resolve(true);
		const changes = pending;
		pending = null;
		paintSaveStatus(locale === 'zh' ? '同步中…' : 'Syncing…');
		activeSave = (async () => {
			try {
				const updated = await api.updateNote(selected.id, changes);
				Object.assign(selected, updated);
				const index = data.items.findIndex((note) => note.id === updated.id);
				if (index >= 0) data.items[index] = updated;
				invalidateNoteCaches();
				cacheNotes(data);
				lastSavedAt = Date.now();
				paintSaveStatus(locale === 'zh' ? '已同步' : 'Synced');
				const time = root.querySelector<HTMLTimeElement>('.note-editor-head > time');
				if (time) time.textContent = new Date(updated.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en');
				return true;
			} catch (error) {
				pending = { ...changes, ...(pending ?? {}) };
				paintSaveStatus(locale === 'zh' ? '同步失败' : 'Sync failed');
				toast(errorMessage(error));
				return false;
			} finally {
				activeSave = null;
				if (pending) scheduleAutosave();
			}
		})();
		return activeSave;
	};
	const scheduleAutosave = () => {
		window.clearTimeout(idleSaveTimer);
		if (!pending) return;
		idleSaveTimer = window.setTimeout(() => void savePending(), AUTOSAVE_IDLE_DELAY);
		if (!slowSaveTimer) {
			slowSaveTimer = window.setTimeout(() => {
				slowSaveTimer = 0;
				void savePending();
			}, AUTOSAVE_EDITING_INTERVAL);
		}
	};
	const flushPending = async (): Promise<void> => {
		window.clearTimeout(idleSaveTimer);
		window.clearTimeout(slowSaveTimer);
		while (activeSave || pending) {
			const saved = await (activeSave ?? savePending());
			window.clearTimeout(idleSaveTimer);
			window.clearTimeout(slowSaveTimer);
			if (!saved) break;
		}
	};
	const queueSave = (changes: Partial<Pick<Note, 'title' | 'content'>>) => {
		pending = { ...pending, ...changes };
		paintSaveStatus(locale === 'zh' ? '等待同步' : 'Pending');
		scheduleAutosave();
	};
	title.addEventListener('input', () => {
		const locationTitle = root.querySelector<HTMLElement>('.note-location span:last-child');
		if (locationTitle) locationTitle.textContent = title.value || (locale === 'zh' ? '无标题便签' : 'Untitled note');
		queueSave({ title: title.value });
	});
	const paintPreview = () => {
		const rendered = renderMarkdownDocument(draftContent);
		noteRender.innerHTML = rendered.html || `<p class="muted">${locale === 'zh' ? '空便签' : 'Empty note'}</p>`;
		outline.innerHTML = rendered.headings.length
			? rendered.headings.map((heading) => `<button type="button" data-outline-target="${html(heading.id)}" aria-label="${html(heading.text)}" title="${html(heading.text)}" style="--outline-level:${heading.level}"><span></span></button>`).join('')
			: '';
		outline.classList.toggle('empty', rendered.headings.length === 0);
		outline.querySelectorAll<HTMLElement>('[data-outline-target]').forEach((button) => button.addEventListener('click', () => {
			noteRender.querySelector(`#${CSS.escape(button.dataset.outlineTarget!)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}));
		updateOutlineActive();
	};
	const updateOutlineActive = () => {
		const headings = [...noteRender.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
		let active = headings[0];
		for (const heading of headings) {
			if (heading.offsetTop - noteRender.scrollTop <= 72) active = heading;
		}
		outline.querySelectorAll<HTMLElement>('[data-outline-target]').forEach((button) => button.classList.toggle('active', button.dataset.outlineTarget === active?.id));
	};
	const setMode = (mode: 'edit' | 'preview') => {
		compose.classList.toggle('previewing', mode === 'preview');
		root.querySelectorAll<HTMLElement>('[data-note-mode]').forEach((button) => button.classList.toggle('active', button.dataset.noteMode === mode));
		if (mode === 'preview') paintPreview();
		else source.focus();
	};
	root.querySelectorAll<HTMLElement>('[data-note-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.noteMode as 'edit' | 'preview')));
	noteRender.addEventListener('click', (event) => {
		if ((event.target as HTMLElement).closest('a')) return;
		setMode('edit');
	});
	noteRender.addEventListener('scroll', updateOutlineActive, { passive: true });
	source.addEventListener('input', () => {
		draftContent = source.value.replaceAll('\r', '');
		queueSave({ content: draftContent });
	});
	source.addEventListener('paste', (event) => {
		const images = event.clipboardData ? [...event.clipboardData.files].filter((file) => file.type.startsWith('image/')) : [];
		if (!images.length) return;
		event.preventDefault();
		const image = images[0];
		if (image.size > 256 * 1024) {
			toast(locale === 'zh' ? '图片超过 256 KB，暂不允许粘贴' : 'Images over 256 KB cannot be pasted yet');
			return;
		}
		const reader = new FileReader();
		reader.addEventListener('load', () => {
			const start = source.selectionStart;
			const markdownImage = `![${image.name || (locale === 'zh' ? '图片' : 'image')}](${String(reader.result)})`;
			source.setRangeText(markdownImage, start, source.selectionEnd, 'end');
			source.dispatchEvent(new Event('input', { bubbles: true }));
		});
		reader.readAsDataURL(image);
	});
	root.querySelector('[data-note-export]')?.addEventListener('click', () => {
		const objectUrl = URL.createObjectURL(new Blob([draftContent], { type: 'text/markdown;charset=utf-8' }));
		const anchor = document.createElement('a');
		anchor.href = objectUrl;
		anchor.download = `${(title.value.trim() || 'note').replace(/[\\/:*?"<>|]/g, '_')}.md`;
		anchor.click();
		URL.revokeObjectURL(objectUrl);
	});
	paintPreview();
	const update = async (changes: Partial<Pick<Note, 'title' | 'content' | 'pinned' | 'archived' | 'folderId'>>) => {
		try {
			const updated = await api.updateNote(selected.id, changes);
			const index = data.items.findIndex((note) => note.id === updated.id);
			const leftCurrentFolder = selectedNoteFolderId !== undefined && updated.folderId !== selectedNoteFolderId;
			if (index >= 0 && (updated.archived !== notesArchived || leftCurrentFolder)) {
				data.items.splice(index, 1);
				data.total = Math.max(0, data.total - 1);
			} else if (index >= 0) data.items[index] = updated;
			invalidateNoteCaches();
			if (changes.folderId !== undefined || changes.archived !== undefined) await loadNoteFolders(true);
			cacheNotes(data);
			paintNotes(
				data,
				updated.archived === notesArchived ? updated.id : undefined,
				mobile && updated.archived === notesArchived,
			);
		} catch (error) {
			toast(errorMessage(error));
		}
	};
	root.querySelector<HTMLSelectElement>('[data-note-folder-select]')?.addEventListener('change', (event) => {
		const folderId = (event.target as HTMLSelectElement).value || null;
		void update({ folderId });
	});
	root
		.querySelector<HTMLFormElement>('[data-note-form]')
		?.addEventListener('submit', (event) => event.preventDefault());
	root.querySelector('[data-note-pin]')?.addEventListener('click', () => void update({ pinned: !selected.pinned }));
	root
		.querySelector('[data-note-archive]')
		?.addEventListener('click', () => void update({ archived: !selected.archived }));
	root.querySelector('[data-note-delete]')?.addEventListener('click', async () => {
		if (!(await confirmAction(`${t('delete')}?`, selected.title, t('delete')))) return;
		try {
			await api.deleteNote(selected.id);
			validatedNotePages.delete(noteCacheKey());
			await renderNotes(undefined, true);
		} catch (error) {
			toast(errorMessage(error));
		}
	});
	root.querySelector('[data-note-close]')?.addEventListener('click', () => {
		if (mobileNoteDialogOpen) history.back();
		else
			void flushPending().then(() => {
				root.closest('dialog')?.close();
				paintNotes(data, selected.id);
			});
	});
	if (mobile) {
		flushMobileNote = flushPending;
		mobileNoteId = selected.id;
	}
}

function notesTabsMarkup(): string {
	return `<div class="segment-control" role="tablist"><button class="${notesView === 'active' ? 'active' : ''}" data-note-view="active">${t('active')}</button>${bookmarkHub ? `<button class="${notesView === 'bookmarks' ? 'active' : ''}" data-note-view="bookmarks">${t('bookmarks')}</button>` : ''}</div>`;
}

function noteCardMarkup(note: Note, selected?: Note): string {
	return `<article class="note-card ${note.id === selected?.id ? 'active' : ''}" draggable="true" data-note-card-id="${html(note.id)}"><button class="note-card-open" data-note="${html(note.id)}">
		<div class="note-card-title">${note.pinned ? '<i data-lucide="pin"></i>' : ''}<strong>${html(note.title)}</strong></div>
	</button>
		<div class="note-card-actions">
			<button class="row-action" data-note-card-pin="${html(note.id)}" title="${note.pinned ? t('unpin') : t('pin')}" aria-label="${note.pinned ? t('unpin') : t('pin')}"><i data-lucide="${note.pinned ? 'pin-off' : 'pin'}"></i></button>
			<button class="row-action" data-note-card-archive="${html(note.id)}" title="${note.archived ? t('restore') : t('archive')}" aria-label="${note.archived ? t('restore') : t('archive')}"><i data-lucide="archive"></i></button>
		</div>
	</article>`;
}

function notesFolderSidebarMarkup(data: NotePage, selected?: Note): string {
	const active = (folderId: string | null | undefined) =>
		notesView === 'active' && ((folderId === undefined && selectedNoteFolderId === undefined) || folderId === selectedNoteFolderId) ? 'active' : '';
	const notesFor = (folderId: string | null) => data.items.filter((note) => (note.folderId ?? null) === folderId);
	const noteChildren = (items: Note[]) => items.length ? `<div class="notes-tree-children">${items.map((note) => noteCardMarkup(note, selected)).join('')}</div>` : '';
	const folderRow = (folder: NoteFolder) => {
		const expanded = notesView === 'active' && (selectedNoteFolderId === undefined || selectedNoteFolderId === folder.id);
		return `<div class="note-folder-card ${active(folder.id)} ${expanded ? 'expanded' : ''}" data-note-folder-drop="${html(folder.id)}"><button type="button" data-note-folder-filter="${html(folder.id)}"><span class="tree-caret" aria-hidden="true">&gt;</span><span>${html(folder.name)}</span><small>${folder.noteCount}</small></button><div class="note-folder-actions"><button class="row-action" data-rename-note-folder="${html(folder.id)}" title="${locale === 'zh' ? '重命名' : 'Rename'}" aria-label="${locale === 'zh' ? '重命名' : 'Rename'}"><i data-lucide="pencil"></i></button><button class="row-action danger" data-delete-note-folder="${html(folder.id)}" title="${t('delete')}" aria-label="${t('delete')}"><i data-lucide="trash-2"></i></button></div>${expanded ? noteChildren(notesFor(folder.id)) : ''}</div>`;
	};
	const rootNotes = notesFor(null);
	return `<aside class="notes-folders" aria-label="${locale === 'zh' ? '便签目录' : 'Note folders'}">
		<div class="notes-folders-head"><strong>${locale === 'zh' ? '便签目录' : 'Folders'}</strong><button class="row-action" data-new-note-folder title="${locale === 'zh' ? '新建目录' : 'New folder'}" aria-label="${locale === 'zh' ? '新建目录' : 'New folder'}"><i data-lucide="folder-plus"></i></button></div>
		<div class="notes-tree" data-notes-tree>
			<div class="note-tree-special ${active(undefined)}" data-note-folder-drop="all"><button type="button" data-note-folder-filter="all"><i data-lucide="sticky-note"></i><span>${locale === 'zh' ? '全部便签' : 'All notes'}</span><small>${selectedNoteFolderId === undefined && notesView === 'active' ? data.total : ''}</small></button></div>
			<div class="note-tree-special ${notesView === 'active' && selectedNoteFolderId === null ? 'active' : ''} ${notesView === 'active' && (selectedNoteFolderId === undefined || selectedNoteFolderId === null) ? 'expanded' : ''}" data-note-folder-drop="root"><button type="button" data-note-folder-filter="root"><span class="tree-caret" aria-hidden="true">&gt;</span><span>${locale === 'zh' ? '未分类' : 'Unfiled'}</span><small>${rootNotes.length || ''}</small></button>${notesView === 'active' && (selectedNoteFolderId === undefined || selectedNoteFolderId === null) ? noteChildren(rootNotes) : ''}</div>
			${noteFolders.map(folderRow).join('')}
			<div class="note-tree-special archive-tree-item ${notesView === 'archived' ? 'active' : ''}" data-note-folder-drop="archive"><button type="button" data-note-archived><i data-lucide="archive"></i><span>${t('archived')}</span><small>${notesView === 'archived' ? data.total : ''}</small></button>${notesView === 'archived' ? noteChildren(data.items) : ''}</div>
		</div>
		<button class="button primary floating-primary-action" id="new-note" title="${t('newNote')}" aria-label="${t('newNote')}"><i data-lucide="plus"></i><span>${t('newNote')}</span></button>
		<div class="notes-load-status" aria-live="polite">${notesLoadingMore ? loadingMarkup(true) : ''}</div>
	</aside>`;
}

function bindNotesFolders(content: HTMLElement, data: NotePage): void {
	const selectFolder = (value: string) => {
		notesView = 'active';
		notesArchived = false;
		selectedNoteFolderId = value === 'all' ? undefined : value === 'root' ? null : value;
		notesData = null;
		void renderNotes(undefined, false);
	};
	content.querySelectorAll<HTMLElement>('[data-note-folder-filter]').forEach((button) => button.addEventListener('click', () => selectFolder(button.dataset.noteFolderFilter ?? 'all')));
	content.querySelector('[data-new-note-folder]')?.addEventListener('click', async () => {
		const name = await openTextDialog(locale === 'zh' ? '新建便签目录' : 'New note folder', locale === 'zh' ? '目录名称' : 'Folder name');
		if (!name) return;
		try {
			const created = await api.createNoteFolder(name);
			noteFolders.push(created);
			selectedNoteFolderId = created.id;
			validatedNotePages.delete(noteCacheKey());
			await renderNotes(undefined, true);
		} catch (error) { toast(errorMessage(error)); }
	});
	content.querySelectorAll<HTMLElement>('[data-rename-note-folder]').forEach((button) => button.addEventListener('click', async (event) => {
		event.stopPropagation();
		const folder = noteFolders.find((item) => item.id === button.dataset.renameNoteFolder);
		if (!folder) return;
		const name = await openTextDialog(locale === 'zh' ? '重命名便签目录' : 'Rename note folder', locale === 'zh' ? '目录名称' : 'Folder name', folder.name);
		if (!name || name === folder.name) return;
		try {
			const updated = await api.updateNoteFolder(folder.id, name);
			Object.assign(folder, updated);
			paintNotes(data, data.items[0]?.id);
		} catch (error) { toast(errorMessage(error)); }
	}));
	content.querySelectorAll<HTMLElement>('[data-delete-note-folder]').forEach((button) => button.addEventListener('click', async (event) => {
		event.stopPropagation();
		const folder = noteFolders.find((item) => item.id === button.dataset.deleteNoteFolder);
		if (!folder || !(await confirmAction(locale === 'zh' ? '删除便签目录？' : 'Delete note folder?', locale === 'zh' ? '目录中的便签会移到未分类，不会被删除。' : 'Notes in this folder will move to Unfiled and will not be deleted.', t('delete')))) return;
		try {
			await api.deleteNoteFolder(folder.id);
			noteFolders = noteFolders.filter((item) => item.id !== folder.id);
			if (selectedNoteFolderId === folder.id) selectedNoteFolderId = undefined;
			await renderNotes(undefined, true);
		} catch (error) { toast(errorMessage(error)); }
	}));
	content.querySelectorAll<HTMLElement>('[data-note-folder-drop]').forEach((target) => {
		target.addEventListener('dragover', (event) => { event.preventDefault(); target.classList.add('drag-over'); });
		target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
		target.addEventListener('drop', async (event) => {
			event.preventDefault();
			target.classList.remove('drag-over');
			const noteId = event.dataTransfer?.getData('text/x-truespace-note');
			if (!noteId || target.dataset.noteFolderDrop === 'all') return;
			const archive = target.dataset.noteFolderDrop === 'archive';
			const folderId = target.dataset.noteFolderDrop === 'root' ? null : archive ? undefined : target.dataset.noteFolderDrop;
			try {
				await api.updateNote(noteId, archive ? { archived: true } : { folderId });
				await loadNoteFolders(true);
				validatedNotePages.delete(noteCacheKey());
				await renderNotes(undefined, true);
			} catch (error) { toast(errorMessage(error)); }
		});
	});
}

function paintBookmarkView(): void {
	const content = document.querySelector<HTMLDivElement>('#page-content');
	if (!content) return;
	const root = bookmarkFolderTree();
	let folder = root;
	for (const name of bookmarkFolderPath) folder = folder.folders.find((item) => item.name === name) ?? root;
	if (folder === root && bookmarkFolderPath.length) bookmarkFolderPath = [];
	while (folder.links.length === 0 && folder.folders.length === 1) {
		folder = folder.folders[0];
		bookmarkFolderPath = folder.path;
	}
	const cards = folder.links;
	const selectedFolderKey = bookmarkFolderPath.join('\u001f');
	const folderOptions = bookmarkFolderOptions(root)
		.map(
			(item) =>
				`<option value="${html(item.key)}" ${item.path.join('\u001f') === bookmarkFolderPath.join('\u001f') ? 'selected' : ''}>${html(item.path.length ? item.path.join(' / ') : item.name)}</option>`,
		)
		.join('');
	const folderTree = bookmarkFolderTreeMarkup(root, selectedFolderKey);
	content.innerHTML = `<div class="notes-layout bookmark-layout">
		<div class="notes-inner-toolbar">${notesTabsMarkup()}<div class="bookmark-folder-select-wrap"><select class="input bookmark-folder-select" aria-label="${locale === 'zh' ? '选择收藏目录' : 'Choose collection folder'}">${folderOptions}</select></div><span class="toolbar-spacer"></span><span class="note-count">${cards.length}</span><button class="button icon-button" id="notes-refresh" title="${locale === 'zh' ? '拉取书签' : 'Pull bookmarks'}" aria-label="${locale === 'zh' ? '拉取书签' : 'Pull bookmarks'}"><i data-lucide="refresh-cw"></i></button></div>
		<aside class="bookmark-folders"><div class="bookmark-folders-head"><strong>${locale === 'zh' ? '收藏目录' : 'Folders'}</strong></div><div class="bookmark-folder-tree"><button class="bookmark-folder bookmark-folder-root expanded ${folder === root ? 'active' : ''}" data-bookmark-folder="" style="--bookmark-depth:0"><span class="tree-caret" aria-hidden="true">&gt;</span><span>${locale === 'zh' ? '全部链接' : 'All links'}</span><small>${root.links.length}</small></button>${folderTree || `<span class="muted bookmark-folder-empty">${locale === 'zh' ? '暂无文件夹' : 'No folders'}</span>`}</div></aside>
		<div class="bookmarks-main">${bookmarkFolderPath.length ? bookmarkPathMarkup(bookmarkFolderPath) : ''}<div class="bookmarks-grid ${cards.length ? '' : 'empty'}">${cards.length ? cards.map((card) => bookmarkCardMarkup(card)).join('') : `<div class="notes-empty large"><i data-lucide="bookmark"></i><span>${locale === 'zh' ? '暂无链接收藏' : 'No saved links'}</span></div>`}</div></div>
	</div>`;
	refreshIcons();
	bindBookmarkPreviews(content);
	bindNotesNavigation(content);
	const path = content.querySelector<HTMLElement>('.bookmark-path');
	if (path) path.scrollLeft = path.scrollWidth;
	content.querySelectorAll<HTMLElement>('[data-bookmark-folder]').forEach((button) =>
		button.addEventListener('click', () => {
			const key = button.dataset.bookmarkFolder ?? '';
			if (key) {
				if (button.classList.contains('active')) bookmarkExpandedFolders.delete(key);
				else bookmarkExpandedFolders.add(key);
			}
			bookmarkFolderPath = key ? key.split('\u001f') : [];
			paintBookmarkView();
		}),
	);
	content.querySelectorAll<HTMLElement>('[data-bookmark-path]').forEach((button) =>
		button.addEventListener('click', () => {
			const key = button.dataset.bookmarkPath ?? '';
			bookmarkFolderPath = key ? key.split('\u001f') : [];
			paintBookmarkView();
		}),
	);
	content.querySelector<HTMLSelectElement>('.bookmark-folder-select')?.addEventListener('change', (event) => {
		const key = (event.target as HTMLSelectElement).value;
		bookmarkFolderPath = key ? key.split('\u001f') : [];
		paintBookmarkView();
	});
	content.querySelector('#notes-refresh')?.addEventListener('click', async () => {
		await pullBookmarks(true);
		if (bookmarkHub) paintBookmarkView();
		else {
			notesView = 'active';
			notesArchived = false;
			paintNotes({ items: [], page: 1, pageSize: 20, total: 0, hasMore: false });
			await renderNotes();
		}
	});
}

function bindNotesNavigation(content: HTMLElement): void {
	content.querySelectorAll<HTMLElement>('[data-note-view]').forEach((node) =>
		node.addEventListener('click', () => {
			notesView = node.dataset.noteView as NotesView;
			notesArchived = notesView === 'archived';
			notesData = null;
			if (notesView === 'bookmarks') {
				paintBookmarkView();
				void pullBookmarks();
			} else {
				paintNotes({ items: [], page: 1, pageSize: 20, total: 0, hasMore: false });
				void renderNotes();
			}
		}),
	);
	content.querySelectorAll<HTMLElement>('[data-note-archived]').forEach((node) =>
		node.addEventListener('click', () => {
			notesView = 'archived';
			notesArchived = true;
			selectedNoteFolderId = undefined;
			notesData = null;
			paintNotes({ items: [], page: 1, pageSize: 20, total: 0, hasMore: false });
			void renderNotes();
		}),
	);
}

function paintNotes(data: NotePage, selectedId?: string, openMobile = false): void {
	const content = document.querySelector<HTMLDivElement>('#page-content');
	if (!content) return;
	if (notesView === 'bookmarks') {
		paintBookmarkView();
		return;
	}
	const selected = data.items.find((note) => note.id === selectedId) ?? data.items[0];
	content.innerHTML = `<div class="notes-layout">
		<div class="notes-inner-toolbar">${notesTabsMarkup()}<span class="toolbar-spacer"></span><span class="note-count">${data.total}</span><button class="button icon-button" id="notes-refresh" title="${locale === 'zh' ? '刷新便签' : 'Refresh notes'}" aria-label="${locale === 'zh' ? '刷新便签' : 'Refresh notes'}"><i data-lucide="refresh-cw"></i></button></div>
		${notesFolderSidebarMarkup(data, selected)}
		${selected ? noteEditorMarkup(selected) : `<section class="note-editor note-editor-desktop"><div class="notes-empty large"><i data-lucide="sticky-note"></i><span>${t('noNotes')}</span></div></section>`}
	</div>
	${selected ? `<dialog class="note-dialog" id="note-dialog">${noteEditorMarkup(selected, true)}</dialog>` : ''}`;
	refreshIcons();
	content.querySelectorAll<HTMLElement>('[data-note]').forEach((node) => {
		const openNote = () => paintNotes(data, node.dataset.note, true);
		node.addEventListener('click', openNote);
	});
	content.querySelectorAll<HTMLElement>('[data-note-card-id]').forEach((card) => {
		card.addEventListener('dragstart', (event) => {
			event.dataTransfer?.setData('text/x-truespace-note', card.dataset.noteCardId!);
			if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
			card.classList.add('dragging');
		});
		card.addEventListener('dragend', () => card.classList.remove('dragging'));
	});
	const updateFromCard = async (noteId: string, changes: Partial<Pick<Note, 'pinned' | 'archived'>>): Promise<void> => {
		try {
			const updated = await api.updateNote(noteId, changes);
			const index = data.items.findIndex((note) => note.id === updated.id);
			if (index >= 0 && updated.archived !== notesArchived) {
				data.items.splice(index, 1);
				data.total = Math.max(0, data.total - 1);
			} else if (index >= 0) data.items[index] = updated;
			invalidateNoteCaches();
			if (changes.archived !== undefined) await loadNoteFolders(true);
			cacheNotes(data);
			paintNotes(data, updated.archived === notesArchived ? updated.id : undefined);
		} catch (error) {
			toast(errorMessage(error));
		}
	};
	content.querySelectorAll<HTMLElement>('[data-note-card-pin]').forEach((button) =>
		button.addEventListener('click', () => {
			const note = data.items.find((item) => item.id === button.dataset.noteCardPin);
			if (note) void updateFromCard(note.id, { pinned: !note.pinned });
		}),
	);
	content.querySelectorAll<HTMLElement>('[data-note-card-archive]').forEach((button) =>
		button.addEventListener('click', () => {
			const note = data.items.find((item) => item.id === button.dataset.noteCardArchive);
			if (note) void updateFromCard(note.id, { archived: !note.archived });
		}),
	);
	bindNotesNavigation(content);
	bindNotesFolders(content, data);
	content.querySelector('#new-note')?.addEventListener('click', async () => {
		try {
			const note = await api.createNote(locale === 'zh' ? '无标题便签' : 'Untitled note', '', typeof selectedNoteFolderId === 'string' ? selectedNoteFolderId : null);
			notesArchived = false;
			notesData = null;
			validatedNotePages.delete(noteCacheKey());
			await renderNotes(note.id, true, true);
		} catch (error) {
			toast(errorMessage(error));
		}
	});
	content.querySelector('#notes-refresh')?.addEventListener('click', async () => {
		await pullBookmarks(true);
		await renderNotes(selected?.id, true);
	});
	const list = content.querySelector<HTMLElement>('[data-notes-tree]')!;
	list.addEventListener(
		'scroll',
		(event) => {
			if (!event.isTrusted || list.scrollHeight - list.scrollTop - list.clientHeight > 120) return;
			void loadMoreNotes(selected?.id, list.scrollTop);
		},
		{ passive: true },
	);
	if (!selected) return;
	const desktopEditor = content.querySelector<HTMLElement>('.note-editor-desktop');
	if (desktopEditor) bindNoteEditor(desktopEditor, data, selected, false);
	const dialog = content.querySelector<HTMLDialogElement>('#note-dialog');
	if (dialog) {
		bindNoteEditor(dialog, data, selected, true);
		if (openMobile && matchMedia('(max-width: 760px)').matches) {
			history.pushState({ noteDialog: selected.id }, '', location.href);
			mobileNoteDialogOpen = true;
			dialog.showModal();
			dialog.addEventListener('cancel', (event) => {
				event.preventDefault();
				history.back();
			});
		}
	}
}

async function loadMoreNotes(selectedId?: string, scrollTop = 0): Promise<void> {
	const current = notesData;
	if (!current?.hasMore || notesLoadingMore) return;
	notesLoadingMore = true;
	const status = document.querySelector<HTMLElement>('.notes-load-status');
	if (status) {
		status.innerHTML = loadingMarkup(true);
	}
	const archived = notesArchived;
	const folderId = selectedNoteFolderId;
	try {
		const next = await api.notes(current.page + 1, archived, folderId);
		if (notesData !== current || archived !== notesArchived || folderId !== selectedNoteFolderId || pageFromPath() !== 'notes') return;
		const knownIds = new Set(current.items.map((note) => note.id));
		current.items.push(...next.items.filter((note) => !knownIds.has(note.id)));
		current.page = next.page;
		current.pageSize = next.pageSize;
		current.total = next.total;
		current.hasMore = next.hasMore;
		cacheNotes(current, archived);
		paintNotes(current, selectedId);
		const list = document.querySelector<HTMLElement>('[data-notes-tree]');
		if (list) list.scrollTop = scrollTop;
	} catch (error) {
		toast(errorMessage(error));
	} finally {
		notesLoadingMore = false;
		const currentStatus = document.querySelector<HTMLElement>('.notes-load-status');
		if (currentStatus) currentStatus.replaceChildren();
	}
}

async function renderNotes(selectedId?: string, forceSync = false, openMobile = false): Promise<void> {
	if (!document.querySelector('.notes-layout'))
		shell('notes', bookmarkHub ? (locale === 'zh' ? '收藏空间' : 'Collection') : t('notes'));
	const hadBookmarks = Boolean(bookmarkHub);
	await pullBookmarks(false);
	await loadNoteFolders(forceSync);
	if (!hadBookmarks && bookmarkHub) {
		const label = locale === 'zh' ? '收藏空间' : 'Collection';
		const nav = document.querySelector<HTMLElement>('[data-route="/notes"] span');
		if (nav) nav.textContent = label;
	}
	if (notesView === 'bookmarks') {
		paintBookmarkView();
		return;
	}
	const cached = forceSync ? null : cachedNotes();
	if (cached) {
		notesData = cached;
		paintNotes(cached, selectedId);
	}
	const cacheKey = noteCacheKey();
	const requestedArchived = notesArchived;
	const requestedFolderId = selectedNoteFolderId;
	if (!forceSync && validatedNotePages.has(cacheKey) && cached) {
		notesData = cached;
		return;
	}
	validatedNotePages.add(cacheKey);
	const request = ++notesRequest;
	try {
		const data = await api.notes(1, requestedArchived, requestedFolderId);
		if (request !== notesRequest || requestedArchived !== notesArchived || requestedFolderId !== selectedNoteFolderId) return;
		notesData = data;
		cacheNotes(data, requestedArchived);
		if (pageFromPath() === 'notes') paintNotes(data, selectedId, openMobile);
	} catch (error) {
		validatedNotePages.delete(cacheKey);
		if (!cached)
			document.querySelector('#page-content')!.innerHTML =
				`<div class="error-banner">${html(errorMessage(error))}</div>`;
		else toast(errorMessage(error));
	}
}

async function renderDevices(): Promise<void> {
	shell('devices', t('devices'));
	const content = document.querySelector<HTMLDivElement>('#page-content')!;
	try {
		const devices = await api.devices();
		content.innerHTML = `<div class="device-list">${devices
			.map(
				(device) =>
					`<article class="device-card"><div class="device-icon"><i data-lucide="${device.type === 'mobile' ? 'smartphone' : 'laptop'}"></i></div><div class="device-info"><div><h2>${html(device.name)}</h2>${device.current ? `<span class="current-badge"><span class="status-dot"></span>${t('currentDevice')}</span>` : ''}</div><p>${html(device.browser)} · ${html(device.platform)}${device.ip ? ` · ${html(device.ip)}` : ''}</p><dl><div><dt>${t('lastActive')}</dt><dd>${new Date(device.lastSeenAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}</dd></div><div><dt>${t('expires')}</dt><dd>${new Date(device.expiresAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}</dd></div></dl></div><button class="button ${device.current ? 'danger' : ''}" data-revoke="${device.id}">${t('revoke')}</button></article>`,
			)
			.join('')}</div>`;
		refreshIcons();
		content.querySelectorAll<HTMLElement>('[data-revoke]').forEach((button) =>
			button.addEventListener('click', async () => {
				if (
					!(await confirmAction(
						`${t('revoke')}?`,
						devices.find((item) => item.id === button.dataset.revoke)?.name ?? '',
						t('revoke'),
					))
				)
					return;
				try {
					const result = await api.deleteDevice(button.dataset.revoke!);
					if (result.current) {
						localStorage.removeItem('r2_session_token');
						navigate('/login');
					} else await renderDevices();
				} catch (error) {
					toast(errorMessage(error));
				}
			}),
		);
	} catch (error) {
		content.innerHTML = `<div class="error-banner">${html(errorMessage(error))}</div>`;
	}
}

function renderSettings(): void {
	const davOrigin = API_BASE || location.origin;
	shell(
		'settings',
		t('settings'),
		`<div class="settings">
		<section class="settings-section"><h2 class="settings-section-heading"><i data-lucide="cloud"></i><span>${t('settingsConnection')}</span></h2>
			<div class="field"><label>${t('webdavUrl')}</label><div class="input-row"><input class="input" readonly value="${html(davOrigin)}/"><button class="button icon-button" data-copy="${html(davOrigin)}/" title="${t('copy')} ${t('webdavUrl')}" aria-label="${t('copy')} ${t('webdavUrl')}"><i data-lucide="copy"></i></button></div></div>
			<div class="field"><label>${t('caldavUrl')}</label><div class="input-row"><input class="input" readonly value="${html(davOrigin)}/caldav/"><button class="button icon-button" data-copy="${html(davOrigin)}/caldav/" title="${t('copy')} ${t('caldavUrl')}" aria-label="${t('copy')} ${t('caldavUrl')}"><i data-lucide="copy"></i></button></div></div>
		</section>
		<section class="settings-section"><h2 class="settings-section-heading"><i data-lucide="languages"></i><span>${t('settingsLanguage')}</span></h2>
			<div class="field"><label for="language-select">${t('settingsLanguage')}</label><select class="input" id="language-select"><option value="en" ${locale === 'en' ? 'selected' : ''}>${t('english')}</option><option value="zh" ${locale === 'zh' ? 'selected' : ''}>${t('chinese')}</option></select><p class="muted">${t('settingsLanguageHint')}</p></div>
		</section>
	</div>`,
	);
	document.querySelector<HTMLSelectElement>('#language-select')?.addEventListener('change', (event) => {
		locale = (event.target as HTMLSelectElement).value as Locale;
		localStorage.setItem('r2_locale', locale);
		document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
		void render();
	});
	document.querySelectorAll<HTMLElement>('[data-copy]').forEach((button) =>
		button.addEventListener('click', async () => {
			await navigator.clipboard.writeText(button.dataset.copy!);
			toast(t('copied'));
		}),
	);
	refreshIcons();
}

function renderLogin(): void {
	app.innerHTML = `<main class="login-page">
		<button class="login-language language-button" id="language-toggle"><i data-lucide="languages"></i><span>${t('language')}</span></button>
		<section class="login-intro" aria-hidden="true"><div class="intro-brand"><span class="brand-wordmark inverse">T</span><span>TrueSpace</span></div><div class="intro-copy"><span class="intro-index">01 / 04</span><h1>${t('hero')}</h1><p>${t('heroCopy')}</p></div><div class="storage-signal"><span>True</span><i data-lucide="cloud"></i></div></section>
		<section class="login-panel"><div class="login-box"><div class="login-brand"><span class="brand-wordmark">T</span><span>TrueSpace</span></div><div class="login-heading"><span class="page-kicker">${t('secureAccess')}</span><h2>${t('welcome')}</h2><p>${t('signIn')}</p></div>
		<form class="login-form" id="login-form"><div class="field"><label for="username">${t('username')}</label><input class="input" id="username" autocomplete="username" required></div><div class="field"><label for="password">${t('password')}</label><input class="input" id="password" type="password" autocomplete="current-password" required></div><div id="login-error"></div><button class="button primary" id="login-submit">${t('continue')}</button></form><p class="login-footnote">${locale === 'zh' ? '仅限授权用户访问。' : 'Authorized access only.'}</p></div></section>
	</main>`;
	refreshIcons();
	document.querySelector('#language-toggle')?.addEventListener('click', () => {
		locale = locale === 'en' ? 'zh' : 'en';
		localStorage.setItem('r2_locale', locale);
		document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
		renderLogin();
	});
	document.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', async (event) => {
		event.preventDefault();
		const submit = document.querySelector<HTMLButtonElement>('#login-submit')!;
		const error = document.querySelector<HTMLDivElement>('#login-error')!;
		submit.disabled = true;
		submit.textContent = t('signingIn');
		error.innerHTML = '';
		try {
			await api.login(
				document.querySelector<HTMLInputElement>('#username')!.value,
				document.querySelector<HTMLInputElement>('#password')!.value,
			);
			history.replaceState({}, '', '/files');
			await render();
		} catch (reason) {
			error.innerHTML = `<div class="error-banner">${html(errorMessage(reason))}</div>`;
			submit.disabled = false;
			submit.textContent = t('continue');
		}
	});
}

async function render(): Promise<void> {
	if (location.pathname === '/login' || !hasSession()) {
		if (location.pathname !== '/login') history.replaceState({}, '', '/login');
		renderLogin();
		return;
	}
	const page = pageFromPath();
	if (
		location.pathname === '/' ||
		!['/files', '/calendar', '/notes', '/devices', '/settings'].includes(location.pathname)
	)
		history.replaceState({}, '', `/${page}`);
	if (page === 'files') await renderFiles();
	else if (page === 'calendar') await renderCalendar();
	else if (page === 'notes') await renderNotes();
	else if (page === 'devices') await renderDevices();
	else renderSettings();
}

window.addEventListener('popstate', () => {
	if (mobileNoteDialogOpen) {
		mobileNoteDialogOpen = false;
		const dialog = document.querySelector<HTMLDialogElement>('#note-dialog[open]');
		const flush = flushMobileNote;
		const selectedId = mobileNoteId;
		flushMobileNote = null;
		mobileNoteId = undefined;
		void (async () => {
			await flush?.();
			dialog?.close();
			if (pageFromPath() === 'notes' && notesData) paintNotes(notesData, selectedId);
		})();
		return;
	}
	void render();
});
void render();
