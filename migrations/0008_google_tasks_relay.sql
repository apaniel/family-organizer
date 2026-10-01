-- Transport and Google mirror only. Never seed from family_records.
CREATE TABLE IF NOT EXISTS google_tasks_mirror (
 id INTEGER PRIMARY KEY CHECK(id=1), records TEXT NOT NULL, refreshed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS google_tasks_commands (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, payload TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','leased','executing','done','failed','ambiguous')),
 created_at INTEGER NOT NULL, lease_until INTEGER, lease_token TEXT,
 result TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS google_tasks_command_state ON google_tasks_commands(state,created_at);
