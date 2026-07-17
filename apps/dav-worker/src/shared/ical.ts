import ICAL from 'ical.js';
import type { CalendarEvent } from '@r2-webdav/shared-types';

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

export function parseIcs(source: string, calendarId: string): CalendarEvent {
	const component = new ICAL.Component(ICAL.parse(source));
	const vevent = component.getFirstSubcomponent('vevent');
	if (vevent === null) throw new Error('The iCalendar payload must contain a VEVENT');
	const event = new ICAL.Event(vevent);
	if (!event.uid || !event.startDate) throw new Error('VEVENT requires UID and DTSTART');
	const start = event.startDate.toJSDate();
	const end = event.endDate?.toJSDate() ?? start;
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error('VEVENT contains an invalid date');
	return {
		uid: event.uid,
		title: event.summary || '(Untitled)',
		start: start.toISOString(),
		end: end.toISOString(),
		allDay: event.startDate.isDate,
		description: event.description || undefined,
		location: event.location || undefined,
		calendarId,
	};
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
	lines.push('END:VEVENT', 'END:VCALENDAR', '');
	const source = lines.join('\r\n');
	parseIcs(source, event.calendarId);
	return source;
}
