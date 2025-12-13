import { create } from 'zustand';
import type { POSState } from '@/types/pos';

interface POSStore {
  // UI State
  searchTerm: string;
  selectedCategory: string | null;
  holdOrderDialogOpen: boolean;
  paymentDialogOpen: boolean;
  customerDialogOpen: boolean;
  
  // Actions
  setSearchTerm: (term: string) => void;
  setSelectedCategory: (categoryId: string | null) => void;
  setHoldOrderDialogOpen: (open: boolean) => void;
  setPaymentDialogOpen: (open: boolean) => void;
  setCustomerDialogOpen: (open: boolean) => void;
  
  // Reset
  resetUI: () => void;
}

const initialState: Omit<POSStore, 'setSearchTerm' | 'setSelectedCategory' | 'setHoldOrderDialogOpen' | 'setPaymentDialogOpen' | 'setCustomerDialogOpen' | 'resetUI'> = {
  searchTerm: '',
  selectedCategory: null,
  holdOrderDialogOpen: false,
  paymentDialogOpen: false,
  customerDialogOpen: false,
};

export const usePOSStore = create<POSStore>((set) => ({
  ...initialState,

  setSearchTerm: (term: string) => {
    set({ searchTerm: term });
  },

  setSelectedCategory: (categoryId: string | null) => {
    set({ selectedCategory: categoryId });
  },

  setHoldOrderDialogOpen: (open: boolean) => {
    set({ holdOrderDialogOpen: open });
  },

  setPaymentDialogOpen: (open: boolean) => {
    set({ paymentDialogOpen: open });
  },

  setCustomerDialogOpen: (open: boolean) => {
    set({ customerDialogOpen: open });
  },

  resetUI: () => {
    set(initialState);
  },
}));








