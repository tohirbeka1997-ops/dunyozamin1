import { supabase } from './supabase';
import type {
  Profile,
  Category,
  Supplier,
  Product,
  Customer,
  Shift,
  Order,
  OrderItem,
  Payment,
  SalesReturn,
  SalesReturnItem,
  InventoryMovement,
  PurchaseOrder,
  PurchaseOrderItem,
  ProductWithCategory,
  OrderWithDetails,
  ShiftWithCashier,
  PurchaseOrderWithDetails,
  SalesReturnWithDetails,
} from '@/types/database';

// Auth functions
export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
};

export const getCurrentProfile = async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  
  if (error) throw error;
  return data as Profile | null;
};

export const signIn = async (username: string, password: string) => {
  const email = `${username}@miaoda.com`;
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
};

export const signUp = async (username: string, password: string, fullName?: string) => {
  const email = `${username}@miaoda.com`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  if (error) throw error;
  
  if (data.user && fullName) {
    await supabase
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', data.user.id);
  }
  
  return data;
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

// Profile functions
export const getProfiles = async () => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return Array.isArray(data) ? data as Profile[] : [];
};

export const updateProfile = async (id: string, updates: Partial<Profile>) => {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as Profile;
};

// Category functions
export const getCategories = async () => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('name', { ascending: true });
  
  if (error) throw error;
  return Array.isArray(data) ? data as Category[] : [];
};

export const createCategory = async (category: Omit<Category, 'id' | 'created_at'>) => {
  const { data, error } = await supabase
    .from('categories')
    .insert(category)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as Category;
};

export const updateCategory = async (id: string, updates: Partial<Category>) => {
  const { data, error } = await supabase
    .from('categories')
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as Category;
};

export const deleteCategory = async (id: string) => {
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
};

export const getCategoryProductCount = async (categoryId: string): Promise<number> => {
  const { count, error } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', categoryId);
  
  if (error) throw error;
  return count || 0;
};

export const getCategoryById = async (id: string) => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  
  if (error) throw error;
  if (!data) throw new Error('Category not found');
  return data as Category;
};

export const getProductsByCategoryId = async (categoryId: string) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('category_id', categoryId)
    .order('name', { ascending: true });
  
  if (error) throw error;
  return Array.isArray(data) ? data as Product[] : [];
};

// Supplier functions
export const getSuppliers = async () => {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .order('name', { ascending: true });
  
  if (error) throw error;
  return Array.isArray(data) ? data as Supplier[] : [];
};

export const createSupplier = async (supplier: Omit<Supplier, 'id' | 'created_at'>) => {
  const { data, error } = await supabase
    .from('suppliers')
    .insert(supplier)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as Supplier;
};

export const updateSupplier = async (id: string, updates: Partial<Supplier>) => {
  const { data, error } = await supabase
    .from('suppliers')
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as Supplier;
};

export const deleteSupplier = async (id: string) => {
  const { error } = await supabase
    .from('suppliers')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
};

// Product functions
export const getProducts = async (includeInactive = false) => {
  let query = supabase
    .from('products')
    .select('*, category:categories(*)');
  
  if (!includeInactive) {
    query = query.eq('is_active', true);
  }
  
  const { data, error } = await query.order('created_at', { ascending: false });
  
  if (error) throw error;
  return Array.isArray(data) ? data as ProductWithCategory[] : [];
};

export const getProductById = async (id: string) => {
  const { data, error } = await supabase
    .from('products')
    .select('*, category:categories(*)')
    .eq('id', id)
    .maybeSingle();
  
  if (error) throw error;
  return data as ProductWithCategory | null;
};

export const getProductByBarcode = async (barcode: string) => {
  const { data, error } = await supabase
    .from('products')
    .select('*, category:categories(*)')
    .eq('barcode', barcode)
    .eq('is_active', true)
    .maybeSingle();
  
  if (error) throw error;
  return data as ProductWithCategory | null;
};

