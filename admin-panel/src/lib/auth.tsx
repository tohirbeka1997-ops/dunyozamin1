import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadTokens, login as apiLogin, logout as apiLogout, get, type AdminUser } from './api';

type AuthState = {
  user: AdminUser | null;
  loading: boolean;
  login: (username: string, password: string, tenant?: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!loadTokens()) {
        setLoading(false);
        return;
      }
      try {
        // Token bor — /admin/me orqali tekshiramiz (kerak bo'lsa avtomatik refresh bo'ladi).
        const me = await get<AdminUser>('/v1/admin/me').catch(() => null);
        if (!cancelled && me && me.id) setUser(me);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      async login(username, password, tenant) {
        const u = await apiLogin(username, password, tenant);
        setUser(u);
      },
      async logout() {
        await apiLogout();
        setUser(null);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
