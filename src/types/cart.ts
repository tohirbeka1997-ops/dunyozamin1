import type { Product } from './database';

export interface CartItem {
  id: string; // unique cart item id
  product: Product;
  quantity: number;
  variantId?: string; // for future variant support
  unit_price: number;
  line_discount: number; // per-line discount amount
  line_subtotal: number; // unit_price * quantity
  line_total: number; // line_subtotal - line_discount
  notes?: string;
}

export interface CartTotals {
  subtotal: number; // sum of all line_subtotal
  total_discount: number; // sum of all line_discount + global discount
  global_discount: number; // global discount amount
  vat_amount: number; // calculated VAT
  total: number; // final total after all discounts and VAT
}

export interface Discount {
  type: 'amount' | 'percent';
  value: number;
  applied_to: 'global' | 'line';
}








