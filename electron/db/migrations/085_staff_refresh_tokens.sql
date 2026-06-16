-- Staff mobile app: JWT refresh tokens + sales role

CREATE TABLE IF NOT EXISTS staff_refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  jti TEXT NOT NULL UNIQUE,
  device_id TEXT,
  platform TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staff_refresh_jti ON staff_refresh_tokens(jti);
CREATE INDEX IF NOT EXISTS idx_staff_refresh_user ON staff_refresh_tokens(user_id);

INSERT OR IGNORE INTO roles (id, code, name, description, is_active, created_at)
VALUES ('role-sales-001', 'sales', 'Sales / Online orders', 'Web orders and field sales', 1, datetime('now'));
