export type ApiErrorCode =
	| 'BAD_REQUEST'
	| 'UNAUTHORIZED'
	| 'FORBIDDEN'
	| 'NOT_FOUND'
	| 'CONFLICT'
	| 'LOCKED'
	| 'PRECONDITION_FAILED'
	| 'INTERNAL_ERROR';

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: { code: ApiErrorCode; message: string } };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface FileEntry {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size: number;
	contentType?: string;
	modifiedAt: string;
	etag: string;
}

export interface FileListing {
	path: string;
	entries: FileEntry[];
}

export interface CalendarSummary {
	id: string;
	displayName: string;
	color: string;
	ctag: string;
}

export interface CalendarEvent {
	uid: string;
	title: string;
	start: string;
	end: string;
	allDay: boolean;
	description?: string;
	location?: string;
	calendarId: string;
	etag?: string;
	kind?: 'event' | 'birthday';
	calendarSystem?: 'solar' | 'lunar';
	recurrence?: 'yearly';
	seriesStart?: string;
	lunarDate?: {
		year: number;
		month: number;
		day: number;
		leap: boolean;
	};
}

export interface DeviceSession {
	id: string;
	name: string;
	browser: string;
	platform: string;
	type: 'desktop' | 'mobile' | 'tablet' | 'unknown';
	ip?: string;
	createdAt: string;
	lastSeenAt: string;
	expiresAt: string;
	current: boolean;
}

export interface Note {
	id: string;
	title: string;
	content: string;
	pinned: boolean;
	archived: boolean;
	createdAt: string;
	updatedAt: string;
	accessedAt: string;
}

export interface NotePage {
	items: Note[];
	page: number;
	pageSize: number;
	total: number;
	hasMore: boolean;
}
