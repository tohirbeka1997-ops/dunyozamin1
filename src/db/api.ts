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

export const getLowStockProducts = async () => {
  const { data, error } = await supabase
    .from('products')
    .select('*, category:categories(*)')
    .filter('current_stock', 'lte', 'min_stock_level')
    .eq('is_active', true)
    .order('current_stock', { ascending: true });
  
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
export const getCustomers = async () => {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false });
  
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

export const searchCustomers = async (searchTerm: string) => {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .or(`name.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`)
    .order('name', { ascending: true })
    .limit(20);
  
  if (error) throw error;
  return Array.isArray(data) ? data as Customer[] : [];
};

export const createCustomer = async (customer: Omit<Customer, 'id' | 'created_at' | 'bonus_points' | 'debt_balance'>) => {
  const { data, error } = await supabase
    .from('customers')
    .insert(customer)
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
  const { error } = await supabase
    .from('customers')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
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
    const movementNumber = await generateMovementNumber();
    await supabase
      .from('inventory_movements')
      .insert({
        movement_number: movementNumber,
        product_id: item.product_id,
        movement_type: 'sale',
        quantity: -item.quantity,
        reference_type: 'order',
        reference_id: orderData.id,
        created_by: order.cashier_id,
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

// Sales return functions
export const getSalesReturns = async (limit = 100) => {
  const { data, error } = await supabase
    .from('sales_returns')
    .select(`
      *,
      order:orders(*),
      customer:customers(*),
      cashier:profiles(*),
      items:sales_return_items(*)
    `)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) throw error;
  return Array.isArray(data) ? data as SalesReturnWithDetails[] : [];
};

export const generateReturnNumber = async () => {
  const { data, error } = await supabase.rpc('generate_return_number');
  if (error) throw error;
  return data as string;
};

export const createSalesReturn = async (
  salesReturn: Omit<SalesReturn, 'id' | 'created_at'>,
  items: Omit<SalesReturnItem, 'id' | 'return_id'>[]
) => {
  const { data: returnData, error: returnError } = await supabase
    .from('sales_returns')
    .insert(salesReturn)
    .select()
    .maybeSingle();
  
  if (returnError) throw returnError;
  if (!returnData) throw new Error('Failed to create sales return');
  
  const returnItems = items.map(item => ({
    ...item,
    return_id: returnData.id,
  }));
  
  const { error: itemsError } = await supabase
    .from('sales_return_items')
    .insert(returnItems);
  
  if (itemsError) throw itemsError;
  
  for (const item of items) {
    const movementNumber = await generateMovementNumber();
    await supabase
      .from('inventory_movements')
      .insert({
        movement_number: movementNumber,
        product_id: item.product_id,
        movement_type: 'return',
        quantity: item.quantity,
        reference_type: 'return',
        reference_id: returnData.id,
        created_by: salesReturn.cashier_id,
      });
  }
  
  return returnData as SalesReturn;
};

// Inventory movement functions
export const getInventoryMovements = async (productId?: string, limit = 100) => {
  let query = supabase
    .from('inventory_movements')
    .select('*, product:products(name), created_by_profile:profiles(username)')
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (productId) {
    query = query.eq('product_id', productId);
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const generateMovementNumber = async () => {
  const { data, error } = await supabase.rpc('generate_movement_number');
  if (error) throw error;
  return data as string;
};

export const createInventoryMovement = async (movement: Omit<InventoryMovement, 'id' | 'created_at'>) => {
  const { data, error } = await supabase
    .from('inventory_movements')
    .insert(movement)
    .select()
    .maybeSingle();
  
  if (error) throw error;
  return data as InventoryMovement;
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
    const movementNumber = await generateMovementNumber();
    await supabase
      .from('inventory_movements')
      .insert({
        movement_number: movementNumber,
        product_id: item.product_id,
        movement_type: 'purchase',
        quantity: item.quantity,
        reference_type: 'purchase_order',
        reference_id: poData.id,
        created_by: purchaseOrder.received_by,
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
