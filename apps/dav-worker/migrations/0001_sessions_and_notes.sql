CREATE TABLE IF NOT EXISTS r2_webdav_sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	token_hash TEXT NOT NULL UNIQUE,
	device_name TEXT NOT NULL,
	browser TEXT NOT NULL,
	platform TEXT NOT NULL,
	device_type TEXT NOT NULL,
	ip TEXT,
	user_agent TEXT,
	created_at TEXT NOT NULL,
	last_seen_at TEXT NOT NULL,
	expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS r2_webdav_sessions_user_expiry
	ON r2_webdav_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS r2_webdav_notes (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	title TEXT NOT NULL,
	content TEXT NOT NULL DEFAULT '',
	is_pinned INTEGER NOT NULL DEFAULT 0,
	is_archived INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	accessed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS r2_webdav_notes_user_order
	ON r2_webdav_notes(user_id, is_archived, is_pinned DESC, updated_at DESC);
