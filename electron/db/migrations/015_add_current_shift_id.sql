-- Migration: 015_add_current_shift_id.sql
-- Purpose: Add current_shift_id column to users table for shift persistence

-- Add current_shift_id column to users table
ALTER TABLE users ADD COLUMN current_shift_id TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_current_shift ON users(current_shift_id);

-- Add foreign key constraint (optional, but recommended for data integrity)
-- Note: SQLite doesn't support adding FK constraints via ALTER TABLE,
-- so this would need to be done via table recreation if strict FK is required
-- For now, we'll rely on application logic to maintain referential integrity















































