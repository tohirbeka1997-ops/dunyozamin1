/**
 * Auth Store (Zustand) - Stub implementation for local SQLite
 * TODO: Replace with local auth implementation
 */

import { create } from 'zustand';
import { clearAllBrowserStorage } from '@/lib/clearBrowserStorage';
import { handleIpcResponse } from '@/utils/electron';

/**
 * True when the frontend is running against the HTTP RPC (web/SaaS) build,
 * i.e. `window.posApi` was provided by `remotePosApi.ts` + localStorage has
 * a `pos_session_token`. In pure Electron the preload always injects
 * `window.posApi` but there is no session token (desktop window is trusted).
 */
function isRemoteRpcMode(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const api = (window as any).posApi;
    return !!(api && api._session && typeof api._session.hasToken === 'function');
  } catch {
    return false;
  }
}

/** Joriy foydalanuvchi ID sini main process (audit) bilan sinxronlaydi. */
async function syncPosMainSessionUser(userId: string | null) {
  try {
    if (typeof window === 'undefined') return;
    const api = (window as any).posApi;
    if (api?.auth?.setSessionUser) {
      await handleIpcResponse<any>(api.auth.setSessionUser(userId ?? null));
    }
  } catch (e) {
    console.warn('[Auth] setSessionUser (main) failed:', e);
  }
}

function hasActiveSessionToken(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const api = (window as any).posApi;
    if (!api?._session?.hasToken) return false;
    return !!api._session.hasToken();
  } catch {
    return false;
  }
}

