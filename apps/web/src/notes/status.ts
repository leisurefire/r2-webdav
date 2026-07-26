import { locale } from '../i18n';

export type NoteSaveState = 'pending' | 'syncing' | 'synced' | 'failed';

export function noteSaveCopy(state: NoteSaveState): string {
	if (locale === 'zh') {
		return { pending: '待同步', syncing: '同步中', synced: '已同步', failed: '同步失败' }[state];
	}
	return { pending: 'Pending', syncing: 'Syncing', synced: 'Synced', failed: 'Sync failed' }[state];
}

export function paintNoteSaveStatus(noteId: string, state: NoteSaveState): void {
	document.querySelectorAll<HTMLElement>(`[data-note-toolbar-id="${CSS.escape(noteId)}"]`).forEach((toolbar) => {
		const status = toolbar.querySelector<HTMLElement>('[data-note-save-status]');
		if (!status) return;
		status.dataset.state = state;
		status.textContent = '';
		status.title = noteSaveCopy(state);
		status.setAttribute('aria-label', noteSaveCopy(state));
	});
}
