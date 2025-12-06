export type UserRole = 'admin' | 'manager' | 'cashier';

export type OrderStatus = 'hold' | 'completed' | 'returned';
export type PaymentStatus = 'pending' | 'partial' | 'paid' | 'on_credit' | 'partially_paid';
export type PaymentMethod = 'cash' | 'card' | 'terminal' | 'qr' | 'mixed' | 'credit';
export type RefundMethod = 'cash' | 'card' | 'credit';
export type MovementType = 'purchase' | 'sale' | 'return' | 'adjustment' | 'audit';
export type ShiftStatus = 'open' | 'closed';
export type PurchaseOrderStatus = 'draft' | 'approved' | 'partially_received' | 'received' | 'cancelled';

export interface Profile {
  id: string;
  username: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  role: UserRole;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  parent_id: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string | null;
}

export interface SupplierWithPOs extends Supplier {
  purchase_orders?: PurchaseOrder[];
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
  type: 'individual' | 'company';
  company_name: string | null;
  tax_number: string | null;
  credit_limit: number;
  allow_debt: boolean;
  balance: number;
  total_sales: number;
  total_orders: number;
  last_order_date: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
  bonus_points: number;
  created_at: string;
  updated_at: string;
}

export interface CustomerWithStats extends Customer {
  order_count?: number;
  avg_order_value?: number;
  total_returns?: number;
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
  credit_amount: number;
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

export interface CustomerPayment {
  id: string;
  payment_number: string;
  customer_id: string;
  amount: number;
  payment_method: 'cash' | 'card' | 'qr';
  reference_number: string | null;
  notes: string | null;
  received_by: string | null;
  created_at: string;
}

export interface SalesReturn {
  id: string;
  return_number: string;
  order_id: string;
  customer_id: string | null;
  cashier_id: string;
  total_amount: number;
  refund_method: 'cash' | 'card' | 'credit';
  status: string;
  reason: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesReturnItem {
  id: string;
  return_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  created_at?: string;
  product?: {
    name: string;
    sku: string;
    barcode: string | null;
  };
}

export interface InventoryMovement {
  id: string;
  movement_number: string;
  product_id: string;
  movement_type: MovementType;
  quantity: number;
  before_quantity: number;
  after_quantity: number;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface InventoryMovementWithDetails extends InventoryMovement {
  product?: Product;
  user?: Profile;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string | null;
  supplier_name: string | null;
  order_date: string;
  expected_date: string | null;
  reference: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total_amount: number;
  status: PurchaseOrderStatus;
  invoice_number: string | null;
  received_by: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string;
  product_name: string;
  ordered_qty: number;
  received_qty: number;
  unit_cost: number;
  line_total: number;
}

// Extended types with relations
export interface ProductWithCategory extends Product {
  category?: Category;
}

export interface OrderItemWithProduct extends OrderItem {
  product?: ProductWithCategory;
}

export interface OrderWithDetails extends Order {
  customer?: Customer;
  cashier?: Profile;
  items?: OrderItemWithProduct[];
  payments?: Payment[];
}

export interface ShiftWithCashier extends Shift {
  cashier?: Profile;
}

export interface PurchaseOrderWithDetails extends PurchaseOrder {
  supplier?: Supplier;
  items?: PurchaseOrderItem[];
  received_by_profile?: Profile;
  created_by_profile?: Profile;
  approved_by_profile?: Profile;
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

// Held order status
export type HeldOrderStatus = 'HELD' | 'RESTORED' | 'CANCELLED';

// Held order for POS terminal (Park Sale / Kutish)
export interface HeldOrder {
  id: string;
  held_number: string;
  cashier_id: string;
  shift_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  items: CartItem[];
  discount: { type: 'amount' | 'percent'; value: number } | null;
  note: string | null;
  status: HeldOrderStatus;
  created_at: string;
  updated_at: string | null;
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

// Employee Sessions
export interface EmployeeSession {
  id: string;
  employee_id: string;
  login_time: string;
  logout_time: string | null;
  duration: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface EmployeeSessionWithProfile extends EmployeeSession {
  employee?: Profile;
}

// Employee Activity Logs
export interface EmployeeActivityLog {
  id: string;
  employee_id: string;
  action_type: string;
  description: string;
  document_id: string | null;
  document_type: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface EmployeeActivityLogWithProfile extends EmployeeActivityLog {
  employee?: Profile;
}

// Employee Performance Metrics
export interface EmployeePerformance {
  total_sales: number;
  total_revenue: number;
  average_order_amount: number;
  total_returns: number;
  return_amount: number;
  net_revenue: number;
  transaction_count: number;
}

// Settings
export interface Setting {
  id: string;
  category: string;
  key: string;
  value: unknown;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export interface CompanySettings {
  name: string;
  legal_name: string;
  logo_url: string;
  address_country: string;
  address_city: string;
  address_street: string;
  phone: string;
  email: string;
  website: string;
  tax_id: string;
}

export interface POSSettings {
  mode: 'retail' | 'restaurant';
  enable_hold_order: boolean;
  enable_mixed_payment: boolean;
  require_customer_for_credit: boolean;
  auto_logout_minutes: number;
  show_low_stock_warning: boolean;
  quick_access_limit: number;
}

export interface PaymentSettings {
  methods: string[];
  method_labels: Record<string, string>;
}

export interface TaxSettings {
  enabled: boolean;
  default_rate: number;
  inclusive: boolean;
  per_product_override: boolean;
}

export interface ReceiptSettings {
  auto_print: boolean;
  header_text: string;
  footer_text: string;
  show_logo: boolean;
  show_cashier: boolean;
  show_customer: boolean;
  show_sku: boolean;
  paper_size: '58mm' | '80mm';
}

export interface InventorySettings {
  tracking_enabled: boolean;
  default_min_stock: number;
  allow_negative_stock: 'block' | 'allow_with_warning' | 'allow_without_warning';
  cost_calculation: 'latest_purchase' | 'average_cost';
  adjustment_approval_required: boolean;
}

export interface NumberingSettings {
  order_prefix: string;
  order_format: string;
  return_prefix: string;
  return_format: string;
  purchase_prefix: string;
  purchase_format: string;
  movement_prefix: string;
  movement_format: string;
}

export interface SecuritySettings {
  min_password_length: number;
  require_strong_password: boolean;
  max_failed_attempts: number;
  session_timeout_minutes: number;
  allow_multiple_sessions: boolean;
  enable_activity_logging: boolean;
}

export interface LocalizationSettings {
  default_language: 'en' | 'uz' | 'ru';
  available_languages: string[];
  default_currency: string;
  currency_symbol: string;
  currency_position: 'before' | 'after';
  thousand_separator: string;
  decimal_separator: string;
}
