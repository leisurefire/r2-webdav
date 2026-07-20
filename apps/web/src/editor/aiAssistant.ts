import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
	ArrowUp,
	Bold,
	Check,
	Code,
	Italic,
	MessageSquareText,
	RotateCcw,
	Sigma,
	Sparkles,
	WandSparkles,
	X,
	createElement,
	type IconNode,
} from 'lucide';
import { aiModelForAction, api, type AiAction } from '../api/client';
import { clearAiReview, markNewContent, showAiReview, toggleMarkdownWrap } from './markdownLivePreview';
import { renderMarkdown } from './markdownRenderer';

type Locale = 'en' | 'zh';

const AI_ICONS: Record<string, IconNode> = {
	'arrow-up': ArrowUp,
	bold: Bold,
	check: Check,
	code: Code,
	italic: Italic,
	'message-square-text': MessageSquareText,
	'rotate-ccw': RotateCcw,
	sigma: Sigma,
	sparkles: Sparkles,
	'wand-sparkles': WandSparkles,
	x: X,
};

// Replace icons only inside the given subtree: calling the global createIcons()
// with a partial icon set warns about every other data-lucide element on the page.
function paintIcons(root: ParentNode): void {
	root.querySelectorAll<HTMLElement>('[data-lucide]').forEach((element) => {
		const node = AI_ICONS[element.dataset.lucide ?? ''];
		if (!node) return;
		element.replaceWith(createElement(node));
	});
}

export function normalizeAiMarkdown(value: string): string {
	const trimmed = value.trim();
	const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
	return (fenced?.[1] ?? trimmed).replaceAll('\r', '');
}

/** Extract a leading "# Title" from generated Markdown so it can drive the note title. */
export function splitAiTitle(value: string): { title: string; body: string } | null {
	const match = /^#\s+(.+?)\s*#*\s*(?:\r?\n+|$)([\s\S]*)$/.exec(value.trim());
	if (!match) return null;
	const title = match[1].trim();
	if (!title) return null;
	return { title, body: match[2].replace(/^\s*\n/, '').trimEnd() };
}

interface AiRange {
	from: number;
	to: number;
}

export interface MarkdownAiOptions {
	onError: (error: unknown) => void;
	onTitleChange?: (title: string) => void;
}

const FORMAT_BUTTONS: Array<{ id: string; marker: string; icon: string; zh: string; en: string }> = [
	{ id: 'bold', marker: '**', icon: 'bold', zh: '粗体', en: 'Bold' },
	{ id: 'italic', marker: '*', icon: 'italic', zh: '斜体', en: 'Italic' },
	{ id: 'code', marker: '`', icon: 'code', zh: '行内代码', en: 'Inline code' },
	{ id: 'formula', marker: '$', icon: 'sigma', zh: '公式', en: 'Formula' },
];

/** How much of [from, to) is wrapped by paired markers: none, partially, or fully. */
function markerCoverage(view: EditorView, from: number, to: number, marker: string): 'none' | 'partial' | 'full' {
	const doc = view.state.doc.toString();
	const char = marker === '**' ? '\\*' : marker === '`' ? '`' : marker === '$' ? '\\$' : '\\*';
	const run = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const paired = new RegExp(`(?<!${char})${run}(?!${char})([^\\n]+?)(?<!${char})${run}(?!${char})`, 'g');
	let covered = 0;
	let match: RegExpExecArray | null;
	while ((match = paired.exec(doc))) {
		const start = Math.max(match.index, from);
		const end = Math.min(match.index + match[0].length, to);
		if (end > start) covered += end - start;
	}
	if (covered >= to - from) return 'full';
	return covered > 0 ? 'partial' : 'none';
}

