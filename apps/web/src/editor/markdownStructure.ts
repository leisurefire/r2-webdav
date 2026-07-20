export type StructuralBlock = {
	from: number;
	to: number;
	kind: 'fence' | 'math' | 'details' | 'table' | 'quote' | 'frontmatter';
};

export type FrontmatterEntry = { key: string; value: string };

export type FrontmatterBlock = {
	from: number;
	to: number;
	entries: FrontmatterEntry[];
};

export function parseFrontmatterBlock(text: string): FrontmatterBlock | null {
	const lineBreak = /\r\n|\r|\n/g;
	const openingBreak = lineBreak.exec(text);
	if (
		!openingBreak ||
		text
			.slice(0, openingBreak.index)
			.replace(/^\uFEFF/, '')
			.trim() !== '---'
	)
		return null;
	const contentFrom = openingBreak.index + openingBreak[0].length;
	let lineFrom = contentFrom;
	let closingFrom = -1;
	let closingTo = -1;
	while (lineFrom <= text.length) {
		lineBreak.lastIndex = lineFrom;
		const nextBreak = lineBreak.exec(text);
		const lineTo = nextBreak?.index ?? text.length;
		if (/^(?:---|\.\.\.)\s*$/.test(text.slice(lineFrom, lineTo))) {
			closingFrom = lineFrom;
			closingTo = lineTo;
			break;
		}
		if (!nextBreak) break;
		lineFrom = lineTo + nextBreak[0].length;
	}
	if (closingFrom < 0) return null;

	const entries: FrontmatterEntry[] = [];
	const content = text.slice(contentFrom, closingFrom).replace(/(?:\r\n|\r|\n)$/, '');
	for (const line of content.split(/\r\n|\r|\n/)) {
		const property = /^([\p{L}\p{N}_-]+)\s*:\s*(.*)$/u.exec(line);
		if (property) {
			entries.push({ key: property[1], value: property[2].trim() });
			continue;
		}
		if (/^\s+(?:\S.*)?$/.test(line) && entries.length > 0) {
			const continuation = line.trim();
			if (continuation)
				entries[entries.length - 1].value = [entries[entries.length - 1].value, continuation]
					.filter(Boolean)
					.join('\n');
		}
	}

	return { from: 0, to: closingTo, entries };
}

function hasUnescapedPipe(line: string): boolean {
	let escaped = false;
	for (const char of line) {
		if (char === '|' && !escaped) return true;
		if (char === '\\' && !escaped) escaped = true;
		else escaped = false;
	}
	return false;
}

function isTableLine(line: string): boolean {
	return hasUnescapedPipe(line) && line.trim().length > 2;
}

function isTableSeparator(line: string): boolean {
	return parseTableSeparator(line) !== null;
}

function parseTableSeparator(line: string): TableAlignment[] | null {
	const cells = splitTableRow(line);
	if (cells.length === 0 || !cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))) return null;
	return cells.map((cell) => {
		const value = cell.trim();
		if (value.startsWith(':') && value.endsWith(':')) return 'center';
		if (value.startsWith(':')) return 'left';
		if (value.endsWith(':')) return 'right';
		return null;
	});
}