// Stub types
type User = { id: string; email: string };
type Session = { user: User };
type Profile = { id: string; full_name: string; email: string; role: string };
type UserRole = 'admin' | 'cashier' | 'manager';
// Bosqich 16: "master" is the super-admin scope in multi-tenant mode. We model
// it as an auth dimension ORTHOGONAL to role — a master session has NO
// tenant role; its privileges are scoped to managing tenants themselves.
export type AuthScope = 'tenant' | 'master';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: UserRole;
  scope: AuthScope;                      // NEW (Bosqich 16)
  tenantSlug: string | null;             // NEW — null when scope='master' or single-tenant
  multiTenantMode: boolean | null;       // null until pos:health returns; drives login UI
  loading: boolean;
  initialized: boolean;

  init: () => Promise<void>;
  signIn: (email: string, password: string, tenant?: string | null) => Promise<void>;
  /** Super-admin login (multi-tenant only). Sets scope='master'. */
  masterSignIn: (username: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, profileFields?: { fullName?: string; username?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Best-effort probe that also populates multiTenantMode. Idempotent. */
  probeServerMode: () => Promise<boolean | null>;
}

/**
 * Map a backend profile to a UserRole. The previous behaviour silently
 * downgraded any unknown role string (e.g. a typo, a feature-flagged
 * future role like 'auditor', or a tampered token) to `cashier`. That
 * looked friendly but it is dangerous in two directions:
 *
 *   1. Privilege creep: a misspelled `'admnin'` would fall through to
 *      `cashier`, which still grants a working session — instead of
 *      forcing the operator to fix the data.
 *   2. Privilege bypass: if a future role tightened cashier permissions,
 *      silently aliasing the unknown role to `cashier` could grant
 *      cashier-level access to a user the backend did not intend.
 *
 * Throwing here makes the caller (sign-in flow) reject the session and
 * surface a clear "unrecognized role" error, which is the safe default.
 */
class UnrecognizedRoleError extends Error {
  readonly code = 'unrecognized_role';
  constructor(public readonly receivedRole: unknown) {
    super(`Unrecognized user role: ${String(receivedRole)}`);
    this.name = 'UnrecognizedRoleError';
  }
}

function deriveRole(profile: Profile | null): UserRole {
  if (!profile) {
    // Missing profile is a different failure mode (no token, server
    // didn't return one yet). Treat as cashier ONLY in the loading
    // window; callers that hit `deriveRole(null)` already know what
    // they're doing.
    return 'cashier';
  }
  const role = profile.role;
  if (role === 'admin' || role === 'cashier' || role === 'manager') {
    return role;
  }
  throw new UnrecognizedRoleError(role);
}

export { UnrecognizedRoleError };

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  role: 'cashier',
  scope: 'tenant',
  tenantSlug: null,
  multiTenantMode: null,
  loading: false,
  initialized: false,

  /**
   * Ask the server whether multi-tenant mode is on so the login form can
   * decide whether to render the tenant field. Uses the public pos:health
   * channel (bootstrap token, no session needed). Silently returns null in
   * non-remote (Electron) builds — which are single-tenant by definition.
   */
  probeServerMode: async () => {
    try {
      if (!isRemoteRpcMode()) {
        set({ multiTenantMode: false });
        return false;
      }
      const api = (window as any).posApi;
      if (!api?.health) { set({ multiTenantMode: false }); return false; }
      // `health` is an inv('pos:health') function, not a namespace — call it directly.
      const raw = await api.health();
      // Remote RPC wraps results as { success:true, data } on the transport
      // layer; the inner handler payload is `{ success, dbOpen, multi_tenant }`.
      // We also tolerate the shape of IPC (no transport wrap) for Electron parity.
      const payload = (raw && typeof raw === 'object' && 'data' in raw) ? (raw as any).data : raw;
      const mt = !!(payload && (payload as any).multi_tenant);
      set({ multiTenantMode: mt });
      return mt;
    } catch (e) {
      console.warn('[Auth] probeServerMode failed:', e);
      set({ multiTenantMode: false });
      return null;
    }
  },

  init: async () => {
    if (get().initialized) return;

    // Probe server mode in the background — non-blocking so login UX stays fast.
    void get().probeServerMode();

    // In the web/SaaS build we MUST have a valid session token.
    // If the user object is in localStorage but the token is gone or expired,
    // clear the local profile so the app redirects to /login.
    if (isRemoteRpcMode() && !hasActiveSessionToken()) {
      try { localStorage.removeItem('auth_user'); } catch {}
      set({
        session: null, user: null, profile: null,
        role: 'cashier', scope: 'tenant', tenantSlug: null,
        loading: false, initialized: true,
      });
      return;
    }

    const storedUser = localStorage.getItem('auth_user');
    if (!storedUser) {
      set({ loading: false, initialized: true });
      return;
    }

    try {
      const parsed = JSON.parse(storedUser);
      // Restore tenant slug + scope from the remote-API layer so the UI
      // shows the right badges + admin entry point after a page reload.
      let scope: AuthScope = 'tenant';
      let tenantSlug: string | null = null;
      try {
        const api = (window as any).posApi;
        if (api?._session?.getAuthScope) {
          const s = api._session.getAuthScope();
          if (s === 'master' || s === 'tenant') scope = s;
        }
        if (api?._session?.getTenantSlug) {
          tenantSlug = api._session.getTenantSlug() ?? null;
        }
      } catch { /* ignore */ }

      // If the stored profile carries an unknown role we refuse to
      // restore the session — the user must re-login. Better than the
      // old behaviour of silently downgrading to `cashier` because:
      //   - it forces the operator to clear stale data, and
      //   - it prevents privilege confusion (the original role might
      //     have been an admin that got truncated/corrupted).
      let role: UserRole;
      try {
        role = deriveRole(parsed);
      } catch (err) {
        console.error('[useAuth] Stored profile has unknown role, clearing session.', err);
        localStorage.removeItem('auth_user');
        set({
          session: null,
          user: null,
          profile: null,
          role: 'cashier',
          scope: 'tenant',
          tenantSlug: null,
          loading: false,
          initialized: true,
        });
        return;
      }

      set({
        session: { user: parsed },
        user: parsed,
        profile: parsed,
        role,
        scope,
        tenantSlug,
        loading: false,
        initialized: true,
      });

      if (parsed?.id) {
        void syncPosMainSessionUser(String(parsed.id));
      }

      // Best-effort server-side session validation (web only — in Electron
      // `pos:auth:me` just returns the most recent active user, so we skip it).
      if (isRemoteRpcMode()) {
        try {
          const api = (window as any).posApi;
          if (api?.auth?.me) {
            // Fire-and-forget — if it fails with 401 the remotePosApi layer
            // already dispatched `pos:auth:required` which triggers signOut.
            api.auth.me().catch((e: unknown) => {
              console.warn('[Auth] init: me() check failed (non-fatal):', e);
            });
          }
        } catch (e) {
          console.warn('[Auth] init: me() call threw (non-fatal):', e);
        }
      }
    } catch (e) {
      console.error('Failed to parse stored user:', e);
      try { localStorage.removeItem('auth_user'); } catch {}
      set({ loading: false, initialized: true });
    }
  },

  signIn: async (email: string, password: string, tenant?: string | null) => {
    set({ loading: true });
    try {
      // Check if we're in Electron environment
      if (typeof window === 'undefined' || !(window as any).posApi) {
        throw new Error('API not available. Make sure you are running in Electron.');
      }

      // In multi-tenant mode the browser MUST tell the server which tenant to
      // authenticate against. We pass tenant either in the first positional
      // argument (remotePosApi strips it into the payload field) or, if the
      // caller passed positional creds, we append it as a hint the transport
      // layer will pick up. Single-tenant / Electron installs just pass the
      // raw username+password and the tenant arg is ignored.
      const trimmedTenant = typeof tenant === 'string' ? tenant.trim().toLowerCase() : '';
      const loginResult = trimmedTenant
        ? (window as any).posApi.auth.login({ tenant: trimmedTenant, username: email, password })
        : (window as any).posApi.auth.login(email, password);

      // Call real backend authentication API
      // Backend now returns: { success: true, user: {...}, message } or { success: false, error }
      // NOTE: preload.invoke() wraps IPC results as:
      //   { success: true, data: <handlerResult> } OR { success: false, error: {...} }
      // So we MUST unwrap here.
      const response = await handleIpcResponse<any>(loginResult);

      // Check response format
      if (!response || typeof response !== 'object') {
        throw new Error('Invalid IPC response format');
      }

      // Check if login was successful
      if (!response.success) {
        const errorMessage = response.error || 'Login failed';
        throw new Error(errorMessage);
      }

      // Extract user from response
      const dbUser = response.user;
      
      if (!dbUser || !dbUser.id) {
        console.error('[useAuth] Backend returned invalid user envelope on login');
        throw new Error('Invalid user data: missing ID. Cannot proceed with login.');
      }

      // Map backend response to frontend state
      // Backend returns: { success: true, user: { id, username, full_name, email, role }, message: 'Welcome' }
      
      // Use the REAL database ID directly (e.g., 'default-admin-001')
      const realUserId = dbUser.id;
      
      // Map fields from backend response
      // CRITICAL: Use role from backend - should be 'admin' for admin@pos.com
      const backendRole = dbUser.role;
      if (!backendRole) {
        console.warn('[useAuth] Backend did not return a role for login user');
      }
      
      const mappedUser = {
        id: dbUser.id,
        username: dbUser.username,
        name: dbUser.full_name,
        role: backendRole || 'cashier', // Fallback only if backend didn't provide role
      };

      // Map to frontend User type (uses email field)
      const user: User = {
        id: mappedUser.id,                // REAL database ID from SQLite
        email: mappedUser.username,       // Use username as email for compatibility
      };

      // Map to frontend Profile type
      const profile: Profile = {
        id: mappedUser.id,                // REAL database ID from SQLite
        email: mappedUser.username,
        full_name: mappedUser.name,       // Use name (mapped from full_name)
        role: mappedUser.role,
      };

      // Final validation: Ensure all required fields are present
      if (!user.id || !profile.id) {
        console.error('[useAuth] User/profile missing ID before saving');
        throw new Error('Invalid user data: missing ID in mapped objects');
      }

      // Read tenant slug from remote-API (captured from login response).
      // Single-tenant installs return null here and the badge is hidden.
      let tenantSlug: string | null = null;
      try {
        const api = (window as any).posApi;
        if (api?._session?.getTenantSlug) tenantSlug = api._session.getTenantSlug() ?? null;
      } catch { /* ignore */ }

      // Save to state with REAL database ID. If the backend returned a
      // role we don't recognise, refuse the login rather than aliasing
      // to `cashier` — see comment on `deriveRole` for rationale.
      let role: UserRole;
      try {
        role = deriveRole(profile);
      } catch (err) {
        console.error('[useAuth] Login profile carries unknown role:', err);
        set({ loading: false });
        throw new Error("Akkauntning roli noma'lum. Iltimos, administratoringizga murojaat qiling.");
      }

      set({
        session: { user },
        user,
        profile,
        role,
        scope: 'tenant',
        tenantSlug,
        loading: false,
      });

      // Persist to localStorage with REAL database ID
      localStorage.setItem('auth_user', JSON.stringify(profile));

      void syncPosMainSessionUser(String(realUserId));

      // CRITICAL: Sync shift state from database after login
      // This ensures UI reflects real database status immediately after login
      try {
        const { useShiftStore } = await import('@/store/shiftStore');
        const shiftStore = useShiftStore.getState();
        if (shiftStore.syncFromDatabase && realUserId) {
          await shiftStore.syncFromDatabase(realUserId);
        }
      } catch (error) {
        console.warn('[useAuth] Could not sync shift after login (non-critical):', error);
      }
    } catch (error) {
      set({ loading: false });
      console.error('[useAuth] Login error:', error);
      // Re-throw error so UI can show error message
      throw error;
    }
  },

  masterSignIn: async (username: string, password: string) => {
    set({ loading: true });
    try {
      if (typeof window === 'undefined' || !(window as any).posApi?.master?.login) {
        throw new Error('Super-admin API not available.');
      }
      const raw = await (window as any).posApi.master.login(username, password);
      // Unwrap the transport envelope produced by remotePosApi. Electron's
      // IPC path is NOT applicable here (master login only exists on the
      // HTTP RPC server), but we still use handleIpcResponse for uniform
      // error shaping.
      const response = await handleIpcResponse<any>(raw);
      if (!response || response.success === false) {
        const msg = response?.error || 'Master login failed';
        throw new Error(typeof msg === 'string' ? msg : 'Master login failed');
      }

      // Master login returns { success, token, user:{ id, username, role:'master' } }.
      // remotePosApi already captured the token + scope into localStorage.
      const mu = response.user || { id: 'master', username };
      const user: User = { id: mu.id, email: mu.username };
      const profile: Profile = {
        id: mu.id,
        email: mu.username,
        full_name: mu.username,
        role: 'admin',  // treat master as admin-grade in tenant-less UI
      };
      set({
        session: { user },
        user,
        profile,
        role: 'admin',
        scope: 'master',
        tenantSlug: null,
        loading: false,
      });
      localStorage.setItem('auth_user', JSON.stringify(profile));
      void syncPosMainSessionUser(String(mu.id));
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  signUp: async (email: string, password: string, profileFields?: { fullName?: string; username?: string }) => {
    // Self-signup via this client-side helper used to fabricate an in-memory
    // user (id = Date.now()) and save it to localStorage without calling the
    // backend at all. That phantom account had no DB row, no server-side
    // role, no audit trail — and could log the user in as a cashier on the
    // next page load. We refuse the operation outright unless the build
    // explicitly opts in via VITE_ALLOW_CLIENT_SIGNUP for local dev.
    const devSignupEnabled =
      String(import.meta.env.VITE_ALLOW_CLIENT_SIGNUP || '').trim() === '1';

    if (!devSignupEnabled) {
      throw new Error(
        "Ro'yxatdan o'tish admin/Xodimlar bo'limi orqali amalga oshiriladi. Iltimos, administratoringizga murojaat qiling."
      );
    }

    set({ loading: true });
    try {
      const safeEmail = email || '';
      const safeFullName = profileFields?.fullName ||
        profileFields?.username ||
        (safeEmail.includes('@') ? safeEmail.split('@')[0] : safeEmail) ||
        'User';

      // Dev-only: still a local-only stub. Don't ship to production with
      // VITE_ALLOW_CLIENT_SIGNUP=1.
      const mockUser: User = { id: Date.now().toString(), email: safeEmail };
      const mockProfile: Profile = {
        id: mockUser.id,
        email: safeEmail,
        full_name: safeFullName,
        role: 'cashier',
      };
      set({
        session: { user: mockUser },
        user: mockUser,
        profile: mockProfile,
        role: deriveRole(mockProfile),
        loading: false,
      });
      localStorage.setItem('auth_user', JSON.stringify(mockProfile));
      void syncPosMainSessionUser(String(mockUser.id));
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  signOut: async () => {
    set({ loading: true });
    await syncPosMainSessionUser(null);

    // 1. Tell the server to destroy this user's sessions (web/SaaS build only).
    //    In Electron `pos:auth:logout` is a no-op, so this is always safe.
    try {
      const api = (typeof window !== 'undefined' ? (window as any).posApi : null);
      if (api?.auth?.logout) {
        await api.auth.logout().catch((e: unknown) => {
          console.warn('⚠️ signOut: server logout failed (continuing):', e);
        });
      }
    } catch (e) {
      console.warn('⚠️ signOut: server logout threw (continuing):', e);
    }

    // 2. Clear local IndexedDB / cached data.
    try {
      await clearAllBrowserStorage();
    } catch (error) {
      console.warn('⚠️ signOut: storage clear failed (continuing):', error);
    }

    // 3. Always clear local auth state, even if the above steps failed.
    try { localStorage.removeItem('auth_user'); } catch {}
    // Belt-and-braces: if remotePosApi still has a cached token, wipe it.
    try {
      const api = (typeof window !== 'undefined' ? (window as any).posApi : null);
      if (api?._session?.setToken) api._session.setToken(null);
    } catch {}

    set({
      session: null,
      user: null,
      profile: null,
      role: 'cashier',
      scope: 'tenant',
      tenantSlug: null,
      loading: false,
    });
  },

  refreshProfile: async () => {
    // TODO: Implement
    console.warn('refreshProfile not implemented');
  },
}));
