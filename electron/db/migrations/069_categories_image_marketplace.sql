-- Kategoriya rasmi (mini-app / katalog) va marketplace ko‘rinishi
ALTER TABLE categories ADD COLUMN image_url TEXT;
ALTER TABLE categories ADD COLUMN show_in_marketplace INTEGER NOT NULL DEFAULT 1;