export const searchProducts = async (searchTerm: string) => {
  const { data, error } = await supabase
    .from('products')
    .select('*, category:categories(*)')
    .or(`name.ilike.%${searchTerm}%,sku.ilike.%${searchTerm}%,barcode.ilike.%${searchTerm}%`)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(20);
  
  if (error) throw error;
  return Array.isArray(data) ? data as ProductWithCategory[] : [];
};

export const generateSKU = async () => {
  const { data, error } = await supabase.rpc('generate_sku');
  if (error) throw error;
  return data as string;
};

export const createProduct = async (product: Omit<Product, 'id' | 'created_at' | 'updated_at' | 'current_stock'>) => {
  const { data, error } = await supabase
    .from('products')
    .insert(product)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as Product;
};

export const updateProduct = async (id: string, updates: Partial<Product>) => {
  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as Product;
};

export const deleteProduct = async (id: string) => {
  const { error } = await supabase
    .from('products')
    .update({ is_active: false })
    .eq('id', id);
  
  if (error) throw error;
};

// Customer functions
export const getCustomers = async (filters?: {
  searchTerm?: string;
  type?: string;
  status?: string;
  hasDebt?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) => {
  let query = supabase
    .from('customers')
    .select('*');
  
  if (filters?.searchTerm) {
    query = query.or(`name.ilike.%${filters.searchTerm}%,phone.ilike.%${filters.searchTerm}%,email.ilike.%${filters.searchTerm}%`);
  }
  
  if (filters?.type && filters.type !== 'all') {
    query = query.eq('type', filters.type);
  }
  
  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }
  
  if (filters?.hasDebt !== undefined) {
    if (filters.hasDebt) {
      query = query.gt('balance', 0);
    } else {
      query = query.lte('balance', 0);
    }
  }
  
  const sortBy = filters?.sortBy || 'created_at';
  const sortOrder = filters?.sortOrder || 'desc';
  query = query.order(sortBy, { ascending: sortOrder === 'asc' });
  
  const { data, error } = await query;
  
  if (error) throw error;
  return Array.isArray(data) ? data as Customer[] : [];
};

export const getCustomerById = async (id: string) => {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  
  if (error) throw error;
  return data as Customer | null;
};

export const getCustomerWithStats = async (id: string) => {
  const customer = await getCustomerById(id);
  if (!customer) return null;
  
  const { data: orders } = await supabase
    .from('orders')
    .select('total_amount')
    .eq('customer_id', id)
    .eq('status', 'completed');
  
  const { data: returns } = await supabase
    .from('sales_returns')
    .select('total_amount')
    .eq('customer_id', id)
    .eq('status', 'Completed');
  
  const orderCount = orders?.length || 0;
  const totalReturns = returns?.reduce((sum, r) => sum + Number(r.total_amount), 0) || 0;
  const avgOrderValue = orderCount > 0 ? customer.total_sales / orderCount : 0;
  
  return {
    ...customer,
    order_count: orderCount,
    avg_order_value: avgOrderValue,
    total_returns: totalReturns,
  };
};

export const searchCustomers = async (searchTerm: string) => {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .or(`name.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`)
    .eq('status', 'active')
    .order('name', { ascending: true })
    .limit(20);
  
  if (error) throw error;
  return Array.isArray(data) ? data as Customer[] : [];
};

export const createCustomer = async (customer: {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  type?: 'individual' | 'company';
  company_name?: string | null;
  tax_number?: string | null;
  credit_limit?: number;
  allow_debt?: boolean;
  notes?: string | null;
  status?: 'active' | 'inactive';
}) => {
  const { data, error } = await supabase
    .from('customers')
    .insert({
      ...customer,
      type: customer.type || 'individual',
      credit_limit: customer.credit_limit || 0,
      allow_debt: customer.allow_debt || false,
      status: customer.status || 'active',
      balance: 0,
      total_sales: 0,
      bonus_points: 0,
      debt_balance: 0,
    })
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as Customer;
};

export const updateCustomer = async (id: string, updates: Partial<Customer>) => {
  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as Customer;
};

