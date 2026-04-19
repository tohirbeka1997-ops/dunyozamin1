// Mock API implementation - No Supabase dependency
// This file provides mock implementations for UI development only

import { addToOutbox, saveLocalOrder } from '@/offline/db';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { formatDateYMD } from '@/lib/datetime';

import type {
  Profile,
  Category,
  Promotion,
  PromotionWithDetails,
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
  CustomerLedgerEntry,
  CustomerBonusLedgerEntry,
  Expense,
  ExpenseWithDetails,
  ExpenseCategory,
  ExpensePaymentMethod,
} from '@/types/database';

// ============================================================================
// MOCK IN-MEMORY DATABASE
// ============================================================================

// Load held orders from localStorage on initialization
const loadHeldOrdersFromStorage = (): HeldOrder[] => {
  try {
    const stored = localStorage.getItem('pos_held_orders');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Error loading held orders from storage:', error);
  }
  return [];
};

// Save held orders to localStorage
const saveHeldOrdersToStorage = (orders: HeldOrder[]) => {
  try {
    localStorage.setItem('pos_held_orders', JSON.stringify(orders));
  } catch (error) {
    console.error('Error saving held orders to storage:', error);
  }
};

const mockDB = {
  products: [] as Product[],
  categories: [
    {
      id: 'cat-1',
      name: "Kategoriya yo'q",
      description: null,
      color: null,
      icon: null,
      parent_id: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'cat-2',
      name: 'Ichimliklar',
      description: null,
      color: null,
      icon: null,
      parent_id: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 'cat-3',
      name: 'Mevalar',
      description: null,
      color: null,
      icon: null,
      parent_id: null,
      created_at: new Date().toISOString(),
    },
  ] as Category[],
  customers: [] as Customer[],
  orders: [] as Order[],
  inventoryMovements: [] as InventoryMovement[],
  heldOrders: loadHeldOrdersFromStorage() as HeldOrder[],
  expenses: [] as Expense[],
};

// ============================================================================
// ELECTRON IPC HELPERS (Real SQLite via window.posApi)
// ============================================================================

const MAIN_WAREHOUSE_ID = 'main-warehouse-001';

function hasPosApi(): boolean {
  // Prefer the actual injected preload API. This avoids false negatives in some builds.
  try {
    return !!requireElectron();
  } catch {
    return false;
  }
}

async function ipc<T>(promise: Promise<any>): Promise<T> {
  return handleIpcResponse<T>(promise);
}

let cachedDeviceId: string | null = null;

async function getDeviceId(): Promise<string | null> {
  if (cachedDeviceId) return cachedDeviceId;
  if (!hasPosApi()) return null;
  try {
    const api = requireElectron();
    const config = await ipc<any>(api.appConfig.get());
    cachedDeviceId = config?.device_id || null;
    return cachedDeviceId;
  } catch (error) {
    console.warn('Failed to read device_id from appConfig:', error);
    return null;
  }
}

// In real deployments we should never silently fall back to mock/localStorage.
// If you need mock mode for UI development, set VITE_ALLOW_MOCK_API=true.
const ALLOW_MOCK_API = (import.meta as any)?.env?.VITE_ALLOW_MOCK_API === 'true';

// ============================================================================
// EXPENSES STORAGE (localStorage)
// ============================================================================

const STORAGE_KEY_EXPENSES = 'pos_expenses';

// Load expenses from localStorage on initialization
const loadExpensesFromStorage = (): Expense[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_EXPENSES);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Error loading expenses from storage:', error);
  }
  return [];
};

// Save expenses to localStorage
const saveExpensesToStorage = (expenses: Expense[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify(expenses));
  } catch (error) {
    console.error('Error saving expenses to storage:', error);
    throw new Error('Failed to save expense data');
  }
};

// Initialize expenses from storage
mockDB.expenses = loadExpensesFromStorage();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const generateId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

const generateUUID = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return generateId();
};

const generateSKUHelper = (): string => {
  // Find the smallest missing numeric SKU: 1, 2, 3, ...
  const nums = mockDB.products
    .map((p) => String(p.sku || '').trim())
    .filter((sku) => /^\d+$/.test(sku))
    .map((sku) => Number(sku))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  let expected = 1;
  for (const n of nums) {
    if (n < expected) continue;
    if (n === expected) {
      expected += 1;
      continue;
    }
    break;
  }

  if (expected > 99999) {
    throw new Error('SKU range exhausted (max 99999)');
  }

  return String(expected);
};

const normalizeProductUnits = (product: Product): Product => {
  const baseUnit = (product as any).base_unit || product.unit || 'pcs';
  const unitsRaw = (product as any).product_units;
  const productUnits =
    Array.isArray(unitsRaw) && unitsRaw.length > 0
      ? unitsRaw
      : [
          {
            unit: baseUnit,
            ratio_to_base: 1,
            sale_price: Number(product.sale_price ?? 0) || 0,
            is_default: true,
          },
        ];
  return {
    ...product,
    base_unit: baseUnit,
    product_units: productUnits,
  } as Product;
};

const delay = (ms: number = 100) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// AUTH FUNCTIONS (Mock)
// ============================================================================

export const getCurrentUser = async () => {
  await delay();
  return {
    id: 'mock-user-id',
    email: 'mock@example.com',
  } as any;
};

