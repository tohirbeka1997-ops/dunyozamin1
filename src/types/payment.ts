import type { PaymentMethod } from './database';

export interface Payment {
  method: PaymentMethod;
  amount: number;
  reference?: string;
  notes?: string;
}

export interface PaymentSummary {
  payments: Payment[];
  total_paid: number;
  total_due: number;
  change: number;
  credit_amount: number;
}

export interface PaymentResult {
  success: boolean;
  order_id?: string;
  order_number?: string;
  payment_summary: PaymentSummary;
  receipt_data?: ReceiptData;
}

export interface ReceiptData {
  order_number: string;
  items: Array<{
    name: string;
    quantity: number;
    unit_price: number;
    total: number;
  }>;
  customer?: {
    name: string;
    phone?: string;
  };
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  paid: number;
  change: number;
  payment_methods: string[];
  date_time: string;
  cashier: string;
}








