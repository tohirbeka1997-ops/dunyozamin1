/**
 * Centralized React Query Keys
 * 
 * This file provides a single source of truth for all query keys used in the application.
 * Using these constants ensures consistent invalidation across all pages.
 */

export const qk = {
  products: ['products'] as const,
  categories: ['categories'] as const,
  orders: ['orders'] as const,
  inventory: ['inventory'] as const,
  warehouses: ['warehouses'] as const,
  customers: ['customers'] as const,
  suppliers: ['suppliers'] as const,
  purchases: ['purchases'] as const,
  expenses: ['expenses'] as const,
  shifts: ['shifts'] as const,
  returns: ['returns'] as const,
  dashboard: ['dashboard'] as const,
  dashboardAnalytics: ['dashboardAnalytics'] as const,
  dailySales: ['dailySales'] as const,
  topProducts: ['topProducts'] as const,
  lowStockProducts: ['lowStockProducts'] as const,
  totalCustomerDebt: ['totalCustomerDebt'] as const,
  stock: ['stock'] as const,
} as const;















































