-- Telegram mini-app / public-api katalogida ko‘rsatish (POSda barqaror qoladi)
ALTER TABLE products ADD COLUMN show_in_marketplace INTEGER NOT NULL DEFAULT 1;
