import type { Env } from './env';
import { handleApi } from './api';
import { isApiAuthorized, isDavAuthorized } from './auth';
import { handleCalDav } from './caldav';
import { jsonError } from './shared/http';
import { ensureStorage } from './shared/storage';
import { handleWebDav } from './webdav';

const METHODS = [
	'GET',
	'HEAD',
	'POST',
	'PUT',
	'DELETE',
	'OPTIONS',
	'PROPFIND',
	'PROPPATCH',
	'REPORT',
	'MKCOL',
	'MKCALENDAR',
	'COPY',
	'MOVE',
	'LOCK',
	'UNLOCK',
];

function applyCors(request: Request, response: Response, env: Env): Response {
	const headers = new Headers(response.headers);
	const origin = request.headers.get('Origin');
	const allowed = (env.CORS_ORIGIN ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	if (origin && allowed.includes(origin)) {
		headers.set('Access-Control-Allow-Origin', origin);
		headers.set('Access-Control-Allow-Credentials', 'true');
		headers.append('Vary', 'Origin');
	}
	headers.set('Access-Control-Allow-Methods', METHODS.join(', '));
	headers.set(
		'Access-Control-Allow-Headers',
		'Authorization, Content-Type, Depth, Overwrite, Destination, Range, If, Lock-Token, Timeout, If-Match, If-None-Match',
	);
	headers.set(
		'Access-Control-Expose-Headers',
		'Content-Type, Content-Length, DAV, ETag, Last-Modified, Location, Content-Range, Lock-Token',
	);
	headers.set('Access-Control-Max-Age', '86400');
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function unauthorized(api: boolean): Response {
	return api
		? jsonError('UNAUTHORIZED', 'Authentication required', 401)
		: new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="r2-webdav"' } });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const isApi = url.pathname.startsWith('/api/v1/');
		const isLogin = url.pathname === '/api/v1/auth/login';
		const isHealth = url.pathname === '/api/v1/health';

		if (request.method === 'OPTIONS') {
			if (isApi) return applyCors(request, new Response(null, { status: 204 }), env);
			if (url.pathname.startsWith('/caldav/') || url.pathname === '/.well-known/caldav') {
				return applyCors(request, await handleCalDav(request, env), env);
			}
			return applyCors(request, await handleWebDav(request, env.bucket), env);
		}

		if (isApi) {
			if (!isLogin && !isHealth && url.pathname !== '/api/v1/auth/logout' && !(await isApiAuthorized(request, env))) {
				return applyCors(request, unauthorized(true), env);
			}
			if (!isLogin && !isHealth) await ensureStorage(env.bucket);
			return applyCors(request, await handleApi(request, env), env);
		}

		if (!(await isDavAuthorized(request, env))) return applyCors(request, unauthorized(false), env);
		await ensureStorage(env.bucket);
		const response =
			url.pathname.startsWith('/caldav/') || url.pathname === '/.well-known/caldav'
				? await handleCalDav(request, env)
				: await handleWebDav(request, env.bucket);
		return applyCors(request, response, env);
	},
};
