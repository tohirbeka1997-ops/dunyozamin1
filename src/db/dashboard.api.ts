// Dashboard analytics & reporting domain. Split out of `api.ts`.
// Reads from the shared mock DB / localStorage stores via `./internal`; the
// Electron path delegates to the reports IPC service.

import { requireElectron } from '@/utils/electron';
import { formatDateYMD } from '@/lib/datetime';
import {
  delay,
  getStoredCustomers,
  getStoredOrderItems,
  getStoredOrders,
  getStoredPurchaseOrders,
  getStoredSalesReturns,
  hasPosApi,
  ipc,
  mockDB,
} from './internal';

// ============================================================================
// DASHBOARD ANALYTICS FUNCTIONS (Mock)
// ============================================================================

export interface DashboardAnalytics {
  period?: { date_from: string; date_to: string };
  warehouse_id?: string | null;
  /** UZS-equivalent sum for P&L (USD orders × fx_rate). */
  total_sales: number;
  /** Document-currency buckets (do not add together). */
  total_sales_uzs?: number;
  total_sales_usd?: number;
  total_orders: number;
  total_cogs: number;
  total_profit: number;
  net_profit?: number;
  profit_margin: number;
  total_expenses: number;
  low_stock_count: number;
  active_customers: number;
  average_order_value: number;
  items_sold: number;
  returns_count: number;
  returns_amount: number;
  returns_cogs?: number;
  pending_purchase_orders: number;
  warnings?: {
    missing_cost_count?: number;
    missing_cost_samples?: Array<{
      order_item_id: string;
      order_id: string;
      order_number?: string;
      product_id?: string;
      product_name?: string;
      created_at?: string;
    }>;
    using_legacy_returns_table?: boolean;
    expenses_filtered_by_warehouse?: boolean;
  };
}

export interface DailySales {
  date: string;
  total_sales: number;
  order_count: number;
}

export interface TopProduct {
  product_id: string;
  product_name: string;
  quantity_sold: number;
  total_amount: number;
}

export const getDashboardAnalytics = async (
  startDate: Date,
  endDate: Date,
  opts?: { warehouse_id?: string }
): Promise<DashboardAnalytics> => {
  // Electron (real DB) mode
  if (hasPosApi()) {
    const api = requireElectron();
    const date_from = formatDateYMD(startDate);
    const date_to = formatDateYMD(endDate);
    return ipc<DashboardAnalytics>(
      api.dashboard.getAnalytics({
        date_from,
        date_to,
        warehouse_id: opts?.warehouse_id,
      })
    );
  }

  await delay();
  
  // Normalize dates to start/end of day
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  
  // Get all data
  const orders = getStoredOrders();
  const orderItems = getStoredOrderItems();
  const returns = getStoredSalesReturns();
  const purchaseOrders = getStoredPurchaseOrders();
  const products = mockDB.products;
  const customers = getStoredCustomers();
  
  // Filter orders by date range and status (only completed/paid orders)
  const completedOrders = orders.filter(order => {
    const orderDate = new Date(order.created_at);
    return orderDate >= start && orderDate <= end && order.status === 'completed';
  });
  
  // Total sales: sum of completed orders' total_amount
  const total_sales = completedOrders.reduce((sum, order) => sum + (order.total_amount || 0), 0);
  
  // Total orders count
  const total_orders = completedOrders.length;
  
  // Average order value
  const average_order_value = total_orders > 0 ? total_sales / total_orders : 0;

  // COGS / Profit (mock approximation)
  const productsById = new Map(products.map((p) => [p.id, p]));
  const total_cogs = orderItems
    .filter((item) => completedOrderIds.has(item.order_id))
    .reduce((sum, item) => {
      const p = productsById.get(item.product_id);
      const unitCost = Number((item as any).cost_price ?? p?.purchase_price ?? 0) || 0;
      return sum + unitCost * Number(item.quantity || 0);
    }, 0);
  const total_profit = total_sales - total_cogs;
  const profit_margin = total_sales > 0 ? (total_profit / total_sales) * 100 : 0;

  // Expenses (mock)
  const total_expenses = (mockDB.expenses || []).reduce((sum, e) => sum + Number(e.amount || 0), 0);
  
  // Items sold: sum of quantities from order items for completed orders
  const completedOrderIds = new Set(completedOrders.map(o => o.id));
  const items_sold = orderItems
    .filter(item => completedOrderIds.has(item.order_id))
    .reduce((sum, item) => sum + (item.quantity || 0), 0);
  
  // Active customers: customers with at least 1 order in period
  const customerIdsWithOrders = new Set(completedOrders.map(o => o.customer_id).filter(Boolean));
  const active_customers = customerIdsWithOrders.size;
  
  // Returns: count and amount in date range
  const returnsInPeriod = returns.filter(ret => {
    const returnDate = new Date(ret.created_at);
    return returnDate >= start && returnDate <= end;
  });
  const returns_count = returnsInPeriod.length;
  const returns_amount = returnsInPeriod.reduce((sum, ret) => sum + (ret.total_amount || 0), 0);
  
  // Low stock count: products with stock <= min_stock_level
  const low_stock_count = products.filter(
    p => p.is_active && (p.current_stock || 0) <= (p.min_stock_level || 0)
  ).length;
  
  // Pending purchase orders: count of POs with status 'draft' or 'approved'
  const pending_purchase_orders = purchaseOrders.filter(
    po => po.status === 'draft' || po.status === 'approved'
  ).length;
  
  return {
    total_sales,
    total_orders,
    total_cogs,
    total_profit,
    profit_margin,
    total_expenses,
    low_stock_count,
    active_customers,
    average_order_value: Math.round(average_order_value),
    items_sold,
    returns_count,
    returns_amount,
    pending_purchase_orders,
  };
};