export function bindMarkdownAiAssistant(
	view: EditorView,
	host: HTMLElement,
	locale: Locale,
	options: MarkdownAiOptions,
): () => void {
	const zh = locale === 'zh';
	const t = (zhText: string, enText: string): string => (zh ? zhText : enText);
	const onError = options.onError;
	let panel: HTMLElement | null = null;
	let toolbar: HTMLElement | null = null;
	let trackedSelection: (AiRange & { text: string }) | null = null;

	let syncEmptyPrompt = () => {};
	const removePanel = () => {
		panel?.remove();
		panel = null;
		syncEmptyPrompt();
	};
	const removeToolbar = () => {
		toolbar?.remove();
		toolbar = null;
	};

	const openPanel = (action: AiAction, requestText: string, range: AiRange, presetInstruction = '') => {
		removeToolbar();
		removePanel();
		panel = document.createElement('div');
		panel.className = 'ai-panel';
		const actionLabel = {
			generate: t('AI 写作', 'Write with AI'),
			summarize: t('AI 总结', 'Summarize'),
			polish: t('AI 润色', 'Polish'),
			rewrite: t('AI 修改', 'Edit with AI'),
		}[action];
		panel.innerHTML = `<div class="ai-panel-shell ai-shimmer-border">
			<header class="ai-panel-head">
				<span class="ai-mark"><i data-lucide="sparkles"></i></span>
				<span class="ai-panel-title">${actionLabel}</span>
				<span class="ai-panel-model">${aiModelForAction(action)}</span>
				<span class="toolbar-spacer"></span>
				<button class="row-action" type="button" data-ai-close aria-label="${t('关闭', 'Close')}"><i data-lucide="x"></i></button>
			</header>
			<div class="ai-instruction-row" data-ai-form>
				<textarea class="ai-instruction" data-ai-instruction rows="1" aria-label="${t('告诉 AI 你想写什么', 'Tell AI what you want')}" placeholder="${t('告诉 AI 你想做什么…', 'Tell AI what to do…')}"></textarea>
				<button class="ai-send" type="button" aria-label="${t('生成', 'Generate')}" title="${t('生成', 'Generate')}"><i data-lucide="arrow-up"></i></button>
			</div>
			<div class="ai-result" data-ai-result hidden></div>
			<footer class="ai-panel-actions" data-ai-actions hidden>
				<button class="row-action" type="button" data-ai-edit title="${t('重新编辑要求', 'Edit request')}" aria-label="${t('重新编辑要求', 'Edit request')}"><i data-lucide="rotate-ccw"></i></button>
				<button class="button" type="button" data-ai-undo hidden>${t('撤销', 'Undo')}</button><button class="button" type="button" data-ai-insert-below hidden>${t('在下面插入', 'Insert below')}</button>
				<span class="toolbar-spacer"></span>
				<button class="button primary" type="button" data-ai-main></button>
			</footer>
		</div>`;
		// Mount on body with fixed positioning so note-compose overflow/CM stacking
		// cannot swallow pointer or keyboard events inside the instruction box.
		document.body.append(panel);
		paintIcons(panel);
		const placePanel = () => {
			if (!panel) return;
			const mobile = window.matchMedia('(max-width: 720px)').matches;
			const hostRect = host.getBoundingClientRect();
			const cursorCoords = view.coordsAtPos(range.from);
			const shellWidth = Math.min(640, Math.max(280, hostRect.width - 24));
			if (mobile) {
				panel.style.left = '8px';
				panel.style.right = '8px';
				panel.style.width = 'auto';
				panel.style.top = 'auto';
				panel.style.bottom = `calc(10px + env(safe-area-inset-bottom, 0px))`;
				return;
			}
			panel.style.right = 'auto';
			panel.style.width = `${shellWidth}px`;
			panel.style.bottom = 'auto';
			const maxHeight = Math.min(window.innerHeight * 0.56, 460);
			const preferredLeft = cursorCoords
				? cursorCoords.left
				: hostRect.left + 12;
			panel.style.left = `${Math.max(12, Math.min(preferredLeft, window.innerWidth - shellWidth - 12))}px`;
			const isReviewAction = action === 'polish' || action === 'rewrite';
			let top: number;
			if (cursorCoords) {
				top = isReviewAction
					? Math.max(12, cursorCoords.top - panel.offsetHeight - 10)
					: cursorCoords.bottom + 10;
				if (!isReviewAction && top + maxHeight > window.innerHeight - 12)
					top = Math.max(12, cursorCoords.top - maxHeight - 10);
			} else {
				top = Math.max(12, hostRect.bottom - maxHeight - 18);
			}
			panel.style.top = `${Math.max(12, Math.min(top, window.innerHeight - 120))}px`;
		};
		placePanel();
		// Keep editor focus out of the way while typing instructions.
		panel.addEventListener('pointerdown', (event) => event.stopPropagation());
		panel.addEventListener('mousedown', (event) => event.stopPropagation());

		const form = panel.querySelector<HTMLElement>('[data-ai-form]')!;
		const input = panel.querySelector<HTMLTextAreaElement>('[data-ai-instruction]')!;
		const resultNode = panel.querySelector<HTMLElement>('[data-ai-result]')!;
		const actionsNode = panel.querySelector<HTMLElement>('[data-ai-actions]')!;
		const mainButton = panel.querySelector<HTMLButtonElement>('[data-ai-main]')!;
		const editButton = panel.querySelector<HTMLButtonElement>('[data-ai-edit]')!;
		const undoButton = panel.querySelector<HTMLButtonElement>('[data-ai-undo]')!;
		const insertBelowButton = panel.querySelector<HTMLButtonElement>('[data-ai-insert-below]')!;
		input.value = presetInstruction;

		type Stage = 'input' | 'busy' | 'done';
		let stage: Stage = 'input';
		let result = '';
		let streamText = '';
		let controller: AbortController | null = null;
		let accepted = false;
		let review: { insertedFrom: number; undoFrom: number; undoTo: number; original: string } | null = null;

		const padToSameLines = (source: string, generated: string): [string, string] => {
			const sourceLines = source.split('\n').length;
			const generatedLines = generated.split('\n').length;
			if (sourceLines === generatedLines) return [source, generated];
			const pad = (value: string, count: number) => value + '\n'.repeat(Math.max(0, count - value.split('\n').length));
			const total = Math.max(sourceLines, generatedLines);
			return [pad(source, total), pad(generated, total)];
		};

		const setStage = (next: Stage) => {
			stage = next;
			form.hidden = next !== 'input';
			resultNode.hidden = next === 'input';
			actionsNode.hidden = next === 'input';
			editButton.hidden = next !== 'done';
			panel?.classList.toggle('busy', next === 'busy');
			if (next === 'busy') {
				mainButton.disabled = false;
				mainButton.innerHTML = `<i data-lucide="x"></i><span>${t('终止', 'Stop')}</span>`;
			} else if (next === 'done') {
				mainButton.disabled = false;
				mainButton.innerHTML = `<i data-lucide="check"></i><span>${action === 'generate' || action === 'summarize' ? t('在下方插入', 'Insert below') : t('接受', 'Accept')}</span>`;
			}
			paintIcons(actionsNode);
		};

		const close = () => {
			controller?.abort();
			clearAiReview(view);
			removePanel();
			view.focus();
		};

		const showResult = (value: string) => {
			try {
				resultNode.innerHTML = `<article class="ai-markdown-preview">${renderMarkdown(value)}</article>`;
			} catch {
				// Partial streams can briefly fail to parse; keep plain text so tokens still show.
				resultNode.textContent = value;
			}
			resultNode.scrollTop = resultNode.scrollHeight;
		};

		const generate = async () => {
			const request = input.value.trim() || requestText;
			if (!request) return;
			controller?.abort();
			controller = new AbortController();
			result = '';
			streamText = '';
			setStage('busy');
			resultNode.innerHTML = `<div class="ai-thinking"><i data-lucide="sparkles"></i><span>${t('正在生成…', 'Writing…')}</span></div>`;
			paintIcons(resultNode);
			try {
				await api.ai(
					{
						model: aiModelForAction(action),
						action,
						text: requestText || request,
						instruction: input.value.trim() || undefined,
						context: view.state.doc.toString(),
					},
					(token) => {
						streamText += token;
						showResult(normalizeAiMarkdown(streamText));
					},
					controller.signal,
				);
				result = normalizeAiMarkdown(streamText);
				if (!result) throw new Error(t('AI 没有返回内容', 'AI returned no content'));
				if (action === 'polish' || action === 'rewrite') {
					const [paddedSource, paddedGenerated] = padToSameLines(requestText, result);
					const lineCount = paddedGenerated.split('\n').length;
					const original = view.state.sliceDoc(range.from, range.to);
					view.dispatch({
						changes: { from: range.from, to: range.to, insert: `${paddedSource}\n${paddedGenerated}` },
						annotations: Transaction.userEvent.of('input'),
					});
					review = {
						insertedFrom: range.from + paddedSource.length + 1,
						undoFrom: range.from,
						undoTo: range.from + paddedSource.length + 1 + paddedGenerated.length,
						original,
					};
					showAiReview(view, { deletedFrom: range.from, insertedFrom: review.insertedFrom, lineCount });
					resultNode.innerHTML = `<div class="ai-review-note">${t('已按照你的要求进行了更改。', 'Done. Changes applied as requested.')}</div>`;
				} else {
					showResult(result);
				}
				setStage('done');
			} catch (error) {
				if (controller.signal.aborted) return;
				resultNode.innerHTML = `<div class="ai-error">${t('生成失败，请重试', 'Generation failed. Please retry.')}</div>`;
				setStage('done');
				editButton.hidden = false;
				onError(error);
			}
		};

		panel.querySelector('[data-ai-form] .ai-send')?.addEventListener('click', () => void generate());
		form.addEventListener('mousedown', (event) => {
			if (event.target === input) return;
			// Clicking the instruction row chrome should keep the textarea focused for typing.
			if ((event.target as HTMLElement | null)?.closest('button')) return;
			event.preventDefault();
			input.focus({ preventScroll: true });
		});
		const autosize = () => {
			input.style.height = 'auto';
			input.style.height = Math.min(input.scrollHeight, 132) + 'px';
		};
		input.addEventListener('input', autosize);
		autosize();
		input.addEventListener('keydown', (event) => {
			event.stopPropagation();
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				void generate();
			}
		});
		input.addEventListener('keyup', (event) => event.stopPropagation());
		input.addEventListener('keypress', (event) => event.stopPropagation());
		editButton.addEventListener('click', () => {
			clearAiReview(view);
			if (review) {
				view.dispatch({
					changes: { from: review.undoFrom, to: review.undoTo, insert: review.original },
					annotations: Transaction.userEvent.of('input'),
				});
				review = null;
			}
			result = '';
			streamText = '';
			setStage('input');
			input.focus();
		});
		mainButton.addEventListener('click', () => {
			if (stage === 'busy') {
				controller?.abort();
				setStage('input');
				return;
			}
			if (stage !== 'done') return;
			if (review) {
				// Accept: keep only the generated lines.
				view.dispatch({
					changes: { from: review.undoFrom, to: review.undoTo, insert: result },
					annotations: Transaction.userEvent.of('input'),
				});
				clearAiReview(view);
				markNewContent(view, review.undoFrom, review.undoFrom + result.length);
				review = null;
				close();
				return;
			}
			let value = result;
			let title: string | null = null;
			if (action === 'generate') {
				const split = splitAiTitle(result);
				if (split) {
					title = split.title;
					value = split.body;
				}
			}
			const insertAt = action === 'summarize' ? range.to : range.from;
			const replaceTo = action === 'summarize' || action === 'generate' ? insertAt : range.to;
			const prefix = action === 'summarize' && insertAt > 0 ? '\n\n' : '';
			const inserted = `${prefix}${value}`;
			view.dispatch({
				changes: { from: insertAt, to: replaceTo, insert: inserted },
				selection: { anchor: insertAt + inserted.length },
				annotations: Transaction.userEvent.of('input'),
				scrollIntoView: true,
			});
			markNewContent(view, insertAt, insertAt + inserted.length);
			if (title) options.onTitleChange?.(title);
			close();
		});
		panel.querySelector('[data-ai-close]')?.addEventListener('click', close);
		panel.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				if (review) {
					clearAiReview(view);
					view.dispatch({
						changes: { from: review.undoFrom, to: review.undoTo, insert: review.original },
						annotations: Transaction.userEvent.of('input'),
					});
					review = null;
				}
				close();
			}
		});
		const focusInstruction = () => {
			input.focus({ preventScroll: true });
			// Some browsers move caret back to CodeMirror after the mouseup that opened the panel.
			window.setTimeout(() => {
				if (panel?.isConnected && document.activeElement !== input) input.focus({ preventScroll: true });
			}, 0);
		};
		focusInstruction();
		if ((action === 'generate' && requestText) || (action !== 'generate' && presetInstruction)) void generate();
		placePanel();
		syncEmptyPrompt();
	};
	const showToolbar = () => {
		if (!host.isConnected) return removeToolbar();
		const range = view.state.selection.main;
		if (range.empty) {
			trackedSelection = null;
			return removeToolbar();
		}
		trackedSelection = { from: range.from, to: range.to, text: view.state.sliceDoc(range.from, range.to) };
		const coords = view.coordsAtPos(range.from);
		removeToolbar();
		toolbar = document.createElement('div');
		toolbar.className = 'ai-selection-menu';
		const formatButtons = FORMAT_BUTTONS.map(
			(button) =>
				`<button type="button" data-format="${button.id}" data-marker="${button.marker}" title="${t(button.zh, button.en)}" aria-label="${t(button.zh, button.en)}" aria-pressed="false"><i data-lucide="${button.icon}"></i></button>`,
		).join('');
		toolbar.innerHTML = `
			${formatButtons}
			<span class="ai-menu-divider"></span>
			<span class="ai-menu-badge"><i data-lucide="sparkles"></i></span>
			<button type="button" data-action="summarize">${t('总结', 'Summarize')}</button>
			<button type="button" data-action="polish">${t('润色', 'Polish')}</button>
			<button type="button" data-action="rewrite">${t('修改', 'Edit')}</button>
			<button type="button" data-ask title="${t('让 AI 处理选中文本', 'Ask AI to edit the selection')}" aria-label="${t('让 AI 处理选中文本', 'Ask AI to edit the selection')}"><i data-lucide="message-square-text"></i></button>`;
		if (coords) {
			toolbar.style.left = `${Math.max(8, Math.min(coords.left, innerWidth - 340))}px`;
			toolbar.style.top = `${Math.max(8, coords.top - 48)}px`;
		}
		document.body.append(toolbar);
		paintIcons(toolbar);
		// Highlight a format button only when the whole selection is already wrapped;
		// partial coverage stays neutral and pressing it wraps everything together.
		toolbar.querySelectorAll<HTMLButtonElement>('[data-format]').forEach((button) => {
			const marker = button.dataset.marker ?? '**';
			const active = markerCoverage(view, range.from, range.to, marker) === 'full';
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
			button.addEventListener('mousedown', (event) => {
				event.preventDefault();
				removeToolbar();
				toggleMarkdownWrap(view, marker);
				view.focus();
			});
		});
		toolbar.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) =>
			button.addEventListener('mousedown', (event) => {
				event.preventDefault();
				if (!trackedSelection) return;
				openPanel(button.dataset.action as AiAction, trackedSelection.text, trackedSelection);
			}),
		);
		toolbar.querySelector('[data-ask]')?.addEventListener('mousedown', (event) => {
			event.preventDefault();
			if (!trackedSelection) return;
			openPanel('rewrite', trackedSelection.text, trackedSelection);
		});
	};

	const scheduleToolbar = () => requestAnimationFrame(showToolbar);
	view.dom.addEventListener('mouseup', scheduleToolbar);
	view.dom.addEventListener('keyup', scheduleToolbar);
	view.dom.addEventListener('blur', () =>
		window.setTimeout(() => {
			if (!toolbar?.matches(':hover') && !toolbar?.contains(document.activeElement)) removeToolbar();
		}, 120),
	);
	window.addEventListener('scroll', removeToolbar, { capture: true, passive: true });

	// Empty-document prompt: placeholder text plus a space shortcut that opens the AI panel.
	const emptyPrompt = document.createElement('button');
	emptyPrompt.type = 'button';
	emptyPrompt.className = 'ai-empty-prompt';
	emptyPrompt.innerHTML = `<i data-lucide="wand-sparkles"></i><span>${t('开始创作，或者按下空格来唤起AI输入框', 'Start writing, or press Space to ask AI')}</span>`;
	host.append(emptyPrompt);
	paintIcons(emptyPrompt);
	syncEmptyPrompt = () => emptyPrompt.classList.toggle('visible', view.state.doc.length === 0 && !panel);
	syncEmptyPrompt();
	// doc changes (AI insert, select-all + delete) do not fire DOM 'input'; the caller wires this sync into the editor's onChange.
	view.dom.addEventListener('input', syncEmptyPrompt);
	emptyPrompt.addEventListener('click', () => openPanel('generate', '', { from: 0, to: 0 }));
	view.dom.addEventListener('keydown', (event) => {
		if (event.key !== ' ' || view.state.doc.length !== 0 || panel) return;
		event.preventDefault();
		openPanel('generate', '', { from: 0, to: 0 });
	});
	return () => syncEmptyPrompt();
}
