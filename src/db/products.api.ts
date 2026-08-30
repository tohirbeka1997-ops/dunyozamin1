// Product domain: CRUD, images, barcodes/SKU, scale export, search.
// Split out of `api.ts`; shared infra/storage from `./internal`.

import { requireElectron } from '@/utils/electron';
import {
  MAIN_WAREHOUSE_ID,
  delay,
  generateId,
  generateSKUHelper,
  getActorUserIdForAudit,
  hasPosApi,
  ipc,
  mockDB,
  normalizeProductUnits,
} from './internal';
import type {
  Category,
  Product,
  InventoryMovement,
  ProductWithCategory,
} from '@/types/database';

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
    marketplace?: 'all' | 'online' | 'pos_only';
    sortBy?: 'name' | 'sku' | 'created_at' | 'current_stock' | 'sale_price';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    warehouse_id?: string | null;
  }
) => {
  if (hasPosApi()) {
    const api = requireElectron();
    const f: any = {};

    if (filters?.searchTerm) {
      const q = String(filters.searchTerm).trim();
      if (q) f.search = q;
    }
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

    if (filters?.marketplace && filters.marketplace !== 'all') {
      f.marketplace = filters.marketplace;
    }

    // If omitted, backend aggregates stock across all warehouses.
    if (filters?.warehouse_id) {
      f.warehouse_id = filters.warehouse_id;
    }

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
    const term = filters.searchTerm.toLowerCase().trim();
    if (term) {
      const termNorm = term.replace(/[\s\-_]/g, '');
      products = products.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        (p.barcode && p.barcode.toLowerCase().includes(term)) ||
        (String((p as { article?: string | null }).article || '')
          .toLowerCase()
          .replace(/[\s\-_]/g, '')
          .includes(termNorm)) ||
        String((p as { brand?: string | null }).brand || '').toLowerCase().includes(term)
      );
    }
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

/** Lightweight scan-index rows for POS barcode lookup (minimal joins). */
export type ProductScanIndexRow = Product & { cost_price?: number };

export const getProductsScanIndex = async (filters?: {
  warehouse_id?: string | null;
  limit?: number;
  offset?: number;
  status?: 'active' | 'inactive' | 'all';
}): Promise<ProductScanIndexRow[]> => {
  if (hasPosApi()) {
    const api = requireElectron();
    const f: Record<string, unknown> = {
      status: filters?.status || 'active',
      limit: Number.isFinite(Number(filters?.limit)) ? Number(filters?.limit) : 10000,
      offset: Number.isFinite(Number(filters?.offset)) ? Number(filters?.offset) : 0,
    };
    if (filters?.warehouse_id) f.warehouse_id = filters.warehouse_id;
    const listFn = api?.products?.listScanIndex;
    if (typeof listFn === 'function') {
      return ipc<ProductScanIndexRow[]>(listFn.call(api.products, f));
    }
    // Fallback for stale preload: use list with fields hint if backend supports it
    return ipc<ProductScanIndexRow[]>(
      api.products.list({ ...f, fields: 'scan' } as Record<string, unknown>),
    );
  }
  await delay();
  const offset = filters?.offset || 0;
  const limit = filters?.limit || 10000;
  const status = filters?.status || 'active';
  const products = mockDB.products
    .filter((p) => {
      if (status === 'active') return p.is_active;
      if (status === 'inactive') return !p.is_active;
      return true;
    })
    .slice(offset, offset + limit)
    .map((p) => {
      const normalized = normalizeProductUnits(p);
      const cost = Number((normalized as { purchase_price?: number }).purchase_price ?? 0) || 0;
      return {
        ...normalized,
        cost_price: cost,
        purchase_price: cost,
      } as ProductScanIndexRow;
    });
  return products;
};

export type ResolveScanResult = {
  product: ProductWithCategory;
  matchKind: 'barcode' | 'sku';
  matchedKey: string;
} | null;

export const resolveProductScan = async (
  keys: string[],
  opts?: { warehouse_id?: string | null },
): Promise<ResolveScanResult> => {
  const cleanKeys = [...new Set(keys.map((k) => String(k || '').trim()).filter(Boolean))];
  if (!cleanKeys.length) return null;
  if (hasPosApi()) {
    const api = requireElectron();
    const resolveFn = api?.products?.resolveScan;
    if (typeof resolveFn === 'function') {
      try {
        const result = await ipc<ResolveScanResult>(resolveFn.call(api.products, cleanKeys, opts || {}));
        if (!result || typeof result !== 'object' || !('product' in result)) return null;
        return result;
      } catch (error: any) {
        if (error?.code === 'NOT_FOUND') return null;
        throw error;
      }
    }
  }
  for (const key of cleanKeys) {
    const looksLikeBarcode = key.length >= 8;
    let product: ProductWithCategory | null = null;
    if (looksLikeBarcode) {
      product = await getProductByBarcode(key);
      if (product) return { product, matchKind: 'barcode', matchedKey: key };
      if (key.length <= 8) {
        product = await getProductBySku(key);
        if (product) return { product, matchKind: 'sku', matchedKey: key };
      }
    } else {
      product = await getProductBySku(key);
      if (product) return { product, matchKind: 'sku', matchedKey: key };
      product = await getProductByBarcode(key);
      if (product) return { product, matchKind: 'barcode', matchedKey: key };
    }
  }
  const nameTerm = cleanKeys.join(' ').trim();
  if (nameTerm.length >= 2) {
    const hits = await searchProducts(nameTerm, { status: 'all' });
    if (hits.length === 1) {
      return { product: hits[0], matchKind: 'sku', matchedKey: nameTerm };
    }
    const exact = hits.find((p) => String(p.name || '').toLowerCase() === nameTerm.toLowerCase());
    if (exact) return { product: exact, matchKind: 'sku', matchedKey: nameTerm };
  }
  return null;
};

export const searchProducts = async (
  searchTerm: string,
  opts?: { warehouse_id?: string | null; status?: 'active' | 'inactive' | 'all' }
) => {
  const term = String(searchTerm || '').trim().toLowerCase();
  const prioritize = (items: ProductWithCategory[]) => {
    const getRank = (p: ProductWithCategory) => {
      const name = String(p.name || '').toLowerCase();
      const skuRaw = String(p.sku || '').toLowerCase();
      const sku = skuRaw.replace(/^0+/, '');
      const barcode = String(p.barcode || '').toLowerCase();
      const article = String((p as { article?: string | null }).article || '')
        .toLowerCase()
        .replace(/[\s\-_]/g, '');
      const brand = String((p as { brand?: string | null }).brand || '').toLowerCase();
      const termSku = term.replace(/^0+/, '');
      const termNorm = term.replace(/[\s\-_]/g, '');
      const skuExact = skuRaw === term || (termSku && sku === termSku);
      const skuStarts = skuRaw.startsWith(term) || (termSku && sku.startsWith(termSku));
      const skuContains = skuRaw.includes(term) || (termSku && sku.includes(termSku));
      const articleExact = termNorm.length > 0 && article === termNorm;
      const articleStarts = termNorm.length > 0 && article.startsWith(termNorm);
      const articleContains = termNorm.length > 0 && article.includes(termNorm);
      if (term && (skuExact || barcode === term || articleExact)) return 0;
      if (term && name === term) return 1;
      if (term && (skuStarts || barcode.startsWith(term) || articleStarts)) return 2;
      if (term && name.startsWith(term)) return 3;
      if (term && (skuContains || barcode.includes(term) || articleContains || brand.includes(term))) return 4;
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
        status: opts?.status || 'active',
        ...(opts?.warehouse_id ? { warehouse_id: opts.warehouse_id } : {}),
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
  const status = opts?.status || 'active';
  const products = mockDB.products
    .filter(p => {
      if (status === 'active' && !p.is_active) return false;
      if (status === 'inactive' && p.is_active) return false;
      const termMatch =
      p.name.toLowerCase().includes(term) ||
       p.sku.toLowerCase().includes(term) ||
       (p.barcode && p.barcode.toLowerCase().includes(term)) ||
       String((p as { article?: string | null }).article || '')
         .toLowerCase()
         .replace(/[\s\-_]/g, '')
         .includes(term.replace(/[\s\-_]/g, '')) ||
       String((p as { brand?: string | null }).brand || '').toLowerCase().includes(term);
      return termMatch;
    })
    .slice(0, 20);

  const mapped = products.map(p => ({
    ...normalizeProductUnits(p),
    category: mockDB.categories.find(c => c.id === p.category_id) || null,
  })) as ProductWithCategory[];
  return term ? prioritize(mapped) : mapped;
};

export const searchProductsScreen = async (
  searchTerm: string,
  opts?: { limit?: number; warehouse_id?: string | null }
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
        ...(opts?.warehouse_id ? { warehouse_id: opts.warehouse_id } : {}),
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
    const created = await ipc<Product>(api.products.create(product, getActorUserIdForAudit()));

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
    return ipc<Product>(api.products.update(id, updates, getActorUserIdForAudit()));
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

export type BulkPriceField = 'sale' | 'purchase' | 'master';
export type BulkPriceMode = 'percent' | 'amount' | 'set' | 'round';

export type BulkPricePayload = {
  product_ids: string[];
  field?: BulkPriceField;
  mode: BulkPriceMode;
  percent?: number;
  amount?: number;
  exact_price?: number;
  round_to?: number;
  reason?: string;
};

export type BulkPriceChange = {
  product_id: string;
  name: string;
  sku: string;
  old_price: number;
  new_price: number;
};

export type BulkPriceResult = {
  batch_id: string;
  field: BulkPriceField;
  price_type: string;
  mode: BulkPriceMode;
  requested: number;
  count: number;
  changes: BulkPriceChange[];
};

export type LastBulkPriceBatch = {
  batch_id: string;
  changed_at: string;
  reason: string | null;
  count: number;
} | null;

/** Ommaviy narx yangilash — tanlangan mahsulotlarga bitta narx amalini qo'llaydi. */
export const bulkAdjustPrices = async (payload: BulkPricePayload): Promise<BulkPriceResult> => {
  if (hasPosApi()) {
    const api = requireElectron();
    const result = await ipc<BulkPriceResult>(
      api.products.bulkAdjustPrices(payload, getActorUserIdForAudit())
    );
    productUpdateEmitter.emit();
    return result;
  }
  throw new Error('Ommaviy narx yangilash faqat ish stoli ilovasida ishlaydi');
};

/** Oxirgi (yoki berilgan) ommaviy narx amalini orqaga qaytarish. */
export const undoBulkPriceUpdate = async (
  batchId?: string | null
): Promise<{ batch_id: string; reverted: number; skipped: number }> => {
  if (hasPosApi()) {
    const api = requireElectron();
    const result = await ipc<{ batch_id: string; reverted: number; skipped: number }>(
      api.products.undoBulkPriceUpdate(batchId ?? null, getActorUserIdForAudit())
    );
    productUpdateEmitter.emit();
    return result;
  }
  throw new Error('Ommaviy narx yangilash faqat ish stoli ilovasida ishlaydi');
};

/** Undo tugmasini yoqish uchun oxirgi ommaviy amal haqida ma'lumot. */
export const getLastBulkPriceBatch = async (): Promise<LastBulkPriceBatch> => {
  if (hasPosApi()) {
    const api = requireElectron();
    const getter = api?.products?.getLastBulkPriceBatch;
    if (typeof getter !== 'function') return null;
    return ipc<LastBulkPriceBatch>(getter.call(api.products));
  }
  return null;
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
    const res = await ipc<{ success: boolean; softDeleted?: boolean; hardDeleted?: boolean }>(
      api.products.delete(id, getActorUserIdForAudit())
    );
    productUpdateEmitter.emit();
    return res;
  }
  await delay();
  const index = mockDB.products.findIndex(p => p.id === id);
  if (index === -1) throw new Error('Product not found');
  
  // Hard delete in mock mode (for wrong entries)
  mockDB.products.splice(index, 1);
  productUpdateEmitter.emit();
  return { success: true, softDeleted: false, hardDeleted: true };
};

export const getProductDeleteImpact = async (id: string) => {
  if (hasPosApi()) {
    const api = requireElectron();
    if (typeof (api.products as any).getDeleteImpact === 'function') {
      return ipc<{
        product_id: string;
        name?: string;
        sku?: string;
        softDelete: boolean;
        hardDelete: boolean;
        refs?: Record<string, number>;
      }>((api.products as any).getDeleteImpact(id));
    }
  }
  return { product_id: id, softDelete: false, hardDelete: true, refs: {} };
};

