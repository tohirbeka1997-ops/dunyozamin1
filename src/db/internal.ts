// Shared internal infrastructure for the renderer data layer (`@/db/*`).
//
// This module holds the primitives that the domain API modules build on:
// the in-memory mock database (dev/`VITE_ALLOW_MOCK_API` only), the Electron
// IPC helpers, id/format helpers and the localStorage fallbacks. Domain
// modules (and the legacy `api.ts` facade) import from here so we can split the
// former god-file without creating circular dependencies.

import { handleIpcResponse, requireElectron } from '@/utils/electron';
import { useAuthStore } from '@/store/useAuth';
import type {
  Product,
  Category,
  Customer,
  Order,
  InventoryMovement,
  HeldOrder,
  Expense,
  Profile,
  Supplier,
  SupplierPayment,
  PurchaseOrder,
  PurchaseOrderItem,
  OrderItem,
  Payment,
  SalesReturn,
  SalesReturnItem,
} from '@/types/database';

/** Audit uchun joriy foydalanuvchi (renderer Zustand — main `currentUser` ni almashtiradi) */
export function getActorUserIdForAudit(): string | null {
  try {
    const id = useAuthStore.getState().profile?.id;
    if (id != null && String(id).trim() !== '') return String(id).trim();
  } catch {
    // ignore
  }
  return null;
}

// ============================================================================
// MOCK IN-MEMORY DATABASE
// ============================================================================

