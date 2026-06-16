// Catalog metadata domain: categories + promotions. Split out of `api.ts`.
// Shared mock DB and IPC helpers come from `./internal`.

import { requireElectron } from '@/utils/electron';
import { delay, generateId, hasPosApi, ipc, mockDB } from './internal';
import type { Category, Promotion, PromotionWithDetails, CartItem, Product } from '@/types/database';

// ============================================================================
// CATEGORY FUNCTIONS
// ============================================================================

export const getCategories = async (opts?: { includeInactive?: boolean }) => {
  if (hasPosApi()) {
    const api = requireElectron();
    const filters = opts?.includeInactive ? {} : { is_active: true };
    return ipc<Category[]>(api.categories.list(filters));
  }
  await delay();
  let rows = [...mockDB.categories] as Category[];
  if (!opts?.includeInactive) {
    rows = rows.filter((c) => (c as Category).is_active !== false);
  }
  return rows;
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
  if (hasPosApi()) {
    const api = requireElectron();
    const result = await ipc<{ count?: number } | number>(
      api.products.count({
        category_id: categoryId,
        status: 'all',
        include_subcategories: true,
      })
    );
    if (typeof result === 'number') return result;
    return Number((result as any)?.count || 0);
  }
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
  if (hasPosApi()) {
    const api = requireElectron();
    const rows = await ipc<Product[]>(
      api.products.list({
        category_id: categoryId,
        status: 'all',
        limit: 5000,
        offset: 0,
        include_subcategories: true,
      })
    );
    return Array.isArray(rows) ? rows : [];
  }
  await delay();
  return mockDB.products.filter(p => p.category_id === categoryId) as Product[];
};
