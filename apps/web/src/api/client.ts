import type {
	ApiResponse,
	BookmarkHub,
	CalendarEvent,
	CalendarSummary,
	DeviceSession,
	FileListing,
	Note,
	NoteFolder,
	NotePage,
} from '@r2-webdav/shared-types';

const configuredApiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '');
const productionApiBase = 'https://r2-webdav-x.9694151.workers.dev';
const pageHost = typeof location === 'undefined' ? '' : location.hostname;
const pageOrigin = typeof location === 'undefined' ? '' : location.origin;
const isLocalDevelopment = pageHost === 'localhost' || pageHost === '127.0.0.1';
const configuredBasePointsToPages =
	!isLocalDevelopment && Boolean(configuredApiBase) && configuredApiBase === pageOrigin;
export const API_BASE =
	configuredApiBase && !configuredBasePointsToPages ? configuredApiBase : isLocalDevelopment ? '' : productionApiBase;
const notesApiBase = ((import.meta.env.VITE_NOTES_API_BASE as string | undefined) ?? '').replace(/\/$/, '');
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

export type AiModel = 'deepseek-v4-flash' | 'deepseek-v4-pro' | 'kimi-k3';
export type AiAction = 'generate' | 'summarize' | 'polish' | 'rewrite' | 'chat';

export const AI_MODEL_FALLBACK: AiModel[] = ['deepseek-v4-flash', 'deepseek-v4-pro', 'kimi-k3'];
const AI_MODELS_KEY = 'r2_ai_models';
const AI_MODEL_ACTION_PREFIX = 'r2_ai_model_';

export function availableAiModels(): string[] {
	try {
		const stored = JSON.parse(localStorage.getItem(AI_MODELS_KEY) ?? '[]') as unknown;
		const models = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
		return models.length ? models : [...AI_MODEL_FALLBACK];
	} catch {
		return [...AI_MODEL_FALLBACK];
	}
}

export function saveAvailableAiModels(models: string[]): void {
	const unique = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
	localStorage.setItem(AI_MODELS_KEY, JSON.stringify(unique));
}

export function aiModelForAction(action: AiAction): string {
	const stored = localStorage.getItem(`${AI_MODEL_ACTION_PREFIX}${action}`);
	return stored?.trim() || AI_MODEL_FALLBACK[0];
}

export function saveAiModelForAction(action: AiAction, model: string): void {
	const value = model.trim();
	if (value) localStorage.setItem(`${AI_MODEL_ACTION_PREFIX}${action}`, value);
}

export interface AiRequest {
	model: string;
	action: AiAction;
	text: string;
	instruction?: string;
	context?: string;
	noteId?: string;
	conversationId?: string;
	contextKey?: string;
	contextLabel?: string;
}

export interface NoteChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface NoteChatSession {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	contextKey: string;
	contextLabel: string;
	messages: NoteChatMessage[];
}

function authHeaders(headers?: HeadersInit): Headers {
	const result = new Headers(headers);
	const token = localStorage.getItem(TOKEN_KEY);
	if (token) result.set('Authorization', `Bearer ${token}`);
	return result;
}

function networkErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error ?? '');
	if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
		return 'Network request failed. Check your connection and try again.';
	}
	return message || 'Request failed';
}

