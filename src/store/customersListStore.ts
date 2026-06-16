import { create } from 'zustand';

type CustomersListState = {
  queryKey: string;
  scrollTop: number;
  setScrollTop: (scrollTop: number) => void;
  resetForQuery: (queryKey: string) => void;
};

export const useCustomersListStore = create<CustomersListState>((set) => ({
  queryKey: '',
  scrollTop: 0,
  setScrollTop: (scrollTop) => set({ scrollTop }),
  resetForQuery: (queryKey) =>
    set({
      queryKey,
      scrollTop: 0,
    }),
}));
