import { useSyncExternalStore } from 'react';
import { deleteAppItem, getAppItem, setAppItem } from '@/lib/appStorage';
import type { CustomerSummary } from '@/types/customers';
import type { CartLine, PosProduct } from '@/types/sales';

const CART_KEY = 'dz_staff_cart_v1';

interface PersistedCart {
  lines: CartLine[];
  customer: CustomerSummary | null;
}

let cart: CartLine[] = [];
let selectedCustomer: CustomerSummary | null = null;
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
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

function persistSoon(): void {
  const payload: PersistedCart = { lines: cart, customer: selectedCustomer };
  void setAppItem(CART_KEY, JSON.stringify(payload));
}

function emitAndPersist(): void {
  emit();
  persistSoon();
}

export function lineGross(line: CartLine): number {
  return Number(line.product.sale_price || 0) * line.quantity;
}

export function lineDiscount(line: CartLine): number {
  const gross = lineGross(line);
  const raw = Number(line.discount_amount || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, Math.max(0, gross - 1)); // leave at least 1 so'm if possible
}

export function lineNet(line: CartLine): number {
  return Math.max(0, lineGross(line) - lineDiscount(line));
}

function normalizeLine(line: CartLine): CartLine | null {
  if (!line?.product?.id || !(Number(line.quantity) > 0)) return null;
  const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
  const discount = lineDiscount({ ...line, quantity: qty });
  return {
    product: line.product,
    quantity: qty,
    ...(discount > 0 ? { discount_amount: discount } : {}),
  };
}

function parsePersisted(raw: string | null): PersistedCart | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedCart;
    if (!parsed || !Array.isArray(parsed.lines)) return null;
    return {
      lines: parsed.lines.map(normalizeLine).filter((l): l is CartLine => l != null),
      customer: parsed.customer && parsed.customer.id ? parsed.customer : null,
    };
  } catch {
    return null;
  }
}

/** Load cart from AsyncStorage once (call during app boot). */
export async function hydrateCart(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const data = parsePersisted(await getAppItem(CART_KEY));
      if (data) {
        cart = data.lines;
        selectedCustomer = data.customer;
      }
    } finally {
      hydrated = true;
      emit();
    }
  })();
  return hydratePromise;
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
    cart = cart.map((l, i) => {
      if (i !== idx) return l;
      const next = { ...l, quantity: newQty };
      const d = lineDiscount(next);
      return d > 0 ? { ...next, discount_amount: d } : { product: next.product, quantity: next.quantity };
    });
  } else {
    cart = [...cart, { product, quantity: newQty }];
  }
  emitAndPersist();
}

export function changeQty(productId: string, delta: number): void {
  cart = cart
    .map((l) => {
      if (l.product.id !== productId) return l;
      const stock = Number(l.product.current_stock ?? 0);
      let nextQty = l.quantity + delta;
      if (nextQty <= 0) return null;
      // Match addToCart: never exceed known stock (stock<=0 means unknown/unlimited).
      if (stock > 0) nextQty = Math.min(nextQty, stock);
      if (nextQty === l.quantity) return l;
      const next = { ...l, quantity: nextQty };
      const d = lineDiscount(next);
      return d > 0
        ? { product: next.product, quantity: next.quantity, discount_amount: d }
        : { product: next.product, quantity: next.quantity };
    })
    .filter((l): l is CartLine => l != null);
  emitAndPersist();
}

/** Set absolute quantity (0 or less removes the line). Capped by stock when known. */
export function setQty(productId: string, quantity: number): void {
  const raw = Math.floor(Number(quantity) || 0);
  if (raw <= 0) {
    removeLine(productId);
    return;
  }
  cart = cart
    .map((l) => {
      if (l.product.id !== productId) return l;
      const stock = Number(l.product.current_stock ?? 0);
      const nextQty = stock > 0 ? Math.min(raw, stock) : raw;
      if (nextQty === l.quantity) return l;
      const next = { ...l, quantity: nextQty };
      const d = lineDiscount(next);
      return d > 0
        ? { product: next.product, quantity: next.quantity, discount_amount: d }
        : { product: next.product, quantity: next.quantity };
    })
    .filter((l): l is CartLine => l != null);
  emitAndPersist();
}

export function removeLine(productId: string): void {
  const next = cart.filter((l) => l.product.id !== productId);
  if (next.length === cart.length) return;
  cart = next;
  emitAndPersist();
}

/** Set absolute line discount in UZS (0 clears). Capped below line gross. */
export function setLineDiscount(productId: string, amount: number): void {
  cart = cart.map((l) => {
    if (l.product.id !== productId) return l;
    const next = { ...l, discount_amount: Math.max(0, Number(amount) || 0) };
    const d = lineDiscount(next);
    return d > 0
      ? { product: l.product, quantity: l.quantity, discount_amount: d }
      : { product: l.product, quantity: l.quantity };
  });
  emitAndPersist();
}

export function clearCart(): void {
  if (cart.length === 0 && !selectedCustomer) {
    void deleteAppItem(CART_KEY);
    return;
  }
  cart = [];
  selectedCustomer = null;
  emit();
  void deleteAppItem(CART_KEY);
}

export function setSelectedCustomer(customer: CustomerSummary | null): void {
  selectedCustomer = customer;
  emitAndPersist();
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

/** Live quantity for one product id (0 if not in cart). */
export function useCartQuantity(productId: string): number {
  return useSyncExternalStore(
    subscribe,
    () => getCartQuantity(productId),
    () => getCartQuantity(productId),
  );
}

export function useCartSubtotal(): number {
  const lines = useCart();
  return lines.reduce((sum, line) => sum + lineGross(line), 0);
}

export function useCartDiscountTotal(): number {
  const lines = useCart();
  return lines.reduce((sum, line) => sum + lineDiscount(line), 0);
}

export function useCartTotal(): number {
  const lines = useCart();
  return lines.reduce((sum, line) => sum + lineNet(line), 0);
}

export function useSelectedCustomer(): CustomerSummary | null {
  return useSyncExternalStore(subscribe, () => selectedCustomer, () => selectedCustomer);
}
