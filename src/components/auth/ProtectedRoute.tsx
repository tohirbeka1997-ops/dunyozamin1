/**
 * ProtectedRoute Component
 * Redirects to login if not authenticated
 * Redirects to /forbidden if role is not allowed
 */

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import type { ReactNode } from 'react';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: ('admin' | 'cashier' | 'manager')[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, loading, role } = useAuth();
  const location = useLocation();
  const [loadingTimeout, setLoadingTimeout] = React.useState(false);

  // Timeout after 15 seconds to prevent infinite loading
  React.useEffect(() => {
    if (loading) {
      const timeout = setTimeout(() => {
        setLoadingTimeout(true);
        console.warn('ProtectedRoute: Auth loading timeout - allowing render');
      }, 15000);

      return () => clearTimeout(timeout);
    } else {
      setLoadingTimeout(false);
    }
  }, [loading]);

  // CRITICAL: Wait for auth to finish loading before making decisions
  // This prevents race conditions where user exists but profile is still loading
  // The AuthContext now awaits profile loading before setting loading=false
  if (loading && !loadingTimeout) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  // Only check user after loading is complete
  // If loading timed out, still check user (might be a stuck state)
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check role-based access only after we have a user
  // If allowedRoles is specified, user must have one of those roles
  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
}

