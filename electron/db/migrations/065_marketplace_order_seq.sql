-- WO-YYYY-NNNNN raqamlari uchun atomik ketma-ketlik (yil bo'yicha)
CREATE TABLE IF NOT EXISTS marketplace_order_seq (
  year INTEGER NOT NULL PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0
);
