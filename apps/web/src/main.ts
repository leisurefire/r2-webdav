import {
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	Cloud,
	Copy,
	Download,
	File,
	Film,
	Folder,
	FolderOpen,
	FolderPlus,
	Image,
	LogOut,
	Music,
	Pencil,
	Plus,
	Settings,
	Trash2,
	Upload,
	createIcons,
} from 'lucide';
import type { CalendarEvent, CalendarSummary, FileEntry } from '@r2-webdav/shared-types';
import { API_BASE, ApiError, api, hasSession } from './api/client';
import './styles.css';

type Page = 'files' | 'calendar' | 'settings';
const app = document.querySelector<HTMLDivElement>('#app')!;
let currentPath = '';
let calendarCursor = new Date();
calendarCursor.setDate(1);

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
			CalendarDays,
			ChevronLeft,
			ChevronRight,
			Cloud,
			Copy,
			Download,
			File,
			Film,
			Folder,
			FolderOpen,
			FolderPlus,
			Image,
			LogOut,
			Music,
			Pencil,
			Plus,
			Settings,
			Trash2,
			Upload,
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
		sessionStorage.clear();
		navigate('/login');
	}
	return error instanceof Error ? error.message : 'Something went wrong';
}

function pageFromPath(): Page {
	const page = location.pathname.slice(1) as Page;
	return ['files', 'calendar', 'settings'].includes(page) ? page : 'files';
}

function navigate(path: string): void {
	history.pushState({}, '', path);
	void render();
}

function shell(page: Page, title: string, content = '<div class="empty-state"><div>Loading…</div></div>'): void {
	app.innerHTML = `<div class="app-shell">
		<aside class="sidebar">
			<div class="brand"><span class="brand-mark"><i data-lucide="cloud"></i></span><span>R2 Workspace</span></div>
			<nav class="nav" aria-label="Primary navigation">
				<button class="nav-button ${page === 'files' ? 'active' : ''}" data-route="/files"><i data-lucide="folder"></i><span>Files</span></button>
				<button class="nav-button ${page === 'calendar' ? 'active' : ''}" data-route="/calendar"><i data-lucide="calendar-days"></i><span>Calendar</span></button>
				<button class="nav-button ${page === 'settings' ? 'active' : ''}" data-route="/settings"><i data-lucide="settings"></i><span>Settings</span></button>
			</nav>
			<div class="sidebar-footer"><button class="logout-button" id="logout"><i data-lucide="log-out"></i><span>Log out</span></button></div>
		</aside>
		<main class="workspace"><header class="topbar"><h1>${html(title)}</h1><span class="muted">default</span></header><div class="content" id="page-content">${content}</div></main>
	</div>`;
	document
		.querySelectorAll<HTMLElement>('[data-route]')
		.forEach((item) => item.addEventListener('click', () => navigate(item.dataset.route!)));
	document.querySelector('#logout')?.addEventListener('click', async () => {
		await api.logout();
		navigate('/login');
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
	const crumbs = [`<button class="crumb ${parts.length === 0 ? 'current' : ''}" data-path="">My files</button>`];
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
		dialog.innerHTML = `<form method="dialog" class="dialog-body"><h2>${html(title)}</h2><p class="muted">${html(message)}</p><div class="dialog-actions"><button class="button" value="cancel">Cancel</button><button class="button danger" value="confirm">${html(confirmLabel)}</button></div></form>`;
		document.body.append(dialog);
		dialog.addEventListener('close', () => {
			const confirmed = dialog.returnValue === 'confirm';
			dialog.remove();
			resolve(confirmed);
		});
		dialog.showModal();
	});
}