export const getCurrentProfile = async () => {
  await delay();
  return {
    id: 'mock-user-id',
    username: 'mockuser',
    full_name: 'Mock User',
    phone: null,
    email: 'mock@example.com',
    role: 'admin' as const,
    is_active: true,
    last_login: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as Profile;
};

export const signIn = async (_username: string, _password: string) => {
  await delay(300);
  return { user: await getCurrentUser(), session: null };
};

export const signUp = async (_username: string, _password: string, _fullName?: string) => {
  await delay(300);
  return { user: await getCurrentUser(), session: null };
};

export const signOut = async () => {
  await delay();
};

// Password reset (mock)
export const requestPasswordReset = async (identifier: string): Promise<{ token_id: string; code: string; expires_at: string }> => {
  await delay(300);
  const token_id = `mock-token-${Date.now()}`;
  const code = '123456';
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
  try {
    localStorage.setItem(`pos:pwreset:${token_id}`, JSON.stringify({ identifier, code, expires_at }));
  } catch {
    // ignore storage errors in mock mode
  }
  return { token_id, code, expires_at };
};

export const confirmPasswordReset = async (payload: { token_id: string; code: string; new_password: string }) => {
  await delay(300);
  try {
    const raw = localStorage.getItem(`pos:pwreset:${payload.token_id}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (String(parsed?.code || '') !== String(payload.code || '').trim()) {
        throw new Error('Invalid reset code');
      }
      if (parsed?.expires_at && new Date(parsed.expires_at).getTime() < Date.now()) {
        throw new Error('Reset code expired');
      }
      localStorage.removeItem(`pos:pwreset:${payload.token_id}`);
    }
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error('Failed to confirm password reset');
  }
  return { success: true };
};

// ============================================================================
// PROFILE FUNCTIONS (Mock)
// ============================================================================

export const getProfiles = async () => {
  await delay();
  return [] as Profile[];
};

export const updateProfile = async (id: string, updates: Partial<Profile>) => {
  await delay();
  return { ...updates, id } as Profile;
};

// ============================================================================
// CATEGORY FUNCTIONS
// ============================================================================

export const getCategories = async () => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Category[]>(api.categories.list({ is_active: true }));
  }
  await delay();
  return [...mockDB.categories] as Category[];
};

export const createCategory = async (category: Omit<Category, 'id' | 'created_at'>) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Category>(api.categories.create(category));
  }
  await delay();
  const newCategory: Category = {
    ...category,
    id: generateId(),
    created_at: new Date().toISOString(),
  };
  mockDB.categories.push(newCategory);
  return newCategory;
};

export const updateCategory = async (id: string, updates: Partial<Category>) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Category>(api.categories.update(id, updates));
  }
  await delay();
  const index = mockDB.categories.findIndex(c => c.id === id);
  if (index === -1) throw new Error('Category not found');
  mockDB.categories[index] = { ...mockDB.categories[index], ...updates };
  return mockDB.categories[index];
};

export const deleteCategory = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<{ success: boolean }>(api.categories.delete(id));
  }
  await delay();
  const index = mockDB.categories.findIndex(c => c.id === id);
  if (index === -1) throw new Error('Category not found');
  mockDB.categories.splice(index, 1);
};

// ============================================================================
// PROMOTIONS (Aksiya)
// ============================================================================

export const getPromotions = async (filters?: { status?: string; type?: string }) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Promotion[]>(api.promotions.list(filters || {}));
  }
  return [] as Promotion[];
};

export const getPromotionById = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<PromotionWithDetails>(api.promotions.get(id));
  }
  throw new Error('Promotions require Electron');
};

export const createPromotion = async (data: any) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Promotion>(api.promotions.create(data));
  }
  throw new Error('Promotions require Electron');
};

export const updatePromotion = async (id: string, data: any) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Promotion>(api.promotions.update(id, data));
  }
  throw new Error('Promotions require Electron');
};

export const deletePromotion = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<void>(api.promotions.delete(id));
  }
  throw new Error('Promotions require Electron');
};

export const activatePromotion = async (id: string, userId?: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Promotion>(api.promotions.activate(id, userId));
  }
  throw new Error('Promotions require Electron');
};

export const pausePromotion = async (id: string, userId?: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Promotion>(api.promotions.pause(id, userId));
  }
  throw new Error('Promotions require Electron');
};

export const applyPromotionsToCart = async (
  cartItems: CartItem[],
  customerId?: string | null,
  promoCode?: string | null
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<CartItem[]>(api.promotions.applyToCart(cartItems, customerId, promoCode));
  }
  return cartItems;
};

// ============================================================================

export const getCategoryProductCount = async (categoryId: string): Promise<number> => {
  await delay();
  return mockDB.products.filter(p => p.category_id === categoryId).length;
};

export const getCategoryById = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Category>(api.categories.get(id));
  }
  await delay();
  const category = mockDB.categories.find(c => c.id === id);
  if (!category) throw new Error('Category not found');
  return category;
};

export const getProductsByCategoryId = async (categoryId: string) => {
  await delay();
  return mockDB.products.filter(p => p.category_id === categoryId) as Product[];
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
  await delay();
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
  }
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    const f: any = {};

    if (filters?.searchTerm) f.search = filters.searchTerm;
    if (filters?.categoryId && filters.categoryId !== 'all') f.category_id = filters.categoryId;

    // Status mapping: service supports 'active' | 'inactive' (or undefined = all)
    if (filters?.status && filters.status !== 'all') {
      f.status = filters.status;
    } else if (!includeInactive) {
      f.status = 'active';
    }

    // Stock filter mapping: service uses 'low' | 'out'
    if (filters?.stockStatus && filters.stockStatus !== 'all') {
      f.stock_filter = filters.stockStatus;
    }

    // Always pass warehouse to get correct current_stock from stock_balances
    f.warehouse_id = MAIN_WAREHOUSE_ID;

    if (filters?.sortBy) f.sort_by = filters.sortBy;
    f.sort_order = (filters?.sortOrder || 'asc') === 'desc' ? 'DESC' : 'ASC';
    f.limit = Number.isFinite(Number(filters?.limit)) ? Number(filters?.limit) : 50;
    f.offset = Number.isFinite(Number(filters?.offset)) ? Number(filters?.offset) : 0;

    return ipc<ProductWithCategory[]>(api.products.list(f));
  }
  await delay();
  
  let products = [...mockDB.products];
  
  // Filter by active status
  if (!includeInactive && (!filters?.status || filters.status === 'active')) {
    products = products.filter(p => p.is_active);
  } else if (filters?.status === 'inactive') {
    products = products.filter(p => !p.is_active);
  }
  
  // Search filter
  if (filters?.searchTerm) {
    const term = filters.searchTerm.toLowerCase();
    products = products.filter(p =>
      p.name.toLowerCase().includes(term) ||
      p.sku.toLowerCase().includes(term) ||
      (p.barcode && p.barcode.toLowerCase().includes(term))
    );
  }
  
  // Category filter
  if (filters?.categoryId && filters.categoryId !== 'all') {
    products = products.filter(p => p.category_id === filters.categoryId);
  }
  
  // Stock status filter
  if (filters?.stockStatus && filters.stockStatus !== 'all') {
    if (filters.stockStatus === 'out') {
      products = products.filter(p => p.current_stock === 0);
    } else if (filters.stockStatus === 'low') {
      products = products.filter(p => p.current_stock > 0 && p.current_stock <= p.min_stock_level);
    }
  }
  
  // Sort
  const sortBy = filters?.sortBy || 'created_at';
  const sortOrder = filters?.sortOrder || 'desc';
  products.sort((a, b) => {
    let aVal: any = a[sortBy];
    let bVal: any = b[sortBy];
    
    if (sortBy === 'created_at') {
      aVal = new Date(aVal).getTime();
      bVal = new Date(bVal).getTime();
    }
    
    if (sortOrder === 'asc') {
      return aVal > bVal ? 1 : -1;
    } else {
      return aVal < bVal ? 1 : -1;
    }
  });
  
  // Pagination
  const offset = filters?.offset || 0;
  const limit = filters?.limit || 50;
  const paginated = products.slice(offset, offset + limit);
  
  // Calculate current stock from inventory movements (source of truth)
  const stockSummary = await getProductStockSummary();
  
  // Add category relation and update stock from movements
  const productsWithCategory: ProductWithCategory[] = paginated.map(p => ({
    ...normalizeProductUnits(p),
    current_stock: stockSummary[p.id] ?? p.current_stock, // Use calculated stock, fallback to stored stock
    category: mockDB.categories.find(c => c.id === p.category_id) || undefined,
  }));
  
  return productsWithCategory;
};

export const getProductById = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<ProductWithCategory>(api.products.get(id));
  }
  await delay();
  const product = mockDB.products.find(p => p.id === id);
  if (!product) return null;
  
  return {
    ...normalizeProductUnits(product),
    category: mockDB.categories.find(c => c.id === product.category_id) || null,
  } as ProductWithCategory;
};

export type ProductImage = { id: string; url: string; sort_order: number; is_primary: number };

export const getProductImages = async (productId: string): Promise<ProductImage[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<ProductImage[]>(api.products.getImages(productId));
  }
  const product = mockDB.products.find(p => p.id === productId);
  if (!product?.image_url) return [];
  return [{ id: 'legacy', url: product.image_url, sort_order: 0, is_primary: 1 }];
};

export const addProductImage = async (
  productId: string,
  url: string,
  sortOrder = 0,
  isPrimary = false
): Promise<ProductImage> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<ProductImage>(api.products.addImage(productId, url, sortOrder, isPrimary));
  }
  throw new Error('Product images require Electron');
};

export const removeProductImage = async (imageId: string, productId: string): Promise<void> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<void>(api.products.removeImage(imageId, productId));
  }
  throw new Error('Product images require Electron');
};

export const setProductImages = async (
  productId: string,
  images: Array<{ url: string; sort_order?: number; is_primary?: boolean } | string>
): Promise<ProductImage[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    const setImagesFn = api?.products?.setImages;
    if (typeof setImagesFn !== 'function') {
      console.warn('[api] products.setImages not available; skipping. Restart Electron to load latest preload.');
      return [];
    }
    return ipc<ProductImage[]>(setImagesFn.call(api.products, productId, images));
  }
  throw new Error('Product images require Electron');
};

export const getProductByBarcode = async (barcode: string) => {
  const clean = String(barcode || '').trim();
  if (!clean) return null;
  if (hasPosApi()) {
    const api = requireElectron();
    try {
      const result = await ipc<ProductWithCategory>(api.products.getByBarcode(clean));
      if (!result || typeof result !== 'object' || !('id' in result)) return null;
      return result;
    } catch (error: any) {
      // Electron backend throws NOT_FOUND for missing barcode; UI expects null for "not found".
      if (error?.code === 'NOT_FOUND') return null;
      throw error;
    }
  }
  await delay();
  const product = mockDB.products.find(p => p.barcode === clean && p.is_active);
  if (!product) return null;
  
  return {
    ...normalizeProductUnits(product),
    category: mockDB.categories.find(c => c.id === product.category_id) || null,
  } as ProductWithCategory;
};

export const getProductBySku = async (sku: string) => {
  const clean = String(sku || '').trim();
  if (!clean) return null;
  if (hasPosApi()) {
    const api = requireElectron();
    try {
      const result = await ipc<ProductWithCategory>(api.products.getBySku(clean));
      // Sanity: ensure we got a real product, not a stale error-shaped object
      if (!result || typeof result !== 'object' || !('id' in result)) return null;
      return result;
    } catch (error: any) {
      // Electron backend throws NOT_FOUND for missing sku; UI expects null for "not found".
      if (error?.code === 'NOT_FOUND') return null;
      throw error;
    }
  }
  await delay();
  const product = mockDB.products.find(p => String(p.sku).trim() === clean && p.is_active);
  if (!product) return null;
  return {
    ...normalizeProductUnits(product),
    category: mockDB.categories.find(c => c.id === product.category_id) || null,
  } as ProductWithCategory;
};

export const searchProducts = async (searchTerm: string) => {
  const term = String(searchTerm || '').trim().toLowerCase();
  const prioritize = (items: ProductWithCategory[]) => {
    const getRank = (p: ProductWithCategory) => {
      const name = String(p.name || '').toLowerCase();
      const skuRaw = String(p.sku || '').toLowerCase();
      const sku = skuRaw.replace(/^0+/, '');
      const barcode = String(p.barcode || '').toLowerCase();
      const termSku = term.replace(/^0+/, '');
      const skuExact = skuRaw === term || (termSku && sku === termSku);
      const skuStarts = skuRaw.startsWith(term) || (termSku && sku.startsWith(termSku));
      const skuContains = skuRaw.includes(term) || (termSku && sku.includes(termSku));
      if (term && (skuExact || barcode === term)) return 0;
      if (term && name === term) return 1;
      if (term && (skuStarts || barcode.startsWith(term))) return 2;
      if (term && name.startsWith(term)) return 3;
      if (term && (skuContains || barcode.includes(term))) return 4;
      if (term && name.includes(term)) return 5;
      return 6;
    };
    return items
      .map((p, idx) => ({ p, idx, rank: getRank(p) }))
      .sort((a, b) => (a.rank - b.rank) || (a.idx - b.idx))
      .map((x) => x.p);
  };

  // In Electron (real POS), search must come from the SQLite-backed service.
  // The previous implementation only searched `mockDB`, which made POS show
  // "no products" even when the real DB had products.
  if (hasPosApi()) {
    const api = requireElectron();
    const results = await ipc<ProductWithCategory[]>(
      api.products.list({
        search: term.length > 0 ? term : undefined,
        status: 'active',
        warehouse_id: MAIN_WAREHOUSE_ID,
        // Keep POS search snappy and consistent with the UI expectations.
        limit: 20,
        offset: 0,
        sort_by: 'name',
        sort_order: 'ASC',
      })
    );
    return term ? prioritize(results) : results;
  }

  await delay();
  const products = mockDB.products
    .filter(p =>
      p.is_active &&
      (p.name.toLowerCase().includes(term) ||
       p.sku.toLowerCase().includes(term) ||
       (p.barcode && p.barcode.toLowerCase().includes(term)))
    )
    .slice(0, 20);

  const mapped = products.map(p => ({
    ...normalizeProductUnits(p),
    category: mockDB.categories.find(c => c.id === p.category_id) || null,
  })) as ProductWithCategory[];
  return term ? prioritize(mapped) : mapped;
};

export const searchProductsScreen = async (
  searchTerm: string,
  opts?: { limit?: number }
) => {
  const term = String(searchTerm || '').trim().toLowerCase();
  const limit =
    opts?.limit !== undefined
      ? Math.min(200, Math.max(1, Math.floor(Number(opts.limit))))
      : 20;
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<ProductWithCategory[]>(
      api.products.searchScreen({
        search: term.length > 0 ? term : undefined,
        status: 'active',
        warehouse_id: MAIN_WAREHOUSE_ID,
        limit,
        offset: 0,
      })
    );
  }
  const fallback = await searchProducts(term);
  return fallback.slice(0, limit);
};

export const generateSKU = async () => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<string>(api.products.getNextSku());
  }
  await delay();
  return generateSKUHelper();
};

export const generateBarcode = async () => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<string>(api.products.getNextBarcode());
  }
  await delay();
  // Simple fallback in mock mode: 13-digit numeric based on timestamp
  const raw = String(Date.now());
  return raw.padStart(13, '0').slice(0, 13);
};

export const generateBarcodeForUnit = async (unit: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<string>(api.products.getNextBarcodeForUnit(unit));
  }
  // Mock mode: keep prefixes consistent with backend behavior
  await delay();
  const u = String(unit ?? '').trim().toLowerCase();
  const prefix3 = u === 'kg' ? '310' : '300';
  const nine = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
  // 12 digits base (prefix3 + nine) + checksum is not computed in mock; OK for dev UI.
  return `${prefix3}${nine}0`;
};

export type ScaleExportResult = {
  content: string;
  stats: {
    total: number;
    exported: number;
    skippedNotWeight: number;
    skippedNoPlu: number;
    skippedInvalid: number;
  };
};

export const exportScaleSharqTxt = async (opts?: { department?: number; prefix?: number; group?: number; brand?: string }): Promise<ScaleExportResult> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<ScaleExportResult>(api.products.exportScaleSharqTxt(opts || {}));
  }
  await delay();
  return {
    content: '',
    stats: { total: 0, exported: 0, skippedNotWeight: 0, skippedNoPlu: 0, skippedInvalid: 0 },
  };
};

export const exportScaleCsv3 = async (): Promise<ScaleExportResult> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<ScaleExportResult>(api.products.exportScaleCsv3({}));
  }
  await delay();
  return {
    content: '',
    stats: { total: 0, exported: 0, skippedNotWeight: 0, skippedNoPlu: 0, skippedInvalid: 0 },
  };
};

export const exportScaleLegacyTxt = async (opts?: { department?: number; prefix?: number }): Promise<ScaleExportResult> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<ScaleExportResult>(api.products.exportScaleLegacyTxt(opts || {}));
  }
  await delay();
  return {
    content: '',
    stats: { total: 0, exported: 0, skippedNotWeight: 0, skippedNoPlu: 0, skippedInvalid: 0 },
  };
};

export const createProduct = async (
  product: Omit<Product, 'id' | 'created_at' | 'updated_at' | 'current_stock'>,
  initialStock?: number
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    const created = await ipc<Product>(api.products.create(product));

    // If caller requested initial stock, apply via inventory adjustment (transactional)
    const qty = Number(initialStock || 0);
    if (Number.isFinite(qty) && qty > 0) {
      await ipc<any>(
        api.inventory.adjustStock({
          warehouse_id: MAIN_WAREHOUSE_ID,
          adjustment_type: 'set',
          reason: 'Initial stock',
          notes: 'Initial stock on product creation',
          items: [{ product_id: created.id, target_quantity: qty }],
        })
      );
    }

    // Re-fetch with normalized fields (category/unit/current_stock)
    return ipc<Product>(api.products.get(created.id));
  }
  await delay();
  
  const unit = product.unit || 'pcs';
  const baseUnit = (product as any).base_unit || unit;
  const productUnits =
    Array.isArray((product as any).product_units) && (product as any).product_units.length > 0
      ? (product as any).product_units
      : [
          {
            unit: baseUnit,
            ratio_to_base: 1,
            sale_price: Number(product.sale_price ?? 0) || 0,
            is_default: true,
          },
        ];
  
  const newProduct: Product = {
    ...product,
    id: generateId(),
    sku: product.sku || generateSKUHelper(),
    unit: unit,
    base_unit: baseUnit,
    product_units: productUnits,
    current_stock: initialStock || 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  
  mockDB.products.push(newProduct);
  
  // Create inventory movement if initial stock > 0
  if (initialStock && initialStock > 0) {
    mockDB.inventoryMovements.push({
      id: generateId(),
      product_id: newProduct.id,
      movement_number: `MOV-${Date.now()}`,
      movement_type: 'adjustment',
      quantity: initialStock,
      before_quantity: 0,
      after_quantity: initialStock,
      reference_type: 'product_creation',
      reference_id: newProduct.id,
      reason: 'Initial stock on product creation',
      notes: `Initial stock: ${initialStock} ${unit}`,
      created_by: 'mock-user-id',
      created_at: new Date().toISOString(),
    } as InventoryMovement);
  }
  
  return newProduct;
};

export const updateProduct = async (id: string, updates: Partial<Product>) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Product>(api.products.update(id, updates));
  }
  await delay();
  const index = mockDB.products.findIndex(p => p.id === id);
  if (index === -1) throw new Error('Product not found');
  
  // Ensure unit defaults to 'pcs' if not provided or empty
  const existing = mockDB.products[index];
  const safeUpdates = {
    ...updates,
    unit: updates.unit || existing.unit || 'pcs',
    base_unit: (updates as any).base_unit || (existing as any).base_unit || updates.unit || existing.unit || 'pcs',
    product_units:
      (updates as any).product_units ||
      (existing as any).product_units ||
      [
        {
          unit: (updates as any).base_unit || (existing as any).base_unit || updates.unit || existing.unit || 'pcs',
          ratio_to_base: 1,
          sale_price: Number((updates as any).sale_price ?? existing.sale_price ?? 0) || 0,
          is_default: true,
        },
      ],
  };
  
  mockDB.products[index] = {
    ...mockDB.products[index],
    ...safeUpdates,
    updated_at: new Date().toISOString(),
  };
  
  return mockDB.products[index];
};

/** Bir nechta mahsulotni bitta kategoriyaga biriktirish (`null` = kategoriyasiz). */
export const assignProductsToCategory = async (
  productIds: string[],
  categoryId: string | null
) => {
  const unique = [...new Set(productIds.map(String).filter(Boolean))];
  for (const id of unique) {
    await updateProduct(id, { category_id: categoryId });
  }
  productUpdateEmitter.emit();
  return { updated: unique.length };
};

export const deleteProduct = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    const res = await ipc<{ success: boolean; softDeleted?: boolean }>(api.products.delete(id));
    productUpdateEmitter.emit();
    return res;
  }
  await delay();
  const index = mockDB.products.findIndex(p => p.id === id);
  if (index === -1) throw new Error('Product not found');
  
  // Hard delete in mock mode (for wrong entries)
  mockDB.products.splice(index, 1);
  productUpdateEmitter.emit();
  return { success: true, softDeleted: false };
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
  await delay();
  return getProducts(false, filters as any);
};

export const getWarehouses = async (filters?: { is_active?: boolean }) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.warehouses.list(filters || {}));
  }
  await delay();
  return [] as any[];
};

// Inventory report helper (used by reports) - return all active products with category + stock fields.
export const getInventoryAll = async (): Promise<ProductWithCategory[]> => {
  await delay();
  // Use a large limit for report views.
  return getProducts(false, { limit: 100000, offset: 0, sortBy: 'name', sortOrder: 'asc', stockStatus: 'all' } as any);
};

export const getLowStockProducts = async () => {
  await delay();
  const products = mockDB.products.filter(
    p => p.is_active && p.current_stock <= p.min_stock_level
  );
  
  return products.map(p => ({
    ...p,
    category: mockDB.categories.find(c => c.id === p.category_id) || null,
  })) as ProductWithCategory[];
};

export const getInventoryMovements = async (productId: string) => {
  await delay();
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
  // Real POS (Electron + SQLite): call pos:inventory:getMoves
  if (hasPosApi()) {
    const api = requireElectron();
    const backendFilters: any = {};
    if (filters?.productId) {
      backendFilters.product_id = filters.productId;
    }
    if (filters?.movementType && filters.movementType !== 'all') {
      backendFilters.move_type = filters.movementType;
    }
    if (filters?.startDate) {
      backendFilters.date_from = filters.startDate;
    }
    if (filters?.endDate) {
      backendFilters.date_to = filters.endDate + ' 23:59:59'; // End of day
    }
    // Return raw stock_moves (backend joins product, user, warehouse already)
    return ipc<any>(api.inventory.getMoves(backendFilters));
  }

  await delay();
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

// Pricing (tiers + per-unit prices)
export const getPriceTiers = async () => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.pricing.getTiers());
  }
  await delay();
  return [];
};

export const getProductTierPrice = async (payload: {
  product_id: string;
  tier_code?: string;
  tier_id?: number;
  currency?: string;
  unit: string;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<number | null>(api.pricing.getPrice(payload));
  }
  await delay();
  return null;
};

export const setProductTierPrice = async (payload: {
  product_id: string;
  tier_id: number;
  currency?: string;
  unit: string;
  price: number;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.pricing.setPrice(payload));
  }
  await delay();
  return { success: true };
};

export const createStockAdjustment = async (adjustment: {
  product_id: string;
  quantity: number;
  reason: string;
  notes?: string;
}) => {
  // Real POS (Electron + SQLite): use transactional inventory adjustment
  if (hasPosApi()) {
    const api = requireElectron();
    const qty = Number(adjustment.quantity || 0);
    if (!Number.isFinite(qty) || qty === 0) {
      throw new Error('Quantity must be a non-zero number');
    }
    if (!adjustment.product_id) {
      throw new Error('Product ID is required');
    }
    if (!adjustment.reason || !String(adjustment.reason).trim()) {
      throw new Error('Reason is required');
    }

    // InventoryService.adjustStock expects: { warehouse_id, reason, notes, items[] }
    // We pass signed delta as item.quantity with adjustment_type='adjustment'.
    return ipc<any>(
      api.inventory.adjustStock({
        warehouse_id: MAIN_WAREHOUSE_ID,
        adjustment_type: 'adjustment',
        reason: String(adjustment.reason).trim(),
        notes: adjustment.notes || null,
        items: [
          {
            product_id: adjustment.product_id,
            quantity: qty,
            notes: adjustment.notes || null,
          },
        ],
      })
    );
  }

  await delay();
  
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
  await delay();
  return [] as any[];
};

export const getProductSalesHistory = async (_productId: string) => {
  await delay();
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
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierWithBalance[]>(api.suppliers.list({ includeInactive }));
  }
  await delay();
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
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierWithBalance>(api.suppliers.get(id));
  }
  await delay();
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
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierWithBalance[]>(api.suppliers.list({ search: searchTerm, includeInactive, limit: 10 }));
  }
  await delay();
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
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierWithBalance>(api.suppliers.create(supplier));
  }
  await delay();
  
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
    settlement_currency: (supplier as any).settlement_currency || 'USD',
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
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierWithBalance>(api.suppliers.update(id, updates));
  }
  await delay();
  
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

export const deleteSupplier = async (
  id: string
): Promise<{ success: boolean; softDeleted?: boolean; message?: string }> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<{ success: boolean; softDeleted?: boolean; message?: string }>(api.suppliers.delete(id));
  }
  await delay();
  
  const suppliers = getStoredSuppliers();
  const index = suppliers.findIndex(s => s.id === id);
  
  if (index === -1) {
    throw new Error('Supplier not found');
  }
  
  // Mock behavior aligns with real DB:
  // - if supplier has purchase orders, soft-delete (inactive) to preserve history
  try {
    const storedPOs = localStorage.getItem('pos_purchase_orders');
    if (storedPOs) {
      const purchaseOrders = JSON.parse(storedPOs) as PurchaseOrder[];
      const hasPurchaseOrders = purchaseOrders.some(po => po.supplier_id === id);
      if (hasPurchaseOrders) {
        suppliers[index] = {
          ...suppliers[index],
          status: 'inactive',
          updated_at: new Date().toISOString(),
        };
        saveSuppliers(suppliers);
        return { success: true, softDeleted: true };
      }
    }
  } catch (error) {
    console.warn('Could not check purchase orders for supplier deletion:', error);
    // Fall through to hard delete (best-effort)
  }
  
  // Remove supplier
  suppliers.splice(index, 1);
  saveSuppliers(suppliers);
  return { success: true, softDeleted: false };
};

// ============================================================================
// CUSTOMER FUNCTIONS (Mock)
// ============================================================================

const STORAGE_KEY_CUSTOMERS = 'pos_customers';
const STORAGE_KEY_ORDERS = 'pos_orders';
const STORAGE_KEY_ORDER_ITEMS = 'pos_order_items';
const STORAGE_KEY_PAYMENTS = 'pos_payments';
const STORAGE_KEY_SALES_RETURNS = 'pos_sales_returns';
const STORAGE_KEY_SALES_RETURN_ITEMS = 'pos_sales_return_items';

const getStoredCustomers = (): Customer[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_CUSTOMERS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to read customers from localStorage:', error);
  }
  return [];
};

const saveCustomers = (customers: Customer[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify(customers));
  } catch (error) {
    console.error('Failed to save customers to localStorage:', error);
    throw new Error('Failed to save customer data');
  }
};

const getStoredOrders = (): Order[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_ORDERS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to read orders from localStorage:', error);
  }
  return [];
};

const saveOrders = (orders: Order[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(orders));
  } catch (error) {
    console.error('Failed to save orders to localStorage:', error);
    throw new Error('Failed to save order data');
  }
};

const getStoredOrderItems = (): OrderItem[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_ORDER_ITEMS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to read order items from localStorage:', error);
  }
  return [];
};

const saveOrderItems = (items: OrderItem[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_ORDER_ITEMS, JSON.stringify(items));
  } catch (error) {
    console.error('Failed to save order items to localStorage:', error);
    throw new Error('Failed to save order items data');
  }
};

const getStoredPayments = (): Payment[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PAYMENTS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to read payments from localStorage:', error);
  }
  return [];
};

const savePayments = (payments: Payment[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_PAYMENTS, JSON.stringify(payments));
  } catch (error) {
    console.error('Failed to save payments to localStorage:', error);
    throw new Error('Failed to save payments data');
  }
};

const getStoredSalesReturns = (): SalesReturn[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SALES_RETURNS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to read sales returns from localStorage:', error);
  }
  return [];
};

const saveSalesReturns = (returns: SalesReturn[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_SALES_RETURNS, JSON.stringify(returns));
  } catch (error) {
    console.error('Failed to save sales returns to localStorage:', error);
    throw new Error('Failed to save sales returns data');
  }
};

const getStoredSalesReturnItems = (): SalesReturnItem[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SALES_RETURN_ITEMS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn('Failed to read sales return items from localStorage:', error);
  }
  return [];
};

const saveSalesReturnItems = (items: SalesReturnItem[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_SALES_RETURN_ITEMS, JSON.stringify(items));
  } catch (error) {
    console.error('Failed to save sales return items to localStorage:', error);
    throw new Error('Failed to save sales return items data');
  }
};

export const getCustomers = async (filters?: {
  searchTerm?: string;
  type?: string;
  status?: string;
  hasDebt?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    const f: any = {};
    if (filters?.searchTerm) f.search = filters.searchTerm;
    if (filters?.status) f.status = filters.status;
    if (filters?.type) f.type = filters.type;
    // Backend list doesn't support hasDebt/sort; keep those as client-side concerns.
    return ipc<Customer[]>(api.customers.list(f));
  }
  await delay();
  
  let customers = getStoredCustomers();
  
  // Apply filters
  if (filters) {
    if (filters.searchTerm) {
      const search = filters.searchTerm.toLowerCase();
      customers = customers.filter(c => 
        c.name.toLowerCase().includes(search) ||
        (c.phone && c.phone.toLowerCase().includes(search)) ||
        (c.email && c.email.toLowerCase().includes(search)) ||
        (c.company_name && c.company_name.toLowerCase().includes(search))
      );
    }
    
    if (filters.type && filters.type !== 'all') {
      customers = customers.filter(c => c.type === filters.type);
    }
    
    if (filters.status && filters.status !== 'all') {
      customers = customers.filter(c => c.status === filters.status);
    }
    
    if (filters.hasDebt !== undefined) {
      if (filters.hasDebt) {
        customers = customers.filter(c => (c.balance || 0) > 0);
      } else {
        customers = customers.filter(c => (c.balance || 0) <= 0);
      }
    }
    
    // Apply sorting
    const sortBy = filters.sortBy || 'created_at';
    const sortOrder = filters.sortOrder || 'desc';
    customers.sort((a, b) => {
      let aVal: any = a[sortBy as keyof Customer];
      let bVal: any = b[sortBy as keyof Customer];
      
      // Handle null/undefined values
      if (aVal == null) aVal = '';
      if (bVal == null) bVal = '';
      
      // Handle numeric comparison
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      // String comparison
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      
      if (sortOrder === 'asc') {
        return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
      } else {
        return aStr > bStr ? -1 : aStr < bStr ? 1 : 0;
      }
    });
  }
  
  return customers;
};

export const getCustomerById = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Customer>(api.customers.get(id));
  }
  await delay();
  const customers = getStoredCustomers();
  const customer = customers.find(c => c.id === id);
  if (!customer) {
    throw new Error('Customer not found');
  }
  return customer;
};

export const getCustomerWithStats = async (_id: string) => {
  await delay();
  return null;
};

export const searchCustomers = async (searchTerm: string) => {
  await delay();
  const customers = getStoredCustomers();
  if (!searchTerm) return customers;
  
  const search = searchTerm.toLowerCase();
  return customers.filter(c => 
    c.name.toLowerCase().includes(search) ||
    (c.phone && c.phone.toLowerCase().includes(search)) ||
    (c.email && c.email.toLowerCase().includes(search))
  );
};

export const createCustomer = async (customer: {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  type?: 'individual' | 'company';
  pricing_tier?: 'retail' | 'master';
  company_name?: string | null;
  tax_number?: string | null;
  credit_limit?: number;
  allow_debt?: boolean;
  notes?: string | null;
  status?: 'active' | 'inactive';
  bonus_points?: number;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Customer>(api.customers.create(customer));
  }
  await delay();
  
  // Read existing customers
  const customers = getStoredCustomers();
  
  // Create new customer object
  const newCustomer: Customer = {
    ...customer,
    id: generateId(),
    balance: 0,
    total_sales: 0,
    total_orders: 0,
    last_order_date: null,
    bonus_points: customer.bonus_points ?? 0,
    credit_limit: customer.credit_limit || 0,
    allow_debt: customer.allow_debt ?? false,
    status: customer.status || 'active',
    type: customer.type || 'individual',
    pricing_tier: customer.pricing_tier || 'retail',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  
  // Append to array and save
  customers.push(newCustomer);
  saveCustomers(customers);
  
  return newCustomer;
};

export const updateCustomer = async (id: string, updates: Partial<Customer>): Promise<Customer> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Customer>(api.customers.update(id, updates));
  }
  await delay();
  
  const customers = getStoredCustomers();
  const index = customers.findIndex(c => c.id === id);
  
  if (index === -1) {
    throw new Error('Customer not found');
  }
  
  // Update customer
  const updatedCustomer: Customer = {
    ...customers[index],
    ...updates,
    id,
    updated_at: new Date().toISOString(),
  };
  
  customers[index] = updatedCustomer;
  saveCustomers(customers);
  
  return updatedCustomer;
};

export const deleteCustomer = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<{ success: boolean }>(api.customers.delete(id));
  }
  await delay();
  
  const customers = getStoredCustomers();
  const filtered = customers.filter(c => c.id !== id);
  
  if (filtered.length === customers.length) {
    throw new Error('Customer not found');
  }
  
  saveCustomers(filtered);
};

export const getCustomerOrders = async (_customerId: string) => {
  await delay();
  return [] as any[];
};

export const getCustomerOrderPayments = async (_customerId: string) => {
  await delay();
  return [] as any[];
};

export const getCustomerReturns = async (_customerId: string) => {
  await delay();
  return [] as any[];
};

// ============================================================================
// SHIFT FUNCTIONS (Mock)
// ============================================================================

export const getShifts = async (_limit = 50) => {
  if (hasPosApi()) {
    const api = requireElectron();
    if (api?.shifts?.list) {
      return ipc<ShiftWithCashier[]>(api.shifts.list({ limit: _limit }));
    }
    console.warn('[API] shifts.list handler is missing');
    return [] as ShiftWithCashier[];
  }
  await delay();
  return [] as ShiftWithCashier[];
};

export const getActiveShift = async (cashierId?: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    if (cashierId) {
      return ipc<Shift | null>(api.shifts.getActive(cashierId));
    }
    // If no cashierId provided, return null (don't call backend with invalid params)
    console.warn('[API] getActiveShift called without cashierId, returning null');
    return null;
  }
  await delay();
  return null;
};

// Back-compat alias used by some UI code.
export const getCurrentShift = async (cashierId: string) => {
  return getActiveShift(cashierId);
};

export const generateShiftNumber = async () => {
  await delay();
  return `SHIFT-${Date.now()}`;
};

export const createShift = async (shift: Omit<Shift, 'id' | 'closed_at' | 'closing_cash' | 'expected_cash' | 'cash_difference'>) => {
  await delay();
  return { ...shift, id: generateId() } as Shift;
};

export const closeShift = async (shiftId: string, closingCash: number, notes?: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Shift>(api.shifts.close(shiftId, { closing_cash: closingCash, notes }));
  }
  await delay();
  return {} as Shift;
};

export const getShiftSummary = async (shiftId: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.shifts.getSummary({ shiftId }));
  }
  await delay();
  return {
    shiftId,
    openedAt: null,
    closedAt: null,
    status: 'open',
    openingCash: 0,
    totalSales: 0,
    cashSales: 0,
    orders: 0,
    totalRefunds: 0,
    expectedCash: 0,
  };
};

// ============================================================================
// ORDER FUNCTIONS (Mock)
// ============================================================================

export const getOrders = async (limit = 100) => {
  // Use Electron IPC if available
  if (hasPosApi()) {
    const api = requireElectron();
    // Ask backend for orders WITH details (items/payments) for Orders page
    return ipc<OrderWithDetails[]>(api.orders.list({ limit, with_details: true }));
  }
  await delay();
  const orders = getStoredOrders();
  const orderItems = getStoredOrderItems();
  const payments = getStoredPayments();
  const customers = getStoredCustomers();
  
  // Sort by created_at descending and limit
  const sortedOrders = orders
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);
  
  // Build OrderWithDetails
  return sortedOrders.map(order => ({
    ...order,
    items: orderItems.filter(item => item.order_id === order.id),
    payments: payments.filter(payment => payment.order_id === order.id),
    customer: order.customer_id ? customers.find(c => c.id === order.customer_id) : undefined,
  })) as OrderWithDetails[];
};

export const getOrdersPage = async (opts?: {
  limit?: number;
  offset?: number;
  with_details?: boolean;
  // filters
  date_from?: string;
  date_to?: string;
  customer_id?: string | null;
  cashier_id?: string | null;
  status?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  search?: string | null;
  sort_by?: 'created_at' | 'total_amount' | 'order_number' | null;
  sort_order?: 'ASC' | 'DESC' | null;
}) => {
  const limit = Number.isFinite(Number(opts?.limit)) ? Number(opts?.limit) : 50;
  const offset = Number.isFinite(Number(opts?.offset)) ? Number(opts?.offset) : 0;
  const withDetails = opts?.with_details === true;

  if (hasPosApi()) {
    const api = requireElectron();
    const payload: any = {
      limit,
      offset,
      with_details: withDetails,
    };
    if (opts?.date_from) payload.date_from = opts.date_from;
    if (opts?.date_to) payload.date_to = opts.date_to;
    if (opts?.customer_id) payload.customer_id = opts.customer_id;
    if (opts?.cashier_id) payload.cashier_id = opts.cashier_id;
    if (opts?.status) payload.status = opts.status;
    if (opts?.payment_status) payload.payment_status = opts.payment_status;
    if (opts?.payment_method) payload.payment_method = opts.payment_method;
    if (opts?.search) payload.search = opts.search;
    if (opts?.sort_by) payload.sort_by = opts.sort_by;
    if (opts?.sort_order) payload.sort_order = opts.sort_order;

    return ipc<any[]>(api.orders.list(payload));
  }

  // Browser/mock fallback: reuse existing getOrders (details) and slice
  const all = await getOrders(Math.max(1000, limit + offset));
  return all.slice(offset, offset + limit);
};

// ============================================================================
// EXCHANGE RATES (Desktop/Electron)
// ============================================================================

export const getLatestExchangeRate = async (filters: {
  base_currency: string;
  quote_currency: string;
  on_date?: string; // YYYY-MM-DD
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.exchangeRates.getLatest(filters));
  }
  await delay();
  // Browser/mock: no FX rates store yet
  return null;
};

// ============================================================================
// REPORTS (Desktop/Electron)
// ============================================================================

export const getSupplierActSverka = async (filters: {
  supplier_id: string;
  date_from?: string;
  date_to?: string;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.reports.supplierActSverka(filters || {}));
  }
  await delay();
  throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
};

export const getSupplierProductSales = async (filters: {
  date_from: string;
  date_to: string;
  supplier_id?: string;
  warehouse_id?: string;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.reports.supplierProductSales(filters || {}));
  }
  await delay();
  throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
};

export const getLatestPurchaseCosts = async (): Promise<Record<string, number>> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Record<string, number>>(api.reports.latestPurchaseCosts());
  }
  await delay();
  return {};
};

export const getOrderById = async (id: string) => {
  // Use Electron IPC if available
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<OrderWithDetails | null>(api.orders.get(id));
  }
  await delay();
  const orders = getStoredOrders();
  const order = orders.find(o => o.id === id);
  if (!order) return null;
  
  const orderItems = getStoredOrderItems();
  const payments = getStoredPayments();
  const customers = getStoredCustomers();
  const profiles = await getProfiles();
  
  return {
    ...order,
    items: orderItems.filter(item => item.order_id === order.id),
    payments: payments.filter(payment => payment.order_id === order.id),
    customer: order.customer_id ? customers.find(c => c.id === order.customer_id) : undefined,
    cashier: order.cashier_id ? profiles.find(p => p.id === order.cashier_id) : undefined,
  } as OrderWithDetails;
};

export const getOrderByNumber = async (orderNumber: string) => {
  // Use Electron IPC if available (if handler exists in backend)
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<OrderWithDetails | null>(api.orders.getByNumber(orderNumber));
  }
  await delay();
  const orders = getStoredOrders();
  const order = orders.find(o => o.order_number === orderNumber);
  if (!order) return null;
  
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

export const getOrdersByCustomer = async (customerId: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<OrderWithDetails[]>(api.orders.getByCustomer(customerId));
  }
  await delay();
  const orders = getStoredOrders();
  const customerOrders = orders.filter(o => o.customer_id === customerId);
  const orderItems = getStoredOrderItems();
  const payments = getStoredPayments();
  const customers = getStoredCustomers();
  
  return customerOrders.map(order => ({
    ...order,
    items: orderItems.filter(item => item.order_id === order.id),
    payments: payments.filter(payment => payment.order_id === order.id),
    customer: customers.find(c => c.id === order.customer_id),
  })) as OrderWithDetails[];
};

export const generateOrderNumber = async () => {
  await delay();
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const timestamp = Date.now().toString().slice(-6);
  return `ORD-${today}-${timestamp}`;
};

export const completePOSOrder = async (
  order: Omit<Order, 'id' | 'created_at'>,
  items: Omit<OrderItem, 'id' | 'order_id'>[],
  payments: Omit<Payment, 'id' | 'order_id' | 'created_at'>[]
) => {
  // Use Electron IPC if available
  if (hasPosApi()) {
    const api = requireElectron();
    const order_uuid = (order as any).order_uuid || generateUUID();
    const device_id = (order as any).device_id || (await getDeviceId());
    const orderWithMeta = {
      ...order,
      order_uuid,
      ...(device_id ? { device_id } : {}),
    } as any;
    return ipc<{ order_id: string; order_number: string; new_balance?: number }>(
      api.sales.completePOSOrder(orderWithMeta, items, payments)
    );
  }
  
  // Fallback to mock/localStorage for dev/testing
  await delay();
  
  const orderId = generateId();
  const orderNumber = await generateOrderNumber();
  const createdAt = new Date().toISOString();
  const isOnline = navigator.onLine;
  
  // Create full order object
  const fullOrder: Order = {
    ...order,
    order_uuid: (order as any).order_uuid || generateUUID(),
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
      const qtyBase = (item as any).qty_base ?? item.quantity;
      product.current_stock = Math.max(0, product.current_stock - qtyBase);
      product.updated_at = createdAt;
      
      // Create inventory movement record
      const movement: InventoryMovement = {
        id: generateId(),
        product_id: item.product_id,
        movement_number: `MOV-${Date.now()}-${generateId().slice(0, 8)}`,
        movement_type: 'sale',
        quantity: -qtyBase, // Negative for sales (stock decrease)
        before_quantity: product.current_stock + qtyBase,
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
  return completePOSOrder(order, items, payments);
};

export const updateOrderStatus = async (id: string, status: string): Promise<Order> => {
  await delay();
  const orders = getStoredOrders();
  const index = orders.findIndex(o => o.id === id);
  
  if (index === -1) {
    throw new Error('Buyurtma topilmadi');
  }
  
  const updatedOrder: Order = {
    ...orders[index],
    status: status as Order['status'],
    updated_at: new Date().toISOString(),
  };
  
  orders[index] = updatedOrder;
  saveOrders(orders);
  
  return updatedOrder;
};

/**
 * Cancel an order (sets status to 'voided' or 'cancelled')
 */
export const cancelOrder = async (id: string): Promise<Order> => {
  await delay();
  const orders = getStoredOrders();
  const index = orders.findIndex(o => o.id === id);
  
  if (index === -1) {
    throw new Error('Buyurtma topilmadi');
  }
  
  const order = orders[index];
  
  // Check if order can be cancelled
  if (order.status === 'voided' || order.status === 'cancelled') {
    throw new Error('Buyurtma allaqachon bekor qilingan');
  }
  
  // Only allow cancelling completed orders (or pending if business rules allow)
  if (order.status !== 'completed' && order.status !== 'pending') {
    throw new Error(`'${order.status}' holatidagi buyurtmani bekor qilib bo'lmaydi`);
  }
  
  const updatedOrder: Order = {
    ...order,
    status: 'voided',
    updated_at: new Date().toISOString(),
  };
  
  orders[index] = updatedOrder;
  saveOrders(orders);
  
  return updatedOrder;
};

// ============================================================================
// PAYMENT FUNCTIONS (Mock)
// ============================================================================

export const generatePaymentNumber = async () => {
  await delay();
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
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.purchases.list(filters || {}));
  }
  await delay();
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
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.purchases.get(id));
  }
  await delay();
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

