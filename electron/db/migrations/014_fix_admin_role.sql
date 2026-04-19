-- Migration: 014_fix_admin_role.sql
-- Purpose: Ensure admin@pos.com user always has admin role assigned
-- This migration fixes existing databases where admin user might not have the role assigned

-- Step 1: Ensure admin role exists
INSERT OR IGNORE INTO roles (id, code, name, description, is_active, created_at)
VALUES ('role-admin-001', 'admin', 'Administrator', 'Full system access', 1, datetime('now'));

-- Step 2: Find admin user by username
-- Get the admin user ID (might be 'default-admin-001' or something else)
-- Update all admin@pos.com users to have admin role

-- Step 3: Delete any existing role assignments for admin user (to avoid duplicates)
DELETE FROM user_roles 
WHERE user_id IN (SELECT id FROM users WHERE username = 'admin@pos.com' OR email = 'admin@pos.com')
  AND role_id != 'role-admin-001';

-- Step 4: Assign admin role to all admin@pos.com users
INSERT OR REPLACE INTO user_roles (id, user_id, role_id, assigned_at)
SELECT 
  'ur-admin-' || users.id,
  users.id,
  'role-admin-001',
  datetime('now')
FROM users
WHERE (username = 'admin@pos.com' OR email = 'admin@pos.com')
  AND NOT EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = users.id AND role_id = 'role-admin-001'
  );

-- Step 5: Update existing user_roles entries to ensure they point to admin role
UPDATE user_roles
SET role_id = 'role-admin-001',
    assigned_at = datetime('now')
WHERE user_id IN (SELECT id FROM users WHERE username = 'admin@pos.com' OR email = 'admin@pos.com')
  AND role_id != 'role-admin-001';



































