import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product } from '@/types/database';
import type { CartItem, CartTotals, Discount } from '@/types/cart';

interface CartStore {
  items: CartItem[];
  globalDiscount: Discount;
  
  // Actions
  addItem: (product: Product, quantity?: number) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  removeItem: (itemId: string) => void;
  clearCart: () => void;
  
  // Line-level discounts
  setLineDiscount: (itemId: string, discount: number) => void;
  
  // Global discount
  setGlobalDiscount: (discount: Discount) => void;
  clearGlobalDiscount: () => void;
  
  // Calculations
  calculateTotals: (vatRate?: number) => CartTotals;
  
  // Helpers
  getItemById: (itemId: string) => CartItem | undefined;
  getItemByProductId: (productId: string) => CartItem | undefined;
  getTotalItems: () => number;
}

const generateCartItemId = (): string => {
  return `cart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      globalDiscount: { type: 'amount', value: 0, applied_to: 'global' },

      addItem: (product: Product, quantity = 1) => {
        const state = get();
        const existingItem = state.items.find(
          (item) => item.product.id === product.id && !item.variantId
        );

        if (existingItem) {
          // Update quantity of existing item
          get().updateQuantity(existingItem.id, existingItem.quantity + quantity);
        } else {
          // Add new item
          const unitPrice = Number(product.sale_price);
          const lineSubtotal = unitPrice * quantity;
          
          const newItem: CartItem = {
            id: generateCartItemId(),
            product,
            quantity,
            unit_price: unitPrice,
            line_discount: 0,
            line_subtotal: lineSubtotal,
            line_total: lineSubtotal,
          };

          set((state) => ({
            items: [...state.items, newItem],
          }));
        }
      },

      updateQuantity: (itemId: string, quantity: number) => {
        if (quantity <= 0) {
          get().removeItem(itemId);
          return;
        }

        set((state) => ({
          items: state.items.map((item) => {
            if (item.id === itemId) {
              const lineSubtotal = item.unit_price * quantity;
              // Adjust line discount if it exceeds new subtotal
              const lineDiscount = Math.min(item.line_discount, lineSubtotal);
              const lineTotal = lineSubtotal - lineDiscount;

              return {
                ...item,
                quantity,
                line_subtotal: lineSubtotal,
                line_discount: lineDiscount,
                line_total: lineTotal,
              };
            }
            return item;
          }),
        }));
      },

      removeItem: (itemId: string) => {
        set((state) => ({
          items: state.items.filter((item) => item.id !== itemId),
        }));
      },

      clearCart: () => {
        set({
          items: [],
          globalDiscount: { type: 'amount', value: 0, applied_to: 'global' },
        });
      },

      setLineDiscount: (itemId: string, discount: number) => {
        set((state) => ({
          items: state.items.map((item) => {
            if (item.id === itemId) {
              const lineSubtotal = item.line_subtotal;
              // Ensure discount doesn't exceed subtotal
              const validDiscount = Math.max(0, Math.min(discount, lineSubtotal));
              const lineTotal = lineSubtotal - validDiscount;

              return {
                ...item,
                line_discount: validDiscount,
                line_total: lineTotal,
              };
            }
            return item;
          }),
        }));
      },

      setGlobalDiscount: (discount: Discount) => {
        set({ globalDiscount: discount });
      },

      clearGlobalDiscount: () => {
        set({ globalDiscount: { type: 'amount', value: 0, applied_to: 'global' } });
      },

      calculateTotals: (vatRate = 0): CartTotals => {
        const state = get();
        
        // Calculate subtotal (sum of all line_subtotal)
        const subtotal = state.items.reduce(
          (sum, item) => sum + item.line_subtotal,
          0
        );

        // Calculate total line discounts
        const totalLineDiscounts = state.items.reduce(
          (sum, item) => sum + item.line_discount,
          0
        );

        // Calculate global discount
        let globalDiscountAmount = 0;
        if (state.globalDiscount.value > 0) {
          if (state.globalDiscount.type === 'percent') {
            globalDiscountAmount = (subtotal * state.globalDiscount.value) / 100;
          } else {
            globalDiscountAmount = Math.min(state.globalDiscount.value, subtotal);
          }
        }

        // Total discount = line discounts + global discount
        const total_discount = totalLineDiscounts + globalDiscountAmount;

        // Subtotal after discounts
        const subtotalAfterDiscounts = subtotal - total_discount;

        // Calculate VAT
        const vat_amount = (subtotalAfterDiscounts * vatRate) / 100;

        // Final total
        const total = subtotalAfterDiscounts + vat_amount;

        return {
          subtotal,
          total_discount,
          global_discount: globalDiscountAmount,
          vat_amount,
          total,
        };
      },

      getItemById: (itemId: string) => {
        return get().items.find((item) => item.id === itemId);
      },

      getItemByProductId: (productId: string) => {
        return get().items.find(
          (item) => item.product.id === productId && !item.variantId
        );
      },

      getTotalItems: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0);
      },
    }),
    {
      name: 'pos_cart',
      partialize: (state) => ({
        items: state.items,
        globalDiscount: state.globalDiscount,
      }),
    }
  )
);









