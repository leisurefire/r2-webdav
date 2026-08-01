import type { CalendarEvent, CalendarSummary } from '@r2-webdav/shared-types';
import { api } from '../api/client';
import { errorMessage, html, pageFromPath, refreshIcons, shell, sidebarContext, toast } from '../shell';
import { locale, t } from '../i18n';
import {
	emptyStateMarkup,
	errorBannerMarkup,
	iconButtonMarkup,
	iconToolbarMarkup,
	workspaceSidebarMarkup,
} from '../ui/helpers';
import { lunarDate } from './calendarDates';

export { inputDate } from './calendarDates';
export { lunarDate } from './calendarDates';

export async function eventDialog(
	calendar: CalendarSummary,
	existing?: CalendarEvent,
	defaultDate?: Date,
): Promise<'saved' | 'deleted' | null> {
	return (await import('./calendarEventDialog')).eventDialog(calendar, existing, defaultDate);
}

export let calendarCursor = new Date();
calendarCursor.setDate(1);
export type DateRange = { from: number; to: number };
export const calendarCache: {
	calendars: CalendarSummary[] | null;
	events: Map<string, CalendarEvent>;
	loadedRanges: DateRange[];
} = { calendars: null, events: new Map(), loadedRanges: [] };
let calendarRequest = 0;
const calendarValidatedRanges: DateRange[] = [];

export function localDateKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function eventCacheKey(event: CalendarEvent): string {
	return `${event.uid}@${event.start}`;
}

export function mergeRangeInto(target: DateRange[], range: DateRange): void {
	const ranges = [...target, range].sort((a, b) => a.from - b.from);
	const merged = ranges.reduce<DateRange[]>((result, current) => {
		const last = result.at(-1);
		if (!last || current.from > last.to) result.push({ ...current });
		else last.to = Math.max(last.to, current.to);
		return result;
	}, []);
	target.splice(0, target.length, ...merged);
}

export function mergeLoadedRange(range: DateRange): void {
	mergeRangeInto(calendarCache.loadedRanges, range);
	mergeRangeInto(calendarValidatedRanges, range);
}

export function missingRanges(loadedRanges: DateRange[], range: DateRange): DateRange[] {
	const missing: DateRange[] = [];
	let cursor = range.from;
	for (const loaded of loadedRanges) {
		if (loaded.to <= cursor || loaded.from >= range.to) continue;
		if (loaded.from > cursor) missing.push({ from: cursor, to: Math.min(loaded.from, range.to) });
		cursor = Math.max(cursor, loaded.to);
		if (cursor >= range.to) break;
	}
	if (cursor < range.to) missing.push({ from: cursor, to: range.to });
	return missing;
}

export function persistCalendarCache(): void {
	localStorage.setItem(
		'r2_calendar_cache',
		JSON.stringify({
			calendars: calendarCache.calendars,
			events: [...calendarCache.events.values()],
			loadedRanges: calendarCache.loadedRanges,
		}),
	);
}

export function hydrateCalendarCache(): void {
	try {
		const cached = JSON.parse(localStorage.getItem('r2_calendar_cache') ?? 'null') as {
			calendars?: CalendarSummary[];
			events?: CalendarEvent[];
			loadedRanges?: DateRange[];
		} | null;
		if (!cached) return;
		if (Array.isArray(cached.calendars)) calendarCache.calendars = cached.calendars;
		if (Array.isArray(cached.events))
			cached.events.forEach((event) => calendarCache.events.set(eventCacheKey(event), event));
		if (Array.isArray(cached.loadedRanges)) calendarCache.loadedRanges = cached.loadedRanges;
	} catch {
		localStorage.removeItem('r2_calendar_cache');
	}
}

export function invalidateCalendarCache(): void {
	calendarValidatedRanges.length = 0;
}

hydrateCalendarCache();

