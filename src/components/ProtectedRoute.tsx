// src/components/ProtectedRoute.tsx
import { ReactNode, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

type Props = {
  children: ReactNode;
};

/**
 * Checks `window.posApi._session.hasToken()` so the web/SaaS build treats a
 * missing/expired session token the same as "not logged in", even if the
 * local `auth_user` blob is still present. In Electron desktop the helper
 * returns false (no token) BUT `user` is set from the local profile — so we
 * only apply the token guard when the helper is wired (remote mode).
 */
function hasSessionTokenIfRequired(): boolean {
  if (typeof window === 'undefined') return true;
  const api = (window as any).posApi;
  if (!api?._session || typeof api._session.hasToken !== 'function') {
    return true; // Electron / not configured — trust the React state.
  }
  return !!api._session.hasToken();
}

export default function ProtectedRoute({ children }: Props) {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();

  // If React state thinks we're logged in but the token vanished (e.g. user
  // cleared localStorage in another tab), sign out locally too — then the
  // redirect below fires on the next render.
  useEffect(() => {
    if (!loading && user && !hasSessionTokenIfRequired()) {
      console.warn('[ProtectedRoute] Session token missing — signing out.');
      signOut().catch((e) => console.warn('[ProtectedRoute] signOut failed:', e));
    }
  }, [user, loading, signOut]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Yuklanmoqda...</div>
      </div>
    );
  }

  if (!user || !hasSessionTokenIfRequired()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
