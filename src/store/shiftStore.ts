import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '@/lib/supabase';
import type { Shift } from '@/types/shift';

interface ShiftStore {
  currentShift: Shift | null;
  pastShifts: Shift[];
  loading: boolean;

  openShift: (openingCash: number, userId: string) => Promise<void>;
  closeShift: (
    closingCash: number,
    totals: { sales: number; refunds: number },
    userId: string
  ) => Promise<void>;
  addSale: (amount: number) => void;
  addRefund: (amount: number) => void;
  loadActiveShift: (userId: string) => Promise<void>;
  loadFromStorage: () => void;
  resetAllShifts: () => void; // DEV only
}

const STORAGE_KEY = 'pos_shifts';

/**
 * Get store_id for user
 * Tries store_members first, then falls back to first store
 */
const getStoreIdForUser = async (userId: string): Promise<string> => {
  // Try to get store_id from store_members
  const { data: memberData } = await supabase
    .from('store_members')
    .select('store_id')
    .eq('user_id', userId)
    .limit(1)
    .single();

  if (memberData?.store_id) {
    return memberData.store_id;
  }

  // Fallback: get first store
  const { data: storeData } = await supabase
    .from('stores')
    .select('id')
    .limit(1)
    .single();

  if (storeData?.id) {
    return storeData.id;
  }

  throw new Error('No store found. Please create a store first.');
};


