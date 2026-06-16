// Inventory: stock levels, warehouses, movements, price tiers, adjustments, product history.
// Split out of `api.ts`; shared infra/storage from `./internal`.

import { requireElectron } from '@/utils/electron';
import { fetchCachedProductTierPrice, invalidateTierPriceCache } from '@/lib/tierPriceCache';
import { productUpdateEmitter, getProducts } from './products.api';
import {
  MAIN_WAREHOUSE_ID,
  delay,
  generateId,
  hasPosApi,
  ipc,
  mockDB,
} from './internal';
import type {
  Product,
  InventoryMovement,
  ProductWithCategory,
} from '@/types/database';

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
  if (hasPosApi()) {
    const api = requireElectron();
    const rows = await ipc<ProductWithCategory[]>(
      api.products.list({
        status: 'active',
        stock_filter: 'low',
        sort_by: 'name',
        sort_order: 'ASC',
        limit: 5000,
        offset: 0,
      })
    );
    return Array.isArray(rows) ? rows : [];
  }

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
      backendFilters.date_from = String(filters.startDate).slice(0, 10);
    }
    if (filters?.endDate) {
      // Kun filtri `inventory.getMoves` da Asia/Tashkent bo‘yicha (serverda _tzDateExpr)
      backendFilters.date_to = String(filters.endDate).slice(0, 10);
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
    return fetchCachedProductTierPrice(payload, () =>
      ipc<number | null>(api.pricing.getPrice(payload))
    );
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
    const result = await ipc<any>(api.pricing.setPrice(payload));
    invalidateTierPriceCache({
      product_id: payload.product_id,
      tier_id: payload.tier_id,
      currency: payload.currency,
      unit: payload.unit,
    });
    return result;
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