export const deleteCustomer = async (id: string) => {
  const { data: orders } = await supabase
    .from('orders')
    .select('id')
    .eq('customer_id', id)
    .limit(1);
  
  if (orders && orders.length > 0) {
    await updateCustomer(id, { status: 'inactive' });
    throw new Error('Customer has orders. Marked as inactive instead of deleting.');
  }
  
  const { error } = await supabase
    .from('customers')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
};

export const getCustomerOrders = async (customerId: string) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      cashier:profiles(*),
      items:order_items(*),
      payments:payments(*)
    `)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const getCustomerPayments = async (customerId: string) => {
  const { data: orders } = await supabase
    .from('orders')
    .select('id')
    .eq('customer_id', customerId);
  
  if (!orders || orders.length === 0) {
    return [];
  }
  
  const orderIds = orders.map(o => o.id);
  
  const { data, error } = await supabase
    .from('payments')
    .select(`
      *,
      order:orders(order_number, customer_id)
    `)
    .in('order_id', orderIds)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const getCustomerReturns = async (customerId: string) => {
  const { data, error } = await supabase
    .from('sales_returns')
    .select(`
      *,
      order:orders(order_number),
      items:sales_return_items(*)
    `)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

// Inventory functions
export const getInventory = async (filters?: {
  searchTerm?: string;
  categoryId?: string;
  stockStatus?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) => {
  let query = supabase
    .from('products')
    .select(`
      *,
      category:categories(name)
    `);
  
  if (filters?.searchTerm) {
    query = query.or(`name.ilike.%${filters.searchTerm}%,sku.ilike.%${filters.searchTerm}%,barcode.ilike.%${filters.searchTerm}%`);
  }
  
  if (filters?.categoryId && filters.categoryId !== 'all') {
    query = query.eq('category_id', filters.categoryId);
  }
  
  if (filters?.stockStatus && filters.stockStatus !== 'all') {
    if (filters.stockStatus === 'out_of_stock') {
      query = query.eq('current_stock', 0);
    } else if (filters.stockStatus === 'low_stock') {
      query = query.gt('current_stock', 0).filter('current_stock', 'lte', supabase.rpc('minimal_stock'));
    }
  }
  
  const sortBy = filters?.sortBy || 'name';
  const sortOrder = filters?.sortOrder || 'asc';
  query = query.order(sortBy, { ascending: sortOrder === 'asc' });
  
  const { data, error } = await query;
  
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const getLowStockProducts = async () => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .gt('current_stock', 0)
    .order('current_stock', { ascending: true });
  
  if (error) throw error;
  
  const products = Array.isArray(data) ? data as Product[] : [];
  return products.filter(p => Number(p.current_stock) <= Number(p.min_stock_level));
};

export const getInventoryMovements = async (productId: string) => {
  const { data, error } = await supabase
    .from('inventory_movements')
    .select(`
      *,
      product:products(name, sku),
      user:profiles(username, full_name)
    `)
    .eq('product_id', productId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const getAllInventoryMovements = async (filters?: {
  productId?: string;
  movementType?: string;
  startDate?: string;
  endDate?: string;
}) => {
  let query = supabase
    .from('inventory_movements')
    .select(`
      *,
      product:products(name, sku),
      user:profiles(username, full_name)
    `);
  
  if (filters?.productId) {
    query = query.eq('product_id', filters.productId);
  }
  
  if (filters?.movementType && filters.movementType !== 'all') {
    query = query.eq('movement_type', filters.movementType);
  }
  
  if (filters?.startDate) {
    query = query.gte('created_at', filters.startDate);
  }
  
  if (filters?.endDate) {
    query = query.lte('created_at', filters.endDate);
  }
  
  query = query.order('created_at', { ascending: false });
  
  const { data, error } = await query;
  
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const createStockAdjustment = async (adjustment: {
  product_id: string;
  quantity: number;
  reason: string;
  notes?: string;
}) => {
  const { data, error } = await supabase.rpc('log_inventory_movement', {
    p_product_id: adjustment.product_id,
    p_movement_type: 'adjustment',
    p_quantity: adjustment.quantity,
    p_reference_type: 'manual_adjustment',
    p_reference_id: null,
    p_reason: adjustment.reason,
    p_notes: adjustment.notes || null,
    p_created_by: null,
  });
  
  if (error) throw error;
  return data;
};

export const getProductPurchaseHistory = async (productId: string) => {
  const { data, error } = await supabase
    .from('purchase_order_items')
    .select(`
      *,
      purchase_order:purchase_orders(
        po_number,
        created_at,
        supplier:suppliers(name)
      )
    `)
    .eq('product_id', productId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const getProductSalesHistory = async (productId: string) => {
  const { data, error } = await supabase
    .from('order_items')
    .select(`
      *,
      order:orders(
        order_number,
        created_at,
        customer:customers(name)
      )
    `)
    .eq('product_id', productId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

// Shift functions
export const getShifts = async (limit = 50) => {
  const { data, error } = await supabase
    .from('shifts')
    .select('*, cashier:profiles(*)')
    .order('opened_at', { ascending: false })
    .limit(limit);
  
  if (error) throw error;
  return Array.isArray(data) ? data as ShiftWithCashier[] : [];
};

export const getActiveShift = async (cashierId: string) => {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('cashier_id', cashierId)
    .eq('status', 'open')
    .maybeSingle();
  
  if (error) throw error;
  return data as Shift | null;
};

export const generateShiftNumber = async () => {
  const { data, error } = await supabase.rpc('generate_shift_number');
  if (error) throw error;
  return data as string;
};

export const createShift = async (shift: Omit<Shift, 'id' | 'closed_at' | 'closing_cash' | 'expected_cash' | 'cash_difference'>) => {
  const { data, error } = await supabase
    .from('shifts')
    .insert(shift)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as Shift;
};

export const closeShift = async (id: string, closingCash: number, notes?: string) => {
  const shift = await supabase
    .from('shifts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  
  if (shift.error) throw shift.error;
  if (!shift.data) throw new Error('Shift not found');
  
  const orders = await supabase
    .from('orders')
    .select('total_amount')
    .eq('shift_id', id);
  
  if (orders.error) throw orders.error;
  
  const expectedCash = shift.data.opening_cash + 
    (Array.isArray(orders.data) ? orders.data.reduce((sum, o) => sum + Number(o.total_amount), 0) : 0);
  const cashDifference = closingCash - expectedCash;
  
  const { data, error } = await supabase
    .from('shifts')
    .update({
      closed_at: new Date().toISOString(),
      closing_cash: closingCash,
      expected_cash: expectedCash,
      cash_difference: cashDifference,
      status: 'closed',
      notes,
    })
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as Shift;
};

// Order functions
export const getOrders = async (limit = 100) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      customer:customers(*),
      cashier:profiles(*),
      items:order_items(*),
      payments:payments(*)
    `)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) throw error;
  return Array.isArray(data) ? data as OrderWithDetails[] : [];
};

