export type MarkupAttributeValue = string | number | boolean | null | undefined;

export function html(value: unknown): string {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(char) =>
			({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#039;',
			})[char]!,
	);
}

export function markupAttributes(attributes: Record<string, MarkupAttributeValue> = {}): string {
	return Object.entries(attributes)
		.filter(([name, value]) => /^[a-z][\w:-]*$/i.test(name) && value != null)
		.filter(([name, value]) => value !== false || name.startsWith('aria-'))
		.map(([name, value]) => (value === true && !name.startsWith('aria-') ? name : `${name}="${html(value)}"`))
		.join(' ');
}

export interface IconButtonOptions {
	icon: string;
	label: string;
	className?: string;
	attributes?: Record<string, MarkupAttributeValue>;
}

export function iconButtonMarkup(options: IconButtonOptions): string {
	const attributes = markupAttributes(options.attributes);
	return `<button type="button" class="${html(options.className ?? 'row-action')}" title="${html(options.label)}" aria-label="${html(options.label)}"${attributes ? ` ${attributes}` : ''}><i data-lucide="${html(options.icon)}"></i></button>`;
}

export function iconToolbarMarkup(buttons: IconButtonOptions[], className = 'sidebar-context-tools'): string {
	return `<div class="${html(className)}">${buttons.map(iconButtonMarkup).join('')}</div>`;
}

export interface MenuItemOptions {
	label: string;
	icon?: string;
	trailingIcon?: string;
	trailingIconClassName?: string;
	className?: string;
	attributes?: Record<string, MarkupAttributeValue>;
}

export function menuItemMarkup(options: MenuItemOptions): string {
	const attributes = markupAttributes({ role: 'menuitem', ...options.attributes });
	return `<button type="button"${options.className ? ` class="${html(options.className)}"` : ''} ${attributes}>${options.icon ? `<i data-lucide="${html(options.icon)}"></i>` : ''}<span>${html(options.label)}</span>${options.trailingIcon ? `<i${options.trailingIconClassName ? ` class="${html(options.trailingIconClassName)}"` : ''} data-lucide="${html(options.trailingIcon)}"></i>` : ''}</button>`;
}

export interface ActionMenuOptions {
	label: string;
	items: string;
	icon?: string;
	className?: string;
	popoverClassName?: string;
	leading?: string;
	toggleClassName?: string;
	toggleAttributes?: Record<string, MarkupAttributeValue>;
}

export function actionMenuMarkup(options: ActionMenuOptions): string {
	const className = ['action-menu', options.className ?? ''].filter(Boolean).join(' ');
	const popoverClassName = ['action-menu-popover', options.popoverClassName ?? ''].filter(Boolean).join(' ');
	const toggle = iconButtonMarkup({
		icon: options.icon ?? 'more-horizontal',
		label: options.label,
		className: options.toggleClassName,
		attributes: { 'data-menu-toggle': true, 'aria-expanded': false, ...options.toggleAttributes },
	});
	return `<div class="${html(className)}" data-action-menu>${options.leading ?? ''}${toggle}<div class="${html(popoverClassName)}" data-menu-popover role="menu">${options.items}</div></div>`;
}

export interface EmptyStateOptions {
	icon?: string;
	description?: string;
	compact?: boolean;
	className?: string;
}

export function emptyStateMarkup(message: string, options: EmptyStateOptions = {}): string {
	const className = ['empty-state', options.compact ? 'empty-state--compact' : '', options.className ?? '']
		.filter(Boolean)
		.join(' ');
	return `<div class="${html(className)}">${options.icon ? `<i data-lucide="${html(options.icon)}" aria-hidden="true"></i>` : ''}<span class="empty-state-message">${html(message)}</span>${options.description ? `<small>${html(options.description)}</small>` : ''}</div>`;
}

export function errorBannerMarkup(message: string): string {
	return `<div class="error-banner" role="alert">${html(message)}</div>`;
}
