import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InventoryMovement } from '@/types/inventory';

interface InventoryState {
  movements: InventoryMovement[];
  loading: boolean;

  // Actions
  loadFromStorage: () => void;
  addMovement: (movement: Omit<InventoryMovement, 'id' | 'created_at'>) => void;
  resetInventory: () => void; // dev helper

  // Derived helpers
  getCurrentStockByProductId: (productId: string) => number;
  getMovementsByProductId: (productId: string) => InventoryMovement[];
}

const STORAGE_KEY = 'pos_inventory_movements';

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export const useInventoryStore = create<InventoryState>()(
  persist(
    (set, get) => ({
      movements: [],
      loading: false,

      loadFromStorage: () => {
        // This is handled by persist middleware automatically
        // But we can add custom logic here if needed
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed?.state?.movements) {
              set({ movements: parsed.state.movements });
            }
          }
        } catch (error) {
          console.warn('Failed to load inventory from storage:', error);
          set({ movements: [] });
        }
      },

      addMovement: (movement: Omit<InventoryMovement, 'id' | 'created_at'>) => {
        const newMovement: InventoryMovement = {
          ...movement,
          id: generateId(),
          created_at: new Date().toISOString(),
        };

        set((state) => ({
          movements: [...state.movements, newMovement],
        }));
      },

      getCurrentStockByProductId: (productId: string) => {
        const state = get();
        const productMovements = state.movements.filter(
          (m) => m.product_id === productId
        );
        return productMovements.reduce((sum, m) => sum + m.quantity, 0);
      },

      getMovementsByProductId: (productId: string) => {
        const state = get();
        return state.movements
          .filter((m) => m.product_id === productId)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      },

      resetInventory: () => {
        set({ movements: [] });
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        movements: state.movements,
      }),
    }
  )
);









