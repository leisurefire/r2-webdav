import type { ApiErrorCode, ApiResponse, Note, NotePage } from '@r2-webdav/shared-types';

interface Env {
	NOTES_DB: D1Database;
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

const encoder = new TextEncoder();

function json<T>(payload: ApiResponse<T>, status = 200): Response {
	return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function error(code: ApiErrorCode, message: string, status: number): Response {
	return json({ ok: false, error: { code, message } }, status);
}

function data<T>(value: T, status = 200): Response {
	return json({ ok: true, data: value }, status);
}

async function readJson<T>(request: Request): Promise<T | null> {
	try {
		return (await request.json()) as T;
	} catch {
		return null;
	}
}

function requestToken(request: Request): string | null {
	const bearer = request.headers.get('Authorization');
	if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
	const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)r2_session=([^;]+)/);
	return cookie ? decodeURIComponent(cookie[1]) : null;
}

async function tokenHash(token: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function userId(request: Request, env: Env): Promise<string | null> {
	const token = requestToken(request);
	if (!token) return null;
	const row = await env.NOTES_DB.prepare('SELECT user_id, expires_at FROM r2_webdav_sessions WHERE token_hash = ?')
		.bind(await tokenHash(token))
		.first<{ user_id: string; expires_at: string }>();
	if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
	return row.user_id;
}

function note(row: NoteRow): Note {
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

async function listNotes(request: Request, env: Env, owner: string): Promise<Response> {
	const url = new URL(request.url);
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
	const pageSize = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
	const archived = url.searchParams.get('archived') === '1' ? 1 : 0;
	const offset = (page - 1) * pageSize;
	const [rows, count] = await Promise.all([
		env.NOTES_DB.prepare(
			`SELECT id, title, content, is_pinned, is_archived, created_at, updated_at, accessed_at
			 FROM r2_webdav_notes WHERE user_id = ? AND is_archived = ?
			 ORDER BY is_pinned DESC, updated_at DESC LIMIT ? OFFSET ?`,
		)
			.bind(owner, archived, pageSize, offset)
			.all<NoteRow>(),
		env.NOTES_DB.prepare('SELECT COUNT(*) AS total FROM r2_webdav_notes WHERE user_id = ? AND is_archived = ?')
			.bind(owner, archived)
			.first<{ total: number }>(),
	]);
	const total = Number(count?.total ?? 0);
	return data({
		items: rows.results.map(note),
		page,
		pageSize,
		total,
		hasMore: offset + rows.results.length < total,
	} satisfies NotePage);
}

async function createNote(request: Request, env: Env, owner: string): Promise<Response> {
	const input = await readJson<{ title?: string; content?: string }>(request);
	if (!input) return error('BAD_REQUEST', 'Invalid note body', 400);
	const title = input.title?.trim() || 'Untitled note';
	if (title.length > 200) return error('BAD_REQUEST', 'Note title is too long', 400);
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.NOTES_DB.prepare(
		`INSERT INTO r2_webdav_notes
		 (id, user_id, title, content, is_pinned, is_archived, created_at, updated_at, accessed_at)
		 VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)`,
	)
		.bind(id, owner, title, input.content ?? '', now, now, now)
		.run();
	return data(
		{
			id,
			title,
			content: input.content ?? '',
			pinned: false,
			archived: false,
			createdAt: now,
			updatedAt: now,
			accessedAt: now,
		} satisfies Note,
		201,
	);
}

async function updateNote(request: Request, env: Env, owner: string, id: string): Promise<Response> {
	const input = await readJson<{ title?: string; content?: string; pinned?: boolean; archived?: boolean }>(request);
	if (!input) return error('BAD_REQUEST', 'Invalid note body', 400);
	if (input.title !== undefined && (!input.title.trim() || input.title.trim().length > 200)) {
		return error('BAD_REQUEST', 'A title between 1 and 200 characters is required', 400);
	}
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
	if (!updates.length) return error('BAD_REQUEST', 'No note changes supplied', 400);
	const now = new Date().toISOString();
	updates.push('updated_at = ?', 'accessed_at = ?');
	values.push(now, now, id, owner);
	const changed = await env.NOTES_DB.prepare(
		`UPDATE r2_webdav_notes SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
	)
		.bind(...values)
		.run();
	if (!(changed.meta.changes ?? 0)) return error('NOT_FOUND', 'Note not found', 404);
	const row = await env.NOTES_DB.prepare(
		'SELECT id, title, content, is_pinned, is_archived, created_at, updated_at, accessed_at FROM r2_webdav_notes WHERE id = ? AND user_id = ?',
	)
		.bind(id, owner)
		.first<NoteRow>();
	return data(note(row!));
}

async function deleteNote(env: Env, owner: string, id: string): Promise<Response> {
	const result = await env.NOTES_DB.prepare('DELETE FROM r2_webdav_notes WHERE id = ? AND user_id = ?')
		.bind(id, owner)
		.run();
	if (!(result.meta.changes ?? 0)) return error('NOT_FOUND', 'Note not found', 404);
	return data({ deleted: true });
}

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
	try {
		const owner = await userId(request, env);
		if (!owner) return error('UNAUTHORIZED', 'Authentication required', 401);
		const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
		const id = typeof rawId === 'string' && rawId ? rawId : null;
		if (id && !/^[0-9a-f-]{36}$/i.test(id)) return error('BAD_REQUEST', 'Invalid note ID', 400);
		if (!id && request.method === 'GET') return listNotes(request, env, owner);
		if (!id && request.method === 'POST') return createNote(request, env, owner);
		if (id && request.method === 'PATCH') return updateNote(request, env, owner, id);
		if (id && request.method === 'DELETE') return deleteNote(env, owner, id);
		return error('NOT_FOUND', 'Notes endpoint not found', 404);
	} catch (cause) {
		console.error('Pages notes function failed', cause);
		return error('INTERNAL_ERROR', 'Notes database is unavailable', 500);
	}
};
