import type { ApiResponse } from '@r2-webdav/shared-types';

interface Env {
	NOTES_DB: D1Database;
	API_KEY: string;
}

interface StoredChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

interface StoredChat {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	contextKey: string;
	contextLabel: string;
	messages: StoredChatMessage[];
}

const UPSTREAM = 'https://newapi.127631.xyz/v1';
const encoder = new TextEncoder();

function json<T>(payload: ApiResponse<T>, status = 200): Response {
	return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function fail(message: string, status: number): Response {
	return json({ ok: false, error: { code: status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST', message } }, status);
}

function token(request: Request): string | null {
	const bearer = request.headers.get('Authorization');
	if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
	const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)r2_session=([^;]+)/);
	return cookie ? decodeURIComponent(cookie[1]) : null;
}

async function authenticatedUser(request: Request, env: Env): Promise<string | null> {
	const value = token(request);
	if (!value) return null;
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
	const hash = [...digest].map((part) => part.toString(16).padStart(2, '0')).join('');
	const row = await env.NOTES_DB.prepare('SELECT user_id, expires_at FROM r2_webdav_sessions WHERE token_hash = ?')
		.bind(hash)
		.first<{ user_id: string; expires_at: string }>();
	return row && Date.parse(row.expires_at) > Date.now() ? row.user_id : null;
}

function parseChats(value: string | null): StoredChat[] {
	try {
		const parsed = JSON.parse(value ?? '[]') as unknown;
		return Array.isArray(parsed) ? (parsed as StoredChat[]) : [];
	} catch {
		return [];
	}
}

async function readStreamedAnswer(body: ReadableStream<Uint8Array>): Promise<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let answer = '';
	while (true) {
		const chunk = await reader.read();
		buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
		const events = buffer.split(/\n\n/);
		buffer = events.pop() ?? '';
		for (const event of events) {
			const line = event.split('\n').find((item) => item.startsWith('data:'));
			const value = line?.slice(5).trim();
			if (!value || value === '[DONE]') continue;
			try {
				const payload = JSON.parse(value) as { choices?: Array<{ delta?: { content?: string } }> };
				answer += payload.choices?.[0]?.delta?.content ?? '';
			} catch {
				// Ignore keep-alive frames from OpenAI-compatible gateways.
			}
		}
		if (chunk.done) return answer.trim();
	}
}

async function saveChatAnswer(
	env: Env,
	owner: string,
	input: {
		noteId: string;
		conversationId: string;
		text: string;
		contextKey?: string;
		contextLabel?: string;
	},
	answer: string,
): Promise<void> {
	if (!answer) return;
	const row = await env.NOTES_DB.prepare('SELECT ai_chats FROM r2_webdav_notes WHERE id = ? AND user_id = ?')
		.bind(input.noteId, owner)
		.first<{ ai_chats: string | null }>();
	if (!row) return;
	const chats = parseChats(row.ai_chats);
	const now = new Date().toISOString();
	let chat = chats.find((item) => item.id === input.conversationId);
	if (!chat) {
		chat = {
			id: input.conversationId,
			title: input.text.replace(/\s+/g, ' ').slice(0, 36) || 'New chat',
			createdAt: now,
			updatedAt: now,
			contextKey: input.contextKey ?? '',
			contextLabel: input.contextLabel ?? '',
			messages: [],
		};
		chats.unshift(chat);
	}
	chat.updatedAt = now;
	chat.messages.push({ role: 'user', content: input.text }, { role: 'assistant', content: answer });
	const next = [chat, ...chats.filter((item) => item.id !== chat!.id)].slice(0, 12);
	await env.NOTES_DB.prepare('UPDATE r2_webdav_notes SET ai_chats = ? WHERE id = ? AND user_id = ?')
		.bind(JSON.stringify(next), input.noteId, owner)
		.run();
}

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
	try {
		const owner = await authenticatedUser(request, env);
		if (!owner) return fail('Authentication required', 401);
		if (request.method === 'GET') {
			const url = new URL(request.url);
			if (url.searchParams.get('resource') === 'chats') {
				const noteId = url.searchParams.get('noteId') ?? '';
				if (!/^[0-9a-f-]{36}$/i.test(noteId)) return fail('Invalid note ID', 400);
				const row = await env.NOTES_DB.prepare('SELECT ai_chats FROM r2_webdav_notes WHERE id = ? AND user_id = ?')
					.bind(noteId, owner)
					.first<{ ai_chats: string | null }>();
				if (!row) return fail('Note not found', 404);
				return json({ ok: true, data: { chats: parseChats(row.ai_chats) } });
			}
			if (url.searchParams.get('resource') !== 'models') return fail('Unknown AI resource', 404);
			const response = await fetch(`${UPSTREAM}/models`, { headers: { Authorization: `Bearer ${env.API_KEY}` } });
			if (!response.ok) return fail('AI model service is unavailable', 502);
			const payload = (await response.json()) as {
				data?: Array<{ id?: string } | string>;
				models?: Array<{ id?: string } | string>;
			};
			const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
			const models = [
				...new Set(
					rows
						.map((item) => (typeof item === 'string' ? item : item.id)?.trim())
						.filter((id): id is string => Boolean(id)),
				),
			];
			return json({ ok: true, data: { models } });
		}
		if (request.method === 'PATCH' || request.method === 'DELETE') {
			const url = new URL(request.url);
			if (url.searchParams.get('resource') !== 'chats') return fail('Unknown AI resource', 404);
			const noteId = url.searchParams.get('noteId') ?? '';
			const chatId = url.searchParams.get('chatId') ?? '';
			if (!/^[0-9a-f-]{36}$/i.test(noteId) || !/^[0-9a-f-]{36}$/i.test(chatId)) return fail('Invalid chat ID', 400);
			const row = await env.NOTES_DB.prepare('SELECT ai_chats FROM r2_webdav_notes WHERE id = ? AND user_id = ?')
				.bind(noteId, owner)
				.first<{ ai_chats: string | null }>();
			if (!row) return fail('Note not found', 404);
			const chats = parseChats(row.ai_chats);
			const index = chats.findIndex((chat) => chat.id === chatId);
			if (index < 0) return fail('Chat not found', 404);
			if (request.method === 'DELETE') chats.splice(index, 1);
			else {
				const input = (await request.json()) as { title?: string };
				const title = input.title?.replace(/\s+/g, ' ').trim().slice(0, 80) ?? '';
				if (!title) return fail('Invalid chat title', 400);
				chats[index].title = title;
				chats[index].updatedAt = new Date().toISOString();
			}
			await env.NOTES_DB.prepare('UPDATE r2_webdav_notes SET ai_chats = ? WHERE id = ? AND user_id = ?')
				.bind(JSON.stringify(chats), noteId, owner)
				.run();
			return json({ ok: true, data: { chat: request.method === 'PATCH' ? chats[index] : null } });
		}
		if (request.method !== 'POST') return fail('Method not allowed', 405);
		const input = (await request.json()) as {
			model?: string;
			action?: string;
			mode?: string;
			text?: string;
			instruction?: string;
			context?: string;
			noteId?: string;
			conversationId?: string;
			contextKey?: string;
			contextLabel?: string;
		};
		if (!input.model?.trim() || input.model.length > 200 || !input.text?.trim() || input.text.length > 120_000)
			return fail('Invalid AI request', 400);
		const language =
			input.action === 'rewrite'
				? 'Use the same language as the user text. Do not wrap the whole answer in code fences.'
				: 'Use the same language as the user text. Return Markdown only, without code fences or commentary.';
		const selectionAction = input.action === 'summarize' || input.action === 'polish' || input.action === 'rewrite';
		let chatHistory = '';
		if (input.action === 'chat') {
			if (
				!input.noteId ||
				!input.conversationId ||
				!/^[0-9a-f-]{36}$/i.test(input.noteId) ||
				!/^[0-9a-f-]{36}$/i.test(input.conversationId)
			)
				return fail('Invalid chat request', 400);
			const row = await env.NOTES_DB.prepare('SELECT ai_chats FROM r2_webdav_notes WHERE id = ? AND user_id = ?')
				.bind(input.noteId, owner)
				.first<{ ai_chats: string | null }>();
			if (!row) return fail('Note not found', 404);
			const messages = parseChats(row.ai_chats).find((item) => item.id === input.conversationId)?.messages ?? [];
			chatHistory = messages
				.map((item) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.content}`)
				.join('\n\n');
		}
		const chatEdit = input.action === 'chat' && input.mode === 'edit';
		const task =
			input.action === 'chat'
				? chatEdit
					? [
							'Answer the user request using the supplied note context.',
							'If the request asks to change, rewrite, fix, translate, format, or restructure the context, return ONLY the full revised Markdown for the submitted context, without commentary or code fences.',
							'Otherwise answer the question briefly. The user can still inspect or apply edits manually.',
							'Every factual claim taken from the note must end with one or more citations in the exact form [[cite:START-END]], using the provided line numbers.',
							'Use the smallest line range that supports the claim. Never invent a line number.',
							'If the context does not contain the answer, say so directly.',
						].join(' ')
					: [
							'Answer the user question using the supplied note context.',
							'Do not propose or perform edits to the note.',
							'Every factual claim taken from the note must end with one or more citations in the exact form [[cite:START-END]], using the provided line numbers.',
							'Use the smallest line range that supports the claim. Never invent a line number.',
							'If the context does not contain the answer, say so directly.',
						].join(' ')
				: input.action === 'summarize'
					? 'Summarize ONLY the selected text below. Do not use or invent content outside that selection. Return only the summary body.'
					: input.action === 'polish'
						? 'Polish ONLY the selected text below while preserving meaning and Markdown structure. Do not expand to other document content. Return only the polished Markdown.'
						: input.action === 'rewrite'
							? [
									'Edit ONLY the selected text below according to the instruction.',
									'Do not rewrite or include content outside the selection.',
									'First line: one short plain-language sentence (no Markdown heading) describing what you changed.',
									'Then a blank line.',
									'Then the full rewritten Markdown for the selection only.',
								].join(' ')
							: 'Write a useful Markdown note from the request. Start with a single H1 heading (# Title), then a blank line, then the body.';
		const prompt = [
			task,
			language,
			input.instruction ? `Instruction: ${input.instruction}` : '',
			!selectionAction && input.context ? `Document context:\n${input.context.slice(0, 20_000)}` : '',
			chatHistory ? `Earlier conversation:\n${chatHistory}` : '',
			selectionAction ? `Selected text:\n${input.text}` : `Request:\n${input.text}`,
		]
			.filter(Boolean)
			.join('\n\n');
		const upstream = await fetch(`${UPSTREAM}/chat/completions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${env.API_KEY}`,
				'Content-Type': 'application/json',
				Accept: 'text/event-stream',
			},
			body: JSON.stringify({
				model: input.model,
				stream: true,
				temperature: 0.35,
				messages: [
					{ role: 'system', content: 'You are a careful Markdown editor inside a personal notes app.' },
					{ role: 'user', content: prompt },
				],
			}),
		});
		if (!upstream.ok || !upstream.body) return fail('AI generation failed', 502);
		let responseBody = upstream.body;
		if (input.action === 'chat') {
			const [clientBody, archiveBody] = upstream.body.tee();
			responseBody = clientBody;
			waitUntil(
				readStreamedAnswer(archiveBody)
					.then((answer) =>
						saveChatAnswer(
							env,
							owner,
							{
								noteId: input.noteId!,
								conversationId: input.conversationId!,
								text: input.text!,
								contextKey: input.contextKey,
								contextLabel: input.contextLabel,
							},
							answer,
						),
					)
					.catch((error) => console.error('AI chat history save failed', error)),
			);
		}
		return new Response(responseBody, {
			status: 200,
			headers: {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			},
		});
	} catch (cause) {
		console.error('AI function failed', cause);
		return fail('AI service is unavailable', 502);
	}
};
