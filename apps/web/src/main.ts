import 'katex/dist/katex.min.css';
import './styles.css';
import './styles/bookmarks.css';
import './styles/notes.css';
import './styles/ai.css';
import './styles/responsive.css';
import { hasSession } from './api/client';
import { pageFromPath, registerRender } from './shell';
import { renderCalendar } from './pages/calendar';
import { renderFiles } from './pages/files';
import { renderLinks } from './pages/bookmarks';
import { renderLogin } from './pages/login';
import { renderNotes, paintNotes } from './notes/page';
import { openSettingsModal } from './pages/settings';
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

async function render(): Promise<void> {
	if (location.pathname === '/login' || !hasSession()) {
		if (location.pathname !== '/login') history.replaceState({}, '', '/login');
		renderLogin();
		return;
	}
	const legacySettingsTab =
		location.pathname === '/devices' ? 'devices' : location.pathname === '/settings' ? 'connection' : null;
	if (legacySettingsTab) history.replaceState({}, '', '/files');
	const page = pageFromPath();
	if (
		location.pathname === '/' ||
		(!['/files', '/calendar', '/notes', '/links', '/devices', '/settings'].includes(location.pathname) && !/^\/notes\/[^/]+$/.test(location.pathname))
	)
		history.replaceState({}, '', `/${page}`);
	if (page === 'files') await renderFiles();
	else if (page === 'calendar') await renderCalendar();
	else if (page === 'notes') await renderNotes();
	else if (page === 'links') await renderLinks();
	else await renderLinks();
	if (legacySettingsTab) await openSettingsModal(legacySettingsTab);
}

registerRender(render);
document.addEventListener('truespace:open-settings', () => void openSettingsModal());

window.addEventListener('popstate', () => {
	if (mobileNoteDialogOpen) {
		setMobileNoteDialogOpen(false);
		const dialog = document.querySelector<HTMLDialogElement>('#note-dialog[open]');
		const flush = flushMobileNote;
		const selectedId = mobileNoteId;
		setFlushMobileNote(null);
		setMobileNoteId(undefined);
		void (async () => {
			await flush?.();
			dialog?.close();
			if (pageFromPath() === 'notes' && notesData) paintNotes(notesData, selectedId);
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
