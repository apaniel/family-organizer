-- Keep historic approvals for audit; only live approvals enter this index.
CREATE INDEX IF NOT EXISTS family_pending_approvals
ON family_records(json_extract(data,'$.approval.status'), json_extract(data,'$.approval.expiresAt'), created_at DESC)
WHERE source_key >= 'approval:' AND source_key < 'approval;'
  AND json_extract(data,'$.approval.status') = 'pending';
