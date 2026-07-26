import type { CalendarEvent, CalendarSummary } from '@r2-webdav/shared-types';
import { Lunar, Solar } from 'lunar-typescript';
import { api } from '../api/client';
import { confirmAction, errorMessage, html, toast } from '../shell';
import { locale } from '../i18n';
import { enhanceSelect } from '../ui/dropdown';
import { inputDate } from './calendarDates';

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
		dialog.querySelectorAll<HTMLSelectElement>('select').forEach((select) => enhanceSelect(select));
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
