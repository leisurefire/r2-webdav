export type ComponentCleanup = () => void;

const componentCleanups = new Map<HTMLElement, Set<ComponentCleanup>>();
let disconnectObserver: MutationObserver | null = null;

function stopObserverWhenIdle(): void {
	if (componentCleanups.size) return;
	disconnectObserver?.disconnect();
	disconnectObserver = null;
}

function disposeRoot(root: HTMLElement): void {
	const cleanups = componentCleanups.get(root);
	if (!cleanups) return;
	componentCleanups.delete(root);
	for (const cleanup of cleanups) {
		try {
			cleanup();
		} catch (error) {
			console.error('Component cleanup failed', error);
		}
	}
	stopObserverWhenIdle();
}

function ensureObserver(): void {
	if (disconnectObserver) return;
	disconnectObserver = new MutationObserver(() => {
		for (const root of componentCleanups.keys()) {
			if (!root.isConnected) disposeRoot(root);
		}
	});
	disconnectObserver.observe(document.body, { childList: true, subtree: true });
}

/** Register teardown work for a DOM component without allocating an observer per instance. */
export function onDisconnect(root: HTMLElement, cleanup: ComponentCleanup): ComponentCleanup {
	if (!root.isConnected) {
		cleanup();
		return () => {};
	}
	let cleanups = componentCleanups.get(root);
	if (!cleanups) {
		cleanups = new Set();
		componentCleanups.set(root, cleanups);
	}
	cleanups.add(cleanup);
	ensureObserver();
	return () => {
		const current = componentCleanups.get(root);
		if (!current?.delete(cleanup)) return;
		if (!current.size) componentCleanups.delete(root);
		stopObserverWhenIdle();
	};
}
