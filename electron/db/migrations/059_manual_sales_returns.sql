PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS sales_returns_manual_tmp (
  id TEXT PRIMARY KEY,
  return_number TEXT NOT NULL UNIQUE,
  order_id TEXT,
  customer_id TEXT,
  cashier_id TEXT NOT NULL,
  user_id TEXT,
  warehouse_id TEXT,
  shift_id TEXT,
  return_reason TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  refund_amount REAL NOT NULL DEFAULT 0,
  refund_method TEXT,
  return_mode TEXT NOT NULL DEFAULT 'order',
  status TEXT NOT NULL DEFAULT 'completed',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

INSERT INTO sales_returns_manual_tmp (
  id,
  return_number,
  order_id,
  customer_id,
  cashier_id,
  user_id,
  warehouse_id,
  shift_id,
  return_reason,
  total_amount,
  refund_amount,
  refund_method,
  return_mode,
  status,
  notes,
  created_at
)
SELECT
  id,
  return_number,
  order_id,
  customer_id,
  cashier_id,
  user_id,
  warehouse_id,
  shift_id,
  return_reason,
  total_amount,
  refund_amount,
  refund_method,
  'order',
  status,
  notes,
  created_at
FROM sales_returns;

DROP TABLE sales_returns;
ALTER TABLE sales_returns_manual_tmp RENAME TO sales_returns;

CREATE INDEX IF NOT EXISTS idx_sales_returns_number ON sales_returns(return_number);
CREATE INDEX IF NOT EXISTS idx_sales_returns_order ON sales_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_customer ON sales_returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_status ON sales_returns(status);
CREATE INDEX IF NOT EXISTS idx_sales_returns_created_at ON sales_returns(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_returns_mode ON sales_returns(return_mode);

CREATE TABLE IF NOT EXISTS return_items_manual_tmp (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL,
  order_item_id TEXT,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sale_unit TEXT,
  qty_sale REAL,
  qty_base REAL,
  base_price REAL,
  usta_price REAL,
  discount_type TEXT,
  discount_value REAL,
  final_unit_price REAL,
  final_total REAL,
  price_source TEXT,
  FOREIGN KEY (return_id) REFERENCES sales_returns(id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

INSERT INTO return_items_manual_tmp (
  id,
  return_id,
  order_item_id,
  product_id,
  product_name,
  quantity,
  unit_price,
  line_total,
  created_at,
  sale_unit,
  qty_sale,
  qty_base,
  base_price,
  usta_price,
  discount_type,
  discount_value,
  final_unit_price,
  final_total,
  price_source
)
SELECT
  id,
  return_id,
  order_item_id,
  product_id,
  product_name,
  quantity,
  unit_price,
  line_total,
  created_at,
  sale_unit,
  qty_sale,
  qty_base,
  base_price,
  usta_price,
  discount_type,
  discount_value,
  final_unit_price,
  final_total,
  price_source
FROM return_items;

DROP TABLE return_items;
ALTER TABLE return_items_manual_tmp RENAME TO return_items;

CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_return_items_order_item ON return_items(order_item_id);
CREATE INDEX IF NOT EXISTS idx_return_items_product ON return_items(product_id);

PRAGMA foreign_keys=ON;
