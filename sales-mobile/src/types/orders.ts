/**
 * Web order types — mirrors public-api/lib/webOrderQueues.cjs and admin SPA.
 * Backend staff API shu shaklni qaytaradi.
 */

export type WebOrderQueueId =
  | 'incoming'
  | 'preparing'
  | 'ready'
  | 'delivering'
  | 'delivered';

export type WebOrderStatus =
  | 'new'
  | 'paid'
  | 'processing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export type DeliveryMethod = 'courier' | 'pickup';

export interface QueueCounts {
  incoming: number;
  preparing: number;
  ready: number;
  delivering: number;
  delivered: number;
}

export interface StaffUser {
  id: string;
  username: string;
  full_name?: string;
  role: string;
  tenant: string;
}

export interface StaffTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
}

export interface WebOrderSummary {
  id: number;
  order_number: string;
  status: WebOrderStatus;
  payment_method?: string | null;
  payment_status?: string | null;
  total_amount?: number | null;
  created_at?: string | null;
  delivery_address?: string | null;
  delivery_method?: DeliveryMethod | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  note?: string | null;
}

export interface WebOrderItem {
  id: number;
  product_id: string;
  product_name?: string | null;
  sku?: string | null;
  quantity: number;
  price_at_order: number;
}

export interface WebOrderDetail extends WebOrderSummary {
  items?: WebOrderItem[];
  allowed_next_statuses?: WebOrderStatus[];
}
