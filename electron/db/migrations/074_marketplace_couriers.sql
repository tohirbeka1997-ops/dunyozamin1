-- Persistent Telegram courier registry for bot/POS admin panels.
--
-- NOTE: This migration originally seeded a single real-person record
-- ('TOHIR3', 'Tohirbek Abdullajonov'). Personally-identifiable seed
-- data should not live in source control, so the seed was removed.
-- Existing deployments that already ran this migration keep the seeded
-- row (it was inserted as a one-time `INSERT ... WHERE NOT EXISTS`);
-- to provision new tenants, add couriers through the admin UI / RPC
-- instead of editing this file.

CREATE TABLE IF NOT EXISTS marketplace_couriers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER UNIQUE,
  username TEXT COLLATE NOCASE UNIQUE,
  display_name TEXT,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_couriers_active
  ON marketplace_couriers(active);