export function paintCalendarGrid(calendar: CalendarSummary, gridStart: Date): void {
	const grid = document.querySelector<HTMLDivElement>('#month-grid');
	if (!grid) return;
	const today = localDateKey(new Date());
	const events = [...calendarCache.events.values()];
	const cells: string[] = [];
	for (let offset = 0; offset < 42; offset += 1) {
		const date = new Date(gridStart);
		date.setDate(gridStart.getDate() + offset);
		const key = localDateKey(date);
		const lunar = lunarDate(date);
		const dayEvents = events.filter((item) => localDateKey(new Date(item.start)) === key);
		cells.push(
			`<div class="day-cell ${date.getMonth() !== calendarCursor.getMonth() ? 'outside' : ''} ${key === today ? 'today' : ''}" data-day="${key}"><div class="day-meta" title="${html(lunar.full)}"><span class="day-number">${date.getDate()}</span><span class="lunar-day">${html(lunar.short)}</span></div>${dayEvents.map((item) => `<button class="event-chip ${item.kind === 'birthday' ? 'birthday' : ''}" data-event="${html(eventCacheKey(item))}" title="${html(item.title)}">${item.allDay ? '' : `${new Date(item.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} `}${html(item.title)}</button>`).join('')}</div>`,
		);
	}
	grid.innerHTML = cells.join('');
	grid.querySelectorAll<HTMLElement>('[data-day]').forEach((cell) =>
		cell.addEventListener('dblclick', async (event) => {
			if ((event.target as HTMLElement).closest('[data-event]')) return;
			if (await eventDialog(calendar, undefined, new Date(`${cell.dataset.day}T00:00:00`))) {
				invalidateCalendarCache();
				await renderCalendar(true);
			}
		}),
	);
	grid.querySelectorAll<HTMLElement>('[data-event]').forEach((item) =>
		item.addEventListener('click', async () => {
			const event = calendarCache.events.get(item.dataset.event!);
			if (event && (await eventDialog(calendar, event))) {
				invalidateCalendarCache();
				await renderCalendar(true);
			}
		}),
	);
	paintCalendarSidebar(calendar);
}

export function paintCalendarSidebar(calendar: CalendarSummary): void {
	const context = sidebarContext();
	if (!context || pageFromPath() !== 'calendar') return;
	const now = Date.now();
	const events = [...calendarCache.events.values()];
	const upcoming = events
		.filter((event) => Date.parse(event.end) >= now)
		.sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
	const recent = (
		upcoming.length ? upcoming : events.sort((left, right) => Date.parse(right.start) - Date.parse(left.start))
	).slice(0, 8);
	const newEventLabel = locale === 'zh' ? '新建日程' : 'New event';
	const syncLabel = locale === 'zh' ? '同步日历' : 'Sync calendar';
	const tools = iconToolbarMarkup([
		{ icon: 'plus', label: newEventLabel, attributes: { 'data-cal-new': true } },
		{ icon: 'refresh-cw', label: syncLabel, attributes: { 'data-cal-refresh': true } },
	]);
	context.innerHTML = workspaceSidebarMarkup({
		label: locale === 'zh' ? '最近日程' : 'Recent schedule',
		tools,
		body: recent.length
			? recent
					.map((event) => {
						const startsAt = new Date(event.start);
						const timeLabel = event.allDay
							? locale === 'zh'
								? '全天'
								: 'All day'
							: startsAt.toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en', {
									hour: '2-digit',
									minute: '2-digit',
								});
						const dateLabel = startsAt.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en', {
							month: 'short',
							day: 'numeric',
						});
						return `<button class="recent-event collection-tree-row" data-recent-event="${html(eventCacheKey(event))}"><span class="recent-event-icon" aria-hidden="true"><i data-lucide="calendar-days"></i></span><span class="recent-event-copy"><strong>${html(event.title)}</strong><small>${html(timeLabel)}</small></span><time class="recent-event-date" datetime="${html(event.start)}">${html(dateLabel)}</time></button>`;
					})
					.join('')
			: emptyStateMarkup(locale === 'zh' ? '暂无日程' : 'No events', { compact: true }),
		treeClass: 'recent-events calendar-agenda-tree',
	});
	context.querySelectorAll<HTMLElement>('[data-recent-event]').forEach((item) =>
		item.addEventListener('click', async () => {
			const event = calendarCache.events.get(item.dataset.recentEvent!);
			if (event && (await eventDialog(calendar, event))) {
				invalidateCalendarCache();
				await renderCalendar(true);
			}
		}),
	);
	context.querySelectorAll<HTMLElement>('[data-cal-new]').forEach((item) =>
		item.addEventListener('click', async () => {
			if (await eventDialog(calendar)) {
				invalidateCalendarCache();
				await renderCalendar(true);
			}
		}),
	);
	context.querySelectorAll<HTMLElement>('[data-cal-refresh]').forEach((item) =>
		item.addEventListener('click', () => {
			invalidateCalendarCache();
			void renderCalendar(true);
		}),
	);
	refreshIcons();
}

