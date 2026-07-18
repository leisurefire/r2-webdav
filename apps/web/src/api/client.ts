import type {
	ApiResponse,
	CalendarEvent,
	CalendarSummary,
	DeviceSession,
	FileListing,
	Note,
	NotePage,
} from '@r2-webdav/shared-types';

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
const TOKEN_KEY = 'r2_session_token';

export class ApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly code = 'INTERNAL_ERROR',
	) {
		super(message);
	}
}

function authHeaders(headers?: HeadersInit): Headers {
	const result = new Headers(headers);
	const token = localStorage.getItem(TOKEN_KEY);
	if (token) result.set('Authorization', `Bearer ${token}`);
	return result;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(`${API_BASE}/api/v1${path}`, {
		...init,
		headers: authHeaders(init.headers),
		credentials: 'include',
	});
	let payload: ApiResponse<T> | null = null;
	try {
		payload = (await response.json()) as ApiResponse<T>;
	} catch {
		throw new ApiError(response.statusText || 'Request failed', response.status);
	}
	if (!response.ok || !payload.ok) {
		const error = payload.ok ? null : payload.error;
		if (response.status === 401) localStorage.removeItem(TOKEN_KEY);
		throw new ApiError(error?.message ?? 'Request failed', response.status, error?.code);
	}
	return payload.data;
}

export const api = {
	async login(username: string, password: string): Promise<void> {
		const result = await request<{ token: string; expiresAt: string }>('/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password }),
		});
		localStorage.setItem(TOKEN_KEY, result.token);
	},
	async logout(): Promise<void> {
		try {
			await request('/auth/logout', { method: 'POST' });
		} finally {
			localStorage.removeItem(TOKEN_KEY);
		}
	},
	listFiles(path: string): Promise<FileListing> {
		return request(`/fs?path=${encodeURIComponent(path)}`);
	},
	fileInfo(path: string): Promise<{ downloadUrl: string; contentType: string }> {
		return request(`/fs/content?path=${encodeURIComponent(path)}`);
	},
	async download(path: string): Promise<void> {
		const response = await fetch(`${API_BASE}/api/v1/fs/content?path=${encodeURIComponent(path)}&download=1`, {
			headers: authHeaders(),
			credentials: 'include',
		});
		if (!response.ok) throw new ApiError('Download failed', response.status);
		const objectUrl = URL.createObjectURL(await response.blob());
		const anchor = document.createElement('a');
		anchor.href = objectUrl;
		anchor.download = path.split('/').at(-1) ?? 'download';
		anchor.click();
		URL.revokeObjectURL(objectUrl);
	},
	upload(path: string, file: File, onProgress: (progress: number) => void): Promise<void> {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open('PUT', `${API_BASE}/api/v1/fs/content?path=${encodeURIComponent(path)}`);
			xhr.withCredentials = true;
			xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
			const token = localStorage.getItem(TOKEN_KEY);
			if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
			xhr.upload.addEventListener('progress', (event) =>
				onProgress(event.lengthComputable ? event.loaded / event.total : 0),
			);
			xhr.addEventListener('load', () =>
				xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError('Upload failed', xhr.status)),
			);
			xhr.addEventListener('error', () => reject(new ApiError('Network error', 0)));
			xhr.send(file);
		});
	},
	mkdir(path: string): Promise<unknown> {
		return request('/fs/mkdir', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path }),
		});
	},
	move(from: string, to: string): Promise<unknown> {
		return request('/fs/move', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ from, to }),
		});
	},
	deleteFile(path: string): Promise<unknown> {
		return request(`/fs?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
	},
	calendars(): Promise<CalendarSummary[]> {
		return request('/calendars');
	},
	events(calendarId: string, from: string, to: string): Promise<CalendarEvent[]> {
		return request(
			`/calendars/${encodeURIComponent(calendarId)}/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
		);
	},
	putEvent(calendarId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> {
		return request(`/calendars/${encodeURIComponent(calendarId)}/events`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(event),
		});
	},
	deleteEvent(calendarId: string, uid: string): Promise<unknown> {
		return request(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(uid)}`, {
			method: 'DELETE',
		});
	},
	devices(): Promise<DeviceSession[]> {
		return request('/auth/devices');
	},
	deleteDevice(id: string): Promise<{ deleted: boolean; current: boolean }> {
		return request(`/auth/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
	},
	notes(page = 1, archived = false): Promise<NotePage> {
		return request(`/notes?page=${page}&limit=20&archived=${archived ? '1' : '0'}`);
	},
	createNote(title: string, content = ''): Promise<Note> {
		return request('/notes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title, content }),
		});
	},
	updateNote(id: string, changes: Partial<Pick<Note, 'title' | 'content' | 'pinned' | 'archived'>>): Promise<Note> {
		return request(`/notes/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(changes),
		});
	},
	deleteNote(id: string): Promise<{ deleted: boolean }> {
		return request(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
	},
};

export function hasSession(): boolean {
	return localStorage.getItem(TOKEN_KEY) !== null;
}
