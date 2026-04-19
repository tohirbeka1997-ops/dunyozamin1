import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@/store/useAuth';

interface AuthContextType {
  session: { user: { id: string; email: string } } | null;
  user: { id: string; email: string; role: string; full_name?: string } | null;
  profile: { id: string; full_name: string; email: string; role: string } | null;
  role: 'admin' | 'cashier' | 'manager';
  /** Bosqich 16 — 'master' = super-admin session, 'tenant' = regular user. */
  scope: 'tenant' | 'master';
  /** null in single-tenant installs and for master sessions. */
  tenantSlug: string | null;
  /**
   * Is the BACKEND running in multi-tenant mode?
   *   true  — show tenant input on /login, expose /admin routes
   *   false — single-tenant: hide tenant UI entirely
   *   null  — still probing; UI should treat as single-tenant until known
   */
  multiTenantMode: boolean | null;
  loading: boolean;
  signIn: (email: string, password: string, tenant?: string | null) => Promise<void>;
  masterSignIn: (username: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, profileFields?: { fullName?: string; username?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

/**
 * IMPORTANT (dev/HMR):
 * React Fast Refresh can recreate module-level singletons. If `createContext()` is
 * recreated while component instances are preserved, consumers may not see the
 * provider and crash with "useAuth must be used within an AuthProvider".
 *
 * Caching the context on `globalThis` keeps a stable identity across refreshes.
 */
const globalForAuthContext = globalThis as unknown as {
  __posAuthContext?: ReturnType<typeof createContext<AuthContextType | undefined>>;
};

const AuthContext =
  globalForAuthContext.__posAuthContext ?? createContext<AuthContextType | undefined>(undefined);

globalForAuthContext.__posAuthContext = AuthContext;

export function AuthProvider({ children }: { children: ReactNode }) {
  const authStore = useAuthStore();

  // Initialize auth on mount
  useEffect(() => {
    authStore.init();
  }, [authStore]);

  // Global listener: when the HTTP RPC layer detects an expired / invalid
  // session token it dispatches `pos:auth:required`. We clear local auth
  // state so the next protected-route render redirects to /login.
  useEffect(() => {
    function onAuthRequired(ev: Event) {
      const detail = (ev as CustomEvent).detail;
      console.warn('[Auth] Session invalid — forcing sign-out.', detail);
      try {
        authStore.signOut();
      } catch (e) {
        console.warn('[Auth] signOut after pos:auth:required failed:', e);
      }
    }
    window.addEventListener('pos:auth:required', onAuthRequired);
    return () => window.removeEventListener('pos:auth:required', onAuthRequired);
  }, [authStore]);

  // Map store values to context, including role + full_name on user object
  // so UI code can read `user.full_name` / `user.role` without reaching into
  // `profile` separately.
  const value: AuthContextType = {
    session: authStore.session,
    user: authStore.user
      ? {
          ...authStore.user,
          role: authStore.role,
          full_name: authStore.profile?.full_name,
        }
      : null,
    profile: authStore.profile,
    role: authStore.role,
    scope: authStore.scope,
    tenantSlug: authStore.tenantSlug,
    multiTenantMode: authStore.multiTenantMode,
    loading: authStore.loading,
    signIn: authStore.signIn,
    masterSignIn: authStore.masterSignIn,
    signUp: authStore.signUp,
    signOut: authStore.signOut,
    refreshProfile: authStore.refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}


















































