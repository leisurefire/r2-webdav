import { afterEach, describe, expect, it, vi } from 'vitest';
import { onDisconnect } from './lifecycle';

describe('onDisconnect', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('shares the observer and runs teardown once when a component leaves the DOM', () => {
		let notify: (() => void) | undefined;
		const disconnect = vi.fn();
		class Observer {
			constructor(callback: () => void) {
				notify = callback;
			}
			observe(): void {}
			disconnect = disconnect;
		}
		vi.stubGlobal('MutationObserver', Observer);
		vi.stubGlobal('document', { body: {} });
		const root = { isConnected: true } as HTMLElement;
		const cleanup = vi.fn();

		onDisconnect(root, cleanup);
		root.isConnected = false;
		notify?.();
		notify?.();

		expect(cleanup).toHaveBeenCalledOnce();
		expect(disconnect).toHaveBeenCalledOnce();
	});
});
