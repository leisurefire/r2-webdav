import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

export type EditorHighlightKind = 'persistent' | 'transient';
type EditorHighlightSource = 'content' | 'selection' | 'citation';

export interface EditorHighlightState {
	kind: EditorHighlightKind | null;
	source: EditorHighlightSource | null;
	from: number;
	to: number;
	sequence: number;
	decorations: DecorationSet;
}

interface EditorHighlightEffect {
	kind: EditorHighlightKind;
	source: EditorHighlightSource;
	range: { from: number; to: number } | null;
}

const editorHighlightEffect = StateEffect.define<EditorHighlightEffect>();

function highlightEffect(
	kind: EditorHighlightKind,
	source: EditorHighlightSource,
	from: number,
	to: number,
): StateEffect<EditorHighlightEffect> {
	return editorHighlightEffect.of({ kind, source, range: to > from ? { from, to } : null });
}

export function persistentContentHighlightEffect(from: number, to: number): StateEffect<EditorHighlightEffect> {
	return highlightEffect('persistent', 'content', from, to);
}

export function transientCitationHighlightEffect(from: number, to: number): StateEffect<EditorHighlightEffect> {
	return highlightEffect('transient', 'citation', from, to);
}

function decoration(
	kind: EditorHighlightKind,
	source: EditorHighlightSource,
	sequence: number,
	from: number,
	to: number,
): DecorationSet {
	const className =
		kind === 'persistent'
			? `cm-editor-highlight cm-editor-highlight-persistent cm-editor-highlight-${source}`
			: `cm-editor-highlight cm-editor-highlight-transient cm-editor-highlight-${source} cm-editor-highlight-transient-${sequence % 2}`;
	return Decoration.set([Decoration.mark({ class: className }).range(from, to)]);
}

export const editorHighlightField = StateField.define<EditorHighlightState>({
	create: () => ({ kind: null, source: null, from: 0, to: 0, sequence: 0, decorations: Decoration.none }),
	update(value, transaction) {
		let from = transaction.changes.mapPos(value.from, 1);
		let to = transaction.changes.mapPos(value.to, -1);
		let kind = value.kind;
		let source = value.source;
		let sequence = value.sequence;
		let rebuild = transaction.docChanged && kind !== null;
		for (const effect of transaction.effects) {
			if (!effect.is(editorHighlightEffect)) continue;
			if (!effect.value.range) {
				if (kind === effect.value.kind && source === effect.value.source) {
					kind = null;
					source = null;
					from = 0;
					to = 0;
					rebuild = true;
				}
				continue;
			}
			kind = effect.value.kind;
			source = effect.value.source;
			from = effect.value.range.from;
			to = effect.value.range.to;
			sequence += 1;
			rebuild = true;
		}
		if (
			kind === 'persistent' &&
			transaction.docChanged &&
			!transaction.isUserEvent('input.paste') &&
			!transaction.effects.some((effect) => effect.is(editorHighlightEffect))
		) {
			kind = null;
			source = null;
			from = 0;
			to = 0;
			rebuild = true;
		}
		if (to <= from) {
			kind = null;
			source = null;
		}
		if (!rebuild) return value;
		return {
			kind,
			source,
			from,
			to,
			sequence,
			decorations: kind && source ? decoration(kind, source, sequence, from, to) : Decoration.none,
		};
	},
	provide: (field) => EditorView.decorations.from(field, (state) => state.decorations),
});

export const editorHighlightPointerHandler: Extension = EditorView.domEventHandlers({
	mousedown(_event, view) {
		const highlight = view.state.field(editorHighlightField, false);
		if (highlight?.source !== 'content') return;
		view.dispatch({ effects: highlightEffect('persistent', 'content', 0, 0) });
	},
});

const transientTimers = new WeakMap<EditorView, number>();

/** Replaces the single active editor highlight; ranges are never layered. */
export function showEditorHighlight(
	view: EditorView,
	from: number,
	to: number,
	kind: EditorHighlightKind,
	duration = 1600,
	source: EditorHighlightSource = kind === 'transient' ? 'citation' : 'content',
): void {
	const timer = transientTimers.get(view);
	if (timer !== undefined) window.clearTimeout(timer);
	transientTimers.delete(view);
	view.dispatch({ effects: highlightEffect(kind, source, from, to) });
	if (kind !== 'transient' || to <= from) return;
	transientTimers.set(
		view,
		window.setTimeout(() => {
			transientTimers.delete(view);
			if (!view.dom.isConnected) return;
			view.dispatch({ effects: highlightEffect('transient', source, 0, 0) });
		}, duration),
	);
}

export function markNewContent(view: EditorView, from: number, to: number): void {
	showEditorHighlight(view, from, to, 'persistent');
}

export function holdSelectionHighlight(view: EditorView, from: number, to: number): void {
	showEditorHighlight(view, from, to, 'persistent', 0, 'selection');
}

export function clearSelectionHold(view: EditorView): void {
	view.dispatch({ effects: highlightEffect('persistent', 'selection', 0, 0) });
}
