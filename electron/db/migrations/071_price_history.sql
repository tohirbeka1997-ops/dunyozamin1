-- Mahsulot narx o'zgarishlari (PriceChangeHistoryReport / getPriceChangeHistory)
CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  price_type TEXT NOT NULL, -- 'purchase' | 'sale' | 'master' | 'unit'
  old_price REAL NOT NULL DEFAULT 0,
  new_price REAL NOT NULL DEFAULT 0,
  changed_by TEXT,
  changed_at TEXT NOT NULL,
  reason TEXT,
  unit TEXT, -- 'unit' turi uchun: kg, dona, ...
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_changed_at ON price_history(changed_at);
CREATE INDEX IF NOT EXISTS idx_price_history_type ON price_history(price_type);
