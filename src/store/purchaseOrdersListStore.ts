import { create } from 'zustand';

type PurchaseOrdersListState = {
  queryKey: string;
  scrollTop: number;
  setScrollTop: (scrollTop: number) => void;
  resetForQuery: (queryKey: string) => void;
};

export const usePurchaseOrdersListStore = create<PurchaseOrdersListState>((set) => ({
  queryKey: '',
  scrollTop: 0,
  setScrollTop: (scrollTop) => set({ scrollTop }),
  resetForQuery: (queryKey) =>
    set({
      queryKey,
      scrollTop: 0,
    }),
}));
