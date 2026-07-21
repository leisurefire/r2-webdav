import type { CalendarEvent, CalendarSummary } from '@r2-webdav/shared-types';
import { Lunar, Solar } from 'lunar-typescript';
import { api } from '../api/client';
import { confirmAction, errorMessage, html, pageFromPath, refreshIcons, shell, sidebarContext, toast } from '../shell';
import { locale, t } from '../i18n';

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

export function inputDate(value: string): string {
	const date = new Date(value);
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 16);
}

export function eventCacheKey(event: CalendarEvent): string {
	return `${event.uid}@${event.start}`;
}

export function lunarDate(date: Date): { short: string; full: string } {
	const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
	const lunar = solar.getLunar();
	const festival = [...solar.getFestivals(), ...lunar.getFestivals()][0];
	const jieQi = lunar.getJieQi();
	const day = lunar.getDayInChinese();
	const month = `${lunar.getMonthInChinese()}月`;
	return {
		short: festival || jieQi || (lunar.getDay() === 1 ? month : day),
		full: `农历${month}${day}${festival ? ` · ${festival}` : jieQi ? ` · ${jieQi}` : ''}`,
	};
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

export async function eventDialog(
	calendar: CalendarSummary,
	existing?: CalendarEvent,
	defaultDate?: Date,
): Promise<'saved' | 'deleted' | null> {
	return new Promise((resolve) => {
		const start = existing ? new Date(existing.seriesStart ?? existing.start) : new Date(defaultDate ?? new Date());
		if (!existing) start.setHours(9, 0, 0, 0);
		const duration = existing ? Math.max(1, Date.parse(existing.end) - Date.parse(existing.start)) : 60 * 60_000;
		const end = new Date(start.getTime() + duration);
		let kind: 'event' | 'birthday' = existing?.kind === 'birthday' ? 'birthday' : 'event';
		let calendarSystem: 'solar' | 'lunar' = existing?.calendarSystem === 'lunar' ? 'lunar' : 'solar';
		const initialLunar =
			existing?.lunarDate ??
			(() => {
				const lunar = Solar.fromYmd(start.getFullYear(), start.getMonth() + 1, start.getDate()).getLunar();
				return {
					year: lunar.getYear(),
					month: Math.abs(lunar.getMonth()),
					day: lunar.getDay(),
					leap: lunar.getMonth() < 0,
				};
			})();
		const copy =
			locale === 'zh'
				? {
						newEvent: '新建日程',
						editEvent: '编辑日程',
						event: '日程',
						birthday: '生日',
						title: '标题',
						solar: '公历',
						lunar: '农历',
						calendar: '日期类型',
						type: '类型',
						starts: '开始',
						ends: '结束',
						allDay: '全天',
						location: '地点',
						description: '备注',
						year: '年',
						month: '月',
						day: '日',
						leap: '闰月',
						repeat: '重复',
						yearly: '每年',
						delete: '删除',
						cancel: '取消',
						save: '保存',
						invalidLunar: '所选农历日期不存在',
					}
				: {
						newEvent: 'New event',
						editEvent: 'Edit event',
						event: 'Event',
						birthday: 'Birthday',
						title: 'Title',
						solar: 'Gregorian',
						lunar: 'Lunar',
						calendar: 'Calendar',
						type: 'Type',
						starts: 'Starts',
						ends: 'Ends',
						allDay: 'All day',
						location: 'Location',
						description: 'Notes',
						year: 'Year',
						month: 'Month',
						day: 'Day',
						leap: 'Leap month',
						repeat: 'Repeat',
						yearly: 'Every year',
						delete: 'Delete',
						cancel: 'Cancel',
						save: 'Save',
						invalidLunar: 'The selected lunar date does not exist',
					};
		const monthNames =
			locale === 'zh'
				? ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月']
				: Array.from({ length: 12 }, (_, index) => `Month ${index + 1}`);
		const dayNames =
			locale === 'zh'
				? [
						'初一',
						'初二',
						'初三',
						'初四',
						'初五',
						'初六',
						'初七',
						'初八',
						'初九',
						'初十',
						'十一',
						'十二',
						'十三',
						'十四',
						'十五',
						'十六',
						'十七',
						'十八',
						'十九',
						'二十',
						'廿一',
						'廿二',
						'廿三',
						'廿四',
						'廿五',
						'廿六',
						'廿七',
						'廿八',
						'廿九',
						'三十',
					]
				: Array.from({ length: 30 }, (_, index) => `Day ${index + 1}`);
		const timeValue = (date: Date) =>
			`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
		const dialog = document.createElement('dialog');
		dialog.className = 'event-dialog';
		dialog.innerHTML = `<form class="dialog-body" id="event-form"><h2>${existing ? copy.editEvent : copy.newEvent}</h2>
			<div class="event-dialog-options">
				<div class="field"><label>${copy.type}</label><div class="segment-control compact"><button type="button" data-event-kind="event">${copy.event}</button><button type="button" data-event-kind="birthday">${copy.birthday}</button></div></div>
				<div class="field"><label>${copy.calendar}</label><div class="segment-control compact"><button type="button" data-calendar-system="solar">${copy.solar}</button><button type="button" data-calendar-system="lunar">${copy.lunar}</button></div></div>
			</div>
			<div class="field"><label for="event-title">${copy.title}</label><input class="input" id="event-title" value="${html(existing?.title ?? '')}" required></div>
			<div id="event-solar-fields"><div class="event-time-grid"><div class="field"><label for="event-start">${copy.starts}</label><input class="input" type="datetime-local" id="event-start" value="${inputDate(start.toISOString())}" required></div><div class="field event-end-field"><label for="event-end">${copy.ends}</label><input class="input" type="datetime-local" id="event-end" value="${inputDate(end.toISOString())}" required></div></div></div>
			<div id="event-lunar-fields" hidden><div class="lunar-date-grid"><div class="field"><label for="event-lunar-year">${copy.year}</label><input class="input" type="number" min="1900" max="2100" id="event-lunar-year" value="${initialLunar.year}" required></div><div class="field"><label for="event-lunar-month">${copy.month}</label><select class="input" id="event-lunar-month">${monthNames.map((name, index) => `<option value="${index + 1}" ${initialLunar.month === index + 1 ? 'selected' : ''}>${name}</option>`).join('')}</select></div><div class="field"><label for="event-lunar-day">${copy.day}</label><select class="input" id="event-lunar-day">${dayNames.map((name, index) => `<option value="${index + 1}" ${initialLunar.day === index + 1 ? 'selected' : ''}>${name}</option>`).join('')}</select></div></div><label class="checkbox-row"><input type="checkbox" id="event-lunar-leap" ${initialLunar.leap ? 'checked' : ''}> ${copy.leap}</label><div class="event-time-grid lunar-time-fields"><div class="field"><label for="event-start-time">${copy.starts}</label><input class="input" type="time" id="event-start-time" value="${timeValue(start)}" required></div><div class="field event-end-field"><label for="event-end-time">${copy.ends}</label><input class="input" type="time" id="event-end-time" value="${timeValue(end)}" required></div></div></div>
			<div class="field event-all-day-field"><label class="checkbox-row"><input type="checkbox" id="event-all-day" ${existing?.allDay ? 'checked' : ''}> ${copy.allDay}</label></div>
			<div class="birthday-repeat" id="birthday-repeat" hidden><span>${copy.repeat}</span><strong>${copy.yearly}</strong></div>
			<div class="field"><label for="event-location">${copy.location}</label><input class="input" id="event-location" value="${html(existing?.location ?? '')}"></div>
			<div class="field"><label for="event-description">${copy.description}</label><textarea class="input" id="event-description">${html(existing?.description ?? '')}</textarea></div>
			<div class="dialog-actions">${existing ? `<button type="button" class="button danger danger-zone" id="event-delete">${copy.delete}</button>` : ''}<button type="button" class="button" id="event-cancel">${copy.cancel}</button><button class="button primary">${copy.save}</button></div>
		</form>`;
		document.body.append(dialog);
		const setState = () => {
			dialog
				.querySelectorAll<HTMLElement>('[data-event-kind]')
				.forEach((button) => button.classList.toggle('active', button.dataset.eventKind === kind));
			dialog
				.querySelectorAll<HTMLElement>('[data-calendar-system]')
				.forEach((button) => button.classList.toggle('active', button.dataset.calendarSystem === calendarSystem));
			const solarFields = dialog.querySelector<HTMLElement>('#event-solar-fields')!;
			const lunarFields = dialog.querySelector<HTMLElement>('#event-lunar-fields')!;
			solarFields.hidden = calendarSystem !== 'solar';
			lunarFields.hidden = calendarSystem !== 'lunar';
			dialog.querySelectorAll<HTMLElement>('.event-end-field').forEach((field) => (field.hidden = kind === 'birthday'));
			dialog.querySelector<HTMLElement>('.event-all-day-field')!.hidden = kind === 'birthday';
			dialog.querySelector<HTMLElement>('#birthday-repeat')!.hidden = kind !== 'birthday';
			dialog.querySelector<HTMLElement>('.lunar-time-fields')!.hidden = kind === 'birthday';
			const allDay = dialog.querySelector<HTMLInputElement>('#event-all-day')!;
			if (kind === 'birthday') allDay.checked = true;
		};
		dialog.querySelectorAll<HTMLElement>('[data-event-kind]').forEach((button) =>
			button.addEventListener('click', () => {
				kind = button.dataset.eventKind as 'event' | 'birthday';
				setState();
			}),
		);
		dialog.querySelectorAll<HTMLElement>('[data-calendar-system]').forEach((button) =>
			button.addEventListener('click', () => {
				calendarSystem = button.dataset.calendarSystem as 'solar' | 'lunar';
				setState();
			}),
		);
		setState();
		const finish = (result: 'saved' | 'deleted' | null) => {
			dialog.close();
			dialog.remove();
			resolve(result);
		};
		dialog.querySelector('#event-cancel')?.addEventListener('click', () => finish(null));
		dialog.querySelector('#event-delete')?.addEventListener('click', async () => {
			if (!existing || !(await confirmAction(`${copy.delete}?`, existing.title))) return;
			try {
				await api.deleteEvent(calendar.id, existing.uid);
				finish('deleted');
			} catch (error) {
				toast(errorMessage(error));
			}
		});
		dialog.querySelector<HTMLFormElement>('#event-form')?.addEventListener('submit', async (event) => {
			event.preventDefault();
			const value = (id: string) => dialog.querySelector<HTMLInputElement>(id)!.value;
			try {
				const allDay = kind === 'birthday' || dialog.querySelector<HTMLInputElement>('#event-all-day')!.checked;
				let eventStart: Date;
				let eventEnd: Date;
				let lunarDate: CalendarEvent['lunarDate'];
				if (calendarSystem === 'lunar') {
					const year = Number(value('#event-lunar-year'));
					const month = Number(value('#event-lunar-month'));
					const day = Number(value('#event-lunar-day'));
					const leap = dialog.querySelector<HTMLInputElement>('#event-lunar-leap')!.checked;
					let solar;
					try {
						solar = Lunar.fromYmd(year, leap ? -month : month, day).getSolar();
					} catch {
						toast(copy.invalidLunar);
						return;
					}
					const [startHour, startMinute] = (kind === 'birthday' ? '00:00' : value('#event-start-time'))
						.split(':')
						.map(Number);
					const [endHour, endMinute] = (kind === 'birthday' ? '00:00' : value('#event-end-time'))
						.split(':')
						.map(Number);
					eventStart = new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay(), startHour, startMinute);
					eventEnd = new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay(), endHour, endMinute);
					if (allDay || eventEnd <= eventStart) eventEnd.setDate(eventEnd.getDate() + 1);
					lunarDate = { year, month, day, leap };
				} else {
					eventStart = new Date(value('#event-start'));
					eventEnd = kind === 'birthday' ? new Date(eventStart) : new Date(value('#event-end'));
					if (allDay) {
						eventStart.setHours(0, 0, 0, 0);
						eventEnd = new Date(eventStart);
						eventEnd.setDate(eventEnd.getDate() + 1);
					}
				}
				await api.putEvent(calendar.id, {
					uid: existing?.uid,
					title: value('#event-title'),
					start: eventStart.toISOString(),
					end: eventEnd.toISOString(),
					allDay,
					location: value('#event-location'),
					description: dialog.querySelector<HTMLTextAreaElement>('#event-description')!.value,
					kind,
					calendarSystem,
					recurrence: kind === 'birthday' ? 'yearly' : undefined,
					lunarDate,
				});
				finish('saved');
			} catch (error) {
				toast(errorMessage(error));
			}
		});
		dialog.addEventListener('cancel', () => finish(null), { once: true });
		dialog.showModal();
		dialog.querySelector<HTMLInputElement>('#event-title')?.focus();
	});
}

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
	const tools = `<div class="sidebar-context-tools">
		<button type="button" class="row-action" data-cal-new title="${newEventLabel}" aria-label="${newEventLabel}"><i data-lucide="plus"></i></button>
		<button type="button" class="row-action" data-cal-refresh title="${syncLabel}" aria-label="${syncLabel}"><i data-lucide="refresh-cw"></i></button>
	</div>`;
	context.innerHTML = `<div class="sidebar-context-head"><strong>${locale === 'zh' ? '最近日程' : 'Recent schedule'}</strong>${tools}</div><div class="recent-events">${
		recent.length
			? recent
					.map(
						(event) =>
							`<button class="recent-event" data-recent-event="${html(eventCacheKey(event))}"><span class="recent-event-date">${new Date(event.start).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en', { month: 'short', day: 'numeric' })}</span><span class="recent-event-copy"><strong>${html(event.title)}</strong><small>${event.allDay ? (locale === 'zh' ? '全天' : 'All day') : new Date(event.start).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' })}</small></span></button>`,
					)
					.join('')
			: `<div class="sidebar-context-empty">${locale === 'zh' ? '暂无日程' : 'No events'}</div>`
	}</div>`;
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
	if (!document.querySelector('#calendar-view')) shell('calendar', t('calendar'));
	const content = document.querySelector<HTMLDivElement>('#page-content')!;
	try {
		calendarCache.calendars ??= await api.calendars();
		if (calendarCache.calendars.length === 0) {
			content.innerHTML = `<div class="empty-state"><div>${locale === 'zh' ? '没有日历' : 'No calendars'}</div></div>`;
			return;
		}
		const calendar = calendarCache.calendars[0];
		if (!content.querySelector('#calendar-view')) {
			const newEventLabel = locale === 'zh' ? '新建日程' : 'New event';
			const syncLabel = locale === 'zh' ? '同步日历' : 'Sync calendar';
			content.innerHTML = `<div class="calendar-toolbar"><h2 id="calendar-title"></h2><button class="button icon-button" id="cal-prev"><i data-lucide="chevron-left"></i></button><button class="button" id="cal-today">${locale === 'zh' ? '今天' : 'Today'}</button><button class="button icon-button" id="cal-next"><i data-lucide="chevron-right"></i></button><span class="sync-status" id="calendar-sync"><span class="status-dot"></span>${locale === 'zh' ? '已缓存' : 'Cached'}</span><div class="page-context-tools mobile-only-tools"><button type="button" class="row-action" id="new-event" title="${newEventLabel}" aria-label="${newEventLabel}"><i data-lucide="plus"></i></button><button type="button" class="row-action" id="cal-refresh" title="${syncLabel}" aria-label="${syncLabel}"><i data-lucide="refresh-cw"></i></button></div></div><div class="calendar" id="calendar-view"><div class="weekday-row">${(locale === 'zh' ? ['日', '一', '二', '三', '四', '五', '六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map((day) => `<div class="weekday">${day}</div>`).join('')}</div><div class="month-grid" id="month-grid"></div></div>`;
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
			syncStatus.innerHTML = '<span class="status-dot"></span>Cached';
			return;
		}
		const requestId = ++calendarRequest;
		syncStatus.classList.add('syncing');
		syncStatus.innerHTML = '<span class="status-dot"></span>Syncing';
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
		syncStatus.innerHTML = '<span class="status-dot"></span>Up to date';
	} catch (error) {
		const syncStatus = document.querySelector<HTMLSpanElement>('#calendar-sync');
		if (syncStatus) {
			syncStatus.classList.remove('syncing');
			syncStatus.textContent = 'Sync failed';
			toast(errorMessage(error));
		} else content.innerHTML = `<div class="error-banner">${html(errorMessage(error))}</div>`;
	}
}
