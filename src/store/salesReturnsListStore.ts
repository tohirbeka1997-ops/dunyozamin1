import { create } from 'zustand';

type SalesReturnsListState = {
  queryKey: string;
  scrollTop: number;
  setScrollTop: (scrollTop: number) => void;
  resetForQuery: (queryKey: string) => void;
};

export const useSalesReturnsListStore = create<SalesReturnsListState>((set) => ({
  queryKey: '',
  scrollTop: 0,
  setScrollTop: (scrollTop) => set({ scrollTop }),
  resetForQuery: (queryKey) =>
    set({
      queryKey,
      scrollTop: 0,
    }),
}));
