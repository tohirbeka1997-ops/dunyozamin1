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
  EmployeeSession,
  EmployeeSessionWithProfile,
  EmployeeActivityLog,
  EmployeeActivityLogWithProfile,
  EmployeePerformance,
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
      name: customer.name,
      phone: customer.phone || null,
      email: customer.email || null,
      address: customer.address || null,
      type: customer.type || 'individual',
      company_name: customer.company_name || null,
      tax_number: customer.tax_number || null,
      credit_limit: customer.credit_limit || 0,
      allow_debt: customer.allow_debt || false,
      status: customer.status || 'active',
      notes: customer.notes || null,
    })
    .select()
    .maybeSingle();
  
  if (error) {
    console.error('Supabase error creating customer:', error);
    throw new Error(error.message || 'Failed to create customer');
  }
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
  try {
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        category:categories(id, name)
      `)
      .eq('is_active', true)
      .order('current_stock', { ascending: true });
    
    if (error) {
      console.error('Error fetching low stock products:', error);
      return [];
    }
    
    if (!Array.isArray(data)) {
      return [];
    }
    
    // Filter products where current_stock <= min_stock_level
    const lowStockProducts = data.filter(p => 
      Number(p.current_stock || 0) <= Number(p.min_stock_level || 0)
    );
    
    return lowStockProducts as ProductWithCategory[];
  } catch (error) {
    console.error('Exception fetching low stock products:', error);
    return [];
  }
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
      items:order_items(*, product:products(*, category:categories(*))),
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
      items:order_items(*, product:products(*)),
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
      items:order_items(*, product:products(*)),
      payments:payments(*)
    `)
    .eq('order_number', orderNumber)
    .maybeSingle();
  
  if (error) throw error;
  return data as OrderWithDetails | null;
};

