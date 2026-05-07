const base = () => (import.meta.env.VITE_PUBLIC_API_URL || '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const b = base();
  return b ? `${b}${p}` : p;
}

const TOKEN_KEY = 'dz_public_api_tokens';

export type StoredTokens = { access_token: string; refresh_token: string };

export function loadTokens(): StoredTokens | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export function saveTokens(t: StoredTokens): void {
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));
}

export function clearTokens(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function authTelegram(initData: string): Promise<StoredTokens> {
  const r = await fetch(apiUrl('/v1/auth/telegram'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData }),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || `HTTP ${r.status}`);
  }
  const data = (await r.json()) as StoredTokens;
  saveTokens(data);
  return data;
}

// Single in-flight refresh — concurrent 401s share the same /refresh call so
// we don't burn the (one-shot) refresh token in parallel and end up logged
// out for everyone.
let inFlightRefresh: Promise<StoredTokens | null> | null = null;

async function refreshTokens(): Promise<StoredTokens | null> {
  if (inFlightRefresh) return inFlightRefresh;
  const current = loadTokens();
  if (!current?.refresh_token) return null;

  inFlightRefresh = (async () => {
    try {
      const r = await fetch(apiUrl('/v1/auth/refresh'), {
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
      // Network failure: don't wipe tokens — caller will retry.
      return null;
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

function buildRequest(path: string, opts: RequestInit, accessToken: string | null): RequestInit {
  const headers = new Headers(opts.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (
    opts.body != null &&
    typeof opts.body === 'string' &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }
  return { ...opts, headers };
}

export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const initial = loadTokens();
  let response = await fetch(apiUrl(path), buildRequest(path, opts, initial?.access_token || null));

  if (response.status !== 401 || !initial?.refresh_token) {
    return response;
  }

  // Don't recurse on the refresh endpoint itself.
  if (path.includes('/v1/auth/refresh')) {
    return response;
  }

  const refreshed = await refreshTokens();
  if (!refreshed) {
    return response;
  }

  // Body streams can only be read once; rebuild the request from the same
  // opts and send with the new access token.
  response = await fetch(apiUrl(path), buildRequest(path, opts, refreshed.access_token));
  return response;
}

export async function readJsonSafe<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw || !raw.trim()) {
    return {} as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`JSON_PARSE_ERROR_${response.status}`);
  }
}
