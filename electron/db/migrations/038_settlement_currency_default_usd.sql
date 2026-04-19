-- ============================================================================
-- 038 - Default supplier settlement currency to USD (for new USD-based ledger)
-- ============================================================================

-- Normalize missing settlement currency to USD (do not overwrite explicit values)
UPDATE suppliers
SET settlement_currency = 'USD'
WHERE settlement_currency IS NULL OR TRIM(settlement_currency) = '';