export async function renderCalendar(forceSync = false): Promise<void> {
	if (!document.querySelector('#calendar-view')) shell('calendar');
	const content = document.querySelector<HTMLDivElement>('#page-content')!;
	try {
		calendarCache.calendars ??= await api.calendars();
		if (calendarCache.calendars.length === 0) {
			content.innerHTML = emptyStateMarkup(locale === 'zh' ? '没有日历' : 'No calendars', {
				icon: 'calendar-days',
				className: 'empty-state--fill',
			});
			refreshIcons();
			return;
		}
		const calendar = calendarCache.calendars[0];
		if (!content.querySelector('#calendar-view')) {
			const newEventLabel = locale === 'zh' ? '新建日程' : 'New event';
			const syncLabel = locale === 'zh' ? '同步日历' : 'Sync calendar';
			const previousMonthLabel = locale === 'zh' ? '上个月' : 'Previous month';
			const nextMonthLabel = locale === 'zh' ? '下个月' : 'Next month';
			const mobileTools = iconToolbarMarkup(
				[
					{ icon: 'plus', label: newEventLabel, attributes: { id: 'new-event' } },
					{ icon: 'refresh-cw', label: syncLabel, attributes: { id: 'cal-refresh' } },
				],
				'page-context-tools mobile-only-tools',
			);
			content.innerHTML = `<div class="calendar-toolbar workspace-top-row"><h2 id="calendar-title"></h2>${iconButtonMarkup({ icon: 'chevron-left', label: previousMonthLabel, className: 'button icon-button', attributes: { id: 'cal-prev' } })}<button class="button" id="cal-today">${locale === 'zh' ? '今天' : 'Today'}</button>${iconButtonMarkup({ icon: 'chevron-right', label: nextMonthLabel, className: 'button icon-button', attributes: { id: 'cal-next' } })}<span class="sync-status" id="calendar-sync"><span class="status-dot"></span>${locale === 'zh' ? '已缓存' : 'Cached'}</span>${mobileTools}</div><div class="calendar" id="calendar-view"><div class="weekday-row">${(locale === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map((day) => `<div class="weekday">${day}</div>`).join('')}</div><div class="month-grid" id="month-grid"></div></div>`;
			content.querySelector('#cal-prev')?.addEventListener('click', () => {
				calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
				void renderCalendar();
			});
			content.querySelector('#cal-next')?.addEventListener('click', () => {
				calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
				void renderCalendar();
			});
			content.querySelector('#cal-today')?.addEventListener('click', () => {
				const today = new Date();
				calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
				void renderCalendar();
			});
			content.querySelector('#cal-refresh')?.addEventListener('click', () => {
				invalidateCalendarCache();
				void renderCalendar(true);
			});
			content.querySelector('#new-event')?.addEventListener('click', async () => {
				if (await eventDialog(calendar)) {
					invalidateCalendarCache();
					await renderCalendar(true);
				}
			});
			refreshIcons();
		}

		const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
		const gridStart = new Date(first);
		gridStart.setDate(1 - first.getDay());
		const gridEnd = new Date(gridStart);
		gridEnd.setDate(gridEnd.getDate() + 42);
		const visibleRange = { from: gridStart.getTime(), to: gridEnd.getTime() };
		document.querySelector('#calendar-title')!.textContent = calendarCursor.toLocaleDateString([], {
			month: 'long',
			year: 'numeric',
		});
		paintCalendarGrid(calendar, gridStart);

		const ranges = forceSync ? [visibleRange] : missingRanges(calendarValidatedRanges, visibleRange);
		const syncStatus = document.querySelector<HTMLSpanElement>('#calendar-sync')!;
		if (ranges.length === 0) {
			syncStatus.innerHTML = `<span class="status-dot"></span>${locale === 'zh' ? '已缓存' : 'Cached'}`;
			return;
		}
		const requestId = ++calendarRequest;
		syncStatus.classList.add('syncing');
		syncStatus.innerHTML = `<span class="status-dot"></span>${locale === 'zh' ? '同步中' : 'Syncing'}`;
		const responses = await Promise.all(
			ranges.map((range) =>
				api.events(calendar.id, new Date(range.from).toISOString(), new Date(range.to).toISOString()),
			),
		);
		if (forceSync) {
			for (const [uid, event] of calendarCache.events) {
				if (Date.parse(event.end) > visibleRange.from && Date.parse(event.start) < visibleRange.to)
					calendarCache.events.delete(uid);
			}
		}
		responses.flat().forEach((event) => calendarCache.events.set(eventCacheKey(event), event));
		ranges.forEach(mergeLoadedRange);
		persistCalendarCache();
		if (requestId !== calendarRequest || pageFromPath() !== 'calendar') return;
		paintCalendarGrid(calendar, gridStart);
		syncStatus.classList.remove('syncing');
		syncStatus.innerHTML = `<span class="status-dot"></span>${locale === 'zh' ? '已同步' : 'Up to date'}`;
	} catch (error) {
		const syncStatus = document.querySelector<HTMLSpanElement>('#calendar-sync');
		if (syncStatus) {
			syncStatus.classList.remove('syncing');
			syncStatus.textContent = locale === 'zh' ? '同步失败' : 'Sync failed';
			toast(errorMessage(error));
		} else content.innerHTML = errorBannerMarkup(errorMessage(error));
	}
}
