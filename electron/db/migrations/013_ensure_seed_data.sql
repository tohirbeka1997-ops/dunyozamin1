-- Migration: 013_ensure_seed_data.sql

-- 1. ASOSIY OMBOR (Main Warehouse - Single Warehouse System)
-- CRITICAL: This is the ONLY warehouse used throughout the system
INSERT OR IGNORE INTO warehouses (id, code, name, is_active, created_at, updated_at) 
VALUES ('main-warehouse-001', 'MAIN', 'Asosiy Ombor', 1, datetime('now'), datetime('now'));

-- Ensure it always exists (update if already exists with different ID)
UPDATE warehouses 
SET id = 'main-warehouse-001',
    code = 'MAIN',
    name = 'Asosiy Ombor',
    is_active = 1,
    updated_at = datetime('now')
WHERE id = 'main-warehouse-001' OR name = 'Asosiy Ombor';

-- 2. YURUVCHI MIJOZ
INSERT OR IGNORE INTO customers (id, name, phone) 
VALUES ('default-customer-001', 'Yuruvchi mijoz', '998000000000');

-- 3. ADMIN (Email ko'rinishida)
-- Frontend email talab qilgani uchun username ni email qilamiz.
-- Password: '12345' (SHA-256 hash)
-- Hash computed: echo -n '12345' | sha256sum
-- Note: Users table doesn't have a 'role' column - roles are managed via user_roles table

-- Step 1: Insert user if doesn't exist (preserves created_at)
INSERT OR IGNORE INTO users (id, username, full_name, email, password_hash, is_active, created_at, updated_at) 
VALUES (
  'default-admin-001', 
  'admin@pos.com', 
  'Administrator',
  'admin@pos.com',
  '5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5', -- SHA-256('12345')
  1,
  datetime('now'),
  datetime('now')
);

-- Step 2: ALWAYS update password_hash (ensures it's set even if user already existed)
-- This is critical because INSERT OR IGNORE won't update existing rows
UPDATE users 
SET password_hash = '5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5',
    updated_at = datetime('now'),
    is_active = 1,
    email = COALESCE(email, 'admin@pos.com'),
    full_name = COALESCE(full_name, 'Administrator')
WHERE id = 'default-admin-001';

-- Assign admin role to admin user (CRITICAL for RBAC)
-- Step 1: Ensure admin role exists in roles table
INSERT OR IGNORE INTO roles (id, code, name, description, is_active, created_at)
VALUES ('role-admin-001', 'admin', 'Administrator', 'Full system access', 1, datetime('now'));

-- Step 2: ALWAYS ensure admin user is linked to admin role
-- Use INSERT OR REPLACE to update if link already exists
INSERT OR REPLACE INTO user_roles (id, user_id, role_id, assigned_at)
VALUES ('ur-admin-001', 'default-admin-001', 'role-admin-001', datetime('now'));

-- Step 3: Safety check - If INSERT OR REPLACE didn't work, use UPDATE as fallback
-- This ensures the role is ALWAYS assigned, even if user_roles entry exists
UPDATE user_roles
SET role_id = 'role-admin-001',
    assigned_at = datetime('now')
WHERE user_id = 'default-admin-001' AND id = 'ur-admin-001';

-- Step 4: If no user_roles entry exists at all, insert it
-- This handles edge cases where UPDATE didn't find a row
INSERT OR IGNORE INTO user_roles (id, user_id, role_id, assigned_at)
SELECT 'ur-admin-001', 'default-admin-001', 'role-admin-001', datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles WHERE user_id = 'default-admin-001' AND role_id = 'role-admin-001'
);

-- 4. Payment Methods
CREATE TABLE IF NOT EXISTS payment_methods (slug TEXT PRIMARY KEY, name TEXT);
INSERT OR IGNORE INTO payment_methods (slug, name) VALUES ('cash', 'Naqd pul'), ('card', 'Karta');