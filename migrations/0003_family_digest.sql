CREATE TABLE IF NOT EXISTS family_digest (
 id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, day TEXT NOT NULL, kind TEXT NOT NULL,
 data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS family_digest_day ON family_digest(day);
CREATE TABLE IF NOT EXISTS family_documents (
 id TEXT PRIMARY KEY, digest_id TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(digest_id,sha256)
);
