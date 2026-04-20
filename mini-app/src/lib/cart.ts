export type CartLine = {
  product_id: string;
  name: string;
  price_uzs: number;
  quantity: number;
};

const KEY = 'dz_cart_v1';

export function loadCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as CartLine[];
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export function saveCart(lines: CartLine[]): void {
  localStorage.setItem(KEY, JSON.stringify(lines));
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((s, l) => s + l.quantity, 0);
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((s, l) => s + l.price_uzs * l.quantity, 0);
}

export function addToCart(line: Omit<CartLine, 'quantity'> & { quantity?: number }): CartLine[] {
  const qty = Math.max(1, line.quantity ?? 1);
  const cur = loadCart();
  const i = cur.findIndex((x) => x.product_id === line.product_id);
  if (i >= 0) {
    cur[i] = { ...cur[i], quantity: cur[i].quantity + qty };
  } else {
    cur.push({ product_id: line.product_id, name: line.name, price_uzs: line.price_uzs, quantity: qty });
  }
  saveCart(cur);
  return cur;
}

export function setQuantity(productId: string, quantity: number): CartLine[] {
  const cur = loadCart();
  const i = cur.findIndex((x) => x.product_id === productId);
  if (i < 0) return cur;
  if (quantity <= 0) {
    cur.splice(i, 1);
  } else {
    cur[i] = { ...cur[i], quantity };
  }
  saveCart(cur);
  return cur;
}