// ============================================================================
// PURCHASE ORDER EXPENSES (LANDED COST)
// ============================================================================

export const listPurchaseOrderExpenses = async (purchaseOrderId: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.purchases.listExpenses(purchaseOrderId));
  }
  await delay();
  // Not supported in mock mode (yet)
  return [];
};

export const addPurchaseOrderExpense = async (
  purchaseOrderId: string,
  payload: { title: string; amount: number; allocation_method?: 'by_value' | 'by_qty'; notes?: string | null; created_by?: string | null }
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.purchases.addExpense(purchaseOrderId, payload));
  }
  await delay();
  throw new Error('PO xarajatlari faqat desktop ilovada mavjud');
};

export const deletePurchaseOrderExpense = async (purchaseOrderId: string, expenseId: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.purchases.deleteExpense(purchaseOrderId, expenseId));
  }
  await delay();
  throw new Error('PO xarajatlari faqat desktop ilovada mavjud');
};

export const deletePurchaseOrder = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.purchases.deleteOrder(id));
  }
  await delay();

  const orders = getStoredPurchaseOrders();
  const index = orders.findIndex((po) => po.id === id);
  if (index === -1) {
    throw new Error('Purchase order not found');
  }

  const po = orders[index];
  if (po.status !== 'draft' && po.status !== 'cancelled') {
    throw new Error('Only draft or cancelled purchase orders can be deleted');
  }

  const payments = getStoredSupplierPayments();
  const hasPayments = payments.some((p) => p.purchase_order_id === id);
  if (hasPayments) {
    throw new Error('Cannot delete a purchase order with payments');
  }

  orders.splice(index, 1);
  savePurchaseOrders(orders);

  const items = getStoredPurchaseOrderItems();
  const filteredItems = items.filter((item) => item.purchase_order_id !== id);
  savePurchaseOrderItems(filteredItems);

  return { success: true };
};

