import { getTg } from './telegram';

export type CartLine = {
  product_id: string;
  name: string;
  price_uzs: number;
  quantity: number;
};

/**
 * Cart is namespaced by the active Telegram user ID — see the comment
 * in `favorites.ts`. The previous shared `dz_cart_v1` key leaked one
 * user's basket onto a second account that opened the WebApp on the
 * same device (a real scenario when families share phones).
 */
const KEY_PREFIX = 'dz_cart_v1';
const LEGACY_KEY = 'dz_cart_v1';

function getStorageKey(): string {
  const tgId = getTg()?.initDataUnsafe?.user?.id;
  if (typeof tgId === 'number' && Number.isFinite(tgId)) {
    return `${KEY_PREFIX}::${tgId}`;
  }
  return `${KEY_PREFIX}::guest`;
}

export function loadCart(): CartLine[] {
  try {
    const key = getStorageKey();
    let raw = localStorage.getItem(key);
    // One-shot migration of the legacy unscoped key. After moving the
    // payload under the per-user namespace, drop the original so a
    // different account on the same device doesn't inherit it.
    if (raw == null && key !== LEGACY_KEY) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy != null) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem(LEGACY_KEY);
        raw = legacy;
      }
    }
    if (!raw) return [];
    const p = JSON.parse(raw) as CartLine[];
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export function saveCart(lines: CartLine[]): void {
  localStorage.setItem(getStorageKey(), JSON.stringify(lines));
  window.dispatchEvent(new Event('cart:change'));
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
