/*
# Expenses Management System

## Overview
This migration creates the expenses table for tracking company expenses (xarajatlar).
Expenses affect cash/bank balance but do NOT affect inventory or customer balances.

## Changes

### 1. expenses Table
Tracks all company expenses:
- expense_date: Date when expense occurred
- category: Expense category (Ijara, Oylik maosh, Kommunal, Transport, Soliq, Marketing, Boshqa)
- amount: Expense amount (numeric, > 0)
- payment_method: How expense was paid (cash, card, bank_transfer, other)
- note: Optional description/notes
- employee_id: Employee responsible for the expense (nullable)
- created_by: User who created the expense record
- status: Expense status (approved, pending) - default: approved

### 2. Indexes
- Performance indexes for common queries (date, category, employee)

### 3. Notes
- Expenses reduce cash/bank balance
- Expenses are used in profit calculations: Profit = Sales - Expenses
- No RLS policies (application-level access control)
*/

-- Create expenses table
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_number text UNIQUE NOT NULL,
  expense_date date NOT NULL,
  category text NOT NULL CHECK (category IN (
    'Ijara',
    'Oylik maosh',
    'Kommunal',
    'Transport',
    'Soliq',
    'Marketing',
    'Boshqa'
  )),
  amount numeric NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN (
    'cash',
    'card',
    'bank_transfer',
    'other'
  )),
  note text,
  employee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  status text DEFAULT 'approved' CHECK (status IN ('approved', 'pending')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_employee_id ON expenses(employee_id);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON expenses(created_by);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_method ON expenses(payment_method);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);

-- Create function to generate expense number
CREATE OR REPLACE FUNCTION generate_expense_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  today text;
  next_num integer;
  year_prefix text;
BEGIN
  today := to_char(CURRENT_DATE, 'YYYYMMDD');
  year_prefix := 'EXP-' || to_char(CURRENT_DATE, 'YYYY') || '-';
  
  -- Get next number for today
  SELECT COALESCE(MAX(CAST(SUBSTRING(expense_number FROM LENGTH(year_prefix) + 1) AS INTEGER)), 0) + 1
  INTO next_num
  FROM expenses
  WHERE expense_number LIKE year_prefix || '%';
  
  RETURN year_prefix || LPAD(next_num::text, 5, '0');
END;
$$;

-- Trigger to auto-generate expense_number
CREATE OR REPLACE FUNCTION set_expense_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.expense_number IS NULL OR NEW.expense_number = '' THEN
    NEW.expense_number := generate_expense_number();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_set_expense_number
  BEFORE INSERT ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION set_expense_number();

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_expenses_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION update_expenses_updated_at();

-- Add comment
COMMENT ON TABLE expenses IS 'Company expenses tracking - affects cash/bank balance, used in profit calculations';