export const getInventoryValuationSummary = async (_opts?: { warehouse_id?: string; status?: 'active' | 'inactive' | 'all' }) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.reports?.inventoryValuationSummary?.(_opts || {}));
  }

  await delay();
  const products = mockDB.products.filter((p) => {
    if (_opts?.status === 'inactive') return !p.is_active;
    if (_opts?.status === 'all') return true;
    return p.is_active;
  });

  const total_quantity = products.reduce((sum, p) => sum + Number(p.current_stock || 0), 0);
  const total_value = products.reduce((sum, p) => sum + Number(p.current_stock || 0) * Number(p.purchase_price || 0), 0);
  const products_count = products.length;
  const out_of_stock_count = products.filter((p) => Number(p.current_stock || 0) === 0).length;
  const low_stock_count = products.filter((p) => Number(p.current_stock || 0) > 0 && Number(p.current_stock || 0) <= Number(p.min_stock_level || 0)).length;

  return {
    total_value,
    total_quantity,
    products_count,
    out_of_stock_count,
    low_stock_count,
  };
};

export const getInventoryValuationReport = async (_opts?: { warehouse_id?: string; status?: 'active' | 'inactive' | 'all' }) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.reports?.inventoryValuation?.(_opts || {}));
  }
  await delay();
  return { rows: [], summary: { total_value: 0, total_quantity: 0, products_count: 0, out_of_stock_count: 0, low_stock_count: 0 } };
};

export const getProfitAndLossSQL = async (_opts?: {
  date_from?: string;
  date_to?: string;
  warehouse_id?: string;
  price_tier_id?: number | null;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.reports?.profitAndLossSQL?.(_opts || {}));
  }
  await delay();
  return null;
};

export const getDailySalesReportSQL = async (_opts?: {
  date_from?: string;
  date_to?: string;
  cashier_id?: string | null;
  payment_method?: string | null;
  status?: string | null;
  warehouse_id?: string | null;
  price_tier_id?: number | null;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.reports?.dailySalesSQL?.(_opts || {}));
  }
  await delay();
  return null;
};

export const getProductSalesReport = async (_params?: {
  date_from?: string;
  date_to?: string;
  category_id?: string | null;
  warehouse_id?: string;
  price_tier?: string | null;
}) => {
  // In Electron mode, use backend reports service (SQLite)
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(
      api.reports?.productSales?.({
        date_from: _params?.date_from,
        date_to: _params?.date_to,
        category_id: _params?.category_id ?? null,
        warehouse_id: _params?.warehouse_id,
        price_tier: _params?.price_tier ?? null,
      }) || Promise.resolve([])
    );
  }

  // Browser/mock mode
  await delay();
  return [] as any[];
};

export const getPromotionUsageReport = async (params?: {
  date_from?: string;
  date_to?: string;
  promotion_id?: string | null;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(
      api.reports?.promotionUsage?.({
        date_from: params?.date_from,
        date_to: params?.date_to,
        promotion_id: params?.promotion_id ?? null,
      }) || Promise.resolve([])
    );
  }
  await delay();
  return [] as any[];
};

