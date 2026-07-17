import type { Env } from '../env';

const encoder = new TextEncoder();

function timingSafeEqual(left: string, right: string): boolean {
	const a = encoder.encode(left);
	const b = encoder.encode(right);
	let mismatch = a.length ^ b.length;
	const length = Math.max(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
	}
	return mismatch === 0;
}

function base64UrlEncode(value: string | ArrayBuffer): string {
	const bytes = typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string | null {
	try {
		const padded = value
			.replaceAll('-', '+')
			.replaceAll('_', '/')
			.padEnd(Math.ceil(value.length / 4) * 4, '=');
		return atob(padded);
	} catch {
		return null;
	}
}

async function sign(value: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
	]);
	return base64UrlEncode(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function createToken(env: Env): Promise<{ token: string; expiresAt: string }> {
	if (!env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
	const ttl = Math.max(300, Number(env.JWT_TTL_SECONDS) || 28_800);
	const now = Math.floor(Date.now() / 1000);
	const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
	const payload = base64UrlEncode(JSON.stringify({ sub: 'default', iat: now, exp: now + ttl }));
	const unsigned = `${header}.${payload}`;
	return {
		token: `${unsigned}.${await sign(unsigned, env.JWT_SECRET)}`,
		expiresAt: new Date((now + ttl) * 1000).toISOString(),
	};
}

export async function verifyToken(token: string, env: Env): Promise<boolean> {
	if (!env.JWT_SECRET) return false;
	const parts = token.split('.');
	if (parts.length !== 3) return false;
	const payloadText = base64UrlDecode(parts[1]);
	if (payloadText === null) return false;
	try {
		const payload = JSON.parse(payloadText) as { sub?: string; exp?: number };
		if (payload.sub !== 'default' || typeof payload.exp !== 'number' || payload.exp <= Date.now() / 1000) return false;
		return timingSafeEqual(parts[2], await sign(`${parts[0]}.${parts[1]}`, env.JWT_SECRET));
	} catch {
		return false;
	}
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

export function getRequestToken(request: Request): string | null {
	const bearer = request.headers.get('Authorization');
	if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
	const cookie = request.headers.get('Cookie');
	const match = cookie?.match(/(?:^|;\s*)r2_session=([^;]+)/);
	return match ? decodeURIComponent(match[1]) : null;
}

export async function isApiAuthorized(request: Request, env: Env): Promise<boolean> {
	const token = getRequestToken(request);
	return token !== null && verifyToken(token, env);
}

export async function isDavAuthorized(request: Request, env: Env): Promise<boolean> {
	return verifyBasic(request.headers.get('Authorization'), env) || isApiAuthorized(request, env);
}
