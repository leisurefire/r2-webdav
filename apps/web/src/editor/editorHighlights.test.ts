import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
	editorHighlightField,
	persistentContentHighlightEffect,
	transientCitationHighlightEffect,
} from './editorHighlights';

function classes(state: EditorState): string[] {
	const result: string[] = [];
	state.field(editorHighlightField).decorations.between(0, state.doc.length, (_from, _to, value) => {
		result.push(String(value.spec.class ?? ''));
	});
	return result;
}

describe('editor highlight manager', () => {
	it('replaces the active range instead of layering backgrounds', () => {
		let state = EditorState.create({ doc: 'alpha beta', extensions: [editorHighlightField] });
		state = state.update({ effects: persistentContentHighlightEffect(0, 5) }).state;
		state = state.update({ effects: transientCitationHighlightEffect(6, 10) }).state;
		expect(classes(state)).toHaveLength(1);
		expect(classes(state)[0]).toContain('cm-editor-highlight-transient');
		expect(state.field(editorHighlightField)).toMatchObject({ kind: 'transient', from: 6, to: 10 });
	});

	it('alternates transient animation classes on repeated highlights', () => {
		let state = EditorState.create({ doc: 'alpha', extensions: [editorHighlightField] });
		state = state.update({ effects: transientCitationHighlightEffect(0, 5) }).state;
		const first = classes(state)[0];
		state = state.update({ effects: transientCitationHighlightEffect(0, 5) }).state;
		const second = classes(state)[0];
		expect(first).not.toBe(second);
	});
});
