-- Migration: 095_password_expired_flag.sql
-- Admin-forced or post-legacy-hash accounts must reset password before login.

ALTER TABLE users ADD COLUMN password_expired INTEGER NOT NULL DEFAULT 0;
