-- Make audit_log append-only at the SQLite level (no UPDATE/DELETE).
-- INSERT remains allowed via AuditService.log.

CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is immutable: UPDATE not allowed');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is immutable: DELETE not allowed');
END;
