function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

export type ModalSize = 'small' | 'large';

export function createModalDialog(size: ModalSize, className = ''): HTMLDialogElement {
	const dialog = document.createElement('dialog');
	dialog.className = ['ui-modal', `ui-modal--${size}`, className].filter(Boolean).join(' ');
	return dialog;
}

export function openConfirmDialog(
	title: string,
	message: string,
	confirmLabel: string,
	cancelLabel: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		const dialog = createModalDialog('small', 'confirm-dialog');
		dialog.setAttribute('aria-labelledby', 'confirm-dialog-title');
		dialog.innerHTML = `<form method="dialog" class="dialog-body confirm-dialog-body"><h2 id="confirm-dialog-title">${escapeHtml(title)}</h2>${message ? `<p class="muted">${escapeHtml(message)}</p>` : ''}<div class="dialog-actions"><button class="button danger" value="confirm">${escapeHtml(confirmLabel)}</button><button class="button" value="cancel" autofocus>${escapeHtml(cancelLabel)}</button></div></form>`;
		document.body.append(dialog);
		dialog.addEventListener('close', () => {
			const confirmed = dialog.returnValue === 'confirm';
			dialog.remove();
			resolve(confirmed);
		});
		dialog.showModal();
	});
}

export function openTextInputDialog(
	title: string,
	label: string,
	initial: string,
	saveLabel: string,
	cancelLabel: string,
): Promise<string | null> {
	return new Promise((resolve) => {
		const dialog = createModalDialog('small', 'input-dialog');
		dialog.setAttribute('aria-labelledby', 'input-dialog-title');
		dialog.innerHTML = `<form method="dialog" class="dialog-body"><h2 id="input-dialog-title">${escapeHtml(title)}</h2><div class="field"><label for="dialog-value">${escapeHtml(label)}</label><input class="input" id="dialog-value" value="${escapeHtml(initial)}" required autocomplete="off"></div><div class="dialog-actions"><button class="button" value="cancel" formnovalidate>${escapeHtml(cancelLabel)}</button><button class="button primary" value="confirm">${escapeHtml(saveLabel)}</button></div></form>`;
		document.body.append(dialog);
		dialog.addEventListener('close', () => {
			const value =
				dialog.returnValue === 'confirm' ? dialog.querySelector<HTMLInputElement>('#dialog-value')!.value.trim() : null;
			dialog.remove();
			resolve(value);
		});
		dialog.showModal();
		dialog.querySelector<HTMLInputElement>('input')?.select();
	});
}