export const getOrderById = async (id: string) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      customer:customers(*),
      cashier:profiles(*),
      items:order_items(*),
      payments:payments(*)
    `)
    .eq('id', id)
    .maybeSingle();
  
  if (error) throw error;
  return data as OrderWithDetails | null;
};

export const getOrderByNumber = async (orderNumber: string) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      customer:customers(*),
      cashier:profiles(*),
      items:order_items(*),
      payments:payments(*)
    `)
    .eq('order_number', orderNumber)
    .maybeSingle();
  
  if (error) throw error;
  return data as OrderWithDetails | null;
};

export const generateOrderNumber = async () => {
  const { data, error } = await supabase.rpc('generate_order_number');
  if (error) throw error;
  return data as string;
};

export const createOrder = async (
  order: Omit<Order, 'id' | 'created_at'>,
  items: Omit<OrderItem, 'id' | 'order_id'>[],
  payments: Omit<Payment, 'id' | 'order_id' | 'created_at'>[]
) => {
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .insert(order)
    .select()
    .maybeSingle();
  
  if (orderError) throw orderError;
  if (!orderData) throw new Error('Failed to create order');
  
  const orderItems = items.map(item => ({
    ...item,
    order_id: orderData.id,
  }));
  
  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(orderItems);
  
  if (itemsError) throw itemsError;
  
  const orderPayments = payments.map(payment => ({
    ...payment,
    order_id: orderData.id,
  }));
  
  const { error: paymentsError } = await supabase
    .from('payments')
    .insert(orderPayments);
  
  if (paymentsError) throw paymentsError;
  
  for (const item of items) {
    await supabase.rpc('log_inventory_movement', {
      p_product_id: item.product_id,
      p_movement_type: 'sale',
      p_quantity: -item.quantity,
      p_reference_type: 'order',
      p_reference_id: orderData.id,
      p_reason: null,
      p_notes: null,
      p_created_by: order.cashier_id,
    });
  }
  
  return orderData as Order;
};

