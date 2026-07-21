import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
	ArrowUp,
	Bold,
	Check,
	Code,
	FileText,
	Italic,
	MessageCircle,
	Plus,
	Quote,
	RotateCcw,
	Sigma,
	Sparkles,
	Square,
	TextSelect,
	WandSparkles,
	X,
	createElement,
	type IconNode,
} from 'lucide';
import { aiModelForAction, api, type AiAction, type NoteChatSession } from '../api/client';
import {
	clearAiReview,
	clearSelectionHold,
	holdSelectionHighlight,
	markNewContent,
	showAiReview,
	toggleMarkdownWrap,
} from './markdownLivePreview';
import { buildAiReviewPreview } from './textDiff';
import { renderMarkdown } from './markdownRenderer';

type Locale = 'en' | 'zh';

const AI_ICONS: Record<string, IconNode> = {
	'arrow-up': ArrowUp,
	bold: Bold,
	check: Check,
	code: Code,
	'file-text': FileText,
	italic: Italic,
	'message-circle': MessageCircle,
	plus: Plus,
	quote: Quote,
	'rotate-ccw': RotateCcw,
	sigma: Sigma,
	sparkles: Sparkles,
	square: Square,
	'text-select': TextSelect,
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
	noteTitle?: () => string;
	noteId?: string;
}

/** Controller returned by {@link bindMarkdownAiAssistant}. */
export interface MarkdownAiHandle {
	/** Refresh the empty-document prompt after doc changes that skip DOM `input` events. */
	syncEmptyPrompt: () => void;
	/** Tear down listeners, floating UI, and any in-flight AI panel/review. */
	destroy: () => void;
}

const FORMAT_BUTTONS: Array<{ id: string; marker: string; icon: string; zh: string; en: string }> = [
	{ id: 'bold', marker: '**', icon: 'bold', zh: '粗体', en: 'Bold' },
	{ id: 'italic', marker: '*', icon: 'italic', zh: '斜体', en: 'Italic' },
	{ id: 'code', marker: '`', icon: 'code', zh: '行内代码', en: 'Inline code' },
	{ id: 'formula', marker: '$', icon: 'sigma', zh: '公式', en: 'Formula' },
];

const SUMMARIZE_INSTRUCTION_ZH = '请用简洁的 Markdown 总结选中内容，保留关键信息；可用要点列表。只返回总结正文。';
const SUMMARIZE_INSTRUCTION_EN =
	'Summarize the selection concisely in Markdown. Keep key facts; use a short bullet list when helpful. Return only the summary body.';

const POLISH_INSTRUCTIONS = {
	formal: {
		zh: '请将选中文本润色为更正式、书面的表达，保持原意与 Markdown 结构。只返回润色后的正文。',
		en: 'Polish into a more formal, professional tone while preserving meaning and Markdown structure. Return only the polished body.',
	},
	concise: {
		zh: '请将选中文本润色得更简洁精炼，去掉冗余，保持原意与 Markdown 结构。只返回润色后的正文。',
		en: 'Polish to be more concise and remove redundancy while preserving meaning and Markdown structure. Return only the polished body.',
	},
	witty: {
		zh: '请将选中文本润色得更轻松风趣，增强可读性，保持原意与 Markdown 结构。只返回润色后的正文。',
		en: 'Polish with a lighter, witty tone while preserving meaning and Markdown structure. Return only the polished body.',
	},
} as const;

type PolishStyle = keyof typeof POLISH_INSTRUCTIONS;

/** Split rewrite model output: first short sentence is the status note, rest is Markdown body. */
export function splitRewriteSummary(value: string): { summary: string; body: string } {
	const trimmed = value.trim();
	if (!trimmed) return { summary: '', body: '' };
	const blank = /^(.*?)\n\s*\n([\s\S]*)$/.exec(trimmed);
	if (blank) return { summary: blank[1].trim(), body: blank[2].trim() };
	const lineBreak = trimmed.indexOf('\n');
	if (lineBreak > 0) {
		return { summary: trimmed.slice(0, lineBreak).trim(), body: trimmed.slice(lineBreak + 1).trim() };
	}
	return { summary: '', body: trimmed };
}

export interface AiCitation {
	startLine: number;
	endLine: number;
	index: number;
}

export function parseAiCitations(value: string): { markdown: string; citations: AiCitation[] } {
	const citations: AiCitation[] = [];
	const keys = new Map<string, number>();
	const markdown = value.replace(/\[\[cite:(\d+)(?:-(\d+))?\]\]/gi, (_match, startRaw, endRaw) => {
		const startLine = Math.max(1, Number(startRaw));
		const endLine = Math.max(startLine, Number(endRaw ?? startRaw));
		const key = `${startLine}-${endLine}`;
		let index = keys.get(key);
		if (!index) {
			index = citations.length + 1;
			keys.set(key, index);
			citations.push({ startLine, endLine, index });
		}
		return ` [${index}]`;
	});
	return { markdown, citations };
}

