// Supabase API implementation
// All functions use Supabase for data operations

import { supabase } from '@/lib/supabase';
import { addToOutbox, saveLocalOrder } from '@/offline/db';
import { delay } from '@/lib/delay';

import type {
  Profile,
  Category,
  Supplier,
  SupplierWithBalance,
  SupplierPayment,
  SupplierLedgerEntry,
  Product,
  Customer,
  Shift,
  Order,
  OrderItem,
  Payment,
  CustomerPayment,
  SalesReturn,
  InventoryMovement,
  PurchaseOrder,
  PurchaseOrderItem,
  ProductWithCategory,
  OrderWithDetails,
  ShiftWithCashier,
  PurchaseOrderWithDetails,
  SalesReturnWithDetails,
  EmployeeSessionWithProfile,
  EmployeeActivityLogWithProfile,
  HeldOrder,
  CartItem,
  Expense,
  ExpenseWithDetails,
  ExpenseCategory,
  ExpensePaymentMethod,
} from '@/types/database';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const generateSKUHelper = (): string => {
  // Client-side SKU generation fallback
  // In production, use Supabase RPC generate_sku() if available
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const datePart = today.substring(0, 8); // YYYYMMDD
  const timestamp = Date.now().toString().slice(-6);
  return `SKU-${datePart}-${timestamp}`;
};

// ============================================================================
// AUTH FUNCTIONS
// ============================================================================
// Note: Auth is handled by AuthContext using Supabase Auth directly
// These functions are kept for backward compatibility but should not be used

// ============================================================================
// PROFILE FUNCTIONS (Mock)
// ============================================================================

export const getProfiles = async () => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('is_active', true)
    .order('full_name');

  if (error) {
    console.error('Error fetching profiles:', error);
    throw error;
  }

  return (data || []) as Profile[];
};

export const updateProfile = async (id: string, updates: Partial<Profile>) => {
  const { data, error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating profile:', error);
    throw error;
  }

  if (!data) {
    throw new Error('Profile not found');
  }

  return data as Profile;
};

// ============================================================================
// CATEGORY FUNCTIONS
// ============================================================================

export const getCategories = async () => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('name');

  if (error) {
    console.error('Error fetching categories:', error);
    throw error;
  }

  return (data || []) as Category[];
};

export const createCategory = async (category: Omit<Category, 'id' | 'created_at'>) => {
  const { data, error } = await supabase
    .from('categories')
    .insert(category)
    .select()
    .single();

  if (error) {
    console.error('Error creating category:', error);
    throw error;
  }

  return data as Category;
};

export const updateCategory = async (id: string, updates: Partial<Category>) => {
  const { data, error } = await supabase
    .from('categories')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating category:', error);
    throw error;
  }

  if (!data) {
    throw new Error('Category not found');
  }

  return data as Category;
};

export const deleteCategory = async (id: string) => {
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting category:', error);
    throw error;
  }
};

export const getCategoryProductCount = async (categoryId: string): Promise<number> => {
  const { count, error } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', categoryId);

  if (error) {
    console.error('Error counting category products:', error);
    throw error;
  }

  return count || 0;
};

export const getCategoryById = async (id: string) => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching category:', error);
    throw error;
  }

  if (!data) {
    throw new Error('Category not found');
  }

  return data as Category;
};

export const getProductsByCategoryId = async (categoryId: string) => {
  const { data, error } = await supabase
    .from('products')
    .select('*, category:categories(*)')
    .eq('category_id', categoryId)
    .eq('is_active', true)
    .order('name');

  if (error) {
    console.error('Error fetching products by category:', error);
    throw error;
  }

  return (data || []) as ProductWithCategory[];
};

// ============================================================================
// PRODUCT FUNCTIONS
// ============================================================================

// Simple event emitter for product updates (for real-time stock synchronization)
class ProductUpdateEmitter {
  private listeners: Set<() => void> = new Set();

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  emit(): void {
    this.listeners.forEach(callback => callback());
  }
}

// Global emitter instance - exported for use in hooks
export const productUpdateEmitter = new ProductUpdateEmitter();

// Make available on window for cross-module access
if (typeof window !== 'undefined') {
  (window as any).productUpdateEmitter = productUpdateEmitter;
}

/**
 * Calculate current stock for a product from inventory movements
 * This is the source of truth for stock calculation
 * Stock = sum of all movement quantities for the product
 */
const calculateProductStockFromMovements = (productId: string): number => {
  const movements = mockDB.inventoryMovements.filter(m => m.product_id === productId);
  // Sum all movement quantities (negative for sales, positive for purchases/returns)
  const stockFromMovements = movements.reduce((sum, movement) => {
    return sum + (movement.quantity || 0);
  }, 0);

  // Get base stock from product (for initial stock or products without movements)
  const product = mockDB.products.find(p => p.id === productId);
  const baseStock = product?.current_stock || 0;

  // If we have movements, use movement-based calculation
  // Otherwise, use the product's current_stock as fallback
  if (movements.length > 0) {
    return stockFromMovements;
  }

  return baseStock;
};

/**
 * Get product stock summary - returns current stock calculated from movements
 * This ensures stock is always accurate and reflects all inventory changes
 */
export const getProductStockSummary = async (): Promise<Record<string, number>> => {
  await delay(100);
  const stockMap: Record<string, number> = {};

  // Calculate stock for all products
  mockDB.products.forEach(product => {
    stockMap[product.id] = calculateProductStockFromMovements(product.id);
  });

  return stockMap;
};

export const getProducts = async (
  includeInactive = false,
  filters?: {
    searchTerm?: string;
    categoryId?: string;
    status?: 'active' | 'inactive' | 'all';
    stockStatus?: 'all' | 'low' | 'out';
    sortBy?: 'name' | 'created_at' | 'current_stock' | 'sale_price';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    storeId?: string | null;
  }
) => {
  // DEBUG LOGS
  console.log('FETCH PRODUCTS request:', { includeInactive, filters });

  let query = supabase
    .from('products')
    .select('*, category:categories(*)');

  // Filter by active status
  // Remove redundant check if includeInactive is false, just use the status filter logic
  if (!includeInactive) {
    // If not including inactive, Force is_active=true unless specifically asked for inactive (conflict?)
    // Ideally trust the filters or default to active
    if (filters?.status === 'inactive') {
      // Contradiction: includeInactive=false but status='inactive'. 
      // Assume we show nothing or validly inactive? 
      // Let's stick to standard POS logic: Main list shows active.
      query = query.eq('is_active', false);
    } else {
      query = query.eq('is_active', true);
    }
  } else {
    // includeInactive is true (likely admin view or specific filter)
    if (filters?.status === 'active') {
      query = query.eq('is_active', true);
    } else if (filters?.status === 'inactive') {
      query = query.eq('is_active', false);
    }
  }

  // Filter by Store ID (ONLY if provided and valid UUID)
  if (filters?.storeId) {
    console.log('Applying store_id filter:', filters.storeId);
    query = query.eq('store_id', filters.storeId);
  } else {
    console.log('Skipping store_id filter (not provided)');
  }

  // Search filter
  if (filters?.searchTerm) {
    const term = filters.searchTerm.toLowerCase();
    query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`);
  }

  // Category filter
  if (filters?.categoryId && filters.categoryId !== 'all') {
    query = query.eq('category_id', filters.categoryId);
  }

  // Stock status filter - Note: low stock filter requires post-processing
  if (filters?.stockStatus === 'out') {
    query = query.eq('current_stock', 0);
  }

  // Sort
  const sortBy = filters?.sortBy || 'created_at';
  const sortOrder = filters?.sortOrder || 'desc';
  query = query.order(sortBy, { ascending: sortOrder === 'asc' });

  // Pagination
  const offset = filters?.offset || 0;
  const limit = filters?.limit || 50;
  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;

  if (error) {
    console.error('FETCH PRODUCTS error:', error);
    // Import error logger dynamically to avoid circular dependencies
    const { logSupabaseError } = await import('@/lib/supabaseErrorLogger');
    logSupabaseError(error, { table: 'products', operation: 'select', queryKey: 'getProducts' });
    throw error;
  }

  console.log('FETCH PRODUCTS data length:', data?.length);

  let products = (data || []) as ProductWithCategory[];

  // Apply low stock filter if needed (compare current_stock with min_stock_level)
  if (filters?.stockStatus === 'low') {
    products = products.filter(p =>
      (p.current_stock || 0) > 0 &&
      (p.current_stock || 0) <= (p.min_stock_level || 0)
    );
  }

  return products;
};

export const getProductById = async (id: string) => {
  const { data, error } = await supabase
    .from('products')
    .select('*, category:categories(*)')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    console.error('Error fetching product:', error);
    throw error;
  }

  return data as ProductWithCategory;
};

export const getProductByBarcode = async (barcode: string) => {
  const { data, error } = await supabase
    .from('products')
    .select('*, category:categories(*)')
    .eq('barcode', barcode)
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    console.error('Error fetching product by barcode:', error);
    throw error;
  }

  return data as ProductWithCategory;
};

export const searchProducts = async (searchTerm: string) => {
  const term = searchTerm.toLowerCase();
  const { data, error } = await supabase
    .from('products')
    .select('*, category:categories(*)')
    .eq('is_active', true)
    .or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`)
    .limit(20);

  if (error) {
    console.error('Error searching products:', error);
    throw error;
  }

  return (data || []) as ProductWithCategory[];
};

export const generateSKU = async () => {
  // Use Supabase RPC if available, otherwise generate client-side
  try {
    const { data, error } = await supabase.rpc('generate_sku');
    if (!error && data) {
      return data;
    }
  } catch (e) {
    // Fallback to client-side generation
  }
  return generateSKUHelper();
};

export const createProduct = async (
  product: Omit<Product, 'id' | 'created_at' | 'updated_at' | 'current_stock'>,
  initialStock?: number
) => {
  const unit = product.unit || 'pcs';
  const sku = product.sku || await generateSKU();

  // Get current user for created_by
  const { data: { user } } = await supabase.auth.getUser();
  const createdBy = user?.id || null;

  // store_id should be null if not available (DB column is nullable)
  const storeId = null;

  const productData = {
    ...product,
    sku,
    unit,
    current_stock: initialStock || 0,
    store_id: storeId,
  };

  const { data, error } = await supabase
    .from('products')
    .insert(productData)
    .select('*, category:categories(*)')
    .single();

  if (error) {
    console.error('Error creating product:', error);
    throw error;
  }

  // Create inventory movement if initial stock > 0
  if (initialStock && initialStock > 0 && data) {
    const { error: movementError } = await supabase
      .from('inventory_movements')
      .insert({
        product_id: data.id,
        movement_type: 'adjustment',
        quantity: initialStock,
        reference_type: 'product_creation',
        reference_id: data.id,
        reason: 'Initial stock on product creation',
        notes: `Initial stock: ${initialStock} ${unit}`,
        created_by: createdBy,
      });

    if (movementError) {
      console.error('Error creating inventory movement:', movementError);
      // Don't throw - product was created successfully
    }
  }

  return data as ProductWithCategory;
};

