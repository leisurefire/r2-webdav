import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MessageCircle, Pencil, Trash2 } from 'lucide';
import {
	aiChatMode,
	aiModelForAction,
	api,
	availableAiModels,
	saveAiChatMode,
	saveAiModelForAction,
	type NoteChatChange,
	type NoteChatSession,
} from '../api/client';
import { mountBottomSheet, type BottomSheetHandle } from '../ui/bottomSheet';
import { openConfirmDialog, openTextInputDialog } from '../ui/dialogs';
import { enhanceSelect, type CustomSelectHandle } from '../ui/dropdown';
import { onDisconnect } from '../ui/lifecycle';
import {
	applyChatEditPatches,
	canSafelyRevert,
	mapChatSegments,
	parseAiCitations,
	parseChatAiEnvelope,
	type AiCitation,
} from './aiParsing';
import { paintAiIcons as paintIcons, populateModelSelect, providerLogoElement } from './aiUi';
import { markNewContent, showEditorHighlight } from './editorHighlights';
import { clearAiReview, showAiReview, type AiReviewSegment } from './markdownLivePreview';
import { renderMarkdown } from './markdownRenderer';
import { buildAiReviewPreview } from './textDiff';

type Locale = 'en' | 'zh';

interface AiRange {
	from: number;
	to: number;
}

export interface NoteChatOptions {
	onError: (error: unknown) => void;
	onTitleChange?: (title: string) => void;
	noteTitle?: () => string;
	noteId?: string;
}

let activeNoteChatClose: (() => void) | null = null;

