-- Ommaviy narx yangilash (bulk price update) uchun batch guruhlash.
-- Har bir ommaviy amal bitta batch_id bilan belgilanadi — shu orqali
-- "Orqaga qaytarish" (undo) aniq oxirgi amalni qaytaradi.
ALTER TABLE price_history ADD COLUMN batch_id TEXT;

CREATE INDEX IF NOT EXISTS idx_price_history_batch ON price_history(batch_id);