export function collectStructuralBlocks(text: string): StructuralBlock[] {
	const blocks: StructuralBlock[] = [];
	const frontmatter = parseFrontmatterBlock(text);
	if (frontmatter) blocks.push({ from: frontmatter.from, to: frontmatter.to, kind: 'frontmatter' });
	let offset = frontmatter ? frontmatter.to + (text[frontmatter.to] === '\n' ? 1 : 0) : 0;
	let fence: { from: number; marker: '`' | '~'; length: number } | null = null;
	let math: number | null = null;
	let details: { from: number; depth: number } | null = null;
	let table: { from: number; to: number } | null = null;

	const lines = text.split('\n');
	const firstLine = frontmatter ? text.slice(0, frontmatter.to).split('\n').length : 0;
	for (let lineIndex = firstLine; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex];
		const trimmed = line.trim();
		const openingFence = /^ {0,3}(`{3,}|~{3,})(?:[^`~]*)$/.exec(line);
		const closingFence = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);

		if (fence) {
			if (closingFence && closingFence[1][0] === fence.marker && closingFence[1].length >= fence.length) {
				blocks.push({ from: fence.from, to: offset + line.length, kind: 'fence' });
				fence = null;
			}
			offset += line.length + 1;
			continue;
		}
		if (openingFence) {
			if (table !== null) blocks.push({ ...table, kind: 'table' });
			table = null;
			fence = { from: offset, marker: openingFence[1][0] as '`' | '~', length: openingFence[1].length };
			offset += line.length + 1;
			continue;
		}

		if (math !== null) {
			if (/^\s*\$\$\s*$/.test(line)) {
				blocks.push({ from: math, to: offset + line.length, kind: 'math' });
				math = null;
			}
			offset += line.length + 1;
			continue;
		}
		if (details !== null) {
			if (/^\s*<details\b/i.test(trimmed)) details.depth += 1;
			else if (/^\s*<\/details>\s*$/i.test(trimmed)) {
				details.depth -= 1;
				if (details.depth === 0) {
					blocks.push({ from: details.from, to: offset + line.length, kind: 'details' });
					details = null;
				}
			}
			offset += line.length + 1;
			continue;
		}
		if (/^\s*<details\b/i.test(trimmed)) {
			if (table !== null) blocks.push({ ...table, kind: 'table' });
			table = null;
			details = { from: offset, depth: 1 };
			offset += line.length + 1;
			continue;
		}

		if (/^\s*\$\$\s*$/.test(line)) {
			if (table !== null) blocks.push({ ...table, kind: 'table' });
			table = null;
			math = offset;
		} else if (/^\s*\$\$[^$\n]+\$\$\s*$/.test(line)) {
			if (table !== null) blocks.push({ ...table, kind: 'table' });
			table = null;
			blocks.push({ from: offset, to: offset + line.length, kind: 'math' });
		}

		if (table !== null && !isTableLine(line)) {
			blocks.push({ ...table, kind: 'table' });
			table = null;
		}
		if (
			table === null &&
			isTableLine(line) &&
			isTableSeparator(lines[lineIndex + 1] ?? '') &&
			splitTableRow(line).length === splitTableRow(lines[lineIndex + 1] ?? '').length
		)
			table = { from: offset, to: offset + line.length };
		else if (table !== null && isTableLine(line)) table.to = offset + line.length;
		offset += line.length + 1;
	}

	if (table !== null) blocks.push({ ...table, kind: 'table' });
	return blocks.sort((left, right) => left.from - right.from);
}

export type InlineRange = { from: number; to: number; kind: 'code' | 'math' };

export type ObsidianInlineRange = { from: number; to: number; kind: 'highlight' | 'comment' };

export type WikiLinkRange = {
	from: number;
	to: number;
	kind: 'wikilink' | 'embed';
	target: string;
	alias?: string;
};

export type TableAlignment = 'left' | 'center' | 'right' | null;

export type ParsedTable = {
	rows: string[][];
	separatorIndex: number;
	alignments: TableAlignment[];
};

export type MarkdownListPrefix = {
	indent: string;
	marker: string;
	task?: ' ' | 'x' | 'X';
	content: string;
	prefixLength: number;
};

export type MarkdownLineContinuation = {
	insert: string;
	replaceFrom: number;
	replaceTo: number;
	cursor: number;
};

/** Parse a bullet, ordered, or task list prefix for Obsidian-style list editing. */
export function parseMarkdownListPrefix(line: string): MarkdownListPrefix | null {
	const match = /^(\s*)([-+*]|\d+[.)])(\s+)(?:\[([ xX])\](\s*))?(.*)$/.exec(line);
	if (!match) return null;
	return {
		indent: match[1],
		marker: match[2],
		...(match[4] ? { task: match[4] as ' ' | 'x' | 'X' } : {}),
		content: match[6],
		prefixLength: match[0].length - match[6].length,
	};
}