export const updateProduct = async (id: string, updates: Partial<Product>) => {
  const { data: existingProduct } = await supabase
    .from('products')
    .select('unit')
    .eq('id', id)
    .single();

  // Ensure unit defaults to existing or 'pcs'
  const safeUpdates = {
    ...updates,
    unit: updates.unit || existingProduct?.unit || 'pcs',
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('products')
    .update(safeUpdates)
    .eq('id', id)
    .select('*, category:categories(*)')
    .single();

  if (error) {
    console.error('Error updating product:', error);
    throw error;
  }

  if (!data) {
    throw new Error('Product not found');
  }

  // Emit update event for real-time sync
  productUpdateEmitter.emit();

  return data as ProductWithCategory;
};

export const deleteProduct = async (id: string) => {
  // Check if product has orders
  const { count: orderCount } = await supabase
    .from('order_items')
    .select('*', { count: 'exact', head: true })
    .eq('product_id', id);

  if (orderCount && orderCount > 0) {
    // Soft delete - mark as inactive
    const { error } = await supabase
      .from('products')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('Error soft deleting product:', error);
      throw error;
    }
  } else {
    // Hard delete - no orders exist
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting product:', error);
      throw error;
    }
  }

  // Emit update event
  productUpdateEmitter.emit();
};

// ============================================================================
// INVENTORY FUNCTIONS
// ============================================================================

export const getInventory = async (filters?: {
  searchTerm?: string;
  categoryId?: string;
  stockStatus?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) => {
  await delay(100);
  return getProducts(false, filters as any);
};

export const getLowStockProducts = async () => {
  const { data, error } = await supabase
    .from('products')
    .select('*, category:categories(*)')
    .eq('is_active', true)
    .gt('current_stock', 0)
    .lte('current_stock', supabase.raw('min_stock_level'))
    .order('current_stock', { ascending: true });

  if (error) {
    console.error('Error fetching low stock products:', error);
    // Fallback: fetch all and filter client-side
    const allProducts = await getProducts(false, { status: 'active' });
    return allProducts.filter(p =>
      (p.current_stock || 0) > 0 &&
      (p.current_stock || 0) <= (p.min_stock_level || 0)
    );
  }

  return (data || []) as ProductWithCategory[];
};

export const getInventoryMovements = async (productId: string) => {
  await delay(100);
  const movements = mockDB.inventoryMovements.filter(m => m.product_id === productId);

  return movements.map(m => ({
    ...m,
    product: mockDB.products.find(p => p.id === m.product_id) || null,
    created_by_profile: null,
  })) as any[];
};

export const getAllInventoryMovements = async (filters?: {
  productId?: string;
  movementType?: string;
  startDate?: string;
  endDate?: string;
}) => {
  await delay(100);
  let movements = [...mockDB.inventoryMovements];

  if (filters?.productId) {
    movements = movements.filter(m => m.product_id === filters.productId);
  }

  if (filters?.movementType && filters.movementType !== 'all') {
    movements = movements.filter(m => m.movement_type === filters.movementType);
  }

  if (filters?.startDate) {
    movements = movements.filter(m => m.created_at >= filters.startDate!);
  }

  if (filters?.endDate) {
    movements = movements.filter(m => m.created_at <= filters.endDate!);
  }

  return movements.map(m => ({
    ...m,
    product: mockDB.products.find(p => p.id === m.product_id) || null,
    user: null,
  })) as any[];
};

export const createStockAdjustment = async (adjustment: {
  product_id: string;
  quantity: number;
  reason: string;
  notes?: string;
}) => {
  await delay(100);

  const product = mockDB.products.find(p => p.id === adjustment.product_id);
  if (!product) throw new Error('Product not found');

  // Update product stock
  product.current_stock += adjustment.quantity;
  product.updated_at = new Date().toISOString();

  // Create movement record
  const oldStock = product.current_stock - adjustment.quantity;
  const movement: InventoryMovement = {
    id: generateId(),
    product_id: adjustment.product_id,
    movement_number: `MOV-${Date.now()}`,
    movement_type: 'adjustment',
    quantity: adjustment.quantity,
    before_quantity: oldStock,
    after_quantity: product.current_stock,
    reference_type: 'manual_adjustment',
    reference_id: null,
    reason: adjustment.reason,
    notes: adjustment.notes || null,
    created_by: 'mock-user-id',
    created_at: new Date().toISOString(),
  };

  mockDB.inventoryMovements.push(movement);

  // Emit product update event for real-time stock updates
  productUpdateEmitter.emit();

  return movement;
};

export const getProductPurchaseHistory = async (_productId: string) => {
  await delay(100);
  return [] as any[];
};

export const getProductSalesHistory = async (_productId: string) => {
  await delay(100);
  return [] as any[];
};

// ============================================================================
// SUPPLIER FUNCTIONS (Mock)
// ============================================================================

const STORAGE_KEY_SUPPLIERS = 'pos_suppliers';
const STORAGE_KEY_SUPPLIER_PAYMENTS = 'pos_supplier_payments';

// Get suppliers from localStorage
const getStoredSuppliers = (): Supplier[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SUPPLIERS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to read suppliers from localStorage:', error);
  }
  return [];
};

// Save suppliers to localStorage
const saveSuppliers = (suppliers: Supplier[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_SUPPLIERS, JSON.stringify(suppliers));
  } catch (error) {
    console.error('Failed to save suppliers to localStorage:', error);
    throw new Error('Failed to save supplier data');
  }
};

const getStoredSupplierPayments = (): SupplierPayment[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SUPPLIER_PAYMENTS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to read supplier payments from localStorage:', error);
  }
  return [];
};

const saveSupplierPayments = (payments: SupplierPayment[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_SUPPLIER_PAYMENTS, JSON.stringify(payments));
  } catch (error) {
    console.error('Failed to save supplier payments to localStorage:', error);
    throw new Error('Failed to save supplier payment data');
  }
};

export const getSuppliers = async (includeInactive = false): Promise<SupplierWithBalance[]> => {
  await delay(100);
  const suppliers = getStoredSuppliers();

  // Calculate balance for each supplier
  const payments = getStoredSupplierPayments();
  const purchaseOrders = getStoredPurchaseOrders();

  // Filter by status if needed
  let filtered = suppliers;
  if (!includeInactive) {
    filtered = suppliers.filter(s => s.status === 'active');
  }

  // Calculate balance: sum of received PO amounts - sum of payments
  // IMPORTANT: Balance is ALWAYS calculated from transactions, never stored
  const suppliersWithBalance = filtered.map(supplier => {
    // Get all received POs for this supplier (ONLY when status is received/partially_received)
    const receivedPOs = purchaseOrders.filter(
      po => po.supplier_id === supplier.id &&
        (po.status === 'received' || po.status === 'partially_received')
    );
    const totalDebt = receivedPOs.reduce((sum, po) => sum + po.total_amount, 0);

    // Get all payments for this supplier
    const supplierPayments = payments.filter(p => p.supplier_id === supplier.id);
    const totalPaid = supplierPayments.reduce((sum, p) => sum + p.amount, 0);

    // Balance = debt - paid (positive = we owe, negative = they owe us)
    // This is the ONLY source of truth - calculated from transactions
    const balance = totalDebt - totalPaid;

    return {
      ...supplier,
      balance, // Always calculated, never stored
    };
  });

  // Always sort alphabetically by name for consistent results
  return suppliersWithBalance.sort((a, b) => a.name.localeCompare(b.name));
};

export const getSupplierById = async (id: string): Promise<SupplierWithBalance> => {
  await delay(100);
  const suppliers = getStoredSuppliers();
  const supplier = suppliers.find(s => s.id === id);

  if (!supplier) {
    throw new Error('Supplier not found');
  }

  // Calculate balance dynamically
  const payments = getStoredSupplierPayments();
  const purchaseOrders = getStoredPurchaseOrders();

  // Get all received POs for this supplier
  const receivedPOs = purchaseOrders.filter(
    po => po.supplier_id === supplier.id &&
      (po.status === 'received' || po.status === 'partially_received')
  );
  const totalDebt = receivedPOs.reduce((sum, po) => sum + po.total_amount, 0);

  // Get all payments for this supplier
  const supplierPayments = payments.filter(p => p.supplier_id === supplier.id);
  const totalPaid = supplierPayments.reduce((sum, p) => sum + p.amount, 0);

  // Balance = debt - paid (positive = we owe, negative = they owe us)
  const balance = totalDebt - totalPaid;

  return {
    ...supplier,
    balance, // Always calculated from transactions, never stored
  };
};

export const searchSuppliers = async (searchTerm: string, includeInactive = false) => {
  await delay(100);
  const suppliers = getStoredSuppliers();
  const term = searchTerm.toLowerCase().trim();

  if (!term) {
    return includeInactive ? suppliers : suppliers.filter(s => s.status === 'active');
  }

  // Search by name, phone, or email (case-insensitive)
  const filtered = suppliers.filter(supplier => {
    const matchesSearch =
      supplier.name.toLowerCase().includes(term) ||
      (supplier.phone && supplier.phone.toLowerCase().includes(term)) ||
      (supplier.email && supplier.email.toLowerCase().includes(term));

    const matchesStatus = includeInactive || supplier.status === 'active';

    return matchesSearch && matchesStatus;
  });

  // Return up to 10 results, sorted by name
  return filtered.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 10);
};

export const createSupplier = async (supplier: Omit<Supplier, 'id' | 'created_at' | 'updated_at'>): Promise<SupplierWithBalance> => {
  await delay(100);

  // Validate required fields
  if (!supplier.name || !supplier.name.trim()) {
    throw new Error('Supplier name is required');
  }

  // Validate email format if provided
  if (supplier.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplier.email)) {
    throw new Error('Invalid email format');
  }

  // Check for duplicate email (if email is provided)
  if (supplier.email) {
    const existing = getStoredSuppliers();
    const duplicate = existing.find(s => s.email && s.email.toLowerCase() === supplier.email!.toLowerCase());
    if (duplicate) {
      throw new Error('Supplier with this email already exists');
    }
  }

  // Create new supplier
  // NOTE: balance is NOT stored - it's calculated dynamically from transactions
  const newSupplier: Supplier = {
    ...supplier,
    id: generateId(),
    created_at: new Date().toISOString(),
    updated_at: null,
  };

  // Save to storage
  const suppliers = getStoredSuppliers();
  suppliers.push(newSupplier);

  try {
    saveSuppliers(suppliers);

    // Verify the supplier was saved by reading it back immediately
    const verifySuppliers = getStoredSuppliers();
    const savedSupplier = verifySuppliers.find(s => s.id === newSupplier.id);

    if (!savedSupplier) {
      console.error('createSupplier error: Supplier was not saved correctly', {
        expectedId: newSupplier.id,
        totalSuppliers: verifySuppliers.length,
        supplierNames: verifySuppliers.map(s => s.name)
      });
      throw new Error('Failed to save supplier - verification failed');
    }

    // Balance is not stored - it's calculated dynamically from transactions
    // No need to check or set balance field

    console.log('createSupplier success: Supplier saved to localStorage', {
      id: savedSupplier.id,
      name: savedSupplier.name,
      status: savedSupplier.status,
      // Note: balance is calculated dynamically, not stored
    });

    // Return supplier with calculated balance (always 0 for new supplier)
    const supplierWithBalance: SupplierWithBalance = {
      ...savedSupplier,
      balance: 0, // New supplier has no transactions, balance is 0
    };
    return supplierWithBalance;
  } catch (error) {
    console.error('createSupplier error: Error saving supplier to localStorage', error);
    throw error instanceof Error ? error : new Error('Failed to save supplier data');
  }
};

