ALTER TABLE r2_webdav_note_folders
	ADD COLUMN parent_id TEXT REFERENCES r2_webdav_note_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS r2_webdav_note_folders_parent
	ON r2_webdav_note_folders(user_id, parent_id, name COLLATE NOCASE);
