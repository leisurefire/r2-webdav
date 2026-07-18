import ICAL from 'ical.js';
import type { CalendarEvent } from '@r2-webdav/shared-types';
import { Lunar } from 'lunar-typescript';

function toIcalText(value: string): string {
	return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
}

function formatUtc(value: string): string {
	return new Date(value)
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, 'Z');
}

function formatDate(value: string): string {
	return value.slice(0, 10).replaceAll('-', '');
}

function foldLine(value: string): string {
	const chunks = value.match(/.{1,74}/g) ?? [''];
	return chunks.join('\r\n ');
}

export function parseIcs(source: string, calendarId: string): CalendarEvent {
	const component = new ICAL.Component(ICAL.parse(source));
	const vevent = component.getFirstSubcomponent('vevent');
	if (vevent === null) throw new Error('The iCalendar payload must contain a VEVENT');
	const event = new ICAL.Event(vevent);
	if (!event.uid || !event.startDate) throw new Error('VEVENT requires UID and DTSTART');
	const toDate = (value: ICAL.Time): Date =>
		value.isDate ? new Date(Date.UTC(value.year, value.month - 1, value.day)) : value.toJSDate();
	const start = toDate(event.startDate);
	const end = event.endDate ? toDate(event.endDate) : start;
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error('VEVENT contains an invalid date');
	const kind = vevent.getFirstPropertyValue('x-truespace-event-kind');
	const calendarSystem = vevent.getFirstPropertyValue('x-truespace-calendar-system');
	const lunarYear = Number(vevent.getFirstPropertyValue('x-truespace-lunar-year'));
	const lunarMonth = Number(vevent.getFirstPropertyValue('x-truespace-lunar-month'));
	const lunarDay = Number(vevent.getFirstPropertyValue('x-truespace-lunar-day'));
	const recurrenceRule = String(vevent.getFirstPropertyValue('rrule') ?? '');
	const lunarDate =
		Number.isInteger(lunarYear) &&
		Number.isInteger(lunarMonth) &&
		Number.isInteger(lunarDay) &&
		lunarMonth >= 1 &&
		lunarMonth <= 12 &&
		lunarDay >= 1 &&
		lunarDay <= 30
			? {
					year: lunarYear,
					month: lunarMonth,
					day: lunarDay,
					leap: vevent.getFirstPropertyValue('x-truespace-lunar-leap') === 'TRUE',
				}
			: undefined;
	return {
		uid: event.uid,
		title: event.summary || '(Untitled)',
		start: start.toISOString(),
		end: end.toISOString(),
		allDay: event.startDate.isDate,
		description: event.description || undefined,
		location: event.location || undefined,
		calendarId,
		kind: kind === 'BIRTHDAY' ? 'birthday' : undefined,
		calendarSystem: calendarSystem === 'LUNAR' ? 'lunar' : calendarSystem === 'SOLAR' ? 'solar' : undefined,
		recurrence: /(?:^|;)FREQ=YEARLY(?:;|$)/i.test(recurrenceRule) || kind === 'BIRTHDAY' ? 'yearly' : undefined,
		lunarDate,
	};
}

function lunarOccurrenceDates(event: CalendarEvent): string[] {
	if (event.calendarSystem !== 'lunar' || !event.lunarDate) return [];
	const values: string[] = [];
	for (let year = Math.max(event.lunarDate.year, 1900); year <= 2100; year += 1) {
		let lunarDay = event.lunarDate.day;
		let solar: ReturnType<Lunar['getSolar']> | null = null;
		while (lunarDay >= 1 && solar === null) {
			try {
				solar = Lunar.fromYmd(
					year,
					event.lunarDate.leap ? -event.lunarDate.month : event.lunarDate.month,
					lunarDay,
				).getSolar();
			} catch {
				lunarDay -= 1;
			}
		}
		if (!solar && event.lunarDate.leap) {
			for (let day = event.lunarDate.day; day >= Math.max(1, event.lunarDate.day - 1); day -= 1) {
				try {
					solar = Lunar.fromYmd(year, event.lunarDate.month, day).getSolar();
					break;
				} catch {
					// Years without the selected leap month fall back to the regular month when possible.
				}
			}
		}
		if (solar) {
			values.push(
				`${String(solar.getYear()).padStart(4, '0')}${String(solar.getMonth()).padStart(2, '0')}${String(solar.getDay()).padStart(2, '0')}`,
			);
		}
	}
	return values;
}

export function createIcs(event: CalendarEvent): string {
	const now = formatUtc(new Date().toISOString());
	const dateType = event.allDay ? ';VALUE=DATE' : '';
	const start = event.allDay ? formatDate(event.start) : formatUtc(event.start);
	const end = event.allDay ? formatDate(event.end) : formatUtc(event.end);
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//r2-webdav-x//CalDAV//EN',
		'CALSCALE:GREGORIAN',
		'BEGIN:VEVENT',
		`UID:${toIcalText(event.uid)}`,
		`DTSTAMP:${now}`,
		`DTSTART${dateType}:${start}`,
		`DTEND${dateType}:${end}`,
		`SUMMARY:${toIcalText(event.title)}`,
	];
	if (event.description) lines.push(`DESCRIPTION:${toIcalText(event.description)}`);
	if (event.location) lines.push(`LOCATION:${toIcalText(event.location)}`);
	if (event.kind === 'birthday') {
		lines.push('X-TRUESPACE-EVENT-KIND:BIRTHDAY', 'TRANSP:TRANSPARENT');
	}
	if (event.calendarSystem) lines.push(`X-TRUESPACE-CALENDAR-SYSTEM:${event.calendarSystem.toUpperCase()}`);
	if (event.lunarDate) {
		lines.push(
			`X-TRUESPACE-LUNAR-YEAR:${event.lunarDate.year}`,
			`X-TRUESPACE-LUNAR-MONTH:${event.lunarDate.month}`,
			`X-TRUESPACE-LUNAR-DAY:${event.lunarDate.day}`,
			`X-TRUESPACE-LUNAR-LEAP:${event.lunarDate.leap ? 'TRUE' : 'FALSE'}`,
		);
	}
	if (event.recurrence === 'yearly' && event.calendarSystem !== 'lunar') lines.push('RRULE:FREQ=YEARLY');
	if (event.recurrence === 'yearly' && event.calendarSystem === 'lunar') {
		const occurrences = lunarOccurrenceDates(event);
		if (occurrences.length) lines.push(`RDATE;VALUE=DATE:${occurrences.join(',')}`);
	}
	lines.push('END:VEVENT', 'END:VCALENDAR', '');
	const source = lines.map(foldLine).join('\r\n');
	parseIcs(source, event.calendarId);
	return source;
}