export const generatePONumber = async () => {
  await delay();
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
  if (hasPosApi()) {
    const api = requireElectron();
    // Backend expects a single payload with items[]
    return ipc<any>(
      api.purchases.createOrder({
        ...purchaseOrder,
        items: orderItems,
      })
    );
  }
  await delay();
  
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
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.purchases.updateOrder(id, purchaseOrder, orderItems));
  }
  await delay();
  
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
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.purchases.approve(id, _approvedBy));
  }
  await delay();
  
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
  await delay();
  
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
  if (hasPosApi()) {
    const api = requireElectron();
    // Backend expects receiptData: { items: [...], received_by?, received_at? }
    return ipc<any>(
      api.purchases.receiveGoods(poId, {
        items,
        received_at: receivedDate || null,
        // received_by can be set by backend/UI; optional here
      })
    );
  }
  await delay();
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

export const createPurchaseReceipt = async (payload: {
  purchase_order_id?: string | null;
  supplier_id?: string | null;
  warehouse_id?: string | null;
  currency?: 'USD' | 'UZS';
  exchange_rate?: number | null;
  status?: 'draft' | 'received';
  invoice_number?: string | null;
  received_at?: string | null;
  notes?: string | null;
  created_by?: string | null;
  items: Array<{
    purchase_order_item_id?: string | null;
    product_id: string;
    product_name?: string | null;
    received_qty: number;
    unit_cost?: number;
    line_total?: number;
    unit_cost_usd?: number | null;
    line_total_usd?: number | null;
  }>;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.purchases.createReceipt(payload));
  }
  await delay();
  throw new Error('Purchase receipts faqat desktop ilovada mavjud');
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

