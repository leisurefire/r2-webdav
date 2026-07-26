export function taskMarkerChange(
	from: number,
	to: number,
	checked: boolean,
): { from: number; to: number; insert: string } {
	return { from, to, insert: checked ? '[x]' : '[ ]' };
}

export function toggleMarkdownWrap(view: EditorView, marker: string): boolean {
	const selection = view.state.selection.main;
	const edit = markdownWrapEdit(view.state.doc.toString(), selection.from, selection.to, marker);
	view.dispatch({
		changes: { from: edit.from, to: edit.to, insert: edit.insert },
		selection: { anchor: edit.selectionFrom, head: edit.selectionTo },
		annotations: Transaction.userEvent.of('input.format'),
	});
	return true;
}

export function continueStructuredMarkdownLine(view: EditorView): boolean {
	const selection = view.state.selection.main;
	if (!selection.empty) return false;
	const line = view.state.doc.lineAt(selection.head);
	const continuation = continueMarkdownStructuredLine(line.text, selection.head - line.from);
	if (!continuation) return false;
	view.dispatch({
		changes: {
			from: line.from + continuation.replaceFrom,
			to: line.from + continuation.replaceTo,
			insert: continuation.insert,
		},
		selection: { anchor: line.from + continuation.cursor },
		annotations: Transaction.userEvent.of('input'),
		scrollIntoView: true,
	});
	return true;
}

export function indentStructuredMarkdownLine(view: EditorView, direction: 'indent' | 'outdent'): boolean {
	const selection = view.state.selection.main;
	if (!selection.empty) return false;
	const line = view.state.doc.lineAt(selection.head);
	const next = indentMarkdownListLine(line.text, direction);
	if (next === null || next === line.text) return false;
	const delta = next.length - line.text.length;
	const cursorInLine = selection.head - line.from;
	const cursor = Math.max(0, Math.min(cursorInLine + delta, next.length));
	view.dispatch({
		changes: { from: line.from, to: line.to, insert: next },
		selection: { anchor: line.from + cursor },
		annotations: Transaction.userEvent.of('input'),
	});
	return true;
}
import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { markdownWrapEdit } from './markdownFormatting';
import { continueMarkdownStructuredLine, indentMarkdownListLine } from './markdownStructure';
