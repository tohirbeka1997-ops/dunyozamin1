import { useSyncExternalStore } from 'react';
import type { CustomerSummary } from '@/types/customers';
import type { CartLine, PosProduct } from '@/types/sales';

let cart: CartLine[] = [];
let selectedCustomer: CustomerSummary | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): CartLine[] {
  return cart;
}

export function getCartQuantity(productId: string): number {
  return cart.find((l) => l.product.id === productId)?.quantity ?? 0;
}

export function addToCart(product: PosProduct, quantity = 1): void {
  const addQty = Math.max(1, Math.floor(Number(quantity) || 1));
  const stock = Number(product.current_stock ?? 0);
  const idx = cart.findIndex((l) => l.product.id === product.id);
  const currentQty = idx >= 0 ? cart[idx].quantity : 0;
  const newQty = stock > 0 ? Math.min(currentQty + addQty, stock) : currentQty + addQty;
  if (newQty <= currentQty) return;
  if (idx >= 0) {
    cart = cart.map((l, i) => (i === idx ? { ...l, quantity: newQty } : l));
  } else {
    cart = [...cart, { product, quantity: newQty }];
  }
  emit();
}

export function changeQty(productId: string, delta: number): void {
  cart = cart
    .map((l) => (l.product.id === productId ? { ...l, quantity: l.quantity + delta } : l))
    .filter((l) => l.quantity > 0);
  emit();
}

export function clearCart(): void {
  if (cart.length === 0 && !selectedCustomer) return;
  cart = [];
  selectedCustomer = null;
  emit();
}

export function setSelectedCustomer(customer: CustomerSummary | null): void {
  selectedCustomer = customer;
  emit();
}

export function getSelectedCustomer(): CustomerSummary | null {
  return selectedCustomer;
}

export function useCart(): CartLine[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useCartItemCount(): number {
  const lines = useCart();
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

export function useCartTotal(): number {
  const lines = useCart();
  return lines.reduce(
    (sum, line) => sum + Number(line.product.sale_price || 0) * line.quantity,
    0,
  );
}

export function useSelectedCustomer(): CustomerSummary | null {
  return useSyncExternalStore(subscribe, () => selectedCustomer, () => selectedCustomer);
}
