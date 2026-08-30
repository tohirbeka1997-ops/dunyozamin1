import { create } from 'zustand';

type SuppliersListState = {
  queryKey: string;
  scrollTop: number;
  setScrollTop: (scrollTop: number) => void;
  resetForQuery: (queryKey: string) => void;
};

export const useSuppliersListStore = create<SuppliersListState>((set) => ({
  queryKey: '',
  scrollTop: 0,
  setScrollTop: (scrollTop) => set({ scrollTop }),
  resetForQuery: (queryKey) =>
    set({
      queryKey,
      scrollTop: 0,
    }),
}));
