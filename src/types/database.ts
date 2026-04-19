export type UserRole = 'admin' | 'manager' | 'cashier';

export type OrderStatus = 'hold' | 'completed' | 'returned';
export type PaymentStatus = 'pending' | 'partial' | 'paid' | 'on_credit' | 'partially_paid';
export type PaymentMethod =
  | 'cash'
  | 'card'
  | 'terminal'
  | 'qr'
  | 'mixed'
  | 'credit'
  /** Pul chiqimi (almashuv: mijozga qaytarish) — backend cash_movements.refund */
  | 'refund_cash';
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
  // Settlement currency for supplier ledger / act sverka (MVP supports USD + UZS)
  settlement_currency?: 'UZS' | 'USD';
  // NOTE: balance is NOT stored - it's calculated dynamically from transactions
  // balance = SUM(received_purchase_orders.total_amount) - SUM(supplier_payments.amount)
  // balance > 0 = we owe supplier (debt), balance < 0 = supplier owes us (advance)
  created_at: string;
  updated_at: string | null;
}

// Extended Supplier with computed balance (for UI display)
export interface SupplierWithBalance extends Supplier {
  balance: number; // Computed from transactions, never stored
}

export interface SupplierPayment {
  id: string;
  payment_number: string;
  supplier_id: string;
  purchase_order_id: string | null; // nullable: can pay without linking to PO
  amount: number;
  currency?: 'UZS' | 'USD';
  amount_usd?: number | null;
  // NOTE: 'credit_note' is system-generated for supplier returns (reduces debt)
  payment_method: 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'uzum' | 'credit_note';
  paid_at: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SupplierLedgerEntry {
  date: string;
  type: 'PURCHASE' | 'PAYMENT';
  reference: string; // PO number or payment number
  debit: number; // Purchase amount (increases debt)
  credit: number; // Payment amount (decreases debt)
  balance: number; // Running balance after this entry
  purchase_order_id?: string | null;
  payment_id?: string | null;
}

/** Customer account ledger (SQLite `customer_ledger`) */
export interface CustomerLedgerEntry {
  id: string;
  customer_id: string;
  type: string;
  ref_id: string | null;
  ref_no: string | null;
  amount: number;
  balance_after: number;
  note: string | null;
  method?: string | null;
  created_at: string;
  created_by: string | null;
}

/** Bonus points ledger (`customer_bonus_ledger`) */
export interface CustomerBonusLedgerEntry {
  id: string;
  customer_id: string;
  type: string;
  points: number;
  order_id: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

export interface SupplierWithPOs extends SupplierWithBalance {
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
  base_unit?: string | null;
  product_units?: ProductUnit[];
  purchase_price: number;
  sale_price: number;
  // Dual pricing (optional)
  master_price?: number | null;
  master_min_qty?: number | null;
  current_stock: number;
  min_stock_level: number;
  image_url: string | null;
  is_active: boolean;
  /** Manufacturer / brand name (migration 061) */
  brand?: string | null;
  /** Short vendor article code shared across product variants (migration 061) */
  article?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductUnit {
  unit: string;
  ratio_to_base: number;
  sale_price: number;
  is_default?: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  type: 'individual' | 'company';
  // Pricing tier is separate from customer `type` (individual/company)
  pricing_tier?: 'retail' | 'master';
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
  order_uuid?: string | null;
  device_id?: string | null;
  price_tier_id?: number | null;
  price_tier_code?: 'retail' | 'master' | 'wholesale' | 'marketplace' | string | null;
  customer_id: string | null;
  cashier_id: string;
  shift_id: string | null;
  subtotal: number;
  discount_amount: number;
  discount_percent: number;
  /** Points redeemed as discount on this order (if supported by DB). */
  loyalty_redeem_points?: number;
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
  sale_unit?: string;
  qty_sale?: number;
  qty_base?: number;
  unit_price: number;
  cost_price?: number | null;
  price_tier?: 'retail' | 'master' | 'wholesale' | 'marketplace';
  base_price?: number;
  usta_price?: number | null;
  discount_type?: 'none' | 'percent' | 'fixed' | 'mixed';
  discount_value?: number;
  final_unit_price?: number;
  final_total?: number;
  price_source?: 'base' | 'usta' | 'promo' | 'tier' | 'manual';
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
  order_id: string | null;
  customer_id: string | null;
  cashier_id: string;
  total_amount: number;
  refund_method: 'cash' | 'card' | 'credit' | 'customer_account';
  return_mode?: 'order' | 'manual';
  status: string;
  reason: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesReturnItem {
  id: string;
  return_id: string;
  order_item_id?: string | null;
  product_id: string;
  product_name?: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  sale_unit?: string;
  qty_sale?: number;
  qty_base?: number;
  base_price?: number;
  usta_price?: number | null;
  discount_type?: 'none' | 'percent' | 'fixed' | 'mixed';
  discount_value?: number;
  final_unit_price?: number;
  final_total?: number;
  price_source?: 'base' | 'usta' | 'promo' | 'manual' | 'tier';
  unit?: string;
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
  // Multi-currency (MVP): inventory costing stays in UZS (total_amount), supplier settlement can be USD
  currency?: 'UZS' | 'USD';
  fx_rate?: number | null; // UZS per 1 USD (snapshot)
  total_usd?: number | null;
  status: PurchaseOrderStatus;
  payment_status?: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID'; // Computed from payments
  paid_amount?: number; // Computed: sum of supplier_payments for this PO
  remaining_amount?: number; // Computed: total_amount - paid_amount
  paid_amount_uzs?: number;
  remaining_amount_uzs?: number;
  paid_amount_usd?: number | null;
  remaining_amount_usd?: number | null;
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
  // USD snapshot fields (optional)
  unit_cost_usd?: number | null;
  line_total_usd?: number | null;
  // Discount per unit (optional)
  discount_percent?: number;
  discount_amount?: number;
  // Landed cost fields (computed by backend when PO expenses exist)
  allocated_expenses?: number;
  landed_unit_cost?: number;
  // Sotish narxi - optional; when set and goods received, updates product.sale_price
  sale_price?: number | null;
}

export interface PurchaseOrderExpense {
  id: string;
  purchase_order_id: string;
  title: string;
  amount: number;
  allocation_method: 'by_value' | 'by_qty';
  notes: string | null;
  created_by: string | null;
  created_at: string;
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
  expenses?: PurchaseOrderExpense[];
  total_expenses?: number;
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

export type ExpenseCategory = 'Ijara' | 'Oylik maosh' | 'Kommunal' | 'Transport' | 'Soliq' | 'Marketing' | 'Boshqa';
export type ExpensePaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'other';
export type ExpenseStatus = 'approved' | 'pending';

export interface Expense {
  id: string;
  expense_number: string;
  expense_date: string;
  category: ExpenseCategory;
  amount: number;
  payment_method: ExpensePaymentMethod;
  note: string | null;
  employee_id: string | null;
  created_by: string | null;
  status: ExpenseStatus;
  created_at: string;
  updated_at: string;
}

export interface ExpenseWithDetails extends Expense {
  employee?: Profile;
  created_by_profile?: Profile;
}

// Promotion (Aksiya) types
export type PromotionType = 'percent_discount' | 'amount_discount' | 'fixed_price';
export type PromotionStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired' | 'archived' | 'cancelled';

export interface Promotion {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  type: PromotionType;
  status: PromotionStatus;
  store_id: string | null;
  start_at: string;
  end_at: string;
  priority: number;
  combinable: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromotionScope {
  id: string;
  promotion_id: string;
  scope_type: 'all' | 'products' | 'categories';
  scope_ids: string | null; // JSON array of IDs
}

export interface PromotionCondition {
  id: string;
  promotion_id: string;
  min_qty: number | null;
  min_amount: number | null;
  promo_code: string | null;
}

export interface PromotionReward {
  id: string;
  promotion_id: string;
  discount_percent: number | null;
  discount_amount: number | null;
  fixed_price: number | null;
}

export interface PromotionWithDetails extends Promotion {
  scope?: PromotionScope | null;
  condition?: PromotionCondition | null;
  reward?: PromotionReward | null;
  usage_count?: number;
  total_discount?: number;
}

// Cart item for POS terminal
export interface CartItem {
  product: Product;
  quantity: number;
  sale_unit?: string;
  qty_sale?: number;
  qty_base?: number;
  ratio_to_base?: number;
  // The actual unit price applied for this line (may differ from product.sale_price)
  unit_price: number;
  // Persist which tier was applied for this line (used for backend + reporting)
  price_tier?: 'retail' | 'master' | 'wholesale' | 'marketplace';
  price_source?: 'tier' | 'manual' | 'discount' | 'promo';
  is_price_overridden?: boolean;
  discount_amount: number;
  subtotal: number;
  total: number;
  // Promo fields (when promotion is applied)
  promotion_id?: string | null;
  promotion_name?: string | null;
}

// Quote (Smeta / Estimate)
export type QuoteStatus = 'draft' | 'confirmed' | 'expired' | 'converted';
export type QuotePriceType = 'retail' | 'usta';

export interface QuoteItem {
  id: string;
  quote_id: string;
  product_id: string;
  name_snapshot: string;
  sku_snapshot?: string | null;
  unit: string;
  quantity: number;
  unit_price: number;
  price_type_used: 'retail' | 'usta' | 'manual';
  override_price?: number | null;
  retail_price?: number | null;
  usta_price?: number | null;
  discount_percent: number;
  discount_amount: number;
  cost_price?: number | null;
  line_total: number;
  line_profit?: number | null;
  sort_order?: number;
  created_at?: string;
}

export interface Quote {
  id: string;
  quote_number: string;
  customer_id?: string | null;
  customer_name: string;
  phone?: string | null;
  price_type: QuotePriceType;
  status: QuoteStatus;
  subtotal: number;
  discount_amount: number;
  discount_percent: number;
  total: number;
  total_profit?: number | null;
  valid_until?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at?: string | null;
  created_by: string;
  converted_order_id?: string | null;
  items?: QuoteItem[];
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
  /** Mahsulotlar ro‘yxatidan keyin, jami blokidan oldin (bir necha qator) */
  middle_text: string;
  footer_text: string;
  show_logo: boolean;
  show_cashier: boolean;
  show_customer: boolean;
  show_sku: boolean;
  paper_size: '58mm' | '78mm' | '80mm';
}

export type ReceiptSectionKey =
  | 'header'
  | 'orderInfo'
  | 'products'
  | 'totals'
  | 'payments'
  | 'footer'
  | 'barcode';

export interface ReceiptHeaderSection {
  enabled: boolean;
  align: 'left' | 'center';
  fontSize: number;
  bold: boolean;
  showStoreName: boolean;
  showBranchName: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showLogo: boolean;
  branchName?: string;
}

export interface ReceiptOrderInfoSection {
  enabled: boolean;
  layout: 'single' | 'two-column';
  dateFormat: string;
  showCashier: boolean;
  showCustomer: boolean;
}

export interface ReceiptProductsSection {
  enabled: boolean;
  showSku: boolean;
  wrapMode: 'wrap' | 'truncate';
  lineSpacing: number;
}

export interface ReceiptTotalsSection {
  enabled: boolean;
  showSubtotal: boolean;
  showDiscount: boolean;
  showTax: boolean;
  boldTotal: boolean;
  largerTotal: boolean;
}

export interface ReceiptPaymentsSection {
  enabled: boolean;
}

export interface ReceiptFooterSection {
  enabled: boolean;
  text: string;
  align: 'left' | 'center';
  fontSize: number;
  bold: boolean;
}

export interface ReceiptBarcodeSection {
  enabled: boolean;
  type: 'order_id' | 'qr';
  align: 'left' | 'center';
  size: number;
}

export interface ReceiptTemplateSections {
  header: ReceiptHeaderSection;
  orderInfo: ReceiptOrderInfoSection;
  products: ReceiptProductsSection;
  totals: ReceiptTotalsSection;
  payments: ReceiptPaymentsSection;
  footer: ReceiptFooterSection;
  barcode: ReceiptBarcodeSection;
}

export interface ReceiptTemplate {
  id: string;
  name: string;
  paperWidth: 58 | 80;
  sectionsOrder: ReceiptSectionKey[];
  sections: ReceiptTemplateSections;
  updatedAt: string;
}

export interface ReceiptTemplateStore {
  templates: ReceiptTemplate[];
  active_id?: string;
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
