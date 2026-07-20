/** Minimal text diff for AI review previews (character-level, Myers O(ND)). */

export type DiffOp = { type: 'equal' | 'delete' | 'insert'; text: string };

function commonPrefixLength(a: string, b: string): number {
	const limit = Math.min(a.length, b.length);
	let index = 0;
	while (index < limit && a.charCodeAt(index) === b.charCodeAt(index)) index += 1;
	return index;
}

function commonSuffixLength(a: string, b: string, aFrom = 0, bFrom = 0): number {
	const aLen = a.length - aFrom;
	const bLen = b.length - bFrom;
	const limit = Math.min(aLen, bLen);
	let index = 0;
	while (
		index < limit &&
		a.charCodeAt(a.length - 1 - index) === b.charCodeAt(b.length - 1 - index)
	)
		index += 1;
	return index;
}

/** Myers diff on two slices; returns ops covering only the slices (no surrounding equals). */
function myers(a: string, b: string): DiffOp[] {
	const n = a.length;
	const m = b.length;
	if (n === 0 && m === 0) return [];
	if (n === 0) return [{ type: 'insert', text: b }];
	if (m === 0) return [{ type: 'delete', text: a }];

	const max = n + m;
	const offset = max;
	const v = new Int32Array(2 * max + 1);
	v.fill(-1);
	v[offset + 1] = 0;
	const trace: Int32Array[] = [];

	for (let d = 0; d <= max; d += 1) {
		const snapshot = new Int32Array(v);
		trace.push(snapshot);
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
			else x = v[offset + k - 1] + 1;
			let y = x - k;
			while (x < n && y < m && a.charCodeAt(x) === b.charCodeAt(y)) {
				x += 1;
				y += 1;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				// Reconstruct path
				const ops: DiffOp[] = [];
				let rx = n;
				let ry = m;
				for (let depth = d; depth > 0; depth -= 1) {
					const prev = trace[depth];
					const kk = rx - ry;
					let prevK: number;
					if (kk === -depth || (kk !== depth && prev[offset + kk - 1] < prev[offset + kk + 1]))
						prevK = kk + 1;
					else prevK = kk - 1;
					const prevX = prev[offset + prevK];
					const prevY = prevX - prevK;
					while (rx > prevX && ry > prevY) {
						ops.push({ type: 'equal', text: a[rx - 1]! });
						rx -= 1;
						ry -= 1;
					}
					if (depth === 0) break;
					if (rx === prevX) {
						ops.push({ type: 'insert', text: b[ry - 1]! });
						ry -= 1;
					} else {
						ops.push({ type: 'delete', text: a[rx - 1]! });
						rx -= 1;
					}
				}
				while (rx > 0 && ry > 0) {
					ops.push({ type: 'equal', text: a[rx - 1]! });
					rx -= 1;
					ry -= 1;
				}
				while (rx > 0) {
					ops.push({ type: 'delete', text: a[rx - 1]! });
					rx -= 1;
				}
				while (ry > 0) {
					ops.push({ type: 'insert', text: b[ry - 1]! });
					ry -= 1;
				}
				ops.reverse();
				return mergeOps(ops);
			}
		}
	}
	return [
		{ type: 'delete', text: a },
		{ type: 'insert', text: b },
	];
}

function mergeOps(ops: DiffOp[]): DiffOp[] {
	const merged: DiffOp[] = [];
	for (const op of ops) {
		if (!op.text) continue;
		const last = merged[merged.length - 1];
		if (last && last.type === op.type) last.text += op.text;
		else merged.push({ type: op.type, text: op.text });
	}
	return merged;
}

/**
 * Character-level diff. Falls back to a cheap whole-replace when inputs are huge,
 * so the AI panel never freezes the editor on multi-thousand-character selections.
 */
export function diffText(before: string, after: string): DiffOp[] {
	if (before === after) return before ? [{ type: 'equal', text: before }] : [];
	const prefix = commonPrefixLength(before, after);
	const suffix = commonSuffixLength(before, after, prefix, prefix);
	const aMid = before.slice(prefix, before.length - suffix);
	const bMid = after.slice(prefix, after.length - suffix);
	const ops: DiffOp[] = [];
	if (prefix) ops.push({ type: 'equal', text: before.slice(0, prefix) });
	if (aMid.length * bMid.length > 1_500_000) {
		if (aMid) ops.push({ type: 'delete', text: aMid });
		if (bMid) ops.push({ type: 'insert', text: bMid });
	} else {
		ops.push(...myers(aMid, bMid));
	}
	if (suffix) ops.push({ type: 'equal', text: before.slice(before.length - suffix) });
	return mergeOps(ops);
}

export interface AiReviewPreview {
	/** Combined preview source that contains deleted and inserted text inline. */
	text: string;
	/** Ranges relative to `text`. */
	segments: Array<{ from: number; to: number; kind: 'deleted' | 'inserted' }>;
}

/** Build an inline review document from original + generated Markdown. */
export function buildAiReviewPreview(original: string, generated: string): AiReviewPreview {
	const ops = diffText(original, generated);
	let text = '';
	const segments: AiReviewPreview['segments'] = [];
	for (const op of ops) {
		if (op.type === 'equal') {
			text += op.text;
			continue;
		}
		const from = text.length;
		text += op.text;
		segments.push({ from, to: text.length, kind: op.type === 'delete' ? 'deleted' : 'inserted' });
	}
	return { text, segments };
}
