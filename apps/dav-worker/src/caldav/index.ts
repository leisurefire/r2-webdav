import type { Env } from '../env';
import { bumpCalendarCtag, calendarKey, listAll, readCalendarMeta, writeCalendarMeta } from '../shared/storage';
import { escapeXml } from '../shared/http';
import { parseIcs } from '../shared/ical';

const DAV_METHODS = ['OPTIONS', 'PROPFIND', 'REPORT', 'MKCALENDAR', 'GET', 'HEAD', 'PUT', 'DELETE'];
const XML_HEADERS = { 'Content-Type': 'application/xml; charset=utf-8' };

function calendarHref(id: string): string {
	return `/caldav/default/calendars/${encodeURIComponent(id)}/`;
}

function propResponse(href: string, properties: string, status = 'HTTP/1.1 200 OK'): string {
	return `<d:response><d:href>${escapeXml(href)}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>${status}</d:status></d:propstat></d:response>`;
}

function multistatus(responses: string): Response {
	return new Response(
		`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${responses}</d:multistatus>`,
		{ status: 207, headers: XML_HEADERS },
	);
}

function route(
	pathname: string,
):
	| { type: 'root' | 'principal' | 'home' }
	| { type: 'calendar'; calendarId: string }
	| { type: 'event'; calendarId: string; fileName: string }
	| null {
	if (pathname === '/caldav/' || pathname === '/caldav') return { type: 'root' };
	if (pathname === '/caldav/default/' || pathname === '/caldav/default') return { type: 'principal' };
	if (pathname === '/caldav/default/calendars/' || pathname === '/caldav/default/calendars') return { type: 'home' };
	const match = pathname.match(/^\/caldav\/default\/calendars\/([^/]+)(?:\/([^/]+))?\/?$/);
	if (!match) return null;
	try {
		const calendarId = decodeURIComponent(match[1]);
		return match[2]
			? { type: 'event', calendarId, fileName: decodeURIComponent(match[2]) }
			: { type: 'calendar', calendarId };
	} catch {
		return null;
	}
}

async function calendarProperties(env: Env, calendarId: string): Promise<string | null> {
	const object = await env.bucket.head(calendarKey(calendarId));
	if (object === null) return null;
	const meta = await readCalendarMeta(env.bucket, calendarId);
	return [
		'<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>',
		`<d:displayname>${escapeXml(meta?.displayName ?? calendarId)}</d:displayname>`,
		`<cs:getctag>${escapeXml(meta?.ctag ?? object.customMetadata?.ctag ?? '1')}</cs:getctag>`,
		`<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>`,
	].join('');
}

async function handlePropfind(
	env: Env,
	target: NonNullable<ReturnType<typeof route>>,
	request: Request,
): Promise<Response> {
	const depth = request.headers.get('Depth') ?? '0';
	if (target.type === 'root' || target.type === 'principal') {
		const href = target.type === 'root' ? '/caldav/' : '/caldav/default/';
		return multistatus(
			propResponse(
				href,
				'<d:resourcetype><d:collection/></d:resourcetype><d:displayname>R2 WebDAV</d:displayname><d:current-user-principal><d:href>/caldav/default/</d:href></d:current-user-principal><c:calendar-home-set><d:href>/caldav/default/calendars/</d:href></c:calendar-home-set>',
			),
		);
	}
	if (target.type === 'home') {
		let responses = propResponse(
			'/caldav/default/calendars/',
			'<d:resourcetype><d:collection/></d:resourcetype><d:displayname>Calendars</d:displayname>',
		);
		if (depth !== '0') {
			const objects = await listAll(env.bucket, calendarKey(''));
			for (const object of objects.filter((item) => item.key.split('/').length === 4 && item.key !== calendarKey(''))) {
				const id = object.key.split('/').at(-1)!;
				const props = await calendarProperties(env, id);
				if (props) responses += propResponse(calendarHref(id), props);
			}
		}
		return multistatus(responses);
	}
	if (target.type === 'calendar') {
		const props = await calendarProperties(env, target.calendarId);
		if (props === null) return new Response('Not Found', { status: 404 });
		let responses = propResponse(calendarHref(target.calendarId), props);
		if (depth !== '0') {
			for (const object of await listAll(env.bucket, `${calendarKey(target.calendarId)}/`)) {
				if (!object.key.endsWith('.ics')) continue;
				const fileName = object.key.split('/').at(-1)!;
				responses += propResponse(
					`${calendarHref(target.calendarId)}${encodeURIComponent(fileName)}`,
					`<d:getetag>${escapeXml(object.httpEtag)}</d:getetag><d:getcontenttype>text/calendar; charset=utf-8</d:getcontenttype><d:getcontentlength>${object.size}</d:getcontentlength>`,
				);
			}
		}
		return multistatus(responses);
	}
	if (target.type !== 'event') return new Response('Not Found', { status: 404 });
	const object = await env.bucket.head(calendarKey(target.calendarId, target.fileName));
	if (object === null) return new Response('Not Found', { status: 404 });
	return multistatus(
		propResponse(
			`${calendarHref(target.calendarId)}${encodeURIComponent(target.fileName)}`,
			`<d:getetag>${escapeXml(object.httpEtag)}</d:getetag><d:getcontenttype>text/calendar; charset=utf-8</d:getcontenttype><d:getcontentlength>${object.size}</d:getcontentlength>`,
		),
	);
}