export const updateSupplier = async (id: string, updates: Partial<Supplier>): Promise<SupplierWithBalance> => {
  await delay(100);

  const suppliers = getStoredSuppliers();
  const index = suppliers.findIndex(s => s.id === id);

  if (index === -1) {
    throw new Error('Supplier not found');
  }

  // Validate email format if being updated
  if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
    throw new Error('Invalid email format');
  }

  // Check for duplicate email (if email is being updated)
  if (updates.email) {
    const duplicate = suppliers.find(s => s.id !== id && s.email && s.email.toLowerCase() === updates.email!.toLowerCase());
    if (duplicate) {
      throw new Error('Supplier with this email already exists');
    }
  }

  // Update supplier
  const updatedSupplier: Supplier = {
    ...suppliers[index],
    ...updates,
    id, // Ensure ID doesn't change
    updated_at: new Date().toISOString(),
  };

  suppliers[index] = updatedSupplier;
  saveSuppliers(suppliers);

  // Calculate balance dynamically (balance is never stored)
  const payments = getStoredSupplierPayments();
  const purchaseOrders = getStoredPurchaseOrders();

  const receivedPOs = purchaseOrders.filter(
    po => po.supplier_id === updatedSupplier.id &&
      (po.status === 'received' || po.status === 'partially_received')
  );
  const totalDebt = receivedPOs.reduce((sum, po) => sum + po.total_amount, 0);
  const supplierPayments = payments.filter(p => p.supplier_id === updatedSupplier.id);
  const totalPaid = supplierPayments.reduce((sum, p) => sum + p.amount, 0);
  const balance = totalDebt - totalPaid;

  return {
    ...updatedSupplier,
    balance, // Always calculated from transactions
  };
};

export const deleteSupplier = async (id: string): Promise<void> => {
  await delay(100);

  const suppliers = getStoredSuppliers();
  const index = suppliers.findIndex(s => s.id === id);

  if (index === -1) {
    throw new Error('Supplier not found');
  }

  // Check if supplier has purchase orders
  // Note: Purchase orders are also stubbed, so we check if there's a storage key
  // In a real implementation, we'd check the purchase_orders table
  try {
    const storedPOs = localStorage.getItem('pos_purchase_orders');
    if (storedPOs) {
      const purchaseOrders = JSON.parse(storedPOs) as PurchaseOrder[];
      const hasPurchaseOrders = purchaseOrders.some(po => po.supplier_id === id);
      if (hasPurchaseOrders) {
        throw new Error('Cannot delete supplier with existing purchase orders');
      }
    }
  } catch (error) {
    // If error parsing, continue with deletion (graceful degradation)
    console.warn('Could not check purchase orders for supplier deletion:', error);
  }

  // Remove supplier
  suppliers.splice(index, 1);
  saveSuppliers(suppliers);
};

// ============================================================================
// CUSTOMER FUNCTIONS
// ============================================================================

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

  // Apply filters
  if (filters?.searchTerm) {
    const term = filters.searchTerm.toLowerCase();
    query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,company_name.ilike.%${term}%`);
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

  // Sort
  const sortBy = filters?.sortBy || 'created_at';
  const sortOrder = filters?.sortOrder || 'desc';
  query = query.order(sortBy, { ascending: sortOrder === 'asc' });

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching customers:', error);
    throw error;
  }

  return (data || []) as Customer[];
};

export const getCustomerById = async (id: string) => {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new Error('Customer not found');
    }
    console.error('Error fetching customer:', error);
    throw error;
  }

  return data as Customer;
};

export const getCustomerWithStats = async (id: string) => {
  // Fetch customer with aggregated stats from orders
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .single();

  if (customerError || !customer) {
    return null;
  }

  // Get order stats
  const { count: orderCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('customer_id', id);

  return {
    ...customer,
    order_count: orderCount || 0,
  };
};

export const searchCustomers = async (searchTerm: string) => {
  if (!searchTerm) {
    return getCustomers();
  }

  const term = searchTerm.toLowerCase();
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`)
    .limit(50);

  if (error) {
    console.error('Error searching customers:', error);
    throw error;
  }

  return (data || []) as Customer[];
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
  const customerData = {
    ...customer,
    balance: 0,
    total_sales: 0,
    total_orders: 0,
    last_order_date: null,
    bonus_points: 0,
    credit_limit: customer.credit_limit || 0,
    allow_debt: customer.allow_debt ?? false,
    status: (customer.status || 'active') as 'active' | 'inactive',
    type: (customer.type || 'individual') as 'individual' | 'company',
  };

  const { data, error } = await supabase
    .from('customers')
    .insert(customerData)
    .select()
    .single();

  if (error) {
    console.error('Error creating customer:', error);
    throw error;
  }

  return data as Customer;
};

export const updateCustomer = async (id: string, updates: Partial<Customer>): Promise<Customer> => {
  const { data, error } = await supabase
    .from('customers')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new Error('Customer not found');
    }
    console.error('Error updating customer:', error);
    throw error;
  }

  return data as Customer;
};

export const deleteCustomer = async (id: string) => {
  const { error } = await supabase
    .from('customers')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting customer:', error);
    throw error;
  }
};

export const getCustomerOrders = async (customerId: string) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, items:order_items(*), payments:payments(*)')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching customer orders:', error);
    throw error;
  }

  return (data || []) as OrderWithDetails[];
};

export const getCustomerOrderPayments = async (customerId: string) => {
  const { data, error } = await supabase
    .from('payments')
    .select('*, order:orders(*)')
    .eq('order.customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching customer payments:', error);
    throw error;
  }

  return (data || []) as CustomerPayment[];
};

export const getCustomerReturns = async (customerId: string) => {
  const { data, error } = await supabase
    .from('sales_returns')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching customer returns:', error);
    throw error;
  }

  return (data || []) as SalesReturn[];
};

// ============================================================================
// SHIFT FUNCTIONS (Mock)
// ============================================================================

export const getShifts = async (_limit = 50) => {
  await delay(100);
  return [] as ShiftWithCashier[];
};

export const getActiveShift = async (_cashierId: string) => {
  await delay(100);
  return null;
};

export const generateShiftNumber = async () => {
  await delay(100);
  return `SHIFT-${Date.now()}`;
};

export const createShift = async (shift: Omit<Shift, 'id' | 'closed_at' | 'closing_cash' | 'expected_cash' | 'cash_difference'>) => {
  await delay(100);
  return { ...shift, id: generateId() } as Shift;
};

export const closeShift = async (_id: string, _closingCash: number, _notes?: string) => {
  await delay(100);
  return {} as Shift;
};

// ============================================================================
// ORDER FUNCTIONS (Mock)
// ============================================================================

export const getOrders = async (limit = 100) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      items:order_items(*, product:products(*)),
      payments:payments(*),
      customer:customers(*),
      cashier:profiles!orders_cashier_id_fkey(*)
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching orders:', error);
    throw error;
  }

  return (data || []) as OrderWithDetails[];
};

export const getOrderById = async (id: string) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      items:order_items(*, product:products(*)),
      payments:payments(*),
      customer:customers(*),
      cashier:profiles!orders_cashier_id_fkey(*)
    `)
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Error fetching order:', error);
    throw error;
  }

  return data as OrderWithDetails;
};

export const getOrderByNumber = async (orderNumber: string) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      items:order_items(*, product:products(*)),
      payments:payments(*),
      customer:customers(*)
    `)
    .eq('order_number', orderNumber)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Error fetching order by number:', error);
    throw error;
  }

  return data as OrderWithDetails;
};

