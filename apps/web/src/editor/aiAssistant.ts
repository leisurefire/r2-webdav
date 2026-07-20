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
import { toggleMarkdownWrap } from './markdownLivePreview';
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
	const match = /^#\s+(.+?)\s*#*\s*(?:\n+|$)([\s\S]*)$/.exec(value.trim());
	if (!match) return null;
	return { title: match[1].trim(), body: match[2].trim() };
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

	const removePanel = () => {
		panel?.remove();
		panel = null;
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
		const showInstruction = action === 'generate' || action === 'rewrite';
		panel.innerHTML = `<div class="ai-panel-shell ai-shimmer-border">
			<header class="ai-panel-head">
				<span class="ai-mark"><i data-lucide="sparkles"></i></span>
				<span class="ai-panel-title">${actionLabel}</span>
				<span class="ai-panel-model">${aiModelForAction(action)}</span>
				<span class="toolbar-spacer"></span>
				<button class="row-action" type="button" data-ai-close aria-label="${t('关闭', 'Close')}"><i data-lucide="x"></i></button>
			</header>
			${
				showInstruction
					? `<form class="ai-instruction-row" data-ai-form>
						<input class="ai-instruction" data-ai-instruction aria-label="${t('告诉 AI 你想写什么', 'Tell AI what you want')}" placeholder="${action === 'generate' ? t('告诉 AI 你想写什么…', 'Tell AI what to write…') : t('告诉 AI 你想怎样修改…', 'Tell AI how to edit…')}">
						<button class="ai-send" type="submit" aria-label="${t('生成', 'Generate')}" title="${t('生成', 'Generate')}"><i data-lucide="arrow-up"></i></button>
					</form>`
					: ''
			}
			<div class="ai-result" data-ai-result>
				<div class="ai-thinking"><i data-lucide="sparkles"></i><span>${showInstruction ? t('输入要求后按回车生成', 'Type a request and press Enter') : t('准备生成…', 'Preparing…')}</span></div>
			</div>
			<footer class="ai-panel-actions">
				<button class="button" type="button" data-ai-retry hidden><i data-lucide="rotate-ccw"></i><span>${t('重新生成', 'Retry')}</span></button>
				<span class="toolbar-spacer"></span>
				<button class="button primary" type="button" data-ai-apply disabled><i data-lucide="check"></i><span>${
					action === 'generate' || action === 'summarize' ? t('插入', 'Insert') : t('替换选区', 'Replace selection')
				}</span></button>
			</footer>
		</div>`;
		host.append(panel);
		paintIcons(panel);
		// Desktop: anchor the panel to the cursor/selection like Notion does.
		// Mobile CSS pins it to the bottom of the editor instead.
		const cursorCoords = view.coordsAtPos(range.from);
		const hostRect = host.getBoundingClientRect();
		if (cursorCoords && !window.matchMedia('(max-width: 720px)').matches) {
			const shellWidth = Math.min(640, hostRect.width - 24);
			panel.style.left = `${Math.max(12, Math.min(cursorCoords.left - hostRect.left, hostRect.width - shellWidth - 12))}px`;
			panel.style.bottom = 'auto';
			const maxHeight = Math.min(hostRect.height * 0.56, 460);
			let top = cursorCoords.bottom - hostRect.top + 10;
			if (top + maxHeight > hostRect.height - 12) top = Math.max(12, cursorCoords.top - hostRect.top - maxHeight - 10);
			panel.style.top = `${top}px`;
		}

		const resultNode = panel.querySelector<HTMLElement>('[data-ai-result]')!;
		const apply = panel.querySelector<HTMLButtonElement>('[data-ai-apply]')!;
		const retry = panel.querySelector<HTMLButtonElement>('[data-ai-retry]')!;
		const instruction = panel.querySelector<HTMLInputElement>('[data-ai-instruction]');
		if (instruction && presetInstruction) instruction.value = presetInstruction;
		let result = '';
		let controller: AbortController | null = null;

		const generate = async () => {
			controller?.abort();
			controller = new AbortController();
			result = '';
			apply.disabled = true;
			retry.hidden = true;
			resultNode.innerHTML = `<div class="ai-thinking"><i data-lucide="sparkles"></i><span>${t('正在生成…', 'Writing…')}</span></div>`;
			paintIcons(resultNode);
			try {
				await api.ai(
					{
						model: aiModelForAction(action),
						action,
						text: requestText,
						instruction: instruction?.value.trim() || undefined,
						context: view.state.doc.toString(),
					},
					(token) => {
						result += token;
						resultNode.innerHTML = `<article class="ai-markdown-preview">${renderMarkdown(normalizeAiMarkdown(result))}</article>`;
						resultNode.scrollTop = resultNode.scrollHeight;
					},
					controller.signal,
				);
				result = normalizeAiMarkdown(result);
				if (!result) throw new Error(t('AI 没有返回内容', 'AI returned no content'));
				resultNode.innerHTML = `<article class="ai-markdown-preview">${renderMarkdown(result)}</article>`;
				apply.disabled = false;
				retry.hidden = false;
			} catch (error) {
				if (controller.signal.aborted) return;
				resultNode.innerHTML = `<div class="ai-error">${t('生成失败，请重试', 'Generation failed. Please retry.')}</div>`;
				retry.hidden = false;
				onError(error);
			}
		};

		const close = () => {
			controller?.abort();
			removePanel();
			view.focus();
		};
		panel.querySelector('[data-ai-close]')?.addEventListener('click', close);
		retry.addEventListener('click', () => void generate());
		panel.querySelector('[data-ai-form]')?.addEventListener('submit', (event) => {
			event.preventDefault();
			if (action === 'generate') requestText = instruction?.value.trim() || requestText;
			if (requestText) void generate();
		});
		apply.addEventListener('click', () => {
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
				scrollIntoView: true,
			});
			if (title) options.onTitleChange?.(title);
			close();
		});
		panel.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				close();
			}
		});
		if (instruction) {
			instruction.focus();
			if (action === 'generate' ? Boolean(requestText) : Boolean(presetInstruction)) void generate();
		} else {
			void generate();
		}
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
			<form class="ai-menu-ask" data-ai-ask>
				<input aria-label="${t('让 AI 处理选中文本', 'Ask AI to edit the selection')}" placeholder="${t('让 AI…', 'Ask AI…')}">
				<button type="submit" aria-label="${t('发送', 'Send')}" title="${t('发送', 'Send')}"><i data-lucide="message-square-text"></i></button>
			</form>`;
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
		toolbar.querySelector('[data-ai-ask]')?.addEventListener('submit', (event) => {
			event.preventDefault();
			const input = toolbar?.querySelector<HTMLInputElement>('.ai-menu-ask input');
			const instruction = input?.value.trim();
			if (!instruction || !trackedSelection) return;
			openPanel('rewrite', trackedSelection.text, trackedSelection, instruction);
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
	const syncEmptyPrompt = () => emptyPrompt.classList.toggle('visible', view.state.doc.length === 0);
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
