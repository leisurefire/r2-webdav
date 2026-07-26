import { EditorSelection, type EditorState, type SelectionRange } from '@codemirror/state';
import { EditorView, type MouseSelectionStyle, type ViewUpdate } from '@codemirror/view';

export type ScreenRect = { left: number; right: number; top: number; bottom: number };

function clampUnit(value: number): number {
	return Math.max(0, Math.min(value, 1));
}

/** Map a visible text boundary back to its matching boundary in Markdown source. */
export function visibleSourcePosition(source: string, visible: string, visibleOffset: number): number {
	const target = Math.max(0, Math.min(visibleOffset, visible.length));
	let sourceOffset = 0;
	for (let visibleIndex = 0; visibleIndex < visible.length; visibleIndex += 1) {
		const char = visible[visibleIndex];
		let match = -1;
		if (/\s/.test(char)) {
			for (let index = sourceOffset; index < source.length; index += 1) {
				if (/\s/.test(source[index])) {
					match = index;
					break;
				}
			}
		} else match = source.indexOf(char, sourceOffset);
		if (match < 0) return Math.round((target / Math.max(1, visible.length)) * source.length);
		if (visibleIndex === target) return match;
		sourceOffset = match + 1;
		if (visibleIndex + 1 === target) return sourceOffset;
	}
	return sourceOffset;
}

/** Map a pointer to the source line and column represented by a rendered rectangle. */
export function geometricSourcePosition(source: string, x: number, y: number, rect: ScreenRect): number {
	const lines = source.split('\n');
	const xRatio = clampUnit((x - rect.left) / Math.max(1, rect.right - rect.left));
	const yRatio = clampUnit((y - rect.top) / Math.max(1, rect.bottom - rect.top));
	const lineIndex = Math.min(lines.length - 1, Math.floor(yRatio * lines.length));
	let offset = 0;
	for (let index = 0; index < lineIndex; index += 1) offset += lines[index].length + 1;
	return offset + Math.round(xRatio * lines[lineIndex].length);
}

function hasInteractiveTarget(target: EventTarget | null): boolean {
	return target instanceof Element && !!target.closest('a,button,input,textarea,select,summary');
}

type DOMCaret = { offsetNode: Node; offset: number };

function domCaretAtPoint(x: number, y: number): DOMCaret | null {
	const caretDocument = document as Document & {
		caretPositionFromPoint?: (clientX: number, clientY: number) => { offsetNode: Node; offset: number } | null;
		caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
	};
	const caret = caretDocument.caretPositionFromPoint?.(x, y);
	if (caret) return caret;
	const range = caretDocument.caretRangeFromPoint?.(x, y);
	return range ? { offsetNode: range.startContainer, offset: range.startOffset } : null;
}

function textOffsetAtPoint(node: HTMLElement, x: number, y: number): number | null {
	const caret = domCaretAtPoint(x, y);
	if (!caret || (caret.offsetNode !== node && !node.contains(caret.offsetNode))) return null;
	try {
		const prefix = document.createRange();
		prefix.selectNodeContents(node);
		prefix.setEnd(caret.offsetNode, caret.offset);
		return prefix.toString().length;
	} catch {
		return null;
	}
}

type SourcePointerMode = 'text' | 'geometry';

function sourcePositionAtPointer(
	node: HTMLElement,
	from: number,
	source: string,
	x: number,
	y: number,
	mode: SourcePointerMode,
): number {
	let position: number;
	if (mode === 'text') {
		const visible = node.textContent ?? '';
		const visibleOffset = textOffsetAtPoint(node, x, y);
		if (visible && visibleOffset !== null) position = from + visibleSourcePosition(source, visible, visibleOffset);
		else position = from + geometricSourcePosition(source, x, y, node.getBoundingClientRect());
	} else {
		position = from + geometricSourcePosition(source, x, y, node.getBoundingClientRect());
	}
	return Math.max(from, Math.min(from + source.length, position));
}

