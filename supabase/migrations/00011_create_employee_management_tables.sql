/*
# Employee Management Enhancement

## Overview
This migration enhances the employee management system by adding contact information,
session tracking, and activity logging capabilities.

## Changes

### 1. Profiles Table Enhancement
Add missing fields to profiles table:
- `phone` (text): Employee phone number
- `email` (text): Employee email address
- `last_login` (timestamptz): Last login timestamp
- `updated_at` (timestamptz): Last profile update timestamp

### 2. Employee Sessions Table
Track employee login/logout sessions:
- `id` (uuid): Primary key
- `employee_id` (uuid): Reference to profiles
- `login_time` (timestamptz): Session start time
- `logout_time` (timestamptz): Session end time (nullable)
- `duration` (interval): Session duration (calculated)
- `ip_address` (text): Login IP address
- `created_at` (timestamptz): Record creation time

### 3. Employee Activity Logs Table
Audit trail for all employee actions:
- `id` (uuid): Primary key
- `employee_id` (uuid): Reference to profiles
- `action_type` (text): Type of action performed
- `description` (text): Action description
- `document_id` (uuid): Related document ID (nullable)
- `document_type` (text): Type of document (order, product, etc.)
- `ip_address` (text): Action IP address
- `created_at` (timestamptz): Action timestamp

### 4. Security
- No RLS policies (admin-only access through application layer)
- Indexes for performance optimization
- Automatic timestamp updates

## Notes
- All tables are designed for high-volume logging
- Indexes optimize common query patterns
- Session duration is calculated automatically on logout
*/

-- Add missing fields to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS email text,
ADD COLUMN IF NOT EXISTS last_login timestamptz,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Create index on phone and email for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active);

-- Create employee_sessions table
CREATE TABLE IF NOT EXISTS employee_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  login_time timestamptz DEFAULT now() NOT NULL,
  logout_time timestamptz,
  duration interval,
  ip_address text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for employee_sessions
CREATE INDEX IF NOT EXISTS idx_employee_sessions_employee_id ON employee_sessions(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_sessions_login_time ON employee_sessions(login_time DESC);

-- Create employee_activity_logs table
CREATE TABLE IF NOT EXISTS employee_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  action_type text NOT NULL,
  description text NOT NULL,
  document_id uuid,
  document_type text,
  ip_address text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for employee_activity_logs
CREATE INDEX IF NOT EXISTS idx_activity_logs_employee_id ON employee_activity_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON employee_activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action_type ON employee_activity_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_document ON employee_activity_logs(document_id, document_type);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at on profiles
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate session duration on logout
CREATE OR REPLACE FUNCTION calculate_session_duration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.logout_time IS NOT NULL AND OLD.logout_time IS NULL THEN
    NEW.duration = NEW.logout_time - NEW.login_time;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically calculate session duration
DROP TRIGGER IF EXISTS calculate_employee_session_duration ON employee_sessions;
CREATE TRIGGER calculate_employee_session_duration
  BEFORE UPDATE ON employee_sessions
  FOR EACH ROW
  EXECUTE FUNCTION calculate_session_duration();

-- Function to log employee activity
CREATE OR REPLACE FUNCTION log_employee_activity(
  p_employee_id uuid,
  p_action_type text,
  p_description text,
  p_document_id uuid DEFAULT NULL,
  p_document_type text DEFAULT NULL,
  p_ip_address text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  INSERT INTO employee_activity_logs (
    employee_id,
    action_type,
    description,
    document_id,
    document_type,
    ip_address
  ) VALUES (
    p_employee_id,
    p_action_type,
    p_description,
    p_document_id,
    p_document_type,
    p_ip_address
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;

-- Function to start employee session
CREATE OR REPLACE FUNCTION start_employee_session(
  p_employee_id uuid,
  p_ip_address text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  -- Update last_login in profiles
  UPDATE profiles
  SET last_login = now()
  WHERE id = p_employee_id;
  
  -- Create new session
  INSERT INTO employee_sessions (
    employee_id,
    ip_address
  ) VALUES (
    p_employee_id,
    p_ip_address
  )
  RETURNING id INTO v_session_id;
  
  -- Log activity
  PERFORM log_employee_activity(
    p_employee_id,
    'login',
    'Employee logged in',
    NULL,
    NULL,
    p_ip_address
  );
  
  RETURN v_session_id;
END;
$$;

-- Function to end employee session
CREATE OR REPLACE FUNCTION end_employee_session(
  p_session_id uuid,
  p_ip_address text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_employee_id uuid;
BEGIN
  -- Get employee_id and update session
  UPDATE employee_sessions
  SET logout_time = now()
  WHERE id = p_session_id AND logout_time IS NULL
  RETURNING employee_id INTO v_employee_id;
  
  IF v_employee_id IS NOT NULL THEN
    -- Log activity
    PERFORM log_employee_activity(
      v_employee_id,
      'logout',
      'Employee logged out',
      NULL,
      NULL,
      p_ip_address
    );
    
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$;

-- Function to get employee performance metrics
CREATE OR REPLACE FUNCTION get_employee_performance(
  p_employee_id uuid,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  total_sales bigint,
  total_revenue numeric,
  average_order_amount numeric,
  total_returns bigint,
  return_amount numeric,
  net_revenue numeric,
  transaction_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'completed') as total_sales,
    COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'completed'), 0) as total_revenue,
    COALESCE(AVG(o.total_amount) FILTER (WHERE o.status = 'completed'), 0) as average_order_amount,
    COUNT(DISTINCT r.id) as total_returns,
    COALESCE(SUM(r.total_amount), 0) as return_amount,
    COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'completed'), 0) - COALESCE(SUM(r.total_amount), 0) as net_revenue,
    COUNT(DISTINCT o.id) as transaction_count
  FROM profiles p
  LEFT JOIN orders o ON o.cashier_id = p.id
    AND (p_start_date IS NULL OR o.created_at >= p_start_date)
    AND (p_end_date IS NULL OR o.created_at <= p_end_date)
  LEFT JOIN sales_returns r ON r.cashier_id = p.id
    AND (p_start_date IS NULL OR r.created_at >= p_start_date)
    AND (p_end_date IS NULL OR r.created_at <= p_end_date)
  WHERE p.id = p_employee_id
  GROUP BY p.id;
END;
$$;

-- Grant necessary permissions
GRANT ALL ON employee_sessions TO authenticated;
GRANT ALL ON employee_activity_logs TO authenticated;