// Load held orders from localStorage on initialization
export const loadHeldOrdersFromStorage = (): HeldOrder[] => {
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
export const saveHeldOrdersToStorage = (orders: HeldOrder[]) => {
  try {
    localStorage.setItem('pos_held_orders', JSON.stringify(orders));
  } catch (error) {
    console.error('Error saving held orders to storage:', error);
  }
};

export const mockDB = {
  products: [] as Product[],
  categories: [
    {
      id: 'cat-1',
      name: "Kategoriya yo'q",
      description: null,
      color: null,
      icon: null,
      parent_id: null,
      sort_order: 0,
      is_active: true,
      image_url: null,
      show_in_marketplace: true,
      created_at: new Date().toISOString(),
    },
    {
      id: 'cat-2',
      name: 'Ichimliklar',
      description: null,
      color: null,
      icon: null,
      parent_id: null,
      sort_order: 1,
      is_active: true,
      image_url: null,
      show_in_marketplace: true,
      created_at: new Date().toISOString(),
    },
    {
      id: 'cat-3',
      name: 'Mevalar',
      description: null,
      color: null,
      icon: null,
      parent_id: null,
      sort_order: 2,
      is_active: true,
      image_url: null,
      show_in_marketplace: true,
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

export const MAIN_WAREHOUSE_ID = 'main-warehouse-001';

export function hasPosApi(): boolean {
  // Prefer the actual injected preload API. This avoids false negatives in some builds.
  try {
    return !!requireElectron();
  } catch {
    return false;
  }
}

export async function ipc<T>(promise: Promise<any>): Promise<T> {
  return handleIpcResponse<T>(promise);
}

/** Unwrap `{ ok: true, data: T }` from auth/password-reset services. */
export function unwrapServiceData<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'ok' in raw && (raw as { ok?: boolean }).ok === true && 'data' in raw) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

let cachedDeviceId: string | null = null;

export async function getDeviceId(): Promise<string | null> {
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
export const ALLOW_MOCK_API = (import.meta as any)?.env?.VITE_ALLOW_MOCK_API === 'true';

// ============================================================================
// EXPENSES STORAGE (localStorage)
// ============================================================================

export const STORAGE_KEY_EXPENSES = 'pos_expenses';

// Load expenses from localStorage on initialization
export const loadExpensesFromStorage = (): Expense[] => {
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
export const saveExpensesToStorage = (expenses: Expense[]): void => {
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

export const generateId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export const generateUUID = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return generateId();
};

export const generateSKUHelper = (): string => {
  // Find the smallest missing numeric SKU: 1, 2, 3, ...
  const nums = mockDB.products
    .filter((p) => p.is_active !== false && p.is_active !== 0)
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

export const normalizeProductUnits = (product: Product): Product => {
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

export const delay = (ms: number = 100) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// DOMAIN STORAGE HELPERS (localStorage)
// ============================================================================
//
// These pure localStorage accessors are shared across domain modules (e.g. the
// supplier balance calculation reads purchase orders), so they live here to
// keep domain modules free of circular dependencies.

const STORAGE_KEY_SUPPLIERS = 'pos_suppliers';
const STORAGE_KEY_SUPPLIER_PAYMENTS = 'pos_supplier_payments';
const STORAGE_KEY_PURCHASE_ORDERS = 'pos_purchase_orders';
const STORAGE_KEY_PURCHASE_ORDER_ITEMS = 'pos_purchase_order_items';
const STORAGE_KEY_CUSTOMERS = 'pos_customers';
const STORAGE_KEY_ORDERS = 'pos_orders';
const STORAGE_KEY_ORDER_ITEMS = 'pos_order_items';
const STORAGE_KEY_PAYMENTS = 'pos_payments';
const STORAGE_KEY_SALES_RETURNS = 'pos_sales_returns';
const STORAGE_KEY_SALES_RETURN_ITEMS = 'pos_sales_return_items';

export const getStoredCustomers = (): Customer[] => {
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

export const saveCustomers = (customers: Customer[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify(customers));
  } catch (error) {
    console.error('Failed to save customers to localStorage:', error);
    throw new Error('Failed to save customer data');
  }
};

export const getStoredOrders = (): Order[] => {
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

export const saveOrders = (orders: Order[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(orders));
  } catch (error) {
    console.error('Failed to save orders to localStorage:', error);
    throw new Error('Failed to save order data');
  }
};

export const getStoredOrderItems = (): OrderItem[] => {
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

export const saveOrderItems = (items: OrderItem[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_ORDER_ITEMS, JSON.stringify(items));
  } catch (error) {
    console.error('Failed to save order items to localStorage:', error);
    throw new Error('Failed to save order items data');
  }
};

export const getStoredPayments = (): Payment[] => {
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

export const savePayments = (payments: Payment[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_PAYMENTS, JSON.stringify(payments));
  } catch (error) {
    console.error('Failed to save payments to localStorage:', error);
    throw new Error('Failed to save payments data');
  }
};

export const getStoredSalesReturns = (): SalesReturn[] => {
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

export const saveSalesReturns = (returns: SalesReturn[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_SALES_RETURNS, JSON.stringify(returns));
  } catch (error) {
    console.error('Failed to save sales returns to localStorage:', error);
    throw new Error('Failed to save sales returns data');
  }
};

export const getStoredSalesReturnItems = (): SalesReturnItem[] => {
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

export const saveSalesReturnItems = (items: SalesReturnItem[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_SALES_RETURN_ITEMS, JSON.stringify(items));
  } catch (error) {
    console.error('Failed to save sales return items to localStorage:', error);
    throw new Error('Failed to save sales return items data');
  }
};

// Get suppliers from localStorage
export const getStoredSuppliers = (): Supplier[] => {
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
export const saveSuppliers = (suppliers: Supplier[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_SUPPLIERS, JSON.stringify(suppliers));
  } catch (error) {
    console.error('Failed to save suppliers to localStorage:', error);
    throw new Error('Failed to save supplier data');
  }
};

export const getStoredSupplierPayments = (): SupplierPayment[] => {
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

export const saveSupplierPayments = (payments: SupplierPayment[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_SUPPLIER_PAYMENTS, JSON.stringify(payments));
  } catch (error) {
    console.error('Failed to save supplier payments to localStorage:', error);
    throw new Error('Failed to save supplier payment data');
  }
};

// Get purchase orders from localStorage
export const getStoredPurchaseOrders = (): PurchaseOrder[] => {
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
export const savePurchaseOrders = (orders: PurchaseOrder[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_PURCHASE_ORDERS, JSON.stringify(orders));
  } catch (error) {
    console.error('Failed to save purchase orders to localStorage:', error);
    throw new Error('Failed to save purchase order data');
  }
};

// Get purchase order items from localStorage
export const getStoredPurchaseOrderItems = (): PurchaseOrderItem[] => {
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
export const savePurchaseOrderItems = (items: PurchaseOrderItem[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY_PURCHASE_ORDER_ITEMS, JSON.stringify(items));
  } catch (error) {
    console.error('Failed to save purchase order items to localStorage:', error);
    throw new Error('Failed to save purchase order items data');
  }
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
