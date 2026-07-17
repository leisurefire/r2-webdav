import { beforeEach, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const basic = `Basic ${btoa('test-user:test-password')}`;

async function clearBucket(): Promise<void> {
	let cursor: string | undefined;
	do {
		const page = await env.bucket.list({ cursor });
		if (page.objects.length) await env.bucket.delete(page.objects.map((object) => object.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
}

async function login(): Promise<string> {
	const response = await SELF.fetch('https://dav.example.com/api/v1/auth/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'https://app.example.com' },
		body: JSON.stringify({ username: 'test-user', password: 'test-password' }),
	});
	expect(response.status).toBe(200);
	expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
	const payload = await response.json<{ ok: true; data: { token: string } }>();
	return payload.data.token;
}

beforeEach(clearBucket);

describe('authentication and file API', () => {
	it('issues a JWT and rejects invalid credentials', async () => {
		const bad = await SELF.fetch('https://dav.example.com/api/v1/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'test-user', password: 'wrong' }),
		});
		expect(bad.status).toBe(401);
		expect(await login()).toMatch(/^eyJ/);
	});

	it('creates, uploads, lists, moves and deletes through shared DAV behavior', async () => {
		const token = await login();
		const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
		const mkdir = await SELF.fetch('https://dav.example.com/api/v1/fs/mkdir', {
			method: 'POST',
			headers,
			body: JSON.stringify({ path: 'docs' }),
		});
		expect(mkdir.status).toBe(201);

		const upload = await SELF.fetch('https://dav.example.com/api/v1/fs/content?path=docs%2Fnote.txt', {
			method: 'PUT',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
			body: 'hello r2',
		});
		expect(upload.status).toBe(201);

		const listing = await SELF.fetch('https://dav.example.com/api/v1/fs?path=docs', { headers });
		const listingBody = await listing.json<{ ok: true; data: { entries: Array<{ name: string }> } }>();
		expect(listingBody.data.entries.map((entry) => entry.name)).toEqual(['note.txt']);

		const move = await SELF.fetch('https://dav.example.com/api/v1/fs/move', {
			method: 'POST',
			headers,
			body: JSON.stringify({ from: 'docs/note.txt', to: 'docs/renamed.txt' }),
		});
		expect(move.status).toBe(201);
		expect(await env.bucket.get('fs/default/docs/renamed.txt').then((object) => object?.text())).toBe('hello r2');

		const removed = await SELF.fetch('https://dav.example.com/api/v1/fs?path=docs%2Frenamed.txt', {
			method: 'DELETE',
			headers,
		});
		expect(removed.status).toBe(200);
		expect(await env.bucket.head('fs/default/docs/renamed.txt')).toBeNull();
	});
});

describe('DAV protocols', () => {
	it('keeps WebDAV paths external while storing under the single-user prefix', async () => {
		await SELF.fetch('https://dav.example.com/', { headers: { Authorization: basic } });
		const put = await SELF.fetch('https://dav.example.com/readme.txt', {
			method: 'PUT',
			headers: { Authorization: basic, 'Content-Type': 'text/plain' },
			body: 'webdav',
		});
		expect(put.status).toBe(201);
		expect(await env.bucket.get('fs/default/readme.txt').then((object) => object?.text())).toBe('webdav');

		const propfind = await SELF.fetch('https://dav.example.com/', {
			method: 'PROPFIND',
			headers: { Authorization: basic, Depth: '1' },
		});
		expect(propfind.status).toBe(207);
		const xml = await propfind.text();
		expect(xml).toContain('<href>/readme.txt</href>');
		expect(xml).not.toContain('fs/default');
	});

	it('supports CalDAV discovery, event writes, query REPORT and JSON reads', async () => {
		const options = await SELF.fetch('https://dav.example.com/caldav/', { method: 'OPTIONS' });
		expect(options.headers.get('DAV')).toContain('calendar-access');
		const principal = await SELF.fetch('https://dav.example.com/caldav/default/', {
			method: 'PROPFIND',
			headers: { Authorization: basic, Depth: '0' },
		});
		expect(await principal.text()).toContain('calendar-home-set');

		const ics =
			'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VEVENT\r\nUID:event-1\r\nDTSTART:20260717T090000Z\r\nDTEND:20260717T100000Z\r\nSUMMARY:Protocol test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
		const put = await SELF.fetch('https://dav.example.com/caldav/default/calendars/default/event-1.ics', {
			method: 'PUT',
			headers: { Authorization: basic, 'Content-Type': 'text/calendar' },
			body: ics,
		});
		expect(put.status).toBe(201);

		const report = await SELF.fetch('https://dav.example.com/caldav/default/calendars/default/', {
			method: 'REPORT',
			headers: { Authorization: basic, Depth: '1', 'Content-Type': 'application/xml' },
			body: '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="20260701T000000Z" end="20260801T000000Z"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>',
		});
		expect(report.status).toBe(207);
		expect(await report.text()).toContain('Protocol test');

		const token = await login();
		const events = await SELF.fetch(
			'https://dav.example.com/api/v1/calendars/default/events?from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z',
			{
				headers: { Authorization: `Bearer ${token}` },
			},
		);
		const body = await events.json<{ ok: true; data: Array<{ uid: string; title: string }> }>();
		expect(body.data).toEqual([expect.objectContaining({ uid: 'event-1', title: 'Protocol test' })]);
	});
});
