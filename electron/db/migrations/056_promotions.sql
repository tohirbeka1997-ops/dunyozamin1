-- ============================================================================
-- 056 - Promotions (Aksiya) module
-- ============================================================================
-- Tables: promotions, promotion_scope, promotion_condition, promotion_reward,
--         promotion_usage, promotion_audit
-- order_items.promotion_id for tracking applied promo
-- ============================================================================

-- Promotions (main entity)
CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('percent_discount', 'amount_discount', 'fixed_price')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'expired', 'archived', 'cancelled')),
  store_id TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  combinable INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

-- Scope: which products/categories the promo applies to
CREATE TABLE IF NOT EXISTS promotion_scope (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('all', 'products', 'categories')),
  scope_ids TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE
);

-- Conditions: min_qty, min_amount, promo_code
CREATE TABLE IF NOT EXISTS promotion_condition (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL UNIQUE,
  min_qty REAL,
  min_amount REAL,
  promo_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE
);

-- Reward: discount_percent, discount_amount, or fixed_price (one per type)
CREATE TABLE IF NOT EXISTS promotion_reward (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL UNIQUE,
  discount_percent REAL,
  discount_amount REAL,
  fixed_price REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE
);

-- Usage tracking: when promo was applied to which order/item
CREATE TABLE IF NOT EXISTS promotion_usage (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_item_id TEXT,
  discount_amount REAL NOT NULL DEFAULT 0,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (promotion_id) REFERENCES promotions(id),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (order_item_id) REFERENCES order_items(id)
);

-- Audit log for promotions
CREATE TABLE IF NOT EXISTS promotion_audit (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (promotion_id) REFERENCES promotions(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_promotions_status ON promotions(status);
CREATE INDEX IF NOT EXISTS idx_promotions_type ON promotions(type);
CREATE INDEX IF NOT EXISTS idx_promotions_dates ON promotions(start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_promotions_store ON promotions(store_id);
CREATE INDEX IF NOT EXISTS idx_promotion_scope_promotion ON promotion_scope(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_condition_promotion ON promotion_condition(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_reward_promotion ON promotion_reward(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_usage_promotion ON promotion_usage(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_usage_order ON promotion_usage(order_id);
CREATE INDEX IF NOT EXISTS idx_promotion_audit_promotion ON promotion_audit(promotion_id);

-- Add promotion_id to order_items (for tracking which promo was applied)
ALTER TABLE order_items ADD COLUMN promotion_id TEXT;
CREATE INDEX IF NOT EXISTS idx_order_items_promotion ON order_items(promotion_id);
