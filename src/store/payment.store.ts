import { create } from 'zustand';
import type { PaymentMethod } from '@/types/database';
import type { Payment, PaymentSummary } from '@/types/payment';

interface PaymentStore {
  payments: Payment[];
  cashReceived: number;
  creditAmount: number;
  
  // Actions
  addPayment: (payment: Payment) => void;
  removePayment: (index: number) => void;
  updatePayment: (index: number, payment: Payment) => void;
  setCashReceived: (amount: number) => void;
  setCreditAmount: (amount: number) => void;
  clearPayments: () => void;
  
  // Calculations
  calculateSummary: (totalDue: number) => PaymentSummary;
  
  // Helpers
  getTotalPaid: () => number;
}

export const usePaymentStore = create<PaymentStore>((set, get) => ({
  payments: [],
  cashReceived: 0,
  creditAmount: 0,

  addPayment: (payment: Payment) => {
    set((state) => ({
      payments: [...state.payments, payment],
    }));
  },

  removePayment: (index: number) => {
    set((state) => ({
      payments: state.payments.filter((_, i) => i !== index),
    }));
  },

  updatePayment: (index: number, payment: Payment) => {
    set((state) => ({
      payments: state.payments.map((p, i) => (i === index ? payment : p)),
    }));
  },

  setCashReceived: (amount: number) => {
    set({ cashReceived: Math.max(0, amount) });
  },

  setCreditAmount: (amount: number) => {
    set({ creditAmount: Math.max(0, amount) });
  },

  clearPayments: () => {
    set({
      payments: [],
      cashReceived: 0,
      creditAmount: 0,
    });
  },

  calculateSummary: (totalDue: number): PaymentSummary => {
    const state = get();
    
    // Calculate total from payment methods
    const paymentTotal = state.payments.reduce(
      (sum, p) => sum + p.amount,
      0
    );
    
    // Total paid = payment methods + credit
    const total_paid = paymentTotal + state.creditAmount;
    
    // Change = cash received - (total due - credit)
    const cashDue = totalDue - state.creditAmount;
    const change = Math.max(0, state.cashReceived - cashDue);
    
    return {
      payments: state.payments,
      total_paid,
      total_due: totalDue,
      change,
      credit_amount: state.creditAmount,
    };
  },

  getTotalPaid: () => {
    const state = get();
    return (
      state.payments.reduce((sum, p) => sum + p.amount, 0) + state.creditAmount
    );
  },
}));








