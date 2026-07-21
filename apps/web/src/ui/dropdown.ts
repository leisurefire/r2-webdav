import { Check, ChevronDown, createElement, type IconNode } from 'lucide';

export interface DropdownAction {
	id: string;
	label: string;
	icon: IconNode;
	danger?: boolean;
}

export interface CustomSelectOptions {
	className?: string;
	getActions?: (option: HTMLOptionElement) => DropdownAction[];
	onAction?: (action: DropdownAction, option: HTMLOptionElement) => void | Promise<void>;
}

export interface CustomSelectHandle {
	refresh: () => void;
	open: () => void;
	close: () => void;
	destroy: () => void;
}

let dropdownId = 0;

/** Enhance a native select while keeping it as the form and change-event value source. */
export function enhanceSelect(select: HTMLSelectElement, options: CustomSelectOptions = {}): CustomSelectHandle {
	const existing = (select as HTMLSelectElement & { __customSelect?: CustomSelectHandle }).__customSelect;
	if (existing) return existing;

	const id = `custom-select-${++dropdownId}`;
	const root = document.createElement('div');
	root.className = `custom-select ${options.className ?? ''}`.trim();
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'custom-select-trigger';
	button.setAttribute('aria-haspopup', 'listbox');
	button.setAttribute('aria-expanded', 'false');
	button.setAttribute('aria-controls', id);
	const valueNode = document.createElement('span');
	valueNode.className = 'custom-select-value';
	const chevron = createElement(ChevronDown);
	chevron.classList.add('custom-select-chevron');
	button.append(valueNode, chevron);

	const menu = document.createElement('div');
	menu.id = id;
	menu.className = 'ui-menu-popover custom-select-menu';
	menu.setAttribute('role', 'listbox');
	menu.setAttribute('aria-label', select.getAttribute('aria-label') ?? '');
	menu.setAttribute('popover', 'manual');
	document.body.append(menu);
	const supportsPopover = typeof menu.showPopover === 'function';
	if (!supportsPopover) menu.hidden = true;

	select.before(root);
	root.append(select, button);
	select.classList.add('custom-select-native');
	select.tabIndex = -1;
	let open = false;
	let typeahead = '';
	let typeaheadTimer = 0;

	const selectedOption = () => select.selectedOptions[0] ?? select.options[0];
	const place = () => {
		const rect = button.getBoundingClientRect();
		const width = Math.max(rect.width, 180);
		menu.style.width = `${Math.min(width, window.innerWidth - 16)}px`;
		menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
		const menuHeight = Math.min(menu.scrollHeight || 280, 320);
		const below = window.innerHeight - rect.bottom - 8;
		menu.style.top = below >= Math.min(menuHeight, 180) ? `${rect.bottom + 5}px` : 'auto';
		menu.style.bottom = below >= Math.min(menuHeight, 180) ? 'auto' : `${window.innerHeight - rect.top + 5}px`;
	};
	const close = () => {
		if (!open) return;
		open = false;
		if (supportsPopover) menu.hidePopover();
		else menu.hidden = true;
		button.setAttribute('aria-expanded', 'false');
		root.classList.remove('open');
	};
	const focusOption = (offset: number) => {
		const rows = [...menu.querySelectorAll<HTMLButtonElement>('.custom-select-option:not(:disabled)')];
		if (!rows.length) return;
		const active =
			document.activeElement instanceof HTMLElement ? rows.indexOf(document.activeElement as HTMLButtonElement) : -1;
		rows[(active + offset + rows.length) % rows.length].focus();
	};
	const choose = (value: string) => {
		if (select.value !== value) {
			select.value = value;
			select.dispatchEvent(new Event('input', { bubbles: true }));
			select.dispatchEvent(new Event('change', { bubbles: true }));
		}
		refresh();
		close();
		button.focus();
	};
	const refresh = () => {
		const current = selectedOption();
		valueNode.textContent = current?.label ?? '';
		button.disabled = select.disabled;
		button.title = select.title;
		button.setAttribute('aria-label', select.getAttribute('aria-label') ?? current?.label ?? '');
		menu.replaceChildren();
		for (const option of select.options) {
			const row = document.createElement('div');
			row.className = 'custom-select-row';
			const choice = document.createElement('button');
			choice.type = 'button';
			choice.className = 'custom-select-option';
			choice.setAttribute('role', 'option');
			choice.setAttribute('aria-selected', String(option.selected));
			choice.disabled = option.disabled;
			choice.dataset.value = option.value;
			const check = createElement(Check);
			check.classList.add('custom-select-check');
			const label = document.createElement('span');
			label.textContent = option.label;
			choice.append(check, label);
			choice.addEventListener('click', () => choose(option.value));
			row.append(choice);
			for (const action of options.getActions?.(option) ?? []) {
				const actionButton = document.createElement('button');
				actionButton.type = 'button';
				actionButton.className = `custom-select-action${action.danger ? ' danger' : ''}`;
				actionButton.title = action.label;
				actionButton.setAttribute('aria-label', action.label);
				actionButton.append(createElement(action.icon));
				actionButton.addEventListener('click', (event) => {
					event.stopPropagation();
					close();
					void options.onAction?.(action, option);
				});
				row.append(actionButton);
			}
			menu.append(row);
		}
	};
	const show = () => {
		if (open || select.disabled) return;
		refresh();
		open = true;
		if (supportsPopover) menu.showPopover();
		else menu.hidden = false;
		button.setAttribute('aria-expanded', 'true');
		root.classList.add('open');
		place();
		requestAnimationFrame(() => {
			const selected = menu.querySelector<HTMLButtonElement>('.custom-select-option[aria-selected="true"]');
			(selected ?? menu.querySelector<HTMLButtonElement>('.custom-select-option:not(:disabled)'))?.focus();
		});
	};

	button.addEventListener('click', () => (open ? close() : show()));
	button.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			show();
		}
	});
	menu.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
			button.focus();
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			focusOption(event.key === 'ArrowDown' ? 1 : -1);
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			const rows = menu.querySelectorAll<HTMLButtonElement>('.custom-select-option:not(:disabled)');
			rows[event.key === 'Home' ? 0 : rows.length - 1]?.focus();
		} else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
			typeahead += event.key.toLocaleLowerCase();
			window.clearTimeout(typeaheadTimer);
			typeaheadTimer = window.setTimeout(() => (typeahead = ''), 500);
			const match = [...menu.querySelectorAll<HTMLButtonElement>('.custom-select-option')].find((item) =>
				item.textContent?.trim().toLocaleLowerCase().startsWith(typeahead),
			);
			match?.focus();
		}
	});
	select.addEventListener('change', refresh);
	select.addEventListener('focus', () => button.focus());
	const onDocumentPointer = (event: Event) => {
		const target = event.target as Node | null;
		if (target && !root.contains(target) && !menu.contains(target)) close();
	};
	const onViewportChange = () => (open ? place() : undefined);
	document.addEventListener('pointerdown', onDocumentPointer, true);
	window.addEventListener('resize', onViewportChange);
	window.addEventListener('scroll', onViewportChange, true);
	const observer = new MutationObserver(() => {
		if (root.isConnected) return;
		handle.destroy();
	});
	observer.observe(document.body, { childList: true, subtree: true });

	const handle: CustomSelectHandle = {
		refresh,
		open: show,
		close,
		destroy: () => {
			observer.disconnect();
			document.removeEventListener('pointerdown', onDocumentPointer, true);
			window.removeEventListener('resize', onViewportChange);
			window.removeEventListener('scroll', onViewportChange, true);
			window.clearTimeout(typeaheadTimer);
			menu.remove();
			delete (select as HTMLSelectElement & { __customSelect?: CustomSelectHandle }).__customSelect;
		},
	};
	(select as HTMLSelectElement & { __customSelect?: CustomSelectHandle }).__customSelect = handle;
	refresh();
	return handle;
}
