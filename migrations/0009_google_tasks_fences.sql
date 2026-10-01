-- Additive transport fencing; family records and audit history remain untouched.
DROP INDEX IF EXISTS google_tasks_command_intent;
CREATE TABLE IF NOT EXISTS google_tasks_generation (id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL, captured_at INTEGER NOT NULL);
INSERT OR IGNORE INTO google_tasks_generation VALUES(1,0,0);
CREATE TABLE IF NOT EXISTS google_tasks_transition_guard (id INTEGER PRIMARY KEY CHECK(id=1));