// ============================================================================
// SALES RETURNS FUNCTIONS (Mock)
// ============================================================================

export const getSalesReturnById = async (id: string) => {
  // Use Electron IPC if available (real DB)
  if (hasPosApi()) {
    const api = requireElectron();
    const r = await ipc<any>(api.returns.get(id));
    const normalizeStatus = (s: any) => {
      const v = String(s || '').toLowerCase();
      if (v === 'completed') return 'Completed';
      if (v === 'pending') return 'Pending';
      if (v === 'cancelled') return 'Cancelled';
      return s;
    };
    return {
      ...r,
      status: normalizeStatus(r?.status),
      reason: r?.reason ?? r?.return_reason ?? null,
      return_reason: r?.return_reason ?? r?.reason ?? null,
    } as any;
  }

  await delay();
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
  // Use Electron IPC if available (real DB)
  if (hasPosApi()) {
    const api = requireElectron();
    const statusMap: Record<string, string> = {
      Completed: 'completed',
      Pending: 'pending',
      Cancelled: 'cancelled',
      completed: 'completed',
      pending: 'pending',
      cancelled: 'cancelled',
    };
    const payload: any = {};
    if (filters?.status) payload.status = statusMap[String(filters.status)] || String(filters.status).toLowerCase();
    if (filters?.customerId) payload.customer_id = filters.customerId;
    if (filters?.startDate) payload.date_from = filters.startDate;
    if (filters?.endDate) payload.date_to = filters.endDate;

    const rows = await ipc<any[]>(api.returns.list(payload));
    const normalizeStatus = (s: any) => {
      const v = String(s || '').toLowerCase();
      if (v === 'completed') return 'Completed';
      if (v === 'pending') return 'Pending';
      if (v === 'cancelled') return 'Cancelled';
      return s;
    };
    return (rows || []).map((r: any) => ({
      ...r,
      status: normalizeStatus(r?.status),
      reason: r?.reason ?? r?.return_reason ?? null,
      return_reason: r?.return_reason ?? r?.reason ?? null,
    })) as any;
  }

  await delay();
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
  if (hasPosApi()) {
    throw new Error("Desktop rejimda qaytarishni tahrirlash (status) hozircha qo'llab-quvvatlanmaydi.");
  }
  await delay();
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
  if (hasPosApi()) {
    throw new Error("Desktop rejimda qaytarishni o'chirish hozircha qo'llab-quvvatlanmaydi.");
  }
  await delay();
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
  // Use Electron IPC if available (real DB)
  if (hasPosApi()) {
    const api = requireElectron();
    // NOTE: preload expects a single arg, but IPC handler expects { orderId }.
    // Passing an object keeps both sides compatible.
    const details = await ipc<any>(api.returns.getOrderDetails({ orderId }));
    const order = details?.order;
    const items = Array.isArray(details?.items) ? details.items : [];
    const customer = details?.customer ?? null;

    if (!order?.id) return null as any;

    // Normalize to OrderWithDetails shape expected by UI
    return {
      id: order.id,
      order_number: order.order_number ?? order.orderNumber ?? null,
      customer_id: order.customer_id ?? null,
      cashier_id: order.cashier_id ?? null,
      user_id: order.user_id ?? null,
      warehouse_id: order.warehouse_id ?? MAIN_WAREHOUSE_ID,
      shift_id: order.shift_id ?? null,
      subtotal: order.subtotal ?? 0,
      discount_amount: order.discount_amount ?? 0,
      discount_percent: order.discount_percent ?? 0,
      tax_amount: order.tax_amount ?? 0,
      total_amount: order.total_amount ?? order.total ?? 0,
      paid_amount: order.paid_amount ?? 0,
      credit_amount: order.credit_amount ?? 0,
      change_amount: order.change_amount ?? 0,
      status: order.status ?? 'completed',
      payment_status: order.payment_status ?? 'paid',
      notes: order.notes ?? null,
      created_at: order.created_at ?? order.createdAt ?? new Date().toISOString(),
      updated_at: order.updated_at ?? order.updatedAt ?? null,
      // Details:
      items: items.map((it: any) => ({
        // keep both id and orderItemId for compatibility with existing UI mapping
        id: it.order_item_id ?? it.orderItemId ?? it.id,
        order_id: order.id,
        product_id: it.product_id ?? it.productId,
        product_name: it.product_name ?? it.name,
        product_sku: it.product_sku ?? it.productSku ?? it.sku ?? null,
        unit_price: Number(it.unit_price ?? it.price ?? 0),
        base_price: Number(it.base_price ?? it.basePrice ?? it.unit_price ?? it.price ?? 0),
        usta_price: it.usta_price ?? it.ustaPrice ?? null,
        discount_type: it.discount_type ?? it.discountType ?? 'none',
        discount_value: Number(it.discount_value ?? it.discountValue ?? 0),
        final_unit_price: Number(it.final_unit_price ?? it.finalUnitPrice ?? 0),
        final_total: Number(it.final_total ?? it.finalTotal ?? it.line_total ?? it.lineTotal ?? 0),
        price_source: it.price_source ?? it.priceSource ?? null,
        quantity: Number(it.quantity ?? it.qty ?? it.sold_quantity ?? 0),
        discount_amount: Number(it.discount_amount ?? 0),
        line_total: Number(it.line_total ?? it.lineTotal ?? 0),
        created_at: it.created_at ?? order.created_at ?? new Date().toISOString(),
        // return-aware fields used by CreateReturn.tsx:
        sold_quantity: it.sold_quantity ?? it.qty ?? it.quantity,
        returned_quantity: it.returned_quantity ?? 0,
        remaining_quantity: it.remaining_quantity ?? it.refundableQty ?? it.qty ?? it.quantity,
        orderItemId: it.orderItemId ?? it.order_item_id ?? it.id,
      })) as any,
      payments: [],
      customer: customer || undefined,
    } as any;
  }

  await delay();
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
  await delay();
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const timestamp = Date.now().toString().slice(-6);
  return `RET-${today}-${timestamp}`;
};