export function nextOrderedListMarker(marker: string): string {
	const match = /^(\d+)([.)])$/.exec(marker);
	if (!match) return marker;
	return `${Number(match[1]) + 1}${match[2]}`;
}

function formatListPrefix(indent: string, marker: string, task?: ' ' | 'x' | 'X'): string {
	const taskPart = task === undefined ? '' : `[${task === 'x' || task === 'X' ? 'x' : ' '}] `;
	return `${indent}${marker} ${taskPart}`;
}

/**
 * Continue a list or blockquote on Enter the way Obsidian Live Preview does:
 * split content, increment ordered markers, and exit empty items.
 */
export function continueMarkdownStructuredLine(
	line: string,
	cursorInLine: number,
): MarkdownLineContinuation | null {
	const quoteMatch = /^(?:>\s?)+/.exec(line);
	const quotePrefix = quoteMatch?.[0] ?? '';
	const body = line.slice(quotePrefix.length);
	const list = parseMarkdownListPrefix(body);
	if (!list && !quotePrefix) return null;

	if (!list) {
		const content = body;
		const offset = Math.max(quotePrefix.length, Math.min(cursorInLine, line.length));
		const before = line.slice(quotePrefix.length, offset);
		const after = line.slice(offset);
		if (!content.trim()) {
			return { insert: '', replaceFrom: 0, replaceTo: line.length, cursor: 0 };
		}
		const next = `${quotePrefix}${before}\n${quotePrefix}${after}`;
		return {
			insert: next,
			replaceFrom: 0,
			replaceTo: line.length,
			cursor: quotePrefix.length + before.length + 1 + quotePrefix.length,
		};
	}

	const absolutePrefixLength = quotePrefix.length + list.prefixLength;
	const offset = Math.max(absolutePrefixLength, Math.min(cursorInLine, line.length));
	const before = line.slice(absolutePrefixLength, offset);
	const after = line.slice(offset);
	const originalPrefix = line.slice(0, absolutePrefixLength);
	if (!list.content.trim()) {
		if (list.indent.length >= 2) {
			const nextIndent = list.indent.slice(0, Math.max(0, list.indent.length - 2));
			const nextBody = formatListPrefix(nextIndent, list.marker, list.task === undefined ? undefined : ' ');
			const next = `${quotePrefix}${nextBody}`;
			return { insert: next, replaceFrom: 0, replaceTo: line.length, cursor: next.length };
		}
		if (quotePrefix) {
			const next = quotePrefix;
			return { insert: next, replaceFrom: 0, replaceTo: line.length, cursor: next.length };
		}
		return { insert: '', replaceFrom: 0, replaceTo: line.length, cursor: 0 };
	}

	const nextMarker = /^\d+[.)]$/.test(list.marker) ? nextOrderedListMarker(list.marker) : list.marker;
	const nextBodyPrefix = formatListPrefix(list.indent, nextMarker, list.task === undefined ? undefined : ' ');
	const nextPrefix = `${quotePrefix}${nextBodyPrefix}`;
	const next = `${originalPrefix}${before}\n${nextPrefix}${after}`;
	return {
		insert: next,
		replaceFrom: 0,
		replaceTo: line.length,
		cursor: originalPrefix.length + before.length + 1 + nextPrefix.length,
	};
}

export function indentMarkdownListLine(line: string, direction: 'indent' | 'outdent'): string | null {
	const quoteMatch = /^(?:>\s?)+/.exec(line);
	const quotePrefix = quoteMatch?.[0] ?? '';
	const body = line.slice(quotePrefix.length);
	const list = parseMarkdownListPrefix(body);
	if (!list) return null;
	if (direction === 'indent') return `${quotePrefix}  ${body}`;
	if (!list.indent) return null;
	const remove = list.indent.startsWith('\t') ? 1 : Math.min(2, list.indent.length);
	return `${quotePrefix}${body.slice(remove)}`;
}

