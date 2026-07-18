import type { ApiErrorCode, ApiResponse, Note, NoteFolder, NotePage } from '@r2-webdav/shared-types';

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
	folder_id: string | null;
}

interface FolderRow {
	id: string;
	name: string;
	note_count: number;
	created_at: string;
	updated_at: string;
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
		folderId: row.folder_id,
	};
}

function folder(row: FolderRow): NoteFolder {
	return {
		id: row.id,
		name: row.name,
		noteCount: Number(row.note_count),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function folderExists(env: Env, owner: string, id: string): Promise<boolean> {
	return Boolean(
		await env.NOTES_DB.prepare('SELECT id FROM r2_webdav_note_folders WHERE id = ? AND user_id = ?')
			.bind(id, owner)
			.first(),
	);
}

async function listNotes(request: Request, env: Env, owner: string): Promise<Response> {
	const url = new URL(request.url);
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
	const pageSize = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
	const archived = url.searchParams.get('archived') === '1' ? 1 : 0;
	const folderFilter = url.searchParams.get('folder');
	if (folderFilter && folderFilter !== 'root' && !/^[0-9a-f-]{36}$/i.test(folderFilter)) {
		return error('BAD_REQUEST', 'Invalid folder ID', 400);
	}
	const offset = (page - 1) * pageSize;
	let where = 'user_id = ? AND is_archived = ?';
	const bindings: unknown[] = [owner, archived];
	if (folderFilter === 'root') where += ' AND folder_id IS NULL';
	else if (folderFilter) {
		where += ' AND folder_id = ?';
		bindings.push(folderFilter);
	}
	const [rows, count] = await Promise.all([
		env.NOTES_DB.prepare(
			`SELECT id, title, content, is_pinned, is_archived, created_at, updated_at, accessed_at, folder_id
			 FROM r2_webdav_notes WHERE ${where}
			 ORDER BY is_pinned DESC, updated_at DESC LIMIT ? OFFSET ?`,
		)
			.bind(...bindings, pageSize, offset)
			.all<NoteRow>(),
		env.NOTES_DB.prepare(`SELECT COUNT(*) AS total FROM r2_webdav_notes WHERE ${where}`)
			.bind(...bindings)
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
	const input = await readJson<{ title?: string; content?: string; folderId?: string }>(request);
	if (!input) return error('BAD_REQUEST', 'Invalid note body', 400);
	const title = input.title?.trim() || 'Untitled note';
	if (title.length > 200) return error('BAD_REQUEST', 'Note title is too long', 400);
	const folderId = input.folderId ?? null;
	if (folderId && (!/^[0-9a-f-]{36}$/i.test(folderId) || !(await folderExists(env, owner, folderId)))) {
		return error('BAD_REQUEST', 'Folder not found', 400);
	}
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.NOTES_DB.prepare(
		`INSERT INTO r2_webdav_notes
			 (id, user_id, title, content, is_pinned, is_archived, created_at, updated_at, accessed_at, folder_id)
			 VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
	)
		.bind(id, owner, title, input.content ?? '', now, now, now, folderId)
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
			folderId,
		} satisfies Note,
		201,
	);
}

async function updateNote(request: Request, env: Env, owner: string, id: string): Promise<Response> {
	const input = await readJson<{ title?: string; content?: string; pinned?: boolean; archived?: boolean; folderId?: string | null }>(request);
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
	if (input.folderId !== undefined) {
		if (input.folderId && (!/^[0-9a-f-]{36}$/i.test(input.folderId) || !(await folderExists(env, owner, input.folderId)))) {
			return error('BAD_REQUEST', 'Folder not found', 400);
		}
		updates.push('folder_id = ?');
		values.push(input.folderId);
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
		'SELECT id, title, content, is_pinned, is_archived, created_at, updated_at, accessed_at, folder_id FROM r2_webdav_notes WHERE id = ? AND user_id = ?',
	)
		.bind(id, owner)
		.first<NoteRow>();
	return data(note(row!));
}

async function listFolders(env: Env, owner: string): Promise<Response> {
	const rows = await env.NOTES_DB.prepare(
		`SELECT f.id, f.name, f.created_at, f.updated_at, COUNT(n.id) AS note_count
		 FROM r2_webdav_note_folders f
		 LEFT JOIN r2_webdav_notes n ON n.folder_id = f.id AND n.user_id = f.user_id AND n.is_archived = 0
		 WHERE f.user_id = ?
		 GROUP BY f.id, f.name, f.created_at, f.updated_at
		 ORDER BY f.name COLLATE NOCASE`,
	)
		.bind(owner)
		.all<FolderRow>();
	return data(rows.results.map(folder));
}

async function createFolder(request: Request, env: Env, owner: string): Promise<Response> {
	const input = await readJson<{ name?: string }>(request);
	const name = input?.name?.trim() ?? '';
	if (!name || name.length > 100) return error('BAD_REQUEST', 'A folder name between 1 and 100 characters is required', 400);
	const existing = await env.NOTES_DB.prepare('SELECT id FROM r2_webdav_note_folders WHERE user_id = ? AND name = ? COLLATE NOCASE')
		.bind(owner, name)
		.first();
	if (existing) return error('CONFLICT', 'A folder with this name already exists', 409);
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await env.NOTES_DB.prepare(
		'INSERT INTO r2_webdav_note_folders (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
	)
		.bind(id, owner, name, now, now)
		.run();
	return data({ id, name, noteCount: 0, createdAt: now, updatedAt: now } satisfies NoteFolder, 201);
}

async function renameFolder(request: Request, env: Env, owner: string, id: string): Promise<Response> {
	const input = await readJson<{ name?: string }>(request);
	const name = input?.name?.trim() ?? '';
	if (!name || name.length > 100) return error('BAD_REQUEST', 'A folder name between 1 and 100 characters is required', 400);
	const now = new Date().toISOString();
	try {
		const result = await env.NOTES_DB.prepare(
			'UPDATE r2_webdav_note_folders SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?',
		)
			.bind(name, now, id, owner)
			.run();
		if (!(result.meta.changes ?? 0)) return error('NOT_FOUND', 'Folder not found', 404);
	} catch {
		return error('CONFLICT', 'A folder with this name already exists', 409);
	}
	const row = await env.NOTES_DB.prepare(
		`SELECT f.id, f.name, f.created_at, f.updated_at, COUNT(n.id) AS note_count
		 FROM r2_webdav_note_folders f LEFT JOIN r2_webdav_notes n ON n.folder_id = f.id AND n.is_archived = 0
		 WHERE f.id = ? AND f.user_id = ? GROUP BY f.id, f.name, f.created_at, f.updated_at`,
	)
		.bind(id, owner)
		.first<FolderRow>();
	return data(folder(row!));
}

async function deleteFolder(env: Env, owner: string, id: string): Promise<Response> {
	if (!(await folderExists(env, owner, id))) return error('NOT_FOUND', 'Folder not found', 404);
	await env.NOTES_DB.batch([
		env.NOTES_DB.prepare('UPDATE r2_webdav_notes SET folder_id = NULL WHERE folder_id = ? AND user_id = ?').bind(id, owner),
		env.NOTES_DB.prepare('DELETE FROM r2_webdav_note_folders WHERE id = ? AND user_id = ?').bind(id, owner),
	]);
	return data({ deleted: true });
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
		const rawId = Array.isArray(params.id) ? params.id : typeof params.id === 'string' ? params.id.split('/') : [];
		if (rawId[0] === 'folders') {
			const folderId = rawId[1];
			if (folderId && !/^[0-9a-f-]{36}$/i.test(folderId)) return error('BAD_REQUEST', 'Invalid folder ID', 400);
			if (!folderId && request.method === 'GET') return listFolders(env, owner);
			if (!folderId && request.method === 'POST') return createFolder(request, env, owner);
			if (folderId && request.method === 'PATCH') return renameFolder(request, env, owner, folderId);
			if (folderId && request.method === 'DELETE') return deleteFolder(env, owner, folderId);
			return error('NOT_FOUND', 'Folder endpoint not found', 404);
		}
		const id = rawId[0] || null;
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
