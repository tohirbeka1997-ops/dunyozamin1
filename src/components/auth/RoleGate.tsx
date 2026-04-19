/**
 * RoleGate Component
 * Conditionally renders children based on user role
 */

import { useAuthStore } from '@/store/useAuth';
import type { ReactNode } from 'react';

interface RoleGateProps {
  children: ReactNode;
  allowedRoles: ('admin' | 'cashier' | 'manager')[];
  fallback?: ReactNode;
}

export function RoleGate({ children, allowedRoles, fallback = null }: RoleGateProps) {
  const { role } = useAuthStore();

  if (allowedRoles.includes(role)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}

























































