import { defaultKeymap, deleteCharBackward, deleteCharForward, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { GFM } from '@lezer/markdown';
import { aiReviewField } from './markdownAiReview';
import { markdownClipboardExtensions, type MarkdownClipboardOptions } from './markdownClipboardController';
import { parsedDeleteRange, type DeleteDirection } from './markdownDeletion';
import { livePreviewField } from './markdownDecorations';
import {
	continueStructuredMarkdownLine,
	indentStructuredMarkdownLine,
	toggleMarkdownWrap,
} from './markdownEditing';
import {
	editorHighlightField,
	editorHighlightPointerHandler,
} from './editorHighlights';
import type { MarkdownHeading } from './markdownHeadings';
import { collectLiveMarkdownHeadings } from './markdownLiveHeadings';
import { livePreviewMouseSelectionStyle } from './markdownPointer';

export const markdownLanguageSupport = markdown({ extensions: GFM });

// Keep the reset with CodeMirror's defaults so rule ordering removes its heading underline.
export const markdownLivePreviewHighlightStyle = HighlightStyle.define([
	...defaultHighlightStyle.specs,
	{ tag: tags.heading, textDecoration: 'none', fontWeight: 'bold' },
]);

export type MarkdownLivePreviewOptions = MarkdownClipboardOptions & {
	onChange: (value: string, immediate: boolean) => void;
	onHeadingsChange?: (headings: MarkdownHeading[]) => void;
};

function parsedDelete(direction: DeleteDirection) {
	return (view: EditorView): boolean => {
		const range = parsedDeleteRange(view.state, direction);
		if (!range) return direction === 'backward' ? deleteCharBackward(view) : deleteCharForward(view);
		view.dispatch({
			changes: range,
			annotations: Transaction.userEvent.of(direction === 'backward' ? 'delete.backward' : 'delete.forward'),
		});
		return true;
	};
}

function editorKeymap() {
	return keymap.of([
		{ key: 'Backspace', run: parsedDelete('backward') },
		{ key: 'Delete', run: parsedDelete('forward') },
		{ key: 'Enter', run: continueStructuredMarkdownLine },
		{ key: 'Tab', run: (view) => indentStructuredMarkdownLine(view, 'indent') },
		{ key: 'Shift-Tab', run: (view) => indentStructuredMarkdownLine(view, 'outdent') },
		{ key: 'Mod-b', run: (view) => toggleMarkdownWrap(view, '**') },
		{ key: 'Mod-i', run: (view) => toggleMarkdownWrap(view, '*') },
		{ key: 'Mod-Shift-s', run: (view) => toggleMarkdownWrap(view, '~~') },
		{ key: 'Mod-`', run: (view) => toggleMarkdownWrap(view, '`') },
		...defaultKeymap,
		...historyKeymap,
	]);
}

function editorTheme(darkMode: boolean) {
	return EditorView.theme(
		{
			'&': { height: '100%' },
			'.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
			'.cm-content': {
				padding: '22px 24px',
				minHeight: '100%',
				lineHeight: '1.75',
				caretColor: 'var(--input-caret)',
			},
			'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--input-caret) !important' },
		},
		{ dark: darkMode },
	);
}

export function createMarkdownLivePreview(
	parent: HTMLElement,
	value: string,
	options: MarkdownLivePreviewOptions,
): EditorView {
	const state = EditorState.create({
		doc: value,
		extensions: [
			markdownLanguageSupport,
			syntaxHighlighting(markdownLivePreviewHighlightStyle),
			livePreviewField,
			editorHighlightField,
			aiReviewField,
			editorHighlightPointerHandler,
			EditorView.mouseSelectionStyle.of(livePreviewMouseSelectionStyle),
			history(),
			editorKeymap(),
			...markdownClipboardExtensions(options),
			lineNumbers(),
			EditorView.lineWrapping,
			editorTheme(window.matchMedia('(prefers-color-scheme: dark)').matches),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) {
					const immediate = update.transactions.some(
						(transaction) => transaction.isUserEvent('input.paste') || transaction.isUserEvent('delete.cut'),
					);
					options.onChange(update.state.doc.toString(), immediate);
					options.onHeadingsChange?.(collectLiveMarkdownHeadings(update.state));
				}
			}),
		],
	});
	const view = new EditorView({ state, parent });
	queueMicrotask(() => {
		if (view.dom.isConnected) options.onHeadingsChange?.(collectLiveMarkdownHeadings(view.state));
	});
	return view;
}
