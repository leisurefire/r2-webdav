import type { EditorView } from '@codemirror/view';
import type { MarkdownHeading } from '../editor/markdownRenderer';
import { showEditorHighlight } from '../editor/editorHighlights';

export interface NoteOutlineOptions {
	outline: HTMLElement;
	compose: HTMLElement;
	view: EditorView;
	locale: 'en' | 'zh';
	headingPosition: (id: string) => number | null;
	scrollToHeading: (id: string) => void;
}

export interface NoteOutlineHandle {
	update: (headings: MarkdownHeading[]) => void;
	destroy: () => void;
}

function centerInScrollable(container: HTMLElement, target: HTMLElement | null | undefined): void {
	if (!target || container.scrollHeight <= container.clientHeight + 1) return;
	const containerRect = container.getBoundingClientRect();
	const targetRect = target.getBoundingClientRect();
	const top =
		container.scrollTop + (targetRect.top - containerRect.top) - (container.clientHeight - targetRect.height) / 2;
	container.scrollTop = Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight));
}

export function mountNoteOutline(options: NoteOutlineOptions): NoteOutlineHandle {
	const { outline, compose, view } = options;
	const scroller = view.scrollDOM;
	let bindings: AbortController | null = null;
	let settleTimer: number | null = null;

	const destroyBindings = () => {
		bindings?.abort();
		bindings = null;
		if (settleTimer !== null) window.clearTimeout(settleTimer);
		settleTimer = null;
	};

	const update = (headings: MarkdownHeading[]) => {
		destroyBindings();
		const hasOutline = headings.length > 0;
		compose.classList.toggle('has-outline', hasOutline);
		outline.classList.toggle('empty', !hasOutline);
		compose.classList.remove('outline-collapsed');
		outline.classList.remove('collapsed', 'open');
		if (!hasOutline) {
			outline.replaceChildren();
			return;
		}

		bindings = new AbortController();
		const signal = bindings.signal;
		const rail = document.createElement('div');
		rail.className = 'note-outline-rail';
		rail.setAttribute('role', 'navigation');
		rail.setAttribute('aria-label', options.locale === 'zh' ? '章节位置' : 'Section positions');
		const panel = document.createElement('div');
		panel.className = 'note-outline-panel';
		panel.setAttribute('role', 'menu');
		const markButtons: HTMLButtonElement[] = [];
		const itemButtons: HTMLButtonElement[] = [];
		const anchors = headings
			.map((heading) => {
				const from = options.headingPosition(heading.id);
				return from === null ? null : { id: heading.id, from };
			})
			.filter((item): item is { id: string; from: number } => item !== null);
		let lastActiveId: string | null = null;
		let pinnedId: string | null = null;
		let programmaticTop = 0;
		let scrollSettled = true;

		const setActive = (activeId: string | null) => {
			for (const button of markButtons) button.classList.toggle('active', button.dataset.headingId === activeId);
			for (const button of itemButtons) button.classList.toggle('active', button.dataset.headingId === activeId);
			if (activeId === lastActiveId) return;
			lastActiveId = activeId;
			centerInScrollable(
				rail,
				markButtons.find((button) => button.dataset.headingId === activeId),
			);
			centerInScrollable(
				panel,
				itemButtons.find((button) => button.dataset.headingId === activeId),
			);
		};
		const refreshActive = () => {
			if (!anchors.length) return setActive(null);
			if (pinnedId !== null) return setActive(pinnedId);
			const viewportTop = scroller.scrollTop + 36;
			let activeId = anchors[0]!.id;
			for (const anchor of anchors) {
				if (view.lineBlockAt(anchor.from).top <= viewportTop) activeId = anchor.id;
				else break;
			}
			setActive(activeId);
		};
		const pinSection = (id: string) => {
			pinnedId = id;
			programmaticTop = scroller.scrollTop;
			scrollSettled = false;
			if (settleTimer !== null) window.clearTimeout(settleTimer);
			settleTimer = window.setTimeout(() => {
				scrollSettled = true;
			}, 140);
		};
		const activate = (id: string, button: HTMLButtonElement, closePanel: boolean) => {
			options.scrollToHeading(id);
			pinSection(id);
			const from = options.headingPosition(id);
			if (from !== null) {
				const line = view.state.doc.lineAt(from);
				showEditorHighlight(view, line.from, line.to, 'transient');
			}
			button.classList.remove('section-pulse');
			void button.offsetWidth;
			button.classList.add('section-pulse');
			outline.classList.toggle('open', !closePanel && matchMedia('(hover: none)').matches);
			refreshActive();
		};

		for (const heading of headings) {
			const mark = document.createElement('button');
			mark.type = 'button';
			mark.className = 'note-outline-mark';
			mark.dataset.headingId = heading.id;
			mark.style.setProperty('--outline-level', String(heading.level));
			mark.title = heading.text;
			mark.setAttribute('aria-label', heading.text);
			mark.addEventListener(
				'click',
				(event) => {
					event.stopPropagation();
					activate(heading.id, mark, false);
				},
				{ signal },
			);
			markButtons.push(mark);
			rail.append(mark);

			const item = document.createElement('button');
			item.type = 'button';
			item.className = 'note-outline-item';
			item.dataset.headingId = heading.id;
			item.style.setProperty('--outline-level', String(heading.level));
			item.setAttribute('role', 'menuitem');
			const label = document.createElement('span');
			label.textContent = heading.text;
			item.append(label);
			item.addEventListener(
				'click',
				(event) => {
					event.stopPropagation();
					activate(heading.id, item, true);
				},
				{ signal },
			);
			itemButtons.push(item);
			panel.append(item);
		}
		outline.replaceChildren(rail, panel);

		const syncOutlineScroll = () => {
			centerInScrollable(
				rail,
				markButtons.find((button) => button.classList.contains('active')),
			);
			centerInScrollable(
				panel,
				itemButtons.find((button) => button.classList.contains('active')),
			);
		};
		const openPanel = () => {
			outline.classList.add('open');
			requestAnimationFrame(syncOutlineScroll);
		};
		outline.addEventListener('mouseenter', openPanel, { signal });
		outline.addEventListener(
			'mouseleave',
			() => {
				if (!matchMedia('(hover: none)').matches) outline.classList.remove('open');
			},
			{ signal },
		);
		rail.addEventListener('focusin', openPanel, { signal });
		panel.addEventListener(
			'focusout',
			() => {
				if (!outline.matches(':hover') && !outline.contains(document.activeElement)) outline.classList.remove('open');
			},
			{ signal },
		);
		rail.addEventListener(
			'click',
			(event) => {
				if (!(event.target instanceof Element) || event.target.closest('.note-outline-mark')) return;
				if (matchMedia('(hover: none)').matches) outline.classList.toggle('open');
			},
			{ signal },
		);

		const onScroll = () => {
			if (pinnedId !== null && scroller.scrollTop !== programmaticTop) {
				if (scrollSettled) pinnedId = null;
				else {
					programmaticTop = scroller.scrollTop;
					if (settleTimer !== null) window.clearTimeout(settleTimer);
					settleTimer = window.setTimeout(() => {
						scrollSettled = true;
					}, 140);
				}
			}
			refreshActive();
		};
		const releasePinnedSection = () => {
			if (pinnedId === null) return;
			pinnedId = null;
			refreshActive();
		};
		scroller.addEventListener('scroll', onScroll, { passive: true, signal });
		scroller.addEventListener('wheel', releasePinnedSection, { passive: true, signal });
		scroller.addEventListener('touchmove', releasePinnedSection, { passive: true, signal });
		document.addEventListener(
			'pointerdown',
			(event) => {
				if (event.target instanceof Node && !outline.contains(event.target)) outline.classList.remove('open');
			},
			{ signal },
		);
		refreshActive();
	};

	return {
		update,
		destroy: () => {
			destroyBindings();
			outline.replaceChildren();
			compose.classList.remove('has-outline');
		},
	};
}
