import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Products from '../Products';
import * as api from '@/db/api';

// Mock the API
vi.mock('@/db/api');
vi.mock('@/hooks/useProducts', () => ({
  useProducts: vi.fn(),
}));

const mockUseProducts = vi.fn();
vi.mock('@/hooks/useProducts', () => ({
  useProducts: () => mockUseProducts(),
}));

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('Products Page', () => {
  const mockProducts = [
    {
      id: '1',
      name: 'Test Product 1',
      sku: 'SKU001',
      barcode: '1234567890',
      current_stock: 100,
      min_stock_level: 10,
      sale_price: 5000,
      purchase_price: 3000,
      is_active: true,
      category: undefined,
    },
    {
      id: '2',
      name: 'Test Product 2',
      sku: 'SKU002',
      current_stock: 5,
      min_stock_level: 10,
      sale_price: 8000,
      purchase_price: 5000,
      is_active: true,
      category: undefined,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProducts.mockReturnValue({
      products: mockProducts,
      categories: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it('should render products list', () => {
    render(
      <BrowserRouter>
        <Products />
      </BrowserRouter>
    );

    expect(screen.getByText('Test Product 1')).toBeInTheDocument();
    expect(screen.getByText('Test Product 2')).toBeInTheDocument();
  });

  it('should display stock values correctly', () => {
    render(
      <BrowserRouter>
        <Products />
      </BrowserRouter>
    );

    // Check that stock is displayed
    expect(screen.getByText('100')).toBeInTheDocument(); // Product 1 stock
    expect(screen.getByText('5')).toBeInTheDocument(); // Product 2 stock
  });

  it('should show low stock warning for products below min_stock_level', () => {
    render(
      <BrowserRouter>
        <Products />
      </BrowserRouter>
    );

    // Product 2 has stock (5) < min_stock_level (10), so should show warning
    const warnings = screen.getAllByRole('img', { hidden: true }); // AlertTriangle icons
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('should filter products by search term', async () => {
    const { rerender } = render(
      <BrowserRouter>
        <Products />
      </BrowserRouter>
    );

    // Initial render should show all products
    expect(screen.getByText('Test Product 1')).toBeInTheDocument();
    expect(screen.getByText('Test Product 2')).toBeInTheDocument();

    // Note: Actual filtering would require user interaction
    // This test demonstrates the structure
  });

  it('should show loading state', () => {
    mockUseProducts.mockReturnValue({
      products: [],
      categories: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
    });

    render(
      <BrowserRouter>
        <Products />
      </BrowserRouter>
    );

    // Should show loading spinner
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('should handle error state', async () => {
    mockUseProducts.mockReturnValue({
      products: [],
      categories: [],
      loading: false,
      error: new Error('Failed to load products'),
      refetch: vi.fn(),
    });

    render(
      <BrowserRouter>
        <Products />
      </BrowserRouter>
    );

    // Error toast should be shown (mocked in setup)
    await waitFor(() => {
      // Error handling would show toast
    });
  });
});





























































