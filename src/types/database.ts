export type UserRole = 'admin' | 'manager' | 'cashier';

export type OrderStatus = 'hold' | 'completed' | 'returned';
export type PaymentStatus = 'pending' | 'partial' | 'paid';
export type PaymentMethod = 'cash' | 'card' | 'terminal' | 'qr' | 'mixed';
export type RefundMethod = 'cash' | 'card' | 'credit';
export type MovementType = 'purchase' | 'sale' | 'return' | 'adjustment' | 'audit';
export type ShiftStatus = 'open' | 'closed';
export type PurchaseOrderStatus = 'pending' | 'completed';

export interface Profile {
  id: string;
  username: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  created_at: string;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  unit: string;
  purchase_price: number;
  sale_price: number;
  current_stock: number;
  min_stock_level: number;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  bonus_points: number;
  debt_balance: number;
  created_at: string;
}

export interface Shift {
  id: string;
  shift_number: string;
  cashier_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  cash_difference: number | null;
  status: ShiftStatus;
  notes: string | null;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id: string | null;
  cashier_id: string;
  shift_id: string | null;
  subtotal: number;
  discount_amount: number;
  discount_percent: number;
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  change_amount: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  notes: string | null;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  discount_amount: number;
  total: number;
}

export interface Payment {
  id: string;
  payment_number: string;
  order_id: string;
  payment_method: PaymentMethod;
  amount: number;
  reference_number: string | null;
  notes: string | null;
  created_at: string;
}

export interface SalesReturn {
  id: string;
  return_number: string;
  order_id: string;
  customer_id: string | null;
  cashier_id: string;
  total_amount: number;
  refund_method: RefundMethod;
  reason: string | null;
  created_at: string;
}

export interface SalesReturnItem {
  id: string;
  return_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface InventoryMovement {
  id: string;
  movement_number: string;
  product_id: string;
  movement_type: MovementType;
  quantity: number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  total_amount: number;
  status: PurchaseOrderStatus;
  invoice_number: string | null;
  received_by: string;
  notes: string | null;
  created_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

// Extended types with relations
export interface ProductWithCategory extends Product {
  category?: Category;
}

export interface OrderWithDetails extends Order {
  customer?: Customer;
  cashier?: Profile;
  items?: OrderItem[];
  payments?: Payment[];
}

export interface ShiftWithCashier extends Shift {
  cashier?: Profile;
}

export interface PurchaseOrderWithDetails extends PurchaseOrder {
  supplier?: Supplier;
  items?: PurchaseOrderItem[];
  received_by_profile?: Profile;
}

export interface SalesReturnWithDetails extends SalesReturn {
  order?: Order;
  customer?: Customer;
  cashier?: Profile;
  items?: SalesReturnItem[];
}

// Cart item for POS terminal
export interface CartItem {
  product: Product;
  quantity: number;
  discount_amount: number;
  subtotal: number;
  total: number;
}

// Dashboard statistics
export interface DashboardStats {
  today_sales: number;
  today_orders: number;
  low_stock_count: number;
  active_customers: number;
  total_revenue: number;
  total_profit: number;
}