export const useShiftStore = create<ShiftStore>()(
  persist(
    (set, get) => ({
      currentShift: null,
      pastShifts: [],
      loading: false,

      loadActiveShift: async (userId: string) => {
        set({ loading: true });
        try {
          // Fetch active shift from Supabase with store_id (CRITICAL: store_id must be explicitly included)
          // Using explicit field list ensures store_id is NEVER omitted
          const { data, error } = await supabase
            .from('shifts')
            .select('id, store_id, location_id, opened_by, opened_at, closed_at, opening_cash, closing_cash, status, notes')
            .eq('opened_by', userId)
            .eq('status', 'open')
            .order('opened_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          
          // DEBUG: Log query result to verify store_id is present
          console.log('[ShiftStore] loadActiveShift query result:', { 
            hasData: !!data, 
            hasStoreId: !!data?.store_id,
            storeId: data?.store_id,
            error: error?.message,
            fullData: data 
          });
          
          console.log('[ShiftStore] loadActiveShift query result:', { data, error });

          if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
            console.error('[ShiftStore] Error loading active shift:', error);
            throw error;
          }

          if (data) {
            // Validate store_id exists (CRITICAL)
            if (!data.store_id) {
              console.error('[ShiftStore] Shift from database missing store_id. Full data:', JSON.stringify(data, null, 2));
              throw new Error('Shift in database is missing store_id. Please contact administrator.');
            }

            // Map database shift to frontend Shift type
            const shift: Shift = {
              id: data.id,
              store_id: data.store_id, // CRITICAL: include store_id (validated above)
              location_id: data.location_id || null,
              opened_at: data.opened_at,
              closed_at: data.closed_at || null,
              opened_by: data.opened_by, // Use opened_by from database
              closed_by: null, // Not in DB schema, but in type
              opening_cash: Number(data.opening_cash),
              closing_cash: data.closing_cash ? Number(data.closing_cash) : null,
              total_sales: 0, // Will be calculated from orders
              total_refunds: 0, // Will be calculated from returns
              status: data.status as 'open' | 'closed',
            };

            // DEBUG: Log loaded shift to confirm store_id is present
            console.log('[ShiftStore] Loaded active shift:', { 
              id: shift.id, 
              store_id: shift.store_id, 
              status: shift.status,
              location_id: shift.location_id,
              fullShift: shift
            });
            set({ currentShift: shift, loading: false });
          } else {
            console.log('[ShiftStore] No active shift found');
            set({ currentShift: null, loading: false });
          }
        } catch (error) {
          console.error('[ShiftStore] Failed to load active shift:', error);
          set({ currentShift: null, loading: false });
        }
      },

      openShift: async (openingCash: number, userId: string) => {
        const state = get();
        
        // Check if there's already an open shift
        if (state.currentShift) {
          throw new Error('Shift already open');
        }

        set({ loading: true });

        try {
          // Get store_id for user
          const storeId = await getStoreIdForUser(userId);

          // Create shift in Supabase - EXACT schema match
          const { data, error } = await supabase
            .from('shifts')
            .insert({
              store_id: storeId,
              opened_by: userId,
              opened_at: new Date().toISOString(),
              status: 'open',
              opening_cash: openingCash,
            })
            .select('id, store_id, location_id, opened_by, opened_at, closed_at, opening_cash, closing_cash, status')
            .single();

          if (error) {
            console.error('[ShiftStore] Error creating shift:', error);
            throw new Error(`Failed to create shift: ${error.message}`);
          }

          if (!data) {
            throw new Error('Failed to create shift: No data returned');
          }

          // Validate store_id exists
          if (!data.store_id) {
            console.error('[ShiftStore] Created shift missing store_id:', data);
            throw new Error('Failed to create shift: store_id is missing. Please contact administrator.');
          }

          // Map database shift to frontend Shift type
          const newShift: Shift = {
            id: data.id,
            store_id: data.store_id, // CRITICAL: include store_id (validated above)
            location_id: data.location_id || null,
            opened_at: data.opened_at,
            closed_at: data.closed_at || null,
            opened_by: data.opened_by, // Use opened_by from database
            closed_by: null,
            opening_cash: Number(data.opening_cash),
            closing_cash: data.closing_cash ? Number(data.closing_cash) : null,
            total_sales: 0,
            total_refunds: 0,
            status: data.status as 'open' | 'closed',
          };

          console.log('[ShiftStore] Shift opened:', { 
            id: newShift.id, 
            store_id: newShift.store_id, 
            status: newShift.status,
            location_id: newShift.location_id 
          });
          set({ currentShift: newShift, loading: false });
        } catch (error) {
          console.error('[ShiftStore] Failed to open shift:', error);
          set({ loading: false });
          throw error;
        }
      },

      closeShift: async (
        closingCash: number,
        totals: { sales: number; refunds: number },
        userId: string
      ) => {
        const state = get();
        
        if (!state.currentShift) {
          throw new Error('No open shift to close');
        }

        set({ loading: true });

        try {
          // Update shift in Supabase
          const { error } = await supabase
            .from('shifts')
            .update({
              closed_at: new Date().toISOString(),
              closing_cash: closingCash,
              status: 'closed',
              notes: `Sales: ${totals.sales}, Refunds: ${totals.refunds}`,
            })
            .eq('id', state.currentShift.id);

          if (error) {
            console.error('[ShiftStore] Error closing shift:', error);
            throw new Error(`Failed to close shift: ${error.message}`);
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

          console.log('[ShiftStore] Shift closed:', closedShift);
          set({
            currentShift: null,
            pastShifts: [closedShift, ...state.pastShifts],
            loading: false,
          });
        } catch (error) {
          console.error('[ShiftStore] Failed to close shift:', error);
          set({ loading: false });
          throw error;
        }
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
        // But we need to validate that persisted shift has store_id
        const state = get();
        if (state.currentShift) {
          console.log('[ShiftStore] loadFromStorage - checking persisted shift:', {
            id: state.currentShift.id,
            hasStoreId: !!state.currentShift.store_id,
            storeId: state.currentShift.store_id
          });
          
          if (!state.currentShift.store_id) {
            console.warn('[ShiftStore] Persisted shift missing store_id, clearing it. Full shift:', JSON.stringify(state.currentShift, null, 2));
            // Clear invalid shift - component should call loadActiveShift to reload from database
            set({ currentShift: null });
          }
        }
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








