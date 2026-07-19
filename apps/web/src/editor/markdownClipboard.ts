const TEXT_CLIPBOARD_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown'] as const;

export function normalizeClipboardText(value: string): string {
	return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function normalizeDisplayMathDelimiters(value: string): string {
	let fence: { marker: '`' | '~'; length: number } | null = null;
	return value
		.split('\n')
		.map((line) => {
			const openingFence = /^ {0,3}(`{3,}|~{3,})(?:[^`~]*)$/.exec(line);
			const closingFence = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
			if (fence) {
				if (closingFence && closingFence[1][0] === fence.marker && closingFence[1].length >= fence.length) fence = null;
				return line;
			}
			if (openingFence) {
				fence = { marker: openingFence[1][0] as '`' | '~', length: openingFence[1].length };
				return line;
			}
			return /^\s*\\\[\s*$/.test(line) || /^\s*\\\]\s*$/.test(line) ? line.replace(/\\[\[\]]/, () => '$$') : line;
		})
		.join('\n');
}

export function prepareClipboardText(value: string, before = '', after = ''): string {
	let text = normalizeDisplayMathDelimiters(normalizeClipboardText(value));
	const lines = text.split('\n');
	const startsWithDisplayMath = /^\s*\$\$\s*$/.test(lines[0] ?? '');
	const endsWithDisplayMath = /^\s*\$\$\s*$/.test(lines.at(-1) ?? '');
	if (startsWithDisplayMath && before && before !== '\n') text = `\n${text}`;
	if (endsWithDisplayMath && after !== '\n') text = `${text}\n`;
	return text;
}

export function readClipboardText(getData: (type: string) => string): string {
	for (const type of TEXT_CLIPBOARD_TYPES) {
		const value = getData(type);
		if (value) return prepareClipboardText(value);
	}
	return '';
}
