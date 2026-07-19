import { EditorState, StateField, Transaction } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, type DecorationSet } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { GFM } from '@lezer/markdown';
import { tags } from '@lezer/highlight';
import katex from 'katex';
import {
	collectInlineExcludedRanges,
	collectObsidianInlineRanges,
	collectStructuralBlocks,
	parseFrontmatterBlock,
	parseTableBlock,
	serializeTableRows,
	type StructuralBlock,
} from './markdownStructure';
import { normalizeClipboardText, prepareClipboardText, readClipboardText } from './markdownClipboard';
import {
	renderMarkdown,
	renderMarkdownDocument,
	renderMarkdownInline,
	renderResolvedMarkdownLink,
} from './markdownRenderer';

export const markdownLanguageSupport = markdown({ extensions: GFM });

// Keep the reset in the same style module as CodeMirror's defaults so its
// documented rule ordering reliably removes the default heading underline.
export const markdownLivePreviewHighlightStyle = HighlightStyle.define([
	...defaultHighlightStyle.specs,
	{ tag: tags.heading, textDecoration: 'none', fontWeight: 'bold' },
]);

type LinkDefinition = { href: string; title?: string };
type ResolvedLink = LinkDefinition & { label: string };

function isMarkdownHeading(name: string): boolean {
	return /^ATXHeading[1-6]$|^SetextHeading[12]$/.test(name);
}

function normalizeReferenceLabel(value: string): string {
	return value
		.replace(/\\([\\[\]])/g, '$1')
		.trim()
		.replace(/\s+/g, ' ')
		.toLocaleLowerCase();
}

function markdownDestination(value: string): string {
	const trimmed = value.trim();
	const destination = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed;
	return destination.replace(/\\([\\()<>{}\[\]])/g, '$1');
}

function markdownLinkTitle(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'")) ||
		(trimmed.startsWith('(') && trimmed.endsWith(')'))
	)
		return trimmed.slice(1, -1);
	return trimmed;
}

function headingPositionForHash(view: EditorView, hash: string): number | null {
	let id: string;
	try {
		id = decodeURIComponent(hash.slice(1));
	} catch {
		return null;
	}
	const headingIndex = renderMarkdownDocument(view.state.doc.toString()).headings.findIndex(
		(heading) => heading.id === id,
	);
	if (headingIndex < 0) return null;
	let index = 0;
	let position: number | null = null;
	syntaxTree(view.state).iterate({
		enter(node) {
			if (!isMarkdownHeading(node.name)) return;
			if (index === headingIndex) position = node.from;
			index += 1;
		},
	});
	return position;
}

export function taskMarkerChange(
	from: number,
	to: number,
	checked: boolean,
): { from: number; to: number; insert: string } {
	return { from, to, insert: checked ? '[x]' : '[ ]' };
}

function selectSource(view: EditorView, from: number, to = from): void {
	const start = Math.max(0, Math.min(from, view.state.doc.length));
	const end = Math.max(start, Math.min(to, view.state.doc.length));
	view.dispatch({
		selection: { anchor: start, head: end },
		effects: EditorView.scrollIntoView(start, { y: 'center' }),
	});
	view.focus();
}

export function blockClickPosition(measured: number | null, from: number, to: number): number {
	return Math.max(from, Math.min(measured ?? from, to));
}

function selectBlockSourceAtCoords(view: EditorView, from: number, to: number, x: number, y: number): void {
	selectSource(view, from);
	view.requestMeasure({
		read: () => view.posAtCoords({ x, y }),
		write: (measured) => {
			if (view.state.selection.main.anchor !== from) return;
			const position = blockClickPosition(measured, from, to);
			view.dispatch({
				selection: { anchor: position },
				effects: EditorView.scrollIntoView(position, { y: 'nearest' }),
			});
			view.focus();
		},
	});
}

function hasInteractiveTarget(target: EventTarget | null): boolean {
	return target instanceof Element && !!target.closest('a,button,input,textarea,select,summary');
}

function bindSourceNavigation(node: HTMLElement, view: EditorView, from: number, blockTo?: number): void {
	node.addEventListener('mousedown', (event) => {
		if (!(event instanceof MouseEvent) || event.button !== 0 || hasInteractiveTarget(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
		if (blockTo !== undefined) {
			selectBlockSourceAtCoords(view, from, blockTo, event.clientX, event.clientY);
			return;
		}
		selectSource(view, view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? from);
	});
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
			view.dispatch({ changes: taskMarkerChange(this.from, this.to, input.checked) }),
		);
		return input;
	}
}

