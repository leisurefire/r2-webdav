import {
	Archive,
	Bookmark,
	Bold,
	CalendarDays,
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	Cloud,
	Copy,
	Database,
	Download,
	File,
	FileDown,
	Film,
	Folder,
	FolderInput,
	FolderMinus,
	FolderOpen,
	FolderPlus,
	Image,
	Inbox,
	Italic,
	Languages,
	Laptop,
	ListCollapse,
	LoaderCircle,
	LogOut,
	Maximize2,
	Music,
	MoreHorizontal,
	PanelLeftClose,
	PanelLeftOpen,
	Pencil,
	PencilLine,
	Pin,
	PinOff,
	Plus,
	RefreshCw,
	Save,
	Settings,
	SortAsc,
	Smartphone,
	Sparkles,
	StickyNote,
	Trash2,
	Upload,
	User,
	WandSparkles,
	MessageCircle,
	Code,
	X,
	createIcons,
} from 'lucide';
import { openConfirmDialog } from './ui/dialogs';
import { api, ApiError } from './api/client';
import { locale, t } from './i18n';

export type Page = 'files' | 'calendar' | 'notes' | 'links' | 'devices' | 'settings';
export const app = document.querySelector<HTMLDivElement>('#app')!;
export let sidebarCollapsed = localStorage.getItem('r2_sidebar_collapsed') === '1';

export const html = (value: unknown): string =>
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

export function refreshIcons(): void {
	createIcons({
		icons: {
			Archive,
			Bookmark,
			Bold,
			CalendarDays,
			Check,
			ChevronDown,
			ChevronLeft,
			ChevronRight,
			ChevronUp,
			Cloud,
			Copy,
			Database,
			Download,
			File,
			FileDown,
			Film,
			Folder,
			FolderInput,
			FolderMinus,
			FolderOpen,
			FolderPlus,
			Image,
			Inbox,
			Italic,
			Languages,
			Laptop,
			ListCollapse,
			LoaderCircle,
			LogOut,
			Maximize2,
			Music,
			MoreHorizontal,
			PanelLeftClose,
			PanelLeftOpen,
			Pencil,
			PencilLine,
			Pin,
			PinOff,
			Plus,
			RefreshCw,
			Save,
			Settings,
			SortAsc,
			Smartphone,
			Sparkles,
			StickyNote,
			Trash2,
			Upload,
			User,
			WandSparkles,
			MessageCircle,
			Code,
			X,
		},
	});
}

export function toast(message: string): void {
	document.querySelector('.toast')?.remove();
	const node = document.createElement('div');
	node.className = 'toast';
	node.textContent = message;
	document.body.append(node);
	window.setTimeout(() => node.remove(), 3200);
}

export function errorMessage(error: unknown): string {
	if (error instanceof ApiError && error.status === 401) {
		localStorage.removeItem('r2_session_token');
		navigate('/login');
	}
	const message = error instanceof Error ? error.message : 'Something went wrong';
	if (
		(error instanceof ApiError && error.code === 'NETWORK_ERROR') ||
		/failed to fetch|network request failed|networkerror|load failed/i.test(message)
	) {
		return locale === 'zh'
			? '网络请求失败，请检查网络后重试（文件/日历服务跨域访问在弱网下更容易失败）。'
			: 'Network request failed. Check your connection and try again.';
	}
	return message;
}

export function loadingMarkup(compact = false): string {
	return `<div class="true-loading ${compact ? 'compact' : ''}" role="status" aria-label="${html(t('loading'))}"><span class="true-loading-line"></span><span class="true-loading-line"></span><span class="true-loading-line"></span><span class="visually-hidden">${html(t('loading'))}</span></div>`;
}

