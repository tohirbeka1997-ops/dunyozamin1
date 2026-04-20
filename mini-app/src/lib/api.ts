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

export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const t = loadTokens();
  const headers = new Headers(opts.headers);
  if (t?.access_token) headers.set('Authorization', `Bearer ${t.access_token}`);
  if (
    opts.body != null &&
    typeof opts.body === 'string' &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(apiUrl(path), { ...opts, headers });
}