export const getOrdersByCustomer = async (customerId: string) => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      items:order_items(*, product:products(*)),
      payments:payments(*),
      customer:customers(*)
    `)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching customer orders:', error);
    throw error;
  }

  return (data || []) as OrderWithDetails[];
};

export const generateOrderNumber = async () => {
  // Use Supabase RPC if available
  try {
    const { data, error } = await supabase.rpc('generate_order_number');
    if (!error && data) {
      return data;
    }
  } catch (e) {
    // Fallback to client-side generation
  }
  // Fallback: client-side generation
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const timestamp = Date.now().toString().slice(-6);
  return `ORD-${today}-${timestamp}`;
};

export const completePOSOrder = async (
  order: Omit<Order, 'id' | 'created_at'>,
  items: Omit<OrderItem, 'id' | 'order_id'>[],
  payments: Omit<Payment, 'id' | 'order_id' | 'created_at'>[]
) => {
  await delay(100);

  const orderId = generateId();
  const orderNumber = await generateOrderNumber();
  const createdAt = new Date().toISOString();
  const isOnline = navigator.onLine;

  // Create full order object
  const fullOrder: Order = {
    ...order,
    id: orderId,
    order_number: orderNumber,
    created_at: createdAt,
  };

  // Create order items with order_id
  const orderItems: OrderItem[] = items.map(item => ({
    ...item,
    id: generateId(),
    order_id: orderId,
  }));

  // Create payments with order_id
  const orderPayments: Payment[] = payments.map(payment => ({
    ...payment,
    id: generateId(),
    order_id: orderId,
    created_at: createdAt,
  }));

  // If offline, save to IndexedDB and add to outbox
  if (!isOnline) {
    // Save to IndexedDB
    await saveLocalOrder(orderId, fullOrder, orderItems, orderPayments);

    // Add to outbox for sync
    const idempotencyKey = generateUUID();
    await addToOutbox({
      type: 'CREATE_ORDER',
      payload: {
        order: fullOrder,
        items: orderItems,
        payments: orderPayments,
      },
      idempotencyKey,
      entityId: orderId,
    });

    // Also save to localStorage for immediate UI update
    const orders = getStoredOrders();
    orders.push(fullOrder);
    saveOrders(orders);

    const existingItems = getStoredOrderItems();
    existingItems.push(...orderItems);
    saveOrderItems(existingItems);

    const existingPayments = getStoredPayments();
    existingPayments.push(...orderPayments);
    savePayments(existingPayments);

    // Return success (optimistic)
    return {
      order_id: orderId,
      order_number: orderNumber,
    };
  }

  // Online: save to localStorage (existing behavior)
  const orders = getStoredOrders();
  orders.push(fullOrder);
  saveOrders(orders);

  const existingItems = getStoredOrderItems();
  existingItems.push(...orderItems);
  saveOrderItems(existingItems);

  const existingPayments = getStoredPayments();
  existingPayments.push(...orderPayments);
  savePayments(existingPayments);

  // Update product stock: decrease stock for each sold item
  orderItems.forEach((item) => {
    const product = mockDB.products.find(p => p.id === item.product_id);
    if (product) {
      // Decrease stock by sold quantity (atomic-like operation in mock)
      product.current_stock = Math.max(0, product.current_stock - item.quantity);
      product.updated_at = createdAt;

      // Create inventory movement record
      const movement: InventoryMovement = {
        id: generateId(),
        product_id: item.product_id,
        movement_number: `MOV-${Date.now()}-${generateId().slice(0, 8)}`,
        movement_type: 'sale',
        quantity: -item.quantity, // Negative for sales (stock decrease)
        before_quantity: product.current_stock + item.quantity,
        after_quantity: product.current_stock,
        reference_type: 'order',
        reference_id: orderId,
        reason: `POS sale - Order ${orderNumber}`,
        notes: null,
        created_by: order.cashier_id,
        created_at: createdAt,
      };
      mockDB.inventoryMovements.push(movement);
    } else {
      console.warn(`Product ${item.product_id} not found when updating stock for order ${orderNumber}`);
    }
  });

  // Emit product update event for real-time stock updates
  productUpdateEmitter.emit();

  // Update customer balance if credit sale
  if (order.customer_id) {
    // Calculate credit amount (total - non-credit payments)
    const nonCreditPayments = orderPayments
      .filter(p => p.payment_method !== 'credit')
      .reduce((sum, p) => sum + p.amount, 0);

    const creditAmount = fullOrder.total_amount - nonCreditPayments;

    // Only update if there's credit (unpaid portion)
    if (creditAmount > 0) {
      const customers = getStoredCustomers();
      const customerIndex = customers.findIndex(c => c.id === order.customer_id);

      if (customerIndex >= 0) {
        const customer = customers[customerIndex];
        const currentBalance = customer.balance || 0;
        const currentTotalSales = customer.total_sales || 0;
        const currentTotalOrders = customer.total_orders || 0;

        customers[customerIndex] = {
          ...customer,
          balance: currentBalance + creditAmount,
          total_sales: currentTotalSales + fullOrder.total_amount,
          total_orders: currentTotalOrders + 1,
          last_order_date: createdAt,
          updated_at: createdAt,
        };
        saveCustomers(customers);
      }
    } else {
      // Full payment - still update total_sales and last_order_date
      const customers = getStoredCustomers();
      const customerIndex = customers.findIndex(c => c.id === order.customer_id);

      if (customerIndex >= 0) {
        const customer = customers[customerIndex];
        customers[customerIndex] = {
          ...customer,
          total_sales: (customer.total_sales || 0) + fullOrder.total_amount,
          total_orders: (customer.total_orders || 0) + 1,
          last_order_date: createdAt,
          updated_at: createdAt,
        };
        saveCustomers(customers);
      }
    }
  }

  return {
    id: orderId,
    order_number: orderNumber,
    message: 'Order completed successfully',
  };
};

export const createOrder = async (
  order: Omit<Order, 'id' | 'created_at'>,
  items: Omit<OrderItem, 'id' | 'order_id'>[],
  payments: Omit<Payment, 'id' | 'order_id' | 'created_at'>[]
) => {
  const startTime = Date.now();
  console.log('[createOrder] Starting order creation', { 
    orderNumber: order.order_number,
    itemsCount: items.length,
    paymentsCount: payments.length,
    timestamp: new Date().toISOString(),
  });

  // Use Supabase RPC if available (complete_pos_order)
  try {
    const { data, error } = await supabase.rpc('complete_pos_order', {
      p_order: order,
      p_items: items,
      p_payments: payments,
    });

    if (!error && data) {
      console.log('[createOrder] Order created via RPC', data);
      // Check if RPC returned an error in the response
      if (data.success === false) {
        throw new Error(data.error || 'Order creation failed');
      }
      return data;
    }

    // If RPC doesn't exist or fails, fall back to manual creation
    if (error && error.code !== '42883') { // 42883 = function does not exist
      console.error('[createOrder] RPC error:', error);
      throw error;
    }
  } catch (e) {
    // Fallback to manual creation
    console.warn('[createOrder] RPC complete_pos_order not available, using manual creation', e);
  }

  // Fallback: Manual creation using Supabase inserts
  const orderNumber = order.order_number || await generateOrderNumber();
  const { data: { user } } = await supabase.auth.getUser();
  const cashierId = user?.id || order.cashier_id;

  console.log('[createOrder] Creating order manually', { orderNumber, cashierId, orderPayload: order });

  // Build clean order payload - only include fields that exist in DB
  // Remove any fields that don't exist: discount_amount, discount_percent, notes, payment_status, total_amount, credit_amount
  const cleanOrderPayload: Record<string, unknown> = {
    store_id: order.store_id,
    location_id: order.location_id || null,
    shift_id: order.shift_id, // REQUIRED - must not be null
    order_number: orderNumber,
    customer_id: order.customer_id || null,
    cashier_id: cashierId,
    subtotal: order.subtotal,
    total: (order as { total?: number; total_amount?: number }).total || (order as { total?: number; total_amount?: number }).total_amount || 0,
    paid_amount: order.paid_amount || 0,
    change_amount: order.change_amount || 0,
    status: order.status || 'completed',
  };

  // Validate required fields
  if (!cleanOrderPayload.store_id) {
    throw new Error('store_id is required but was not provided');
  }
  if (!cleanOrderPayload.shift_id) {
    throw new Error('shift_id is required but was not provided');
  }

  console.log('[createOrder] Clean order payload:', cleanOrderPayload);

  // Insert order
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .insert(cleanOrderPayload)
    .select()
    .single();

  if (orderError) {
    console.error('[createOrder] Error creating order:', orderError);
    throw new Error(`Failed to create order: ${orderError.message}`);
  }

  if (!orderData) {
    throw new Error('Failed to create order: No data returned');
  }

  console.log('[createOrder] Order created, ID:', orderData.id);

  // Insert order items - build clean payload with only existing columns
  const cleanOrderItems = items.map(item => {
    const cleanItem: Record<string, unknown> = {
      order_id: orderData.id,
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.subtotal,
      total: item.total,
      // REMOVED: discount_amount (does not exist in actual DB schema)
    };
    return cleanItem;
  });

  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(cleanOrderItems);

  if (itemsError) {
    console.error('[createOrder] Error creating order items:', itemsError);
    // Try to rollback order (optional, but good practice)
    try {
      const { error: deleteError } = await supabase
        .from('orders')
        .delete()
        .eq('id', orderData.id);
      
      if (deleteError) {
        console.error('[createOrder] Error rolling back order:', deleteError);
      }
    } catch (rollbackError) {
      console.error('[createOrder] Rollback failed:', rollbackError);
      // Continue to throw original error
    }
    throw new Error(`Failed to create order items: ${itemsError.message}`);
  }

  console.log('[createOrder] Order items created, count:', cleanOrderItems.length);

  // Insert payments (only if there are payments)
  if (payments.length > 0) {
    const orderPayments = payments.map(payment => ({
      ...payment,
      order_id: orderData.id,
    }));

    const { error: paymentsError } = await supabase
      .from('payments')
      .insert(orderPayments);

    if (paymentsError) {
      console.error('[createOrder] Error creating payments:', paymentsError);
      // Try to rollback order and items (optional)
      // Delete in reverse order: payments -> order_items -> orders
      try {
        // Delete any payments that might have been partially inserted
        const { error: deletePaymentsError } = await supabase
          .from('payments')
          .delete()
          .eq('order_id', orderData.id);
        
        if (deletePaymentsError) {
          console.error('[createOrder] Error deleting payments during rollback:', deletePaymentsError);
        }

        // Delete order items
        const { error: deleteItemsError } = await supabase
          .from('order_items')
          .delete()
          .eq('order_id', orderData.id);
        
        if (deleteItemsError) {
          console.error('[createOrder] Error deleting order items during rollback:', deleteItemsError);
        }

        // Delete order
        const { error: deleteOrderError } = await supabase
          .from('orders')
          .delete()
          .eq('id', orderData.id);
        
        if (deleteOrderError) {
          console.error('[createOrder] Error deleting order during rollback:', deleteOrderError);
        }
      } catch (rollbackError) {
        console.error('[createOrder] Rollback failed:', rollbackError);
        // Continue to throw original error
      }
      throw new Error(`Failed to create payments: ${paymentsError.message}`);
    }

    console.log('[createOrder] Payments created, count:', orderPayments.length);
  }

  // Emit product update event
  productUpdateEmitter.emit();

  const duration = Date.now() - startTime;
  console.log('[createOrder] Order creation completed successfully', { 
    orderId: orderData.id, 
    orderNumber,
    duration: `${duration}ms`,
  });

  return {
    id: orderData.id,
    order_number: orderNumber,
    message: 'Order completed successfully',
  };
};

export const updateOrderStatus = async (id: string, status: string): Promise<Order> => {
  const { data, error } = await supabase
    .from('orders')
    .update({
      status: status as Order['status'],
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating order status:', error);
    throw error;
  }

  if (!data) {
    throw new Error('Buyurtma topilmadi');
  }

  return data as Order;
};

/**
 * Cancel an order (sets status to 'voided' or 'cancelled')
 */
export const cancelOrder = async (id: string): Promise<Order> => {
  // First check current order status
  const { data: currentOrder } = await supabase
    .from('orders')
    .select('status')
    .eq('id', id)
    .single();

  if (!currentOrder) {
    throw new Error('Buyurtma topilmadi');
  }

  // Check if order can be cancelled
  if (currentOrder.status === 'voided' || currentOrder.status === 'cancelled') {
    throw new Error('Buyurtma allaqachon bekor qilingan');
  }

  // Only allow cancelling completed orders (or pending if business rules allow)
  if (currentOrder.status !== 'completed' && currentOrder.status !== 'pending') {
    throw new Error(`'${currentOrder.status}' holatidagi buyurtmani bekor qilib bo'lmaydi`);
  }

  // Update order status
  const { data, error } = await supabase
    .from('orders')
    .update({
      status: 'voided',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error cancelling order:', error);
    throw error;
  }

  return data as Order;
};

// ============================================================================
// PAYMENT FUNCTIONS (Mock)
// ============================================================================

export const generatePaymentNumber = async () => {
  await delay(100);
  return `PAY-${Date.now()}`;
};

// ============================================================================
// PURCHASE ORDER FUNCTIONS (Mock)
// ============================================================================

const STORAGE_KEY_PURCHASE_ORDERS = 'pos_purchase_orders';
const STORAGE_KEY_PURCHASE_ORDER_ITEMS = 'pos_purchase_order_items';

// Get purchase orders from localStorage
const getStoredPurchaseOrders = (): PurchaseOrder[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PURCHASE_ORDERS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to read purchase orders from localStorage:', error);
  }
  return [];
};

// Save purchase orders to localStorage
const savePurchaseOrders = (orders: PurchaseOrder[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_PURCHASE_ORDERS, JSON.stringify(orders));
  } catch (error) {
    console.error('Failed to save purchase orders to localStorage:', error);
    throw new Error('Failed to save purchase order data');
  }
};

// Get purchase order items from localStorage
const getStoredPurchaseOrderItems = (): PurchaseOrderItem[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PURCHASE_ORDER_ITEMS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to read purchase order items from localStorage:', error);
  }
  return [];
};

// Save purchase order items to localStorage
const savePurchaseOrderItems = (items: PurchaseOrderItem[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_PURCHASE_ORDER_ITEMS, JSON.stringify(items));
  } catch (error) {
    console.error('Failed to save purchase order items to localStorage:', error);
    throw new Error('Failed to save purchase order items data');
  }
};

export const getPurchaseOrders = async (filters?: {
  status?: string;
  supplier_id?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
}) => {
  await delay(100);
  const orders = getStoredPurchaseOrders();
  const items = getStoredPurchaseOrderItems();
  const suppliers = getStoredSuppliers();

  let filtered = orders;

  // Apply filters
  if (filters?.status) {
    filtered = filtered.filter(po => po.status === filters.status);
  }
  if (filters?.supplier_id) {
    filtered = filtered.filter(po => po.supplier_id === filters.supplier_id);
  }
  if (filters?.date_from) {
    filtered = filtered.filter(po => po.order_date >= filters.date_from!);
  }
  if (filters?.date_to) {
    filtered = filtered.filter(po => po.order_date <= filters.date_to!);
  }
  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    filtered = filtered.filter(po =>
      po.po_number.toLowerCase().includes(searchLower) ||
      (po.supplier_name && po.supplier_name.toLowerCase().includes(searchLower))
    );
  }

  // Get supplier payments to calculate paid_amount
  const payments = getStoredSupplierPayments();

  // Build PurchaseOrderWithDetails with payment info
  return filtered.map(po => {
    // Calculate paid amount for this PO
    const poPayments = payments.filter(p => p.purchase_order_id === po.id);
    const paidAmount = poPayments.reduce((sum, p) => sum + p.amount, 0);
    const remainingAmount = po.total_amount - paidAmount;

    // Determine payment status
    let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
    if (paidAmount >= po.total_amount) {
      paymentStatus = 'PAID';
    } else if (paidAmount > 0) {
      paymentStatus = 'PARTIALLY_PAID';
    }

    return {
      ...po,
      items: items.filter(item => item.purchase_order_id === po.id),
      supplier: po.supplier_id ? suppliers.find(s => s.id === po.supplier_id) : undefined,
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      payment_status: paymentStatus,
    };
  }) as PurchaseOrderWithDetails[];
};

