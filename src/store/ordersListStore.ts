import { create } from 'zustand';

type OrdersListState = {
  queryKey: string;
  page: number;
  scrollTop: number;
  setQueryKey: (queryKey: string) => void;
  setPage: (page: number) => void;
  setScrollTop: (scrollTop: number) => void;
  resetForQuery: (queryKey: string) => void;
};

export const useOrdersListStore = create<OrdersListState>((set) => ({
  queryKey: '',
  page: 0,
  scrollTop: 0,
  setQueryKey: (queryKey) => set({ queryKey }),
  setPage: (page) => set({ page }),
  setScrollTop: (scrollTop) => set({ scrollTop }),
  resetForQuery: (queryKey) =>
    set({
      queryKey,
      page: 0,
      scrollTop: 0,
    }),
}));