export const updateOrderStatus = async (id: string, status: string) => {
  const { data, error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as Order;
};

// Payment functions
export const generatePaymentNumber = async () => {
  const { data, error } = await supabase.rpc('generate_payment_number');
  if (error) throw error;
  return data as string;
};

// Purchase order functions
export const getPurchaseOrders = async (limit = 100) => {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(`
      *,
      supplier:suppliers(*),
      items:purchase_order_items(*),
      received_by_profile:profiles(*)
    `)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) throw error;
  return Array.isArray(data) ? data as PurchaseOrderWithDetails[] : [];
};

export const generatePONumber = async () => {
  const { data, error } = await supabase.rpc('generate_po_number');
  if (error) throw error;
  return data as string;
};

export const createPurchaseOrder = async (
  purchaseOrder: Omit<PurchaseOrder, 'id' | 'created_at'>,
  items: Omit<PurchaseOrderItem, 'id' | 'purchase_order_id'>[]
) => {
  const { data: poData, error: poError } = await supabase
    .from('purchase_orders')
    .insert(purchaseOrder)
    .select()
    .maybeSingle();
  
  if (poError) throw poError;
  if (!poData) throw new Error('Failed to create purchase order');
  
  const poItems = items.map(item => ({
    ...item,
    purchase_order_id: poData.id,
  }));
  
  const { error: itemsError } = await supabase
    .from('purchase_order_items')
    .insert(poItems);
  
  if (itemsError) throw itemsError;
  
  for (const item of items) {
    await supabase.rpc('log_inventory_movement', {
      p_product_id: item.product_id,
      p_movement_type: 'purchase',
      p_quantity: item.quantity,
      p_reference_type: 'purchase_order',
      p_reference_id: poData.id,
      p_reason: null,
      p_notes: null,
      p_created_by: purchaseOrder.received_by,
    });
  }
  
  return poData as PurchaseOrder;
};

// Dashboard statistics
export const getDashboardStats = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const { data: todayOrders, error: ordersError } = await supabase
    .from('orders')
    .select('total_amount')
    .gte('created_at', today.toISOString())
    .eq('status', 'completed');
  
  if (ordersError) throw ordersError;
  
  const todaySales = Array.isArray(todayOrders) 
    ? todayOrders.reduce((sum, o) => sum + Number(o.total_amount), 0) 
    : 0;
  const todayOrdersCount = Array.isArray(todayOrders) ? todayOrders.length : 0;
  
  const { data: lowStockData, error: lowStockError } = await supabase
    .from('products')
    .select('id')
    .filter('current_stock', 'lte', 'min_stock_level')
    .eq('is_active', true);
  
  if (lowStockError) throw lowStockError;
  
  const lowStockCount = Array.isArray(lowStockData) ? lowStockData.length : 0;
  
  const { data: customersData, error: customersError } = await supabase
    .from('customers')
    .select('id');
  
  if (customersError) throw customersError;
  
  const activeCustomers = Array.isArray(customersData) ? customersData.length : 0;
  
  return {
    today_sales: todaySales,
    today_orders: todayOrdersCount,
    low_stock_count: lowStockCount,
    active_customers: activeCustomers,
    total_revenue: todaySales,
    total_profit: 0,
  };
};

