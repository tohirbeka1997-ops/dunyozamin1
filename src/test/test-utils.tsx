/**
 * Test utilities for React component testing
 */

import { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';

/**
 * Custom render function that includes common providers
 */
export function renderWithRouter(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <BrowserRouter>{children}</BrowserRouter>;
  }

  return render(ui, { wrapper: Wrapper, ...options });
}

/**
 * Mock product data for testing
 */
export const mockProduct = {
  id: 'test-product-1',
  name: 'Test Product',
  sku: 'SKU001',
  barcode: '1234567890',
  description: 'Test product description',
  category_id: 'cat-1',
  unit: 'pcs',
  purchase_price: 3000,
  sale_price: 5000,
  current_stock: 100,
  min_stock_level: 10,
  image_url: null,
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

/**
 * Mock customer data for testing
 */
export const mockCustomer = {
  id: 'test-customer-1',
  name: 'Test Customer',
  phone: '+998901234567',
  email: null,
  address: null,
  type: 'individual',
  balance: 0,
  total_sales: 0,
  total_orders: 0,
  last_order_date: null,
  notes: null,
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

/**
 * Mock order data for testing
 */
export const mockOrder = {
  id: 'test-order-1',
  order_number: 'ORD-20250115-123456',
  customer_id: 'test-customer-1',
  cashier_id: 'test-cashier-1',
  shift_id: null,
  subtotal: 10000,
  discount_amount: 0,
  discount_percent: 0,
  tax_amount: 0,
  total_amount: 10000,
  paid_amount: 10000,
  change_amount: 0,
  status: 'completed' as const,
  payment_status: 'paid' as const,
  notes: null,
  created_at: new Date().toISOString(),
};

/**
 * Wait for async operations to complete
 */
export const waitForAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Helper to create mock functions
 */
export const createMockFn = <T extends (...args: any[]) => any>(returnValue?: ReturnType<T>) => {
  return vi.fn(() => returnValue) as unknown as T;
};

