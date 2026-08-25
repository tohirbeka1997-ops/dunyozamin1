/**
 * Deep-link / screen-level RBAC gate for cashier-restricted areas.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { loadUser } from '@/auth/session';
import {
  canAccessExpenses,
  canAccessPurchasing,
  canAccessSuppliers,
  canAccessWebOrders,
} from '@/lib/staffAccess';

export type StaffAccessArea = 'orders' | 'purchasing' | 'suppliers' | 'expenses';

function allowed(area: StaffAccessArea, role?: string | null): boolean {
  switch (area) {
    case 'orders':
      return canAccessWebOrders(role);
    case 'purchasing':
      return canAccessPurchasing(role);
    case 'suppliers':
      return canAccessSuppliers(role);
    case 'expenses':
      return canAccessExpenses(role);
    default:
      return false;
  }
}

/**
 * Returns true once access is confirmed. While checking / denied, returns false
 * (caller should show spinner or nothing; redirect runs on deny).
 */
export function useRequireStaffAccess(area: StaffAccessArea): boolean {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setOk(false);
      void (async () => {
        const user = await loadUser();
        if (!alive) return;
        if (!allowed(area, user?.role)) {
          router.replace('/(tabs)/sell');
          return;
        }
        setOk(true);
      })();
      return () => {
        alive = false;
      };
    }, [area, router]),
  );

  return ok;
}
