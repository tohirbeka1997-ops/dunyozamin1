/**
 * Inventory Store (Zustand) - Manages inventory movements and stock calculations
 */

import { create } from 'zustand';
import type { InventoryMovement } from '@/types/database';

interface InventoryState {
  movements: InventoryMovement[];
  stockByProductId: Record<string, number>;
  
  loadFromStorage: () => void;
  getCurrentStockByProductId: (productId: string) => number;
  getMovementsByProductId: (productId: string) => InventoryMovement[];
  addMovement: (movement: InventoryMovement) => void;
}

const buildStockMap = (movements: InventoryMovement[]) => {
  const map: Record<string, number> = {};
  for (const m of movements) {
    const id = m.product_id;
    if (!id) continue;
    map[id] = (map[id] || 0) + (m.quantity || 0);
  }
  return map;
};

export const useInventoryStore = create<InventoryState>((set, get) => ({
  movements: [],
  stockByProductId: {},

  loadFromStorage: () => {
    // Stub implementation - in production, this would load from IndexedDB/SQLite
    // For now, we'll load from localStorage as a fallback
    try {
      const stored = localStorage.getItem('inventory_movements');
      if (stored) {
        const movements = JSON.parse(stored);
        set({ movements, stockByProductId: buildStockMap(movements) });
      }
    } catch (error) {
      console.warn('Failed to load inventory from storage:', error);
    }
  },

  getCurrentStockByProductId: (productId: string) => {
    const { stockByProductId } = get();
    return stockByProductId[productId] || 0;
  },

  getMovementsByProductId: (productId: string) => {
    const { movements } = get();
    return movements.filter(m => m.product_id === productId);
  },

  addMovement: (movement: InventoryMovement) => {
    const { movements } = get();
    const updated = [...movements, movement];
    set({ movements: updated, stockByProductId: buildStockMap(updated) });
    
    // Persist to storage
    try {
      localStorage.setItem('inventory_movements', JSON.stringify(updated));
    } catch (error) {
      console.warn('Failed to save inventory movements:', error);
    }
  },
}));





















































