import {
	Archive,
	CalendarDays,
	Check,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	Cloud,
	Copy,
	Database,
	Download,
	File,
	Film,
	Folder,
	FolderOpen,
	FolderPlus,
	Image,
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
	Settings,
	Smartphone,
	StickyNote,
	Trash2,
	Upload,
	User,
	createIcons,
} from 'lucide';
import type {
	CalendarEvent,
	CalendarSummary,
	DeviceSession,
	FileEntry,
	FileListing,
	Note,
	NotePage,
} from '@r2-webdav/shared-types';
import { Lunar, Solar } from 'lunar-typescript';
import { API_BASE, ApiError, api, hasSession } from './api/client';
import './styles.css';

type Page = 'files' | 'calendar' | 'notes' | 'devices' | 'settings';
const app = document.querySelector<HTMLDivElement>('#app')!;
type Locale = 'en' | 'zh';
let locale: Locale =
	(localStorage.getItem('r2_locale') as Locale | null) ??
	(navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');
const messages = {
	en: {
		workspace: 'Workspace',
		files: 'Files',
		calendar: 'Calendar',
		notes: 'Notes',
		devices: 'Devices',
		settings: 'Settings',
		filesDesc: 'Browse and manage everything stored in your R2 bucket.',
		calendarDesc: 'Plan your schedule and keep CalDAV clients in sync.',
		notesDesc: 'Capture ideas in Markdown and keep the important ones close.',
		devicesDesc: 'Review and revoke every device signed in to this account.',
		settingsDesc: 'Connection details for this workspace and its services.',
		connected: 'Storage connected',
		logout: 'Log out',
		account: 'Account',
		logoutConfirm: 'Are you sure you want to log out?',
		loading: 'Loading…',
		language: '中文',
		newNote: 'New note',
		active: 'Active',
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
		signIn: 'Sign in to continue to your workspace.',
		username: 'Username',
		password: 'Password',
		continue: 'Continue',
		signingIn: 'Signing in…',
		secureAccess: 'Secure access',
		hero: 'Your files, notes, and time—together.',
		heroCopy: 'A focused home for R2 storage, WebDAV, calendars, and Markdown notes.',
	},
	zh: {
		workspace: '工作区',
		files: '文件',
		calendar: '日历',
		notes: '便签',
		devices: '设备',
		settings: '设置',
		filesDesc: '浏览和管理 R2 存储桶中的所有内容。',
		calendarDesc: '规划日程，并与 CalDAV 客户端保持同步。',
		notesDesc: '使用 Markdown 记录想法，并将重要内容置顶。',
		devicesDesc: '查看并撤销此账户已登录的所有设备。',
		settingsDesc: '查看工作区及服务的连接信息。',
		connected: '存储已连接',
		logout: '退出登录',
		account: '账户',
		logoutConfirm: '确定要退出当前账户吗？',
		loading: '加载中…',
		language: 'English',
		newNote: '新建便签',
		active: '当前便签',
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
		signIn: '登录后继续访问你的工作区。',
		username: '用户名',
		password: '密码',
		continue: '继续',
		signingIn: '登录中…',
		secureAccess: '安全访问',
		hero: '文件、便签与日程，尽在一处。',
		heroCopy: '专注管理 R2 存储、WebDAV、日历与 Markdown 便签。',
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
			CalendarDays,
			Check,
			ChevronLeft,
			ChevronRight,
			ChevronUp,
			Cloud,
			Copy,
			Database,
			Download,
			File,
			Film,
			Folder,
			FolderOpen,
			FolderPlus,
			Image,
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
			Settings,
			Smartphone,
			StickyNote,
			Trash2,
			Upload,
			User,
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

function pageFromPath(): Page {
	const page = location.pathname.slice(1) as Page;
	return ['files', 'calendar', 'notes', 'devices', 'settings'].includes(page) ? page : 'files';
}

function navigate(path: string): void {
	history.pushState({}, '', path);
	void render();
}

function shell(page: Page, _title: string, content = '<div class="empty-state"><div>Loading...</div></div>'): void {
	app.innerHTML = `<div class="app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}">
		<aside class="sidebar">
			<div class="sidebar-head">
				<div class="brand" aria-label="TrueSpace"><span class="brand-full">TrueSpace</span></div>
				<button class="sidebar-toggle" id="sidebar-toggle" title="${sidebarCollapsed ? (locale === 'zh' ? '展开侧栏' : 'Expand sidebar') : locale === 'zh' ? '折叠侧栏' : 'Collapse sidebar'}" aria-label="${sidebarCollapsed ? (locale === 'zh' ? '展开侧栏' : 'Expand sidebar') : locale === 'zh' ? '折叠侧栏' : 'Collapse sidebar'}"><i data-lucide="${sidebarCollapsed ? 'panel-left-open' : 'panel-left-close'}"></i></button>
			</div>
			<nav class="nav" aria-label="Primary navigation">
				<button class="nav-button ${page === 'files' ? 'active' : ''}" data-route="/files" title="${t('files')}"><i data-lucide="folder"></i><span>${t('files')}</span></button>
				<button class="nav-button ${page === 'calendar' ? 'active' : ''}" data-route="/calendar" title="${t('calendar')}"><i data-lucide="calendar-days"></i><span>${t('calendar')}</span></button>
				<button class="nav-button ${page === 'notes' ? 'active' : ''}" data-route="/notes" title="${t('notes')}"><i data-lucide="sticky-note"></i><span>${t('notes')}</span></button>
			</nav>
			<div class="sidebar-footer"><div class="account-menu-wrap">
				<div class="account-popover" id="account-popover" hidden>
					<button id="language-toggle"><i data-lucide="languages"></i><span>${t('language')}</span></button>
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
	document.querySelector('#language-toggle')?.addEventListener('click', () => {
		locale = locale === 'en' ? 'zh' : 'en';
		localStorage.setItem('r2_locale', locale);
		document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
		void render();
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

function paintFiles(listing: FileListing): void {
	const content = document.querySelector<HTMLDivElement>('#page-content');
	if (!content || pageFromPath() !== 'files' || listing.path !== currentPath) return;
	const rows = listing.entries
		.map(
			(entry) => `<tr>
			<td class="file-name"><button class="name-button" data-open="${html(entry.path)}" data-type="${entry.type}"><i data-lucide="${fileIcon(entry)}"></i><span>${html(entry.name)}</span></button></td>
			<td class="file-size">${entry.type === 'file' ? formatBytes(entry.size) : '—'}</td>
			<td class="file-date">${new Date(entry.modifiedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
			<td class="file-actions"><div class="row-actions">
				${entry.type === 'file' ? `<button class="row-action" data-download="${html(entry.path)}" title="Download" aria-label="Download"><i data-lucide="download"></i></button>` : ''}
				<button class="row-action" data-rename="${html(entry.path)}" title="Rename" aria-label="Rename"><i data-lucide="pencil"></i></button>
				<button class="row-action danger" data-delete="${html(entry.path)}" title="Delete" aria-label="Delete"><i data-lucide="trash-2"></i></button>
			</div></td></tr>`,
		)
		.join('');
	content.innerHTML = `<div class="toolbar"><div class="breadcrumbs">${breadcrumbMarkup(listing.path)}</div><span class="toolbar-spacer"></span>
			<button class="button icon-button" id="files-refresh" title="${locale === 'zh' ? '刷新文件' : 'Refresh files'}" aria-label="${locale === 'zh' ? '刷新文件' : 'Refresh files'}"><i data-lucide="refresh-cw"></i></button>
			<button class="button" id="mkdir"><i data-lucide="folder-plus"></i><span>${locale === 'zh' ? '新建文件夹' : 'New folder'}</span></button>
			<button class="button primary" id="upload"><i data-lucide="upload"></i><span>${locale === 'zh' ? '上传' : 'Upload'}</span></button>
			<input type="file" id="file-input" hidden multiple>
		</div><div id="upload-status"></div>
		${rows ? `<table class="file-table"><thead><tr><th class="file-name">${locale === 'zh' ? '名称' : 'Name'}</th><th>${locale === 'zh' ? '大小' : 'Size'}</th><th>${locale === 'zh' ? '修改时间' : 'Modified'}</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty-state"><div><i data-lucide="folder-open"></i><div>${locale === 'zh' ? '此文件夹为空' : 'This folder is empty'}</div></div></div>`}`;
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
			} else await api.download(item.dataset.open!);
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
			const name = await openTextDialog('Rename', 'Name', source.split('/').at(-1));
			if (!name || name.includes('/')) return;
			const parent = source.split('/').slice(0, -1).join('/');
			try {
				await api.move(source, parent ? `${parent}/${name}` : name);
				toast('Renamed');
				await renderFiles(true);
			} catch (error) {
				toast(errorMessage(error));
			}
		}),
	);
	content.querySelectorAll<HTMLElement>('[data-delete]').forEach((item) =>
		item.addEventListener('click', async () => {
			const path = item.dataset.delete!;
			if (!(await confirmAction('Delete item?', `${path.split('/').at(-1)} will be permanently deleted.`))) return;
			try {
				await api.deleteFile(path);
				toast('Deleted');
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
			content.innerHTML = `<div class="calendar-toolbar"><button class="button icon-button" id="cal-prev"><i data-lucide="chevron-left"></i></button><button class="button" id="cal-today">${locale === 'zh' ? '今天' : 'Today'}</button><button class="button icon-button" id="cal-next"><i data-lucide="chevron-right"></i></button><h2 id="calendar-title"></h2><span class="sync-status" id="calendar-sync"><span class="status-dot"></span>${locale === 'zh' ? '已缓存' : 'Cached'}</span><span class="toolbar-spacer"></span><button class="button icon-button" id="cal-refresh"><i data-lucide="refresh-cw"></i></button><button class="button primary" id="new-event"><i data-lucide="plus"></i><span>${locale === 'zh' ? '新建日程' : 'New event'}</span></button></div><div class="calendar" id="calendar-view"><div class="weekday-row">${(locale === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map((day) => `<div class="weekday">${day}</div>`).join('')}</div><div class="month-grid" id="month-grid"></div></div>`;
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

let notesArchived = false;
let notesPage = 1;

function noteCacheKey(): string {
	return `r2_notes_${notesArchived ? 'archived' : 'active'}_${notesPage}`;
}

function cacheNotes(data: NotePage): void {
	localStorage.setItem(noteCacheKey(), JSON.stringify(data));
}

function cachedNotes(): NotePage | null {
	try {
		return JSON.parse(localStorage.getItem(noteCacheKey()) ?? 'null') as NotePage | null;
	} catch {
		return null;
	}
}

function inlineMarkdown(value: string): string {
	return html(value)
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/__([^_]+)__/g, '<strong>$1</strong>')
		.replace(/\*([^*]+)\*/g, '<em>$1</em>')
		.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function markdown(value: string): string {
	const output: string[] = [];
	let list: 'ul' | 'ol' | null = null;
	const closeList = () => {
		if (list) output.push(`</${list}>`);
		list = null;
	};
	for (const raw of value.replaceAll('\r', '').split('\n')) {
		const heading = raw.match(/^(#{1,4})\s+(.+)$/);
		const bullet = raw.match(/^[-*]\s+(.+)$/);
		const numbered = raw.match(/^\d+\.\s+(.+)$/);
		if (heading) {
			closeList();
			const level = heading[1].length + 1;
			output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
		} else if (bullet || numbered) {
			const next = bullet ? 'ul' : 'ol';
			if (list !== next) {
				closeList();
				list = next;
				output.push(`<${list}>`);
			}
			output.push(`<li>${inlineMarkdown((bullet ?? numbered)![1])}</li>`);
		} else {
			closeList();
			if (!raw.trim()) output.push('<div class="markdown-space"></div>');
			else if (raw.startsWith('> ')) output.push(`<blockquote>${inlineMarkdown(raw.slice(2))}</blockquote>`);
			else output.push(`<p>${inlineMarkdown(raw)}</p>`);
		}
	}
	closeList();
	return output.join('');
}

function paintNotes(data: NotePage, selectedId?: string): void {
	const content = document.querySelector<HTMLDivElement>('#page-content');
	if (!content) return;
	const selected = data.items.find((note) => note.id === selectedId) ?? data.items[0];
	const cards = data.items
		.map(
			(note) => `<button class="note-card ${note.id === selected?.id ? 'active' : ''}" data-note="${note.id}">
				<div class="note-card-title">${note.pinned ? '<i data-lucide="pin"></i>' : ''}<strong>${html(note.title)}</strong></div>
				<p>${html(note.content.replace(/[#*_`>\[\]]/g, '').slice(0, 110) || '—')}</p>
				<time>${new Date(note.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}</time>
			</button>`,
		)
		.join('');
	content.innerHTML = `<div class="notes-toolbar">
		<div class="segment-control"><button class="${!notesArchived ? 'active' : ''}" data-note-view="active">${t('active')}</button><button class="${notesArchived ? 'active' : ''}" data-note-view="archived">${t('archived')}</button></div>
		<span class="toolbar-spacer"></span><span class="note-count">${data.total}</span><button class="button icon-button" id="notes-refresh" title="${locale === 'zh' ? '刷新便签' : 'Refresh notes'}" aria-label="${locale === 'zh' ? '刷新便签' : 'Refresh notes'}"><i data-lucide="refresh-cw"></i></button><button class="button primary" id="new-note"><i data-lucide="plus"></i><span>${t('newNote')}</span></button>
	</div>
	<div class="notes-layout">
		<aside class="notes-list">${cards || `<div class="notes-empty"><i data-lucide="sticky-note"></i><span>${t('noNotes')}</span></div>`}
			<div class="pagination"><button class="button" id="notes-prev" ${data.page <= 1 ? 'disabled' : ''}>${t('previous')}</button><span>${t('page')} ${data.page}</span><button class="button" id="notes-next" ${!data.hasMore ? 'disabled' : ''}>${t('next')}</button></div>
		</aside>
		<section class="note-editor">${
			selected
				? `<form id="note-form">
			<div class="note-editor-head"><input id="note-title" value="${html(selected.title)}" aria-label="Title"><div class="note-actions">
				<button type="button" class="row-action" id="note-pin" title="${selected.pinned ? t('unpin') : t('pin')}"><i data-lucide="${selected.pinned ? 'pin-off' : 'pin'}"></i></button>
				<button type="button" class="row-action" id="note-archive" title="${selected.archived ? t('restore') : t('archive')}"><i data-lucide="archive"></i></button>
				<button type="button" class="row-action danger" id="note-delete" title="${t('delete')}"><i data-lucide="trash-2"></i></button>
			</div></div>
			<div class="note-compose" id="note-compose"><textarea id="note-content" aria-label="${t('markdown')}">${html(selected.content)}</textarea><article class="note-render" id="note-render" tabindex="0" title="${locale === 'zh' ? '点击编辑' : 'Click to edit'}">${markdown(selected.content) || '<p class="muted">Click to edit...</p>'}</article></div>
			<div class="note-savebar"><span>${new Date(selected.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}</span><button class="button primary"><i data-lucide="check"></i>${t('save')}</button></div>
		</form>`
				: `<div class="notes-empty large"><i data-lucide="sticky-note"></i><span>${t('noNotes')}</span></div>`
		}</section>
	</div>`;
	refreshIcons();
	content
		.querySelectorAll<HTMLElement>('[data-note]')
		.forEach((node) => node.addEventListener('click', () => paintNotes(data, node.dataset.note)));
	content.querySelectorAll<HTMLElement>('[data-note-view]').forEach((node) =>
		node.addEventListener('click', () => {
			notesArchived = node.dataset.noteView === 'archived';
			notesPage = 1;
			void renderNotes();
		}),
	);
	content.querySelector('#new-note')?.addEventListener('click', async () => {
		try {
			const note = await api.createNote(locale === 'zh' ? '无标题便签' : 'Untitled note', '');
			notesArchived = false;
			notesPage = 1;
			validatedNotePages.delete(noteCacheKey());
			await renderNotes(note.id, true);
		} catch (error) {
			toast(errorMessage(error));
		}
	});
	content.querySelector('#notes-prev')?.addEventListener('click', () => {
		notesPage = Math.max(1, notesPage - 1);
		void renderNotes();
	});
	content.querySelector('#notes-next')?.addEventListener('click', () => {
		notesPage += 1;
		void renderNotes();
	});
	content.querySelector('#notes-refresh')?.addEventListener('click', () => void renderNotes(selected?.id, true));
	if (!selected) return;
	const compose = content.querySelector<HTMLDivElement>('#note-compose')!;
	const textarea = content.querySelector<HTMLTextAreaElement>('#note-content')!;
	const noteRender = content.querySelector<HTMLElement>('#note-render')!;
	const startEditing = () => {
		compose.classList.add('editing');
		textarea.focus();
	};
	noteRender.addEventListener('click', startEditing);
	noteRender.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			startEditing();
		}
	});
	textarea.addEventListener('blur', () => {
		noteRender.innerHTML = markdown(textarea.value) || '<p class="muted">Click to edit...</p>';
		compose.classList.remove('editing');
	});
	textarea.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') textarea.blur();
	});
	const update = async (changes: Partial<Pick<Note, 'title' | 'content' | 'pinned' | 'archived'>>) => {
		try {
			const updated = await api.updateNote(selected.id, changes);
			const index = data.items.findIndex((note) => note.id === updated.id);
			if (index >= 0 && updated.archived !== notesArchived) {
				data.items.splice(index, 1);
				data.total = Math.max(0, data.total - 1);
			} else if (index >= 0) data.items[index] = updated;
			cacheNotes(data);
			paintNotes(data, updated.archived === notesArchived ? updated.id : undefined);
		} catch (error) {
			toast(errorMessage(error));
		}
	};
	content.querySelector<HTMLFormElement>('#note-form')?.addEventListener('submit', (event) => {
		event.preventDefault();
		void update({
			title: content.querySelector<HTMLInputElement>('#note-title')!.value,
			content: content.querySelector<HTMLTextAreaElement>('#note-content')!.value,
		});
	});
	content.querySelector('#note-pin')?.addEventListener('click', () => void update({ pinned: !selected.pinned }));
	content
		.querySelector('#note-archive')
		?.addEventListener('click', () => void update({ archived: !selected.archived }));
	content.querySelector('#note-delete')?.addEventListener('click', async () => {
		if (!(await confirmAction(`${t('delete')}?`, selected.title, t('delete')))) return;
		try {
			await api.deleteNote(selected.id);
			validatedNotePages.delete(noteCacheKey());
			await renderNotes(undefined, true);
		} catch (error) {
			toast(errorMessage(error));
		}
	});
}

async function renderNotes(selectedId?: string, forceSync = false): Promise<void> {
	shell('notes', t('notes'));
	const cached = cachedNotes();
	if (cached) paintNotes(cached, selectedId);
	const cacheKey = noteCacheKey();
	const requestedPage = notesPage;
	const requestedArchived = notesArchived;
	if (!forceSync && validatedNotePages.has(cacheKey)) return;
	validatedNotePages.add(cacheKey);
	try {
		const data = await api.notes(requestedPage, requestedArchived);
		if (requestedPage !== notesPage || requestedArchived !== notesArchived) return;
		cacheNotes(data);
		if (pageFromPath() === 'notes') paintNotes(data, selectedId);
	} catch (error) {
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
		<section class="settings-section"><h2>Connection</h2>
			<div class="field"><label>WebDAV URL</label><div class="input-row"><input class="input" readonly value="${html(davOrigin)}/"><button class="button icon-button" data-copy="${html(davOrigin)}/" title="Copy WebDAV URL" aria-label="Copy WebDAV URL"><i data-lucide="copy"></i></button></div></div>
			<div class="field"><label>CalDAV URL</label><div class="input-row"><input class="input" readonly value="${html(davOrigin)}/caldav/"><button class="button icon-button" data-copy="${html(davOrigin)}/caldav/" title="Copy CalDAV URL" aria-label="Copy CalDAV URL"><i data-lucide="copy"></i></button></div></div>
		</section>
		<section class="settings-section"><h2>API</h2><div class="field"><label>Base URL</label><input class="input" readonly value="${html(API_BASE || location.origin)}"></div></section>
	</div>`,
	);
	document.querySelectorAll<HTMLElement>('[data-copy]').forEach((button) =>
		button.addEventListener('click', async () => {
			await navigator.clipboard.writeText(button.dataset.copy!);
			toast('Copied');
		}),
	);
	refreshIcons();
}

function renderLogin(): void {
	app.innerHTML = `<main class="login-page">
		<button class="login-language language-button" id="language-toggle"><i data-lucide="languages"></i><span>${t('language')}</span></button>
		<section class="login-intro" aria-hidden="true"><div class="intro-brand"><span class="brand-wordmark inverse">R2</span><span>Dashboard</span></div><div class="intro-copy"><span class="intro-index">01 / 04</span><h1>${t('hero')}</h1><p>${t('heroCopy')}</p></div><div class="storage-signal"><span>R2</span><i data-lucide="cloud"></i></div></section>
		<section class="login-panel"><div class="login-box"><div class="login-brand"><span class="brand-wordmark">R2</span><span>Dashboard</span></div><div class="login-heading"><span class="page-kicker">${t('secureAccess')}</span><h2>${t('welcome')}</h2><p>${t('signIn')}</p></div>
		<form class="login-form" id="login-form"><div class="field"><label for="username">${t('username')}</label><input class="input" id="username" autocomplete="username" required></div><div class="field"><label for="password">${t('password')}</label><input class="input" id="password" type="password" autocomplete="current-password" required></div><div id="login-error"></div><button class="button primary" id="login-submit">${t('continue')}</button></form><p class="login-footnote">Protected by your private Worker credentials.</p></div></section>
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

window.addEventListener('popstate', () => void render());
void render();