export const createSalesReturn = async (returnData: {
  mode?: 'order' | 'manual';
  order_id?: string | null;
  customer_id: string | null;
  cashier_id: string;
  total_amount: number;
  refund_method: 'cash' | 'card' | 'credit' | 'customer_account';
  reason: string;
  notes: string | null;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    order_item_id?: string | null;
    product_name?: string;
    sale_unit?: string;
    qty_sale?: number;
    qty_base?: number;
    base_price?: number | null;
    usta_price?: number | null;
    discount_type?: 'none' | 'percent' | 'fixed' | 'mixed' | null;
    discount_value?: number;
    final_unit_price?: number;
    final_total?: number;
    price_source?: 'base' | 'usta' | 'promo' | 'manual' | 'tier' | null;
  }>;
}) => {
  // Use Electron IPC if available (real DB)
  if (hasPosApi()) {
    const api = requireElectron();
    const payload = {
      mode: returnData.mode || (returnData.order_id ? 'order' : 'manual'),
      order_id: returnData.order_id ?? null,
      customer_id: returnData.customer_id ?? null,
      // ReturnsService expects return_reason, not "reason"
      return_reason: returnData.reason,
      refund_method: returnData.refund_method,
      notes: returnData.notes,
      total_amount: returnData.total_amount,
      items: (returnData.items || []).map((it) => ({
        order_item_id: (it as any).order_item_id,
        product_id: it.product_id,
        product_name: (it as any).product_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
        sale_unit: (it as any).sale_unit ?? null,
        qty_sale: (it as any).qty_sale ?? it.quantity,
        qty_base: (it as any).qty_base ?? it.quantity,
        base_price: (it as any).base_price ?? null,
        usta_price: (it as any).usta_price ?? null,
        discount_type: (it as any).discount_type ?? null,
        discount_value: (it as any).discount_value ?? 0,
        final_unit_price: (it as any).final_unit_price ?? it.unit_price,
        final_total: (it as any).final_total ?? it.line_total,
        price_source: (it as any).price_source ?? null,
      })),
      // Optional fields; ReturnsService will resolve safe IDs anyway
      cashier_id: returnData.cashier_id,
      user_id: returnData.cashier_id,
    };

    return ipc<any>(api.returns.create(payload));
  }

  await delay();
  
  const returnId = generateId();
  const returnNumber = await generateReturnNumber();
  const createdAt = new Date().toISOString();
  
  // Create sales return
  // Status is 'Completed' immediately since all inventory/financial adjustments are done at creation time
  const salesReturn: SalesReturn = {
    id: returnId,
    return_number: returnNumber,
    order_id: returnData.order_id ?? null,
    customer_id: returnData.customer_id,
    cashier_id: returnData.cashier_id,
    total_amount: returnData.total_amount,
    refund_method: returnData.refund_method,
    return_mode: returnData.mode || (returnData.order_id ? 'order' : 'manual'),
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
    order_item_id: item.order_item_id ?? null,
    product_id: item.product_id,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    line_total: item.line_total,
    sale_unit: item.sale_unit,
    qty_sale: item.qty_sale,
    qty_base: item.qty_base,
    base_price: item.base_price ?? undefined,
    usta_price: item.usta_price ?? undefined,
    discount_type: item.discount_type ?? undefined,
    discount_value: item.discount_value,
    final_unit_price: item.final_unit_price,
    final_total: item.final_total,
    price_source: item.price_source ?? undefined,
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
  
  // If refund is written to customer account, increase balance (reduces debt / creates credit)
  if (((returnData.mode === 'manual' && returnData.customer_id) || returnData.refund_method === 'credit' || returnData.refund_method === 'customer_account') && returnData.customer_id) {
    const customers = getStoredCustomers();
    const customerIndex = customers.findIndex(c => c.id === returnData.customer_id);
    
    if (customerIndex >= 0) {
      const customer = customers[customerIndex];
      const currentBalance = customer.balance || 0;
      const newBalance = currentBalance + returnData.total_amount;
      
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
  await delay();
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
  await delay();
  await updateSalesReturnStatus(id, 'Cancelled');
};

export const completeSalesReturn = async (id: string) => {
  await delay();
  await updateSalesReturnStatus(id, 'Completed');
};

export const getSalesReturnsByOrderId = async (orderId: string) => {
  await delay();
  const returns = getStoredSalesReturns();
  return returns.filter(r => r.order_id === orderId);
};

/**
 * Get a single sales return by order ID (returns the first one if multiple exist)
 * Returns null if no return exists for this order
 */
export const getSalesReturnByOrderId = async (orderId: string): Promise<SalesReturnWithDetails | null> => {
  // Use Electron IPC if available (real DB)
  if (hasPosApi()) {
    const api = requireElectron();
    const list = await ipc<any[]>(api.returns.list({ order_id: orderId, limit: 1 }));
    const first = Array.isArray(list) ? list[0] : null;
    if (!first?.id) return null;
    // We only need id + return_number for routing; details can be loaded on view page.
    return first as any;
  }
  await delay();
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
// EMPLOYEE FUNCTIONS
// ============================================================================

export const getAllEmployees = async () => {
  if (hasPosApi()) {
    const api = requireElectron();
    // users.list returns rows shaped like Profile (RBAC role included via join)
    return ipc<Profile[]>(api.users.list({}));
  }
  await delay();
  return [] as Profile[];
};

export const getEmployeeById = async (_id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Profile>(api.users.get(_id));
  }
  await delay();
  return null;
};

export const createEmployee = async (_employeeData: {
  username: string;
  password: string;
  full_name: string;
  phone?: string;
  email?: string;
  role: 'admin' | 'manager' | 'cashier' | 'warehouse';
  is_active?: boolean;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Profile>(
      api.users.create({
        username: _employeeData.username,
        password: _employeeData.password,
        full_name: _employeeData.full_name,
        phone: _employeeData.phone || null,
        email: _employeeData.email || null,
        role: _employeeData.role,
        is_active: _employeeData.is_active === false ? 0 : 1,
      })
    );
  }
  await delay();
  // Mock mode: do nothing
  return {} as Profile;
};

export const updateEmployee = async (id: string, updates: Partial<Profile>) => {
  if (hasPosApi()) {
    const api = requireElectron();
    // Backend expects is_active as 0/1; accept boolean too
    const normalized: any = { ...updates };
    if (typeof (updates as any).is_active === 'boolean') {
      normalized.is_active = (updates as any).is_active ? 1 : 0;
    }
    return ipc<Profile>(api.users.update(id, normalized));
  }
  await delay();
  return { ...updates, id } as Profile;
};

export const deactivateEmployee = async (_id: string) => {
  await delay();
  return {} as Profile;
};

export const activateEmployee = async (_id: string) => {
  await delay();
  return {} as Profile;
};

export const deleteEmployee = async (_id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    await ipc<any>(api.users.delete(_id));
    return;
  }
  await delay();
};

export const getEmployeeSessions = async (_employeeId?: string) => {
  await delay();
  return [] as EmployeeSessionWithProfile[];
};

export const startEmployeeSession = async (_employeeId: string, _ipAddress?: string) => {
  await delay();
  return generateId();
};

export const endEmployeeSession = async (_sessionId: string, _ipAddress?: string) => {
  await delay();
  return true;
};

export const getEmployeeActivityLogs = async (_employeeId?: string) => {
  await delay();
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
  await delay();
  return generateId();
};

export const getEmployeePerformance = async (
  _employeeId: string,
  _startDate?: string,
  _endDate?: string
) => {
  await delay();
  return null;
};

// ============================================================================
// SETTINGS FUNCTIONS
// ============================================================================

export const getSettingsByCategory = async (category: string) => {
  const cat = String(category || '').trim();
  if (!cat) return {} as Record<string, unknown>;

  if (hasPosApi()) {
    const api = requireElectron();
    const rows = await ipc<any[]>(
      api.settings.getAll({
        category: cat,
      })
    ).catch(() => []);

    const out: Record<string, unknown> = {};
    for (const r of rows || []) {
      const key = String(r?.key ?? '').trim();
      if (!key) continue;
      // Convention: keys often stored as `${category}.${field}` (e.g. receipt.header_text)
      const prefix = `${cat}.`;
      const field = key.startsWith(prefix) ? key.slice(prefix.length) : key;
      out[field] = r?.value;
    }
    return out;
  }

  // Mock mode
  await delay();
  return {} as Record<string, unknown>;
};

export const getSetting = async (category: string, key: string) => {
  const cat = String(category || '').trim();
  const k = String(key || '').trim();
  if (!cat || !k) return null;

  if (hasPosApi()) {
    const api = requireElectron();
    // Prefer category-prefixed key
    const fullKey = k.includes('.') ? k : `${cat}.${k}`;
    return ipc<any>(api.settings.get(fullKey)).catch(() => null);
  }

  await delay();
  return null;
};

export const updateSetting = async (
  category: string,
  key: string,
  value: unknown,
  updatedBy: string
) => {
  const cat = String(category || '').trim();
  const k = String(key || '').trim();
  if (!cat || !k) return false;

  if (hasPosApi()) {
    const api = requireElectron();
    const fullKey = k.includes('.') ? k : `${cat}.${k}`;
    const type =
      typeof value === 'boolean'
        ? 'boolean'
        : typeof value === 'number'
          ? 'number'
          : value && typeof value === 'object'
            ? 'json'
            : 'string';
    await ipc<any>(api.settings.set(fullKey, value, type, updatedBy || null));
    return true;
  }

  await delay();
  return true;
};

export const bulkUpdateSettings = async (
  category: string,
  settings: Record<string, unknown>,
  updatedBy: string
) => {
  const cat = String(category || '').trim();
  if (!cat) return 0;

  if (hasPosApi()) {
    const api = requireElectron();
    const entries = Object.entries(settings || {});
    let n = 0;
    for (const [kRaw, v] of entries) {
      const k = String(kRaw || '').trim();
      if (!k) continue;
      const fullKey = k.includes('.') ? k : `${cat}.${k}`;
      const type =
        typeof v === 'boolean'
          ? 'boolean'
          : typeof v === 'number'
            ? 'number'
            : v && typeof v === 'object'
              ? 'json'
              : 'string';
      // eslint-disable-next-line no-await-in-loop
      await ipc<any>(api.settings.set(fullKey, v, type, updatedBy || null));
      n++;
    }
    return n;
  }

  await delay();
  return 0;
};

// ============================================================================
// HELD ORDERS FUNCTIONS (Mock)
// ============================================================================

export const generateHeldNumber = async (): Promise<string> => {
  await delay();
  
  // Reload from storage to ensure we have latest data
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
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
  await delay();
  
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
  
  // Reload from storage before push - ensures we never overwrite existing held orders
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  mockDB.heldOrders.push(newHeldOrder);
  saveHeldOrdersToStorage(mockDB.heldOrders);
  
  return newHeldOrder;
};

export const getHeldOrders = async (): Promise<HeldOrder[]> => {
  await delay();
  
  // Reload from storage to ensure we have latest data
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  // Return only HELD orders, sorted by created_at DESC (newest first)
  return mockDB.heldOrders
    .filter(order => order.status === 'HELD')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
};

export const getHeldOrderById = async (id: string): Promise<HeldOrder | null> => {
  await delay();
  
  // Reload from storage
  mockDB.heldOrders = loadHeldOrdersFromStorage();
  
  const order = mockDB.heldOrders.find(order => order.id === id);
  return order || null;
};

export const updateHeldOrderStatus = async (
  id: string, 
  status: 'RESTORED' | 'CANCELLED'
): Promise<HeldOrder> => {
  await delay();
  
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
  await delay();
  
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
  await delay();
  
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
// QUOTES (Smeta / Estimate) FUNCTIONS
// ============================================================================

const QUOTES_STORAGE_KEY = 'pos_quotes';

const loadQuotesFromStorage = (): any[] => {
  try {
    const stored = localStorage.getItem(QUOTES_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Error loading quotes:', e);
  }
  return [];
};

const saveQuotesToStorage = (quotes: any[]) => {
  try {
    localStorage.setItem(QUOTES_STORAGE_KEY, JSON.stringify(quotes));
  } catch (e) {
    console.error('Error saving quotes:', e);
  }
};

export const getQuotes = async (filters?: { status?: string; limit?: number }) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.quotes.list(filters || {}));
  }
  await delay();
  let list = loadQuotesFromStorage();
  if (filters?.status) {
    list = list.filter((q: any) => q.status === filters.status);
  }
  list.sort((a: any, b: any) => (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
  if (filters?.limit) list = list.slice(0, filters.limit);
  return list;
};

export const getQuoteById = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any | null>(api.quotes.get(id));
  }
  await delay();
  const list = loadQuotesFromStorage();
  return list.find((q: any) => q.id === id) || null;
};

export const generateQuoteNumber = async () => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<string>(api.quotes.generateNumber());
  }
  await delay();
  const list = loadQuotesFromStorage();
  const nums = list
    .filter((q: any) => /^QUOTE-\d+$/.test(q.quote_number || ''))
    .map((q: any) => parseInt(String(q.quote_number).replace(/^QUOTE-/, ''), 10) || 0);
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `QUOTE-${String(next).padStart(6, '0')}`;
};

