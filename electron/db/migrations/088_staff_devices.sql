-- Staff mobile device tokens for push notifications (FCM foundation)
CREATE TABLE IF NOT EXISTS staff_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  fcm_token TEXT NOT NULL,
  platform TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staff_devices_user ON staff_devices(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_devices_user_token ON staff_devices(user_id, fcm_token);
