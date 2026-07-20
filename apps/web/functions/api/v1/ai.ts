import type { ApiResponse } from '@r2-webdav/shared-types';

interface Env {
	NOTES_DB: D1Database;
	API_KEY: string;
}

const UPSTREAM = 'https://newapi.127631.xyz/v1';
const MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro', 'kimi-k3'];
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

async function authenticated(request: Request, env: Env): Promise<boolean> {
	const value = token(request);
	if (!value) return false;
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
	const hash = [...digest].map((part) => part.toString(16).padStart(2, '0')).join('');
	const row = await env.NOTES_DB.prepare('SELECT expires_at FROM r2_webdav_sessions WHERE token_hash = ?')
		.bind(hash)
		.first<{ expires_at: string }>();
	return Boolean(row && Date.parse(row.expires_at) > Date.now());
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
	try {
		if (!(await authenticated(request, env))) return fail('Authentication required', 401);
		if (request.method === 'GET') {
			if (new URL(request.url).searchParams.get('resource') !== 'models') return fail('Unknown AI resource', 404);
			const response = await fetch(`${UPSTREAM}/models`, { headers: { Authorization: `Bearer ${env.API_KEY}` } });
			if (!response.ok) return fail('AI model service is unavailable', 502);
			const payload = (await response.json()) as { data?: Array<{ id?: string }> };
			const available = new Set(
				(payload.data ?? [])
					.map((item) => (typeof item.id === 'string' ? item.id.trim().toLowerCase() : null))
					.filter((id): id is string => Boolean(id)),
			);
			const models = MODELS.filter((model) => available.has(model.toLowerCase()));
			// If the gateway renames the curated models, fall back to the full upstream list
			// so the client always gets something selectable instead of an empty list.
			return json({ ok: true, data: { models: models.length ? models : [...available] } });
		}
		if (request.method !== 'POST') return fail('Method not allowed', 405);
		const input = (await request.json()) as {
			model?: string;
			action?: string;
			text?: string;
			instruction?: string;
			context?: string;
		};
		if (!MODELS.includes(input.model ?? '') || !input.text?.trim() || input.text.length > 120_000)
			return fail('Invalid AI request', 400);
		const language =
			input.action === 'rewrite'
				? 'Use the same language as the user text. Do not wrap the whole answer in code fences.'
				: 'Use the same language as the user text. Return Markdown only, without code fences or commentary.';
		const task =
			input.action === 'summarize'
				? 'Summarize the selected text concisely in Markdown. Return only the summary body.'
				: input.action === 'polish'
					? 'Polish the writing while preserving meaning and Markdown structure. Return only the polished Markdown.'
					: input.action === 'rewrite'
						? [
							'Edit the selected text according to the instruction.',
							'First line: one short plain-language sentence (no Markdown heading) describing what you changed, e.g. "已按照你的要求添加了代码，请查看" / "Added the requested code snippet."',
							'Then a blank line.',
							'Then the full rewritten Markdown only.',
							'Do not put the summary after the body.',
						  ].join(' ')
						: 'Write a useful Markdown note from the request. Start with a single H1 heading (# Title) that captures the topic as the note title, then a blank line, then the body.';
		const prompt = [
			task,
			language,
			input.instruction ? `Instruction: ${input.instruction}` : '',
			input.context ? `Document context:\n${input.context.slice(0, 20_000)}` : '',
			`Text or request:\n${input.text}`,
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
		return new Response(upstream.body, {
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
