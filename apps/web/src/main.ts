import 'katex/dist/katex.min.css';
import './styles.css';
import './styles/components.css';
import './styles/bookmarks.css';
import './styles/notes.css';
import './styles/ai.css';
import './styles/responsive.css';
import { hasSession } from './api/client';
import { pageFromPath, registerRender } from './shell';
import { flushAllNoteCommits, hasUnsyncedNoteChanges } from './notes/commits';
import {
	flushMobileNote,
	mobileNoteDialogOpen,
	mobileNoteId,
	notesData,
	setFlushMobileNote,
	setMobileNoteDialogOpen,
	setMobileNoteId,
} from './notes/store';

const pageRenderers = {
	files: async () => (await import('./pages/files')).renderFiles(),
	calendar: async () => (await import('./pages/calendar')).renderCalendar(),
	notes: async () => (await import('./notes/page')).renderNotes(),
	links: async () => (await import('./pages/bookmarks')).renderLinks(),
} satisfies Record<'files' | 'calendar' | 'notes' | 'links', () => Promise<void>>;

async function openSettings(tab?: 'connection' | 'devices'): Promise<void> {
	const { openSettingsModal } = await import('./pages/settings');
	await openSettingsModal(tab);
}

async function render(): Promise<void> {
	if (location.pathname === '/login' || !hasSession()) {
		if (location.pathname !== '/login') history.replaceState({}, '', '/login');
		(await import('./pages/login')).renderLogin();
		return;
	}
	const legacySettingsTab =
		location.pathname === '/devices' ? 'devices' : location.pathname === '/settings' ? 'connection' : null;
	if (legacySettingsTab) history.replaceState({}, '', '/files');
	const page = pageFromPath();
	if (
		location.pathname === '/' ||
		(!['/files', '/calendar', '/notes', '/links', '/devices', '/settings'].includes(location.pathname) &&
			!/^\/notes\/[^/]+$/.test(location.pathname))
	)
		history.replaceState({}, '', `/${page}`);
	const renderer = pageRenderers[page as keyof typeof pageRenderers] ?? pageRenderers.links;
	await renderer();
	if (legacySettingsTab) await openSettings(legacySettingsTab);
}

registerRender(render);
document.addEventListener('truespace:open-settings', () => void openSettings());

const mobileNoteViewport = matchMedia('(max-width: 760px)');
let mobileNoteViewportExitPending = false;

// A modal dialog stays in the browser's top layer even after desktop CSS hides it.
// Leave the mobile history entry when the viewport grows so popstate can close it
// and restore the interactive desktop editor.
mobileNoteViewport.addEventListener('change', (event) => {
	if (event.matches || !mobileNoteDialogOpen || mobileNoteViewportExitPending) return;
	mobileNoteViewportExitPending = true;
	history.back();
});

window.addEventListener('popstate', () => {
	const bottomSheet = document.querySelector<HTMLElement>('.bottom-sheet');
	if (bottomSheet) {
		bottomSheet.dispatchEvent(new CustomEvent('r2:close-bottom-sheet'));
		if (!mobileNoteViewport.matches && mobileNoteDialogOpen) history.back();
		return;
	}
	if (mobileNoteDialogOpen) {
		mobileNoteViewportExitPending = false;
		setMobileNoteDialogOpen(false);
		const dialog = document.querySelector<HTMLDialogElement>('#note-dialog[open]');
		const flush = flushMobileNote;
		const selectedId = mobileNoteId;
		setFlushMobileNote(null);
		setMobileNoteId(undefined);
		void (async () => {
			await flush?.();
			dialog?.close();
			if (pageFromPath() === 'notes' && notesData) {
				const { paintNotes } = await import('./notes/page');
				paintNotes(notesData, selectedId);
			}
		})();
		return;
	}
	void render();
});
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'hidden') void flushAllNoteCommits();
});
window.addEventListener('pagehide', () => void flushAllNoteCommits());
window.addEventListener('beforeunload', (event) => {
	if (!hasUnsyncedNoteChanges()) return;
	// Nudge the browser to confirm leaving while creates/edits/deletes are still syncing.
	void flushAllNoteCommits();
	event.preventDefault();
	event.returnValue = '';
});
void render();
