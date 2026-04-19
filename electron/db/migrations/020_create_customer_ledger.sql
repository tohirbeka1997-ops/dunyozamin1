-- Migration: 020_create_customer_ledger.sql
-- Creates customer_ledger table to track all balance-changing events
-- This is the single source of truth for customer account history

CREATE TABLE IF NOT EXISTS customer_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sale', 'payment_in', 'payment_out', 'refund', 'adjustment')),  -- 'sale' | 'payment_in' | 'payment_out' | 'refund' | 'adjustment'
  ref_id TEXT,         -- order_id / return_id / payment_id (nullable)
  ref_no TEXT,         -- human readable ORD-... / RET-... / PAY-... (nullable)
  amount INTEGER NOT NULL,  -- signed delta applied to customer balance (can be positive or negative)
  balance_after INTEGER NOT NULL,  -- running balance after this transaction
  note TEXT,           -- optional note/description
  method TEXT,         -- payment method (cash, card, etc.)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT,     -- user_id who created this entry
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer_created ON customer_ledger(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_type ON customer_ledger(type);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_ref_id ON customer_ledger(ref_id);

