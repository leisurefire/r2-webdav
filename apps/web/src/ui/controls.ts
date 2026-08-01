interface BusyControlState {
	depth: number;
	disabled: boolean;
}

const busyControlStates = new WeakMap<HTMLButtonElement, BusyControlState>();

export function setControlsBusy(controls: Iterable<HTMLButtonElement>, busy: boolean): void {
	for (const control of controls) {
		const current = busyControlStates.get(control);
		if (busy) {
			if (current) current.depth += 1;
			else busyControlStates.set(control, { depth: 1, disabled: control.disabled });
			control.disabled = true;
			control.classList.add('is-syncing');
			control.setAttribute('aria-busy', 'true');
			continue;
		}
		if (!current) continue;
		current.depth -= 1;
		if (current.depth > 0) continue;
		control.disabled = current.disabled;
		control.classList.remove('is-syncing');
		control.removeAttribute('aria-busy');
		busyControlStates.delete(control);
	}
}

export async function withControlsBusy<T>(
	controls: Iterable<HTMLButtonElement>,
	operation: () => Promise<T>,
): Promise<T> {
	const list = [...controls];
	setControlsBusy(list, true);
	try {
		return await operation();
	} finally {
		setControlsBusy(list, false);
	}
}
