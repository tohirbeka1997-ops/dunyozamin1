import { create } from 'zustand';
import type { Customer } from '@/types/database';

interface CustomerStore {
  selectedCustomer: Customer | null;
  
  // Actions
  setCustomer: (customer: Customer | null) => void;
  clearCustomer: () => void;
  
  // Helpers
  hasCustomer: () => boolean;
  canUseCredit: () => boolean;
  getCreditLimit: () => number;
  getCurrentBalance: () => number;
  getAvailableCredit: () => number;
}

export const useCustomerStore = create<CustomerStore>((set, get) => ({
  selectedCustomer: null,

  setCustomer: (customer: Customer | null) => {
    set({ selectedCustomer: customer });
  },

  clearCustomer: () => {
    set({ selectedCustomer: null });
  },

  hasCustomer: () => {
    return get().selectedCustomer !== null;
  },

  canUseCredit: () => {
    const customer = get().selectedCustomer;
    return customer?.allow_debt === true;
  },

  getCreditLimit: () => {
    const customer = get().selectedCustomer;
    return customer?.credit_limit || 0;
  },

  getCurrentBalance: () => {
    const customer = get().selectedCustomer;
    return customer?.balance || 0;
  },

  getAvailableCredit: () => {
    const customer = get().selectedCustomer;
    if (!customer || !customer.allow_debt) return 0;
    
    const limit = customer.credit_limit || 0;
    const balance = customer.balance || 0;
    
    // Available credit = limit - current balance (if balance is positive debt)
    // If balance is negative (customer owes), available = limit + |balance|
    return balance >= 0 ? limit - balance : limit + Math.abs(balance);
  },
}));









