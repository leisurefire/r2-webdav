import type { CalendarEvent, CalendarSummary, FileEntry } from '@r2-webdav/shared-types';
import { Lunar } from 'lunar-typescript';
import type { Env } from '../env';
import {
	createSession,
	DatabaseSetupError,
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
	const fromTime = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
	const toTime = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
	const overlaps = (event: CalendarEvent) => Date.parse(event.end) > fromTime && Date.parse(event.start) < toTime;
	const lunarSolarDate = (year: number, event: CalendarEvent): Date | null => {
		if (!event.lunarDate) return null;
		const months = event.lunarDate.leap ? [-event.lunarDate.month, event.lunarDate.month] : [event.lunarDate.month];
		for (const month of months) {
			for (let day = event.lunarDate.day; day >= Math.max(1, event.lunarDate.day - 1); day -= 1) {
				try {
					const solar = Lunar.fromYmd(year, month, day).getSolar();
					return new Date(Date.UTC(solar.getYear(), solar.getMonth() - 1, solar.getDay()));
				} catch {
					// A lunar month can have 29 days, and a selected leap month is absent in most years.
				}
			}
		}
		return null;
	};
	const recurringInstances = (event: CalendarEvent): CalendarEvent[] => {
		if (event.recurrence !== 'yearly' || !Number.isFinite(fromTime) || !Number.isFinite(toTime)) return [event];
		const originalStart = new Date(event.start);
		const duration = Math.max(1, Date.parse(event.end) - originalStart.getTime());
		const startYear = new Date(fromTime).getUTCFullYear() - 1;
		const endYear = new Date(toTime).getUTCFullYear() + 1;
		const instances: CalendarEvent[] = [];
		for (let year = Math.max(startYear, originalStart.getUTCFullYear()); year <= endYear; year += 1) {
			let occurrenceStart: Date;
			if (event.calendarSystem === 'lunar' && event.lunarDate) {
				const converted = lunarSolarDate(year, event);
				if (!converted) continue;
				occurrenceStart = new Date(
					Date.UTC(
						converted.getUTCFullYear(),
						converted.getUTCMonth(),
						converted.getUTCDate(),
						originalStart.getUTCHours(),
						originalStart.getUTCMinutes(),
						originalStart.getUTCSeconds(),
					),
				);
			} else {
				occurrenceStart = new Date(originalStart);
				occurrenceStart.setUTCFullYear(year);
			}
			const instance = {
				...event,
				start: occurrenceStart.toISOString(),
				end: new Date(occurrenceStart.getTime() + duration).toISOString(),
				seriesStart: event.start,
			};
			if (overlaps(instance)) instances.push(instance);
		}
		return instances;
	};
	for (const object of await listAll(env.bucket, `${calendarKey(calendarId)}/`)) {
		if (!object.key.endsWith('.ics')) continue;
		const body = await env.bucket.get(object.key);
		if (body === null) continue;
		try {
			const event = parseIcs(await body.text(), calendarId);
			event.etag = object.httpEtag;
			if (event.recurrence === 'yearly') events.push(...recurringInstances(event));
			else if (overlaps(event)) events.push(event);
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
		allDay: input.kind === 'birthday' ? true : Boolean(input.allDay),
		description: input.description?.trim() || undefined,
		location: input.location?.trim() || undefined,
		calendarId,
		kind: input.kind === 'birthday' ? 'birthday' : 'event',
		calendarSystem: input.calendarSystem === 'lunar' ? 'lunar' : 'solar',
		recurrence: input.kind === 'birthday' || input.recurrence === 'yearly' ? 'yearly' : undefined,
		lunarDate:
			input.calendarSystem === 'lunar' &&
			input.lunarDate &&
			Number.isInteger(input.lunarDate.year) &&
			Number.isInteger(input.lunarDate.month) &&
			Number.isInteger(input.lunarDate.day) &&
			input.lunarDate.month >= 1 &&
			input.lunarDate.month <= 12 &&
			input.lunarDate.day >= 1 &&
			input.lunarDate.day <= 30
				? input.lunarDate
				: undefined,
	};
	if (event.calendarSystem === 'lunar' && !event.lunarDate) {
		return jsonError('BAD_REQUEST', 'A valid lunar date is required');
	}
	if (event.lunarDate) {
		try {
			Lunar.fromYmd(
				event.lunarDate.year,
				event.lunarDate.leap ? -event.lunarDate.month : event.lunarDate.month,
				event.lunarDate.day,
			);
		} catch {
			return jsonError('BAD_REQUEST', 'The selected lunar date does not exist');
		}
	}
	if (event.kind === 'birthday') event.end = new Date(Date.parse(event.start) + 24 * 60 * 60_000).toISOString();
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
		} catch (error) {
			console.error('Session creation failed', error);
			return jsonError(
				'INTERNAL_ERROR',
				error instanceof DatabaseSetupError
					? `Session database is unavailable: ${error.message}. Redeploy the Worker with the NOTES_DB D1 binding and apply its migrations.`
					: 'Unable to create a session. Check the Worker logs for the underlying D1 error.',
				500,
			);
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
