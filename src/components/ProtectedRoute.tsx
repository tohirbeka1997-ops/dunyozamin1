// src/components/ProtectedRoute.tsx
import { ReactNode, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { hasSessionTokenIfRequired } from '@/lib/auth/sessionToken';

type Props = {
  children: ReactNode;
};

export default function ProtectedRoute({ children }: Props) {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

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
        <div className="text-muted-foreground">{t('common.loading')}</div>
      </div>
    );
  }

  if (!user || !hasSessionTokenIfRequired()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
