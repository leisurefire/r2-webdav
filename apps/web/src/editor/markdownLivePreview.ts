import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle, syntaxTree } from '@codemirror/language';
import katex from 'katex';
import {
	collectInlineExcludedRanges,
	collectStructuralBlocks,
	serializeTableRows,
	splitTableRow,
	type StructuralBlock,
} from './markdownStructure';

class CheckboxWidget extends WidgetType {
	constructor(
		private readonly checked: boolean,
		private readonly from: number,
		private readonly to: number,
	) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = this.checked;
		input.className = 'cm-task-checkbox';
		input.addEventListener('change', () =>
			view.dispatch({ changes: { from: this.from, to: this.to, insert: input.checked ? '[x]' : '[ ]' } }),
		);
		return input;
	}
}

class InlineMathWidget extends WidgetType {
	constructor(private readonly expression: string) {
		super();
	}
	toDOM(): HTMLElement {
		const node = document.createElement('span');
		node.className = 'cm-live-inline-math';
		try {
			katex.render(this.expression, node, { displayMode: false, throwOnError: false });
		} catch {
			node.textContent = `$${this.expression}$`;
		}
		return node;
	}
}

class HorizontalRuleWidget extends WidgetType {
	toDOM(): HTMLElement {
		const rule = document.createElement('hr');
		rule.className = 'cm-live-hr';
		return rule;
	}
}

