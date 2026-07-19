const TEXT_CLIPBOARD_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown'] as const;

export function normalizeClipboardText(value: string): string {
	return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

export function readClipboardText(getData: (type: string) => string): string {
	for (const type of TEXT_CLIPBOARD_TYPES) {
		const value = getData(type);
		if (value) return normalizeClipboardText(value);
	}
	return '';
}
