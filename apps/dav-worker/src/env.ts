export interface Env {
	bucket: R2Bucket;
	NOTES_DB: D1Database;
	USERNAME: string;
	PASSWORD: string;
	JWT_SECRET?: string;
	JWT_TTL_SECONDS?: string;
	CORS_ORIGIN?: string;
	APP_ORIGIN?: string;
}

export const DEFAULT_USER = 'default';
export const FILE_ROOT = `fs/${DEFAULT_USER}`;
export const CALDAV_ROOT = `caldav/${DEFAULT_USER}`;
