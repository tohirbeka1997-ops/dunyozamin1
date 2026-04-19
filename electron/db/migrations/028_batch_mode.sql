-- ============================================================================
-- BATCH MODE (PARTIYA) TABLES
-- Migration: 028_batch_mode.sql
--
-- Purpose:
-- - Track inbound batches per product/warehouse with immutable unit_cost
-- - Track allocations (FIFO sales, returns, adjustments) linked to documents
--
-- Notes:
-- - This is additive and safe to deploy (no destructive changes).
-- - Stock "source of truth" remains inventory_movements (see InventoryService).
--   These tables are a sub-ledger for costing/audit (profit, act sverka).
-- ============================================================================

-- Batches (kirim partiyalari)
CREATE TABLE IF NOT EXISTS inventory_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,                        -- batch open date/time
  unit_cost REAL NOT NULL CHECK(unit_cost >= 0),  -- immutable cost per unit for this batch
  initial_qty REAL NOT NULL CHECK(initial_qty >= 0),
  remaining_qty REAL NOT NULL CHECK(remaining_qty >= 0),
  source_type TEXT NOT NULL,                      -- 'purchase_receive' | 'opening' | 'adjustment_in'
  source_id TEXT,                                 -- purchase_order_id / adjustment_id / etc.
  supplier_id TEXT,
  supplier_name TEXT,                             -- snapshot
  doc_no TEXT,                                    -- PO number or OPENING-YYYYMMDD
  status TEXT NOT NULL DEFAULT 'active',           -- 'active' | 'closed'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

-- Allocations: map OUT/IN movements to specific batches
CREATE TABLE IF NOT EXISTS inventory_batch_allocations (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  direction TEXT NOT NULL,                        -- 'out' | 'in'
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_cost REAL NOT NULL CHECK(unit_cost >= 0),  -- snapshot of batch unit_cost for audit
  reference_type TEXT NOT NULL,                   -- 'order_item' | 'return_item' | 'adjustment'
  reference_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (batch_id) REFERENCES inventory_batches(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_inventory_batches_product_wh_status_opened
ON inventory_batches(product_id, warehouse_id, status, opened_at);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_product_wh_opened
ON inventory_batches(product_id, warehouse_id, opened_at);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_source
ON inventory_batches(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_inventory_batch_allocations_batch
ON inventory_batch_allocations(batch_id);

CREATE INDEX IF NOT EXISTS idx_inventory_batch_allocations_reference
ON inventory_batch_allocations(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_inventory_batch_allocations_product_wh_created
ON inventory_batch_allocations(product_id, warehouse_id, created_at);

-- ============================================================================
-- BATCH MODE: Inventory Batches + Allocations (FIFO costing)
-- Migration: 028_batch_mode.sql
--
-- Purpose:
-- - Track inbound inventory as immutable batches with per-batch cost.
-- - Track outbound/inbound allocations against batches (FIFO by opened_at).
-- - Enable accurate COGS/profit and batch-based reconciliation (Act Sverka).
--
-- Notes:
-- - Stock "source of truth" remains inventory_movements; batches are a sub-ledger for costing.
-- - Batches must never be deleted; close via status='closed' only.
-- - All CREATE statements are idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- inventory_batches: one row per inbound batch (purchase receive / opening / adjustment_in)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  opened_at TEXT NOT NULL, -- 'YYYY-MM-DD HH:MM:SS' (SQLite-friendly)
  unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
  initial_qty REAL NOT NULL CHECK(initial_qty >= 0),
  remaining_qty REAL NOT NULL CHECK(remaining_qty >= 0),
  source_type TEXT NOT NULL CHECK(source_type IN ('purchase_receive', 'opening', 'adjustment_in')),
  source_id TEXT, -- e.g. purchase_order_id / adjustment_id
  supplier_id TEXT,
  supplier_name TEXT,
  doc_no TEXT, -- e.g. PO number or OPENING-YYYYMMDD
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

-- ----------------------------------------------------------------------------
-- inventory_batch_allocations: per reference (order_item / return_item / adjustment)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_batch_allocations (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('out', 'in')),
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_cost REAL NOT NULL CHECK(unit_cost >= 0), -- snapshot of batch unit_cost at allocation time
  reference_type TEXT NOT NULL CHECK(reference_type IN ('order_item', 'return_item', 'adjustment')),
  reference_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (batch_id) REFERENCES inventory_batches(id)
);

-- ----------------------------------------------------------------------------
-- Indexes (performance)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inventory_batches_fifo
  ON inventory_batches(product_id, warehouse_id, status, opened_at, id);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_product_warehouse
  ON inventory_batches(product_id, warehouse_id);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_opened_at
  ON inventory_batches(opened_at);

CREATE INDEX IF NOT EXISTS idx_inventory_batch_allocations_batch
  ON inventory_batch_allocations(batch_id);

CREATE INDEX IF NOT EXISTS idx_inventory_batch_allocations_ref
  ON inventory_batch_allocations(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_inventory_batch_allocations_product_warehouse
  ON inventory_batch_allocations(product_id, warehouse_id);

-- ============================================================================
-- BATCH MODE (PARTIYA): Inventory Batches + Allocations (FIFO costing)
-- Migration: 028_batch_mode.sql
--
-- Adds:
--   1) inventory_batches: immutable inbound batches (purchase/opening/adjustment_in)
--   2) inventory_batch_allocations: per-document allocations (sale/return/adjustment)
--
-- Notes:
-- - Stock "source of truth" remains inventory_movements (existing design).
-- - These tables add a cost/traceability sub-ledger for FIFO and profit correctness.
-- - Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- inventory_batches
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,                  -- 'YYYY-MM-DD HH:MM:SS'
  unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
  initial_qty REAL NOT NULL CHECK(initial_qty >= 0),
  remaining_qty REAL NOT NULL CHECK(remaining_qty >= 0),
  source_type TEXT NOT NULL,                -- 'purchase_receive' | 'opening' | 'adjustment_in'
  source_id TEXT,                           -- purchase_order_id | inventory_adjustments.id | etc.
  supplier_id TEXT,
  supplier_name TEXT,                       -- snapshot
  doc_no TEXT,                              -- PO number or OPENING-YYYYMMDD
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT
);

-- ----------------------------------------------------------------------------
-- inventory_batch_allocations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_batch_allocations (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('out', 'in')),
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_cost REAL NOT NULL CHECK(unit_cost >= 0), -- snapshot from batch at allocation time
  reference_type TEXT NOT NULL,                  -- 'order_item' | 'return_item' | 'adjustment'
  reference_id TEXT NOT NULL,                    -- order_items.id | return_items.id | inventory_adjustment_items.id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (batch_id) REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT
);

-- ----------------------------------------------------------------------------
-- Indexes (FIFO + traceability)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inventory_batches_fifo
  ON inventory_batches(product_id, warehouse_id, status, opened_at, created_at);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_product_warehouse
  ON inventory_batches(product_id, warehouse_id);

CREATE INDEX IF NOT EXISTS idx_inventory_batch_allocations_batch
  ON inventory_batch_allocations(batch_id, created_at);

CREATE INDEX IF NOT EXISTS idx_inventory_batch_allocations_ref
  ON inventory_batch_allocations(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_inventory_batch_allocations_product_warehouse
  ON inventory_batch_allocations(product_id, warehouse_id, created_at);