// Sales Returns functions
export const getSalesReturns = async (filters?: {
  startDate?: string;
  endDate?: string;
  customerId?: string;
  cashierId?: string;
  status?: string;
}) => {
  let query = supabase
    .from('sales_returns')
    .select(`
      *,
      order:orders(order_number),
      customer:customers(name),
      cashier:profiles(username)
    `)
    .order('created_at', { ascending: false });
  
  if (filters?.startDate) {
    query = query.gte('created_at', filters.startDate);
  }
  if (filters?.endDate) {
    query = query.lte('created_at', filters.endDate);
  }
  if (filters?.customerId) {
    query = query.eq('customer_id', filters.customerId);
  }
  if (filters?.cashierId) {
    query = query.eq('cashier_id', filters.cashierId);
  }
  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const getSalesReturnById = async (id: string) => {
  const { data, error } = await supabase
    .from('sales_returns')
    .select(`
      *,
      order:orders(*),
      customer:customers(*),
      cashier:profiles(*)
    `)
    .eq('id', id)
    .maybeSingle();
  
  if (error) throw error;
  if (!data) throw new Error('Sales return not found');
  
  // Get return items with product details
  const { data: items, error: itemsError } = await supabase
    .from('sales_return_items')
    .select(`
      *,
      product:products(name, sku, barcode)
    `)
    .eq('return_id', id)
    .order('created_at', { ascending: true });
  
  if (itemsError) throw itemsError;
  
  return {
    ...data,
    items: Array.isArray(items) ? items : [],
  } as SalesReturnWithDetails;
};

export const getOrderForReturn = async (orderId: string) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      customer:customers(*),
      cashier:profiles(*),
      items:order_items(
        *,
        product:products(name, sku, barcode, image_url)
      )
    `)
    .eq('id', orderId)
    .maybeSingle();
  
  if (error) throw error;
  if (!data) throw new Error('Order not found');
  
  return data as OrderWithDetails;
};

export const createSalesReturn = async (returnData: {
  order_id: string;
  customer_id: string | null;
  total_amount: number;
  reason: string;
  notes: string | null;
  refund_method: string | null;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
}) => {
  const user = await getCurrentUser();
  if (!user) throw new Error('User not authenticated');
  
  // Create return
  const { data: returnRecord, error: returnError } = await supabase
    .from('sales_returns')
    .insert({
      return_number: '', // Will be auto-generated
      order_id: returnData.order_id,
      customer_id: returnData.customer_id,
      total_amount: returnData.total_amount,
      status: 'Pending',
      reason: returnData.reason,
      notes: returnData.notes,
      refund_method: returnData.refund_method,
      cashier_id: user.id,
    })
    .select()
    .maybeSingle();
  
  if (returnError) throw returnError;
  if (!returnRecord) throw new Error('Failed to create return');
  
  // Create return items
  const itemsToInsert = returnData.items.map(item => ({
    return_id: returnRecord.id,
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price: item.unit_price,
    line_total: item.line_total,
  }));
  
  const { error: itemsError } = await supabase
    .from('sales_return_items')
    .insert(itemsToInsert);
  
  if (itemsError) throw itemsError;
  
  return returnRecord as SalesReturn;
};

export const updateSalesReturnStatus = async (id: string, status: string) => {
  const { error } = await supabase
    .from('sales_returns')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  
  if (error) throw error;
};

export const cancelSalesReturn = async (id: string) => {
  await updateSalesReturnStatus(id, 'Cancelled');
};

export const completeSalesReturn = async (id: string) => {
  await updateSalesReturnStatus(id, 'Completed');
};

export const getSalesReturnsByOrderId = async (orderId: string) => {
  const { data, error } = await supabase
    .from('sales_returns')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return Array.isArray(data) ? data as SalesReturn[] : [];
};
