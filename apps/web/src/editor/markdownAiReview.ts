import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

export type AiReviewSegment = { from: number; to: number; kind: 'deleted' | 'inserted' };

const aiReviewSetEffect = StateEffect.define<AiReviewSegment[] | null>();

export function buildAiReviewMarkDecorations(segments: AiReviewSegment[]): DecorationSet {
	const ranges = segments
		.filter((segment) => segment.to > segment.from)
		.map((segment) =>
			Decoration.mark({
				class: segment.kind === 'deleted' ? 'cm-ai-review-deleted' : 'cm-ai-review-inserted',
			}).range(segment.from, segment.to),
		);
	return ranges.length ? Decoration.set(ranges, true) : Decoration.none;
}

export const aiReviewField = StateField.define<{
	segments: AiReviewSegment[] | null;
	decorations: DecorationSet;
}>({
	create: () => ({ segments: null, decorations: Decoration.none }),
	update(value, transaction) {
		let segments = value.segments;
		let rebuild = false;
		for (const effect of transaction.effects) {
			if (effect.is(aiReviewSetEffect)) {
				segments = effect.value;
				rebuild = true;
			}
		}
		if (!segments?.length) {
			if (!rebuild && value.segments === null) return value;
			return { segments: null, decorations: Decoration.none };
		}
		if (transaction.docChanged) {
			segments = segments
				.map((segment) => ({
					from: transaction.changes.mapPos(segment.from, 1),
					to: transaction.changes.mapPos(segment.to, -1),
					kind: segment.kind,
				}))
				.filter((segment) => segment.to > segment.from);
			rebuild = true;
		}
		if (!rebuild) return value;
		return { segments, decorations: buildAiReviewMarkDecorations(segments) };
	},
	provide: (field) => EditorView.decorations.from(field, (state) => state.decorations),
});

export function showAiReview(view: EditorView, segments: AiReviewSegment[]): void {
	view.dispatch({ effects: aiReviewSetEffect.of(segments) });
}

export function clearAiReview(view: EditorView): void {
	view.dispatch({ effects: aiReviewSetEffect.of(null) });
}