export const getOrdersByCustomer = async (customerId: string) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      customer:customers(*),
      cashier:profiles(*),
      items:order_items(*, product:products(*)),
      payments:payments(*)
    `)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return Array.isArray(data) ? data as OrderWithDetails[] : [];
};

export const generateOrderNumber = async () => {
  const { data, error } = await supabase.rpc('generate_order_number');
  if (error) throw error;
  return data as string;
};

// Complete POS order atomically using RPC
export const completePOSOrder = async (
  order: Omit<Order, 'id' | 'created_at'>,
  items: Omit<OrderItem, 'id' | 'order_id'>[],
  payments: Omit<Payment, 'id' | 'order_id' | 'created_at'>[]
) => {
  const { data, error } = await supabase.rpc('complete_pos_order', {
    p_order: order,
    p_items: items,
    p_payments: payments,
  });
  
  if (error) {
    console.error('RPC error:', error);
    throw new Error(error.message || 'Failed to complete order');
  }
  
  if (!data) {
    throw new Error('No response from server');
  }
  
  // Parse the response
  const response = typeof data === 'string' ? JSON.parse(data) : data;
  
  if (!response.success) {
    throw new Error(response.error || 'Failed to complete order');
  }
  
  return {
    id: response.order_id,
    order_number: response.order_number,
    message: response.message,
  };
};

// Legacy createOrder function (kept for backward compatibility)
export const createOrder = async (
  order: Omit<Order, 'id' | 'created_at'>,
  items: Omit<OrderItem, 'id' | 'order_id'>[],
  payments: Omit<Payment, 'id' | 'order_id' | 'created_at'>[]
) => {
  // Use the new atomic RPC function
  return completePOSOrder(order, items, payments);
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
// Purchase Orders
export const getPurchaseOrders = async (filters?: {
  status?: string;
  supplier_id?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
}) => {
  let query = supabase
    .from('purchase_orders')
    .select(`
      *,
      supplier:suppliers(*),
      items:purchase_order_items(*),
      created_by_profile:profiles!purchase_orders_created_by_fkey(id, username, full_name),
      approved_by_profile:profiles!purchase_orders_approved_by_fkey(id, username, full_name)
    `)
    .order('created_at', { ascending: false });
  
  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  
  if (filters?.supplier_id) {
    query = query.eq('supplier_id', filters.supplier_id);
  }
  
  if (filters?.date_from) {
    query = query.gte('order_date', filters.date_from);
  }
  
  if (filters?.date_to) {
    query = query.lte('order_date', filters.date_to);
  }
  
  if (filters?.search) {
    query = query.or(`po_number.ilike.%${filters.search}%,supplier_name.ilike.%${filters.search}%`);
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  return Array.isArray(data) ? data as PurchaseOrderWithDetails[] : [];
};

export const getPurchaseOrderById = async (id: string) => {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(`
      *,
      supplier:suppliers(*),
      items:purchase_order_items(*),
      created_by_profile:profiles!purchase_orders_created_by_fkey(id, username, full_name),
      approved_by_profile:profiles!purchase_orders_approved_by_fkey(id, username, full_name)
    `)
    .eq('id', id)
    .maybeSingle();
  
  if (error) throw error;
  if (!data) throw new Error('Purchase order not found');
  return data as PurchaseOrderWithDetails;
};

export const generatePONumber = async () => {
  const { data, error } = await supabase.rpc('generate_po_number');
  if (error) throw error;
  return data as string;
};

export const createPurchaseOrder = async (
  purchaseOrder: Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'>,
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
  
  return poData as PurchaseOrder;
};

export const updatePurchaseOrder = async (
  id: string,
  purchaseOrder: Partial<PurchaseOrder>,
  items?: Omit<PurchaseOrderItem, 'id' | 'purchase_order_id'>[]
) => {
  const { data: poData, error: poError } = await supabase
    .from('purchase_orders')
    .update(purchaseOrder)
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (poError) throw poError;
  if (!poData) throw new Error('Failed to update purchase order');
  
  if (items) {
    // Delete existing items
    const { error: deleteError } = await supabase
      .from('purchase_order_items')
      .delete()
      .eq('purchase_order_id', id);
    
    if (deleteError) throw deleteError;
    
    // Insert new items
    const poItems = items.map(item => ({
      ...item,
      purchase_order_id: id,
    }));
    
    const { error: itemsError } = await supabase
      .from('purchase_order_items')
      .insert(poItems);
    
    if (itemsError) throw itemsError;
  }
  
  return poData as PurchaseOrder;
};

export const approvePurchaseOrder = async (id: string, approvedBy: string) => {
  const { data, error } = await supabase
    .from('purchase_orders')
    .update({
      status: 'approved',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  if (!data) throw new Error('Failed to approve purchase order');
  return data as PurchaseOrder;
};

export const cancelPurchaseOrder = async (id: string) => {
  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  if (!data) throw new Error('Failed to cancel purchase order');
  return data as PurchaseOrder;
};

export const receiveGoods = async (
  poId: string,
  items: Array<{
    item_id: string;
    received_qty: number;
    notes?: string;
  }>,
  receivedDate?: string
) => {
  const { data, error } = await supabase.rpc('receive_goods', {
    p_po_id: poId,
    p_items: items,
    p_received_date: receivedDate || new Date().toISOString().split('T')[0],
  });
  
  if (error) throw error;
  return data;
};

// Dashboard statistics
export const getDashboardStats = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Initialize default values
  let todaySales = 0;
  let todayOrdersCount = 0;
  let lowStockCount = 0;
  let activeCustomers = 0;
  
  // Query 1: Today's orders and sales
  try {
    const { data: todayOrders, error: ordersError } = await supabase
      .from('orders')
      .select('total_amount')
      .gte('created_at', today.toISOString())
      .eq('status', 'completed');
    
    if (!ordersError && Array.isArray(todayOrders)) {
      todaySales = todayOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
      todayOrdersCount = todayOrders.length;
    } else if (ordersError) {
      console.error('Error fetching today\'s orders:', ordersError);
    }
  } catch (error) {
    console.error('Exception fetching today\'s orders:', error);
  }
  
  // Query 2: Low stock products
  try {
    const { data: lowStockData, error: lowStockError } = await supabase
      .from('products')
      .select('id, current_stock, min_stock_level')
      .eq('is_active', true);
    
    if (!lowStockError && Array.isArray(lowStockData)) {
      // Filter products where current_stock <= min_stock_level
      lowStockCount = lowStockData.filter(p => 
        Number(p.current_stock) <= Number(p.min_stock_level)
      ).length;
    } else if (lowStockError) {
      console.error('Error fetching low stock products:', lowStockError);
    }
  } catch (error) {
    console.error('Exception fetching low stock products:', error);
  }
  
  // Query 3: Active customers
  try {
    const { data: customersData, error: customersError, count } = await supabase
      .from('customers')
      .select('id', { count: 'exact', head: true });
    
    if (!customersError && count !== null) {
      activeCustomers = count;
    } else if (!customersError && Array.isArray(customersData)) {
      activeCustomers = customersData.length;
    } else {
      console.error('Error fetching customers:', customersError);
      // Fallback: try counting without head option
      const { data: fallbackData } = await supabase
        .from('customers')
        .select('id');
      activeCustomers = Array.isArray(fallbackData) ? fallbackData.length : 0;
    }
  } catch (error) {
    console.error('Exception fetching customers:', error);
  }
  
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
export const getSalesReturnById = async (id: string) => {
  const { data, error } = await supabase
    .from('sales_returns')
    .select(`
      *,
      order:orders(id, order_number, total_amount, created_at),
      customer:customers(id, name, phone, email),
      cashier:profiles(id, username, email)
    `)
    .eq('id', id)
    .maybeSingle();
  
  if (error) {
    console.error('Error fetching sales return:', error);
    throw new Error(error.message || 'Failed to fetch sales return');
  }
  
  if (!data) {
    throw new Error('Sales return not found');
  }
  
  // Get return items with product details
  const { data: items, error: itemsError } = await supabase
    .from('sales_return_items')
    .select(`
      *,
      product:products(name, sku, barcode)
    `)
    .eq('return_id', id)
    .order('created_at', { ascending: true });
  
  if (itemsError) {
    console.error('Error fetching return items:', itemsError);
    throw new Error(itemsError.message || 'Failed to fetch return items');
  }
  
  return {
    ...data,
    items: Array.isArray(items) ? items : [],
  } as SalesReturnWithDetails;
};

export const getSalesReturns = async (filters?: {
  status?: string;
  startDate?: string;
  endDate?: string;
  customerId?: string;
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
  
  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  
  if (filters?.startDate) {
    query = query.gte('created_at', filters.startDate);
  }
  
  if (filters?.endDate) {
    query = query.lte('created_at', filters.endDate);
  }
  
  if (filters?.customerId) {
    query = query.eq('customer_id', filters.customerId);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Error fetching sales returns:', error);
    throw new Error(error.message || 'Failed to fetch sales returns');
  }
  
  return Array.isArray(data) ? data : [];
};

export const updateSalesReturn = async (
  id: string,
  updates: {
    reason?: string;
    notes?: string | null;
    status?: string;
  }
) => {
  const { data, error } = await supabase
    .from('sales_returns')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (error) {
    console.error('Error updating sales return:', error);
    throw new Error(error.message || 'Failed to update sales return');
  }
  
  if (!data) {
    throw new Error('Sales return not found');
  }
  
  return data as SalesReturn;
};

export const deleteSalesReturn = async (id: string) => {
  const { data, error } = await supabase.rpc('delete_sales_return_with_inventory', {
    p_return_id: id,
  });
  
  if (error) {
    console.error('Error deleting sales return:', error);
    throw new Error(error.message || 'Failed to delete sales return');
  }
  
  return data;
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
  refund_method?: string | null;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
}) => {
  const user = await getCurrentUser();
  if (!user) throw new Error('User not authenticated');
  
  // Validate inputs
  if (!returnData.order_id) {
    throw new Error('Order ID is required');
  }
  
  if (returnData.total_amount <= 0) {
    throw new Error('Refund amount must be greater than 0');
  }
  
  if (!returnData.reason || returnData.reason.trim() === '') {
    throw new Error('Reason for return is required');
  }
  
  if (!returnData.items || returnData.items.length === 0) {
    throw new Error('At least one item must be returned');
  }
  
  // Call RPC function to create return with inventory updates
  const { data, error } = await supabase.rpc('create_sales_return_with_inventory', {
    p_order_id: returnData.order_id,
    p_customer_id: returnData.customer_id,
    p_total_amount: returnData.total_amount,
    p_reason: returnData.reason,
    p_notes: returnData.notes || null,
    p_cashier_id: user.id,
    p_items: returnData.items,
  });
  
  if (error) {
    console.error('Error creating sales return:', error);
    throw new Error(error.message || 'Failed to create return');
  }
  
  if (!data) {
    throw new Error('Failed to create return - no data returned');
  }
  
  return data as SalesReturn;
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

// ==================== Employee Management ====================

// Get all employees
export const getAllEmployees = async () => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return Array.isArray(data) ? data as Profile[] : [];
};

// Get employee by ID
export const getEmployeeById = async (id: string) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  
  if (error) throw error;
  return data as Profile | null;
};

// Create employee
export const createEmployee = async (employeeData: {
  username: string;
  password: string;
  full_name: string;
  phone?: string;
  email?: string;
  role: 'admin' | 'manager' | 'cashier';
  is_active?: boolean;
}) => {
  const email = `${employeeData.username}@miaoda.com`;
  
  // Create auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password: employeeData.password,
  });
  
  if (authError) throw authError;
  if (!authData.user) throw new Error('Failed to create user');
  
  // Update profile with additional data
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .update({
      full_name: employeeData.full_name,
      phone: employeeData.phone || null,
      email: employeeData.email || null,
      role: employeeData.role,
      is_active: employeeData.is_active !== undefined ? employeeData.is_active : true,
    })
    .eq('id', authData.user.id)
    .select()
    .maybeSingle();
  
  if (profileError) throw profileError;
  return profileData as Profile;
};

// Update employee
export const updateEmployee = async (id: string, updates: Partial<Profile>) => {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as Profile;
};

// Deactivate employee
export const deactivateEmployee = async (id: string) => {
  return updateEmployee(id, { is_active: false });
};

// Activate employee
export const activateEmployee = async (id: string) => {
  return updateEmployee(id, { is_active: true });
};

// Delete employee (soft delete by deactivating)
export const deleteEmployee = async (id: string) => {
  return deactivateEmployee(id);
};

// ==================== Employee Sessions ====================

// Get employee sessions
export const getEmployeeSessions = async (employeeId?: string) => {
  let query = supabase
    .from('employee_sessions')
    .select(`
      *,
      employee:profiles(*)
    `)
    .order('login_time', { ascending: false });
  
  if (employeeId) {
    query = query.eq('employee_id', employeeId);
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  return Array.isArray(data) ? data as EmployeeSessionWithProfile[] : [];
};

// Start employee session
export const startEmployeeSession = async (employeeId: string, ipAddress?: string) => {
  const { data, error } = await supabase.rpc('start_employee_session', {
    p_employee_id: employeeId,
    p_ip_address: ipAddress || null,
  });
  
  if (error) throw error;
  return data as string; // Returns session ID
};

// End employee session
export const endEmployeeSession = async (sessionId: string, ipAddress?: string) => {
  const { data, error } = await supabase.rpc('end_employee_session', {
    p_session_id: sessionId,
    p_ip_address: ipAddress || null,
  });
  
  if (error) throw error;
  return data as boolean;
};

// ==================== Employee Activity Logs ====================

// Get employee activity logs
export const getEmployeeActivityLogs = async (employeeId?: string) => {
  let query = supabase
    .from('employee_activity_logs')
    .select(`
      *,
      employee:profiles(*)
    `)
    .order('created_at', { ascending: false });
  
  if (employeeId) {
    query = query.eq('employee_id', employeeId);
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  return Array.isArray(data) ? data as EmployeeActivityLogWithProfile[] : [];
};

// Log employee activity
export const logEmployeeActivity = async (
  employeeId: string,
  actionType: string,
  description: string,
  documentId?: string,
  documentType?: string,
  ipAddress?: string
) => {
  const { data, error } = await supabase.rpc('log_employee_activity', {
    p_employee_id: employeeId,
    p_action_type: actionType,
    p_description: description,
    p_document_id: documentId || null,
    p_document_type: documentType || null,
    p_ip_address: ipAddress || null,
  });
  
  if (error) throw error;
  return data as string; // Returns log ID
};

// ==================== Employee Performance ====================

// Get employee performance metrics
export const getEmployeePerformance = async (
  employeeId: string,
  startDate?: string,
  endDate?: string
) => {
  const { data, error } = await supabase.rpc('get_employee_performance', {
    p_employee_id: employeeId,
    p_start_date: startDate || null,
    p_end_date: endDate || null,
  });
  
  if (error) throw error;
  return Array.isArray(data) && data.length > 0 ? data[0] as EmployeePerformance : null;
};

// ==================== Settings Management ====================

// Get all settings by category
export const getSettingsByCategory = async (category: string) => {
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('category', category)
    .order('key', { ascending: true });
  
  if (error) throw error;
  
  // Convert to key-value object
  const settings: Record<string, unknown> = {};
  if (Array.isArray(data)) {
    data.forEach((setting) => {
      settings[setting.key] = setting.value;
    });
  }
  
  return settings;
};

// Get single setting value
export const getSetting = async (category: string, key: string) => {
  const { data, error } = await supabase.rpc('get_setting', {
    p_category: category,
    p_key: key,
  });
  
  if (error) throw error;
  return data;
};

// Update single setting
export const updateSetting = async (
  category: string,
  key: string,
  value: unknown,
  updatedBy: string
) => {
  const { data, error } = await supabase.rpc('update_setting', {
    p_category: category,
    p_key: key,
    p_value: value,
    p_updated_by: updatedBy,
  });
  
  if (error) throw error;
  return data as boolean;
};

// Bulk update settings for a category
export const bulkUpdateSettings = async (
  category: string,
  settings: Record<string, unknown>,
  updatedBy: string
) => {
  const { data, error } = await supabase.rpc('bulk_update_settings', {
    p_category: category,
    p_settings: settings,
    p_updated_by: updatedBy,
  });
  
  if (error) throw error;
  return data as number;
};

// ============================================================================
// Held Orders (Park Sale / Kutish)
// ============================================================================

// Generate held order number
export const generateHeldNumber = async (): Promise<string> => {
  const { data, error } = await supabase.rpc('generate_held_number');
  if (error) throw error;
  return data as string;
};

// Save held order
export const saveHeldOrder = async (heldOrder: {
  held_number: string;
  cashier_id: string;
  shift_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  items: unknown;
  discount: unknown;
  note: string | null;
}) => {
  const { data, error } = await supabase
    .from('held_orders')
    .insert(heldOrder)
    .select()
    .single();
  
  if (error) throw error;
  return data;
};

// Get all held orders (only HELD status)
export const getHeldOrders = async () => {
  const { data, error } = await supabase
    .from('held_orders')
    .select('*')
    .eq('status', 'HELD')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

// Get held order by ID
export const getHeldOrderById = async (id: string) => {
  const { data, error } = await supabase
    .from('held_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  
  if (error) throw error;
  return data;
};

// Update held order status (for restore or cancel)
export const updateHeldOrderStatus = async (id: string, status: 'RESTORED' | 'CANCELLED') => {
  const { data, error } = await supabase
    .from('held_orders')
    .update({ status })
    .eq('id', id)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data;
};

// Delete held order (hard delete)
export const deleteHeldOrder = async (id: string) => {
  const { error } = await supabase
    .from('held_orders')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
};
