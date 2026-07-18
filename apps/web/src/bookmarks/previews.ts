import type { BookmarkPreview } from '@r2-webdav/shared-types';
import { api } from '../api/client';

const DB_NAME = 'r2-bookmark-previews';
const STORE_NAME = 'previews';
let databasePromise: Promise<IDBDatabase> | null = null;
let observer: IntersectionObserver | null = null;
let generation = 0;
let active = 0;
let scheduled = 0;
const queue: Array<{ card: HTMLElement; generation: number }> = [];

function database(): Promise<IDBDatabase> {
	databasePromise ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.addEventListener('upgradeneeded', () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
		});
		request.addEventListener('success', () => resolve(request.result));
		request.addEventListener('error', () => reject(request.error));
	});
	return databasePromise;
}

async function read(url: string): Promise<BookmarkPreview | null> {
	try {
		const db = await database();
		return await new Promise((resolve, reject) => {
			const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(url);
			request.addEventListener('success', () => resolve((request.result as BookmarkPreview | undefined) ?? null));
			request.addEventListener('error', () => reject(request.error));
		});
	} catch {
		return null;
	}
}

async function write(url: string, preview: BookmarkPreview): Promise<void> {
	try {
		const db = await database();
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readwrite');
			transaction.objectStore(STORE_NAME).put(preview, url);
			transaction.addEventListener('complete', () => resolve());
			transaction.addEventListener('error', () => reject(transaction.error));
		});
	} catch {
		// IndexedDB is optional in private browsing.
	}
}

function apply(card: HTMLElement, preview: BookmarkPreview): void {
	const icon = card.querySelector<HTMLImageElement>('[data-bookmark-icon]');
	if (icon && preview.favicon) {
		icon.addEventListener(
			'load',
			() => {
				icon.hidden = false;
				icon.parentElement?.querySelector<HTMLElement>('span')?.setAttribute('hidden', '');
			},
			{ once: true },
		);
		icon.src = preview.favicon;
	}
	const cover = card.querySelector<HTMLElement>('[data-bookmark-cover]');
	const image = cover?.querySelector<HTMLImageElement>('img');
	if (cover && image && preview.image && !matchMedia('(max-width: 760px)').matches) {
		image.addEventListener(
			'load',
			() => {
				image.hidden = false;
				cover.classList.add('has-image');
				cover.querySelector<HTMLElement>('span')?.setAttribute('hidden', '');
			},
			{ once: true },
		);
		image.src = preview.image;
	}
}

async function load(card: HTMLElement, currentGeneration: number): Promise<void> {
	const url = card.dataset.bookmarkUrl;
	if (!url) return;
	const includeImage = !matchMedia('(max-width: 760px)').matches;
	let preview = await read(url);
	if (!preview || (includeImage && !preview.image)) {
		try {
			preview = await api.bookmarkPreview(url, includeImage);
			await write(url, preview);
		} catch {
			preview = {};
		}
	}
	if (currentGeneration === generation && card.isConnected) apply(card, preview);
}

function pump(): void {
	while (active < 3 && queue.length && scheduled < 20) {
		const item = queue.shift()!;
		active += 1;
		scheduled += 1;
		void load(item.card, item.generation).finally(() => {
			active -= 1;
			pump();
		});
	}
}

export function bindBookmarkPreviews(root: HTMLElement): void {
	observer?.disconnect();
	queue.length = 0;
	scheduled = 0;
	const currentGeneration = ++generation;
	const grid = root.querySelector<HTMLElement>('.bookmarks-grid');
	if (!grid) return;
	observer = new IntersectionObserver(
		(entries, currentObserver) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				currentObserver.unobserve(entry.target);
				queue.push({ card: entry.target as HTMLElement, generation: currentGeneration });
			}
			pump();
		},
		{ root: grid, rootMargin: '240px' },
	);
	root.querySelectorAll<HTMLElement>('[data-bookmark-preview]').forEach((card) => observer?.observe(card));
}
