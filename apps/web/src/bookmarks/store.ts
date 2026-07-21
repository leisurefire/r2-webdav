import type { BookmarkHub } from '@r2-webdav/shared-types';
import { api } from '../api/client';
import { errorMessage, toast } from '../shell';

export let bookmarkHub: BookmarkHub | null = null;
export function setBookmarkHub(next: BookmarkHub | null): void {
	bookmarkHub = next;
}
export let bookmarkChecked = localStorage.getItem('r2_bookmarks_checked') === '1';
export function setBookmarkChecked(next: boolean): void {
	bookmarkChecked = next;
}

export function readBookmarkCache(): BookmarkHub | null {
	try {
		return JSON.parse(localStorage.getItem('r2_bookmarks_cache') ?? 'null') as BookmarkHub | null;
	} catch {
		return null;
	}
}

setBookmarkHub(readBookmarkCache());

export function cacheBookmarks(value: BookmarkHub | null): void {
	setBookmarkHub(value);
	setBookmarkChecked(true);
	localStorage.setItem('r2_bookmarks_checked', '1');
	if (value) localStorage.setItem('r2_bookmarks_cache', JSON.stringify(value));
	else localStorage.removeItem('r2_bookmarks_cache');
}

export async function pullBookmarks(force = false): Promise<void> {
	if (!force && bookmarkChecked) return;
	try {
		cacheBookmarks(await api.bookmarks());
	} catch (error) {
		if (force) toast(errorMessage(error));
	}
}

setBookmarkHub(readBookmarkCache());
