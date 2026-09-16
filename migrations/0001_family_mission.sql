CREATE TABLE IF NOT EXISTS family_records (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('task','event','meal')),
 data TEXT NOT NULL CHECK(json_valid(data)), source_key TEXT UNIQUE,
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS family_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL, action TEXT NOT NULL,
 before_data TEXT, after_data TEXT, occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS family_records_kind ON family_records(kind);
