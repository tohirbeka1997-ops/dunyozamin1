export type DaysOption = 30 | 60 | 90;

export type DeadStockRow = {
  product_id: string;
  product_sku: string;
  product_name: string;
  category_id: string | null;
  unit: string;
  purchase_price: number;
  sale_price: number;
  current_stock: number;
  last_sale_at: string | null;
  frozen_value: number;
  days_since_last_sale: number | null;
};

export type TurnoverRow = {
  product_id: string;
  product_sku: string;
  product_name: string;
  category_id: string | null;
  unit: string;
  purchase_price: number;
  sale_price: number;
  current_stock: number;
  sold_qty_n: number;
  avg_daily_sales: number;
  days_to_sell_out: number | null;
  stock_value: number;
  speed_label: 'fast' | 'medium' | 'slow' | null;
};

export type ReorderRow = {
  product_id: string;
  product_sku: string;
  product_name: string;
  category_id: string | null;
  unit: string;
  purchase_price: number;
  sale_price: number;
  min_stock_level: number;
  max_stock_level: number | null;
  current_stock: number;
  target_level: number;
  recommended_order_qty: number;
  stock_value: number;
};

