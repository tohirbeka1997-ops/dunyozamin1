-- Migration: Add payment tracking to purchase_orders
-- Adds paid_amount and payment_status fields to track supplier payments

-- Add paid_amount column (computed from supplier_payments, but cached for performance)
ALTER TABLE purchase_orders ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0;

-- Add payment_status column (computed: 'unpaid', 'partial', 'paid')
ALTER TABLE purchase_orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid';

-- Create index for payment status queries
CREATE INDEX IF NOT EXISTS idx_purchase_orders_payment_status ON purchase_orders(payment_status);

-- Update existing purchase orders to calculate their payment status
-- This is a one-time migration for existing data
UPDATE purchase_orders
SET paid_amount = COALESCE((
  SELECT SUM(amount)
  FROM supplier_payments
  WHERE supplier_payments.purchase_order_id = purchase_orders.id
), 0);

-- Set payment_status based on paid_amount vs total_amount
UPDATE purchase_orders
SET payment_status = CASE
  WHEN paid_amount = 0 THEN 'unpaid'
  WHEN paid_amount >= total_amount THEN 'paid'
  ELSE 'partial'
END
WHERE status IN ('received', 'partially_received');








