export const getPurchaseOrderById = async (id: string) => {
  await delay(100);
  const orders = getStoredPurchaseOrders();
  const items = getStoredPurchaseOrderItems();
  const suppliers = getStoredSuppliers();
  const payments = getStoredSupplierPayments();

  const order = orders.find(po => po.id === id);
  if (!order) {
    throw new Error('Purchase order not found');
  }

  // Calculate paid amount for this PO
  const poPayments = payments.filter(p => p.purchase_order_id === id);
  const paidAmount = poPayments.reduce((sum, p) => sum + p.amount, 0);
  const remainingAmount = order.total_amount - paidAmount;

  // Determine payment status
  let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
  if (paidAmount >= order.total_amount) {
    paymentStatus = 'PAID';
  } else if (paidAmount > 0) {
    paymentStatus = 'PARTIALLY_PAID';
  }

  return {
    ...order,
    items: items.filter(item => item.purchase_order_id === id),
    supplier: order.supplier_id ? suppliers.find(s => s.id === order.supplier_id) : undefined,
    paid_amount: paidAmount,
    remaining_amount: remainingAmount,
    payment_status: paymentStatus,
  } as PurchaseOrderWithDetails;
};

export const generatePONumber = async () => {
  await delay(100);
  const year = new Date().getFullYear();
  const orders = getStoredPurchaseOrders();
  const yearPrefix = `PO-${year}-`;
  const yearOrders = orders.filter(po => po.po_number.startsWith(yearPrefix));
  const nextNum = yearOrders.length + 1;
  return `${yearPrefix}${String(nextNum).padStart(5, '0')}`;
};

export const createPurchaseOrder = async (
  purchaseOrder: Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'>,
  orderItems: Omit<PurchaseOrderItem, 'id' | 'purchase_order_id'>[]
) => {
  await delay(100);

  const poId = generateId();
  const createdAt = new Date().toISOString();

  // Create full purchase order
  const fullPO: PurchaseOrder = {
    ...purchaseOrder,
    id: poId,
    created_at: createdAt,
    updated_at: createdAt, // Set to created_at initially
  };

  // Create purchase order items
  const fullItems: PurchaseOrderItem[] = orderItems.map(item => ({
    ...item,
    id: generateId(),
    purchase_order_id: poId,
    received_qty: 0, // Initialize received_qty to 0
  }));

  // Save to storage
  const orders = getStoredPurchaseOrders();
  orders.push(fullPO);
  savePurchaseOrders(orders);

  const items = getStoredPurchaseOrderItems();
  items.push(...fullItems);
  savePurchaseOrderItems(items);

  console.log('Purchase order created:', poId, 'with', fullItems.length, 'items');

  return fullPO;
};

export const updatePurchaseOrder = async (
  id: string,
  purchaseOrder: Partial<PurchaseOrder>,
  orderItems?: Omit<PurchaseOrderItem, 'id' | 'purchase_order_id'>[]
) => {
  await delay(100);

  const orders = getStoredPurchaseOrders();
  const index = orders.findIndex(po => po.id === id);

  if (index === -1) {
    throw new Error('Purchase order not found');
  }

  // Update purchase order
  const updated = {
    ...orders[index],
    ...purchaseOrder,
    id,
    updated_at: new Date().toISOString(),
  };
  orders[index] = updated;
  savePurchaseOrders(orders);

  // Update items if provided
  if (orderItems) {
    const items = getStoredPurchaseOrderItems();
    // Remove old items
    const filteredItems = items.filter(item => item.purchase_order_id !== id);
    // Add new items
    const newItems: PurchaseOrderItem[] = orderItems.map(item => ({
      ...item,
      id: generateId(),
      purchase_order_id: id,
      received_qty: 0, // Reset received_qty when updating items
    }));
    filteredItems.push(...newItems);
    savePurchaseOrderItems(filteredItems);
  }

  return updated;
};

export const approvePurchaseOrder = async (id: string, _approvedBy: string) => {
  await delay(100);

  const orders = getStoredPurchaseOrders();
  const index = orders.findIndex(po => po.id === id);

  if (index === -1) {
    throw new Error('Purchase order not found');
  }

  if (orders[index].status !== 'draft') {
    throw new Error('Only draft purchase orders can be approved');
  }

  orders[index].status = 'approved';
  orders[index].updated_at = new Date().toISOString();
  savePurchaseOrders(orders);

  return orders[index];
};

export const cancelPurchaseOrder = async (id: string) => {
  await delay(100);

  const orders = getStoredPurchaseOrders();
  const index = orders.findIndex(po => po.id === id);

  if (index === -1) {
    throw new Error('Purchase order not found');
  }

  const po = orders[index];

  // If already cancelled, return early
  if (po.status === 'cancelled') {
    return po;
  }

  // If PO was received (or partially received), we need to reverse:
  // 1. Inventory stock (decrease by received quantities)
  // 2. Supplier debt (decrease by PO total_amount)
  if (po.status === 'received' || po.status === 'partially_received') {
    // Get purchase order items to reverse inventory
    const poItems = getStoredPurchaseOrderItems();
    const itemsForPO = poItems.filter(item => item.purchase_order_id === id);

    // Reverse inventory for each item that was received
    for (const item of itemsForPO) {
      if (item.received_qty > 0) {
        const product = mockDB.products.find(p => p.id === item.product_id);
        if (product) {
          // Reverse stock: decrease by received quantity
          const beforeStock = product.current_stock;
          const afterStock = Math.max(0, beforeStock - item.received_qty); // Prevent negative stock

          product.current_stock = afterStock;
          product.updated_at = new Date().toISOString();

          // Create reversal inventory movement
          const movement: InventoryMovement = {
            id: generateId(),
            product_id: item.product_id,
            movement_number: `MOV-${Date.now()}-${generateId().slice(0, 8)}`,
            movement_type: 'adjustment',
            quantity: -item.received_qty, // Negative for reversal
            before_quantity: beforeStock,
            after_quantity: afterStock,
            reference_type: 'purchase_order',
            reference_id: id,
            reason: 'Purchase order cancelled - reversing received goods',
            notes: `Reversed ${item.received_qty} units from cancelled PO ${po.po_number}`,
            created_by: 'mock-user-id',
            created_at: new Date().toISOString(),
          };
          mockDB.inventoryMovements.push(movement);

          console.log(`Reversed inventory for product ${item.product_id}: ${beforeStock} -> ${afterStock} (-${item.received_qty})`);
        }
      }

      // Reset received quantity
      item.received_qty = 0;
    }

    // Save updated items
    const allItems = getStoredPurchaseOrderItems();
    const otherItems = allItems.filter(item => item.purchase_order_id !== id);
    otherItems.push(...itemsForPO);
    savePurchaseOrderItems(otherItems);

    // NOTE: Supplier debt is automatically reversed because:
    // - Balance = SUM(received POs) - SUM(payments)
    // - When PO status changes from 'received' to 'cancelled', it's no longer counted in received POs
    // - So debt automatically decreases by PO.total_amount
    // - We do NOT need to manually adjust balance - it's calculated from transactions
  }

  // Update PO status to cancelled
  po.status = 'cancelled';
  po.updated_at = new Date().toISOString();
  savePurchaseOrders(orders);

  console.log(`Purchase order ${id} cancelled. Inventory and debt reversed if PO was received.`);

  return po;
};

export const receiveGoods = async (
  poId: string,
  items: Array<{
    item_id: string;
    received_qty: number;
    notes?: string;
    product_id?: string; // Optional: if provided, use it directly
  }>,
  receivedDate?: string
) => {
  await delay(100);
  const createdAt = receivedDate ? new Date(receivedDate).toISOString() : new Date().toISOString();

  // Get purchase order to check status (idempotency check)
  const orders = getStoredPurchaseOrders();
  const po = orders.find(p => p.id === poId);

  if (!po) {
    throw new Error('Purchase order not found');
  }

  // IDEMPOTENCY CHECK: Prevent double receiving
  // IMPORTANT: Only check "already received" for EXISTING POs that are fully received
  // This check does NOT apply to NEW POs being created and received in one step
  // The check is based on:
  // 1. Status is 'received' (fully received)
  // 2. AND all items have received_qty >= ordered_qty (double-check)
  const poItems = getStoredPurchaseOrderItems();
  const poItemsForOrder = poItems.filter(item => item.purchase_order_id === poId);
  const allItemsFullyReceived = poItemsForOrder.length > 0 &&
    poItemsForOrder.every(item => item.received_qty >= item.ordered_qty);

  // Only block if PO is already fully received (status + all items received)
  // This prevents the error when creating NEW POs that are immediately received
  if (po.status === 'received' && allItemsFullyReceived) {
    throw new Error('Purchase order has already been fully received. Cannot receive again.');
  }

  if (po.status === 'cancelled') {
    throw new Error('Cannot receive goods for a cancelled purchase order');
  }

  // IDEMPOTENCY: Track previous status to detect if this is the first time receiving
  // This ensures we don't double-count inventory or debt
  // If PO was already received, the idempotency check above prevents processing

  // Note: poItemsForOrder was already fetched above for the idempotency check
  // Reuse it here to avoid duplicate filtering

  // Track which items were successfully processed
  const processedItems: string[] = [];
  const errors: string[] = [];

  // Process each received item
  for (const receiveItem of items) {
    // Find the purchase order item
    const poItem = poItemsForOrder.find(pi => pi.id === receiveItem.item_id);

    if (!poItem) {
      errors.push(`Purchase order item ${receiveItem.item_id} not found`);
      continue;
    }

    // Get product_id from purchase order item
    const productId = receiveItem.product_id || poItem.product_id;

    if (!productId) {
      errors.push(`Product ID not found for item ${receiveItem.item_id}`);
      continue;
    }

    // Validate received quantity doesn't exceed ordered quantity
    const newReceivedQty = poItem.received_qty + receiveItem.received_qty;
    if (newReceivedQty > poItem.ordered_qty) {
      errors.push(
        `Received quantity (${newReceivedQty}) exceeds ordered quantity (${poItem.ordered_qty}) for product ${poItem.product_name}`
      );
      continue;
    }

    // Find product and update stock
    // IMPORTANT: This updates the product's current_stock, which is what the Inventory page displays
    const product = mockDB.products.find(p => p.id === productId);
    if (!product) {
      errors.push(`Product ${productId} not found in inventory`);
      continue;
    }

    // Calculate stock values before update
    const beforeStock = product.current_stock;
    const afterStock = beforeStock + receiveItem.received_qty;

    // Update product stock (atomic operation in mock)
    // This is the critical update that increases inventory quantities
    product.current_stock = afterStock;
    product.updated_at = createdAt;

    // Update purchase order item received_qty
    poItem.received_qty = newReceivedQty;

    // Create inventory movement record
    const movement: InventoryMovement = {
      id: generateId(),
      product_id: productId,
      movement_number: `MOV-${Date.now()}-${generateId().slice(0, 8)}`,
      movement_type: 'purchase',
      quantity: receiveItem.received_qty, // Positive for purchases (stock increase)
      before_quantity: beforeStock,
      after_quantity: afterStock,
      reference_type: 'purchase_order',
      reference_id: poId,
      reason: 'Purchase order received',
      notes: receiveItem.notes || `Received ${receiveItem.received_qty} units from PO ${po.po_number}`,
      created_by: 'mock-user-id',
      created_at: createdAt,
    };
    mockDB.inventoryMovements.push(movement);

    processedItems.push(receiveItem.item_id);
    console.log(`Stock updated for product ${productId}: ${beforeStock} -> ${afterStock} (+${receiveItem.received_qty})`);
  }

  // If any errors occurred, throw (atomicity: all or nothing)
  if (errors.length > 0) {
    throw new Error(`Failed to receive goods: ${errors.join('; ')}`);
  }

  // Save updated purchase order items
  const allItems = getStoredPurchaseOrderItems();
  const otherItems = allItems.filter(item => item.purchase_order_id !== poId);
  otherItems.push(...poItemsForOrder);
  savePurchaseOrderItems(otherItems);

  // Update purchase order status based on received quantities
  const allReceived = poItemsForOrder.every(item => item.received_qty >= item.ordered_qty);
  const someReceived = poItemsForOrder.some(item => item.received_qty > 0);

  let newStatus: PurchaseOrder['status'] = po.status;
  if (allReceived) {
    newStatus = 'received';
  } else if (someReceived) {
    newStatus = 'partially_received';
  }

  // Update purchase order status
  po.status = newStatus;
  po.updated_at = createdAt;
  savePurchaseOrders(orders);

  // IMPORTANT: Supplier debt is created ONLY when PO status becomes 'received' or 'partially_received'
  // Debt = SUM of all received PO amounts
  // This happens automatically when we calculate balance from transactions
  // No manual debt creation needed - it's derived from PO status

  // IMPORTANT: Supplier debt is created when PO status becomes 'received' or 'partially_received'
  // Debt = SUM of all received PO amounts
  // Balance is calculated dynamically: balance = debt - payments
  // We do NOT store balance - it's always calculated from transactions
  // This ensures accounting accuracy and prevents inconsistencies

  // Emit product update event for real-time stock updates
  productUpdateEmitter.emit();

  console.log(`Purchase order ${poId} received. Status: ${newStatus}. Processed ${processedItems.length} items.`);

  return {
    success: true,
    message: 'Goods received successfully',
    new_status: newStatus,
    processed_items: processedItems.length,
  };
};

