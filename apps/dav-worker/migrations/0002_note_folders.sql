CREATE TABLE IF NOT EXISTS r2_webdav_note_folders (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	name TEXT NOT NULL COLLATE NOCASE,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE(user_id, name)
);

ALTER TABLE r2_webdav_notes ADD COLUMN folder_id TEXT REFERENCES r2_webdav_note_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS r2_webdav_notes_folder
	ON r2_webdav_notes(user_id, folder_id, is_archived, updated_at DESC);
