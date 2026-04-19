import { create } from 'zustand';

type ProductsListState = {
  queryKey: string;
  filtersQuery: string;
  page: number;
  pageSize: number;
  scrollTop: number;
  lastFocusedProductId: string | null;
  setQueryKey: (queryKey: string) => void;
  setFiltersQuery: (filtersQuery: string) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setScrollTop: (scrollTop: number) => void;
  setLastFocusedProductId: (productId: string | null) => void;
  resetForQuery: (queryKey: string) => void;
};

export const useProductsListStore = create<ProductsListState>((set) => ({
  queryKey: '',
  filtersQuery: '',
  page: 0,
  pageSize: 200,
  scrollTop: 0,
  lastFocusedProductId: null,
  setQueryKey: (queryKey) => set({ queryKey }),
  setFiltersQuery: (filtersQuery) => set({ filtersQuery }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize }),
  setScrollTop: (scrollTop) => set({ scrollTop }),
  setLastFocusedProductId: (productId) => set({ lastFocusedProductId: productId }),
  resetForQuery: (queryKey) =>
    set({
      queryKey,
      page: 0,
      scrollTop: 0,
      lastFocusedProductId: null,
    }),
}));
