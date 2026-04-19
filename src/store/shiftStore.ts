/**
 * Shift Store (Zustand) - Manages POS shift state and sales tracking
 */

import { create } from 'zustand';
import type { Shift } from '@/types/database';
import { createShift, generateShiftNumber, closeShift as closeShiftAPI, getActiveShift, getCurrentShift } from '@/db/api';

interface ShiftState {
  currentShift: Shift | null;
  sales: any[]; // Sale records for the current shift
  refunds: any[]; // Refund records for the current shift
  
  setCurrentShift: (shift: Shift | null) => void;
  openShift: (openingCash: number, cashierId: string) => Promise<void>;
  closeShift: (closingCash: number, totals: { sales: number; refunds: number }, cashierId: string) => Promise<void>;
  addSale: (sale: any) => void;
  addRefund: (refund: any) => void;
  loadFromStorage: () => void;
  syncFromDatabase: (cashierId: string) => Promise<void>;
}

export const useShiftStore = create<ShiftState>((set, get) => ({
  currentShift: null,
  sales: [],
  refunds: [],

  setCurrentShift: (shift: Shift | null) => {
    set({ currentShift: shift });
    // Persist to storage
    try {
      if (shift) {
        localStorage.setItem('current_shift', JSON.stringify(shift));
      } else {
        localStorage.removeItem('current_shift');
      }
    } catch (error) {
      console.warn('Failed to save current shift:', error);
    }
  },

  openShift: async (openingCash: number, cashierId: string, warehouseId?: string) => {
    try {
      let newShift = null;

      // CRITICAL: Use backend service via IPC (window.api or window.posApi)
      if (typeof window !== 'undefined') {
        // SINGLE WAREHOUSE SYSTEM: Always use main-warehouse-001
        const MAIN_WAREHOUSE_ID = 'main-warehouse-001';
        const finalWarehouseId = MAIN_WAREHOUSE_ID;
        console.log('[ShiftStore] Using main warehouse:', finalWarehouseId);

        // Try window.posApi.shifts.open (Electron)
        if ((window as any).posApi?.shifts?.open) {
          console.log('[ShiftStore] Opening shift via window.posApi...', { cashierId, warehouseId: finalWarehouseId });
          const response = await (window as any).posApi.shifts.open({
            cashier_id: cashierId,
            user_id: cashierId,
            warehouse_id: finalWarehouseId,
            opening_cash: openingCash,
          });
          console.log('[ShiftStore] Response from backend:', response);
          
          // posApi.invoke() always returns { success, data | error }
          if (response && response.success === false) {
            const err = response.error;
            const msg =
              (typeof err === 'string' && err) ||
              err?.message ||
              err?.error ||
              response.message ||
              'Failed to open shift';
            throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
          }

          // Unwrap { success: true, data }
          newShift = response?.data ?? response;
          console.log('[ShiftStore] ✅ Shift opened via window.posApi:', newShift);
        }
        // Fallback to window.api.shifts.open
        else if ((window as any).api?.shifts?.open) {
          console.log('[ShiftStore] Opening shift via window.api...', { cashierId, warehouseId: finalWarehouseId });
          const response = await (window as any).api.shifts.open({
            cashier_id: cashierId,
            user_id: cashierId,
            warehouse_id: finalWarehouseId,
            opening_cash: openingCash,
          });
          console.log('[ShiftStore] Response from backend:', response);
          
          // Handle IPC response format
          if (response && response.success === false) {
            const errorMsg = response.error || response.message || 'Failed to open shift';
            throw new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
          }
          
          // Handle error object format (from Electron IPC)
          if (response && response.code) {
            throw new Error(response.message || response.code);
          }
          
          newShift = response;
          console.log('[ShiftStore] ✅ Shift opened via window.api:', newShift);
        }
      }

      // Fallback to mock API if backend not available (development mode)
      if (!newShift) {
        console.warn('[ShiftStore] Backend not available, using mock API');
        const shiftNumber = await generateShiftNumber();
        const MAIN_WAREHOUSE_ID = 'main-warehouse-001';
        newShift = await createShift({
          shift_number: shiftNumber,
          cashier_id: cashierId,
          user_id: cashierId,
          warehouse_id: MAIN_WAREHOUSE_ID, // SINGLE WAREHOUSE SYSTEM
          opened_at: new Date().toISOString(),
          opening_cash: openingCash,
          status: 'open',
          notes: null,
        });
      }

      if (!newShift) {
        console.error('[ShiftStore] ❌ newShift is null/undefined');
        throw new Error('Smenani ochib bo\'lmadi: Backend javob qaytarmadi');
      }

      if (!newShift.id) {
        console.error('[ShiftStore] ❌ newShift has no ID:', newShift);
        console.error('[ShiftStore] newShift keys:', Object.keys(newShift));
        throw new Error('Smenani ochib bo\'lmadi: Smena ID topilmadi. Iltimos, qayta urinib ko\'ring.');
      }

      console.log('[ShiftStore] ✅ Shift opened successfully with ID:', newShift.id);
      set({ currentShift: newShift });
      
      // Persist to storage
      try {
        localStorage.setItem('current_shift', JSON.stringify(newShift));
      } catch (error) {
        console.warn('Failed to save current shift:', error);
      }

      return newShift;
    } catch (error) {
      console.error('Error opening shift:', error);
      throw error;
    }
  },

  closeShift: async (closingCash: number, totals: { sales: number; refunds: number }, cashierId: string) => {
    const { currentShift } = get();
    if (!currentShift) {
      throw new Error('No active shift to close');
    }

    console.log('[ShiftStore] closeShift called with:', {
      currentShift_id: currentShift.id,
      currentShift_status: currentShift.status,
      currentShift_keys: Object.keys(currentShift),
      closingCash,
      totals,
      cashierId
    });

    if (!currentShift.id) {
      console.error('[ShiftStore] ❌ currentShift has no ID!', currentShift);
      throw new Error('Smenani yopib bo\'lmadi: Smena ma\'lumotlari noto\'g\'ri. Iltimos, sahifani yangilang.');
    }

    // Check if shift is already closed
    if (currentShift.status === 'closed') {
      console.warn('[ShiftStore] ⚠️ Shift is already closed');
      throw new Error('Bu smena allaqachon yopilgan');
    }

    try {
      // Validate that closeShiftAPI is a function
      if (typeof closeShiftAPI !== 'function') {
        throw new Error('closeShift API function is not available');
      }

      const expectedCash = currentShift.opening_cash + totals.sales - totals.refunds;
      const cashDifference = closingCash - expectedCash;

      console.log('[ShiftStore] Calling closeShiftAPI with shiftId:', currentShift.id);
      const closedShift = await closeShiftAPI(currentShift.id, closingCash);
      
      // Update the shift with closing information
      const updatedShift: Shift = {
        ...currentShift,
        closed_at: new Date().toISOString(),
        closing_cash: closingCash,
        expected_cash: expectedCash,
        cash_difference: cashDifference,
        status: 'closed',
      };

      set({ currentShift: null });
      
      // Clear storage
      try {
        localStorage.removeItem('current_shift');
        localStorage.removeItem('shift_sales');
        localStorage.removeItem('shift_refunds');
      } catch (error) {
        console.warn('Failed to clear shift storage:', error);
      }
    } catch (error) {
      console.error('Error closing shift:', error);
      throw error;
    }
  },

  addSale: (sale: any) => {
    const { sales } = get();
    const updated = [...sales, { ...sale, timestamp: new Date().toISOString() }];
    set({ sales: updated });
    
    // Update current shift total_sales if it exists
    const { currentShift } = get();
    if (currentShift) {
      const totalSales = updated.reduce((sum, s) => sum + (s.amount || 0), 0);
      set({
        currentShift: {
          ...currentShift,
          // Note: Shift type doesn't have total_sales, but we track it in state
        },
      });
    }
    
    // Persist to storage
    try {
      localStorage.setItem('shift_sales', JSON.stringify(updated));
    } catch (error) {
      console.warn('Failed to save shift sales:', error);
    }
  },

  addRefund: (refund: any) => {
    const { refunds } = get();
    const updated = [...refunds, { ...refund, timestamp: new Date().toISOString() }];
    set({ refunds: updated });
    
    // Persist to storage
    try {
      localStorage.setItem('shift_refunds', JSON.stringify(updated));
    } catch (error) {
      console.warn('Failed to save shift refunds:', error);
    }
  },

  loadFromStorage: () => {
    // Load current shift and sales from localStorage (fallback)
    try {
      const storedShift = localStorage.getItem('current_shift');
      const storedSales = localStorage.getItem('shift_sales');
      const storedRefunds = localStorage.getItem('shift_refunds');
      
      if (storedShift) {
        const shift = JSON.parse(storedShift);
        set({ currentShift: shift });
      }
      
      if (storedSales) {
        const sales = JSON.parse(storedSales);
        set({ sales });
      }

      if (storedRefunds) {
        const refunds = JSON.parse(storedRefunds);
        set({ refunds });
      }
    } catch (error) {
      console.warn('Failed to load shift from storage:', error);
    }
  },

  syncFromDatabase: async (cashierId: string) => {
    // CRITICAL: Sync shift state from database (source of truth)
    // This ensures UI reflects real database status after page refresh
    try {
      console.log('🔄 Syncing shift state from database for user:', cashierId);
      
      if (!cashierId) {
        console.warn('⚠️ No cashierId provided, clearing shift state');
        set({ currentShift: null });
        return;
      }

      // Get shift for specific user
      const activeShift = await getCurrentShift(cashierId);
      
      if (activeShift && activeShift.id) {
        console.log('✅ Found active shift in database:', activeShift.id);
        set({ currentShift: activeShift });
        
        // Also persist to localStorage for offline support
        try {
          localStorage.setItem('current_shift', JSON.stringify(activeShift));
        } catch (error) {
          console.warn('Failed to save active shift to localStorage:', error);
        }
      } else {
        console.log('ℹ️ No active shift found in database');
        set({ currentShift: null });
        
        // Clear localStorage if no shift in database
        try {
          localStorage.removeItem('current_shift');
        } catch (error) {
          console.warn('Failed to clear shift from localStorage:', error);
        }
      }
    } catch (error) {
      console.error('Error syncing shift from database:', error);
      // On error, keep current state (don't clear it)
    }
  },
}));