function clampToSourceInterior(from: number, source: string, position: number): number {
	if (source.length < 2) return from;
	return Math.max(from + 1, Math.min(from + source.length - 1, position));
}

type PointerPosition = { pos: number; assoc: -1 | 1 };

function pointerSourceTarget(event: MouseEvent): HTMLElement | null {
	return event.target instanceof Element ? event.target.closest<HTMLElement>('.cm-live-source-target') : null;
}

function pointerPosition(view: EditorView, event: MouseEvent): PointerPosition {
	const sourceTarget = pointerSourceTarget(event);
	if (sourceTarget) {
		const from = Number(sourceTarget.dataset.sourceFrom);
		const to = Number(sourceTarget.dataset.sourceTo);
		if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
			const source = view.state.sliceDoc(from, to);
			const mode: SourcePointerMode = sourceTarget.dataset.sourceMode === 'geometry' ? 'geometry' : 'text';
			const mapped = sourcePositionAtPointer(sourceTarget, from, source, event.clientX, event.clientY, mode);
			const pos = sourceTarget.dataset.sourceInterior === 'true' ? clampToSourceInterior(from, source, mapped) : mapped;
			return { pos, assoc: pos <= from ? 1 : -1 };
		}
	}

	const caret = domCaretAtPoint(event.clientX, event.clientY);
	if (caret && view.contentDOM.contains(caret.offsetNode)) {
		try {
			const pos = view.posAtDOM(caret.offsetNode, caret.offset);
			const coords = view.coordsAtPos(pos);
			const assoc = !coords || event.clientX <= (coords.left + coords.right) / 2 ? 1 : -1;
			return { pos, assoc };
		} catch {
			// Fall through when the browser caret lands in an unmappable decoration node.
		}
	}
	return view.posAndSideAtCoords({ x: event.clientX, y: event.clientY }, false);
}

function pointerRange(state: EditorState, position: PointerPosition, clickType: number): SelectionRange {
	if (clickType <= 1) return EditorSelection.cursor(position.pos, position.assoc);
	if (clickType === 2) return state.wordAt(position.pos) ?? EditorSelection.cursor(position.pos, position.assoc);
	const line = state.doc.lineAt(position.pos);
	return EditorSelection.range(line.from, line.to < state.doc.length ? line.to + 1 : line.to);
}

export function livePreviewMouseSelectionStyle(view: EditorView, startEvent: MouseEvent): MouseSelectionStyle | null {
	if (startEvent.button !== 0) return null;
	const target = startEvent.target instanceof Element ? startEvent.target : null;
	if (target?.closest('button,input,textarea,select,summary')) return null;
	if (target?.closest('a') && (startEvent.ctrlKey || startEvent.metaKey || startEvent.shiftKey || startEvent.altKey))
		return null;

	let start = pointerPosition(view, startEvent);
	let startSelection = view.state.selection;
	const clickType = Math.max(1, Math.min(startEvent.detail, 3));
	return {
		get(curEvent, extend, multiple) {
			const current = pointerPosition(view, curEvent);
			let range = pointerRange(view.state, current, clickType);
			if (current.pos !== start.pos && !extend) {
				const startRange = pointerRange(view.state, start, clickType);
				const from = Math.min(startRange.from, range.from);
				const to = Math.max(startRange.to, range.to);
				range = current.pos < start.pos ? EditorSelection.range(to, from) : EditorSelection.range(from, to);
			}
			if (extend) return startSelection.replaceRange(startSelection.main.extend(range.from, range.to));
			if (multiple) return startSelection.addRange(range);
			return EditorSelection.create([range]);
		},
		update(update: ViewUpdate) {
			if (!update.docChanged) return;
			start = { ...start, pos: update.changes.mapPos(start.pos) };
			startSelection = startSelection.map(update.changes);
		},
	};
}
