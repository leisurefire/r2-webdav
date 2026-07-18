import type { DeviceSession } from '@r2-webdav/shared-types';
import type { Env } from '../env';

const encoder = new TextEncoder();
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface SessionContext {
	id: string;
	token: string;
	userId: string;
	expiresAt: string;
}

interface SessionRow {
	id: string;
	user_id: string;
	device_name: string;
	browser: string;
	platform: string;
	device_type: DeviceSession['type'];
	ip: string | null;
	created_at: string;
	last_seen_at: string;
	expires_at: string;
}

function timingSafeEqual(left: string, right: string): boolean {
	const a = encoder.encode(left);
	const b = encoder.encode(right);
	let mismatch = a.length ^ b.length;
	const length = Math.max(a.length, b.length);
	for (let index = 0; index < length; index += 1) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
	return mismatch === 0;
}

function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function hashToken(token: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function ensureDatabase(env: Env): Promise<void> {
	await env.notes.exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			token_hash TEXT NOT NULL UNIQUE,
			device_name TEXT NOT NULL,
			browser TEXT NOT NULL,
			platform TEXT NOT NULL,
			device_type TEXT NOT NULL,
			ip TEXT,
			user_agent TEXT,
			created_at TEXT NOT NULL,
			last_seen_at TEXT NOT NULL,
			expires_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS sessions_user_expiry ON sessions(user_id, expires_at);
		CREATE TABLE IF NOT EXISTS user_notes (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			title TEXT NOT NULL,
			content TEXT NOT NULL DEFAULT '',
			is_pinned INTEGER NOT NULL DEFAULT 0,
			is_archived INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			accessed_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS notes_user_order ON user_notes(user_id, is_archived, is_pinned DESC, updated_at DESC);
	`);
}

function deviceDetails(
	request: Request,
): Omit<DeviceSession, 'id' | 'createdAt' | 'lastSeenAt' | 'expiresAt' | 'current'> {
	const userAgent = request.headers.get('User-Agent') ?? '';
	const platformHeader = request.headers.get('Sec-CH-UA-Platform')?.replaceAll('"', '');
	const platform =
		platformHeader ||
		(/Windows/i.test(userAgent)
			? 'Windows'
			: /Android/i.test(userAgent)
				? 'Android'
				: /iPhone|iPad|iPod/i.test(userAgent)
					? 'iOS'
					: /Mac OS/i.test(userAgent)
						? 'macOS'
						: /Linux/i.test(userAgent)
							? 'Linux'
							: 'Unknown');
	const browser = /Edg\//i.test(userAgent)
		? 'Edge'
		: /Firefox\//i.test(userAgent)
			? 'Firefox'
			: /Chrome\//i.test(userAgent)
				? 'Chrome'
				: /Safari\//i.test(userAgent)
					? 'Safari'
					: 'Browser';
	const type: DeviceSession['type'] = /iPad|Tablet/i.test(userAgent)
		? 'tablet'
		: /Mobile|Android|iPhone/i.test(userAgent)
			? 'mobile'
			: userAgent
				? 'desktop'
				: 'unknown';
	return {
		name: `${browser} on ${platform}`,
		browser,
		platform,
		type,
		ip: request.headers.get('CF-Connecting-IP') ?? undefined,
	};
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS): string {
	return `r2_session=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export async function createSession(request: Request, env: Env): Promise<SessionContext> {
	await ensureDatabase(env);
	const id = crypto.randomUUID();
	const secret = new Uint8Array(32);
	crypto.getRandomValues(secret);
	const token = `${id}.${base64Url(secret)}`;
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
	const device = deviceDetails(request);
	await env.notes
		.prepare(
			`INSERT INTO sessions
			(id, user_id, token_hash, device_name, browser, platform, device_type, ip, user_agent, created_at, last_seen_at, expires_at)
			VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			id,
			await hashToken(token),
			device.name,
			device.browser,
			device.platform,
			device.type,
			device.ip ?? null,
			request.headers.get('User-Agent'),
			now.toISOString(),
			now.toISOString(),
			expiresAt,
		)
		.run();
	return { id, token, userId: 'default', expiresAt };
}

export function getRequestToken(request: Request): string | null {
	const bearer = request.headers.get('Authorization');
	if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
	const match = request.headers.get('Cookie')?.match(/(?:^|;\s*)r2_session=([^;]+)/);
	return match ? decodeURIComponent(match[1]) : null;
}

export async function authorizeSession(request: Request, env: Env): Promise<SessionContext | null> {
	const token = getRequestToken(request);
	if (!token) return null;
	await ensureDatabase(env);
	const row = await env.notes
		.prepare('SELECT id, user_id, expires_at FROM sessions WHERE token_hash = ?')
		.bind(await hashToken(token))
		.first<{ id: string; user_id: string; expires_at: string }>();
	if (!row) return null;
	if (Date.parse(row.expires_at) <= Date.now()) {
		await env.notes.prepare('DELETE FROM sessions WHERE id = ?').bind(row.id).run();
		return null;
	}
	const now = new Date().toISOString();
	const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
	await env.notes
		.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ?, ip = COALESCE(?, ip) WHERE id = ?')
		.bind(now, expiresAt, request.headers.get('CF-Connecting-IP'), row.id)
		.run();
	return { id: row.id, token, userId: row.user_id, expiresAt };
}

export async function revokeRequestSession(request: Request, env: Env): Promise<void> {
	const token = getRequestToken(request);
	if (!token) return;
	await ensureDatabase(env);
	await env.notes
		.prepare('DELETE FROM sessions WHERE token_hash = ?')
		.bind(await hashToken(token))
		.run();
}

export async function listSessions(env: Env, currentId: string, userId = 'default'): Promise<DeviceSession[]> {
	await ensureDatabase(env);
	await env.notes.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(new Date().toISOString()).run();
	const result = await env.notes
		.prepare(
			`SELECT id, user_id, device_name, browser, platform, device_type, ip, created_at, last_seen_at, expires_at
			FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC`,
		)
		.bind(userId)
		.all<SessionRow>();
	return result.results.map((row) => ({
		id: row.id,
		name: row.device_name,
		browser: row.browser,
		platform: row.platform,
		type: row.device_type,
		ip: row.ip ?? undefined,
		createdAt: row.created_at,
		lastSeenAt: row.last_seen_at,
		expiresAt: row.expires_at,
		current: row.id === currentId,
	}));
}

export async function revokeSession(env: Env, id: string, userId = 'default'): Promise<boolean> {
	await ensureDatabase(env);
	const result = await env.notes.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').bind(id, userId).run();
	return (result.meta.changes ?? 0) > 0;
}

export function verifyCredentials(username: string, password: string, env: Env): boolean {
	return timingSafeEqual(username, env.USERNAME ?? '') && timingSafeEqual(password, env.PASSWORD ?? '');
}

export function verifyBasic(header: string | null, env: Env): boolean {
	if (!header?.startsWith('Basic ')) return false;
	try {
		const decoded = atob(header.slice(6));
		const split = decoded.indexOf(':');
		return split >= 0 && verifyCredentials(decoded.slice(0, split), decoded.slice(split + 1), env);
	} catch {
		return false;
	}
}

export async function isDavAuthorized(request: Request, env: Env): Promise<boolean> {
	return verifyBasic(request.headers.get('Authorization'), env) || (await authorizeSession(request, env)) !== null;
}
