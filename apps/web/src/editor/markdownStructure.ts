export type StructuralBlock = { from: number; to: number; kind: 'fence' | 'math' | 'details' | 'table' };

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
	let offset = 0;
	let fence: { from: number; marker: '`' | '~'; length: number } | null = null;
	let math: number | null = null;
	let details: { from: number; depth: number } | null = null;
	let table: { from: number; to: number } | null = null;

	const lines = text.split('\n');
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
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

export type TableAlignment = 'left' | 'center' | 'right' | null;

export type ParsedTable = {
	rows: string[][];
	separatorIndex: number;
	alignments: TableAlignment[];
};

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
