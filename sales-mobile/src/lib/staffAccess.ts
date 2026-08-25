/**
 * Staff UI access helpers — mirror public-api/lib/staffRoles.cjs cashier matrix.
 */

function normalizeRole(role?: string | null): string {
  return String(role || '')
    .trim()
    .toLowerCase();
}

export function isCashierRole(role?: string | null): boolean {
  return normalizeRole(role) === 'cashier';
}

/** Web / online orders queues. */
export function canAccessWebOrders(role?: string | null): boolean {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'manager' || r === 'sales';
}

export function canAccessPurchasing(role?: string | null): boolean {
  return canAccessWebOrders(role);
}

export function canAccessSuppliers(role?: string | null): boolean {
  return canAccessWebOrders(role);
}

export function canAccessExpenses(role?: string | null): boolean {
  return canAccessWebOrders(role);
}

export function canSeeCost(role?: string | null): boolean {
  return canAccessWebOrders(role);
}
