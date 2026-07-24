export interface BottomSheetHandle {
	requestClose: () => void;
	destroy: () => void;
}

/** Adds the shared mobile sheet affordances to a panel without changing desktop layout. */
export function mountBottomSheet(panel: HTMLElement, onClose: () => void): BottomSheetHandle {
	const mobile = matchMedia('(max-width: 760px)').matches;
	const viewport = mobile ? window.visualViewport : null;
	let baselineViewportHeight = viewport?.height ?? window.innerHeight;
	let viewportFrame = 0;
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
	const scrollNode = panel.querySelector<HTMLElement>('[data-bottom-sheet-scroll]');
	const syncViewport = () => {
		if (!mobile) return;
		if (viewportFrame) cancelAnimationFrame(viewportFrame);
		viewportFrame = requestAnimationFrame(() => {
			viewportFrame = 0;
			const availableHeight = viewport?.height ?? window.innerHeight;
			const viewportTop = viewport?.offsetTop ?? 0;
			const keyboardInset = Math.max(0, window.innerHeight - availableHeight - viewportTop);
			const active = document.activeElement;
			const editing =
				active instanceof HTMLElement &&
				panel.contains(active) &&
				(active.matches('input, textarea, select') || active.isContentEditable);
			if (!editing) baselineViewportHeight = Math.max(baselineViewportHeight, availableHeight);
			const keyboardOpen = editing && Math.max(keyboardInset, baselineViewportHeight - availableHeight) > 72;
			const nearBottom = scrollNode
				? scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight < 80
				: false;
			panel.style.setProperty('--bottom-sheet-viewport-height', `${availableHeight}px`);
			panel.style.setProperty('--bottom-sheet-keyboard-offset', `${keyboardOpen ? keyboardInset : 0}px`);
			panel.classList.toggle('is-keyboard-open', keyboardOpen);
			requestAnimationFrame(() => {
				if (scrollNode && (nearBottom || keyboardOpen)) scrollNode.scrollTop = scrollNode.scrollHeight;
			});
		});
	};
	const onFocusChange = () => window.setTimeout(syncViewport, 0);
	viewport?.addEventListener('resize', syncViewport);
	viewport?.addEventListener('scroll', syncViewport);
	window.addEventListener('resize', syncViewport);
	panel.addEventListener('focusin', onFocusChange);
	panel.addEventListener('focusout', onFocusChange);
	syncViewport();
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
			if (viewportFrame) cancelAnimationFrame(viewportFrame);
			viewport?.removeEventListener('resize', syncViewport);
			viewport?.removeEventListener('scroll', syncViewport);
			window.removeEventListener('resize', syncViewport);
			panel.removeEventListener('focusin', onFocusChange);
			panel.removeEventListener('focusout', onFocusChange);
			backdrop.removeEventListener('click', onBackdrop);
			head?.removeEventListener('pointerdown', onPointerDown);
			head?.removeEventListener('pointerup', onPointerUp);
			head?.removeEventListener('pointercancel', onPointerCancel);
			panel.removeEventListener('r2:close-bottom-sheet', onCloseRequest);
			backdrop.remove();
			panel.style.removeProperty('--bottom-sheet-viewport-height');
			panel.style.removeProperty('--bottom-sheet-keyboard-offset');
			panel.classList.remove('is-keyboard-open');
			panel.classList.remove('bottom-sheet');
		},
	};
}
