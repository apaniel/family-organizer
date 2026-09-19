CREATE TABLE IF NOT EXISTS family_chat_messages (
 id TEXT PRIMARY KEY,
 person TEXT NOT NULL,
 text TEXT NOT NULL,
 answer TEXT,
 status TEXT NOT NULL,
 mode TEXT NOT NULL,
 run_id TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS family_chat_person_created ON family_chat_messages(person,created_at);
CREATE INDEX IF NOT EXISTS family_chat_status ON family_chat_messages(status,created_at);
CREATE TABLE IF NOT EXISTS family_chat_attachments (
 id TEXT PRIMARY KEY,
 message_id TEXT NOT NULL,
 filename TEXT NOT NULL,
 mime TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE,
 bytes INTEGER NOT NULL,
 sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(message_id,sha256)
);
CREATE INDEX IF NOT EXISTS family_chat_attachment_message ON family_chat_attachments(message_id);
