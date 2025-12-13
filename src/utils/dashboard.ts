/**
 * Dashboard Query Invalidation Utility
 * 
 * Centralized function to invalidate all dashboard-related queries.
 * Call this after any mutation that affects dashboard metrics.
 */

import { QueryClient } from '@tanstack/react-query';

/**
 * Invalidates all dashboard queries
 * Should be called after:
 * - Creating/updating orders
 * - Creating/updating returns
 * - Creating/updating expenses
 * - Creating/updating purchase orders
 * - Updating inventory (stock changes)
 * - Creating customer payments
 * - Any other action that affects dashboard metrics
 */
export function invalidateDashboardQueries(queryClient: QueryClient): void {
  // Invalidate all dashboard-related queries
  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  queryClient.invalidateQueries({ queryKey: ['dashboardAnalytics'] });
  queryClient.invalidateQueries({ queryKey: ['dailySales'] });
  queryClient.invalidateQueries({ queryKey: ['topProducts'] });
  queryClient.invalidateQueries({ queryKey: ['lowStockProducts'] });
  queryClient.invalidateQueries({ queryKey: ['totalCustomerDebt'] });
  
  // Also invalidate related queries that might affect dashboard
  queryClient.invalidateQueries({ queryKey: ['orders'] });
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
  queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
  queryClient.invalidateQueries({ queryKey: ['products'] });
  queryClient.invalidateQueries({ queryKey: ['customers'] });
}

