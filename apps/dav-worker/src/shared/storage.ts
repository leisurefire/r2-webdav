import { CALDAV_ROOT, FILE_ROOT } from '../env';

export async function ensureStorage(bucket: R2Bucket): Promise<void> {
	if ((await bucket.head(FILE_ROOT)) === null) {
		await bucket.put(FILE_ROOT, new Uint8Array(), { customMetadata: { resourcetype: '<collection />' } });
	}
	const calendarRoot = `${CALDAV_ROOT}/calendars`;
	if ((await bucket.head(calendarRoot)) === null) {
		await bucket.put(calendarRoot, new Uint8Array(), { customMetadata: { resourcetype: '<collection />' } });
	}
	const defaultCalendar = `${calendarRoot}/default`;
	if ((await bucket.head(defaultCalendar)) === null) {
		await bucket.put(defaultCalendar, new Uint8Array(), {
			customMetadata: {
				resourcetype: '<collection /><calendar xmlns="urn:ietf:params:xml:ns:caldav"/>',
				ctag: '1',
			},
		});
		await writeCalendarMeta(bucket, 'default', { displayName: 'My Calendar', color: '#10a37f', ctag: '1' });
	}
}

export function normalizePath(value: string | null): string | null {
	if (value === null || value.includes('\0') || value.includes('\\')) return null;
	const path = value.trim().replace(/^\/+|\/+$/g, '');
	const segments = path === '' ? [] : path.split('/');
	if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
	return segments.join('/');
}

export function fileKey(path: string): string {
	return path === '' ? FILE_ROOT : `${FILE_ROOT}/${path}`;
}

export function calendarKey(calendarId: string, suffix = ''): string {
	const base = `${CALDAV_ROOT}/calendars/${calendarId}`;
	return suffix ? `${base}/${suffix}` : base;
}

export interface CalendarMeta {
	displayName: string;
	color: string;
	ctag: string;
}

export async function readCalendarMeta(bucket: R2Bucket, calendarId: string): Promise<CalendarMeta | null> {
	const object = await bucket.get(calendarKey(calendarId, '.meta.json'));
	if (object === null) return null;
	try {
		return JSON.parse(await object.text()) as CalendarMeta;
	} catch {
		return null;
	}
}

export async function writeCalendarMeta(bucket: R2Bucket, calendarId: string, meta: CalendarMeta): Promise<void> {
	await bucket.put(calendarKey(calendarId, '.meta.json'), JSON.stringify(meta), {
		httpMetadata: { contentType: 'application/json' },
	});
}

export async function bumpCalendarCtag(bucket: R2Bucket, calendarId: string): Promise<string> {
	const calendar = await bucket.get(calendarKey(calendarId));
	if (calendar === null) throw new Error('Calendar not found');
	const ctag = String(Date.now());
	await bucket.put(calendar.key, calendar.body, {
		httpMetadata: calendar.httpMetadata,
		customMetadata: { ...calendar.customMetadata, ctag },
	});
	const oldMeta = await readCalendarMeta(bucket, calendarId);
	await writeCalendarMeta(bucket, calendarId, {
		displayName: oldMeta?.displayName ?? calendarId,
		color: oldMeta?.color ?? '#10a37f',
		ctag,
	});
	return ctag;
}

export async function listAll(bucket: R2Bucket, prefix: string): Promise<R2Object[]> {
	const result: R2Object[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({
			prefix,
			cursor,
			// @ts-expect-error R2 supports metadata inclusion although some Workers type snapshots omit it.
			include: ['httpMetadata', 'customMetadata'],
		});
		result.push(...page.objects);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return result;
}
