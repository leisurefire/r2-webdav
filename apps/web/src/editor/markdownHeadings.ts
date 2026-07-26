export interface MarkdownHeading {
	id: string;
	level: number;
	text: string;
}

export function slugifyMarkdownHeading(value: string): string {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, '-')
			.replace(/^-|-$/g, '') || 'section'
	);
}

export function createMarkdownHeading(text: string, level: number, usedIds: Set<string>): MarkdownHeading {
	const normalizedText = text.trim();
	const base = slugifyMarkdownHeading(normalizedText);
	let id = base;
	let suffix = 2;
	while (usedIds.has(id)) id = `${base}-${suffix++}`;
	usedIds.add(id);
	return { id, level, text: normalizedText || id };
}

/** Convert heading source to the visible label without running the full HTML renderer. */
export function markdownHeadingText(source: string, nodeName: string): string {
	let text = /^ATXHeading/.test(nodeName)
		? source.replace(/^\s{0,3}#{1,6}[\t ]+/, '').replace(/[\t ]+#+[\t ]*$/, '')
		: (source.split(/\r?\n/, 1)[0] ?? source);
	text = text
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, alias) => alias || target)
		.replace(/<[^>]+>/g, '')
		.replace(/[`*_~=]/g, '')
		.replace(/\\([\\`*_[\]{}()#+.!~-])/g, '$1');
	return text.trim();
}