export function pageFromPath(): Page {
	const page = location.pathname.replace(/^\//, '').split('/')[0] as Page;
	return ['files', 'calendar', 'notes', 'links', 'devices', 'settings'].includes(page) ? page : 'files';
}

export function navigate(path: string): void {
	history.pushState({}, '', path);
	void render();
}

export function shell(page: Page, _title: string, content = loadingMarkup()): void {
	app.innerHTML = `<div class="app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}">
		<aside class="sidebar workspace-rail workspace-rail-left">
			<div class="sidebar-head">
				<div class="brand" aria-label="TrueSpace"><span class="brand-full">TrueSpace</span></div>
				<button class="sidebar-toggle" id="sidebar-toggle" title="${sidebarCollapsed ? (locale === 'zh' ? '展开侧栏' : 'Expand sidebar') : locale === 'zh' ? '折叠侧栏' : 'Collapse sidebar'}" aria-label="${sidebarCollapsed ? (locale === 'zh' ? '展开侧栏' : 'Expand sidebar') : locale === 'zh' ? '折叠侧栏' : 'Collapse sidebar'}"><i data-lucide="${sidebarCollapsed ? 'panel-left-open' : 'panel-left-close'}"></i></button>
			</div>
			<nav class="nav" aria-label="Primary navigation">
				<button class="nav-button ${page === 'files' ? 'active' : ''}" data-route="/files" title="${t('files')}"><i data-lucide="folder"></i><span>${t('files')}</span></button>
				<button class="nav-button ${page === 'calendar' ? 'active' : ''}" data-route="/calendar" title="${t('calendar')}"><i data-lucide="calendar-days"></i><span>${t('calendar')}</span></button>
				<button class="nav-button ${page === 'notes' ? 'active' : ''}" data-route="/notes" title="${t('notes')}"><i data-lucide="sticky-note"></i><span>${t('notes')}</span></button>
				<button class="nav-button ${page === 'links' ? 'active' : ''}" data-route="/links" title="${t('links')}"><i data-lucide="bookmark"></i><span>${t('links')}</span></button>
			</nav>
			<section class="sidebar-context" id="sidebar-context" aria-live="polite"></section>
			<div class="sidebar-footer"><div class="account-menu-wrap">
				<div class="account-popover" id="account-popover" hidden>
					<button data-settings-open><i data-lucide="settings"></i><span>${t('settings')}</span></button>
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
	document.querySelector('[data-settings-open]')?.addEventListener('click', () => {
		document.dispatchEvent(new CustomEvent('truespace:open-settings'));
	});
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

export function sidebarContext(): HTMLElement | null {
	return document.querySelector<HTMLElement>('#sidebar-context');
}

export function closeActionMenus(except?: HTMLElement): void {
	document.querySelectorAll<HTMLElement>('[data-action-menu].open').forEach((menu) => {
		if (menu === except) return;
		menu.classList.remove('open');
		menu.querySelector<HTMLElement>('[data-menu-toggle]')?.setAttribute('aria-expanded', 'false');
	});
}

document.addEventListener('click', (event) => {
	const target = event.target instanceof Element ? event.target : null;
	const toggle = target?.closest<HTMLElement>('[data-menu-toggle]');
	if (toggle) {
		event.preventDefault();
		event.stopPropagation();
		const menu = toggle.closest<HTMLElement>('[data-action-menu]');
		if (!menu) return;
		const opening = !menu.classList.contains('open');
		closeActionMenus(menu);
		menu.classList.toggle('open', opening);
		toggle.setAttribute('aria-expanded', String(opening));
		return;
	}
	if (target?.closest('[data-menu-popover]')) closeActionMenus();
	else closeActionMenus();
});

document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape') closeActionMenus();
});

export function confirmAction(title: string, message: string, confirmLabel = 'Delete'): Promise<boolean> {
	return openConfirmDialog(title, message, confirmLabel, locale === 'zh' ? '取消' : 'Cancel');
}

export async function confirmLogout(): Promise<void> {
	if (!(await confirmAction(t('logout'), t('logoutConfirm'), t('logout')))) return;
	try {
		await api.logout();
	} catch {
		// The local token is cleared by api.logout even when the server cannot be reached.
	} finally {
		location.replace('/login');
	}
}

export type Render = () => Promise<void>;
let renderImpl: Render = async () => {};
export function registerRender(next: Render): void {
	renderImpl = next;
}
export async function render(): Promise<void> {
	return renderImpl();
}
