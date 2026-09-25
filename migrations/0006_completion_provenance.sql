-- Historical audit rows retain unknown provenance (NULL).
ALTER TABLE family_audit ADD COLUMN completion_mode TEXT
 CHECK (completion_mode IN ('explicit','inferred'));
ALTER TABLE family_audit ADD COLUMN completion_channel TEXT
 CHECK (completion_channel IN ('dashboard','whatsapp','telegram','email','other'));
CREATE INDEX family_audit_occurred_at ON family_audit(occurred_at);
