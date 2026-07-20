import { beforeEach, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { Lunar } from 'lunar-typescript';
import { onRequest as handleNotes } from '../../web/functions/api/v1/notes/[[id]]';

const basic = `Basic ${btoa('test-user:test-password')}`;

async function clearBucket(): Promise<void> {
	let cursor: string | undefined;
	do {
		const page = await env.bucket.list({ cursor });
		if (page.objects.length) await env.bucket.delete(page.objects.map((object) => object.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
}

async function clearState(): Promise<void> {
	await clearBucket();
	try {
		await env.NOTES_DB.exec(
			'DELETE FROM r2_webdav_sessions; DELETE FROM r2_webdav_notes; DELETE FROM r2_webdav_note_folders;',
		);
	} catch {
		// The first login initializes the local D1 schema.
	}
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

async function pagesNotes(token: string, path = '', init: RequestInit = {}): Promise<Response> {
	const id = path.split('?')[0].replace(/^\//, '');
	return handleNotes({
		request: new Request(`https://app.example.com/api/v1/notes${path}`, {
			...init,
			headers: { Authorization: `Bearer ${token}`, ...init.headers },
		}),
		env: { NOTES_DB: env.NOTES_DB },
		params: id ? { id } : {},
	} as Parameters<typeof handleNotes>[0]);
}

beforeEach(clearState);

describe('authentication and file API', () => {
	it('allows CORS preflight for every browser API mutation method', async () => {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			const response = await SELF.fetch('https://dav.example.com/api/v1/notes/example', {
				method: 'OPTIONS',
				headers: {
					Origin: 'https://app.example.com',
					'Access-Control-Request-Method': method,
					'Access-Control-Request-Headers': 'authorization, content-type',
				},
			});
			expect(response.status).toBe(204);
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
			expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
			expect(response.headers.get('Access-Control-Allow-Methods')?.split(/,\s*/)).toContain(method);
			const allowedHeaders = response.headers.get('Access-Control-Allow-Headers')?.toLowerCase() ?? '';
			expect(allowedHeaders).toContain('authorization');
			expect(allowedHeaders).toContain('content-type');
		}
	});

	it('issues a random session token and rejects invalid credentials', async () => {
		const bad = await SELF.fetch('https://dav.example.com/api/v1/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'test-user', password: 'wrong' }),
		});
		expect(bad.status).toBe(401);
		expect(await login()).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);
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

	it('reads bookmarkhub.json from the WebDAV root through the authenticated API', async () => {
		const token = await login();
		const headers = { Authorization: `Bearer ${token}` };
		expect(
			await SELF.fetch('https://dav.example.com/api/v1/bookmarks', { headers }).then((response) => response.status),
		).toBe(404);

		const backup = {
			version: '1.0.3',
			uniqueId: 'backup-id',
			sha: 'abc123',
			nodes: [
				{
					id: 'root_____bar',
					title: 'Bookmarks',
					dateModified: 1784384631584,
					children: [{ id: 'link-1', title: '', dateModified: 1777102927053, url: 'https://example.com/' }],
				},
			],
		};
		await env.bucket.put('fs/default/bookmarkhub.json', JSON.stringify(backup), {
			httpMetadata: { contentType: 'application/json' },
		});
		const response = await SELF.fetch('https://dav.example.com/api/v1/bookmarks', { headers });
		expect(response.status).toBe(200);
		const body = await response.json<{ ok: true; data: typeof backup }>();
		expect(body.data).toEqual(backup);
	});

	it('tracks devices and revokes the selected access token', async () => {
		const token = await login();
		const headers = { Authorization: `Bearer ${token}` };
		const devices = await SELF.fetch('https://dav.example.com/api/v1/auth/devices', { headers });
		const body = await devices.json<{
			ok: true;
			data: Array<{ id: string; current: boolean; expiresAt: string }>;
		}>();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].current).toBe(true);
		expect(Date.parse(body.data[0].expiresAt)).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);

		const revoked = await SELF.fetch(`https://dav.example.com/api/v1/auth/devices/${body.data[0].id}`, {
			method: 'DELETE',
			headers,
		});
		expect(revoked.status).toBe(200);
		expect(revoked.headers.get('Set-Cookie')).toContain('Max-Age=0');
		expect(await SELF.fetch('https://dav.example.com/api/v1/fs', { headers }).then((response) => response.status)).toBe(
			401,
		);
	});

	it('leaves Notes CRUD to Pages Functions', async () => {
		const token = await login();
		const response = await SELF.fetch('https://dav.example.com/api/v1/notes', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(response.status).toBe(404);
	});

	it('shares Worker sessions with the Pages Notes function', async () => {
		const token = await login();
		const createdResponse = await pagesNotes(token, '', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: '', content: '' }),
		});
		expect(createdResponse.status).toBe(201);
		const created = await createdResponse.json<{ ok: true; data: { id: string; title: string } }>();
		expect(created.data.title).toBe('Untitled note');

		const page = await pagesNotes(token).then((response) =>
			response.json<{ ok: true; data: { items: Array<{ id: string }>; total: number } }>(),
		);
		expect(page.data.total).toBe(1);
		expect(page.data.items[0].id).toBe(created.data.id);

		const archived = await pagesNotes(token, `/${created.data.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ archived: true }),
		});
		expect(archived.status).toBe(200);
		const archivedPage = await pagesNotes(token, '?archived=1').then((response) =>
			response.json<{ ok: true; data: { items: Array<{ id: string }> } }>(),
		);
		expect(archivedPage.data.items.map((note) => note.id)).toEqual([created.data.id]);

		expect((await pagesNotes(token, `/${created.data.id}`, { method: 'DELETE' })).status).toBe(200);
	});

	it('persists note folders and moves notes between folders', async () => {
		const token = await login();
		const headers = { 'Content-Type': 'application/json' };
		const createdFolder = await pagesNotes(token, '/folders', {
			method: 'POST',
			headers,
			body: JSON.stringify({ name: 'Food' }),
		});
		expect(createdFolder.status).toBe(201);
		const folder = await createdFolder.json<{ ok: true; data: { id: string } }>();
		const createdChild = await pagesNotes(token, '/folders', {
			method: 'POST',
			headers,
			body: JSON.stringify({ name: 'Recipes', parentId: folder.data.id }),
		});
		expect(createdChild.status).toBe(201);
		const child = await createdChild.json<{ ok: true; data: { id: string; parentId: string | null } }>();
		expect(child.data.parentId).toBe(folder.data.id);
		const listedFolders = await pagesNotes(token, '/folders').then((response) =>
			response.json<{ ok: true; data: Array<{ id: string; parentId: string | null }> }>(),
		);
		expect(listedFolders.data.find((item) => item.id === child.data.id)?.parentId).toBe(folder.data.id);
		const cyclicMove = await pagesNotes(token, `/folders/${folder.data.id}`, {
			method: 'PATCH',
			headers,
			body: JSON.stringify({ parentId: child.data.id }),
		});
		expect(cyclicMove.status).toBe(400);
		const createdNote = await pagesNotes(token, '', {
			method: 'POST',
			headers,
			body: JSON.stringify({ title: 'Recipes', folderId: child.data.id }),
		});
		expect(createdNote.status).toBe(201);
		const listed = await pagesNotes(token, `?folder=${child.data.id}`);
		expect((await listed.json<{ ok: true; data: { total: number } }>()).data.total).toBe(1);
		const moved = await pagesNotes(
			token,
			`/${(await createdNote.clone().json<{ ok: true; data: { id: string } }>()).data.id}`,
			{
				method: 'PATCH',
				headers,
				body: JSON.stringify({ folderId: null }),
			},
		);
		expect(moved.status).toBe(200);
		expect(
			(
				await pagesNotes(token, '?folder=root').then((response) =>
					response.json<{ ok: true; data: { total: number } }>(),
				)
			).data.total,
		).toBe(1);
	});

	it('lists meta-only indexes, reads a note body, and reparents notes when dissolving a folder', async () => {
		const token = await login();
		const headers = { 'Content-Type': 'application/json' };
		const folderRes = await pagesNotes(token, '/folders', {
			method: 'POST',
			headers,
			body: JSON.stringify({ name: 'Art' }),
		});
		expect(folderRes.status).toBe(201);
		const folder = await folderRes.json<{ ok: true; data: { id: string } }>();
		const created = await pagesNotes(token, '', {
			method: 'POST',
			headers,
			body: JSON.stringify({
				title: 'Caravaggio',
				content: 'Dramatic light and shadow.',
				folderId: folder.data.id,
			}),
		});
		expect(created.status).toBe(201);
		const note = await created.json<{ ok: true; data: { id: string } }>();

		const meta = await pagesNotes(token, `?folder=${folder.data.id}&content=0&limit=50`).then((response) =>
			response.json<{ ok: true; data: { items: Array<{ id: string; content: string }> } }>(),
		);
		expect(meta.data.items).toHaveLength(1);
		expect(meta.data.items[0].id).toBe(note.data.id);
		expect(meta.data.items[0].content).toBe('');

		const full = await pagesNotes(token, `/${note.data.id}`).then((response) =>
			response.json<{ ok: true; data: { content: string; folderId: string | null } }>(),
		);
		expect(full.data.content).toBe('Dramatic light and shadow.');

		expect((await pagesNotes(token, `/folders/${folder.data.id}`, { method: 'DELETE' })).status).toBe(200);
		const root = await pagesNotes(token, '?folder=root&content=0').then((response) =>
			response.json<{ ok: true; data: { items: Array<{ id: string; folderId: string | null }> } }>(),
		);
		expect(root.data.items.some((item) => item.id === note.data.id && item.folderId === null)).toBe(true);
		const after = await pagesNotes(token, `/${note.data.id}`).then((response) =>
			response.json<{ ok: true; data: { content: string; folderId: string | null } }>(),
		);
		expect(after.data.folderId).toBeNull();
		expect(after.data.content).toBe('Dramatic light and shadow.');
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

	it('repeats Gregorian and lunar birthdays on their correct annual dates', async () => {
		const token = await login();
		const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
		const create = (body: object) =>
			SELF.fetch('https://dav.example.com/api/v1/calendars/default/events', {
				method: 'POST',
				headers,
				body: JSON.stringify(body),
			});
		await create({
			uid: 'solar-birthday',
			title: 'Solar birthday',
			start: '2000-07-18T00:00:00.000Z',
			end: '2000-07-19T00:00:00.000Z',
			allDay: true,
			kind: 'birthday',
			calendarSystem: 'solar',
		});
		const originalLunar = Lunar.fromYmd(2026, 6, 5).getSolar();
		await create({
			uid: 'lunar-birthday',
			title: 'Lunar birthday',
			start: `${originalLunar.toYmd()}T00:00:00.000Z`,
			end: `${originalLunar.nextDay(1).toYmd()}T00:00:00.000Z`,
			allDay: true,
			kind: 'birthday',
			calendarSystem: 'lunar',
			lunarDate: { year: 2026, month: 6, day: 5, leap: false },
		});

		const response = await SELF.fetch(
			'https://dav.example.com/api/v1/calendars/default/events?from=2027-01-01T00:00:00.000Z&to=2028-01-01T00:00:00.000Z',
			{ headers },
		);
		const payload = await response.json<{
			ok: true;
			data: Array<{ uid: string; start: string; recurrence?: string; seriesStart?: string }>;
		}>();
		const nextLunar = Lunar.fromYmd(2027, 6, 5).getSolar().toYmd();
		expect(payload.data).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ uid: 'solar-birthday', start: '2027-07-18T00:00:00.000Z', recurrence: 'yearly' }),
				expect.objectContaining({ uid: 'lunar-birthday', start: `${nextLunar}T00:00:00.000Z`, recurrence: 'yearly' }),
			]),
		);
		expect(payload.data.find((event) => event.uid === 'solar-birthday')?.seriesStart).toBe('2000-07-18T00:00:00.000Z');
		const solarIcs = await env.bucket
			.get('caldav/default/calendars/default/solar-birthday.ics')
			.then((item) => item?.text());
		const lunarIcs = await env.bucket
			.get('caldav/default/calendars/default/lunar-birthday.ics')
			.then((item) => item?.text());
		expect(solarIcs).toContain('RRULE:FREQ=YEARLY');
		expect(lunarIcs).toContain('X-TRUESPACE-CALENDAR-SYSTEM:LUNAR');
		expect(lunarIcs).toContain('RDATE;VALUE=DATE:');
	});
});