let activeNoteChatClose: (() => void) | null = null;

function bindNoteContextChat(
	view: EditorView,
	host: HTMLElement,
	locale: Locale,
	options: MarkdownAiOptions,
): () => void {
	const root = host.closest<HTMLElement>('.note-editor');
	const trigger = root?.querySelector<HTMLButtonElement>('[data-note-ai-chat]');
	if (!root || !trigger) return () => {};
	const noteId = options.noteId || root.dataset.noteEditorId || 'unknown';
	const zh = locale === 'zh';
	const t = (zhText: string, enText: string): string => (zh ? zhText : enText);
	let panel: HTMLElement | null = null;
	let controller: AbortController | null = null;
	let activeSelectionKey = '';
	const close = () => {
		controller?.abort();
		controller = null;
		panel?.remove();
		panel = null;
		activeSelectionKey = '';
		trigger.classList.remove('active');
		trigger.setAttribute('aria-expanded', 'false');
		if (activeNoteChatClose === close) activeNoteChatClose = null;
	};
	const open = async () => {
		if (panel) return close();
		activeNoteChatClose?.();
		activeNoteChatClose = close;
		const documentText = view.state.doc.toString();
		const selection = view.state.selection.main;
		activeSelectionKey = `${selection.from}:${selection.to}`;
		const hasSelection = !selection.empty;
		const contextText = hasSelection ? view.state.sliceDoc(selection.from, selection.to) : documentText;
		const startLine = hasSelection ? view.state.doc.lineAt(selection.from).number : 1;
		const endLine = hasSelection
			? view.state.doc.lineAt(Math.max(selection.from, selection.to - 1)).number
			: view.state.doc.lines;
		const numberedContext = contextText
			.split('\n')
			.map((line, index) => `${startLine + index}: ${line}`)
			.join('\n');
		const contextLabel = hasSelection
			? t(`已选 ${endLine - startLine + 1} 行`, `${endLine - startLine + 1} selected lines`)
			: options.noteTitle?.() || t('当前便签', 'Current note');
		const contextKey = `${selection.from}:${selection.to}:${documentText.length}:${contextText.slice(0, 80)}`;
		let sessions: NoteChatSession[] = [];
		let session: NoteChatSession = {
			id: crypto.randomUUID(),
			title: t('新对话', 'New chat'),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			contextKey,
			contextLabel,
			messages: [],
		};
		panel = document.createElement('aside');
		panel.className = 'note-ai-chat-panel';
		panel.setAttribute('aria-label', t('AI 对话', 'AI conversation'));
		panel.innerHTML = `<header class="note-ai-chat-head">
			<span class="ai-mark"><i data-lucide="message-circle"></i></span>
			<div class="note-ai-chat-title"><strong>${t('询问 AI', 'Ask AI')}</strong><span>${aiModelForAction('chat')}</span></div>
			<select class="note-ai-history-select" data-chat-history title="${t('历史对话', 'Chat history')}" aria-label="${t('历史对话', 'Chat history')}"></select>
			<button type="button" class="row-action" data-chat-new title="${t('新建对话', 'New chat')}" aria-label="${t('新建对话', 'New chat')}"><i data-lucide="plus"></i></button>
			<button type="button" class="row-action" data-chat-close title="${t('关闭', 'Close')}" aria-label="${t('关闭', 'Close')}"><i data-lucide="x"></i></button>
		</header>
		<div class="note-ai-chat-messages" data-chat-messages><div class="note-ai-chat-welcome">${t('我会仅参考当前提交的便签内容回答，并标注引用来源。', 'I will answer only from the submitted note context and cite the source passages.')}</div></div>
		<div class="note-ai-chat-composer">
			<div class="note-ai-context-chip"><i data-lucide="${hasSelection ? 'text-select' : 'file-text'}"></i><span>${contextLabel}</span></div>
			<div class="note-ai-chat-input-row"><textarea rows="1" data-chat-input placeholder="${t('询问这段内容…', 'Ask about this content…')}" aria-label="${t('向 AI 提问', 'Ask AI')}"></textarea><button type="button" class="ai-send" data-chat-send title="${t('发送', 'Send')}" aria-label="${t('发送', 'Send')}"><i data-lucide="arrow-up"></i></button></div>
		</div>`;
		document.body.append(panel);
		paintIcons(panel);
		trigger.classList.add('active');
		trigger.setAttribute('aria-expanded', 'true');
		const messagesNode = panel.querySelector<HTMLElement>('[data-chat-messages]')!;
		const input = panel.querySelector<HTMLTextAreaElement>('[data-chat-input]')!;
		const send = panel.querySelector<HTMLButtonElement>('[data-chat-send]')!;
		send.disabled = true;
		const historySelect = panel.querySelector<HTMLSelectElement>('[data-chat-history]')!;
		let conversation = session.messages;
		const paintHistory = () => {
			const visible = [session, ...sessions.filter((item) => item.id !== session.id)];
			historySelect.replaceChildren(
				...visible.map(
					(item) => new Option(item.title || t('新对话', 'New chat'), item.id, false, item.id === session.id),
				),
			);
		};
		const citationExcerpt = (citation: AiCitation): string => {
			const lines = documentText.split('\n');
			return lines
				.slice(citation.startLine - 1, citation.endLine)
				.join('\n')
				.trim();
		};
		const jumpToCitation = (citation: AiCitation) => {
			const line = view.state.doc.line(Math.min(view.state.doc.lines, citation.startLine));
			view.dispatch({
				selection: { anchor: line.from },
				effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
			});
			view.focus();
		};
		const renderAnswer = (node: HTMLElement, answer: string) => {
			const parsed = parseAiCitations(answer);
			node.innerHTML = `<article class="ai-markdown-preview">${renderMarkdown(parsed.markdown)}</article>`;
			if (!parsed.citations.length) return;
			const sources = document.createElement('div');
			sources.className = 'note-ai-citations';
			for (const citation of parsed.citations) {
				const excerpt = citationExcerpt(citation);
				if (!excerpt) continue;
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'note-ai-citation';
				button.innerHTML = `<span><i data-lucide="quote"></i>${t('引用', 'Source')} ${citation.index} · ${t('第', 'Lines ')}${citation.startLine}${citation.endLine === citation.startLine ? '' : `-${citation.endLine}`}${zh ? ' 行' : ''}</span><blockquote></blockquote>`;
				button.querySelector('blockquote')!.textContent = excerpt;
				button.addEventListener('click', () => jumpToCitation(citation));
				sources.append(button);
			}
			node.append(sources);
			paintIcons(sources);
		};
		const renderConversation = () => {
			messagesNode.innerHTML = '';
			if (!conversation.length) {
				messagesNode.innerHTML = `<div class="note-ai-chat-welcome">${t('我会仅参考当前提交的便签内容回答，并标注引用来源。', 'I will answer only from the submitted note context and cite the source passages.')}</div>`;
				return;
			}
			for (const message of conversation) {
				const node = document.createElement('div');
				node.className = `note-ai-chat-message ${message.role}`;
				if (message.role === 'user') node.textContent = message.content;
				else renderAnswer(node, message.content);
				messagesNode.append(node);
			}
			messagesNode.scrollTop = messagesNode.scrollHeight;
		};
		const createSession = () => {
			controller?.abort();
			controller = null;
			session = {
				id: crypto.randomUUID(),
				title: t('新对话', 'New chat'),
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				contextKey,
				contextLabel,
				messages: [],
			};
			conversation = session.messages;
			paintHistory();
			renderConversation();
			input.focus();
		};
		const submit = async () => {
			const question = input.value.trim();
			if (!question || controller) return;
			input.value = '';
			input.style.height = '';
			conversation.push({ role: 'user', content: question });
			if (conversation.length === 1) session.title = question.replace(/\s+/g, ' ').slice(0, 36);
			paintHistory();
			const userNode = document.createElement('div');
			userNode.className = 'note-ai-chat-message user';
			userNode.textContent = question;
			const answerNode = document.createElement('div');
			answerNode.className = 'note-ai-chat-message assistant';
			answerNode.innerHTML = `<div class="ai-thinking"><i data-lucide="sparkles"></i><span>${t('正在查找原文…', 'Reading the note…')}</span></div>`;
			messagesNode.append(userNode, answerNode);
			paintIcons(answerNode);
			messagesNode.scrollTop = messagesNode.scrollHeight;
			controller = new AbortController();
			let answer = '';
			try {
				await api.ai(
					{
						model: aiModelForAction('chat'),
						action: 'chat',
						text: question,
						context: numberedContext,
						noteId,
						conversationId: session.id,
						contextKey,
						contextLabel,
					},
					(token) => {
						answer += token;
						renderAnswer(answerNode, answer);
						messagesNode.scrollTop = messagesNode.scrollHeight;
					},
					controller.signal,
				);
				if (!answer.trim()) throw new Error(t('AI 没有返回内容', 'AI returned no content'));
				conversation.push({ role: 'assistant', content: answer });
				renderAnswer(answerNode, answer);
			} catch (error) {
				if (controller?.signal.aborted) return;
				answerNode.innerHTML = `<div class="ai-error">${t('回答失败，请重试', 'Could not answer. Please retry.')}</div>`;
				options.onError(error);
			} finally {
				controller = null;
			}
		};
		paintHistory();
		renderConversation();
		historySelect.addEventListener('change', () => {
			const next = [session, ...sessions].find((item) => item.id === historySelect.value);
			if (!next) return;
			session = next;
			conversation = session.messages;
			renderConversation();
		});
		panel.querySelector('[data-chat-new]')?.addEventListener('click', createSession);
		panel.querySelector('[data-chat-close]')?.addEventListener('click', close);
		send.addEventListener('click', () => void submit());
		input.addEventListener('input', () => {
			input.style.height = 'auto';
			input.style.height = `${Math.min(120, input.scrollHeight)}px`;
		});
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				void submit();
			}
		});
		window.setTimeout(() => input.focus(), 0);
		try {
			sessions = await api.noteAiChats(noteId);
			if (!panel?.isConnected) return;
			const matching = sessions.find((item) => item.contextKey === contextKey);
			if (matching) {
				session = matching;
				conversation = session.messages;
			}
			paintHistory();
			renderConversation();
		} catch (error) {
			if (panel?.isConnected) options.onError(error);
		} finally {
			if (panel?.isConnected) send.disabled = false;
		}
	};
	const handleOpen = () => void open();
	trigger.addEventListener('click', handleOpen);
	const onSelectionChange = () => {
		if (!panel) return;
		const current = view.state.selection.main;
		if (`${current.from}:${current.to}` !== activeSelectionKey) close();
	};
	document.addEventListener('selectionchange', onSelectionChange);
	const disconnectObserver = new MutationObserver(() => {
		if (!root.isConnected) close();
	});
	disconnectObserver.observe(document.body, { childList: true, subtree: true });
	return () => {
		trigger.removeEventListener('click', handleOpen);
		document.removeEventListener('selectionchange', onSelectionChange);
		disconnectObserver.disconnect();
		close();
	};
}

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
): MarkdownAiHandle {
	const zh = locale === 'zh';
	const t = (zhText: string, enText: string): string => (zh ? zhText : enText);
	const onError = options.onError;
	let panel: HTMLElement | null = null;
	let toolbar: HTMLElement | null = null;
	let trackedSelection: (AiRange & { text: string }) | null = null;

	let syncEmptyPrompt = () => {};
	/** Close the open AI action panel (discards pending review). Null when none is open. */
	let closeActivePanel: (() => void) | null = null;
	let destroyed = false;
	const removePanel = () => {
		panel?.remove();
		panel = null;
		syncEmptyPrompt();
	};
	const removeToolbar = () => {
		toolbar?.remove();
		toolbar = null;
	};

	const openPanel = (
		action: AiAction,
		requestText: string,
		range: AiRange,
		presetInstruction = '',
		panelOptions: { autoStart?: boolean; hideInstruction?: boolean } = {},
	) => {
		removeToolbar();
		// Close any existing panel through its close path so pending DIFF reviews are discarded.
		if (closeActivePanel) closeActivePanel();
		else removePanel();
		// Freeze the exact selected slice once; never re-read a broader range later.
		const clampedFrom = Math.max(0, Math.min(range.from, view.state.doc.length));
		const clampedTo = Math.max(clampedFrom, Math.min(range.to, view.state.doc.length));
		range = { from: clampedFrom, to: clampedTo };
		if (action === 'summarize' || action === 'polish' || action === 'rewrite') {
			requestText = view.state.sliceDoc(range.from, range.to);
		}
		// Keep a soft selection highlight while the panel steals focus.
		if (range.to > range.from) holdSelectionHighlight(view, range.from, range.to);
		else clearSelectionHold(view);
		panel = document.createElement('div');
		panel.className = 'ai-panel';
		const actionLabel = {
			generate: t('AI 写作', 'Write with AI'),
			summarize: t('AI 总结', 'Summarize'),
			polish: t('AI 润色', 'Polish'),
			rewrite: t('AI 修改', 'Edit with AI'),
			chat: t('询问 AI', 'Ask AI'),
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
				<button class="button" type="button" data-ai-insert-below hidden title="${t('保留原文并在下方插入 AI 结果', 'Keep the selection and insert the AI result below')}">${t('在下面插入', 'Insert below')}</button>
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
			const preferredLeft = cursorCoords ? cursorCoords.left : hostRect.left + 12;
			panel.style.left = `${Math.max(12, Math.min(preferredLeft, window.innerWidth - shellWidth - 12))}px`;
			const isReviewAction = action === 'polish' || action === 'rewrite';
			let top: number;
			if (cursorCoords) {
				top = isReviewAction ? Math.max(12, cursorCoords.top - panel.offsetHeight - 10) : cursorCoords.bottom + 10;
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
		const insertBelowButton = panel.querySelector<HTMLButtonElement>('[data-ai-insert-below]')!;
		input.value = presetInstruction;

		type Stage = 'input' | 'busy' | 'done';
		let stage: Stage = 'input';
		let result = '';
		let streamText = '';
		let controller: AbortController | null = null;
		let review: { undoFrom: number; undoTo: number; original: string; generated: string } | null = null;

		let hideInstruction = Boolean(panelOptions.hideInstruction);
		const setStage = (next: Stage) => {
			stage = next;
			form.hidden = next !== 'input' || hideInstruction;
			resultNode.hidden = next === 'input';
			actionsNode.hidden = next === 'input';
			editButton.hidden = next !== 'done';
			// Polish/rewrite: accept replaces selection; insert-below keeps the selection and appends.
			insertBelowButton.hidden = !(next === 'done' && (action === 'polish' || action === 'rewrite'));
			panel?.classList.toggle('busy', next === 'busy');
			if (next === 'busy') {
				mainButton.disabled = false;
				mainButton.innerHTML = `<i data-lucide="square"></i><span>${t('终止', 'Stop')}</span>`;
			} else if (next === 'done') {
				mainButton.disabled = false;
				mainButton.innerHTML = `<i data-lucide="check"></i><span>${action === 'generate' || action === 'summarize' ? t('在下方插入', 'Insert below') : t('接受', 'Accept')}</span>`;
			}
			paintIcons(actionsNode);
			// Stage changes alter panel height (result + actions); re-anchor above/below the caret.
			placePanel();
		};

		/** Discard an in-progress review preview and restore the original selection text. */
		const discardReview = () => {
			if (!review) {
				clearAiReview(view);
				return;
			}
			clearAiReview(view);
			view.dispatch({
				changes: { from: review.undoFrom, to: review.undoTo, insert: review.original },
				annotations: Transaction.userEvent.of('input'),
			});
			review = null;
		};

		/** Close the panel. Pending AI review previews are always discarded (never kept as an insert). */
		const close = () => {
			controller?.abort();
			discardReview();
			clearSelectionHold(view);
			removePanel();
			if (closeActivePanel === close) closeActivePanel = null;
			view.focus();
		};
		closeActivePanel = close;

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
			const instruction = input.value.trim() || presetInstruction || undefined;
			// Selection actions must operate on the frozen selection only — never the whole note.
			const selectionAction = action === 'summarize' || action === 'polish' || action === 'rewrite';
			const selectedText = selectionAction ? requestText : '';
			const request = selectionAction ? selectedText : input.value.trim() || requestText;
			if (!request.trim()) return;
			controller?.abort();
			controller = new AbortController();
			result = '';
			streamText = '';
			setStage('busy');
			resultNode.innerHTML = `<div class="ai-thinking"><i data-lucide="sparkles"></i><span>${t('正在生成…', 'Writing…')}</span></div>`;
			paintIcons(resultNode);
			try {
				// Rewrite: keep a stable loading state (no token streaming in the panel).
				const streamIntoPanel = action !== 'rewrite';
				// Generate (empty doc / blank line) may include the full note as background context.
				// Summarize / polish / rewrite only submit the selected text.
				const documentContext = selectionAction ? undefined : view.state.doc.toString() || undefined;
				await api.ai(
					{
						model: aiModelForAction(action),
						action,
						text: request,
						instruction: selectionAction
							? instruction
							: instruction && instruction !== request
								? instruction
								: undefined,
						context: documentContext,
					},
					(token) => {
						streamText += token;
						if (streamIntoPanel) showResult(normalizeAiMarkdown(streamText));
					},
					controller.signal,
				);
				// Panel may have been closed (abort) or the editor remounted while the stream finished.
				if (destroyed || !panel?.isConnected || controller.signal.aborted) return;
				let note = '';
				result = normalizeAiMarkdown(streamText);
				if (action === 'rewrite') {
					const split = splitRewriteSummary(result);
					note = split.summary || t('已按照你的要求完成修改，请查看。', 'Edits applied as requested.');
					result = split.body || result;
				}
				if (!result) throw new Error(t('AI 没有返回内容', 'AI returned no content'));
				if (action === 'polish' || action === 'rewrite') {
					// Prefer the frozen selection snapshot so a wider live range cannot leak in.
					const original = requestText || view.state.sliceDoc(range.from, range.to);
					const preview = buildAiReviewPreview(original, result);
					view.dispatch({
						changes: { from: range.from, to: range.to, insert: preview.text },
						annotations: Transaction.userEvent.of('input'),
					});
					review = {
						undoFrom: range.from,
						undoTo: range.from + preview.text.length,
						original,
						generated: result,
					};
					// Diff preview replaces the soft selection hold.
					clearSelectionHold(view);
					showAiReview(
						view,
						preview.segments.map((segment) => ({
							from: range.from + segment.from,
							to: range.from + segment.to,
							kind: segment.kind,
						})),
					);
					resultNode.innerHTML = `<div class="ai-review-note">${note || t('已按照你的要求完成修改，请查看。', 'Edits applied as requested.')}</div>`;
				} else {
					showResult(result);
				}
				setStage('done');
			} catch (error) {
				if (destroyed || !panel?.isConnected) return;
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
			discardReview();
			result = '';
			streamText = '';
			hideInstruction = false;
			setStage('input');
			input.focus();
		});
		mainButton.addEventListener('click', () => {
			if (stage === 'busy') {
				controller?.abort();
				// Auto-start polish/summarize hide the instruction row; reveal it after stop.
				hideInstruction = false;
				result = '';
				streamText = '';
				setStage('input');
				input.focus();
				return;
			}
			if (stage !== 'done') return;
			if (review) {
				// Accept: keep only the generated text (drop deleted spans from the preview).
				const acceptedText = review.generated;
				view.dispatch({
					changes: { from: review.undoFrom, to: review.undoTo, insert: acceptedText },
					annotations: Transaction.userEvent.of('input'),
				});
				clearAiReview(view);
				markNewContent(view, review.undoFrom, review.undoFrom + acceptedText.length);
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
		const insertGeneratedBelow = () => {
			if (stage !== 'done') return;
			const generated = (review?.generated ?? result).trimEnd();
			if (!generated) return;
			if (review) {
				// Restore the original selection, then append the AI result under it.
				clearAiReview(view);
				const original = review.original;
				const separator = !original ? '' : original.endsWith('\n\n') ? '' : original.endsWith('\n') ? '\n' : '\n\n';
				const combined = `${original}${separator}${generated}`;
				const insertedFrom = review.undoFrom + original.length + separator.length;
				view.dispatch({
					changes: { from: review.undoFrom, to: review.undoTo, insert: combined },
					selection: { anchor: insertedFrom + generated.length },
					annotations: Transaction.userEvent.of('input'),
					scrollIntoView: true,
				});
				markNewContent(view, insertedFrom, insertedFrom + generated.length);
				review = null;
				close();
				return;
			}
			// Fallback for non-review actions that expose the same control.
			const insertAt = range.to;
			const prefix =
				insertAt > 0 && !view.state.sliceDoc(Math.max(0, insertAt - 2), insertAt).endsWith('\n\n')
					? view.state.sliceDoc(Math.max(0, insertAt - 1), insertAt) === '\n'
						? '\n'
						: '\n\n'
					: '';
			const inserted = `${prefix}${generated}`;
			view.dispatch({
				changes: { from: insertAt, to: insertAt, insert: inserted },
				selection: { anchor: insertAt + inserted.length },
				annotations: Transaction.userEvent.of('input'),
				scrollIntoView: true,
			});
			markNewContent(view, insertAt, insertAt + inserted.length);
			close();
		};
		insertBelowButton.addEventListener('click', insertGeneratedBelow);

		panel.querySelector('[data-ai-close]')?.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			// Close discards the review; it never inserts AI output.
			close();
		});
		panel.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				// close() already discards any review preview; do not accept/insert.
				close();
			}
		});
		if (hideInstruction) form.hidden = true;
		const focusInstruction = () => {
			if (hideInstruction) return;
			input.focus({ preventScroll: true });
			// Some browsers move caret back to CodeMirror after the mouseup that opened the panel.
			window.setTimeout(() => {
				if (panel?.isConnected && document.activeElement !== input) input.focus({ preventScroll: true });
			}, 0);
		};
		focusInstruction();
		const shouldAutoStart =
			panelOptions.autoStart ||
			(action === 'generate' && Boolean(requestText)) ||
			(action !== 'generate' && Boolean(presetInstruction) && action !== 'rewrite');
		if (shouldAutoStart) void generate();
		placePanel();
		syncEmptyPrompt();
	};
	const showToolbar = () => {
		if (!host.isConnected) return removeToolbar();
		// While the AI panel is open, keep the soft selection hold and skip the floating menu.
		if (panel) return removeToolbar();
		const range = view.state.selection.main;
		if (range.empty || !view.hasFocus) {
			trackedSelection = null;
			if (!panel) clearSelectionHold(view);
			return removeToolbar();
		}
		// Snapshot the document slice for the current CodeMirror selection only.
		trackedSelection = {
			from: range.from,
			to: range.to,
			text: view.state.sliceDoc(range.from, range.to),
		};
		holdSelectionHighlight(view, range.from, range.to);
		const coords = view.coordsAtPos(range.from);
		// Reuse an existing menu when possible so mobile bottom bar does not flash.
		const existing = toolbar;
		if (existing) {
			existing.querySelectorAll<HTMLButtonElement>('[data-format]').forEach((button) => {
				const marker = button.dataset.marker ?? '**';
				const active = markerCoverage(view, range.from, range.to, marker) === 'full';
				button.classList.toggle('active', active);
				button.setAttribute('aria-pressed', String(active));
			});
			if (coords && !window.matchMedia('(max-width: 720px)').matches) {
				existing.style.left = `${Math.max(8, Math.min(coords.left, innerWidth - 340))}px`;
				existing.style.top = `${Math.max(8, coords.top - 48)}px`;
			}
			return;
		}
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
			<button type="button" data-action="polish" aria-haspopup="menu" aria-expanded="false">${t('润色', 'Polish')}</button>
			<button type="button" data-action="rewrite">${t('修改', 'Edit')}</button>`;
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
		const removePolishMenu = () => document.querySelector('.ai-polish-menu')?.remove();

		toolbar.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) =>
			button.addEventListener('mousedown', (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (!trackedSelection) return;
				const action = button.dataset.action as AiAction;
				if (action === 'summarize') {
					removePolishMenu();
					openPanel(
						'summarize',
						trackedSelection.text,
						trackedSelection,
						zh ? SUMMARIZE_INSTRUCTION_ZH : SUMMARIZE_INSTRUCTION_EN,
						{ autoStart: true, hideInstruction: true },
					);
					return;
				}
				if (action === 'polish') {
					removePolishMenu();
					const expanded = button.getAttribute('aria-expanded') === 'true';
					const menuHost = toolbar;
					if (!menuHost) return;
					menuHost
						.querySelectorAll<HTMLButtonElement>('[data-action="polish"]')
						.forEach((item) => item.setAttribute('aria-expanded', 'false'));
					if (expanded) return;
					button.setAttribute('aria-expanded', 'true');
					const menu = document.createElement('div');
					menu.className = 'ai-polish-menu';
					menu.setAttribute('role', 'menu');
					const rect = button.getBoundingClientRect();
					menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 140))}px`;
					menu.style.top = `${Math.min(innerHeight - 140, rect.bottom + 6)}px`;
					menu.innerHTML = `
						<button type="button" role="menuitem" data-polish="formal">${t('正式', 'Formal')}</button>
						<button type="button" role="menuitem" data-polish="concise">${t('简洁', 'Concise')}</button>
						<button type="button" role="menuitem" data-polish="witty">${t('风趣', 'Witty')}</button>`;
					document.body.append(menu);
					const selection = trackedSelection;
					menu.querySelectorAll<HTMLButtonElement>('[data-polish]').forEach((item) => {
						item.addEventListener('mousedown', (menuEvent) => {
							menuEvent.preventDefault();
							menuEvent.stopPropagation();
							const style = item.dataset.polish as PolishStyle;
							const prompt = POLISH_INSTRUCTIONS[style][zh ? 'zh' : 'en'];
							removePolishMenu();
							if (!selection) return;
							openPanel('polish', selection.text, selection, prompt, {
								autoStart: true,
								hideInstruction: true,
							});
						});
					});
					const onDocDown = (docEvent: Event) => {
						if (menu.contains(docEvent.target as Node) || button.contains(docEvent.target as Node)) return;
						removePolishMenu();
						button.setAttribute('aria-expanded', 'false');
						document.removeEventListener('mousedown', onDocDown, true);
					};
					document.addEventListener('mousedown', onDocDown, true);
					return;
				}
				if (action === 'rewrite') {
					removePolishMenu();
					openPanel('rewrite', trackedSelection.text, trackedSelection, '', {
						autoStart: false,
						hideInstruction: false,
					});
				}
			}),
		);
	};

	const scheduleToolbar = () => requestAnimationFrame(showToolbar);
	view.dom.addEventListener('mouseup', scheduleToolbar);
	view.dom.addEventListener('touchend', scheduleToolbar, { passive: true });
	view.dom.addEventListener('keyup', scheduleToolbar);
	// Keep the menu in sync with selection changes (mobile soft keyboard / caret moves).
	const selectionPoll = view.dom.ownerDocument;
	const onSelectionChange = () => {
		if (!host.isConnected) return;
		if (panel) return removeToolbar();
		const range = view.state.selection.main;
		if (range.empty || !view.hasFocus) removeToolbar();
		else scheduleToolbar();
	};
	selectionPoll.addEventListener('selectionchange', onSelectionChange);
	view.dom.addEventListener('blur', () =>
		window.setTimeout(() => {
			if (panel) return removeToolbar();
			if (!view.hasFocus && !toolbar?.matches(':hover') && !toolbar?.contains(document.activeElement)) removeToolbar();
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
	/** Cursor is on a blank line (empty doc or a newly opened empty line). */
	const isBlankLineAtCursor = (): boolean => {
		const selection = view.state.selection.main;
		if (!selection.empty) return false;
		const line = view.state.doc.lineAt(selection.head);
		return line.text.trim().length === 0;
	};
	view.dom.addEventListener('keydown', (event) => {
		if (event.key !== ' ' || panel) return;
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (!isBlankLineAtCursor()) return;
		event.preventDefault();
		const head = view.state.selection.main.head;
		// Context for blank-line generate is the full note; the space itself is not inserted.
		openPanel('generate', '', { from: head, to: head });
	});
	const mobileBindings = new AbortController();
	const mobileTools = host
		.closest<HTMLElement>('.note-editor')
		?.querySelector<HTMLElement>('[data-mobile-editor-tools]');
	mobileTools?.querySelectorAll<HTMLButtonElement>('[data-mobile-format]').forEach((button) => {
		button.addEventListener(
			'pointerdown',
			(event) => {
				event.preventDefault();
				toggleMarkdownWrap(view, button.dataset.marker ?? '**');
				view.focus();
			},
			{ signal: mobileBindings.signal },
		);
	});
	mobileTools?.querySelectorAll<HTMLButtonElement>('[data-mobile-ai-action]').forEach((button) => {
		button.addEventListener(
			'pointerdown',
			(event) => {
				event.preventDefault();
				const range = view.state.selection.main;
				if (range.empty) {
					onError(new Error(t('请先选择要处理的内容', 'Select text first')));
					view.focus();
					return;
				}
				const selected = { from: range.from, to: range.to, text: view.state.sliceDoc(range.from, range.to) };
				const action = button.dataset.mobileAiAction as 'summarize' | 'polish' | 'rewrite';
				if (action === 'summarize') {
					openPanel(action, selected.text, selected, zh ? SUMMARIZE_INSTRUCTION_ZH : SUMMARIZE_INSTRUCTION_EN, {
						autoStart: true,
						hideInstruction: true,
					});
				} else if (action === 'polish') {
					openPanel(action, selected.text, selected, POLISH_INSTRUCTIONS.formal[zh ? 'zh' : 'en'], {
						autoStart: true,
						hideInstruction: true,
					});
				} else {
					openPanel(action, selected.text, selected);
				}
			},
			{ signal: mobileBindings.signal },
		);
	});
	const unbindChat = bindNoteContextChat(view, host, locale, options);
	const destroy = () => {
		if (destroyed) return;
		destroyed = true;
		// Prefer the panel's own close path so a pending polish/rewrite review is discarded.
		if (closeActivePanel) closeActivePanel();
		else {
			clearAiReview(view);
			clearSelectionHold(view);
			removePanel();
		}
		mobileBindings.abort();
		unbindChat();
		selectionPoll.removeEventListener('selectionchange', onSelectionChange);
		view.dom.removeEventListener('mouseup', scheduleToolbar);
		view.dom.removeEventListener('touchend', scheduleToolbar);
		view.dom.removeEventListener('keyup', scheduleToolbar);
		view.dom.removeEventListener('input', syncEmptyPrompt);
		removeToolbar();
		emptyPrompt.remove();
		document.querySelector('.ai-polish-menu')?.remove();
		window.removeEventListener('scroll', removeToolbar, true);
		disconnectObserver.disconnect();
	};
	// When the note editor host is torn down (sidebar repaint / note switch), drop floating AI UI.
	const disconnectObserver = new MutationObserver(() => {
		if (!host.isConnected) destroy();
	});
	disconnectObserver.observe(document.body, { childList: true, subtree: true });

	return {
		// Callers must use this for empty-prompt refresh — never the destroy path.
		syncEmptyPrompt: () => {
			if (!destroyed) syncEmptyPrompt();
		},
		destroy,
	};
}
