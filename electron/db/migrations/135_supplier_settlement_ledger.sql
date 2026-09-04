-- 135_supplier_settlement_ledger.sql
-- Dual supplier buckets (debt + advance) per UZS/USD, audit ledger, refund-pending advances.

-- ---------------------------------------------------------------------------
-- Advance kind: usable prepaid vs cash refund expected
-- ---------------------------------------------------------------------------
ALTER TABLE supplier_advances ADD COLUMN kind TEXT NOT NULL DEFAULT 'advance';

CREATE INDEX IF NOT EXISTS idx_supplier_advances_kind
  ON supplier_advances(supplier_id, kind, currency);

-- ---------------------------------------------------------------------------
-- Settlement audit ledger (old/new debt + advance per operation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_settlement_ledger (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  op_type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UZS',
  amount REAL NOT NULL,
  debt_before REAL NOT NULL DEFAULT 0,
  debt_after REAL NOT NULL DEFAULT 0,
  advance_before REAL NOT NULL DEFAULT 0,
  advance_after REAL NOT NULL DEFAULT 0,
  purchase_order_id TEXT,
  payment_id TEXT,
  return_id TEXT,
  reason TEXT,
  payment_method TEXT,
  cash_source TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  idempotency_key TEXT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_settlement_ledger_supplier
  ON supplier_settlement_ledger(supplier_id, created_at);

CREATE INDEX IF NOT EXISTS idx_supplier_settlement_ledger_op
  ON supplier_settlement_ledger(op_type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_settlement_ledger_idempotency
  ON supplier_settlement_ledger(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND TRIM(idempotency_key) != '';

-- ---------------------------------------------------------------------------
-- Backfill: signed overpay (paid > received PO totals) that is not already
-- sitting in supplier_advances becomes an explicit advance bucket.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO supplier_advances (
  id, advance_number, supplier_id, currency, amount, amount_remaining,
  notes, created_at, updated_at, kind
)
SELECT
  lower(hex(randomblob(16))),
  'SADV-BF-' || s.id,
  s.id,
  CASE WHEN UPPER(COALESCE(s.settlement_currency, 'UZS')) = 'USD' THEN 'USD' ELSE 'UZS' END,
  gap.gap,
  gap.gap,
  'Backfill: ortiqcha to‘lov / taqsimlanmagan to‘lov — yetkazib beruvchi avansi',
  datetime('now'),
  datetime('now'),
  'advance'
FROM suppliers s
INNER JOIN (
  SELECT
    s.id AS supplier_id,
    CASE
      WHEN UPPER(COALESCE(s.settlement_currency, 'UZS')) = 'USD'
        THEN MAX(
          0,
          COALESCE((
            SELECT SUM(COALESCE(sp.amount_usd, 0))
            FROM supplier_payments sp
            WHERE sp.supplier_id = s.id
              AND sp.cancelled_at IS NULL
          ), 0)
          - COALESCE((
            SELECT SUM(COALESCE(po.total_usd, 0))
            FROM purchase_orders po
            WHERE po.supplier_id = s.id
              AND po.status IN ('received', 'partially_received')
          ), 0)
          - COALESCE((
            SELECT SUM(sa.amount_remaining)
            FROM supplier_advances sa
            WHERE sa.supplier_id = s.id
              AND UPPER(COALESCE(sa.currency, 'USD')) = 'USD'
          ), 0)
        )
      ELSE MAX(
        0,
        COALESCE((
          SELECT SUM(COALESCE(sp.amount, 0))
          FROM supplier_payments sp
          WHERE sp.supplier_id = s.id
            AND sp.cancelled_at IS NULL
        ), 0)
        - COALESCE((
          SELECT SUM(COALESCE(po.total_amount, 0))
          FROM purchase_orders po
          WHERE po.supplier_id = s.id
            AND po.status IN ('received', 'partially_received')
        ), 0)
        - COALESCE((
          SELECT SUM(sa.amount_remaining)
          FROM supplier_advances sa
          WHERE sa.supplier_id = s.id
            AND UPPER(COALESCE(sa.currency, 'UZS')) = 'UZS'
        ), 0)
      )
    END AS gap
  FROM suppliers s
) gap ON gap.supplier_id = s.id
WHERE gap.gap > 0.02;
