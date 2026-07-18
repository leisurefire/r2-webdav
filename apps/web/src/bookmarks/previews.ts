function bindIcon(icon: HTMLImageElement): void {
	const fallback = icon.parentElement?.querySelector<HTMLElement>('[data-bookmark-fallback]');
	const show = () => {
		icon.hidden = false;
		if (fallback) fallback.hidden = true;
	};
	const hide = () => {
		icon.hidden = true;
		if (fallback) fallback.hidden = false;
	};
	icon.addEventListener('load', show, { once: true });
	icon.addEventListener('error', hide, { once: true });
	if (icon.complete) {
		if (icon.naturalWidth) show();
		else hide();
	}
}

/** Icons are loaded directly by the browser so sites can apply their own CORS policy. */
export function bindBookmarkPreviews(root: HTMLElement): void {
	root.querySelectorAll<HTMLImageElement>('[data-bookmark-icon]').forEach(bindIcon);
}
