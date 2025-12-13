import type { Customer } from './database';
import type { CartItem, CartTotals } from './cart';
import type { Payment } from './payment';

export interface POSState {
  // Cart
  cart: CartItem[];
  selectedCustomer: Customer | null;
  globalDiscount: {
    type: 'amount' | 'percent';
    value: number;
  };
  
  // Payment
  payments: Payment[];
  cashReceived: number;
  creditAmount: number;
  
  // UI State
  searchTerm: string;
  selectedCategory: string | null;
  holdOrderDialogOpen: boolean;
  paymentDialogOpen: boolean;
  customerDialogOpen: boolean;
  
  // Calculations
  totals: CartTotals | null;
}








