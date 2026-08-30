import { create } from 'zustand';
import type { Category, ProductWithCategory } from '@/types/database';

const PRODUCTS_CACHE_TTL_MS = 90_000;

export type ProductsListCache = {
  queryKey: string;
  products: ProductWithCategory[];
  categories: Category[];
  page: number;
  hasMore: boolean;
  cachedAt: number;
};

type ProductsListState = {
  queryKey: string;
  filtersQuery: string;
  page: number;
  pageSize: number;
  scrollTop: number;
  lastFocusedProductId: string | null;
  productsCache: ProductsListCache | null;
  setQueryKey: (queryKey: string) => void;
  setFiltersQuery: (filtersQuery: string) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setScrollTop: (scrollTop: number) => void;
  setLastFocusedProductId: (productId: string | null) => void;
  setProductsCache: (cache: ProductsListCache) => void;
  getFreshProductsCache: (queryKey: string) => ProductsListCache | null;
  resetForQuery: (queryKey: string) => void;
};

export const useProductsListStore = create<ProductsListState>((set, get) => ({
  queryKey: '',
  filtersQuery: '',
  page: 0,
  pageSize: 200,
  scrollTop: 0,
  lastFocusedProductId: null,
  productsCache: null,
  setQueryKey: (queryKey) => set({ queryKey }),
  setFiltersQuery: (filtersQuery) => set({ filtersQuery }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize }),
  setScrollTop: (scrollTop) => set({ scrollTop }),
  setLastFocusedProductId: (productId) => set({ lastFocusedProductId: productId }),
  setProductsCache: (cache) => set({ productsCache: cache }),
  getFreshProductsCache: (queryKey) => {
    const cache = get().productsCache;
    if (!cache || cache.queryKey !== queryKey) return null;
    if (Date.now() - cache.cachedAt > PRODUCTS_CACHE_TTL_MS) return null;
    return cache;
  },
  resetForQuery: (queryKey) =>
    set({
      queryKey,
      page: 0,
      scrollTop: 0,
      lastFocusedProductId: null,
    }),
}));

export { PRODUCTS_CACHE_TTL_MS };
