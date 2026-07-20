import type { EditorView } from '@codemirror/view';
import {
	ArrowUp,
	Bold,
	Check,
	Code,
	Italic,
	MessageSquareText,
	RefreshCw,
	RotateCcw,
	Sigma,
	Sparkles,
	WandSparkles,
	X,
	createIcons,
} from 'lucide';
import { api, type AiModel } from '../api/client';
import { renderMarkdown } from './markdownRenderer';

type AiAction = 'generate' | 'summarize' | 'polish' | 'rewrite';
type Locale = 'en' | 'zh';

const FALLBACK_MODELS: AiModel[] = ['deepseek-v4-flash', 'deepseek-v4-pro', 'kimi-k3'];
const MODEL_KEY = 'r2_ai_model';

function icons(): void {
	createIcons({
		icons: {
			ArrowUp,
			Bold,
			Check,
			Code,
			Italic,
			MessageSquareText,
			RefreshCw,
			RotateCcw,
			Sigma,
			Sparkles,
			WandSparkles,
			X,
		},
	});
}

export function normalizeAiMarkdown(value: string): string {
	const trimmed = value.trim();
	const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
	return (fenced?.[1] ?? trimmed).replaceAll('\r', '');
}

function selectedModel(): AiModel {
	const stored = localStorage.getItem(MODEL_KEY);
	return FALLBACK_MODELS.includes(stored as AiModel) ? (stored as AiModel) : FALLBACK_MODELS[0];
}

function modelOptions(): string {
	const current = selectedModel();
	return FALLBACK_MODELS.map(
		(model) => `<option value="${model}"${model === current ? ' selected' : ''}>${model}</option>`,
	).join('');
}

interface AiRange {
	from: number;
	to: number;
}

export function bindMarkdownAiAssistant(
	view: EditorView,
	host: HTMLElement,
	locale: Locale,
	onError: (error: unknown) => void,
): void {
	const zh = locale === 'zh';
	const t = (zhText: string, enText: string): string => (zh ? zhText : enText);
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

	const applyWrap = (before: string, after: string) => {
		const target = trackedSelection;
		if (!target) return;
		view.dispatch({
			changes: { from: target.from, to: target.to, insert: `${before}${target.text}${after}` },
			selection: { anchor: target.from + before.length, head: target.from + before.length + target.text.length },
			scrollIntoView: true,
		});
		view.focus();
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
				<span class="toolbar-spacer"></span>
				<select class="ai-model" data-ai-model aria-label="${t('模型', 'Model')}">${modelOptions()}</select>
				<button class="row-action" type="button" data-ai-models title="${t('从服务拉取模型', 'Pull models from service')}" aria-label="${t('从服务拉取模型', 'Pull models from service')}"><i data-lucide="refresh-cw"></i></button>
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
		icons();

		const resultNode = panel.querySelector<HTMLElement>('[data-ai-result]')!;
		const apply = panel.querySelector<HTMLButtonElement>('[data-ai-apply]')!;
		const retry = panel.querySelector<HTMLButtonElement>('[data-ai-retry]')!;
		const model = panel.querySelector<HTMLSelectElement>('[data-ai-model]')!;
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
			icons();
			try {
				await api.ai(
					{
						model: model.value as AiModel,
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
		model.addEventListener('change', () => localStorage.setItem(MODEL_KEY, model.value));
		panel.querySelector('[data-ai-models]')?.addEventListener('click', async () => {
			const button = panel!.querySelector<HTMLButtonElement>('[data-ai-models]')!;
			button.disabled = true;
			try {
				const available = await api.aiModels();
				model.replaceChildren(...available.map((id) => new Option(id, id, false, id === model.value)));
				if (!available.length) throw new Error(t('服务未返回可用模型', 'No supported models returned'));
			} catch (error) {
				onError(error);
			} finally {
				button.disabled = false;
			}
		});
		apply.addEventListener('click', () => {
			const insertAt = action === 'summarize' ? range.to : range.from;
			const replaceTo = action === 'summarize' || action === 'generate' ? insertAt : range.to;
			const prefix = action === 'summarize' && insertAt > 0 ? '\n\n' : '';
			const value = `${prefix}${result}`;
			view.dispatch({
				changes: { from: insertAt, to: replaceTo, insert: value },
				selection: { anchor: insertAt + value.length },
				scrollIntoView: true,
			});
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
		toolbar.innerHTML = `
			<button type="button" data-format="bold" title="${t('粗体', 'Bold')}" aria-label="${t('粗体', 'Bold')}"><i data-lucide="bold"></i></button>
			<button type="button" data-format="italic" title="${t('斜体', 'Italic')}" aria-label="${t('斜体', 'Italic')}"><i data-lucide="italic"></i></button>
			<button type="button" data-format="code" title="${t('行内代码', 'Inline code')}" aria-label="${t('行内代码', 'Inline code')}"><i data-lucide="code"></i></button>
			<button type="button" data-format="formula" title="${t('公式', 'Formula')}" aria-label="${t('公式', 'Formula')}"><i data-lucide="sigma"></i></button>
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
		icons();
		toolbar.querySelectorAll<HTMLButtonElement>('[data-format]').forEach((button) =>
			button.addEventListener('mousedown', (event) => {
				event.preventDefault();
				const marks: Record<string, [string, string]> = {
					bold: ['**', '**'],
					italic: ['*', '*'],
					code: ['`', '`'],
					formula: ['$', '$'],
				};
				const [before, after] = marks[button.dataset.format ?? 'bold'] ?? ['**', '**'];
				removeToolbar();
				applyWrap(before, after);
			}),
		);
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
	icons();
	const syncEmptyPrompt = () => emptyPrompt.classList.toggle('visible', view.state.doc.length === 0);
	syncEmptyPrompt();
	view.dom.addEventListener('input', syncEmptyPrompt);
	emptyPrompt.addEventListener('click', () => openPanel('generate', '', { from: 0, to: 0 }));
	view.dom.addEventListener('keydown', (event) => {
		if (event.key !== ' ' || view.state.doc.length !== 0 || panel) return;
		event.preventDefault();
		openPanel('generate', '', { from: 0, to: 0 });
	});
}
