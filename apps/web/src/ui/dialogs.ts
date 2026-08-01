import { html } from './markup';

export type ModalSize = 'small' | 'medium' | 'large';

export interface ShowModalOptions {
	dismissOnBackdrop?: boolean;
	onClose?: () => void;
}

export function createModalDialog(size: ModalSize, className = ''): HTMLDialogElement {
	const dialog = document.createElement('dialog');
	dialog.className = ['ui-modal', `ui-modal--${size}`, className].filter(Boolean).join(' ');
	return dialog;
}

export function showModalDialog(dialog: HTMLDialogElement, options: ShowModalOptions = {}): void {
	const dismissOnBackdrop = (event: MouseEvent) => {
		if (options.dismissOnBackdrop && event.target === dialog) dialog.close('cancel');
	};
	dialog.addEventListener('click', dismissOnBackdrop);
	dialog.addEventListener(
		'close',
		() => {
			dialog.removeEventListener('click', dismissOnBackdrop);
			options.onClose?.();
			dialog.remove();
		},
		{ once: true },
	);
	document.body.append(dialog);
	dialog.showModal();
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
		dialog.innerHTML = `<form method="dialog" class="dialog-body confirm-dialog-body"><h2 id="confirm-dialog-title">${html(title)}</h2>${message ? `<p class="muted">${html(message)}</p>` : ''}<div class="dialog-actions"><button class="button danger" value="confirm">${html(confirmLabel)}</button><button class="button" value="cancel" autofocus>${html(cancelLabel)}</button></div></form>`;
		showModalDialog(dialog, {
			dismissOnBackdrop: true,
			onClose: () => resolve(dialog.returnValue === 'confirm'),
		});
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
		dialog.innerHTML = `<form method="dialog" class="dialog-body"><h2 id="input-dialog-title">${html(title)}</h2><div class="field"><label for="dialog-value">${html(label)}</label><input class="input" id="dialog-value" value="${html(initial)}" required autocomplete="off"></div><div class="dialog-actions"><button class="button" value="cancel" formnovalidate>${html(cancelLabel)}</button><button class="button primary" value="confirm">${html(saveLabel)}</button></div></form>`;
		showModalDialog(dialog, {
			dismissOnBackdrop: true,
			onClose: () => {
				const value =
					dialog.returnValue === 'confirm'
						? dialog.querySelector<HTMLInputElement>('#dialog-value')!.value.trim()
						: null;
				resolve(value);
			},
		});
		dialog.querySelector<HTMLInputElement>('input')?.select();
	});
}