export function collectInlineExcludedRanges(line: string): InlineRange[] {
	const ranges: InlineRange[] = [];
	let index = 0;
	while (index < line.length) {
		if (line[index] === '\\') {
			index += 2;
			continue;
		}
		if (line[index] === '`') {
			const run = line.slice(index).match(/^(`+)([\s\S]*?)\1/);
			if (run) {
				ranges.push({ from: index, to: index + run[0].length, kind: 'code' });
				index += run[0].length;
				continue;
			}
		}
		if (line[index] === '$' && line[index + 1] !== '$' && !/\s/.test(line[index + 1] ?? '')) {
			let end = index + 1;
			while (end < line.length) {
				if (line[end] === '\\') {
					end += 2;
					continue;
				}
				if (
					line[end] === '$' &&
					line[end + 1] !== '$' &&
					!(/\s/.test(line[end - 1] ?? '') || /\d/.test(line[end + 1] ?? ''))
				)
					break;
				end += 1;
			}
			if (end > index + 1 && end < line.length) {
				ranges.push({ from: index, to: end + 1, kind: 'math' });
				index = end + 1;
				continue;
			}
		}
		index += 1;
	}
	return ranges;
}

function closingDelimiter(line: string, delimiter: string, from: number): number {
	let index = from;
	while (index < line.length) {
		if (line[index] === '\\') {
			index += 2;
			continue;
		}
		if (line.startsWith(delimiter, index)) return index;
		index += 1;
	}
	return -1;
}

export function collectObsidianInlineRanges(line: string): ObsidianInlineRange[] {
	const excluded = collectInlineExcludedRanges(line);
	const ranges: ObsidianInlineRange[] = [];
	let index = 0;
	while (index < line.length) {
		const excludedRange = excluded.find((range) => index >= range.from && index < range.to);
		if (excludedRange) {
			index = excludedRange.to;
			continue;
		}
		if (line[index] === '\\') {
			index += 2;
			continue;
		}
		const delimiter = line.startsWith('%%', index) ? '%%' : line.startsWith('==', index) ? '==' : null;
		if (!delimiter) {
			index += 1;
			continue;
		}
		const end = closingDelimiter(line, delimiter, index + delimiter.length);
		const content = end < 0 ? '' : line.slice(index + delimiter.length, end);
		const valid =
			end >= 0 &&
			content.length > 0 &&
			(delimiter === '%%' || (!/^\s|\s$/.test(content) && !line.startsWith('=', end + delimiter.length)));
		if (!valid) {
			index += delimiter.length;
			continue;
		}
		ranges.push({ from: index, to: end + delimiter.length, kind: delimiter === '%%' ? 'comment' : 'highlight' });
		index = end + delimiter.length;
	}
	return ranges;
}

/** Collect Obsidian-style wiki links and embeds outside code/math spans. */
export function collectWikiLinkRanges(line: string): WikiLinkRange[] {
	const excluded = collectInlineExcludedRanges(line);
	const ranges: WikiLinkRange[] = [];
	let index = 0;
	while (index < line.length) {
		const excludedRange = excluded.find((range) => index >= range.from && index < range.to);
		if (excludedRange) {
			index = excludedRange.to;
			continue;
		}
		if (line[index] === '\\') {
			index += 2;
			continue;
		}
		const embed = line.startsWith('![[', index);
		if (!embed && !line.startsWith('[[', index)) {
			index += 1;
			continue;
		}
		const contentFrom = index + (embed ? 3 : 2);
		const end = line.indexOf(']]', contentFrom);
		if (end < 0) {
			index += embed ? 3 : 2;
			continue;
		}
		const raw = line.slice(contentFrom, end);
		if (!raw || /[\r\n]/.test(raw)) {
			index += embed ? 3 : 2;
			continue;
		}
		const pipe = raw.indexOf('|');
		const target = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
		const alias = pipe >= 0 ? raw.slice(pipe + 1).trim() : '';
		if (!target) {
			index = end + 2;
			continue;
		}
		ranges.push({
			from: index,
			to: end + 2,
			kind: embed ? 'embed' : 'wikilink',
			target,
			...(alias ? { alias } : {}),
		});
		index = end + 2;
	}
	return ranges;
}

export function splitTableRow(line: string): string[] {
	const value = line.trim().replace(/^\||\|$/g, '');
	const cells: string[] = [];
	let cell = '';
	let escaped = false;
	let codeTicks = 0;
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (char === '`' && !escaped) {
			const ticks = value.slice(index).match(/^`+/)![0];
			if (codeTicks === 0) codeTicks = ticks.length;
			else if (codeTicks === ticks.length) codeTicks = 0;
			cell += ticks;
			index += ticks.length - 1;
			continue;
		}
		if (char === '|' && !escaped && codeTicks === 0) {
			cells.push(cell.trim());
			cell = '';
			continue;
		}
		if (escaped) {
			if (char !== '|') cell += '\\';
			cell += char;
			escaped = false;
			continue;
		}
		if (char === '\\') escaped = true;
		else cell += char;
	}
	if (escaped) cell += '\\';
	cells.push(cell.trim());
	return cells;
}

export type TableCellSourceRange = { from: number; to: number };

/** Return the source ranges of the visible cell values in one table row. */
export function tableCellSourceRanges(line: string): TableCellSourceRange[] {
	const trimmedStart = line.search(/\S|$/);
	const trimmedEnd = line.trimEnd().length;
	let contentFrom = trimmedStart;
	let contentTo = trimmedEnd;
	if (line[contentFrom] === '|') contentFrom += 1;
	if (contentTo > contentFrom && line[contentTo - 1] === '|') contentTo -= 1;
	const ranges: TableCellSourceRange[] = [];
	let cellFrom = contentFrom;
	let escaped = false;
	let codeTicks = 0;
	for (let index = contentFrom; index < contentTo; index += 1) {
		const char = line[index];
		if (char === '`' && !escaped) {
			const ticks = line.slice(index).match(/^`+/)![0];
			if (codeTicks === 0) codeTicks = ticks.length;
			else if (codeTicks === ticks.length) codeTicks = 0;
			index += ticks.length - 1;
			continue;
		}
		if (char === '|' && !escaped && codeTicks === 0) {
			let from = cellFrom;
			let to = index;
			while (from < to && /\s/.test(line[from])) from += 1;
			while (to > from && /\s/.test(line[to - 1])) to -= 1;
			ranges.push({ from, to });
			cellFrom = index + 1;
			escaped = false;
			continue;
		}
		if (escaped) escaped = false;
		else if (char === '\\') escaped = true;
	}
	let from = cellFrom;
	let to = contentTo;
	while (from < to && /\s/.test(line[from])) from += 1;
	while (to > from && /\s/.test(line[to - 1])) to -= 1;
	ranges.push({ from, to });
	return ranges;
}

export function parseTableBlock(source: string): ParsedTable | null {
	const lines = source.trimEnd().split('\n');
	if (lines.length < 2) return null;
	const rows = lines.map(splitTableRow);
	const alignments = parseTableSeparator(lines[1]);
	if (!alignments || rows[0].length !== alignments.length) return null;
	return {
		rows: rows.map((row) => Array.from({ length: alignments.length }, (_, index) => row[index] ?? '')),
		separatorIndex: 1,
		alignments,
	};
}

export function serializeTableRows(rows: string[][]): string {
	return rows
		.map((row) => `| ${row.map((cell) => escapeTableCell(cell.replaceAll('\n', ' '))).join(' | ')} |`)
		.join('\n');
}

function escapeTableCell(value: string): string {
	let result = '';
	let backslashes = 0;
	for (const char of value) {
		if (char === '\\') {
			backslashes += 1;
			result += char;
			continue;
		}
		if (char === '|' && backslashes % 2 === 0) result += '\\';
		result += char;
		backslashes = 0;
	}
	return result;
}