export const createQuote = async (data: {
  quote_number?: string;
  customer_id?: string | null;
  customer_name: string;
  phone?: string | null;
  price_type: 'retail' | 'usta';
  status?: string;
  subtotal: number;
  discount_amount: number;
  discount_percent: number;
  total: number;
  total_profit?: number | null;
  valid_until?: string | null;
  notes?: string | null;
  created_by: string;
  items: any[];
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.quotes.create(data));
  }
  await delay();
  const id = generateId();
  const quoteNumber = data.quote_number || (await generateQuoteNumber());
  const quote = {
    id,
    quote_number: quoteNumber,
    customer_id: data.customer_id || null,
    customer_name: data.customer_name || '',
    phone: data.phone || null,
    price_type: data.price_type || 'retail',
    status: data.status || 'draft',
    subtotal: data.subtotal || 0,
    discount_amount: data.discount_amount || 0,
    discount_percent: data.discount_percent || 0,
    total: data.total || 0,
    total_profit: data.total_profit ?? null,
    valid_until: data.valid_until || null,
    notes: data.notes || null,
    created_at: new Date().toISOString(),
    updated_at: null,
    created_by: data.created_by || '',
    items: (data.items || []).map((it: any, i: number) => ({
      ...it,
      id: it.id || generateId(),
      quote_id: id,
      sort_order: i,
    })),
  };
  const list = loadQuotesFromStorage();
  list.unshift(quote);
  saveQuotesToStorage(list);
  return quote;
};

export const updateQuote = async (id: string, data: Partial<any>) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.quotes.update(id, data));
  }
  await delay();
  const list = loadQuotesFromStorage();
  const i = list.findIndex((q: any) => q.id === id);
  if (i === -1) return null;
  const updated = { ...list[i], ...data, updated_at: new Date().toISOString() };
  if (data.items) updated.items = data.items;
  list[i] = updated;
  saveQuotesToStorage(list);
  return updated;
};

export const deleteQuote = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<void>(api.quotes.delete(id));
  }
  await delay();
  const list = loadQuotesFromStorage().filter((q: any) => q.id !== id);
  saveQuotesToStorage(list);
};

export const convertQuoteToSale = async (
  quoteId: string,
  orderData: { cashier_id: string; shift_id?: string | null; warehouse_id?: string }
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<{ order_id: string; order_number: string }>(
      api.quotes.convertToSale(quoteId, orderData)
    );
  }
  throw new Error('Quote to sale conversion requires Electron desktop app');
};

// ============================================================================
// DASHBOARD ANALYTICS FUNCTIONS (Mock)
// ============================================================================

export interface DashboardAnalytics {
  total_sales: number;
  total_orders: number;
  total_cogs: number;
  total_profit: number;
  profit_margin: number;
  total_expenses: number;
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
  // Electron (real DB) mode
  if (hasPosApi()) {
    const api = requireElectron();
    const date_from = formatDateYMD(startDate);
    const date_to = formatDateYMD(endDate);
    const base = await ipc<DashboardAnalytics>(api.dashboard.getAnalytics({ date_from, date_to }));

    // IMPORTANT:
    // Our current Expenses UI still uses localStorage (legacy) even in Electron mode.
    // To keep Dashboard "Jami xarajatlar" consistent with the Expenses section,
    // compute expenses from localStorage for the selected period.
    try {
      const stored = loadExpensesFromStorage();
      const total_expenses_local = (stored || [])
        .filter((e) => {
          const d = String((e as any).expense_date || '').slice(0, 10);
          if (!d) return false;
          return d >= date_from && d <= date_to;
        })
        .reduce((sum, e: any) => sum + (Number(e?.amount || 0) || 0), 0);

      return {
        ...base,
        total_expenses: total_expenses_local,
      };
    } catch {
      return base;
    }
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
// CUSTOMER CREDIT/DEBT FUNCTIONS (Mock)
// ============================================================================

export const createCreditOrder = async (orderData: {
  customer_id: string;
  cashier_id: string;
  shift_id: string | null;
  price_tier_code?: string | null;
  items: Array<{
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    discount_amount: number;
    total: number;
    price_tier?: string;
    price_source?: string;
    sale_unit?: string;
    qty_sale?: number;
    qty_base?: number;
    base_price?: number;
    usta_price?: number | null;
    discount_type?: string;
    discount_value?: number;
    final_unit_price?: number;
    final_total?: number;
  }>;
  subtotal: number;
  discount_amount: number;
  discount_percent: number;
  tax_amount: number;
  total_amount: number;
  notes?: string;
  loyalty_redeem_points?: number;
}): Promise<{ success: boolean; order_id?: string; order_number?: string; new_balance?: number; error?: string }> => {
  // Use Electron IPC if available: route through completePOSOrder so SQLite + ledger + balance are updated.
  if (hasPosApi()) {
    try {
      const order: Omit<Order, 'id' | 'created_at'> = {
        order_number: '',
        customer_id: orderData.customer_id,
        cashier_id: orderData.cashier_id,
        shift_id: orderData.shift_id,
        price_tier_code: orderData.price_tier_code,
        warehouse_id: MAIN_WAREHOUSE_ID,
        subtotal: orderData.subtotal,
        discount_amount: orderData.discount_amount,
        discount_percent: orderData.discount_percent,
        tax_amount: orderData.tax_amount,
        total_amount: orderData.total_amount,
        paid_amount: 0,
        credit_amount: orderData.total_amount,
        change_amount: 0,
        status: 'completed',
        payment_status: 'on_credit' as any,
        notes: orderData.notes || null,
        ...(Number(orderData.loyalty_redeem_points) > 0
          ? { loyalty_redeem_points: Math.floor(Number(orderData.loyalty_redeem_points)) }
          : {}),
      } as any;

      const items = orderData.items.map((it) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
        subtotal: it.subtotal,
        discount_amount: it.discount_amount,
        total: it.total,
      })) as any;

      // IMPORTANT: Do NOT add a "credit" payment row; credit is derived as (total - paid).
      const res = await completePOSOrder(order, items, []) as { order_id?: string; id?: string; order_number?: string; new_balance?: number };
      const orderId = res.order_id ?? (res as any).id;
      let orderNumber = res.order_number;
      // CRITICAL: If backend didn't return order_number (IPC/response bug or duplicate-order early return), fetch by order_id
      if ((!orderNumber || orderNumber === '') && orderId) {
        try {
          const full = await getOrderById(orderId);
          orderNumber = full?.order_number ?? `ORD-${Date.now()}`;
        } catch {
          orderNumber = `ORD-${Date.now()}`;
        }
      }
      return {
        success: true,
        order_id: orderId ?? '',
        order_number: orderNumber ?? res.order_number ?? `ORD-${Date.now()}`,
        new_balance: res.new_balance,
      };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  }

  await delay();
  
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
  // Backward/forward compatible:
  // - UI may send `payment_method`
  // - IPC historically expected `method`
  payment_method?: 'cash' | 'card' | 'click' | 'payme' | 'transfer' | 'other' | 'qr';
  method?: 'cash' | 'card' | 'click' | 'payme' | 'transfer' | 'other' | 'qr';
  operation?: 'payment_in' | 'payment_out';
  notes?: string | null;
  note?: string | null;
  received_by?: string | null;
  order_id?: string | null;
  source?: 'pos' | 'customers' | string;
}): Promise<{
  success: boolean;
  payment_number?: string;
  old_balance?: number;
  requested_amount?: number;
  applied_amount?: number;
  new_balance?: number;
  error?: string;
}> => {
  if (hasPosApi()) {
    const api = requireElectron();
    const method = (_paymentData.method || _paymentData.payment_method || 'cash') as string;
    const normalizedMethod = method === 'qr' ? 'other' : method; // backend supports 'other' instead of legacy 'qr'
    const operation = _paymentData.operation || 'payment_in';
    const notes = (_paymentData.notes ?? _paymentData.note ?? null) as any;

    // Send canonical payload expected by IPC (and it also accepts payment_method for compatibility)
    return ipc<any>(
      api.customers.receivePayment({
        customer_id: _paymentData.customer_id,
        amount: _paymentData.amount,
        operation,
        method: normalizedMethod,
        payment_method: normalizedMethod,
        notes,
        received_by: _paymentData.received_by ?? null,
        order_id: _paymentData.order_id ?? null,
        source: _paymentData.source ?? null,
      })
    );
  }

  if (!ALLOW_MOCK_API) {
    return {
      success: false,
      error: 'Mock API o‘chirilgan. Iltimos desktop (Electron) ilovada ishlating yoki VITE_ALLOW_MOCK_API=true qiling.',
    };
  }
  await delay();
  return { success: true, payment_number: await generatePaymentNumber() };
};

export const getCustomerPayments = async (_customerId: string): Promise<CustomerPayment[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<CustomerPayment[]>(api.customers.getPayments(_customerId, { limit: 200, offset: 0 }));
  }
  await delay();
  return [];
};

export const getCustomerLedger = async (
  _customerId: string,
  _opts?: { limit?: number; offset?: number }
): Promise<CustomerLedgerEntry[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<CustomerLedgerEntry[]>(api.customers.getLedger(_customerId, { limit: _opts?.limit ?? 100, offset: _opts?.offset ?? 0 }));
  }
  await delay();
  return [];
};