// ============================================================================
// DASHBOARD FUNCTIONS (Mock)
// ============================================================================

export const getDashboardStats = async () => {
  await delay(100);
  return {
    today_sales: 0,
    today_orders: 0,
    low_stock_count: 0,
    active_customers: 0,
    total_revenue: 0,
    total_profit: 0,
  };
};

// ============================================================================
// SALES RETURNS FUNCTIONS (Mock)
// ============================================================================

export const getSalesReturnById = async (id: string) => {
  await delay(100);
  const returns = getStoredSalesReturns();
  const returnItems = getStoredSalesReturnItems();
  const orders = getStoredOrders();
  const customers = getStoredCustomers();

  const salesReturn = returns.find(r => r.id === id);
  if (!salesReturn) {
    throw new Error('Sales return not found');
  }

  return {
    ...salesReturn,
    items: returnItems.filter(item => item.return_id === id),
    order: orders.find(o => o.id === salesReturn.order_id),
    customer: salesReturn.customer_id ? customers.find(c => c.id === salesReturn.customer_id) : undefined,
  } as SalesReturnWithDetails;
};

export const getSalesReturns = async (filters?: {
  status?: string;
  startDate?: string;
  endDate?: string;
  customerId?: string;
}): Promise<SalesReturnWithDetails[]> => {
  await delay(100);
  let returns = getStoredSalesReturns();
  const returnItems = getStoredSalesReturnItems();
  const orders = getStoredOrders();
  const customers = getStoredCustomers();

  // Apply filters
  if (filters) {
    if (filters.status) {
      returns = returns.filter(r => r.status === filters.status);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      returns = returns.filter(r => new Date(r.created_at) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
      returns = returns.filter(r => new Date(r.created_at) <= end);
    }
    if (filters.customerId) {
      returns = returns.filter(r => r.customer_id === filters.customerId);
    }
  }

  // Build SalesReturnWithDetails
  return returns.map(ret => ({
    ...ret,
    items: returnItems.filter(item => item.return_id === ret.id),
    order: orders.find(o => o.id === ret.order_id),
    customer: ret.customer_id ? customers.find(c => c.id === ret.customer_id) : undefined,
  })) as SalesReturnWithDetails[];
};

export const updateSalesReturn = async (
  id: string,
  updates: {
    reason?: string;
    notes?: string | null;
    status?: string;
  }
) => {
  await delay(100);
  const returns = getStoredSalesReturns();
  const index = returns.findIndex(r => r.id === id);

  if (index === -1) {
    throw new Error('Sales return not found');
  }

  const updatedReturn: SalesReturn = {
    ...returns[index],
    ...updates,
    updated_at: new Date().toISOString(),
  };

  returns[index] = updatedReturn;
  saveSalesReturns(returns);

  return updatedReturn;
};

export const deleteSalesReturn = async (id: string) => {
  await delay(100);
  const returns = getStoredSalesReturns();
  const filtered = returns.filter(r => r.id !== id);

  if (filtered.length === returns.length) {
    throw new Error('Sales return not found');
  }

  saveSalesReturns(filtered);

  // Also delete related items
  const items = getStoredSalesReturnItems();
  const filteredItems = items.filter(item => item.return_id !== id);
  saveSalesReturnItems(filteredItems);
};

export const getOrderForReturn = async (orderId: string) => {
  await delay(100);
  const orders = getStoredOrders();
  const order = orders.find(o => o.id === orderId);

  if (!order) {
    throw new Error('Order not found');
  }

  const orderItems = getStoredOrderItems();
  const payments = getStoredPayments();
  const customers = getStoredCustomers();

  return {
    ...order,
    items: orderItems.filter(item => item.order_id === order.id),
    payments: payments.filter(payment => payment.order_id === order.id),
    customer: order.customer_id ? customers.find(c => c.id === order.customer_id) : undefined,
  } as OrderWithDetails;
};

export const generateReturnNumber = async (): Promise<string> => {
  await delay(100);
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const timestamp = Date.now().toString().slice(-6);
  return `RET-${today}-${timestamp}`;
};

export const createSalesReturn = async (returnData: {
  order_id: string;
  customer_id: string | null;
  cashier_id: string;
  total_amount: number;
  refund_method: 'cash' | 'card' | 'credit';
  reason: string;
  notes: string | null;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
}) => {
  await delay(100);

  const returnId = generateId();
  const returnNumber = await generateReturnNumber();
  const createdAt = new Date().toISOString();

  // Create sales return
  // Status is 'Completed' immediately since all inventory/financial adjustments are done at creation time
  const salesReturn: SalesReturn = {
    id: returnId,
    return_number: returnNumber,
    order_id: returnData.order_id,
    customer_id: returnData.customer_id,
    cashier_id: returnData.cashier_id,
    total_amount: returnData.total_amount,
    refund_method: returnData.refund_method,
    status: 'Completed',
    reason: returnData.reason,
    notes: returnData.notes,
    created_at: createdAt,
    updated_at: createdAt,
  };

  // Create return items
  const returnItems: SalesReturnItem[] = returnData.items.map(item => ({
    id: generateId(),
    return_id: returnId,
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price: item.unit_price,
    line_total: item.line_total,
    created_at: createdAt,
  }));

  // Save to localStorage
  const returns = getStoredSalesReturns();
  returns.push(salesReturn);
  saveSalesReturns(returns);

  const existingItems = getStoredSalesReturnItems();
  existingItems.push(...returnItems);
  saveSalesReturnItems(existingItems);

  // Update product stock: increase stock for each returned item (reverse of sale)
  returnItems.forEach((item) => {
    const product = mockDB.products.find(p => p.id === item.product_id);
    if (product) {
      // Increase stock by returned quantity (atomic-like operation in mock)
      product.current_stock = product.current_stock + item.quantity;
      product.updated_at = createdAt;

      // Create inventory movement record
      const movement: InventoryMovement = {
        id: generateId(),
        product_id: item.product_id,
        movement_number: `MOV-${Date.now()}-${generateId().slice(0, 8)}`,
        movement_type: 'return',
        quantity: item.quantity, // Positive for returns (stock increase)
        before_quantity: product.current_stock - item.quantity,
        after_quantity: product.current_stock,
        reference_type: 'sales_return',
        reference_id: returnId,
        reason: `Sales return - ${returnData.reason}`,
        notes: returnData.notes,
        created_by: returnData.cashier_id,
        created_at: createdAt,
      };
      mockDB.inventoryMovements.push(movement);
    } else {
      console.warn(`Product ${item.product_id} not found when updating stock for return ${returnNumber}`);
    }
  });

  // Emit product update event for real-time stock updates
  productUpdateEmitter.emit();

  // If refund method is store credit, decrease customer's outstanding balance (qarz kamayadi)
  // Positive balance = customer owes store, so return decreases the debt
  if (returnData.refund_method === 'credit' && returnData.customer_id) {
    const customers = getStoredCustomers();
    const customerIndex = customers.findIndex(c => c.id === returnData.customer_id);

    if (customerIndex >= 0) {
      const customer = customers[customerIndex];
      const currentBalance = customer.balance || 0;
      const newBalance = currentBalance - returnData.total_amount; // Debt decreases

      customers[customerIndex] = {
        ...customer,
        balance: newBalance,
        updated_at: createdAt,
      };
      saveCustomers(customers);
    } else {
      // Customer not found - this shouldn't happen if validation is correct, but handle gracefully
      console.warn(`Customer ${returnData.customer_id} not found when processing store credit return`);
    }
  }

  return salesReturn;
};

export const updateSalesReturnStatus = async (id: string, status: string) => {
  await delay(100);
  const returns = getStoredSalesReturns();
  const index = returns.findIndex(r => r.id === id);

  if (index === -1) {
    throw new Error('Sales return not found');
  }

  returns[index] = {
    ...returns[index],
    status,
    updated_at: new Date().toISOString(),
  };

  saveSalesReturns(returns);
};

export const cancelSalesReturn = async (id: string) => {
  await delay(100);
  await updateSalesReturnStatus(id, 'Cancelled');
};

export const completeSalesReturn = async (id: string) => {
  await delay(100);
  await updateSalesReturnStatus(id, 'Completed');
};

export const getSalesReturnsByOrderId = async (orderId: string) => {
  await delay(100);
  const returns = getStoredSalesReturns();
  return returns.filter(r => r.order_id === orderId);
};

/**
 * Get a single sales return by order ID (returns the first one if multiple exist)
 * Returns null if no return exists for this order
 */
export const getSalesReturnByOrderId = async (orderId: string): Promise<SalesReturnWithDetails | null> => {
  await delay(100);
  const returns = getStoredSalesReturns();
  const returnItems = getStoredSalesReturnItems();
  const orders = getStoredOrders();
  const customers = getStoredCustomers();

  const salesReturn = returns.find(r => r.order_id === orderId);
  if (!salesReturn) {
    return null; // No return exists for this order
  }

  return {
    ...salesReturn,
    items: returnItems.filter(item => item.return_id === salesReturn.id),
    order: orders.find(o => o.id === salesReturn.order_id),
    customer: salesReturn.customer_id ? customers.find(c => c.id === salesReturn.customer_id) : undefined,
  } as SalesReturnWithDetails;
};

// ============================================================================
// EMPLOYEE FUNCTIONS (Mock)
// ============================================================================

export const getAllEmployees = async () => {
  await delay(100);
  return [] as Profile[];
};

export const getEmployeeById = async (_id: string) => {
  await delay(100);
  return null;
};

export const createEmployee = async (_employeeData: {
  username: string;
  password: string;
  full_name: string;
  phone?: string;
  email?: string;
  role: 'admin' | 'manager' | 'cashier';
  is_active?: boolean;
}) => {
  await delay(100);
  return {} as Profile;
};

export const updateEmployee = async (id: string, updates: Partial<Profile>) => {
  await delay(100);
  return { ...updates, id } as Profile;
};

export const deactivateEmployee = async (_id: string) => {
  await delay(100);
  return {} as Profile;
};

export const activateEmployee = async (_id: string) => {
  await delay(100);
  return {} as Profile;
};

export const deleteEmployee = async (_id: string) => {
  await delay(100);
};

export const getEmployeeSessions = async (_employeeId?: string) => {
  await delay(100);
  return [] as EmployeeSessionWithProfile[];
};

export const startEmployeeSession = async (_employeeId: string, _ipAddress?: string) => {
  await delay(100);
  return generateId();
};

export const endEmployeeSession = async (_sessionId: string, _ipAddress?: string) => {
  await delay(100);
  return true;
};

export const getEmployeeActivityLogs = async (_employeeId?: string) => {
  await delay(100);
  return [] as EmployeeActivityLogWithProfile[];
};

export const logEmployeeActivity = async (
  _employeeId: string,
  _actionType: string,
  _description: string,
  _documentId?: string,
  _documentType?: string,
  _ipAddress?: string
) => {
  await delay(100);
  return generateId();
};

export const getEmployeePerformance = async (
  _employeeId: string,
  _startDate?: string,
  _endDate?: string
) => {
  await delay(100);
  return null;
};

// ============================================================================
// SETTINGS FUNCTIONS (Mock)
// ============================================================================

export const getSettingsByCategory = async (_category: string) => {
  await delay(100);
  return {} as Record<string, unknown>;
};

export const getSetting = async (_category: string, _key: string) => {
  await delay(100);
  return null;
};

export const updateSetting = async (
  _category: string,
  _key: string,
  _value: unknown,
  _updatedBy: string
) => {
  await delay(100);
  return true;
};

export const bulkUpdateSettings = async (
  _category: string,
  _settings: Record<string, unknown>,
  _updatedBy: string
) => {
  await delay(100);
  return 0;
};

// ============================================================================
// HELD ORDERS FUNCTIONS (Mock)
// ============================================================================

export const generateHeldNumber = async (): Promise<string> => {
  await delay(100);

  // Find the highest number in existing held orders
  const existingNumbers = mockDB.heldOrders
    .filter(order => order.held_number.match(/^HOLD-\d+$/))
    .map(order => {
      const match = order.held_number.match(/^HOLD-(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    });

  const nextNumber = existingNumbers.length > 0
    ? Math.max(...existingNumbers) + 1
    : 1;

  return `HOLD-${String(nextNumber).padStart(3, '0')}`;
};

export const saveHeldOrder = async (heldOrderData: {
  held_number: string;
  cashier_id: string;
  shift_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  items: CartItem[];
  discount: { type: 'amount' | 'percent'; value: number } | null;
  note: string | null;
}): Promise<HeldOrder> => {
  await delay(100);

  const newHeldOrder: HeldOrder = {
    id: generateId(),
    held_number: heldOrderData.held_number,
    cashier_id: heldOrderData.cashier_id,
    shift_id: heldOrderData.shift_id,
    customer_id: heldOrderData.customer_id,
    customer_name: heldOrderData.customer_name,
    items: heldOrderData.items,
    discount: heldOrderData.discount,
    note: heldOrderData.note,
    status: 'HELD',
    created_at: new Date().toISOString(),
    updated_at: null,
  };

  mockDB.heldOrders.push(newHeldOrder);
  saveHeldOrdersToStorage(mockDB.heldOrders);

  return newHeldOrder;
};

export const getHeldOrders = async (): Promise<HeldOrder[]> => {
  await delay(100);

  // Reload from storage to ensure we have latest data
  mockDB.heldOrders = loadHeldOrdersFromStorage();

  // Return only HELD orders, sorted by created_at DESC (newest first)
  return mockDB.heldOrders
    .filter(order => order.status === 'HELD')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
};

export const getHeldOrderById = async (id: string): Promise<HeldOrder | null> => {
  await delay(100);

  // Reload from storage
  mockDB.heldOrders = loadHeldOrdersFromStorage();

  const order = mockDB.heldOrders.find(order => order.id === id);
  return order || null;
};

export const updateHeldOrderStatus = async (
  id: string,
  status: 'RESTORED' | 'CANCELLED'
): Promise<HeldOrder> => {
  await delay(100);

  // Reload from storage
  mockDB.heldOrders = loadHeldOrdersFromStorage();

  const index = mockDB.heldOrders.findIndex(order => order.id === id);
  if (index === -1) {
    throw new Error('Held order not found');
  }

  mockDB.heldOrders[index] = {
    ...mockDB.heldOrders[index],
    status,
    updated_at: new Date().toISOString(),
  };

  saveHeldOrdersToStorage(mockDB.heldOrders);

  return mockDB.heldOrders[index];
};

export const updateHeldOrderName = async (
  id: string,
  customerName: string
): Promise<HeldOrder> => {
  await delay(100);

  // Reload from storage
  mockDB.heldOrders = loadHeldOrdersFromStorage();

  const index = mockDB.heldOrders.findIndex(order => order.id === id);
  if (index === -1) {
    throw new Error('Held order not found');
  }

  mockDB.heldOrders[index] = {
    ...mockDB.heldOrders[index],
    customer_name: customerName || null,
    updated_at: new Date().toISOString(),
  };

  saveHeldOrdersToStorage(mockDB.heldOrders);

  return mockDB.heldOrders[index];
};

export const deleteHeldOrder = async (id: string): Promise<void> => {
  await delay(100);

  // Reload from storage
  mockDB.heldOrders = loadHeldOrdersFromStorage();

  const index = mockDB.heldOrders.findIndex(order => order.id === id);
  if (index === -1) {
    throw new Error('Held order not found');
  }

  // Actually delete the order (not just mark as CANCELLED)
  mockDB.heldOrders.splice(index, 1);
  saveHeldOrdersToStorage(mockDB.heldOrders);
};

// ============================================================================
// DASHBOARD ANALYTICS FUNCTIONS (Mock)
// ============================================================================

export interface DashboardAnalytics {
  total_sales: number;
  total_orders: number;
  low_stock_count: number;
  active_customers: number;
  average_order_value: number;
  items_sold: number;
  returns_count: number;
  returns_amount: number;
  pending_purchase_orders: number;
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

export const getDashboardAnalytics = async (startDate: Date, endDate: Date): Promise<DashboardAnalytics> => {
  await delay(100);

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
    low_stock_count,
    active_customers,
    average_order_value: Math.round(average_order_value),
    items_sold,
    returns_count,
    returns_amount,
    pending_purchase_orders,
  };
};

export const getDailySalesData = async (startDate: Date, endDate: Date): Promise<DailySales[]> => {
  await delay(100);

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
  await delay(100);

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
// CUSTOMER CREDIT/DEBT FUNCTIONS (Mock)
// ============================================================================

export const createCreditOrder = async (orderData: {
  customer_id: string;
  cashier_id: string;
  shift_id: string | null;
  items: Array<{
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    discount_amount: number;
    total: number;
  }>;
  subtotal: number;
  discount_amount: number;
  discount_percent: number;
  tax_amount: number;
  total_amount: number;
  notes?: string;
}): Promise<{ success: boolean; order_id?: string; order_number?: string; new_balance?: number; error?: string }> => {
  await delay(100);

  const orderId = generateId();
  const orderNumber = await generateOrderNumber();
  const createdAt = new Date().toISOString();

  // Create order
  const fullOrder: Order = {
    id: orderId,
    order_number: orderNumber,
    customer_id: orderData.customer_id,
    cashier_id: orderData.cashier_id,
    shift_id: orderData.shift_id,
    subtotal: orderData.subtotal,
    discount_amount: orderData.discount_amount,
    discount_percent: orderData.discount_percent,
    tax_amount: orderData.tax_amount,
    total_amount: orderData.total_amount,
    paid_amount: 0,
    credit_amount: orderData.total_amount,
    change_amount: 0,
    status: 'completed',
    payment_status: 'unpaid',
    notes: orderData.notes || null,
    created_at: createdAt,
  };

  // Create order items
  const orderItems: OrderItem[] = orderData.items.map(item => ({
    id: generateId(),
    order_id: orderId,
    product_id: item.product_id,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    subtotal: item.subtotal,
    discount_amount: item.discount_amount,
    total: item.total,
  }));

  // Create credit payment
  const creditPayment: Payment = {
    id: generateId(),
    order_id: orderId,
    payment_number: await generatePaymentNumber(),
    payment_method: 'credit',
    amount: orderData.total_amount,
    reference_number: null,
    notes: orderData.notes || null,
    created_at: createdAt,
  };

  // Save to localStorage
  const orders = getStoredOrders();
  orders.push(fullOrder);
  saveOrders(orders);

  const existingItems = getStoredOrderItems();
  existingItems.push(...orderItems);
  saveOrderItems(existingItems);

  const existingPayments = getStoredPayments();
  existingPayments.push(creditPayment);
  savePayments(existingPayments);

  // Update customer balance
  const customers = getStoredCustomers();
  const customerIndex = customers.findIndex(c => c.id === orderData.customer_id);

  if (customerIndex >= 0) {
    const customer = customers[customerIndex];
    const currentBalance = customer.balance || 0;
    const currentTotalSales = customer.total_sales || 0;
    const currentTotalOrders = customer.total_orders || 0;
    const newBalance = currentBalance + orderData.total_amount;

    customers[customerIndex] = {
      ...customer,
      balance: newBalance,
      total_sales: currentTotalSales + orderData.total_amount,
      total_orders: currentTotalOrders + 1,
      last_order_date: createdAt,
      updated_at: createdAt,
    };
    saveCustomers(customers);

    return {
      success: true,
      order_id: orderId,
      order_number: orderNumber,
      new_balance: newBalance,
    };
  }

  return {
    success: true,
    order_id: orderId,
    order_number: orderNumber,
    new_balance: orderData.total_amount,
  };
};

export const receiveCustomerPayment = async (_paymentData: {
  customer_id: string;
  amount: number;
  payment_method: 'cash' | 'card' | 'qr';
  reference_number?: string;
  notes?: string;
  received_by?: string;
}): Promise<{ success: boolean; payment_number?: string; old_balance?: number; new_balance?: number; error?: string }> => {
  await delay(100);
  return { success: true, payment_number: await generatePaymentNumber() };
};

export const getCustomerPayments = async (_customerId: string): Promise<CustomerPayment[]> => {
  await delay(100);
  return [];
};

export const getCustomersWithDebt = async (): Promise<Customer[]> => {
  await delay(100);
  return [];
};

export const getTotalCustomerDebt = async (): Promise<number> => {
  await delay(100);
  const customers = getStoredCustomers();
  // Sum all positive balances (debt)
  return customers.reduce((sum, customer) => sum + Math.max(0, customer.balance || 0), 0);
};

// ============================================================================
// SUPPLIER PAYMENTS & LEDGER
// ============================================================================

/**
 * Generate unique payment number
 */
const generateSupplierPaymentNumber = (): string => {
  const today = new Date();
  const datePart = today.toISOString().split('T')[0].replace(/-/g, '');
  const timestamp = Date.now().toString().slice(-6);
  return `SPAY-${datePart}-${timestamp}`;
};

/**
 * Create a supplier payment
 */
export const createSupplierPayment = async (paymentData: {
  supplier_id: string;
  purchase_order_id?: string | null;
  amount: number;
  payment_method: 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'uzum';
  paid_at?: string;
  note?: string | null;
  created_by?: string | null;
}): Promise<{ success: boolean; payment?: SupplierPayment; new_balance?: number; error?: string }> => {
  await delay(100);

  // Validate amount
  if (!paymentData.amount || paymentData.amount <= 0) {
    return {
      success: false,
      error: 'Payment amount must be greater than zero',
    };
  }

  // Validate supplier exists
  const suppliers = getStoredSuppliers();
  const supplier = suppliers.find(s => s.id === paymentData.supplier_id);
  if (!supplier) {
    return {
      success: false,
      error: 'Supplier not found',
    };
  }

  // If purchase_order_id is provided, validate PO exists and is not cancelled
  if (paymentData.purchase_order_id) {
    const orders = getStoredPurchaseOrders();
    const po = orders.find(p => p.id === paymentData.purchase_order_id);
    if (!po) {
      return {
        success: false,
        error: 'Purchase order not found',
      };
    }
    if (po.status === 'cancelled') {
      return {
        success: false,
        error: 'Cannot pay for a cancelled purchase order',
      };
    }
  }

  // Create payment record
  const payment: SupplierPayment = {
    id: generateId(),
    payment_number: generateSupplierPaymentNumber(),
    supplier_id: paymentData.supplier_id,
    purchase_order_id: paymentData.purchase_order_id || null,
    amount: paymentData.amount,
    payment_method: paymentData.payment_method,
    paid_at: paymentData.paid_at || new Date().toISOString(),
    note: paymentData.note || null,
    created_by: paymentData.created_by || null,
    created_at: new Date().toISOString(),
  };

  // Save payment
  const payments = getStoredSupplierPayments();
  payments.push(payment);
  saveSupplierPayments(payments);

  // Calculate new supplier balance from transactions
  // IMPORTANT: Balance is NEVER stored - always calculated from transactions
  const purchaseOrders = getStoredPurchaseOrders();
  const receivedPOs = purchaseOrders.filter(
    po => po.supplier_id === paymentData.supplier_id &&
      (po.status === 'received' || po.status === 'partially_received')
  );
  const totalDebt = receivedPOs.reduce((sum, po) => sum + po.total_amount, 0);
  const allPayments = payments.filter(p => p.supplier_id === paymentData.supplier_id);
  const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);
  const newBalance = totalDebt - totalPaid;

  // Do NOT store balance - it's calculated dynamically
  // Balance is the source of truth from transactions only

  console.log(`Supplier payment created: ${payment.payment_number} for supplier ${paymentData.supplier_id}, amount: ${paymentData.amount}`);

  return {
    success: true,
    payment,
    new_balance: newBalance,
  };
};

/**
 * Get supplier payments
 */
export const getSupplierPayments = async (supplierId: string): Promise<SupplierPayment[]> => {
  await delay(100);
  const payments = getStoredSupplierPayments();
  return payments
    .filter(p => p.supplier_id === supplierId)
    .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());
};

/**
 * Get supplier ledger (transaction history)
 */
export const getSupplierLedger = async (
  supplierId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<SupplierLedgerEntry[]> => {
  await delay(100);

  const purchaseOrders = getStoredPurchaseOrders();
  const payments = getStoredSupplierPayments();

  const ledger: SupplierLedgerEntry[] = [];
  let runningBalance = 0;

  // Get all received POs for this supplier
  const receivedPOs = purchaseOrders.filter(
    po => po.supplier_id === supplierId &&
      (po.status === 'received' || po.status === 'partially_received')
  );

  // Add PO entries (DEBIT - increases debt)
  for (const po of receivedPOs) {
    if (dateFrom && po.order_date < dateFrom) continue;
    if (dateTo && po.order_date > dateTo) continue;

    runningBalance += po.total_amount;
    ledger.push({
      date: po.order_date,
      type: 'PURCHASE',
      reference: po.po_number,
      debit: po.total_amount,
      credit: 0,
      balance: runningBalance,
      purchase_order_id: po.id,
    });
  }

  // Get all payments for this supplier
  const supplierPayments = payments.filter(p => p.supplier_id === supplierId);

  // Add payment entries (CREDIT - decreases debt)
  for (const payment of supplierPayments) {
    const paymentDate = payment.paid_at.split('T')[0];
    if (dateFrom && paymentDate < dateFrom) continue;
    if (dateTo && paymentDate > dateTo) continue;

    runningBalance -= payment.amount;
    ledger.push({
      date: paymentDate,
      type: 'PAYMENT',
      reference: payment.payment_number,
      debit: 0,
      credit: payment.amount,
      balance: runningBalance,
      payment_id: payment.id,
      purchase_order_id: payment.purchase_order_id,
    });
  }

  // Sort by date (oldest first)
  ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Recalculate running balance in correct order
  let recalculatedBalance = 0;
  for (const entry of ledger) {
    recalculatedBalance += entry.debit - entry.credit;
    entry.balance = recalculatedBalance;
  }

  return ledger;
};

// ============================================================================
// EXPENSES API
// ============================================================================

/**
 * Generate expense number
 */
const generateExpenseNumber = (): string => {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const year = today.substring(0, 4);
  const yearPrefix = `EXP-${year}-`;

  // Get existing expenses with same prefix from storage
  const storedExpenses = loadExpensesFromStorage();
  const existingExpenses = storedExpenses.filter(e => e.expense_number.startsWith(yearPrefix));
  const nextNum = existingExpenses.length > 0
    ? Math.max(...existingExpenses.map(e => {
      const numStr = e.expense_number.replace(yearPrefix, '');
      return parseInt(numStr, 10) || 0;
    })) + 1
    : 1;

  return `${yearPrefix}${String(nextNum).padStart(5, '0')}`;
};

/**
 * Get all expenses
 */
export const getExpenses = async (filters?: {
  dateFrom?: string;
  dateTo?: string;
  category?: ExpenseCategory;
  paymentMethod?: ExpensePaymentMethod;
  employeeId?: string;
  search?: string;
}): Promise<ExpenseWithDetails[]> => {
  await delay(100);

  // Load from storage instead of mockDB
  let expenses = [...loadExpensesFromStorage()];

  // Apply filters
  if (filters?.dateFrom) {
    expenses = expenses.filter(e => e.expense_date >= filters.dateFrom!);
  }
  if (filters?.dateTo) {
    expenses = expenses.filter(e => e.expense_date <= filters.dateTo!);
  }
  if (filters?.category) {
    expenses = expenses.filter(e => e.category === filters.category);
  }
  if (filters?.paymentMethod) {
    expenses = expenses.filter(e => e.payment_method === filters.paymentMethod);
  }
  if (filters?.employeeId) {
    expenses = expenses.filter(e => e.employee_id === filters.employeeId);
  }
  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    expenses = expenses.filter(e =>
      e.expense_number.toLowerCase().includes(searchLower) ||
      e.note?.toLowerCase().includes(searchLower) ||
      e.category.toLowerCase().includes(searchLower)
    );
  }

  // Sort by date (newest first)
  expenses.sort((a, b) => new Date(b.expense_date).getTime() - new Date(a.expense_date).getTime());

  // Enrich with profile data
  const profiles = await getProfiles();
  return expenses.map(expense => ({
    ...expense,
    employee: expense.employee_id ? profiles.find(p => p.id === expense.employee_id) : undefined,
    created_by_profile: expense.created_by ? profiles.find(p => p.id === expense.created_by) : undefined,
  }));
};

/**
 * Get expense by ID
 */
export const getExpenseById = async (id: string): Promise<ExpenseWithDetails | null> => {
  await delay(100);
  const expenses = loadExpensesFromStorage();
  const expense = expenses.find(e => e.id === id);
  if (!expense) return null;

  const profiles = await getProfiles();
  return {
    ...expense,
    employee: expense.employee_id ? profiles.find(p => p.id === expense.employee_id) : undefined,
    created_by_profile: expense.created_by ? profiles.find(p => p.id === expense.created_by) : undefined,
  };
};

/**
 * Create expense
 */
export const createExpense = async (expenseData: {
  expense_date: string;
  category: ExpenseCategory;
  amount: number;
  payment_method: ExpensePaymentMethod;
  note?: string | null;
  employee_id?: string | null;
  created_by?: string | null;
  status?: ExpenseStatus;
}): Promise<Expense> => {
  await delay(100);

  const expense: Expense = {
    id: generateId(),
    expense_number: generateExpenseNumber(),
    expense_date: expenseData.expense_date,
    category: expenseData.category,
    amount: expenseData.amount,
    payment_method: expenseData.payment_method,
    note: expenseData.note || null,
    employee_id: expenseData.employee_id || null,
    created_by: expenseData.created_by || null,
    status: expenseData.status || 'approved',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Save to storage
  const expenses = loadExpensesFromStorage();
  expenses.push(expense);
  saveExpensesToStorage(expenses);

  // Also update mockDB for consistency
  mockDB.expenses = expenses;

  return expense;
};

/**
 * Update expense
 */
export const updateExpense = async (
  id: string,
  updates: {
    expense_date?: string;
    category?: ExpenseCategory;
    amount?: number;
    payment_method?: ExpensePaymentMethod;
    note?: string | null;
    employee_id?: string | null;
    status?: ExpenseStatus;
  }
): Promise<Expense> => {
  await delay(100);

  const expenses = loadExpensesFromStorage();
  const expenseIndex = expenses.findIndex(e => e.id === id);
  if (expenseIndex === -1) {
    throw new Error('Expense not found');
  }

  const expense = expenses[expenseIndex];
  const updated: Expense = {
    ...expense,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  expenses[expenseIndex] = updated;
  saveExpensesToStorage(expenses);

  // Also update mockDB for consistency
  mockDB.expenses = expenses;

  return updated;
};

/**
 * Delete expense
 */
export const deleteExpense = async (id: string): Promise<void> => {
  await delay(100);

  const expenses = loadExpensesFromStorage();
  const expenseIndex = expenses.findIndex(e => e.id === id);
  if (expenseIndex === -1) {
    throw new Error('Expense not found');
  }

  expenses.splice(expenseIndex, 1);
  saveExpensesToStorage(expenses);

  // Also update mockDB for consistency
  mockDB.expenses = expenses;
};

/**
 * Get expense statistics
 */
export const getExpenseStats = async (filters?: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<{
  total: number;
  today: number;
  monthly: number;
  topCategory: { category: ExpenseCategory; amount: number } | null;
}> => {
  await delay(100);

  // Load ALL expenses from storage (for today/monthly calculations)
  const allExpenses = [...loadExpensesFromStorage()];

  // Apply date filters only for "total" calculation
  let filteredExpenses = [...allExpenses];
  if (filters?.dateFrom) {
    filteredExpenses = filteredExpenses.filter(e => e.expense_date >= filters.dateFrom!);
  }
  if (filters?.dateTo) {
    filteredExpenses = filteredExpenses.filter(e => e.expense_date <= filters.dateTo!);
  }

  // Total for filtered range
  const total = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Today's expenses (ALWAYS unfiltered - all expenses for today)
  const today = new Date().toISOString().split('T')[0];
  const todayExpenses = allExpenses.filter(e => e.expense_date === today);
  const todayTotal = todayExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Monthly expenses (ALWAYS unfiltered - all expenses for current month)
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  const monthlyExpenses = allExpenses.filter(e => e.expense_date >= monthStart && e.expense_date <= monthEnd);
  const monthlyTotal = monthlyExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Top category (from filtered expenses if filters applied, otherwise all)
  const categoryTotals = new Map<ExpenseCategory, number>();
  filteredExpenses.forEach(e => {
    const current = categoryTotals.get(e.category) || 0;
    categoryTotals.set(e.category, current + e.amount);
  });

  let topCategory: { category: ExpenseCategory; amount: number } | null = null;
  categoryTotals.forEach((amount, category) => {
    if (!topCategory || amount > topCategory.amount) {
      topCategory = { category, amount };
    }
  });

  return {
    total,
    today: todayTotal,
    monthly: monthlyTotal,
    topCategory,
  };
};