class ImageWidget extends WidgetType {
	constructor(private readonly source: string) {
		super();
	}
	toDOM(): HTMLElement {
		const match = /^!\[([^\]]*)\]\((\S+?)(?:\s+["'].*["'])?\)$/.exec(this.source);
		if (!match) {
			const fallback = document.createElement('span');
			fallback.textContent = this.source;
			return fallback;
		}
		const image = document.createElement('img');
		image.className = 'cm-live-image';
		image.alt = match[1];
		image.src = match[2].replace(/^<|>$/g, '');
		image.loading = 'lazy';
		return image;
	}
}

class ListMarkerWidget extends WidgetType {
	constructor(private readonly marker: string) {
		super();
	}
	toDOM(): HTMLElement {
		const node = document.createElement('span');
		node.className = 'cm-live-list-marker';
		node.textContent = /^\d/.test(this.marker) ? this.marker : '•';
		return node;
	}
}

class BlockWidget extends WidgetType {
	constructor(
		private readonly block: StructuralBlock,
		private readonly source: string,
	) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		if (this.block.kind === 'table') return this.tableDOM(view);
		const wrapper = document.createElement(this.block.kind === 'details' ? 'details' : 'div');
		wrapper.className = `cm-live-block cm-live-${this.block.kind}`;
		if (this.block.kind === 'fence') {
			const lines = this.source.split('\n');
			const label = lines[0].replace(/^\s*(```|~~~)/, '').trim();
			const chrome = document.createElement('div');
			chrome.className = 'cm-live-code-chrome';
			chrome.textContent = label || 'code';
			const code = document.createElement('code');
			code.textContent = lines
				.slice(
					1,
					lines
						.at(-1)
						?.trim()
						.match(/^```|^~~~/)
						? -1
						: undefined,
				)
				.join('\n');
			const pre = document.createElement('pre');
			pre.append(code);
			wrapper.append(chrome, pre);
		} else if (this.block.kind === 'math') {
			try {
				katex.render(this.source.replace(/^\s*\$\$|\$\$\s*$/g, ''), wrapper, {
					displayMode: true,
					throwOnError: false,
				});
			} catch {
				wrapper.textContent = this.source;
			}
		} else {
			const summary = /<summary>([\s\S]*?)<\/summary>/i.exec(this.source)?.[1] ?? 'Details';
			const summaryNode = document.createElement('summary');
			summaryNode.textContent = summary.replace(/<[^>]+>/g, '');
			const content = document.createElement('div');
			content.textContent = this.source.replace(/<\/?details[^>]*>|<summary>[\s\S]*?<\/summary>/gi, '').trim();
			wrapper.append(summaryNode, content);
			(wrapper as HTMLDetailsElement).open = true;
		}
		return wrapper;
	}
	private tableDOM(view: EditorView): HTMLElement {
		const table = document.createElement('table');
		table.className = 'cm-live-table';
		const lines = this.source.trimEnd().split('\n');
		const rows = lines.map(splitTableRow);
		const separatorIndex = rows.findIndex((row) => row.every((cell) => /^:?-+:?$/.test(cell)));
		rows.forEach((cells, rowIndex) => {
			if (rowIndex === separatorIndex) return;
			const row = document.createElement('tr');
			cells.forEach((value, columnIndex) => {
				const cell = document.createElement(rowIndex < separatorIndex ? 'th' : 'td');
				cell.textContent = value;
				cell.tabIndex = 0;
				cell.addEventListener('dblclick', () => {
					const input = document.createElement('textarea');
					input.value = value;
					cell.replaceChildren(input);
					input.focus();
					input.select();
					const commit = () => {
						const updated = rows.map((items, index) =>
							index === rowIndex
								? items.map((item, column) =>
										column === columnIndex ? input.value.replaceAll('|', '\\|').replaceAll('\n', ' ') : item,
									)
								: items,
						);
						const markdown = serializeTableRows(updated);
						view.dispatch({ changes: { from: this.block.from, to: this.block.to, insert: markdown } });
					};
					input.addEventListener('blur', commit, { once: true });
					input.addEventListener('keydown', (event) => {
						if (event.key === 'Enter' && !event.shiftKey) {
							event.preventDefault();
							input.blur();
						}
					});
				});
				row.append(cell);
			});
			table.append(row);
		});
		return table;
	}
}

function buildDecorations(view: EditorView) {
	try {
		const text = view.state.doc.toString();
		const blocks = collectStructuralBlocks(text);
		const decorations: { from: number; to: number; value: Decoration }[] = [];
		const add = (from: number, to: number, value: Decoration) => decorations.push({ from, to, value });
		const active = new Set<number>();
		for (const range of view.state.selection.ranges) {
			const line = view.state.doc.lineAt(range.from);
			active.add(line.from);
			active.add(view.state.doc.lineAt(range.to).from);
		}
		const visible = (from: number, to: number) =>
			view.visibleRanges.some((range) => from <= range.to && to >= range.from);
		for (const block of blocks) {
			if (!visible(block.from, block.to)) continue;
			const touched = view.state.selection.ranges.some((range) => range.from <= block.to && range.to >= block.from);
			if (!touched)
				add(
					block.from,
					block.to,
					Decoration.replace({ widget: new BlockWidget(block, text.slice(block.from, block.to)), block: true }),
				);
			else {
				let position = block.from;
				while (position <= block.to && position <= view.state.doc.length) {
					const line = view.state.doc.lineAt(position);
					add(line.from, line.from, Decoration.line({ class: `cm-live-raw-block cm-live-raw-${block.kind}` }));
					if (line.to >= block.to || line.to === view.state.doc.length) break;
					position = line.to + 1;
				}
			}
		}
		const visibleLines = new Set<number>();
		for (const range of view.visibleRanges) {
			let position = view.state.doc.lineAt(range.from).from;
			while (position <= range.to) {
				visibleLines.add(view.state.doc.lineAt(position).number);
				const line = view.state.doc.lineAt(position);
				if (line.to === view.state.doc.length) break;
				position = line.to + 1;
			}
		}
		const inlineExclusions: Array<{ from: number; to: number }> = [];
		for (const lineNo of visibleLines) {
			const line = view.state.doc.line(lineNo);
			const isActive = active.has(line.from);
			const block = blocks.find((item) => line.from >= item.from && line.from < item.to);
			if (block) continue;
			const lineText = line.text;
			const task = /^(\s*-\s+)\[([ xX])\]\s+/.exec(lineText);
			if (task) {
				const markerFrom = line.from + task[1].length;
				const markerTo = markerFrom + 3;
				inlineExclusions.push({ from: markerFrom, to: markerTo });
				if (!isActive)
					add(
						markerFrom,
						markerTo,
						Decoration.replace({
							widget: new CheckboxWidget(task[2].toLowerCase() === 'x', markerFrom + 1, markerTo - 1),
						}),
					);
			}
			const excludedRanges = collectInlineExcludedRanges(lineText);
			for (const range of excludedRanges) {
				if (range.kind === 'math') inlineExclusions.push({ from: line.from + range.from, to: line.from + range.to });
				if (range.kind !== 'math' || isActive) continue;
				add(
					line.from + range.from,
					line.from + range.to,
					Decoration.replace({ widget: new InlineMathWidget(lineText.slice(range.from + 1, range.to - 1)) }),
				);
			}
		}
		const overlapsExcluded = (from: number, to: number) =>
			inlineExclusions.some((range) => from < range.to && to > range.from);
		const tree = syntaxTree(view.state);
		for (const visibleRange of view.visibleRanges) {
			tree.iterate({
				from: visibleRange.from,
				to: visibleRange.to,
				enter: (node) => {
					if (overlapsExcluded(node.from, node.to)) return;
					const block = blocks.find((item) => node.from < item.to && node.to > item.from);
					if (block) return;
					const line = view.state.doc.lineAt(node.from);
					const isActive = active.has(line.from);
					if (node.name === 'HorizontalRule') {
						if (!isActive) add(node.from, node.to, Decoration.replace({ widget: new HorizontalRuleWidget() }));
						return;
					}
					if (
						node.name === 'ATXHeading1' ||
						node.name === 'ATXHeading2' ||
						node.name === 'ATXHeading3' ||
						node.name === 'ATXHeading4' ||
						node.name === 'ATXHeading5' ||
						node.name === 'ATXHeading6'
					) {
						const level = node.name.at(-1);
						add(node.from, node.to, Decoration.mark({ class: `cm-live-heading cm-live-h${level}` }));
						return;
					}
					if (
						node.name === 'StrongEmphasis' ||
						node.name === 'Emphasis' ||
						node.name === 'InlineCode' ||
						node.name === 'Link' ||
						node.name === 'Image'
					) {
						if (node.name === 'Image' && !isActive) {
							add(
								node.from,
								node.to,
								Decoration.replace({ widget: new ImageWidget(view.state.sliceDoc(node.from, node.to)) }),
							);
							return false;
						}
						const className =
							node.name === 'StrongEmphasis'
								? 'cm-live-strong'
								: node.name === 'Emphasis'
									? 'cm-live-em'
									: node.name === 'InlineCode'
										? 'cm-live-inline-code'
										: 'cm-live-link';
						add(node.from, node.to, Decoration.mark({ class: className }));
						return;
					}
					if (
						node.name === 'HeaderMark' ||
						node.name === 'EmphasisMark' ||
						node.name === 'CodeMark' ||
						node.name === 'LinkMark' ||
						node.name === 'URL' ||
						node.name === 'QuoteMark' ||
						node.name === 'ListMark'
					) {
						if (!isActive && node.name === 'QuoteMark') {
							add(node.from, node.to, Decoration.replace({}));
							add(node.from, node.from, Decoration.line({ class: 'cm-live-blockquote' }));
						} else if (!isActive && node.name === 'ListMark') {
							add(
								node.from,
								node.to,
								Decoration.replace({ widget: new ListMarkerWidget(view.state.sliceDoc(node.from, node.to)) }),
							);
						} else if (!isActive) add(node.from, node.to, Decoration.replace({}));
					}
				},
			});
		}
		return Decoration.set(
			decorations.map((item) => item.value.range(item.from, item.to)),
			true,
		);
	} catch {
		return Decoration.none;
	}
}

const livePreviewPlugin = ViewPlugin.fromClass(
	class {
		decorations = Decoration.none;
		constructor(private readonly view: EditorView) {
			this.decorations = buildDecorations(view);
		}
		update(update: ViewUpdate) {
			if (update.docChanged || update.selectionSet || update.viewportChanged)
				this.decorations = buildDecorations(this.view);
		}
	},
	{ decorations: (value) => value.decorations },
);

type MarkdownLivePreviewOptions = {
	onChange: (value: string, immediate: boolean) => void;
	onImageTooLarge?: () => void;
	onImageReadError?: () => void;
};

function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener('load', () => resolve(String(reader.result)));
		reader.addEventListener('error', () => reject(reader.error));
		reader.readAsDataURL(file);
	});
}

