import type { CalendarEvent, CalendarSummary, FileEntry, Note, NotePage } from '@r2-webdav/shared-types';
import type { Env } from '../env';
import {
	createSession,
	ensureDatabase,
	listSessions,
	revokeRequestSession,
	revokeSession,
	sessionCookie,
	type SessionContext,
	verifyCredentials,
} from '../auth';
import { handleWebDav } from '../webdav';
import { createIcs, parseIcs } from '../shared/ical';
import { errorFromStatus, jsonData, jsonError } from '../shared/http';
import { bumpCalendarCtag, calendarKey, fileKey, listAll, normalizePath, readCalendarMeta } from '../shared/storage';

async function readJson<T>(request: Request): Promise<T | null> {
	try {
		return (await request.json()) as T;
	} catch {
		return null;
	}
}

function pathUrl(path: string): string {
	return `https://dav.internal/${path.split('/').map(encodeURIComponent).join('/')}`;
}

async function davMutation(
	request: Request,
	env: Env,
	method: string,
	path: string,
	headers?: HeadersInit,
): Promise<Response> {
	const davHeaders = new Headers(headers);
	for (const name of ['If-Match', 'If-None-Match', 'If', 'Lock-Token', 'Content-Type']) {
		const value = request.headers.get(name);
		if (value !== null && !davHeaders.has(name)) davHeaders.set(name, value);
	}
	const response = await handleWebDav(
		new Request(pathUrl(path), {
			method,
			headers: davHeaders,
			body: method === 'PUT' ? request.body : undefined,
		}),
		env.bucket,
	);
	if (!response.ok) return errorFromStatus(response.status, (await response.text()) || 'File operation failed');
	return jsonData({ status: response.status }, { status: response.status === 204 ? 200 : response.status });
}

