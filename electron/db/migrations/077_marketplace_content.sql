-- 077_marketplace_content.sql
-- Admin-managed marketing content for the customer-facing mini-app:
--  * promo banner carousel (multiple slides, sort order, optional schedule)
--  * "Daily Deal" — a manual override that pins a single product as the
--    featured pick of the day. Falls back to the trending feed when no
--    row is present for today.

CREATE TABLE IF NOT EXISTS marketplace_promo_banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emoji TEXT,                      -- e.g. "🚚"
  title TEXT NOT NULL,             -- top label (small)
  subtitle TEXT NOT NULL,          -- big headline
  cta_text TEXT,                   -- button label
  cta_link TEXT,                   -- in-app path or full URL
  -- One of: 'primary' (dz-brand-bg), 'cream' (dz-cream-bg), 'teal'
  -- (dz-teal-bg). Frontend maps these to background classes.
  theme TEXT NOT NULL DEFAULT 'primary',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  -- Optional schedule. NULL on either side means "no bound".
  starts_at TEXT NULL,
  ends_at TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_promo_banners_active
  ON marketplace_promo_banners(is_active, sort_order);

-- Daily deal overrides. One row per featured_date. We keep history so
-- the admin can see what was featured in the past.
CREATE TABLE IF NOT EXISTS marketplace_daily_deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  featured_date TEXT NOT NULL UNIQUE,         -- YYYY-MM-DD
  product_id TEXT NOT NULL,
  badge_text TEXT,                             -- optional override e.g. "✦ Bugun -20%"
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_daily_deals_date
  ON marketplace_daily_deals(featured_date);

-- Seed the four legacy hardcoded slides so newly-migrated installs
-- see the same UX out of the box. Admin can edit/delete freely after.
INSERT INTO marketplace_promo_banners
  (emoji, title, subtitle, cta_text, cta_link, theme, sort_order, is_active)
SELECT * FROM (
  SELECT '🚚' AS emoji, '300K dan ortiq xaridga' AS title,
         'BEPUL yetkazib berish' AS subtitle, 'Hoziroq xarid →' AS cta_text,
         '/catalog' AS cta_link, 'primary' AS theme, 1 AS sort_order, 1 AS is_active
  UNION ALL
  SELECT '✦', 'Har xaridda', '1% bonus ball', 'Profilim →', '/profile', 'cream', 2, 1
  UNION ALL
  SELECT '⚡', 'Toshkent boʻyicha', '60 daqiqada eshigingizda',
         'Tezkor buyurtma →', '/catalog?quick=in_stock', 'teal', 3, 1
  UNION ALL
  SELECT '💬', 'Savol bormi?', 'Operator 5 daqiqada javob',
         'Yordam markazi →', '/help', 'cream', 4, 1
)
WHERE NOT EXISTS (SELECT 1 FROM marketplace_promo_banners);