export const getCustomerBonusLedger = async (
  customerId: string,
  _opts?: { limit?: number; offset?: number; type?: string }
): Promise<CustomerBonusLedgerEntry[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<CustomerBonusLedgerEntry[]>(
      api.customers.getBonusLedger(customerId, {
        limit: _opts?.limit ?? 100,
        offset: _opts?.offset ?? 0,
        type: _opts?.type,
      })
    );
  }
  await delay();
  return [];
};

export const adjustCustomerBonusPoints = async (payload: {
  actorUserId: string;
  customerId: string;
  deltaPoints: number;
  note?: string;
}): Promise<Customer> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<Customer>(api.customers.adjustBonusPoints(payload));
  }
  await delay();
  throw new Error('Bonus korreksiyasi faqat desktop ilovada mavjud');
};

export const getCustomersWithDebt = async (): Promise<Customer[]> => {
  await delay();
  return [];
};

export const getTotalCustomerDebt = async (): Promise<number> => {
  await delay();
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
  amount_usd?: number | null;
  currency?: 'UZS' | 'USD';
  payment_method: 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'uzum';
  paid_at?: string;
  note?: string | null;
  created_by?: string | null;
}): Promise<{ success: boolean; payment?: SupplierPayment; new_balance?: number; error?: string }> => {
  // Real implementation (Electron SQLite)
  if (hasPosApi()) {
    try {
      const api = requireElectron();
      const payment = await ipc<SupplierPayment>(api.suppliers.createPayment(paymentData));
      // Refresh supplier to get updated computed balance (source of truth: supplier_payments + received POs)
      let new_balance: number | undefined = undefined;
      try {
        const supplier = await ipc<any>(api.suppliers.get(paymentData.supplier_id));
        if (supplier && typeof supplier.balance === 'number') new_balance = supplier.balance;
      } catch {
        // ignore
      }
      return { success: true, payment, new_balance };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  }

  await delay();
  
  // Validate amount
  const amountValue = paymentData.currency === 'USD' ? Number(paymentData.amount_usd || 0) : Number(paymentData.amount);
  if (!amountValue || amountValue <= 0) {
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
    amount: paymentData.currency === 'USD' ? 0 : paymentData.amount,
    currency: paymentData.currency || 'UZS',
    amount_usd: paymentData.currency === 'USD' ? Number(paymentData.amount_usd || 0) : null,
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
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierPayment[]>(api.suppliers.getPayments(supplierId));
  }
  await delay();
  const payments = getStoredSupplierPayments();
  return payments
    .filter(p => p.supplier_id === supplierId)
    .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());
};

export const deleteSupplierPayment = async (paymentId: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    if (!api?.suppliers?.deletePayment) {
      throw new Error('Ilovani qayta ishga tushiring (deletePayment handler yangilandi)');
    }
    return ipc<{ success: boolean }>(api.suppliers.deletePayment(paymentId));
  }
  await delay();
  const payments = getStoredSupplierPayments();
  const index = payments.findIndex((p) => p.id === paymentId);
  if (index === -1) throw new Error('Payment not found');
  payments.splice(index, 1);
  saveSupplierPayments(payments);
  return { success: true };
};

/**
 * Get supplier ledger (transaction history)
 */
export const getSupplierLedger = async (
  supplierId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<SupplierLedgerEntry[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<SupplierLedgerEntry[]>(
      api.suppliers.getLedger(supplierId, { date_from: dateFrom, date_to: dateTo })
    );
  }
  await delay();
  
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
// SUPPLIER RETURNS (CREDIT NOTES)
// ============================================================================

export const createSupplierReturn = async (payload: {
  supplier_id: string;
  purchase_order_id?: string | null;
  warehouse_id?: string;
  status?: 'draft' | 'completed' | 'cancelled';
  return_reason?: string | null;
  notes?: string | null;
  created_by?: string | null;
  return_date?: string;
  items: { product_id: string; quantity: number; unit_cost?: number; reason?: string | null }[];
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.suppliers.createReturn(payload));
  }
  await delay();
  throw new Error('Supplier return faqat desktop ilovada mavjud');
};

export const getSupplierReturn = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any>(api.suppliers.getReturn(id));
  }
  await delay();
  throw new Error('Supplier return faqat desktop ilovada mavjud');
};

export const listSupplierReturns = async (filters?: {
  supplier_id?: string;
  purchase_order_id?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}) => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.suppliers.listReturns(filters || {}));
  }
  await delay();
  return [];
};

export const getSupplierPurchaseSummary = async (
  supplierId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<any[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    return ipc<any[]>(api.suppliers.getPurchaseSummary(supplierId, { date_from: dateFrom, date_to: dateTo }));
  }
  await delay();
  return [];
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
  // Use Electron IPC if available (real DB)
  if (hasPosApi()) {
    const api = requireElectron();
    const payload: any = {};
    if (filters?.dateFrom) payload.date_from = filters.dateFrom;
    if (filters?.dateTo) payload.date_to = filters.dateTo;
    // Backend filters by category_id/status only; we filter by category/payment/search client-side.
    const rows = await ipc<any[]>(api.expenses.list(payload));
    const profiles = await getProfiles();

    let mapped: any[] = (rows || []).map((e: any) => {
      const categoryName = e?.category_name ?? e?.categoryName ?? e?.category ?? '';
      const createdBy = e?.created_by ?? e?.createdBy ?? null;
      return {
        ...e,
        // normalize to UI shape
        category: categoryName || 'Boshqa',
        note: e?.note ?? e?.description ?? e?.notes ?? null,
        employee_id: e?.employee_id ?? createdBy ?? null,
        created_by: createdBy ?? null,
      };
    });

    if (filters?.category) mapped = mapped.filter((e) => String(e.category) === String(filters.category));
    if (filters?.paymentMethod) mapped = mapped.filter((e) => String(e.payment_method) === String(filters.paymentMethod));
    if (filters?.employeeId) mapped = mapped.filter((e) => String(e.employee_id || '') === String(filters.employeeId));
    if (filters?.search) {
      const s = String(filters.search).toLowerCase();
      mapped = mapped.filter((e) =>
        String(e.expense_number || '').toLowerCase().includes(s) ||
        String(e.note || '').toLowerCase().includes(s) ||
        String(e.category || '').toLowerCase().includes(s)
      );
    }

    // Enrich with profile data (same as mock)
    return mapped.map((expense) => ({
      ...expense,
      employee: expense.employee_id ? profiles.find((p) => p.id === expense.employee_id) : undefined,
      created_by_profile: expense.created_by ? profiles.find((p) => p.id === expense.created_by) : undefined,
    })) as any;
  }

  await delay();
  
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
  if (hasPosApi()) {
    const api = requireElectron();
    const rows = await ipc<any[]>(api.expenses.list({})).catch(() => []);
    const found = (rows || []).find((e: any) => String(e?.id) === String(id));
    if (!found) return null;
    const profiles = await getProfiles();
    const categoryName = found?.category_name ?? found?.categoryName ?? found?.category ?? '';
    const createdBy = found?.created_by ?? found?.createdBy ?? null;
    const normalized: any = {
      ...found,
      category: categoryName || 'Boshqa',
      note: found?.note ?? found?.description ?? found?.notes ?? null,
      employee_id: found?.employee_id ?? createdBy ?? null,
      created_by: createdBy ?? null,
    };
    return {
      ...normalized,
      employee: normalized.employee_id ? profiles.find((p) => p.id === normalized.employee_id) : undefined,
      created_by_profile: normalized.created_by ? profiles.find((p) => p.id === normalized.created_by) : undefined,
    } as any;
  }

  await delay();
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
  if (hasPosApi()) {
    const api = requireElectron();
    // Ensure category exists (by name). If not, create it.
    const name = String(expenseData.category || 'Boshqa').trim() || 'Boshqa';
    const categories = await ipc<any[]>(api.expenses.listCategories({})).catch(() => []);
    let cat = (categories || []).find((c: any) => String(c?.name || '').trim() === name);
    if (!cat?.id) {
      const codeBase = name
        .toUpperCase()
        .replace(/\s+/g, '_')
        .replace(/[^\w]/g, '')
        .slice(0, 16);
      const code = codeBase || `CAT_${Date.now()}`;
      cat = await ipc<any>(api.expenses.createCategory({ code, name, description: null, is_active: 1 }));
    }

    const createdBy = expenseData.created_by || expenseData.employee_id || null;
    const description = String(expenseData.note ?? '').trim() || name;
    const row = await ipc<any>(
      api.expenses.create({
        category_id: cat.id,
        amount: expenseData.amount,
        payment_method: expenseData.payment_method,
        expense_date: expenseData.expense_date,
        description,
        receipt_url: null,
        vendor: null,
        status: expenseData.status || 'approved',
        notes: null,
        created_by: createdBy,
      })
    );

    // Normalize to UI Expense shape
    return {
      ...row,
      category: row?.category_name ?? name,
      note: row?.description ?? null,
      employee_id: createdBy,
      created_by: createdBy,
    } as any;
  }

  await delay();
  
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
  if (hasPosApi()) {
    const api = requireElectron();
    const payload: any = {};
    if (updates.amount !== undefined) payload.amount = updates.amount;
    if (updates.payment_method !== undefined) payload.payment_method = updates.payment_method;
    if (updates.expense_date !== undefined) payload.expense_date = updates.expense_date;
    if (updates.note !== undefined) payload.description = String(updates.note ?? '').trim() || null;
    if (updates.status !== undefined) payload.status = updates.status;

    // Category change: ensure category exists and pass category_id
    if (updates.category !== undefined) {
      const name = String(updates.category || 'Boshqa').trim() || 'Boshqa';
      const categories = await ipc<any[]>(api.expenses.listCategories({})).catch(() => []);
      let cat = (categories || []).find((c: any) => String(c?.name || '').trim() === name);
      if (!cat?.id) {
        const codeBase = name
          .toUpperCase()
          .replace(/\s+/g, '_')
          .replace(/[^\w]/g, '')
          .slice(0, 16);
        const code = codeBase || `CAT_${Date.now()}`;
        cat = await ipc<any>(api.expenses.createCategory({ code, name, description: null, is_active: 1 }));
      }
      payload.category_id = cat.id;
    }

    const row = await ipc<any>(api.expenses.update(id, payload));
    const categoryName = row?.category_name ?? row?.categoryName ?? row?.category ?? updates.category ?? 'Boshqa';
    return {
      ...row,
      category: categoryName,
      note: row?.description ?? null,
    } as any;
  }

  await delay();
  
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
  if (hasPosApi()) {
    const api = requireElectron();
    await ipc<any>(api.expenses.delete(id));
    return;
  }

  await delay();
  
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
  if (hasPosApi()) {
    // Compute stats client-side from DB list (backend doesn't expose a stats endpoint)
    const all = await getExpenses({});
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    // Apply date filters only for "total"
    let filtered = [...all] as any[];
    if (filters?.dateFrom) filtered = filtered.filter((e) => String(e.expense_date) >= String(filters.dateFrom));
    if (filters?.dateTo) filtered = filtered.filter((e) => String(e.expense_date) <= String(filters.dateTo));

    const total = filtered.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const todayTotal = all.filter((e) => e.expense_date === today).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const monthlyTotal = all
      .filter((e) => e.expense_date >= monthStart && e.expense_date <= monthEnd)
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const categoryTotals = new Map<string, number>();
    for (const e of filtered) {
      const c = String((e as any).category || 'Boshqa');
      categoryTotals.set(c, (categoryTotals.get(c) || 0) + Number((e as any).amount || 0));
    }
    let topCategory: { category: ExpenseCategory; amount: number } | null = null;
    for (const [c, amount] of categoryTotals.entries()) {
      if (!topCategory || amount > topCategory.amount) topCategory = { category: c as any, amount };
    }

    return { total, today: todayTotal, monthly: monthlyTotal, topCategory };
  }

  await delay();
  
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