class InlineMathWidget extends WidgetType {
	constructor(
		private readonly expression: string,
		private readonly from: number,
	) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		const node = document.createElement('span');
		node.className = 'cm-live-inline-math';
		try {
			katex.render(this.expression, node, { displayMode: false, throwOnError: false });
		} catch {
			node.textContent = `$${this.expression}$`;
		}
		bindSourceNavigation(node, view, this.from);
		return node;
	}
}

class InlineMarkdownWidget extends WidgetType {
	constructor(
		private readonly source: string,
		private readonly from: number,
	) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		const node = document.createElement('span');
		node.className = 'cm-live-inline-rendered';
		node.innerHTML = renderMarkdownInline(this.source);
		bindSourceNavigation(node, view, this.from);
		return node;
	}
}

class LinkWidget extends WidgetType {
	constructor(
		private readonly source: string,
		private readonly from: number,
		private readonly resolved?: ResolvedLink,
	) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		const container = document.createElement('span');
		container.innerHTML = this.resolved
			? renderResolvedMarkdownLink(this.resolved.label, this.resolved.href, this.resolved.title)
			: renderMarkdownInline(this.source);
		const anchor = container.querySelector<HTMLAnchorElement>('a[href]');
		if (!anchor) {
			container.className = 'cm-live-link-disabled';
			container.replaceChildren(document.createTextNode(container.textContent || this.source));
			bindSourceNavigation(container, view, this.from);
			return container;
		}
		anchor.classList.add('cm-live-link');
		anchor.addEventListener('click', (event) => {
			const href = anchor.getAttribute('href') ?? '';
			if (
				!href.startsWith('#') ||
				event.button !== 0 ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey ||
				event.altKey
			)
				return;
			const position = headingPositionForHash(view, href);
			if (position === null) return;
			event.preventDefault();
			view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'start' }) });
		});
		return anchor;
	}
}

class HorizontalRuleWidget extends WidgetType {
	constructor(private readonly from: number) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		const rule = document.createElement('hr');
		rule.className = 'cm-live-hr';
		bindSourceNavigation(rule, view, this.from);
		return rule;
	}
}

class ImageWidget extends WidgetType {
	constructor(
		private readonly source: string,
		private readonly from: number,
	) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		const container = document.createElement('span');
		container.innerHTML = renderMarkdownInline(this.source);
		const image = container.querySelector('img');
		if (!image) {
			const fallback = document.createElement('span');
			fallback.textContent = this.source;
			bindSourceNavigation(fallback, view, this.from);
			return fallback;
		}
		image.className = 'cm-live-image';
		image.loading = 'lazy';
		bindSourceNavigation(image, view, this.from);
		return image;
	}
}