export function createMarkdownLivePreview(
	parent: HTMLElement,
	value: string,
	options: MarkdownLivePreviewOptions,
): EditorView {
	localStorage.setItem('wysiwygMode', 'true');
	const livePreview = new Compartment();
	const pendingImageRanges = new Map<number, { from: number; to: number; empty: boolean }>();
	let nextImagePasteId = 0;
	const clipboardHandlers = EditorView.domEventHandlers({
		paste(event, view) {
			if ((event.target as HTMLElement | null)?.closest('.cm-live-table textarea')) return false;
			const image = [...(event.clipboardData?.files ?? [])].find((file) => file.type.startsWith('image/'));
			if (!image) return false;
			event.preventDefault();
			if (image.size > 256 * 1024) {
				options.onImageTooLarge?.();
				return true;
			}
			const id = ++nextImagePasteId;
			const selection = view.state.selection.main;
			pendingImageRanges.set(id, { from: selection.from, to: selection.to, empty: selection.empty });
			void readFileAsDataUrl(image)
				.then((dataUrl) => {
					const range = pendingImageRanges.get(id);
					pendingImageRanges.delete(id);
					if (!range || !view.dom.isConnected) return;
					const alt = image.name || 'image';
					const markdown = `![${alt.replaceAll(']', '\\]')}](${dataUrl})`;
					view.dispatch({
						changes: { from: range.from, to: range.to, insert: markdown },
						selection: { anchor: range.from + markdown.length },
						annotations: Transaction.userEvent.of('input.paste'),
						scrollIntoView: true,
					});
					view.focus();
				})
				.catch(() => {
					pendingImageRanges.delete(id);
					options.onImageReadError?.();
				});
			return true;
		},
	});
	const state = EditorState.create({
		doc: value,
		extensions: [
			markdown(),
			syntaxHighlighting(defaultHighlightStyle),
			livePreview.of(livePreviewPlugin),
			clipboardHandlers,
			EditorView.clipboardInputFilter.of((text) => text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')),
			EditorView.lineWrapping,
			EditorView.theme({
				'&': { height: '100%' },
				'.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
				'.cm-content': { padding: '22px 24px', minHeight: '100%', lineHeight: '1.75' },
			}),
			EditorView.updateListener.of((update) => {
				if (!update.docChanged) return;
				for (const [id, range] of pendingImageRanges) {
					const mappedFrom = update.changes.mapPos(range.from, range.empty ? 1 : -1);
					pendingImageRanges.set(id, {
						from: mappedFrom,
						to: range.empty ? mappedFrom : update.changes.mapPos(range.to, 1),
						empty: range.empty,
					});
				}
				const immediate = update.transactions.some(
					(transaction) => transaction.isUserEvent('input.paste') || transaction.isUserEvent('delete.cut'),
				);
				options.onChange(update.state.doc.toString(), immediate);
			}),
		],
	});
	return new EditorView({ state, parent });
}
