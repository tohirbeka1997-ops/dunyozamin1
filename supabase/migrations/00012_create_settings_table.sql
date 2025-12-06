/*
# Settings Management System

## Overview
This migration creates a flexible settings system for storing all POS configuration.

## Changes

### 1. Settings Table
Store all system configuration in key-value format:
- `id` (uuid): Primary key
- `category` (text): Setting category (company, pos, payment, receipt, inventory, numbering, security, localization)
- `key` (text): Setting key (unique within category)
- `value` (jsonb): Setting value (supports complex data structures)
- `description` (text): Human-readable description
- `updated_by` (uuid): User who last updated the setting
- `updated_at` (timestamptz): Last update timestamp
- `created_at` (timestamptz): Creation timestamp

### 2. Indexes
- Composite unique index on (category, key)
- Index on category for fast category-based queries
- Index on updated_at for audit trails

### 3. Default Settings
Initialize all default settings for:
- Company profile
- POS terminal configuration
- Payment methods and taxes
- Receipt templates
- Inventory management
- Numbering formats
- Security policies
- Localization preferences

### 4. Security
- No RLS (admin-only access through application layer)
- Audit logging for all changes
- Updated_by tracking

## Notes
- JSONB allows flexible schema for different setting types
- Settings can be easily extended without schema changes
- All settings have sensible defaults
*/

-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_by uuid REFERENCES profiles(id),
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(category, key)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
CREATE INDEX IF NOT EXISTS idx_settings_updated_at ON settings(updated_at DESC);

-- Trigger to update updated_at
DROP TRIGGER IF EXISTS update_settings_updated_at ON settings;
CREATE TRIGGER update_settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert default company settings
INSERT INTO settings (category, key, value, description) VALUES
('company', 'name', '"POS System"', 'Company name'),
('company', 'legal_name', '""', 'Legal company name'),
('company', 'logo_url', '""', 'Company logo URL'),
('company', 'address_country', '"Uzbekistan"', 'Country'),
('company', 'address_city', '"Tashkent"', 'City'),
('company', 'address_street', '""', 'Street address'),
('company', 'phone', '""', 'Contact phone number'),
('company', 'email', '""', 'Contact email'),
('company', 'website', '""', 'Company website'),
('company', 'tax_id', '""', 'Tax ID / INN / VAT number')
ON CONFLICT (category, key) DO NOTHING;

-- Insert default POS terminal settings
INSERT INTO settings (category, key, value, description) VALUES
('pos', 'mode', '"retail"', 'POS mode: retail or restaurant'),
('pos', 'enable_hold_order', 'true', 'Enable hold order feature'),
('pos', 'enable_mixed_payment', 'true', 'Enable mixed payment methods'),
('pos', 'require_customer_for_credit', 'true', 'Require customer selection for credit sales'),
('pos', 'auto_logout_minutes', '30', 'Auto logout after inactivity (minutes)'),
('pos', 'show_low_stock_warning', 'true', 'Show low stock warning in POS'),
('pos', 'quick_access_limit', '12', 'Number of quick access products')
ON CONFLICT (category, key) DO NOTHING;

-- Insert default payment and tax settings
INSERT INTO settings (category, key, value, description) VALUES
('payment', 'methods', '["cash", "card", "terminal", "qr"]', 'Enabled payment methods'),
('payment', 'method_labels', '{"cash": "Cash", "card": "Card", "terminal": "Terminal", "qr": "QR Payment"}', 'Payment method labels'),
('tax', 'enabled', 'false', 'Enable tax system'),
('tax', 'default_rate', '15', 'Default tax rate (%)'),
('tax', 'inclusive', 'true', 'Tax inclusive in prices'),
('tax', 'per_product_override', 'false', 'Allow per-product tax override')
ON CONFLICT (category, key) DO NOTHING;

-- Insert default receipt settings
INSERT INTO settings (category, key, value, description) VALUES
('receipt', 'auto_print', 'true', 'Auto print receipt after sale'),
('receipt', 'header_text', '"Thank you for shopping with us!"', 'Receipt header text'),
('receipt', 'footer_text', '"Returns accepted within 7 days with receipt"', 'Receipt footer text'),
('receipt', 'show_logo', 'true', 'Show company logo on receipt'),
('receipt', 'show_cashier', 'true', 'Show cashier name on receipt'),
('receipt', 'show_customer', 'true', 'Show customer name on receipt'),
('receipt', 'show_sku', 'true', 'Show product SKU on receipt'),
('receipt', 'paper_size', '"80mm"', 'Receipt paper size: 58mm or 80mm')
ON CONFLICT (category, key) DO NOTHING;

