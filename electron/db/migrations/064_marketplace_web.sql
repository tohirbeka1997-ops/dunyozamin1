-- ============================================================================
-- Marketplace / Telegram Web App — TZ §4 (yangi jadvallar, mavjud jadvallarga tegmaydi)
-- ============================================================================
-- web_order_items.product_id → products.id (TEXT) — loyihadagi mahsulot kaliti TEXT

CREATE TABLE IF NOT EXISTS marketplace_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_customers_telegram ON marketplace_customers(telegram_id);

CREATE TABLE IF NOT EXISTS web_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'paid', 'processing', 'ready', 'delivered', 'cancelled')),
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('payme', 'click', 'cash')),
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  payment_id TEXT,
  total_amount INTEGER NOT NULL DEFAULT 0,
  delivery_address TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES marketplace_customers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_web_orders_customer ON web_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_web_orders_status ON web_orders(status);
CREATE INDEX IF NOT EXISTS idx_web_orders_created ON web_orders(created_at);

CREATE TABLE IF NOT EXISTS web_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_at_order INTEGER NOT NULL,
  FOREIGN KEY (order_id) REFERENCES web_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_web_order_items_order ON web_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_web_order_items_product ON web_order_items(product_id);

CREATE TABLE IF NOT EXISTS payment_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('payme', 'click')),
  event TEXT NOT NULL CHECK (event IN ('create', 'perform', 'cancel', 'check')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES web_orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payment_logs_order ON payment_logs(order_id);

-- JWT refresh / logout (TZ §2.5)
CREATE TABLE IF NOT EXISTS marketplace_refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  jti TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES marketplace_customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_marketplace_refresh_jti ON marketplace_refresh_tokens(jti);
CREATE INDEX IF NOT EXISTS idx_marketplace_refresh_customer ON marketplace_refresh_tokens(customer_id);
