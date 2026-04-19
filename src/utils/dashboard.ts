/**
 * Dashboard Query Invalidation Utility
 * 
 * Centralized function to invalidate all dashboard-related queries.
 * Call this after any mutation that affects dashboard metrics.
 */

import { QueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';

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
  console.log('[Dashboard] Invalidating all dashboard queries...');
  
  // Invalidate all dashboard-related queries (use exact: false to match all variants with date ranges)
  queryClient.invalidateQueries({ queryKey: qk.dashboard, exact: false });
  queryClient.invalidateQueries({ queryKey: qk.dashboardAnalytics, exact: false });
  queryClient.invalidateQueries({ queryKey: qk.dailySales, exact: false });
  queryClient.invalidateQueries({ queryKey: qk.topProducts, exact: false });
  queryClient.invalidateQueries({ queryKey: qk.lowStockProducts });
  queryClient.invalidateQueries({ queryKey: qk.totalCustomerDebt });
  
  // Also invalidate related queries that might affect dashboard
  queryClient.invalidateQueries({ queryKey: qk.orders, exact: false });
  queryClient.invalidateQueries({ queryKey: qk.expenses, exact: false });
  queryClient.invalidateQueries({ queryKey: qk.purchases, exact: false });
  queryClient.invalidateQueries({ queryKey: qk.products, exact: false });
  queryClient.invalidateQueries({ queryKey: qk.customers, exact: false });
  queryClient.invalidateQueries({ queryKey: qk.inventory, exact: false });
  queryClient.invalidateQueries({ queryKey: qk.stock, exact: false });
  
  console.log('[Dashboard] Dashboard queries invalidated successfully');
}

