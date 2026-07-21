export interface MarkdownFormatEdit {
	from: number;
	to: number;
	insert: string;
	selectionFrom: number;
	selectionTo: number;
}

interface MarkdownFormatSpan {
	from: number;
	contentFrom: number;
	contentTo: number;
	to: number;
}

function markerSpans(doc: string, marker: string): MarkdownFormatSpan[] {
	const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const escapedUnit = marker[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const boundary = marker.length > 1 ? `(?!${escapedUnit})` : marker === '*' ? `(?!\\*)` : '';
	const leadingBoundary = marker.length > 1 || marker === '*' ? `(?<!${escapedUnit})` : '';
	const paired = new RegExp(
		`${leadingBoundary}${escapedMarker}${boundary}([^\\n]+?)${leadingBoundary}${escapedMarker}${boundary}`,
		'g',
	);
	const spans: MarkdownFormatSpan[] = [];
	let match: RegExpExecArray | null;
	while ((match = paired.exec(doc))) {
		spans.push({
			from: match.index,
			contentFrom: match.index + marker.length,
			contentTo: match.index + match[0].length - marker.length,
			to: match.index + match[0].length,
		});
	}
	return spans;
}

export function markdownMarkerCoverage(
	doc: string,
	from: number,
	to: number,
	marker: string,
): 'none' | 'partial' | 'full' {
	if (to <= from) return 'none';
	let covered = 0;
	for (const span of markerSpans(doc, marker)) {
		const start = Math.max(span.from, from);
		const end = Math.min(span.to, to);
		if (end > start) covered += end - start;
	}
	if (covered >= to - from) return 'full';
	return covered > 0 ? 'partial' : 'none';
}

/**
 * Plan a Markdown formatting toggle as a range transformation.
 * Existing spans that overlap or directly touch the selection are expanded/merged;
 * a selection wholly inside one span is removed from that span instead.
 */
export function markdownWrapEdit(doc: string, from: number, to: number, marker: string): MarkdownFormatEdit {
	from = Math.max(0, Math.min(from, doc.length));
	to = Math.max(from, Math.min(to, doc.length));
	const spans = markerSpans(doc, marker);
	const containing = spans.find((span) => from >= span.contentFrom && to <= span.contentTo);
	if (containing) {
		const before = doc.slice(containing.contentFrom, from);
		const selected = doc.slice(from, to);
		const after = doc.slice(to, containing.contentTo);
		const left = before ? `${marker}${before}${marker}` : '';
		const right = after ? `${marker}${after}${marker}` : '';
		return {
			from: containing.from,
			to: containing.to,
			insert: `${left}${selected}${right}`,
			selectionFrom: containing.from + left.length,
			selectionTo: containing.from + left.length + selected.length,
		};
	}

	const selected = doc.slice(from, to);
	if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
		const inner = selected.slice(marker.length, -marker.length);
		return { from, to, insert: inner, selectionFrom: from, selectionTo: from + inner.length };
	}

	const related = spans.filter((span) => {
		const overlaps = span.to > from && span.from < to;
		const touches = span.to === from || span.from === to;
		return (overlaps || touches) && !doc.slice(Math.min(span.to, to), Math.max(span.from, from)).includes('\n');
	});
	if (related.length) {
		const replaceFrom = Math.min(from, ...related.map((span) => span.from));
		const replaceTo = Math.max(to, ...related.map((span) => span.to));
		const markerRanges = related.flatMap((span) => [
			{ from: span.from, to: span.contentFrom },
			{ from: span.contentTo, to: span.to },
		]);
		let plain = '';
		let cursor = replaceFrom;
		for (const range of markerRanges.sort((a, b) => a.from - b.from)) {
			plain += doc.slice(cursor, range.from);
			cursor = range.to;
		}
		plain += doc.slice(cursor, replaceTo);
		return {
			from: replaceFrom,
			to: replaceTo,
			insert: `${marker}${plain}${marker}`,
			selectionFrom: replaceFrom + marker.length,
			selectionTo: replaceFrom + marker.length + plain.length,
		};
	}

	return {
		from,
		to,
		insert: `${marker}${selected}${marker}`,
		selectionFrom: from + marker.length,
		selectionTo: to + marker.length,
	};
}
