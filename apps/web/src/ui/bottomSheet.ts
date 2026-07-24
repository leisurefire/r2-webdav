export interface BottomSheetHandle {
	requestClose: () => void;
	destroy: () => void;
}

/** Adds the shared mobile sheet affordances to a panel without changing desktop layout. */
export function mountBottomSheet(panel: HTMLElement, onClose: () => void): BottomSheetHandle {
	const mobile = matchMedia('(max-width: 760px)').matches;
	const sheetId = crypto.randomUUID();
	if (mobile) history.pushState({ ...history.state, bottomSheetId: sheetId }, '', location.href);
	const requestClose = () => {
		if (mobile && history.state?.bottomSheetId === sheetId) history.back();
		else onClose();
	};
	const backdrop = document.createElement('button');
	backdrop.type = 'button';
	backdrop.className = 'bottom-sheet-backdrop';
	backdrop.setAttribute('aria-label', 'Close');
	panel.classList.add('bottom-sheet');
	panel.parentElement?.insertBefore(backdrop, panel);
	const onBackdrop = () => requestClose();
	backdrop.addEventListener('click', onBackdrop);
	const head = panel.querySelector<HTMLElement>('.note-ai-chat-head');
	let startY: number | null = null;
	const onPointerDown = (event: PointerEvent) => {
		if (event.pointerType === 'mouse') return;
		startY = event.clientY;
	};
	const onPointerUp = (event: PointerEvent) => {
		if (startY !== null && event.clientY - startY > 56) requestClose();
		startY = null;
	};
	head?.addEventListener('pointerdown', onPointerDown);
	head?.addEventListener('pointerup', onPointerUp);
	const onPointerCancel = () => {
		startY = null;
	};
	head?.addEventListener('pointercancel', onPointerCancel);
	const onCloseRequest = () => onClose();
	panel.addEventListener('r2:close-bottom-sheet', onCloseRequest);
	return {
		requestClose,
		destroy: () => {
			backdrop.removeEventListener('click', onBackdrop);
			head?.removeEventListener('pointerdown', onPointerDown);
			head?.removeEventListener('pointerup', onPointerUp);
			head?.removeEventListener('pointercancel', onPointerCancel);
			panel.removeEventListener('r2:close-bottom-sheet', onCloseRequest);
			backdrop.remove();
			panel.classList.remove('bottom-sheet');
		},
	};
}