export function bindNoteContextChat(
	view: EditorView,
	host: HTMLElement,
	locale: Locale,
	options: NoteChatOptions,
): () => void {
	const root = host.closest<HTMLElement>('.note-editor');
	const compose = root?.querySelector<HTMLElement>('[data-note-compose]');
	const trigger = root?.querySelector<HTMLButtonElement>('[data-note-ai-chat]');
	if (!root || !trigger || !compose) return () => {};
	const noteId = options.noteId || root.dataset.noteEditorId || 'unknown';
	const zh = locale === 'zh';
	const t = (zhText: string, enText: string): string => (zh ? zhText : enText);
	let panel: HTMLElement | null = null;
	let sheet: BottomSheetHandle | null = null;
	let controller: AbortController | null = null;
	/** Freeze the exact submitted context so edits never leak into a wider live range. */
	let chatRange: AiRange = { from: 0, to: 0 };
	interface ChatReview {
		undoFrom: number;
		undoTo: number;
		original: string;
		generated: string;
		segments: AiReviewSegment[];
		diffVisible: boolean;
		button?: HTMLButtonElement;
	}
	let review: ChatReview | null = null;
	const reviewBarId = 'chat-review';
	const removeReviewBar = () => root.querySelector(`[data-chat-review="${reviewBarId}"]`)?.remove();
	const discardChatReview = () => {
		removeReviewBar();
		if (!review) return;
		const previewText = buildAiReviewPreview(review.original, review.generated).text;
		const current = review.undoTo <= view.state.doc.length ? view.state.sliceDoc(review.undoFrom, review.undoTo) : '';
		if (current !== previewText && current !== review.generated) {
			// Never overwrite a manual edit made while the review was open.
			review = null;
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
	const close = () => {
		controller?.abort();
		controller = null;
		discardChatReview();
		if (panel) {
			sheet?.destroy();
			sheet = null;
			panel.classList.add('is-closing');
			const closing = panel;
			root.classList.remove('note-ai-sidebar-open');
			let removed = false;
			const removeClosingPanel = () => {
				if (removed) return;
				removed = true;
				closing.remove();
			};
			const onAnimationEnd = (event: AnimationEvent) => {
				if (event.target !== closing) return;
				closing.removeEventListener('animationend', onAnimationEnd);
				removeClosingPanel();
			};
			closing.addEventListener('animationend', onAnimationEnd);
			if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) removeClosingPanel();
			else window.setTimeout(removeClosingPanel, 220);
		} else root.classList.remove('note-ai-sidebar-open');
		panel = null;
		trigger.classList.remove('active');
		trigger.setAttribute('aria-expanded', 'false');
		if (activeNoteChatClose === close) activeNoteChatClose = null;
	};
	const open = async (requestedSessionId?: string, initialPrompt = '', requestedMode?: 'edit' | 'ask') => {
		if (panel) {
			close();
			if (!requestedSessionId) return;
		}
		activeNoteChatClose?.();
		activeNoteChatClose = close;
		const documentText = view.state.doc.toString();
		const selection = view.state.selection.main;
		const hasSelection = !selection.empty;
		let contextText = hasSelection ? view.state.sliceDoc(selection.from, selection.to) : documentText;
		const startLine = hasSelection ? view.state.doc.lineAt(selection.from).number : 1;
		const endLine = hasSelection
			? view.state.doc.lineAt(Math.max(selection.from, selection.to - 1)).number
			: view.state.doc.lines;
		let numberedContext = contextText
			.split('\n')
			.map((line, index) => `${startLine + index}: ${line}`)
			.join('\n');
		const contextLabel = hasSelection
			? t(`已选 ${endLine - startLine + 1} 行`, `${endLine - startLine + 1} selected lines`)
			: options.noteTitle?.() || t('当前便签', 'Current note');
		const contextKey = `${selection.from}:${selection.to}:${documentText.length}:${contextText.slice(0, 80)}`;
		chatRange = hasSelection ? { from: selection.from, to: selection.to } : { from: 0, to: documentText.length };
		const welcomeHtml = () => `<section class="note-ai-chat-welcome">
			<span class="note-ai-welcome-mark"><i data-lucide="sparkles"></i></span>
			<h2>${t('听候差遣', 'At your service')}</h2>
			<div class="note-ai-quick-actions">
				<button type="button" data-chat-quick="${t('请总结当前便签，提炼核心内容、关键信息和待办事项。', 'Summarize this note, extracting its main ideas, key information, and action items.')}" data-chat-quick-mode="ask"><i data-lucide="sparkles"></i><span>${t('总结便签', 'Summarize note')}</span></button>
				<button type="button" data-chat-quick="${t('请沿着当前便签的行文脉络继续创作，保持现有语气、结构与 Markdown 格式。', 'Continue writing from the current note while preserving its tone, structure, and Markdown formatting.')}" data-chat-quick-mode="edit"><i data-lucide="sparkles"></i><span>${t('继续创作', 'Continue writing')}</span></button>
				<button type="button" data-chat-quick="${t('请分析当前文本的语法、用词和句式，修正发现的问题；不要改动没有问题的内容，并保持 Markdown 结构。', 'Analyze the text for grammar, wording, and sentence structure. Correct only the issues you find and preserve the Markdown structure.')}" data-chat-quick-mode="edit"><i data-lucide="sparkles"></i><span>${t('语法分析', 'Grammar analysis')}</span></button>
			</div>
		</section>`;
		let sessions: NoteChatSession[] = [];
		/** Chat mode is a permission only: ask is read-only, edit may propose edits; both remember their model. */
		let chatMode: 'edit' | 'ask' = requestedMode ?? aiChatMode();
		let selectedModel = aiModelForAction(chatMode === 'edit' ? 'rewrite' : 'chat');
		let session: NoteChatSession = {
			id: crypto.randomUUID(),
			title: t('新对话', 'New chat'),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			contextKey,
			contextLabel,
			messages: [],
		};
		const saveLatestChange = (change: NoteChatChange | null) => {
			session.latestChange = change ?? undefined;
			if (!sessions.some((item) => item.id === session.id)) return;
			session.updatedAt = new Date().toISOString();
			return api.saveNoteAiChat(noteId, session);
		};
		panel = document.createElement('aside');
		panel.className = 'note-ai-chat-panel workspace-rail workspace-rail-right';
		panel.setAttribute('aria-label', t('AI 对话', 'AI conversation'));
		panel.innerHTML = `<header class="note-ai-chat-head workspace-rail-head">
			<select data-chat-history title="${t('历史对话', 'Chat history')}" aria-label="${t('历史对话', 'Chat history')}"></select>
			<span class="toolbar-spacer"></span>
			<button type="button" class="row-action" data-chat-new title="${t('新建对话', 'New chat')}" aria-label="${t('新建对话', 'New chat')}"><i data-lucide="message-circle-plus"></i></button>
			<button type="button" class="row-action" data-chat-close title="${t('关闭 AI', 'Close AI')}" aria-label="${t('关闭 AI', 'Close AI')}"><i data-lucide="x"></i></button>
		</header>
		<div class="note-ai-chat-messages" data-chat-messages data-bottom-sheet-scroll>${welcomeHtml()}</div>
		<div class="note-ai-chat-composer">
			<div class="note-ai-context-chip"><i data-lucide="${hasSelection ? 'text-select' : 'file-text'}"></i><span>${contextLabel}</span></div>
			<div class="note-ai-chat-input-row"><textarea rows="1" data-chat-input placeholder="${t('使用 AI 处理当前内容…', 'Ask AI about this content…')}" aria-label="${t('向 AI 提问', 'Ask AI')}"></textarea></div>
			<div class="note-ai-chat-footer"><button type="button" class="row-action" data-chat-settings title="${t('编辑或询问', 'Edit or ask')}" aria-label="${t('编辑或询问', 'Edit or ask')}"><i data-lucide="sliders-horizontal"></i></button><select class="note-ai-mode" data-chat-mode aria-label="${t('AI 模式', 'AI mode')}"><option value="edit">${t('编辑', 'Edit')}</option><option value="ask">${t('询问', 'Ask')}</option></select><span class="toolbar-spacer"></span><select class="note-ai-model" data-chat-model aria-label="${t('选择模型', 'Choose model')}"></select><button type="button" class="ai-send" data-chat-send title="${t('提交', 'Submit')}" aria-label="${t('提交', 'Submit')}"><i data-lucide="arrow-up"></i></button></div>
		</div>`;
		compose.querySelector(`[data-chat-review="${reviewBarId}"]`)?.remove();
		root.append(panel);
		sheet = mountBottomSheet(panel, close);
		root.classList.add('note-ai-sidebar-open');
		paintIcons(panel);
		trigger.classList.add('active');
		trigger.setAttribute('aria-expanded', 'true');
		const messagesNode = panel.querySelector<HTMLElement>('[data-chat-messages]')!;
		const composer = panel.querySelector<HTMLElement>('.note-ai-chat-composer')!;
		const input = panel.querySelector<HTMLTextAreaElement>('[data-chat-input]')!;
		const send = panel.querySelector<HTMLButtonElement>('[data-chat-send]')!;
		const modeSelect = panel.querySelector<HTMLSelectElement>('[data-chat-mode]')!;
		const modelSelect = panel.querySelector<HTMLSelectElement>('[data-chat-model]')!;
		const setGenerating = (generating: boolean) => {
			send.disabled = false;
			send.title = generating ? t('停止生成', 'Stop generating') : t('提交', 'Submit');
			send.setAttribute('aria-label', send.title);
			send.innerHTML = `<i data-lucide="${generating ? 'square' : 'arrow-up'}"></i>`;
			paintIcons(send);
		};
		modeSelect.value = chatMode;
		populateModelSelect(modelSelect, availableAiModels(), selectedModel, t);
		enhanceSelect(modelSelect, {
			className: 'note-ai-model-select',
			menuMinWidth: 300,
			searchable: true,
			searchPlaceholder: t('搜索模型…', 'Search models…'),
			getOptionVisual: (option) => providerLogoElement(option.value),
		});
		modelSelect.addEventListener('change', () => {
			selectedModel = modelSelect.value || selectedModel;
			saveAiModelForAction(chatMode === 'edit' ? 'rewrite' : 'chat', selectedModel);
		});
		const settingsButton = panel.querySelector<HTMLButtonElement>('[data-chat-settings]')!;
		const modeDropdown = enhanceSelect(modeSelect, {
			className: 'note-ai-mode-select',
			hideTrigger: true,
			getAnchor: () => settingsButton,
			getOptionIcon: (option) => (option.value === 'edit' ? Pencil : MessageCircle),
		});
		modeSelect.addEventListener('change', () => {
			if (review) acceptChatReview();
			chatMode = modeSelect.value === 'ask' ? 'ask' : 'edit';
			saveAiChatMode(chatMode);
			selectedModel = aiModelForAction(chatMode === 'edit' ? 'rewrite' : 'chat');
			if ([...modelSelect.options].some((option) => option.value === selectedModel)) {
				modelSelect.value = selectedModel;
				modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
			}
			if (!conversation.length && !input.value.trim()) {
				messagesNode.innerHTML = welcomeHtml();
				paintIcons(messagesNode);
				bindWelcomeActions();
			}
		});
		settingsButton.addEventListener('click', () => modeDropdown.open());
		send.disabled = true;
		const historySelect = panel.querySelector<HTMLSelectElement>('[data-chat-history]')!;
		let conversation = session.messages;
		let historyDropdown: CustomSelectHandle;
		const newChatValue = '__new__';
		const isNewSession = () => !sessions.some((item) => item.id === session.id);
		const paintHistory = () => {
			historySelect.replaceChildren(
				new Option(t('新建 AI 对话', 'New AI chat'), newChatValue, false, isNewSession()),
				...sessions.map(
					(item) => new Option(item.title || t('未命名对话', 'Untitled chat'), item.id, false, item.id === session.id),
				),
			);
			historyDropdown?.refresh();
		};
		const citationExcerpt = (citation: AiCitation): string => {
			const lines = documentText.split('\n');
			return lines
				.slice(citation.startLine - 1, citation.endLine)
				.join('\n')
				.trim();
		};
		const jumpToCitation = (citation: AiCitation) => {
			const firstLine = view.state.doc.line(Math.min(view.state.doc.lines, citation.startLine));
			const lastLine = view.state.doc.line(Math.min(view.state.doc.lines, citation.endLine));
			view.dispatch({
				effects: EditorView.scrollIntoView(firstLine.from, { y: 'center' }),
			});
			showEditorHighlight(view, firstLine.from, lastLine.to, 'transient');
		};
		const openCitations = (citations: AiCitation[]) => {
			const dialog = document.createElement('dialog');
			dialog.className = 'note-ai-citations-dialog';
			dialog.innerHTML = `<div class="note-ai-citations-shell"><header><div><h2>${t('引用内容', 'Sources')}</h2><p>${t(`${citations.length} 处原文`, `${citations.length} source${citations.length === 1 ? '' : 's'}`)}</p></div><button type="button" class="row-action" data-citations-close title="${t('关闭', 'Close')}" aria-label="${t('关闭', 'Close')}"><i data-lucide="x"></i></button></header><div class="note-ai-citations"></div></div>`;
			const sources = dialog.querySelector<HTMLElement>('.note-ai-citations')!;
			for (const citation of citations) {
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
			document.body.append(dialog);
			paintIcons(dialog);
			dialog.querySelector('[data-citations-close]')?.addEventListener('click', () => dialog.close());
			dialog.addEventListener('close', () => dialog.remove());
			dialog.showModal();
		};
		const renderAnswer = (node: HTMLElement, answer: string) => {
			const envelope = parseChatAiEnvelope(answer);
			if (envelope.kind === 'edit') {
				node.innerHTML = `<div class="ai-review-note">${t('AI 已生成待检查的修改。', 'AI prepared edits for review.')}</div>`;
				return;
			}
			const parsed = parseAiCitations(envelope.content);
			node.innerHTML = `<article class="ai-markdown-preview">${renderMarkdown(parsed.markdown)}</article>`;
			if (!parsed.citations.length) return;
			node.querySelectorAll<HTMLAnchorElement>('a[href^="#note-ai-cite-"]').forEach((link) => {
				const index = Number(link.getAttribute('href')?.split('-').at(-1));
				const citation = parsed.citations.find((item) => item.index === index);
				if (!citation) return;
				link.classList.add('note-ai-citation-ref');
				link.title = t('跳转到引用原文', 'Jump to source');
				link.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					jumpToCitation(citation);
				});
			});
			const trigger = document.createElement('button');
			trigger.type = 'button';
			trigger.className = 'note-ai-citations-trigger';
			trigger.innerHTML = `<i data-lucide="quote"></i><span>${t('查看引用', 'View sources')} · ${parsed.citations.length}</span>`;
			trigger.addEventListener('click', () => openCitations(parsed.citations));
			node.append(trigger);
			paintIcons(trigger);
		};
		const renderLatestChange = (node: HTMLElement) => {
			const change = session.latestChange;
			if (!change) return;
			const status = document.createElement('div');
			status.className = 'note-ai-change-status';
			if (change.status === 'reverted') {
				status.textContent = t('更改已回撤', 'Change reverted');
				node.append(status);
				return;
			}
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'note-ai-change-revert';
			button.innerHTML = `<i data-lucide="rotate-ccw"></i><span>${t('撤销更改', 'Revert change')}</span>`;
			button.title = t('撤销最近一条更改', 'Revert the latest change');
			button.addEventListener('click', () => {
				if (!canSafelyRevert(view.state.doc.toString(), change)) {
					options.onError(
						new Error(
							t(
								'当前内容已被手动修改，无法安全回撤。',
								'The note changed after this edit, so it cannot be safely reverted.',
							),
						),
					);
					return;
				}
				view.dispatch({
					changes: { from: change.from, to: change.to, insert: change.original },
					annotations: Transaction.userEvent.of('input'),
				});
				change.status = 'reverted';
				change.updatedAt = new Date().toISOString();
				void Promise.resolve(saveLatestChange(change)).catch(options.onError);
				renderConversation();
			});
			node.append(button);
			paintIcons(button);
		};
		let bindWelcomeActions = () => {};
		const renderConversation = () => {
			messagesNode.innerHTML = '';
			if (!conversation.length) {
				// Keep the empty-state prompts only when there is no draft text either.
				if (!input.value.trim()) {
					messagesNode.innerHTML = welcomeHtml();
					paintIcons(messagesNode);
					bindWelcomeActions();
				}
				return;
			}
			for (const [index, message] of conversation.entries()) {
				const node = document.createElement('div');
				node.className = `note-ai-chat-message ${message.role}`;
				if (message.role === 'user') node.textContent = message.content;
				else {
					renderAnswer(node, message.content);
					if (message.thinking) {
						const thinking = document.createElement('div');
						thinking.className = 'note-ai-thinking-detail';
						thinking.textContent = message.thinking;
						node.append(thinking);
					}
					if (index === conversation.length - 1) renderLatestChange(node);
				}
				messagesNode.append(node);
			}
			messagesNode.scrollTop = messagesNode.scrollHeight;
		};
		const createSession = () => {
			discardChatReview();
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
		/** Toggle diff decorations: hiding them leaves clean generated text; showing restores the inline preview. */
		const toggleChatDiff = () => {
			if (!review) return;
			review.diffVisible = !review.diffVisible;
			if (review.diffVisible) {
				const preview = buildAiReviewPreview(review.original, review.generated);
				view.dispatch({
					changes: { from: review.undoFrom, to: review.undoTo, insert: preview.text },
					annotations: Transaction.userEvent.of('input'),
				});
				review.undoTo = review.undoFrom + preview.text.length;
				showAiReview(view, review.segments);
			} else {
				clearAiReview(view);
				view.dispatch({
					changes: { from: review.undoFrom, to: review.undoTo, insert: review.generated },
					annotations: Transaction.userEvent.of('input'),
				});
				review.undoTo = review.undoFrom + review.generated.length;
			}
			if (review.button) {
				const label = review.diffVisible ? t('隐藏差异', 'Hide diff') : t('查看差异', 'Show diff');
				review.button.title = label;
				review.button.setAttribute('aria-label', label);
				review.button.setAttribute('aria-pressed', String(review.diffVisible));
				review.button.innerHTML = `<i data-lucide="${review.diffVisible ? 'eye-off' : 'diff'}"></i>`;
				paintIcons(review.button);
			}
		};
		/** Accept the pending review: keep the generated text, drop deleted spans, close the bar. */
		const acceptChatReview = () => {
			if (!review) return;
			const acceptedFrom = review.undoFrom;
			const acceptedText = review.generated;
			if (review.diffVisible) {
				clearAiReview(view);
				view.dispatch({
					changes: { from: review.undoFrom, to: review.undoTo, insert: acceptedText },
					annotations: Transaction.userEvent.of('input'),
				});
			}
			chatRange = { from: acceptedFrom, to: acceptedFrom + acceptedText.length };
			clearAiReview(view);
			review = null;
			removeReviewBar();
		};
		/** Keep the original context and insert the AI result below it. */
		const insertChatBelow = () => {
			if (!review) return;
			clearAiReview(view);
			const original = review.original;
			const generated = review.generated.trimEnd();
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
			removeReviewBar();
		};
		/**
		 * Edit mode: default to an inline diff, then offer a fixed review bar
		 * (show/hide diff, revert, insert below, done) above the composer.
		 */
		const addReviewActions = (answerNode: HTMLElement, rawAnswer: string) => {
			removeReviewBar();
			const original = contextText;
			const envelope = parseChatAiEnvelope(rawAnswer);
			if (envelope.kind !== 'edit') return;
			const applied = applyChatEditPatches(original, envelope.content);
			if (!applied.ok) {
				answerNode.innerHTML = `<div class="ai-review-note">${t(
					'AI 返回的修改无法与原文安全匹配，因此没有应用。请重试或缩小修改范围。',
					'The edits could not be matched safely, so nothing was applied. Retry or narrow the request.',
				)}</div>`;
				return;
			}
			const generated = applied.markdown;
			if (generated === original) {
				answerNode.innerHTML = `<div class="ai-review-note">${t('AI 没有生成实际改动。', 'AI did not produce any changes.')}</div>`;
				return;
			}
			const preview = buildAiReviewPreview(original, generated);
			const segments = mapChatSegments(preview.segments, chatRange.from);
			view.dispatch({
				changes: { from: chatRange.from, to: chatRange.to, insert: preview.text },
				annotations: Transaction.userEvent.of('input'),
			});
			review = {
				undoFrom: chatRange.from,
				undoTo: chatRange.from + preview.text.length,
				original,
				generated,
				segments,
				diffVisible: true,
			};
			void Promise.resolve(
				saveLatestChange({
					from: chatRange.from,
					to: chatRange.from + generated.length,
					original,
					generated,
					status: 'active',
					updatedAt: new Date().toISOString(),
				}),
			).catch(options.onError);
			showAiReview(view, segments);
			const bar = document.createElement('div');
			bar.className = 'note-ai-chat-review';
			bar.dataset.chatReview = reviewBarId;
			bar.innerHTML = `<span class="note-ai-chat-review-label">${t('已更新', 'Updated')}</span>
				<button type="button" class="row-action" data-review-diff title="${t('隐藏差异', 'Hide diff')}" aria-label="${t('隐藏差异', 'Hide diff')}" aria-pressed="true"><i data-lucide="eye-off"></i></button>
				<button type="button" class="row-action" data-review-revert title="${t('回撤改动', 'Revert changes')}" aria-label="${t('回撤改动', 'Revert changes')}"><i data-lucide="rotate-ccw"></i></button>
				<button type="button" class="row-action" data-review-below title="${t('保留原文并在下方插入 AI 结果', 'Keep the original and insert the AI result below')}" aria-label="${t('在下面插入', 'Insert below')}"><i data-lucide="plus"></i></button>
				<span class="toolbar-spacer"></span>
				<button type="button" class="button primary" data-review-accept>${t('完成', 'Done')}</button>`;
			composer.prepend(bar);
			paintIcons(bar);
			review.button = bar.querySelector<HTMLButtonElement>('[data-review-diff]')!;
			review.button.addEventListener('click', toggleChatDiff);
			bar.querySelector('[data-review-revert]')?.addEventListener('click', () => {
				if (!review) return;
				const previewText = buildAiReviewPreview(review.original, review.generated).text;
				const current =
					review.undoTo <= view.state.doc.length ? view.state.sliceDoc(review.undoFrom, review.undoTo) : '';
				if (current !== previewText && current !== review.generated) {
					options.onError(
						new Error(
							t(
								'当前内容已被手动修改，无法安全回撤。',
								'The note changed after this edit, so it cannot be safely reverted.',
							),
						),
					);
					return;
				}
				const change = session.latestChange;
				discardChatReview();
				if (change) {
					change.status = 'reverted';
					change.updatedAt = new Date().toISOString();
					void Promise.resolve(saveLatestChange(change)).catch(options.onError);
					renderConversation();
				}
			});
			bar.querySelector('[data-review-below]')?.addEventListener('click', insertChatBelow);
			bar.querySelector('[data-review-accept]')?.addEventListener('click', acceptChatReview);
		};
		/** Re-read the submitted range in edit mode so each turn builds on the current document. */
		const refreshEditContext = () => {
			if (review) acceptChatReview();
			contextText = view.state.sliceDoc(chatRange.from, chatRange.to);
			const firstLine = view.state.doc.lineAt(chatRange.from).number;
			numberedContext = contextText
				.split('\n')
				.map((line, index) => `${firstLine + index}: ${line}`)
				.join('\n');
		};
		const submit = async () => {
			const question = input.value.trim();
			if (!question || controller) return;
			const requestMode = chatMode;
			if (requestMode === 'edit') refreshEditContext();
			input.value = '';
			input.style.height = '';
			// Drop the empty-state prompts as soon as a real turn starts.
			messagesNode.querySelector('.note-ai-chat-welcome')?.remove();
			conversation.push({ role: 'user', content: question });
			if (conversation.length === 1) session.title = question.replace(/\s+/g, ' ').slice(0, 36);
			paintHistory();
			const userNode = document.createElement('div');
			userNode.className = 'note-ai-chat-message user';
			userNode.textContent = question;
			const answerNode = document.createElement('div');
			answerNode.className = 'note-ai-chat-message assistant';
			answerNode.innerHTML = `<div class="ai-thinking"><i data-lucide="sparkles"></i><span>${requestMode === 'edit' ? t('正在修改…', 'Editing…') : t('正在查找原文…', 'Reading the note…')}</span></div>`;
			messagesNode.append(userNode, answerNode);
			paintIcons(answerNode);
			messagesNode.scrollTop = messagesNode.scrollHeight;
			const requestController = new AbortController();
			controller = requestController;
			setGenerating(true);
			let answer = '';
			try {
				await api.ai(
					{
						model: selectedModel,
						action: 'chat',
						mode: requestMode,
						text: question,
						context: numberedContext,
						editableContext: contextText,
						noteId,
						conversationId: session.id,
						contextKey,
						contextLabel,
						thinking:
							requestMode === 'edit'
								? t('思考完毕，已生成可检查的修改。', 'Thinking complete. Edits are ready to review.')
								: t('已完成内容分析。', 'Content analysis complete.'),
					},
					(token) => {
						answer += token;
						renderAnswer(answerNode, answer);
						messagesNode.scrollTop = messagesNode.scrollHeight;
					},
					requestController.signal,
				);
				if (!answer.trim()) throw new Error(t('AI 没有返回内容', 'AI returned no content'));
				conversation.push({
					role: 'assistant',
					content: answer,
					thinking:
						requestMode === 'edit'
							? t('思考完毕，已生成可检查的修改。', 'Thinking complete. Edits are ready to review.')
							: t('已完成内容分析。', 'Content analysis complete.'),
				});
				sessions = [session, ...sessions.filter((item) => item.id !== session.id)];
				paintHistory();
				renderAnswer(answerNode, answer);
				if (requestMode === 'edit' && !requestController.signal.aborted) addReviewActions(answerNode, answer);
			} catch (error) {
				if (requestController.signal.aborted) {
					answerNode.innerHTML = `<div class="ai-review-note">${t('已停止生成', 'Generation stopped')}</div>`;
					return;
				}
				answerNode.innerHTML = `<div class="ai-error"><span>${t('回答失败', 'Could not answer.')}</span><button type="button" class="button" data-ai-retry><i data-lucide="rotate-ccw"></i><span>${t('重试', 'Retry')}</span></button></div>`;
				paintIcons(answerNode);
				answerNode.querySelector('[data-ai-retry]')?.addEventListener('click', () => {
					answerNode.remove();
					userNode.remove();
					const last = conversation.at(-1);
					if (last?.role === 'user' && last.content === question) conversation.pop();
					input.value = question;
					void submit();
				});
				options.onError(error);
			} finally {
				if (controller === requestController) {
					controller = null;
					setGenerating(false);
				}
			}
		};
		bindWelcomeActions = () => {
			messagesNode.querySelectorAll<HTMLButtonElement>('[data-chat-quick]').forEach((button) => {
				button.addEventListener('click', () => {
					const nextMode = button.dataset.chatQuickMode === 'edit' ? 'edit' : 'ask';
					if (modeSelect.value !== nextMode) {
						modeSelect.value = nextMode;
						modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
					}
					input.value = button.dataset.chatQuick ?? '';
					void submit();
				});
			});
		};
		historyDropdown = enhanceSelect(historySelect, {
			className: 'note-ai-history-select',
			menuMinWidth: 280,
			getActions: (option) =>
				option.value === newChatValue
					? []
					: [
							{ id: 'rename', label: t('重命名', 'Rename'), icon: Pencil },
							{ id: 'delete', label: t('删除', 'Delete'), icon: Trash2, danger: true },
						],
			onAction: async (action, option) => {
				const target = sessions.find((item) => item.id === option.value);
				if (!target) return;
				if (action.id === 'rename') {
					const title = await openTextInputDialog(
						t('重命名对话', 'Rename chat'),
						t('对话名称', 'Chat name'),
						target.title,
						t('保存', 'Save'),
						t('取消', 'Cancel'),
					);
					if (!title || title === target.title) return;
					try {
						const stored = sessions.some((item) => item.id === target.id);
						if (stored) await api.renameNoteAiChat(noteId, target.id, title);
						target.title = title;
						paintHistory();
					} catch (error) {
						options.onError(error);
					}
					return;
				}
				if (
					!(await openConfirmDialog(
						t('删除这段对话？', 'Delete this chat?'),
						target.title,
						t('删除', 'Delete'),
						t('取消', 'Cancel'),
					))
				)
					return;
				try {
					const stored = sessions.some((item) => item.id === target.id);
					if (stored) await api.deleteNoteAiChat(noteId, target.id);
					sessions = sessions.filter((item) => item.id !== target.id);
					if (session.id === target.id) createSession();
					else paintHistory();
				} catch (error) {
					options.onError(error);
				}
			},
		});
		paintHistory();
		renderConversation();
		historySelect.addEventListener('change', () => {
			if (historySelect.value === newChatValue) {
				createSession();
				return;
			}
			const next = sessions.find((item) => item.id === historySelect.value);
			if (!next) return;
			discardChatReview();
			session = next;
			conversation = session.messages;
			renderConversation();
		});
		panel.querySelector('[data-chat-new]')?.addEventListener('click', createSession);
		panel.querySelector('[data-chat-close]')?.addEventListener('click', () => {
			if (sheet) sheet.requestClose();
			else close();
		});
		send.addEventListener('click', () => {
			if (controller) controller.abort();
			else void submit();
		});
		input.addEventListener('input', () => {
			input.style.height = 'auto';
			input.style.height = `${Math.min(120, input.scrollHeight)}px`;
			// Hide welcome prompts while the user is drafting, restore if they clear it.
			if (conversation.length) return;
			if (input.value.trim()) {
				messagesNode.querySelector('.note-ai-chat-welcome')?.remove();
				return;
			}
			if (!messagesNode.querySelector('.note-ai-chat-welcome')) {
				messagesNode.innerHTML = welcomeHtml();
				paintIcons(messagesNode);
				bindWelcomeActions();
			}
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
			const matching =
				sessions.find((item) => item.id === requestedSessionId) ??
				sessions.find((item) => item.contextKey === contextKey);
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
			if (initialPrompt.trim() && panel?.isConnected) {
				input.value = initialPrompt.trim();
				input.dispatchEvent(new Event('input'));
				void submit();
			}
		}
	};
	const handleOpen = () => void open();
	const handleOpenRequested = (event: Event) => {
		const detail = (
			event as CustomEvent<{
				noteId?: string;
				conversationId?: string;
				prompt?: string;
				mode?: 'edit' | 'ask';
			}>
		).detail;
		if (detail?.noteId && detail.noteId !== noteId) return;
		void open(detail?.conversationId, detail?.prompt ?? '', detail?.mode);
	};
	trigger.addEventListener('click', handleOpen);
	root.addEventListener('r2:open-ai-chat', handleOpenRequested);
	// Keep the AI rail open while editing; only the collapse control (or unmount) closes it.
	const unregisterDisconnect = onDisconnect(root, close);
	return () => {
		trigger.removeEventListener('click', handleOpen);
		root.removeEventListener('r2:open-ai-chat', handleOpenRequested);
		unregisterDisconnect();
		close();
	};
}