export const getDailySalesData = async (startDate: Date, endDate: Date): Promise<DailySales[]> => {
  // Electron (real DB) mode
  if (hasPosApi()) {
    const api = requireElectron();

    // Build YMD day list in Asia/Tashkent to avoid timezone mismatches
    const fromYMD = formatDateYMD(startDate);
    const toYMD = formatDateYMD(endDate);

    const parseYMDLocal = (ymd: string): Date => {
      const [y, m, d] = String(ymd || '').split('-').map((v) => Number(v));
      return new Date(y, (m || 1) - 1, d || 1);
    };

    const days: string[] = [];
    let cur = parseYMDLocal(fromYMD);
    const end = parseYMDLocal(toYMD);
    while (cur <= end) {
      days.push(formatDateYMD(cur));
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }

    const results = await Promise.all(
      days.map(async (ymd) => {
        const res = await ipc<any>(api.reports.dailySales(ymd, undefined));
        return {
          date: ymd,
          total_sales: Number(res?.total_sales || 0) || 0,
          order_count: Number(res?.order_count || 0) || 0,
        } as DailySales;
      })
    );

    return results;
  }

  await delay();
  
  // Normalize dates
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  
  // Get completed orders in date range
  const orders = getStoredOrders();
  const completedOrders = orders.filter(order => {
    const orderDate = new Date(order.created_at);
    return orderDate >= start && orderDate <= end && order.status === 'completed';
  });
  
  // Group by date (YYYY-MM-DD)
  const dailyMap = new Map<string, { total_sales: number; order_count: number }>();
  
  completedOrders.forEach(order => {
    const dateStr = new Date(order.created_at).toISOString().split('T')[0];
    const existing = dailyMap.get(dateStr) || { total_sales: 0, order_count: 0 };
    dailyMap.set(dateStr, {
      total_sales: existing.total_sales + (order.total_amount || 0),
      order_count: existing.order_count + 1,
    });
  });
  
  // Fill missing dates with 0 (no gaps in chart)
  const result: DailySales[] = [];
  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const data = dailyMap.get(dateStr) || { total_sales: 0, order_count: 0 };
    result.push({
      date: dateStr,
      total_sales: data.total_sales,
      order_count: data.order_count,
    });
    current.setDate(current.getDate() + 1);
  }
  
  return result;
};

export const getTopProducts = async (startDate: Date, endDate: Date, limit: number = 5): Promise<TopProduct[]> => {
  // Electron (real DB) mode
  if (hasPosApi()) {
    const api = requireElectron();
    const date_from = formatDateYMD(startDate);
    const date_to = formatDateYMD(endDate);
    const rows = await ipc<any[]>(
      api.reports.topProducts({
        date_from,
        date_to,
        limit,
      })
    );
    return (rows || []).map((r: any) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      quantity_sold: Number(r.quantity_sold || 0) || 0,
      total_amount: Number(r.total_amount || 0) || 0,
    })) as TopProduct[];
  }

  await delay();
  
  // Normalize dates
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  
  // Get completed orders in date range
  const orders = getStoredOrders();
  const completedOrders = orders.filter(order => {
    const orderDate = new Date(order.created_at);
    return orderDate >= start && orderDate <= end && order.status === 'completed';
  });
  const completedOrderIds = new Set(completedOrders.map(o => o.id));
  
  // Get order items for completed orders
  const orderItems = getStoredOrderItems();
  const itemsInPeriod = orderItems.filter(item => completedOrderIds.has(item.order_id));
  
  // Aggregate by product
  const productMap = new Map<string, { product_name: string; quantity_sold: number; total_amount: number }>();
  
  itemsInPeriod.forEach(item => {
    const existing = productMap.get(item.product_id) || {
      product_name: item.product_name,
      quantity_sold: 0,
      total_amount: 0,
    };
    productMap.set(item.product_id, {
      product_name: item.product_name,
      quantity_sold: existing.quantity_sold + (item.quantity || 0),
      total_amount: existing.total_amount + (item.total || 0),
    });
  });
  
  // Convert to array and sort by total_amount descending
  const topProducts: TopProduct[] = Array.from(productMap.entries())
    .map(([product_id, data]) => ({
      product_id,
      product_name: data.product_name,
      quantity_sold: data.quantity_sold,
      total_amount: data.total_amount,
    }))
    .sort((a, b) => b.total_amount - a.total_amount)
    .slice(0, limit);
  
  return topProducts;
};

// ============================================================================
// DASHBOARD FUNCTIONS (Mock)
// ============================================================================

export const getDashboardStats = async () => {
  await delay();
  return {
    today_sales: 0,
    today_orders: 0,
    low_stock_count: 0,
    active_customers: 0,
    total_revenue: 0,
    total_profit: 0,
  };
};

