-- ============================================================================
-- Password Reset Tokens Table
-- Migration: 012_password_reset_tokens.sql
-- ============================================================================

-- Password reset tokens table
-- Stores reset codes with hashed values for security
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL, -- SHA-256 hash of code + salt
  salt TEXT NOT NULL, -- Random salt for code hashing
  expires_at TEXT NOT NULL, -- ISO string
  used_at TEXT NULL, -- ISO string when token was used (NULL if not used)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for password reset tokens
CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_expires_at ON password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_prt_used_at ON password_reset_tokens(used_at);




















































