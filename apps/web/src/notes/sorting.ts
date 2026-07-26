import type { Note } from '@r2-webdav/shared-types';
import { locale } from '../i18n';
import { noteSort } from './store';

export function sortNotes(items: Note[]): void {
	const collator = new Intl.Collator(locale === 'zh' ? 'zh-CN' : 'en', { numeric: true, sensitivity: 'base' });
	items.sort((left, right) => {
		const pinned = Number(right.pinned) - Number(left.pinned);
		if (pinned) return pinned;
		switch (noteSort) {
			case 'name-asc':
				return collator.compare(left.title, right.title);
			case 'name-desc':
				return collator.compare(right.title, left.title);
			case 'modified-asc':
				return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
			case 'created-desc':
				return Date.parse(right.createdAt) - Date.parse(left.createdAt);
			case 'created-asc':
				return Date.parse(left.createdAt) - Date.parse(right.createdAt);
			default:
				return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
		}
	});
}
