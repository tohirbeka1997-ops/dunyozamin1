import { create } from 'zustand';

type InventoryListState = {
  queryKey: string;
  scrollTop: number;
  setScrollTop: (scrollTop: number) => void;
  resetForQuery: (queryKey: string) => void;
};

export const useInventoryListStore = create<InventoryListState>((set) => ({
  queryKey: '',
  scrollTop: 0,
  setScrollTop: (scrollTop) => set({ scrollTop }),
  resetForQuery: (queryKey) =>
    set({
      queryKey,
      scrollTop: 0,
    }),
}));