async function renderFiles(): Promise<void> {
	shell('files', 'Files');
	const content = document.querySelector<HTMLDivElement>('#page-content')!;
	try {
		const listing = await api.listFiles(currentPath);
		if (pageFromPath() !== 'files' || listing.path !== currentPath) return;
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
			<button class="button" id="mkdir"><i data-lucide="folder-plus"></i><span>New folder</span></button>
			<button class="button primary" id="upload"><i data-lucide="upload"></i><span>Upload</span></button>
			<input type="file" id="file-input" hidden multiple>
		</div><div id="upload-status"></div>
		${rows ? `<table class="file-table"><thead><tr><th class="file-name">Name</th><th>Size</th><th>Modified</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty-state"><div><i data-lucide="folder-open"></i><div>This folder is empty</div></div></div>'}`;
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
					await renderFiles();
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
					await renderFiles();
				} catch (error) {
					toast(errorMessage(error));
				}
			}),
		);
		content.querySelector('#mkdir')?.addEventListener('click', async () => {
			const name = await openTextDialog('New folder', 'Folder name');
			if (!name || name.includes('/')) return;
			try {
				await api.mkdir(currentPath ? `${currentPath}/${name}` : name);
				await renderFiles();
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
			await renderFiles();
		});
	} catch (error) {
		content.innerHTML = `<div class="error-banner">${html(errorMessage(error))}</div>`;
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

async function eventDialog(
	calendar: CalendarSummary,
	existing?: CalendarEvent,
	defaultDate?: Date,
): Promise<'saved' | 'deleted' | null> {
	return new Promise((resolve) => {
		const start = existing ? new Date(existing.start) : new Date(defaultDate ?? new Date());
		if (!existing) start.setHours(9, 0, 0, 0);
		const end = existing ? new Date(existing.end) : new Date(start.getTime() + 60 * 60_000);
		const dialog = document.createElement('dialog');
		dialog.innerHTML = `<form class="dialog-body" id="event-form"><h2>${existing ? 'Edit event' : 'New event'}</h2>
			<div class="field"><label for="event-title">Title</label><input class="input" id="event-title" value="${html(existing?.title ?? '')}" required></div>
			<div class="field"><label for="event-start">Starts</label><input class="input" type="datetime-local" id="event-start" value="${inputDate(start.toISOString())}" required></div>
			<div class="field"><label for="event-end">Ends</label><input class="input" type="datetime-local" id="event-end" value="${inputDate(end.toISOString())}" required></div>
			<div class="field"><label><input type="checkbox" id="event-all-day" ${existing?.allDay ? 'checked' : ''}> All day</label></div>
			<div class="field"><label for="event-location">Location</label><input class="input" id="event-location" value="${html(existing?.location ?? '')}"></div>
			<div class="field"><label for="event-description">Description</label><textarea class="input" id="event-description">${html(existing?.description ?? '')}</textarea></div>
			<div class="dialog-actions">${existing ? '<button type="button" class="button danger danger-zone" id="event-delete">Delete</button>' : ''}<button type="button" class="button" id="event-cancel">Cancel</button><button class="button primary">Save</button></div>
		</form>`;
		document.body.append(dialog);
		const finish = (result: 'saved' | 'deleted' | null) => {
			dialog.close();
			dialog.remove();
			resolve(result);
		};
		dialog.querySelector('#event-cancel')?.addEventListener('click', () => finish(null));
		dialog.querySelector('#event-delete')?.addEventListener('click', async () => {
			if (!existing || !(await confirmAction('Delete event?', existing.title))) return;
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
				await api.putEvent(calendar.id, {
					uid: existing?.uid,
					title: value('#event-title'),
					start: new Date(value('#event-start')).toISOString(),
					end: new Date(value('#event-end')).toISOString(),
					allDay: dialog.querySelector<HTMLInputElement>('#event-all-day')!.checked,
					location: value('#event-location'),
					description: dialog.querySelector<HTMLTextAreaElement>('#event-description')!.value,
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

async function renderCalendar(): Promise<void> {
	shell('calendar', 'Calendar');
	const content = document.querySelector<HTMLDivElement>('#page-content')!;
	try {
		const calendars = await api.calendars();
		if (calendars.length === 0) {
			content.innerHTML = '<div class="empty-state"><div>No calendars</div></div>';
			return;
		}
		const calendar = calendars[0];
		const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
		const gridStart = new Date(first);
		gridStart.setDate(1 - first.getDay());
		const gridEnd = new Date(gridStart);
		gridEnd.setDate(gridEnd.getDate() + 42);
		const events = await api.events(calendar.id, gridStart.toISOString(), gridEnd.toISOString());
		if (pageFromPath() !== 'calendar') return;
		const today = localDateKey(new Date());
		const cells: string[] = [];
		for (let offset = 0; offset < 42; offset += 1) {
			const date = new Date(gridStart);
			date.setDate(gridStart.getDate() + offset);
			const key = localDateKey(date);
			const dayEvents = events.filter((item) => localDateKey(new Date(item.start)) === key);
			cells.push(
				`<div class="day-cell ${date.getMonth() !== calendarCursor.getMonth() ? 'outside' : ''} ${key === today ? 'today' : ''}" data-day="${key}"><span class="day-number">${date.getDate()}</span>${dayEvents.map((item) => `<button class="event-chip" data-event="${html(item.uid)}" style="--event-color:${html(calendar.color)}" title="${html(item.title)}">${item.allDay ? '' : `${new Date(item.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} `}${html(item.title)}</button>`).join('')}</div>`,
			);
		}
		content.innerHTML = `<div class="calendar-toolbar"><button class="button icon-button" id="cal-prev" title="Previous month" aria-label="Previous month"><i data-lucide="chevron-left"></i></button><button class="button" id="cal-today">Today</button><button class="button icon-button" id="cal-next" title="Next month" aria-label="Next month"><i data-lucide="chevron-right"></i></button><h2>${calendarCursor.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2><span class="toolbar-spacer"></span><button class="button primary" id="new-event"><i data-lucide="plus"></i><span>New event</span></button></div>
			<div class="calendar"><div class="weekday-row">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => `<div class="weekday">${day}</div>`).join('')}</div><div class="month-grid">${cells.join('')}</div></div>`;
		refreshIcons();
		content.querySelector('#cal-prev')?.addEventListener('click', () => {
			calendarCursor.setMonth(calendarCursor.getMonth() - 1);
			void renderCalendar();
		});
		content.querySelector('#cal-next')?.addEventListener('click', () => {
			calendarCursor.setMonth(calendarCursor.getMonth() + 1);
			void renderCalendar();
		});
		content.querySelector('#cal-today')?.addEventListener('click', () => {
			calendarCursor = new Date();
			calendarCursor.setDate(1);
			void renderCalendar();
		});
		content.querySelector('#new-event')?.addEventListener('click', async () => {
			if (await eventDialog(calendar)) await renderCalendar();
		});
		content.querySelectorAll<HTMLElement>('[data-day]').forEach((cell) =>
			cell.addEventListener('dblclick', async (event) => {
				if ((event.target as HTMLElement).closest('[data-event]')) return;
				if (await eventDialog(calendar, undefined, new Date(`${cell.dataset.day}T00:00:00`))) await renderCalendar();
			}),
		);
		content.querySelectorAll<HTMLElement>('[data-event]').forEach((item) =>
			item.addEventListener('click', async () => {
				const event = events.find((candidate) => candidate.uid === item.dataset.event);
				if (event && (await eventDialog(calendar, event))) await renderCalendar();
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
		'Settings',
		`<div class="settings">
		<section class="settings-section"><h2>Connection</h2>
			<div class="field"><label>WebDAV URL</label><div class="input-row"><input class="input" readonly value="${html(davOrigin)}/"><button class="button icon-button" data-copy="${html(davOrigin)}/" title="Copy WebDAV URL" aria-label="Copy WebDAV URL"><i data-lucide="copy"></i></button></div></div>
			<div class="field"><label>CalDAV URL</label><div class="input-row"><input class="input" readonly value="${html(davOrigin)}/caldav/"><button class="button icon-button" data-copy="${html(davOrigin)}/caldav/" title="Copy CalDAV URL" aria-label="Copy CalDAV URL"><i data-lucide="copy"></i></button></div></div>
		</section>
		<section class="settings-section"><h2>API</h2><div class="field"><label>Base URL</label><input class="input" readonly value="${html(API_BASE || location.origin)}"></div></section>
		<section class="settings-section"><h2>Session</h2><button class="button danger" id="settings-logout"><i data-lucide="log-out"></i><span>Log out</span></button></section>
	</div>`,
	);
	document.querySelectorAll<HTMLElement>('[data-copy]').forEach((button) =>
		button.addEventListener('click', async () => {
			await navigator.clipboard.writeText(button.dataset.copy!);
			toast('Copied');
		}),
	);
	document.querySelector('#settings-logout')?.addEventListener('click', async () => {
		await api.logout();
		navigate('/login');
	});
	refreshIcons();
}

function renderLogin(): void {
	app.innerHTML = `<main class="login-page"><section class="login-panel">
		<div class="login-brand"><span class="brand-mark"><i data-lucide="cloud"></i></span><span>R2 Workspace</span></div>
		<h1>Welcome back</h1><p>Sign in to continue to your workspace.</p>
		<form class="login-form" id="login-form"><div class="field"><label for="username">Username</label><input class="input" id="username" autocomplete="username" required></div><div class="field"><label for="password">Password</label><input class="input" id="password" type="password" autocomplete="current-password" required></div><div id="login-error"></div><button class="button primary" id="login-submit">Continue</button></form>
	</section><aside class="login-visual" aria-hidden="true"><div class="storage-figure"><div class="storage-line"><i data-lucide="folder"></i><span>Documents</span></div><div class="storage-line"><i data-lucide="calendar-days"></i><span>Calendar</span></div><div class="storage-line"><i data-lucide="cloud"></i><span>R2 storage</span></div></div></aside></main>`;
	refreshIcons();
	document.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', async (event) => {
		event.preventDefault();
		const submit = document.querySelector<HTMLButtonElement>('#login-submit')!;
		const error = document.querySelector<HTMLDivElement>('#login-error')!;
		submit.disabled = true;
		submit.textContent = 'Signing in…';
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
			submit.textContent = 'Continue';
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
	if (location.pathname === '/' || !['/files', '/calendar', '/settings'].includes(location.pathname))
		history.replaceState({}, '', `/${page}`);
	if (page === 'files') await renderFiles();
	else if (page === 'calendar') await renderCalendar();
	else renderSettings();
}

window.addEventListener('popstate', () => void render());
void render();
