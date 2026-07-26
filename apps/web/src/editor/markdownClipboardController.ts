import { Transaction, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { persistentContentHighlightEffect } from './editorHighlights';
import { normalizeClipboardText, prepareClipboardText, readClipboardText } from './markdownClipboard';

export type MarkdownClipboardOptions = {
	onImageTooLarge?: () => void;
	onImageReadError?: () => void;
};

type PendingImageRange = { from: number; to: number; empty: boolean };

function clipboardText(event: ClipboardEvent): string {
	const data = event.clipboardData;
	if (!data) return '';
	const text = readClipboardText((type) => data.getData(type));
	if (text) return text;
	const html = data.getData('text/html');
	if (!html) return '';
	const fragment = document.createElement('div');
	fragment.innerHTML = html;
	fragment.querySelectorAll('br').forEach((breakNode) => breakNode.replaceWith('\n'));
	return normalizeClipboardText(fragment.innerText || fragment.textContent || '');
}

class MarkdownClipboardController {
	private nextImagePasteId = 0;
	private readonly pendingRanges = new Map<number, PendingImageRange>();
	private readonly readers = new Map<number, FileReader>();

	constructor(
		private readonly view: EditorView,
		private readonly options: MarkdownClipboardOptions,
	) {}

	paste(event: ClipboardEvent): boolean {
		if ((event.target as HTMLElement | null)?.closest('.cm-live-table textarea')) return false;
		const image = [...(event.clipboardData?.files ?? [])].find((file) => file.type.startsWith('image/'));
		if (image) return this.pasteImage(event, image);

		const text = clipboardText(event);
		if (!text) return false;
		event.preventDefault();
		const selection = this.view.state.selection.main;
		const insert = prepareClipboardText(
			text,
			selection.from > 0 ? this.view.state.sliceDoc(selection.from - 1, selection.from) : '',
			selection.to < this.view.state.doc.length ? this.view.state.sliceDoc(selection.to, selection.to + 1) : '',
		);
		this.view.dispatch({
			changes: { from: selection.from, to: selection.to, insert },
			selection: { anchor: selection.from + insert.length },
			annotations: Transaction.userEvent.of('input.paste'),
			scrollIntoView: true,
			effects: persistentContentHighlightEffect(selection.from, selection.from + insert.length),
		});
		this.view.focus();
		return true;
	}

	update(update: ViewUpdate): void {
		if (!update.docChanged) return;
		for (const [id, range] of this.pendingRanges) {
			const mappedFrom = update.changes.mapPos(range.from, range.empty ? 1 : -1);
			this.pendingRanges.set(id, {
				from: mappedFrom,
				to: range.empty ? mappedFrom : update.changes.mapPos(range.to, 1),
				empty: range.empty,
			});
		}
	}

	destroy(): void {
		for (const reader of this.readers.values()) reader.abort();
		this.readers.clear();
		this.pendingRanges.clear();
	}

	private pasteImage(event: ClipboardEvent, image: File): boolean {
		event.preventDefault();
		if (image.size > 256 * 1024) {
			this.options.onImageTooLarge?.();
			return true;
		}
		const id = ++this.nextImagePasteId;
		const selection = this.view.state.selection.main;
		this.pendingRanges.set(id, { from: selection.from, to: selection.to, empty: selection.empty });
		const reader = new FileReader();
		this.readers.set(id, reader);
		reader.addEventListener('load', () => this.finishImagePaste(id, image, String(reader.result)));
		reader.addEventListener('error', () => {
			this.releaseImagePaste(id);
			this.options.onImageReadError?.();
		});
		reader.addEventListener('abort', () => this.releaseImagePaste(id));
		reader.readAsDataURL(image);
		return true;
	}

	private finishImagePaste(id: number, image: File, dataUrl: string): void {
		const range = this.pendingRanges.get(id);
		this.releaseImagePaste(id);
		if (!range || !this.view.dom.isConnected) return;
		const alt = image.name || 'image';
		const markdown = `![${alt.replaceAll(']', '\\]')}](${dataUrl})`;
		this.view.dispatch({
			changes: { from: range.from, to: range.to, insert: markdown },
			selection: { anchor: range.from + markdown.length },
			annotations: Transaction.userEvent.of('input.paste'),
			scrollIntoView: true,
			effects: persistentContentHighlightEffect(range.from, range.from + markdown.length),
		});
		this.view.focus();
	}

	private releaseImagePaste(id: number): void {
		this.pendingRanges.delete(id);
		this.readers.delete(id);
	}
}

export function markdownClipboardExtensions(options: MarkdownClipboardOptions): Extension[] {
	let controller: MarkdownClipboardController | undefined;
	return [
		ViewPlugin.define((view) => {
			controller = new MarkdownClipboardController(view, options);
			return {
				update(update) {
					controller?.update(update);
				},
				destroy() {
					controller?.destroy();
					controller = undefined;
				},
			};
		}),
		EditorView.domEventHandlers({ paste: (event) => controller?.paste(event) ?? false }),
		EditorView.clipboardInputFilter.of(normalizeClipboardText),
	];
}
