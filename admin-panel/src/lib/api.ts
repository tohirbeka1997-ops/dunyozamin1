const API_BASE = (import.meta.env.VITE_ADMIN_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'dz_admin_tokens';

// SECURITY: admin JWTs are stored in `sessionStorage` (not `localStorage`) so
// they do NOT persist across full browser/tab restarts and are isolated per
// tab — mirroring the mini-app (`mini-app/src/lib/api.ts`). This narrows the
// XSS token-theft / account-takeover window vs. localStorage. It is NOT a full
// fix: any XSS that runs while the tab is open can still read these tokens.
// Tradeoff: admins must re-login after closing the browser (no "stay logged in"
// across restarts); silent refresh still works within an open session.
// Proper fix (backend, out of scope here): move auth to HttpOnly, Secure,
// SameSite cookies so the JWT is never readable from JS.
const tokenStore: Storage | undefined =
  typeof window !== 'undefined' ? window.sessionStorage : undefined;

export type StoredTokens = { access_token: string; refresh_token: string };
export type AdminUser = {
  id: string;
  username: string;
  full_name?: string;
  role: string;
  tenant: string;
};

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}

export function loadTokens(): StoredTokens | null {
  try {
    const raw = tokenStore?.getItem(TOKEN_KEY) ?? null;
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}

export function saveTokens(t: StoredTokens): void {
  try {
    tokenStore?.setItem(TOKEN_KEY, JSON.stringify(t));
    // Clean up any token left behind by older builds that used localStorage.
    if (typeof window !== 'undefined') window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore (storage disabled / private mode) */
  }
}

export function clearTokens(): void {
  try {
    tokenStore?.removeItem(TOKEN_KEY);
    if (typeof window !== 'undefined') window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function login(username: string, password: string, tenant = 'default'): Promise<AdminUser> {
  const r = await fetch(apiUrl('/v1/admin/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, tenant }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const code = j.error as string | undefined;
    const friendly: Record<string, string> = {
      invalid_credentials: 'Login yoki parol noto‘g‘ri',
      forbidden: 'Bu akkaunt admin paneliga kira olmaydi (faqat admin yoki manager roli)',
      tenant_not_found: 'Do‘kon (tenant) topilmadi. Odatda "default" yozing.',
      validation_error: 'Login va parolni kiriting',
      database_unavailable: 'Baza ulanmadi — public-api server / POS_DATA_DIR sozlamasini tekshiring',
      server_misconfigured: 'Server sozlamasi xato (JWT_SECRET).',
    };
    const msg =
      (j.message as string) ||
      (code && friendly[code]) ||
      (code ? `Xatolik: ${code}` : `Kirishda xatolik (HTTP ${r.status})`);
    throw new ApiError(r.status, code, msg);
  }
  saveTokens({ access_token: j.access_token as string, refresh_token: j.refresh_token as string });
  return j.user as AdminUser;
}

export async function logout(): Promise<void> {
  const t = loadTokens();
  if (t) {
    try {
      await fetch(apiUrl('/v1/admin/auth/logout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.access_token}` },
        body: JSON.stringify({ refresh_token: t.refresh_token }),
      });
    } catch {
      /* ignore */
    }
  }
  clearTokens();
}

let inFlightRefresh: Promise<StoredTokens | null> | null = null;

async function refreshTokens(): Promise<StoredTokens | null> {
  if (inFlightRefresh) return inFlightRefresh;
  const current = loadTokens();
  if (!current?.refresh_token) return null;

  inFlightRefresh = (async () => {
    try {
      const r = await fetch(apiUrl('/v1/admin/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      if (!r.ok) {
        clearTokens();
        return null;
      }
      const next = (await r.json()) as StoredTokens;
      if (!next?.access_token || !next?.refresh_token) {
        clearTokens();
        return null;
      }
      saveTokens(next);
      return next;
    } catch {
      return null;
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

async function rawFetch(path: string, opts: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (opts.body != null && typeof opts.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(apiUrl(path), { ...opts, headers });
}

/** Avtomatik token refresh bilan himoyalangan so'rov. */
export async function apiFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const initial = loadTokens();
  let response = await rawFetch(path, opts, initial?.access_token || null);

  if (response.status === 401 && initial?.refresh_token && !path.includes('/auth/refresh')) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      response = await rawFetch(path, opts, refreshed.access_token);
    }
  }

  const text = await response.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new ApiError(response.status, json.error as string, (json.message as string) || `HTTP ${response.status}`);
  }
  return (json.data !== undefined ? json.data : json) as T;
}

export function get<T = unknown>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'GET' });
}
export function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: body != null ? JSON.stringify(body) : undefined });
}
export function patch<T = unknown>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'PATCH', body: body != null ? JSON.stringify(body) : undefined });
}
export function del<T = unknown>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' });
}
