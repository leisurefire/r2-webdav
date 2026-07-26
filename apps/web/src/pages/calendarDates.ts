import { Solar } from 'lunar-typescript';

export function inputDate(value: string): string {
	const date = new Date(value);
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 16);
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