async function handleReport(
	env: Env,
	target: NonNullable<ReturnType<typeof route>>,
	request: Request,
): Promise<Response> {
	if (target.type !== 'calendar') return new Response('Method Not Allowed', { status: 405 });
	const body = await request.text();
	const hrefs = [...body.matchAll(/<(?:[^:>]+:)?href[^>]*>([^<]+)<\/(?:[^:>]+:)?href>/gi)].map((match) => match[1]);
	const requestedNames = new Set(
		hrefs.flatMap((href) => {
			try {
				return [decodeURIComponent(new URL(href, request.url).pathname.split('/').filter(Boolean).at(-1) ?? '')];
			} catch {
				return [];
			}
		}),
	);
	const range = body.match(/time-range[^>]*start="(\d{8}T\d{6}Z)"[^>]*end="(\d{8}T\d{6}Z)"/i);
	const parseRange = (value: string) =>
		Date.parse(value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
	let responses = '';
	for (const object of await listAll(env.bucket, `${calendarKey(target.calendarId)}/`)) {
		if (!object.key.endsWith('.ics')) continue;
		const fileName = object.key.split('/').at(-1)!;
		if (requestedNames.size > 0 && !requestedNames.has(fileName)) continue;
		const bodyObject = await env.bucket.get(object.key);
		if (bodyObject === null) continue;
		const source = await bodyObject.text();
		if (range) {
			try {
				const event = parseIcs(source, target.calendarId);
				if (Date.parse(event.end) < parseRange(range[1]) || Date.parse(event.start) >= parseRange(range[2])) continue;
			} catch {
				continue;
			}
		}
		responses += propResponse(
			`${calendarHref(target.calendarId)}${encodeURIComponent(fileName)}`,
			`<d:getetag>${escapeXml(object.httpEtag)}</d:getetag><c:calendar-data>${escapeXml(source)}</c:calendar-data>`,
		);
	}
	return multistatus(responses);
}

export async function handleCalDav(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === '/.well-known/caldav') {
		return Response.redirect(`${url.origin}/caldav/`, 301);
	}
	const target = route(url.pathname);
	if (target === null) return new Response('Not Found', { status: 404 });
	if ('calendarId' in target && !/^[A-Za-z0-9._-]{1,100}$/.test(target.calendarId)) {
		return new Response('Bad Request', { status: 400 });
	}
	if (request.method === 'OPTIONS') {
		return new Response(null, { headers: { Allow: DAV_METHODS.join(', '), DAV: '1, 2, calendar-access' } });
	}
	if (request.method === 'PROPFIND') return handlePropfind(env, target, request);
	if (request.method === 'REPORT') return handleReport(env, target, request);
	if (request.method === 'MKCALENDAR' && target.type === 'calendar') {
		if ((await env.bucket.head(calendarKey(target.calendarId))) !== null)
			return new Response('Method Not Allowed', { status: 405 });
		await env.bucket.put(calendarKey(target.calendarId), new Uint8Array(), {
			customMetadata: { resourcetype: '<collection /><calendar xmlns="urn:ietf:params:xml:ns:caldav"/>', ctag: '1' },
		});
		await writeCalendarMeta(env.bucket, target.calendarId, {
			displayName: target.calendarId,
			color: '#0f6fec',
			ctag: '1',
		});
		return new Response(null, { status: 201 });
	}
	if (target.type !== 'event' || !target.fileName.endsWith('.ics'))
		return new Response('Method Not Allowed', { status: 405 });
	const key = calendarKey(target.calendarId, target.fileName);
	if (request.method === 'GET' || request.method === 'HEAD') {
		const object = await env.bucket.get(key, { onlyIf: request.headers });
		if (object === null) return new Response('Not Found', { status: 404 });
		if (!('body' in object)) return new Response('Precondition Failed', { status: 412 });
		return new Response(request.method === 'HEAD' ? null : object.body, {
			headers: { 'Content-Type': 'text/calendar; charset=utf-8', ETag: object.httpEtag },
		});
	}
	if (request.method === 'PUT') {
		if ((await env.bucket.head(calendarKey(target.calendarId))) === null)
			return new Response('Conflict', { status: 409 });
		const contentLength = Number(request.headers.get('Content-Length'));
		if (Number.isFinite(contentLength) && contentLength > 1_048_576)
			return new Response('Payload Too Large', { status: 413 });
		const source = await request.text();
		if (source.length > 1_048_576) return new Response('Payload Too Large', { status: 413 });
		try {
			parseIcs(source, target.calendarId);
		} catch (error) {
			return new Response(error instanceof Error ? error.message : 'Invalid iCalendar data', { status: 400 });
		}
		const existing = await env.bucket.head(key);
		await env.bucket.put(key, source, {
			onlyIf: request.headers,
			httpMetadata: { contentType: 'text/calendar; charset=utf-8' },
		});
		await bumpCalendarCtag(env.bucket, target.calendarId);
		return new Response(null, { status: existing ? 204 : 201, headers: { Location: url.pathname } });
	}
	if (request.method === 'DELETE') {
		if ((await env.bucket.head(key)) === null) return new Response('Not Found', { status: 404 });
		await env.bucket.delete(key);
		await bumpCalendarCtag(env.bucket, target.calendarId);
		return new Response(null, { status: 204 });
	}
	return new Response('Method Not Allowed', { status: 405, headers: { Allow: DAV_METHODS.join(', ') } });
}
