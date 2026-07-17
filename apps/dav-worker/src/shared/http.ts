import type { ApiErrorCode, ApiFailure, ApiSuccess } from '@r2-webdav/shared-types';

export function jsonData<T>(data: T, init: ResponseInit = {}): Response {
	const body: ApiSuccess<T> = { ok: true, data };
	const headers = new Headers(init.headers);
	headers.set('Content-Type', 'application/json; charset=utf-8');
	return new Response(JSON.stringify(body), { ...init, headers });
}

export function jsonError(code: ApiErrorCode, message: string, status = 400): Response {
	const body: ApiFailure = { ok: false, error: { code, message } };
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
	});
}

export function errorFromStatus(status: number, fallback: string): Response {
	const errors: Record<number, [ApiErrorCode, string]> = {
		400: ['BAD_REQUEST', fallback],
		401: ['UNAUTHORIZED', 'Authentication required'],
		403: ['FORBIDDEN', fallback],
		404: ['NOT_FOUND', fallback],
		409: ['CONFLICT', fallback],
		412: ['PRECONDITION_FAILED', fallback],
		423: ['LOCKED', 'The resource is locked'],
	};
	const [code, message] = errors[status] ?? ['INTERNAL_ERROR', fallback];
	return jsonError(code, message, status >= 400 && status < 600 ? status : 500);
}

export function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

export function decodePathSegment(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}