async function listFiles(url: URL, env: Env): Promise<Response> {
	const path = normalizePath(url.searchParams.get('path') ?? '');
	if (path === null) return jsonError('BAD_REQUEST', 'Invalid path');
	const key = fileKey(path);
	if (path !== '') {
		const directory = await env.bucket.head(key);
		if (directory === null || directory.customMetadata?.resourcetype !== '<collection />') {
			return jsonError('NOT_FOUND', 'Directory not found', 404);
		}
	}
	const prefix = `${key}/`;
	let cursor: string | undefined;
	const entries: FileEntry[] = [];
	do {
		const page = await env.bucket.list({
			prefix,
			delimiter: '/',
			cursor,
			include: ['httpMetadata', 'customMetadata'],
		});
		for (const object of page.objects) {
			if (object.key === key || object.key.endsWith('/.meta.json')) continue;
			const relative = object.key.slice(prefix.length);
			if (relative === '' || relative.includes('/')) continue;
			entries.push({
				name: relative,
				path: path ? `${path}/${relative}` : relative,
				type: object.customMetadata?.resourcetype === '<collection />' ? 'directory' : 'file',
				size: object.size,
				contentType: object.httpMetadata?.contentType,
				modifiedAt: object.uploaded.toISOString(),
				etag: object.httpEtag,
			});
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
	return jsonData({ path, entries });
}

async function getContent(request: Request, url: URL, env: Env): Promise<Response> {
	const path = normalizePath(url.searchParams.get('path'));
	if (!path) return jsonError('BAD_REQUEST', 'A file path is required');
	const object = await env.bucket.get(fileKey(path), { range: request.headers, onlyIf: request.headers });
	if (object === null) return jsonError('NOT_FOUND', 'File not found', 404);
	if (!('body' in object)) return jsonError('PRECONDITION_FAILED', 'File precondition failed', 412);
	if (object.customMetadata?.resourcetype === '<collection />') return jsonError('BAD_REQUEST', 'Path is a directory');
	if (url.searchParams.get('download') === '1') {
		return new Response(object.body, {
			status: request.headers.has('Range') && object.range ? 206 : 200,
			headers: {
				'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
				'Content-Length': String(object.size),
				ETag: object.httpEtag,
				'Accept-Ranges': 'bytes',
				'Content-Disposition':
					object.httpMetadata?.contentDisposition ??
					`inline; filename="${encodeURIComponent(path.split('/').at(-1)!)}"`,
			},
		});
	}
	return jsonData({
		path,
		name: path.split('/').at(-1),
		size: object.size,
		contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
		modifiedAt: object.uploaded.toISOString(),
		etag: object.httpEtag,
		downloadUrl: `/api/v1/fs/content?path=${encodeURIComponent(path)}&download=1`,
	});
}

async function listCalendars(env: Env): Promise<Response> {
	const root = 'caldav/default/calendars/';
	const calendars: CalendarSummary[] = [];
	for (const object of await listAll(env.bucket, root)) {
		if (object.key.split('/').length !== 4 || !object.customMetadata?.resourcetype?.includes('calendar')) continue;
		const id = object.key.split('/').at(-1)!;
		const meta = await readCalendarMeta(env.bucket, id);
		calendars.push({
			id,
			displayName: meta?.displayName ?? id,
			color: meta?.color ?? '#10a37f',
			ctag: meta?.ctag ?? object.customMetadata.ctag ?? '1',
		});
	}
	return jsonData(calendars);
}

async function listEvents(url: URL, env: Env, calendarId: string): Promise<Response> {
	if ((await env.bucket.head(calendarKey(calendarId))) === null)
		return jsonError('NOT_FOUND', 'Calendar not found', 404);
	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	const events: CalendarEvent[] = [];
	for (const object of await listAll(env.bucket, `${calendarKey(calendarId)}/`)) {
		if (!object.key.endsWith('.ics')) continue;
		const body = await env.bucket.get(object.key);
		if (body === null) continue;
		try {
			const event = parseIcs(await body.text(), calendarId);
			if (from && Date.parse(event.end) < Date.parse(from)) continue;
			if (to && Date.parse(event.start) >= Date.parse(to)) continue;
			event.etag = object.httpEtag;
			events.push(event);
		} catch {
			// Malformed third-party resources remain accessible through CalDAV but are omitted from JSON views.
		}
	}
	events.sort((a, b) => a.start.localeCompare(b.start));
	return jsonData(events);
}

async function putEvent(request: Request, env: Env, calendarId: string): Promise<Response> {
	if ((await env.bucket.head(calendarKey(calendarId))) === null)
		return jsonError('NOT_FOUND', 'Calendar not found', 404);
	const input = await readJson<Partial<CalendarEvent>>(request);
	if (!input || !input.title || !input.start || !input.end) {
		return jsonError('BAD_REQUEST', 'title, start and end are required');
	}
	if (
		!Number.isFinite(Date.parse(input.start)) ||
		!Number.isFinite(Date.parse(input.end)) ||
		Date.parse(input.end) <= Date.parse(input.start)
	) {
		return jsonError('BAD_REQUEST', 'Event dates are invalid');
	}
	const uid = input.uid?.trim() || crypto.randomUUID();
	if (!/^[A-Za-z0-9._@-]{1,200}$/.test(uid))
		return jsonError('BAD_REQUEST', 'Event UID contains unsupported characters');
	const event: CalendarEvent = {
		uid,
		title: input.title.trim(),
		start: new Date(input.start).toISOString(),
		end: new Date(input.end).toISOString(),
		allDay: Boolean(input.allDay),
		description: input.description?.trim() || undefined,
		location: input.location?.trim() || undefined,
		calendarId,
	};
	const key = calendarKey(calendarId, `${uid}.ics`);
	const existing = await env.bucket.head(key);
	await env.bucket.put(key, createIcs(event), { httpMetadata: { contentType: 'text/calendar; charset=utf-8' } });
	await bumpCalendarCtag(env.bucket, calendarId);
	return jsonData(event, { status: existing ? 200 : 201 });
}

async function deleteEvent(env: Env, calendarId: string, uid: string): Promise<Response> {
	if (!/^[A-Za-z0-9._@-]{1,200}$/.test(uid)) return jsonError('BAD_REQUEST', 'Invalid event UID');
	const key = calendarKey(calendarId, `${uid}.ics`);
	if ((await env.bucket.head(key)) === null) return jsonError('NOT_FOUND', 'Event not found', 404);
	await env.bucket.delete(key);
	await bumpCalendarCtag(env.bucket, calendarId);
	return jsonData({ deleted: true });
}

interface NoteRow {
	id: string;
	title: string;
	content: string;
	is_pinned: number;
	is_archived: number;
	created_at: string;
	updated_at: string;
	accessed_at: string;
}

function noteFromRow(row: NoteRow): Note {
	return {
		id: row.id,
		title: row.title,
		content: row.content,
		pinned: Boolean(row.is_pinned),
		archived: Boolean(row.is_archived),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		accessedAt: row.accessed_at,
	};
}

async function listNotes(url: URL, env: Env, session: SessionContext): Promise<Response> {
	await ensureDatabase(env);
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
	const pageSize = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
	const archived = url.searchParams.get('archived') === '1' ? 1 : 0;
	const offset = (page - 1) * pageSize;
	const [rows, count] = await Promise.all([
		env.notes
			.prepare(
				`SELECT id, title, content, is_pinned, is_archived, created_at, updated_at, accessed_at
				FROM user_notes WHERE user_id = ? AND is_archived = ?
				ORDER BY is_pinned DESC, updated_at DESC LIMIT ? OFFSET ?`,
			)
			.bind(session.userId, archived, pageSize, offset)
			.all<NoteRow>(),
		env.notes
			.prepare('SELECT COUNT(*) AS total FROM user_notes WHERE user_id = ? AND is_archived = ?')
			.bind(session.userId, archived)
			.first<{ total: number }>(),
	]);
	const now = new Date().toISOString();
	if (rows.results.length) {
		await env.notes.batch(
			rows.results.map((row) =>
				env.notes
					.prepare('UPDATE user_notes SET accessed_at = ? WHERE id = ? AND user_id = ?')
					.bind(now, row.id, session.userId),
			),
		);
	}
	const total = Number(count?.total ?? 0);
	const result: NotePage = {
		items: rows.results.map((row) => noteFromRow({ ...row, accessed_at: now })),
		page,
		pageSize,
		total,
		hasMore: offset + rows.results.length < total,
	};
	return jsonData(result);
}

async function createNote(request: Request, env: Env, session: SessionContext): Promise<Response> {
	await ensureDatabase(env);
	const input = await readJson<{ title?: string; content?: string }>(request);
	const title = input?.title?.trim();
	if (!title) return jsonError('BAD_REQUEST', 'A note title is required');
	if (title.length > 200) return jsonError('BAD_REQUEST', 'Note title is too long');
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.notes
		.prepare(
			`INSERT INTO user_notes (id, user_id, title, content, is_pinned, is_archived, created_at, updated_at, accessed_at)
			VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)`,
		)
		.bind(id, session.userId, title, input?.content ?? '', now, now, now)
		.run();
	return jsonData(
		{
			id,
			title,
			content: input?.content ?? '',
			pinned: false,
			archived: false,
			createdAt: now,
			updatedAt: now,
			accessedAt: now,
		} satisfies Note,
		{ status: 201 },
	);
}

async function updateNote(request: Request, env: Env, session: SessionContext, id: string): Promise<Response> {
	await ensureDatabase(env);
	const input = await readJson<{ title?: string; content?: string; pinned?: boolean; archived?: boolean }>(request);
	if (!input) return jsonError('BAD_REQUEST', 'Invalid note body');
	if (input.title !== undefined && (!input.title.trim() || input.title.trim().length > 200))
		return jsonError('BAD_REQUEST', 'A title between 1 and 200 characters is required');
	const updates: string[] = [];
	const values: unknown[] = [];
	if (input.title !== undefined) {
		updates.push('title = ?');
		values.push(input.title.trim());
	}
	if (input.content !== undefined) {
		updates.push('content = ?');
		values.push(input.content);
	}
	if (input.pinned !== undefined) {
		updates.push('is_pinned = ?');
		values.push(input.pinned ? 1 : 0);
	}
	if (input.archived !== undefined) {
		updates.push('is_archived = ?');
		values.push(input.archived ? 1 : 0);
	}
	if (!updates.length) return jsonError('BAD_REQUEST', 'No note changes supplied');
	const now = new Date().toISOString();
	updates.push('updated_at = ?', 'accessed_at = ?');
	values.push(now, now, id, session.userId);
	const changed = await env.notes
		.prepare(`UPDATE user_notes SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
		.bind(...values)
		.run();
	if (!(changed.meta.changes ?? 0)) return jsonError('NOT_FOUND', 'Note not found', 404);
	const row = await env.notes
		.prepare(
			'SELECT id, title, content, is_pinned, is_archived, created_at, updated_at, accessed_at FROM user_notes WHERE id = ? AND user_id = ?',
		)
		.bind(id, session.userId)
		.first<NoteRow>();
	return jsonData(noteFromRow(row!));
}

async function deleteNote(env: Env, session: SessionContext, id: string): Promise<Response> {
	await ensureDatabase(env);
	const result = await env.notes
		.prepare('DELETE FROM user_notes WHERE id = ? AND user_id = ?')
		.bind(id, session.userId)
		.run();
	if (!(result.meta.changes ?? 0)) return jsonError('NOT_FOUND', 'Note not found', 404);
	return jsonData({ deleted: true });
}

export async function handleApi(request: Request, env: Env, session: SessionContext | null = null): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.slice('/api/v1'.length);
	if (path === '/health' && request.method === 'GET') return jsonData({ status: 'ok' });
	if (path === '/auth/login' && request.method === 'POST') {
		const credentials = await readJson<{ username?: string; password?: string }>(request);
		if (!credentials || !verifyCredentials(credentials.username ?? '', credentials.password ?? '', env)) {
			return jsonError('UNAUTHORIZED', 'Invalid username or password', 401);
		}
		try {
			const created = await createSession(request, env);
			return jsonData(
				{ token: created.token, expiresAt: created.expiresAt },
				{
					headers: {
						'Set-Cookie': sessionCookie(created.token),
					},
				},
			);
		} catch {
			return jsonError('INTERNAL_ERROR', 'Unable to create a session', 500);
		}
	}
	if (path === '/auth/logout' && request.method === 'POST') {
		await revokeRequestSession(request, env);
		return jsonData(
			{ loggedOut: true },
			{ headers: { 'Set-Cookie': 'r2_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' } },
		);
	}
	if (path === '/auth/devices' && request.method === 'GET' && session) {
		return jsonData(await listSessions(env, session.id, session.userId));
	}
	const deviceMatch = path.match(/^\/auth\/devices\/([0-9a-f-]{36})$/i);
	if (deviceMatch && request.method === 'DELETE' && session) {
		const deleted = await revokeSession(env, deviceMatch[1], session.userId);
		if (!deleted) return jsonError('NOT_FOUND', 'Device session not found', 404);
		const current = deviceMatch[1] === session.id;
		return jsonData(
			{ deleted: true, current },
			current
				? { headers: { 'Set-Cookie': 'r2_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' } }
				: undefined,
		);
	}
	if (path === '/notes' && request.method === 'GET' && session) return listNotes(url, env, session);
	if (path === '/notes' && request.method === 'POST' && session) return createNote(request, env, session);
	const noteMatch = path.match(/^\/notes\/([0-9a-f-]{36})$/i);
	if (noteMatch && request.method === 'PATCH' && session) return updateNote(request, env, session, noteMatch[1]);
	if (noteMatch && request.method === 'DELETE' && session) return deleteNote(env, session, noteMatch[1]);
	if (path === '/fs' && request.method === 'GET') return listFiles(url, env);
	if (path === '/fs' && request.method === 'DELETE') {
		const filePath = normalizePath(url.searchParams.get('path'));
		if (!filePath) return jsonError('BAD_REQUEST', 'A path is required');
		return davMutation(request, env, 'DELETE', filePath);
	}
	if (path === '/fs/content' && request.method === 'GET') return getContent(request, url, env);
	if (path === '/fs/content' && request.method === 'PUT') {
		const filePath = normalizePath(url.searchParams.get('path'));
		if (!filePath) return jsonError('BAD_REQUEST', 'A file path is required');
		return davMutation(request, env, 'PUT', filePath);
	}
	if (path === '/fs/mkdir' && request.method === 'POST') {
		const body = await readJson<{ path?: string }>(request);
		const filePath = normalizePath(body?.path ?? null);
		if (!filePath) return jsonError('BAD_REQUEST', 'A directory path is required');
		return davMutation(request, env, 'MKCOL', filePath);
	}
	if (path === '/fs/move' && request.method === 'POST') {
		const body = await readJson<{ from?: string; to?: string; overwrite?: boolean }>(request);
		const from = normalizePath(body?.from ?? null);
		const to = normalizePath(body?.to ?? null);
		if (!from || !to) return jsonError('BAD_REQUEST', 'from and to paths are required');
		return davMutation(request, env, 'MOVE', from, {
			Destination: pathUrl(to),
			Overwrite: body?.overwrite === false ? 'F' : 'T',
		});
	}
	if (path === '/calendars' && request.method === 'GET') return listCalendars(env);
	const eventsMatch = path.match(/^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
	if (eventsMatch) {
		let calendarId: string;
		let uid: string | undefined;
		try {
			calendarId = decodeURIComponent(eventsMatch[1]);
			uid = eventsMatch[2] ? decodeURIComponent(eventsMatch[2]) : undefined;
		} catch {
			return jsonError('BAD_REQUEST', 'Invalid calendar path');
		}
		if (!/^[A-Za-z0-9._-]{1,100}$/.test(calendarId)) return jsonError('BAD_REQUEST', 'Invalid calendar ID');
		if (!uid && request.method === 'GET') return listEvents(url, env, calendarId);
		if (!uid && request.method === 'POST') return putEvent(request, env, calendarId);
		if (uid && request.method === 'DELETE') return deleteEvent(env, calendarId, uid);
	}
	return jsonError('NOT_FOUND', 'API endpoint not found', 404);
}
