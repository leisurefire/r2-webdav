function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

export function openConfirmDialog(
	title: string,
	message: string,
	confirmLabel: string,
	cancelLabel: string,
): Promise<boolean> {
	return new Promise((resolve) => {
		const dialog = document.createElement('dialog');
		dialog.innerHTML = `<form method="dialog" class="dialog-body"><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(message)}</p><div class="dialog-actions"><button class="button" value="cancel">${escapeHtml(cancelLabel)}</button><button class="button danger" value="confirm">${escapeHtml(confirmLabel)}</button></div></form>`;
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
		const dialog = document.createElement('dialog');
		dialog.innerHTML = `<form method="dialog" class="dialog-body"><h2>${escapeHtml(title)}</h2><div class="field"><label for="dialog-value">${escapeHtml(label)}</label><input class="input" id="dialog-value" value="${escapeHtml(initial)}" required autocomplete="off"></div><div class="dialog-actions"><button class="button" value="cancel" formnovalidate>${escapeHtml(cancelLabel)}</button><button class="button primary" value="confirm">${escapeHtml(saveLabel)}</button></div></form>`;
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