class ListMarkerWidget extends WidgetType {
	constructor(
		private readonly marker: string,
		private readonly from: number,
	) {
		super();
	}
	toDOM(view: EditorView): HTMLElement {
		const node = document.createElement('span');
		node.className = 'cm-live-list-marker';
		node.textContent = /^\d/.test(this.marker) ? this.marker : '•';
		bindSourceNavigation(node, view, this.from);
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
			const label = /^\s*(?:`{3,}|~{3,})(.*)$/.exec(lines[0])?.[1].trim() ?? '';
			const chrome = document.createElement('div');
			chrome.className = 'cm-live-code-chrome';
			chrome.textContent = label || 'code';
			const code = document.createElement('code');
			code.textContent = lines.slice(1, -1).join('\n');
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
		} else if (this.block.kind === 'details') {
			const summary = /<summary>([\s\S]*?)<\/summary>/i.exec(this.source)?.[1] ?? 'Details';
			const summaryNode = document.createElement('summary');
			summaryNode.innerHTML = renderMarkdownInline(summary);
			const content = document.createElement('div');
			content.innerHTML = renderMarkdown(
				this.source.replace(/<\/?details[^>]*>|<summary>[\s\S]*?<\/summary>/gi, '').trim(),
			);
			wrapper.append(summaryNode, content);
			(wrapper as HTMLDetailsElement).open = true;
		} else if (this.block.kind === 'frontmatter') {
			const frontmatter = parseFrontmatterBlock(this.source);
			if (!frontmatter || frontmatter.entries.length === 0) {
				wrapper.textContent = this.source;
			} else {
				const properties = document.createElement('dl');
				for (const entry of frontmatter.entries) {
					const row = document.createElement('div');
					const key = document.createElement('dt');
					key.textContent = entry.key;
					const value = document.createElement('dd');
					value.textContent = entry.value;
					row.append(key, value);
					properties.append(row);
				}
				wrapper.append(properties);
			}
		} else wrapper.innerHTML = renderMarkdown(this.source);
		bindSourceNavigation(wrapper, view, this.block.from, this.block.to);
		return wrapper;
	}
	private tableDOM(view: EditorView): HTMLElement {
		const parsed = parseTableBlock(this.source);
		if (!parsed) {
			const fallback = document.createElement('pre');
			fallback.textContent = this.source;
			bindSourceNavigation(fallback, view, this.block.from, this.block.to);
			return fallback;
		}
		const table = document.createElement('table');
		table.className = 'cm-live-table';
		const head = document.createElement('thead');
		const body = document.createElement('tbody');
		let sourceClickTimer = 0;
		table.addEventListener('click', (event) => {
			if (event.detail > 1 || hasInteractiveTarget(event.target)) return;
			window.clearTimeout(sourceClickTimer);
			const { clientX, clientY } = event;
			sourceClickTimer = window.setTimeout(
				() => selectBlockSourceAtCoords(view, this.block.from, this.block.to, clientX, clientY),
				220,
			);
		});
		const rows = parsed.rows;
		rows.forEach((cells, rowIndex) => {
			if (rowIndex === parsed.separatorIndex) return;
			const row = document.createElement('tr');
			cells.forEach((value, columnIndex) => {
				const cell = document.createElement(rowIndex < parsed.separatorIndex ? 'th' : 'td');
				const alignment = parsed.alignments[columnIndex];
				if (alignment) cell.style.textAlign = alignment;
				cell.innerHTML = renderMarkdownInline(value);
				cell.tabIndex = 0;
				cell.addEventListener('dblclick', () => {
					window.clearTimeout(sourceClickTimer);
					const input = document.createElement('textarea');
					input.value = value;
					cell.replaceChildren(input);
					input.focus();
					input.select();
					const commit = () => {
						const updated = rows.map((items, index) =>
							index === rowIndex
								? items.map((item, column) => (column === columnIndex ? input.value.replaceAll('\n', ' ') : item))
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
			(rowIndex < parsed.separatorIndex ? head : body).append(row);
		});
		table.append(head, body);
		return table;
	}
}

export function buildLivePreviewDecorations(state: EditorState): DecorationSet {
	try {
		const text = state.doc.toString();
		const structuralBlocks = collectStructuralBlocks(text);
		const tree = syntaxTree(state);
		const quoteBlocks: StructuralBlock[] = [];
		tree.iterate({
			enter(node) {
				if (node.name !== 'Blockquote') return;
				if (!structuralBlocks.some((block) => node.from < block.to && node.to > block.from))
					quoteBlocks.push({ from: node.from, to: node.to, kind: 'quote' });
				return false;
			},
		});
		const blocks = [...structuralBlocks, ...quoteBlocks].sort((left, right) => left.from - right.from);
		const renderedInlineRanges: Array<{ from: number; to: number }> = [];
		tree.iterate({
			enter(node) {
				if (node.name === 'Link' || node.name === 'Image' || node.name === 'Autolink' || node.name === 'URL') {
					renderedInlineRanges.push({ from: node.from, to: node.to });
					return false;
				}
				if (node.name === 'LinkReference') return false;
			},
		});
		const decorations: { from: number; to: number; value: Decoration }[] = [];
		const add = (from: number, to: number, value: Decoration) => decorations.push({ from, to, value });
		const active = new Set<number>();
		for (const range of state.selection.ranges) {
			const line = state.doc.lineAt(range.from);
			active.add(line.from);
			active.add(state.doc.lineAt(range.to).from);
		}
		for (const block of blocks) {
			const touched = state.selection.ranges.some((range) => range.from <= block.to && range.to >= block.from);
			if (!touched)
				add(
					block.from,
					block.to,
					Decoration.replace({ widget: new BlockWidget(block, text.slice(block.from, block.to)), block: true }),
				);
			else {
				let position = block.from;
				while (position <= block.to && position <= state.doc.length) {
					const line = state.doc.lineAt(position);
					add(line.from, line.from, Decoration.line({ class: `cm-live-raw-block cm-live-raw-${block.kind}` }));
					if (line.to >= block.to || line.to === state.doc.length) break;
					position = line.to + 1;
				}
			}
		}
		const inlineExclusions: Array<{ from: number; to: number }> = [];
		for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
			const line = state.doc.line(lineNo);
			const isActive = active.has(line.from);
			const block = blocks.find((item) => line.from >= item.from && line.from < item.to);
			if (block) continue;
			const lineText = line.text;
			const task = /^(\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]\s+/.exec(lineText);
			if (task) {
				const markerFrom = line.from + task[1].length;
				const markerTo = markerFrom + 3;
				inlineExclusions.push({ from: markerFrom, to: markerTo });
				if (!isActive)
					add(
						markerFrom,
						markerTo,
						Decoration.replace({
							widget: new CheckboxWidget(task[2].toLowerCase() === 'x', markerFrom, markerTo),
						}),
					);
			}
			const excludedRanges = collectInlineExcludedRanges(lineText);
			for (const range of excludedRanges) {
				const from = line.from + range.from;
				const to = line.from + range.to;
				const renderedByParent = renderedInlineRanges.some((item) => from >= item.from && to <= item.to);
				if (range.kind !== 'math' || renderedByParent) continue;
				inlineExclusions.push({ from, to });
				if (isActive) continue;
				add(
					from,
					to,
					Decoration.replace({ widget: new InlineMathWidget(lineText.slice(range.from + 1, range.to - 1), from) }),
				);
			}
			for (const range of collectObsidianInlineRanges(lineText)) {
				const from = line.from + range.from;
				const to = line.from + range.to;
				const renderedByParent = renderedInlineRanges.some((item) => from >= item.from && to <= item.to);
				if (renderedByParent) continue;
				inlineExclusions.push({ from, to });
				if (isActive) continue;
				add(
					from,
					to,
					range.kind === 'comment'
						? Decoration.replace({})
						: Decoration.replace({ widget: new InlineMarkdownWidget(lineText.slice(range.from, range.to), from) }),
				);
			}
		}
		const overlapsExcluded = (from: number, to: number) =>
			inlineExclusions.some((range) => from < range.to && to > range.from);
		const references = new Map<string, LinkDefinition>();
		tree.iterate({
			enter: (node) => {
				if (node.name !== 'LinkReference') return;
				const label = node.node.getChild('LinkLabel');
				const destination = node.node.getChild('URL');
				if (label && destination) {
					const title = node.node.getChild('LinkTitle');
					references.set(normalizeReferenceLabel(state.sliceDoc(label.from + 1, label.to - 1)), {
						href: markdownDestination(state.sliceDoc(destination.from, destination.to)),
						...(title ? { title: markdownLinkTitle(state.sliceDoc(title.from, title.to)) } : {}),
					});
				}
				return false;
			},
		});
		tree.iterate({
			from: 0,
			to: state.doc.length,
			enter: (node) => {
				if (overlapsExcluded(node.from, node.to)) return;
				const block = blocks.find((item) => node.from < item.to && node.to > item.from);
				if (block) return;
				const line = state.doc.lineAt(node.from);
				const isActive = active.has(line.from);
				if (node.name === 'HorizontalRule') {
					if (!isActive) add(node.from, node.to, Decoration.replace({ widget: new HorizontalRuleWidget(node.from) }));
					return;
				}
				if (isMarkdownHeading(node.name)) {
					const level = node.name.at(-1);
					add(node.from, node.to, Decoration.mark({ class: `cm-live-heading cm-live-h${level}` }));
					if (!isActive) {
						const headerMark = node.node.getChild('HeaderMark');
						if (headerMark) {
							let contentStart = headerMark.to;
							while (contentStart < node.to && /\s/.test(state.sliceDoc(contentStart, contentStart + 1)))
								contentStart += 1;
							if (contentStart > headerMark.to) add(headerMark.to, contentStart, Decoration.replace({}));
						}
					}
					return;
				}
				if (node.name === 'Link') {
					if (!isActive) {
						const destination = node.node.getChild('URL');
						let resolved: ResolvedLink | undefined;
						if (!destination) {
							const marks = node.node.getChildren('LinkMark');
							const labelStart = marks[0]?.to ?? node.from + 1;
							const labelEnd = marks[1]?.from ?? labelStart;
							const label = state.sliceDoc(labelStart, labelEnd);
							const referenceLabel = node.node.getChild('LinkLabel');
							const key = normalizeReferenceLabel(
								referenceLabel ? state.sliceDoc(referenceLabel.from + 1, referenceLabel.to - 1) || label : label,
							);
							const definition = references.get(key);
							if (definition) resolved = { ...definition, label };
						}
						add(
							node.from,
							node.to,
							Decoration.replace({ widget: new LinkWidget(state.sliceDoc(node.from, node.to), node.from, resolved) }),
						);
					} else add(node.from, node.to, Decoration.mark({ class: 'cm-live-link' }));
					return false;
				}
				if (node.name === 'Autolink') {
					if (!isActive)
						add(
							node.from,
							node.to,
							Decoration.replace({ widget: new LinkWidget(state.sliceDoc(node.from, node.to), node.from) }),
						);
					else add(node.from, node.to, Decoration.mark({ class: 'cm-live-link' }));
					return false;
				}
				if (node.name === 'LinkReference') {
					if (!isActive) add(node.from, node.to, Decoration.replace({}));
					return false;
				}
				if (node.name === 'URL') {
					if (!isActive)
						add(
							node.from,
							node.to,
							Decoration.replace({ widget: new LinkWidget(state.sliceDoc(node.from, node.to), node.from) }),
						);
					else add(node.from, node.to, Decoration.mark({ class: 'cm-live-link' }));
					return false;
				}
				if (node.name === 'Strikethrough') {
					add(node.from, node.to, Decoration.mark({ class: 'cm-live-strike' }));
					return;
				}
				if (
					node.name === 'StrongEmphasis' ||
					node.name === 'Emphasis' ||
					node.name === 'InlineCode' ||
					node.name === 'Image'
				) {
					if (node.name === 'Image' && !isActive) {
						add(
							node.from,
							node.to,
							Decoration.replace({ widget: new ImageWidget(state.sliceDoc(node.from, node.to), node.from) }),
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
					node.name === 'StrikethroughMark' ||
					node.name === 'QuoteMark' ||
					node.name === 'ListMark'
				) {
					if (!isActive && node.name === 'QuoteMark') {
						add(node.from, node.to, Decoration.replace({}));
					} else if (!isActive && node.name === 'ListMark') {
						add(
							node.from,
							node.to,
							Decoration.replace({ widget: new ListMarkerWidget(state.sliceDoc(node.from, node.to), node.from) }),
						);
					} else if (!isActive) add(node.from, node.to, Decoration.replace({}));
				}
			},
		});
		return Decoration.set(
			decorations.map((item) => item.value.range(item.from, item.to)),
			true,
		);
	} catch {
		return Decoration.none;
	}
}

export const livePreviewField = StateField.define<DecorationSet>({
	create: buildLivePreviewDecorations,
	update(decorations, transaction) {
		return transaction.docChanged ||
			transaction.selection ||
			syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
			? buildLivePreviewDecorations(transaction.state)
			: decorations;
	},
	provide: (field) => EditorView.decorations.from(field),
});

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

export function createMarkdownLivePreview(
	parent: HTMLElement,
	value: string,
	options: MarkdownLivePreviewOptions,
): EditorView {
	localStorage.setItem('wysiwygMode', 'true');
	const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
	const pendingImageRanges = new Map<number, { from: number; to: number; empty: boolean }>();
	let nextImagePasteId = 0;
	const clipboardHandlers = EditorView.domEventHandlers({
		paste(event, view) {
			if ((event.target as HTMLElement | null)?.closest('.cm-live-table textarea')) return false;
			const image = [...(event.clipboardData?.files ?? [])].find((file) => file.type.startsWith('image/'));
			if (image) {
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
			}

			const text = clipboardText(event);
			if (!text) return false;
			event.preventDefault();
			const selection = view.state.selection.main;
			const insert = prepareClipboardText(
				text,
				selection.from > 0 ? view.state.sliceDoc(selection.from - 1, selection.from) : '',
				selection.to < view.state.doc.length ? view.state.sliceDoc(selection.to, selection.to + 1) : '',
			);
			view.dispatch({
				changes: { from: selection.from, to: selection.to, insert },
				selection: { anchor: selection.from + insert.length },
				annotations: Transaction.userEvent.of('input.paste'),
				scrollIntoView: true,
			});
			view.focus();
			return true;
		},
	});
	const state = EditorState.create({
		doc: value,
		extensions: [
			markdownLanguageSupport,
			syntaxHighlighting(markdownLivePreviewHighlightStyle),
			livePreviewField,
			clipboardHandlers,
			EditorView.clipboardInputFilter.of(normalizeClipboardText),
			EditorView.lineWrapping,
			EditorView.theme(
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
			),
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