async function requestFrom<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
	const method = (init.method ?? 'GET').toUpperCase();
	const retryable = method === 'GET' || method === 'HEAD';
	const attempts = retryable ? 3 : 1;
	let lastError: unknown;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const controller = new AbortController();
			const timeout = window.setTimeout(() => controller.abort(), 25_000);
			const onExternalAbort = () => controller.abort();
			if (init.signal) {
				if (init.signal.aborted) controller.abort();
				else init.signal.addEventListener('abort', onExternalAbort, { once: true });
			}
			let response: Response;
			try {
				response = await fetch(`${base}/api/v1${path}`, {
					...init,
					headers: authHeaders(init.headers),
					credentials: 'include',
					signal: controller.signal,
				});
			} finally {
				window.clearTimeout(timeout);
				init.signal?.removeEventListener('abort', onExternalAbort);
			}
			let payload: ApiResponse<T> | null = null;
			try {
				payload = (await response.json()) as ApiResponse<T>;
			} catch {
				throw new ApiError(
					response.status >= 500
						? `TrueSpace is temporarily unavailable (${response.status}). Please try again shortly.`
						: response.statusText || 'Request failed',
					response.status,
				);
			}
			if (!response.ok || !payload.ok) {
				const error = payload.ok ? null : payload.error;
				if (response.status === 401) localStorage.removeItem(TOKEN_KEY);
				throw new ApiError(error?.message ?? 'Request failed', response.status, error?.code);
			}
			return payload.data;
		} catch (error) {
			lastError = error;
			const aborted = error instanceof DOMException && error.name === 'AbortError';
			const network =
				aborted ||
				error instanceof TypeError ||
				(error instanceof Error && /failed to fetch|networkerror|load failed/i.test(error.message));
			if (!network || attempt === attempts - 1) {
				if (error instanceof ApiError) throw error;
				throw new ApiError(networkErrorMessage(error), 0, 'NETWORK_ERROR');
			}
			await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
		}
	}
	throw lastError instanceof ApiError ? lastError : new ApiError(networkErrorMessage(lastError), 0, 'NETWORK_ERROR');
}

function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	return requestFrom(API_BASE, path, init);
}

function notesRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
	return requestFrom(notesApiBase, `/notes${path}`, init);
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
	fileInfo(path: string): Promise<{ downloadUrl: string; contentType: string; size: number; etag: string }> {
		return request(`/fs/content?path=${encodeURIComponent(path)}`);
	},
	async previewFile(path: string, etag?: string): Promise<Blob> {
		const cache = await caches.open('r2-file-previews-v1');
		const cacheKey = new Request(`${location.origin}/__r2_preview__/${encodeURIComponent(path)}`);
		const cached = await cache.match(cacheKey);
		if (cached && (!etag || cached.headers.get('X-R2-ETag') === etag)) return cached.blob();
		const response = await fetch(`${API_BASE}/api/v1/fs/content?path=${encodeURIComponent(path)}&download=1`, {
			headers: authHeaders(),
			credentials: 'include',
		});
		if (!response.ok) throw new ApiError('Preview failed', response.status);
		const contentLength = Number(response.headers.get('Content-Length') ?? 0);
		if (contentLength > 100 * 1024) throw new ApiError('This file is too large to preview', 413);
		const blob = await response.blob();
		const headers = new Headers(response.headers);
		if (etag) headers.set('X-R2-ETag', etag);
		await cache.put(cacheKey, new Response(blob, { headers }));
		return blob;
	},
	async clearFilePreview(path: string): Promise<void> {
		const cache = await caches.open('r2-file-previews-v1');
		await cache.delete(new Request(`${location.origin}/__r2_preview__/${encodeURIComponent(path)}`));
	},
	async saveTextFile(path: string, content: string, contentType: string, etag?: string): Promise<void> {
		const headers = new Headers({ 'Content-Type': contentType || 'text/plain; charset=utf-8' });
		if (etag) headers.set('If-Match', etag);
		const response = await fetch(`${API_BASE}/api/v1/fs/content?path=${encodeURIComponent(path)}`, {
			method: 'PUT',
			headers: authHeaders(headers),
			credentials: 'include',
			body: content,
		});
		if (!response.ok) throw new ApiError('Save failed', response.status);
		await this.clearFilePreview(path);
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
	notes(
		page = 1,
		archived = false,
		folderId?: string | null,
		options: { limit?: number; content?: boolean } = {},
	): Promise<NotePage> {
		const folder = folderId === null ? '&folder=root' : folderId ? `&folder=${encodeURIComponent(folderId)}` : '';
		const pageSize = Math.min(50, Math.max(1, options.limit ?? 50));
		const content = options.content === false ? '&content=0' : '';
		return notesRequest(`?page=${page}&limit=${pageSize}&archived=${archived ? '1' : '0'}${folder}${content}`);
	},
	getNote(id: string): Promise<Note> {
		return notesRequest(`/${encodeURIComponent(id)}`);
	},
	noteFolders(): Promise<NoteFolder[]> {
		return notesRequest('/folders');
	},
	createNoteFolder(name: string, parentId: string | null = null): Promise<NoteFolder> {
		return notesRequest('/folders', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, parentId }),
		});
	},
	updateNoteFolder(id: string, changes: { name?: string; parentId?: string | null }): Promise<NoteFolder> {
		return notesRequest(`/folders/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(changes),
		});
	},
	deleteNoteFolder(id: string): Promise<{ deleted: boolean }> {
		return notesRequest(`/folders/${encodeURIComponent(id)}`, { method: 'DELETE' });
	},
	async bookmarks(): Promise<BookmarkHub | null> {
		try {
			return await request<BookmarkHub>('/bookmarks');
		} catch (error) {
			if (error instanceof ApiError && error.status === 404) return null;
			throw error;
		}
	},
	createNote(title: string, content = '', folderId?: string | null, id?: string): Promise<Note> {
		return notesRequest('', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title,
				content,
				...(folderId ? { folderId } : {}),
				...(id ? { id } : {}),
			}),
		});
	},
	updateNote(
		id: string,
		changes: Partial<Pick<Note, 'title' | 'content' | 'pinned' | 'archived' | 'folderId'>>,
	): Promise<Note> {
		return notesRequest(`/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(changes),
		});
	},
	deleteNote(id: string): Promise<{ deleted: boolean }> {
		return notesRequest(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
	},
	async ai(request: AiRequest, onToken: (token: string) => void, signal?: AbortSignal): Promise<void> {
		const response = await fetch(`${notesApiBase}/api/v1/ai`, {
			method: 'POST',
			headers: authHeaders({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
			credentials: 'include',
			signal,
			body: JSON.stringify(request),
		});
		if (!response.ok || !response.body) {
			let message = response.statusText || 'AI request failed';
			try {
				const payload = (await response.json()) as ApiResponse<unknown>;
				if (!payload.ok) message = payload.error.message;
			} catch {
				/* keep status text */
			}
			if (response.status === 401) localStorage.removeItem(TOKEN_KEY);
			throw new ApiError(message, response.status);
		}
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		while (true) {
			const chunk = await reader.read();
			buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
			const events = buffer.split(/\n\n/);
			buffer = events.pop() ?? '';
			for (const event of events) {
				const line = event.split('\n').find((item) => item.startsWith('data:'));
				if (!line) continue;
				const value = line.slice(5).trim();
				if (value === '[DONE]') return;
				try {
					const payload = JSON.parse(value) as { choices?: Array<{ delta?: { content?: string } }> };
					const token = payload.choices?.[0]?.delta?.content;
					if (token) onToken(token);
				} catch {
					/* ignore keep-alive frames */
				}
			}
			if (chunk.done) break;
		}
	},
	async aiModels(): Promise<string[]> {
		const response = await fetch(`${notesApiBase}/api/v1/ai?resource=models`, {
			headers: authHeaders(),
			credentials: 'include',
		});
		if (!response.ok) throw new ApiError('Unable to load AI models', response.status);
		const payload = (await response.json()) as ApiResponse<{ models: string[] }>;
		if (!payload.ok) throw new ApiError(payload.error.message, response.status);
		return payload.data.models;
	},
	async noteAiChats(noteId: string): Promise<NoteChatSession[]> {
		const response = await fetch(`${notesApiBase}/api/v1/ai?resource=chats&noteId=${encodeURIComponent(noteId)}`, {
			headers: authHeaders(),
			credentials: 'include',
		});
		if (!response.ok) throw new ApiError('Unable to load AI chat history', response.status);
		const payload = (await response.json()) as ApiResponse<{ chats: NoteChatSession[] }>;
		if (!payload.ok) throw new ApiError(payload.error.message, response.status);
		return payload.data.chats;
	},
};

export function hasSession(): boolean {
	return localStorage.getItem(TOKEN_KEY) !== null;
}
