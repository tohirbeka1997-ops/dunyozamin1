-- 129_sales_return_workflow_p2.sql
-- P2: attachment file URL, reject metadata, senior_cashier role, permission matrix setting.

ALTER TABLE sales_returns ADD COLUMN attachment_url TEXT;
ALTER TABLE sales_returns ADD COLUMN attachment_name TEXT;
ALTER TABLE sales_returns ADD COLUMN rejected_at TEXT;
ALTER TABLE sales_returns ADD COLUMN rejected_by TEXT;
ALTER TABLE sales_returns ADD COLUMN reject_reason TEXT;

INSERT OR IGNORE INTO roles (id, code, name, description, is_active, created_at) VALUES
  ('role-senior-cashier-001', 'senior_cashier', 'Senior cashier',
   'Can approve returns under large-amount threshold; method mismatch with reason', 1, datetime('now'));

-- Documented returns permission matrix (read by UI/settings; enforcement is role-based in ReturnsService).
INSERT OR IGNORE INTO settings (id, key, value, type, description, category, is_public) VALUES
  (lower(hex(randomblob(16))), 'returns.permission_matrix', '{
  "cashier": {"create": true, "draft": true, "submit_pending": true, "orderless": false, "approve": false, "reject": false, "cancel_completed": false, "method_mismatch_complete": false, "large_complete": false},
  "senior_cashier": {"create": true, "draft": true, "submit_pending": true, "orderless": false, "approve": "under_threshold", "reject": "under_threshold", "cancel_completed": false, "method_mismatch_complete": true, "large_complete": false},
  "manager": {"create": true, "draft": true, "submit_pending": true, "orderless": true, "approve": true, "reject": true, "cancel_completed": true, "method_mismatch_complete": true, "large_complete": true},
  "admin": {"create": true, "draft": true, "submit_pending": true, "orderless": true, "approve": true, "reject": true, "cancel_completed": true, "method_mismatch_complete": true, "large_complete": true}
}', 'json',
   'Sales returns role permission matrix (documentation + FE gating; BE enforces via roles)', 'returns', 0);
