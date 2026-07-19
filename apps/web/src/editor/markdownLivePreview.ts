import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import katex from 'katex';

type Block = { from: number; to: number; kind: 'fence' | 'math' | 'details' | 'table' };

function collectStructuralBlocks(text: string): Block[] {
	const blocks: Block[] = [];
	const lines = text.split(/\n/);
	let offset = 0;
	let fence: number | null = null;
	let math: number | null = null;
	let details: number | null = null;
	let table: number | null = null;
	for (const line of lines) {
		const trimmed = line.trim();
		if (/^```|^~~~/.test(trimmed)) {
			if (fence === null) fence = offset;
			else {
				blocks.push({ from: fence, to: offset + line.length, kind: 'fence' });
				fence = null;
			}
		} else if (/^\$\$/.test(trimmed)) {
			if (math === null) math = offset;
			else {
				blocks.push({ from: math, to: offset + line.length, kind: 'math' });
				math = null;
			}
		} else if (/^<details\b/i.test(trimmed)) details = details ?? offset;
		else if (/^<\/details>/i.test(trimmed) && details !== null) {
			blocks.push({ from: details, to: offset + line.length, kind: 'details' });
			details = null;
		} else if (
			table === null &&
			/^\s*\|.+\|\s*$/.test(line) &&
			!/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line)
		)
			table = offset;
		else if (table !== null && !/^\s*\|.+\|\s*$/.test(line)) {
			blocks.push({ from: table, to: offset, kind: 'table' });
			table = null;
		}
		offset += line.length + 1;
	}
	if (fence !== null) blocks.push({ from: fence, to: text.length, kind: 'fence' });
	if (math !== null) blocks.push({ from: math, to: text.length, kind: 'math' });
	if (details !== null) blocks.push({ from: details, to: text.length, kind: 'details' });
	if (table !== null) blocks.push({ from: table, to: text.length, kind: 'table' });
	return blocks;
}

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

class BlockWidget extends WidgetType {
	constructor(
		private readonly block: Block,
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
		const rows = lines.map((line) =>
			line
				.trim()
				.replace(/^\||\|$/g, '')
				.split('|')
				.map((cell) => cell.trim()),
		);
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
						const markdown = updated.map((items) => `| ${items.join(' | ')} |`).join('\n');
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
		for (const lineNo of visibleLines) {
			const line = view.state.doc.line(lineNo);
			const isActive = active.has(line.from);
			const block = blocks.find((item) => line.from >= item.from && line.from < item.to);
			if (block) continue;
			const lineText = line.text;
			const heading = /^(#{1,6})\s+/.exec(lineText);
			if (heading) {
				if (!isActive) add(line.from, line.from + heading[1].length + 1, Decoration.replace({}));
				add(
					line.from + heading[1].length + 1,
					line.to,
					Decoration.mark({ class: `cm-live-heading cm-live-h${heading[1].length}` }),
				);
				continue;
			}
			const task = /^(\s*-\s+)\[([ xX])\]\s+/.exec(lineText);
			if (task && !isActive) {
				const markerFrom = line.from + task[1].length;
				const markerTo = markerFrom + 3;
				add(
					markerFrom,
					markerTo,
					Decoration.replace({
						widget: new CheckboxWidget(task[2].toLowerCase() === 'x', markerFrom + 1, markerTo - 1),
					}),
				);
			}
			for (const match of lineText.matchAll(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_([^_]+)_)/g)) {
				const from = line.from + match.index!;
				const raw = match[0];
				if (raw.startsWith('`')) {
					if (!isActive) {
						add(from, from + 1, Decoration.replace({}));
						add(from + raw.length - 1, from + raw.length, Decoration.replace({}));
					}
					add(from + 1, from + raw.length - 1, Decoration.mark({ class: 'cm-live-inline-code' }));
				} else {
					const marker = raw.startsWith('**') || raw.startsWith('__') ? 2 : 1;
					if (!isActive) {
						add(from, from + marker, Decoration.replace({}));
						add(from + raw.length - marker, from + raw.length, Decoration.replace({}));
					}
					add(
						from + marker,
						from + raw.length - marker,
						Decoration.mark({ class: marker === 2 ? 'cm-live-strong' : 'cm-live-em' }),
					);
				}
			}
			for (const match of lineText.matchAll(/!?\[([^\]]+)\]\(([^)]+)\)/g)) {
				const from = line.from + match.index!;
				const raw = match[0];
				const labelStart = from + (raw.startsWith('!') ? 2 : 1);
				if (!isActive) {
					add(from, labelStart, Decoration.replace({}));
					add(labelStart + match[1].length, from + raw.length, Decoration.replace({}));
				}
				add(labelStart, labelStart + match[1].length, Decoration.mark({ class: 'cm-live-link' }));
			}
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

export function createMarkdownLivePreview(
	parent: HTMLElement,
	value: string,
	onChange: (value: string) => void,
): EditorView {
	localStorage.setItem('wysiwygMode', 'true');
	const livePreview = new Compartment();
	const state = EditorState.create({
		doc: value,
		extensions: [
			markdown(),
			syntaxHighlighting(defaultHighlightStyle),
			livePreview.of(livePreviewPlugin),
			EditorView.lineWrapping,
			EditorView.theme({
				'&': { height: '100%' },
				'.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
				'.cm-content': { padding: '22px 24px', minHeight: '100%', lineHeight: '1.75' },
			}),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) onChange(update.state.doc.toString());
			}),
		],
	});
	return new EditorView({ state, parent });
}
