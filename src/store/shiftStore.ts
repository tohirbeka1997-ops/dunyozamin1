import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Shift } from '@/types/shift';

interface ShiftStore {
  currentShift: Shift | null;
  pastShifts: Shift[];
  loading: boolean;

  openShift: (openingCash: number, userId: string) => void;
  closeShift: (
    closingCash: number,
    totals: { sales: number; refunds: number },
    userId: string
  ) => void;
  addSale: (amount: number) => void;
  addRefund: (amount: number) => void;
  loadFromStorage: () => void;
  resetAllShifts: () => void; // DEV only
}

const STORAGE_KEY = 'pos_shifts';

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export const useShiftStore = create<ShiftStore>()(
  persist(
    (set, get) => ({
      currentShift: null,
      pastShifts: [],
      loading: false,

      openShift: (openingCash: number, userId: string) => {
        const state = get();
        
        // Check if there's already an open shift
        if (state.currentShift) {
          throw new Error('Shift already open');
        }

        const newShift: Shift = {
          id: generateId(),
          opened_at: new Date().toISOString(),
          closed_at: null,
          opened_by: userId,
          closed_by: null,
          opening_cash: openingCash,
          closing_cash: null,
          total_sales: 0,
          total_refunds: 0,
          status: 'open',
        };

        set({ currentShift: newShift });
      },

      closeShift: (
        closingCash: number,
        totals: { sales: number; refunds: number },
        userId: string
      ) => {
        const state = get();
        
        if (!state.currentShift) {
          throw new Error('No open shift to close');
        }

        const closedShift: Shift = {
          ...state.currentShift,
          closed_at: new Date().toISOString(),
          closed_by: userId,
          closing_cash: closingCash,
          total_sales: totals.sales,
          total_refunds: totals.refunds,
          status: 'closed',
        };

        set({
          currentShift: null,
          pastShifts: [closedShift, ...state.pastShifts],
        });
      },

      addSale: (amount: number) => {
        const state = get();
        if (state.currentShift) {
          set({
            currentShift: {
              ...state.currentShift,
              total_sales: state.currentShift.total_sales + amount,
            },
          });
        }
      },

      addRefund: (amount: number) => {
        const state = get();
        if (state.currentShift) {
          set({
            currentShift: {
              ...state.currentShift,
              total_refunds: state.currentShift.total_refunds + amount,
            },
          });
        }
      },

      loadFromStorage: () => {
        // This is handled by persist middleware automatically
        // But we can add custom logic here if needed
      },

      resetAllShifts: () => {
        set({
          currentShift: null,
          pastShifts: [],
        });
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        currentShift: state.currentShift,
        pastShifts: state.pastShifts,
      }),
    }
  )
);