-- Insert default inventory settings
INSERT INTO settings (category, key, value, description) VALUES
('inventory', 'tracking_enabled', 'true', 'Enable inventory tracking'),
('inventory', 'default_min_stock', '10', 'Default minimal stock level'),
('inventory', 'allow_negative_stock', '"allow_with_warning"', 'Allow negative stock: block, allow_with_warning, allow_without_warning'),
('inventory', 'cost_calculation', '"latest_purchase"', 'Cost calculation mode: latest_purchase or average_cost'),
('inventory', 'adjustment_approval_required', 'false', 'Require approval for stock adjustments')
ON CONFLICT (category, key) DO NOTHING;

-- Insert default numbering settings
INSERT INTO settings (category, key, value, description) VALUES
('numbering', 'order_prefix', '"POS-"', 'Order number prefix'),
('numbering', 'order_format', '"POS-YYYYMMDD-#####"', 'Order number format'),
('numbering', 'return_prefix', '"RET-"', 'Return number prefix'),
('numbering', 'return_format', '"RET-YYYYMMDD-#####"', 'Return number format'),
('numbering', 'purchase_prefix', '"PO-"', 'Purchase order prefix'),
('numbering', 'purchase_format', '"PO-YYYYMMDD-#####"', 'Purchase order format'),
('numbering', 'movement_prefix', '"MOV-"', 'Movement number prefix'),
('numbering', 'movement_format', '"MOV-YYYYMMDD-#####"', 'Movement number format')
ON CONFLICT (category, key) DO NOTHING;

-- Insert default security settings
INSERT INTO settings (category, key, value, description) VALUES
('security', 'min_password_length', '6', 'Minimum password length'),
('security', 'require_strong_password', 'false', 'Require letters and numbers in password'),
('security', 'max_failed_attempts', '5', 'Max failed login attempts before lock'),
('security', 'session_timeout_minutes', '480', 'Session timeout in minutes (8 hours)'),
('security', 'allow_multiple_sessions', 'true', 'Allow multiple active sessions per user'),
('security', 'enable_activity_logging', 'true', 'Enable activity logging')
ON CONFLICT (category, key) DO NOTHING;

-- Insert default localization settings
INSERT INTO settings (category, key, value, description) VALUES
('localization', 'default_language', '"en"', 'Default language: en, uz, ru'),
('localization', 'available_languages', '["en", "uz", "ru"]', 'Available interface languages'),
('localization', 'default_currency', '"UZS"', 'Default currency code'),
('localization', 'currency_symbol', '"UZS"', 'Currency symbol'),
('localization', 'currency_position', '"after"', 'Currency position: before or after'),
('localization', 'thousand_separator', '" "', 'Thousand separator'),
('localization', 'decimal_separator', '"."', 'Decimal separator')
ON CONFLICT (category, key) DO NOTHING;

-- Function to get all settings by category
CREATE OR REPLACE FUNCTION get_settings_by_category(p_category text)
RETURNS TABLE (
  key text,
  value jsonb,
  description text,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT key, value, description, updated_at
  FROM settings
  WHERE category = p_category
  ORDER BY key;
$$;

-- Function to get single setting
CREATE OR REPLACE FUNCTION get_setting(p_category text, p_key text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT value
  FROM settings
  WHERE category = p_category AND key = p_key;
$$;

-- Function to update setting
CREATE OR REPLACE FUNCTION update_setting(
  p_category text,
  p_key text,
  p_value jsonb,
  p_updated_by uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE settings
  SET value = p_value,
      updated_by = p_updated_by,
      updated_at = now()
  WHERE category = p_category AND key = p_key;
  
  IF FOUND THEN
    -- Log activity
    PERFORM log_employee_activity(
      p_updated_by,
      'setting_update',
      'Updated setting: ' || p_category || '.' || p_key,
      NULL,
      'setting',
      NULL
    );
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$;

-- Function to bulk update settings
CREATE OR REPLACE FUNCTION bulk_update_settings(
  p_category text,
  p_settings jsonb,
  p_updated_by uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer := 0;
  v_key text;
  v_value jsonb;
BEGIN
  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_settings)
  LOOP
    UPDATE settings
    SET value = v_value,
        updated_by = p_updated_by,
        updated_at = now()
    WHERE category = p_category AND key = v_key;
    
    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  
  -- Log activity
  IF v_count > 0 THEN
    PERFORM log_employee_activity(
      p_updated_by,
      'settings_bulk_update',
      'Updated ' || v_count || ' settings in category: ' || p_category,
      NULL,
      'setting',
      NULL
    );
  END IF;
  
  RETURN v_count;
END;
$$;

-- Grant permissions
GRANT ALL ON settings TO authenticated;
