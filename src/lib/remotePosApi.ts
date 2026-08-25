/**
 * Browser / Telegram WebView: mirror `electron/preload.cjs` `window.posApi` via HOST HTTP RPC.
 *
 * Auth model:
 *   - Bootstrap token  = `VITE_POS_RPC_SECRET`
 *       * used ONLY for `pos:auth:login`, `pos:auth:requestPasswordReset`,
 *         `pos:auth:confirmPasswordReset`, `pos:health`, `pos:appConfig:get`.
 *       * All other calls require a session token.
 *   - Session token    = returned by `pos:auth:login` and stored in
 *       `localStorage["pos_session_token"]`. All subsequent requests send it
 *       as `Authorization: Bearer <session-token>`.
 *   - On 401 the stored token is cleared and a `pos:auth:required` DOM event
 *     is dispatched so the app can redirect to /login.
 */

import {
  readSessionValue,
  writeSessionValue,
  removeSessionValue,
} from '@/lib/auth/sessionPersistence';
import { downloadBlob } from '@/lib/exportHelpers';

const DB_UPLOAD_CONFIRM_TEXT = 'TASDIQLAYMAN';

type RpcEnvelope<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: unknown } };

type DbUploadProgress = { percent?: number; bytesSent?: number; totalBytes?: number };

const dbUploadProgressListeners = new Set<(progress: DbUploadProgress) => void>();

function notifyDbUploadProgress(progress: DbUploadProgress) {
  for (const listener of dbUploadProgressListeners) {
    try {
      listener(progress);
    } catch {
      // ignore listener errors
    }
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function defaultBackupFileName(): string {
  const d = new Date();
  const ts =
    String(d.getFullYear()) +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    '-' +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds());
  return `pos-backup-${ts}.db`;
}

function bufferFromExportData(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data && typeof data === 'object') {
    const obj = data as { type?: string; data?: number[] | string };
    if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
      return new Uint8Array(obj.data);
    }
    if (typeof obj.data === 'string') {
      return base64ToUint8Array(obj.data);
    }
  }
  if (typeof data === 'string') {
    return base64ToUint8Array(data);
  }
  throw new Error('Invalid backup data from server');
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkLen = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkLen) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkLen));
  }
  return btoa(binary);
}

function pickDbFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.db,application/octet-stream';
    input.style.display = 'none';
    const cleanup = () => {
      input.remove();
    };
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      cleanup();
    });
    document.body.appendChild(input);
    input.click();
    window.setTimeout(() => {
      if (input.isConnected && !input.files?.length) {
        resolve(null);
        cleanup();
      }
    }, 60_000);
  });
}

async function downloadDatabaseToPcOverRpc(
  baseUrl: string,
  secret: string,
): Promise<RpcEnvelope<{ canceled?: boolean; filePath?: string; fileName?: string; size?: number }>> {
  try {
    const res = await remoteInvoke(baseUrl, secret, 'pos:database:export', 'manual');
    if (!res.success) return res;

    const exportData = res.data as {
      ok?: boolean;
      fileName?: string;
      size?: number;
      data?: unknown;
      error?: string;
    };
    if (!exportData?.ok) {
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: exportData?.error || "Serverdan zaxira olib bo'lmadi",
        },
      };
    }

    const bytes = bufferFromExportData(exportData.data);
    const fileName = exportData.fileName || defaultBackupFileName();
    downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), fileName);

    return {
      success: true,
      data: {
        canceled: false,
        fileName,
        size: bytes.length,
      },
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function uploadDatabaseToServerOverRpc(
  baseUrl: string,
  secret: string,
  payload?: { confirmText?: string },
): Promise<
  RpcEnvelope<{
    canceled?: boolean;
    fileName?: string;
    size?: number;
    restartRequired?: boolean;
    relaunchScheduled?: boolean;
  }>
> {
  const confirmText = String(payload?.confirmText || '').trim();
  if (confirmText !== DB_UPLOAD_CONFIRM_TEXT) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `"${DB_UPLOAD_CONFIRM_TEXT}" deb yozib tasdiqlang`,
      },
    };
  }

  const file = await pickDbFile();
  if (!file) {
    return { success: true, data: { canceled: true } };
  }
  if (file.size <= 0) {
    return {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: "Tanlangan fayl bo'sh yoki noto'g'ri" },
    };
  }

  try {
    const beginRes = await remoteInvoke(baseUrl, secret, 'pos:database:uploadBegin', [
      { fileName: file.name || 'pos-upload.db', totalSize: file.size },
    ]);
    if (!beginRes.success) return beginRes;

    const beginData = beginRes.data as { uploadId?: string; chunkSize?: number; maxBytes?: number };
    const uploadId = String(beginData?.uploadId || '').trim();
    if (!uploadId) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Server upload session boshlanmadi' },
      };
    }

    const chunkSize = Math.max(256 * 1024, Number(beginData?.chunkSize) || 3 * 1024 * 1024);
    const fileBuffer = await file.arrayBuffer();
    let offset = 0;
    let index = 0;

    while (offset < file.size) {
      const end = Math.min(offset + chunkSize, file.size);
      const chunk = fileBuffer.slice(offset, end);
      const chunkRes = await remoteInvoke(baseUrl, secret, 'pos:database:uploadChunk', [
        {
          uploadId,
          index,
          data: arrayBufferToBase64(chunk),
        },
      ]);
      if (!chunkRes.success) return chunkRes;

      offset = end;
      index += 1;
      notifyDbUploadProgress({
        percent: Math.min(99, Math.round((offset / file.size) * 100)),
        bytesSent: offset,
        totalBytes: file.size,
      });
    }

    const finalizeRes = await remoteInvoke(baseUrl, secret, 'pos:database:uploadFinalize', [
      { uploadId },
    ]);
    if (!finalizeRes.success) return finalizeRes;

    notifyDbUploadProgress({
      percent: 100,
      bytesSent: file.size,
      totalBytes: file.size,
    });

    const finalizeData = finalizeRes.data as {
      restartRequired?: boolean;
      relaunchScheduled?: boolean;
    };

    return {
      success: true,
      data: {
        canceled: false,
        fileName: file.name,
        size: file.size,
        restartRequired: !!finalizeData?.restartRequired,
        relaunchScheduled: !!finalizeData?.relaunchScheduled,
      },
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

const STORAGE_KEY = 'pos_session_token';
const STORAGE_EXP_KEY = 'pos_session_expires_at';
const STORAGE_USER_KEY = 'auth_user';
// Multi-tenant additions (Bosqich 16):
//   * pos_tenant_slug     — tenant the current session is pinned to (informational;
//                           server enforces tenant binding via the token itself).
//   * pos_auth_scope      — "tenant" (default) or "master" when signed in via
//                           pos:master:login. Drives admin UI gating.
const STORAGE_TENANT_KEY = 'pos_tenant_slug';
const STORAGE_SCOPE_KEY  = 'pos_auth_scope';

const PUBLIC_CHANNELS = new Set<string>([
  'pos:auth:login',
  'pos:auth:requestPasswordReset',
  'pos:auth:confirmPasswordReset',
  'pos:health',
  'pos:appConfig:get',
  // Login page — tenant logo + colours (https URLs and #RRGGBB only server-side).
  'pos:tenants:publicProfile',
  // Master-scope login is callable without any credential (it IS the credential
  // gate). It must NOT use a stale tenant session token — pin it to the
  // bootstrap secret bearer instead.
  'pos:master:login',
]);

// Channels that route to the MASTER DB (super-admin scope). They never target
// a tenant — the `tenant` payload field is ignored for them server-side, but
// the client should also avoid attaching a stale tenantSlug so the intent is
// unambiguous in audit logs.
const MASTER_CHANNELS = new Set<string>([
  'pos:master:login',
  'pos:master:me',
  'pos:tenants:list',
  'pos:tenants:get',
  'pos:tenants:create',
  'pos:tenants:disable',
  'pos:tenants:enable',
  'pos:tenants:setBranding',
]);

export function getSessionToken(): string | null {
  try {
    const token = readSessionValue(STORAGE_KEY);
    if (!token) return null;
    const expAt = readSessionValue(STORAGE_EXP_KEY);
    if (expAt) {
      const ms = Date.parse(String(expAt).replace(' ', 'T') + 'Z');
      if (Number.isFinite(ms) && ms > 0 && ms <= Date.now()) {
        removeSessionValue(STORAGE_KEY);
        removeSessionValue(STORAGE_EXP_KEY);
        return null;
      }
    }
    return token;
  } catch {
    return null;
  }
}

/** True when the renderer is using HTTP RPC (browser / Telegram WebView). */
export function isRemoteRpcMode(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const api = (window as Window & { posApi?: { _session?: { hasToken?: () => boolean } } }).posApi;
    return !!(api?._session && typeof api._session.hasToken === 'function');
  } catch {
    return false;
  }
}

/**
 * Drop any cached web session before the login form runs RPC. Prevents stale
 * `pos_session_token` from being sent on authenticated channels while the
 * operator is trying to sign in again.
 */
export function clearRemoteSessionForLogin(): void {
  setSessionToken(null);
  removeSessionValue(STORAGE_USER_KEY);
}

export function setSessionToken(token: string | null, expiresAt?: string | null): void {
  try {
    if (token) {
      writeSessionValue(STORAGE_KEY, token);
      if (expiresAt) writeSessionValue(STORAGE_EXP_KEY, String(expiresAt));
      else removeSessionValue(STORAGE_EXP_KEY);
    } else {
      removeSessionValue(STORAGE_KEY);
      removeSessionValue(STORAGE_EXP_KEY);
      // When the session is cleared (logout, 401) tenant + scope become
      // stale. Drop them together so no UI can reach back to stale admin
      // views without a fresh login. These are UI hints kept in localStorage.
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(STORAGE_TENANT_KEY);
          localStorage.removeItem(STORAGE_SCOPE_KEY);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

// --- Tenant slug + auth scope --------------------------------------------
// Kept separate from token storage because the token is enough for the
// server — these two values exist purely to drive the CLIENT UI (which tab
// to show, which route to redirect to). They are NOT trusted on the
// server: the server re-derives everything from the token.

export function getTenantSlug(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(STORAGE_TENANT_KEY);
  } catch { return null; }
}

export function setTenantSlug(slug: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (slug) localStorage.setItem(STORAGE_TENANT_KEY, slug);
    else localStorage.removeItem(STORAGE_TENANT_KEY);
  } catch { /* ignore */ }
}

export type AuthScope = 'tenant' | 'master';

export function getAuthScope(): AuthScope | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(STORAGE_SCOPE_KEY);
    return v === 'master' || v === 'tenant' ? v : null;
  } catch { return null; }
}

export function setAuthScope(scope: AuthScope | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (scope) localStorage.setItem(STORAGE_SCOPE_KEY, scope);
    else localStorage.removeItem(STORAGE_SCOPE_KEY);
  } catch { /* ignore */ }
}

/**
 * Best-effort subdomain → tenant slug extraction.
 *
 * Rule: `<slug>.<anything>` where `<slug>` matches the server-side regex
 * (`[a-z0-9][a-z0-9_-]{1,39}`). Two-label domains like `example.com`, bare
 * IPs, and `localhost` return null so the UI falls back to a manual field.
 *
 * This runs on every page load — it must stay cheap and dependency-free.
 */
export function extractTenantSlugFromHost(host?: string | null): string | null {
  const h = (host ?? (typeof window !== 'undefined' ? window.location?.hostname : null) ?? '').toLowerCase();
  if (!h) return null;
  if (h === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
  const parts = h.split('.');
  if (parts.length < 3) return null;
  const slug = parts[0];
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(slug)) return null;
  // Reserved subdomains — server rejects them as slugs anyway; bail early
  // so the UI doesn't light up a misleading "active tenant" badge.
  if (['www', 'admin', 'api', 'app'].includes(slug)) return null;
  return slug;
}

function dispatchAuthRequired(reason: string) {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('pos:auth:required', { detail: { reason } }));
    }
  } catch {
    // ignore
  }
}

/**
 * Centralized, user-facing RPC notice. Dispatched for TRANSPORT-level problems
 * (rate-limit / network / 5xx) so the operator is never left staring at a dead
 * button. A React listener (`RpcNotifications`) turns these into toasts. We do
 * NOT emit these for ordinary business errors (validation/not-found/forbidden)
 * or auth-required — those are handled by the calling screen / auth flow.
 */
export type RpcNoticeDetail = {
  code: string;
  message: string;
  /** 'info' while auto-retrying, 'error' for a final failure. */
  level: 'info' | 'error';
  channel: string;
};

function notifyRpc(detail: RpcNoticeDetail) {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('pos:rpc:notice', { detail }));
    }
  } catch {
    // ignore
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function remoteInvoke(
  baseUrl: string,
  bootstrapSecret: string,
  channel: string,
  ...args: unknown[]
): Promise<
  | { success: true; data: unknown }
  | { success: false; error: { code: string; message: string; details?: unknown } }
> {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/rpc`;

  // Pick the correct bearer:
  //   - public/bootstrap channels use the shared secret (login, health, ...)
  //   - everything else uses the session token; if none we still try the
  //     shared secret as a fallback so single-user / legacy installs keep
  //     working (admin-only channels are blocked server-side anyway).
  const sessionToken = getSessionToken();
  if (!PUBLIC_CHANNELS.has(channel) && !sessionToken) {
    return {
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Not signed in',
        details: null,
      },
    };
  }
  const bearer = PUBLIC_CHANNELS.has(channel) ? bootstrapSecret : sessionToken!;

  // Multi-tenant payload field. Rules:
  //   * pos:auth:login — tenant MUST be in the payload (server can't guess).
  //     We take it from the FIRST positional argument if it's `{ tenant }`,
  //     otherwise from localStorage / env / subdomain (in that order).
  //   * Master channels — never send tenant (intent must be unambiguous).
  //   * Any other call — send the stored tenant slug as a hint; the server
  //     ignores it unless using adminBypass (it cross-checks with the
  //     session-bound tenant to prevent payload spoofing).
  let payloadTenant: string | undefined;
  if (!MASTER_CHANNELS.has(channel)) {
    if (channel === 'pos:auth:login' && args.length > 0 && args[0] && typeof args[0] === 'object') {
      const first = args[0] as { tenant?: unknown };
      if (typeof first.tenant === 'string' && first.tenant) {
        payloadTenant = first.tenant;
        // Strip tenant from args — server expects positional [username, password].
        const { tenant: _tenant, username, password } = first as { tenant?: string; username?: string; password?: string };
        args = [username, password];
      }
    }
    if (!payloadTenant) {
      const stored = getTenantSlug();
      if (stored) payloadTenant = stored;
      else if (
        channel === 'pos:auth:requestPasswordReset' ||
        channel === 'pos:auth:confirmPasswordReset'
      ) {
        const fromHost = extractTenantSlugFromHost();
        if (fromHost) payloadTenant = fromHost;
      }
    }
  }

  const body: Record<string, unknown> = { channel, args };
  if (payloadTenant) body.tenant = payloadTenant;

  // Login is never auto-retried (avoid lockout churn); everything else gets a
  // few attempts so transient network blips and HTTP 429 back-pressure recover
  // on their own. Retrying writes is SAFE because the POS sale path carries a
  // stable idempotency key (`order_uuid`) — the server dedups duplicates.
  const maxAttempts = channel === 'pos:auth:login' ? 1 : 4;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
          // ngrok free: HTML sahifada "Visit Site" chiqadi; RPC fetch uchun ogohlantirishni aylanib o'tish
          'ngrok-skip-browser-warning': '1',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // HTTP 401 => token is invalid / expired. Clear local state and notify app.
      if (res.status === 401 && !PUBLIC_CHANNELS.has(channel)) {
        setSessionToken(null);
        dispatchAuthRequired('expired_or_invalid');
      }

      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        const retryAfterMs =
          retryAfter && Number.isFinite(Number(retryAfter))
            ? Math.max(0, Math.round(Number(retryAfter) * 1000))
            : 0;
        const canRetry = channel !== 'pos:auth:login' && attempt < maxAttempts - 1;

        // Auto-retry with backoff (0.5s, 1s, 2s ...) honoring Retry-After.
        if (canRetry) {
          notifyRpc({
            code: 'RATE_LIMITED',
            level: 'info',
            channel,
            message: "Juda ko'p so'rov yuborildi, bir lahzadan keyin qayta urinilmoqda",
          });
          const backoff = retryAfterMs || 500 * 2 ** attempt;
          await sleepMs(backoff);
          continue;
        }

        const waitHint = retryAfter ? ` ${retryAfter}s` : '';
        const rateMsg =
          channel === 'pos:auth:login'
            ? `Juda ko'p kirish urinishi. Biroz kutib, qayta urinib ko'ring.${waitHint}`
            : `Server band (429). Biroz kutib, qayta urinib ko'ring.${waitHint}`;
        // Login surfaces its own toast; for everything else the retries are
        // exhausted — make the final failure visible (never silent).
        if (channel !== 'pos:auth:login') {
          notifyRpc({ code: 'RATE_LIMITED', level: 'error', channel, message: rateMsg });
        }
        return {
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: rateMsg,
            details: { status: res.status, retryAfter },
          },
        };
      }

      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!json || typeof json !== 'object') {
        // Retry transient server hiccups (5xx / proxy errors) before failing.
        if (res.status >= 500 && attempt < maxAttempts - 1) {
          notifyRpc({
            code: 'INTERNAL_ERROR',
            level: 'info',
            channel,
            message: 'Server javob bermadi, qayta urinilmoqda...',
          });
          await sleepMs(500 * 2 ** attempt);
          continue;
        }
        const invalidMsg = `Server bilan aloqa xatosi (HTTP ${res.status}). Qayta urinib ko'ring.`;
        notifyRpc({ code: 'INTERNAL_ERROR', level: 'error', channel, message: invalidMsg });
        return {
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: `Invalid RPC response (HTTP ${res.status})`,
            details: { status: res.status },
          },
        };
      }
      if (json.ok === false && json.error && typeof json.error === 'object') {
        const e = json.error as { code?: string; message?: string; details?: unknown };
        // Bootstrap secret mismatch on login looks like an expired session server-side.
        if (
          res.status === 401 &&
          PUBLIC_CHANNELS.has(channel) &&
          e.code === 'AUTH_ERROR' &&
          channel === 'pos:auth:login'
        ) {
          return {
            success: false,
            error: {
              code: 'AUTH_ERROR',
              message: 'Tizim sozlamasi xato (RPC kaliti mos emas). Administratorga murojaat qiling.',
              details: { status: res.status },
            },
          };
        }
        if (e.code === 'AUTH_ERROR' && !PUBLIC_CHANNELS.has(channel)) {
          setSessionToken(null);
          dispatchAuthRequired('auth_error');
        }
        // Surface genuine SERVER errors (5xx) so they're never silent. Business
        // errors (4xx: validation / not-found / forbidden) are intentionally
        // left to the calling screen, which renders contextual messages.
        if (res.status >= 500) {
          notifyRpc({
            code: String(e.code || 'INTERNAL_ERROR'),
            level: 'error',
            channel,
            message: String(e.message || `Server xatosi (HTTP ${res.status})`),
          });
        }
        return {
          success: false,
          error: {
            code: String(e.code || 'ERROR'),
            message: String(e.message || 'RPC error'),
            details: { ...(typeof e.details === 'object' && e.details ? e.details as object : {}), status: res.status },
          },
        };
      }
      if (json.ok === true) {
        // Transparently capture the session token + tenant + scope from the
        // login flows so the rest of the app (stores, router guards) can
        // observe them via localStorage without manually threading them.
        if (channel === 'pos:auth:login') {
          const data = json.data as
            | {
                success?: boolean;
                token?: string;
                expiresAt?: string | null;
                tenant?: { slug?: string } | null;
                user?: { tenantSlug?: string | null } | null;
              }
            | null
            | undefined;
          if (data?.success && typeof data.token === 'string' && data.token.length > 0) {
            setSessionToken(data.token, data.expiresAt ?? null);
            const slug = data.tenant?.slug || data.user?.tenantSlug || null;
            setTenantSlug(slug);
            setAuthScope('tenant');
          }
        }
        if (channel === 'pos:master:login') {
          const data = json.data as
            | { success?: boolean; token?: string; expiresAt?: string | null }
            | null
            | undefined;
          if (data?.success && typeof data.token === 'string' && data.token.length > 0) {
            setSessionToken(data.token, data.expiresAt ?? null);
            // Master sessions are NOT pinned to a tenant — clear any leftover slug.
            setTenantSlug(null);
            setAuthScope('master');
          }
        }
        // On logout, always clear local state regardless of server response shape.
        if (channel === 'pos:auth:logout') {
          setSessionToken(null);
        }
        return { success: true, data: json.data };
      }
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Unexpected RPC payload', details: json },
      };
    } catch (e: unknown) {
      if (attempt < maxAttempts - 1) {
        await sleepMs(500 * (attempt + 1));
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      // Final transport failure — make it visible (never silent). Login keeps
      // its own form-level error handling.
      if (channel !== 'pos:auth:login') {
        notifyRpc({
          code: 'NETWORK_ERROR',
          level: 'error',
          channel,
          message: "Server bilan aloqa yo'q. Internet/ulanishni tekshirib, qayta urinib ko'ring.",
        });
      }
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: msg, details: null },
      };
    } finally {
      clearTimeout(t);
    }
  }

  return {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests', details: { status: 429 } },
  };
}

function createInvoker(baseUrl: string, secret: string) {
  return (channel: string) =>
    (...args: unknown[]) =>
      remoteInvoke(baseUrl, secret, channel, ...args);
}

async function uploadProductImageOverHttp(
  baseUrl: string,
  bootstrapSecret: string,
  file: File,
  productIdOrTempId?: string,
  index?: number,
) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/uploads/product-images`;
  const bearer = bootstrapSecret;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': file.name || 'product-image',
        'X-Product-Id': String(productIdOrTempId || ''),
        'X-Image-Index': String(index ?? 0),
        'ngrok-skip-browser-warning': '1',
      },
      body: file,
    });
    if (res.status === 401) {
      setSessionToken(null);
      dispatchAuthRequired('expired_or_invalid');
    }
    const payload = await res.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Invalid upload response (HTTP ${res.status})` },
      };
    }
    if (payload.ok === true) {
      return { success: true, data: payload.data };
    }
    return {
      success: false,
      error: payload.error || { code: 'UPLOAD_ERROR', message: `Upload failed (HTTP ${res.status})` },
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: { code: 'NETWORK_ERROR', message: error instanceof Error ? error.message : String(error) },
    };
  }
}

/** Same nested shape as `electron/preload.cjs` (channels must match POS IPC). */
export function createRemotePosApi(baseUrl: string, secret: string) {
  const inv = createInvoker(baseUrl, secret);
  const invokeWithFallback =
    (primaryChannel: string, fallbackChannel: string) =>
    async (...args: unknown[]) => {
      const primary = await remoteInvoke(baseUrl, secret, primaryChannel, ...args);
      if (primary.success) {
        return primary;
      }

      const primaryError = (primary as { error?: { code?: string; message?: string } }).error;
      const msg = String(primaryError?.message || '').toLowerCase();
      const code = String(primaryError?.code || '').toUpperCase();
      const unknownChannel =
        code === 'NOT_FOUND' && (msg.includes('unknown channel') || msg.includes(primaryChannel.toLowerCase()));

      if (!unknownChannel) {
        return primary;
      }

      return remoteInvoke(baseUrl, secret, fallbackChannel, ...args);
    };

  return {
    appConfig: {
      get: inv('pos:appConfig:get'),
      set: inv('pos:appConfig:set'),
      reset: inv('pos:appConfig:reset'),
    },
    products: {
      list: inv('pos:products:list'),
      searchScreen: inv('pos:products:searchScreen'),
      count: inv('pos:products:count'),
      get: inv('pos:products:get'),
      getBySku: inv('pos:products:getBySku'),
      getByBarcode: inv('pos:products:getByBarcode'),
      getNextSku: inv('pos:products:getNextSku'),
      getNextBarcode: inv('pos:products:getNextBarcode'),
      getNextBarcodeForUnit: inv('pos:products:getNextBarcodeForUnit'),
      create: inv('pos:products:create'),
      update: inv('pos:products:update'),
      delete: inv('pos:products:delete'),
      bulkAdjustPrices: inv('pos:products:bulkAdjustPrices'),
      undoBulkPriceUpdate: inv('pos:products:undoBulkPriceUpdate'),
      listScanIndex: inv('pos:products:listScanIndex'),
      resolveScan: inv('pos:products:resolveScan'),
      exportScaleRongtaTxt: inv('pos:products:exportScaleRongtaTxt'),
      exportScaleSharqTxt: inv('pos:products:exportScaleSharqTxt'),
      exportScaleCsv3: inv('pos:products:exportScaleCsv3'),
      exportScaleLegacyTxt: inv('pos:products:exportScaleLegacyTxt'),
      getImages: inv('pos:products:getImages'),
      addImage: inv('pos:products:addImage'),
      removeImage: inv('pos:products:removeImage'),
      setImages: inv('pos:products:setImages'),
    },
    categories: {
      list: inv('pos:categories:list'),
      get: inv('pos:categories:get'),
      create: inv('pos:categories:create'),
      update: inv('pos:categories:update'),
      delete: inv('pos:categories:delete'),
    },
    warehouses: {
      list: inv('pos:warehouses:list'),
      get: inv('pos:warehouses:get'),
      create: inv('pos:warehouses:create'),
      update: inv('pos:warehouses:update'),
      delete: inv('pos:warehouses:delete'),
    },
    customers: {
      list: inv('pos:customers:list'),
      get: inv('pos:customers:get'),
      getByLoyaltyQr: inv('pos:customers:getByLoyaltyQr'),
      getLoyaltyCard: inv('pos:customers:getLoyaltyCard'),
      findByPhone: inv('pos:customers:findByPhone'),
      create: inv('pos:customers:create'),
      update: inv('pos:customers:update'),
      delete: inv('pos:customers:delete'),
      updateBalance: inv('pos:customers:updateBalance'),
      receivePayment: inv('pos:customers:receivePayment'),
      getTotalDebt: inv('pos:customers:getTotalDebt'),
      getPayments: inv('pos:customers:getPayments'),
      getLedger: inv('pos:customers:getLedger'),
      getLedgerCount: inv('pos:customers:getLedgerCount'),
      exportCsv: inv('pos:customers:exportCsv'),
      getBonusLedger: inv('pos:customers:getBonusLedger'),
      adjustBonusPoints: inv('pos:customers:adjustBonusPoints'),
    },
    creditReminders: {
      list: inv('pos:creditReminders:list'),
      listOpenOrders: inv('pos:creditReminders:listOpenOrders'),
      updateDueDate: inv('pos:creditReminders:updateDueDate'),
      send: inv('pos:creditReminders:send'),
      listStaffAlerts: inv('pos:creditReminders:listStaffAlerts'),
      ackStaffAlert: inv('pos:creditReminders:ackStaffAlert'),
    },
    suppliers: {
      list: inv('pos:suppliers:list'),
      get: inv('pos:suppliers:get'),
      create: inv('pos:suppliers:create'),
      update: inv('pos:suppliers:update'),
      delete: inv('pos:suppliers:delete'),
      getLedger: inv('pos:suppliers:getLedger'),
      createPayment: inv('pos:suppliers:createPayment'),
      deletePayment: inv('pos:suppliers:deletePayment'),
      getPayments: inv('pos:suppliers:getPayments'),
      getPurchaseSummary: inv('pos:suppliers:getPurchaseSummary'),
      createReturn: inv('pos:suppliers:createReturn'),
      getReturn: inv('pos:suppliers:getReturn'),
      listReturns: inv('pos:suppliers:listReturns'),
      listReturnableProducts: inv('pos:suppliers:listReturnableProducts'),
    },
    pricing: {
      getTiers: inv('pos:pricing:getTiers'),
      getPrice: inv('pos:pricing:getPrice'),
      setPrice: inv('pos:pricing:setPrice'),
    },
    promotions: {
      list: inv('pos:promotions:list'),
      get: inv('pos:promotions:get'),
      create: inv('pos:promotions:create'),
      update: inv('pos:promotions:update'),
      delete: inv('pos:promotions:delete'),
      activate: inv('pos:promotions:activate'),
      pause: inv('pos:promotions:pause'),
      applyToCart: inv('pos:promotions:applyToCart'),
    },
    inventory: {
      getBalances: inv('pos:inventory:getBalances'),
      getMoves: inv('pos:inventory:getMoves'),
      getProductLedger: inv('pos:inventory:getProductLedger'),
      adjustStock: inv('pos:inventory:adjustStock'),
      getProductPurchaseHistory: inv('pos:inventory:getProductPurchaseHistory'),
      getProductSalesHistory: inv('pos:inventory:getProductSalesHistory'),
      getProductDetail: inv('pos:inventory:getProductDetail'),
      getCurrentStock: inv('pos:inventory:getCurrentStock'),
      getDeadStock: inv('pos:inventory:getDeadStock'),
      getStockTurnover: inv('pos:inventory:getStockTurnover'),
      getReorderSuggestions: inv('pos:inventory:getReorderSuggestions'),
      getBatchesByProduct: inv('pos:inventory:getBatchesByProduct'),
      getBatchReconcile: inv('pos:inventory:getBatchReconcile'),
      getBatchHealth: inv('pos:inventory:getBatchHealth'),
      repairBatchCoverage: inv('pos:inventory:repairBatchCoverage'),
      runBatchCutoverSnapshot: inv('pos:inventory:runBatchCutoverSnapshot'),
      createRevision: inv('pos:inventory:createRevision'),
      listRevisions: inv('pos:inventory:listRevisions'),
      getRevision: inv('pos:inventory:getRevision'),
      updateRevisionItemCount: inv('pos:inventory:updateRevisionItemCount'),
      clearRevisionItemCount: inv('pos:inventory:clearRevisionItemCount'),
      countRevisionByBarcode: inv('pos:inventory:countRevisionByBarcode'),
      bulkSetRevisionItemCounts: inv('pos:inventory:bulkSetRevisionItemCounts'),
      completeRevision: inv('pos:inventory:completeRevision'),
      cancelRevision: inv('pos:inventory:cancelRevision'),
    },
    sales: {
      createDraftOrder: inv('pos:sales:createDraftOrder'),
      addItem: inv('pos:sales:addItem'),
      removeItem: inv('pos:sales:removeItem'),
      updateItemQuantity: inv('pos:sales:updateItemQuantity'),
      setCustomer: inv('pos:sales:setCustomer'),
      finalizeOrder: inv('pos:sales:finalizeOrder'),
      getOrder: inv('pos:sales:getOrder'),
      completePOSOrder: inv('pos:sales:completePOSOrder'),
      refund: inv('pos:sales:refund'),
      list: inv('pos:sales:list'),
    },
    returns: {
      create: inv('pos:returns:create'),
      get: inv('pos:returns:get'),
      list: inv('pos:returns:list'),
      getOrderDetails: inv('pos:returns:getOrderDetails'),
      update: inv('pos:returns:update'),
      delete: inv('pos:returns:delete'),
      complete: inv('pos:returns:complete'),
    },
    purchases: {
      createOrder: inv('pos:purchases:createOrder'),
      updateOrder: inv('pos:purchases:updateOrder'),
      approve: inv('pos:purchases:approve'),
      receiveGoods: inv('pos:purchases:receiveGoods'),
      createReceipt: inv('pos:purchases:createReceipt'),
      deleteOrder: inv('pos:purchases:deleteOrder'),
      get: inv('pos:purchases:get'),
      list: inv('pos:purchases:list'),
      listExpenses: inv('pos:purchases:listExpenses'),
      addExpense: inv('pos:purchases:addExpense'),
      deleteExpense: inv('pos:purchases:deleteExpense'),
    },
    expenses: {
      listCategories: inv('pos:expenses:listCategories'),
      createCategory: inv('pos:expenses:createCategory'),
      updateCategory: inv('pos:expenses:updateCategory'),
      deleteCategory: inv('pos:expenses:deleteCategory'),
      list: inv('pos:expenses:list'),
      create: inv('pos:expenses:create'),
      update: inv('pos:expenses:update'),
      delete: inv('pos:expenses:delete'),
    },
    shifts: {
      open: inv('pos:shifts:open'),
      close: inv('pos:shifts:close'),
      get: inv('pos:shifts:get'),
      getActive: inv('pos:shifts:getActive'),
      getCurrent: inv('pos:shifts:getCurrent'),
      getSummary: async (payload: { shiftId?: string; shift_id?: string } | null | undefined) => {
        const raw = payload?.shiftId ?? payload?.shift_id;
        const shiftId = raw != null && String(raw).trim() ? String(raw).trim() : '';
        if (!shiftId) {
          return {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Faol smena topilmadi — shiftId kerak' },
          };
        }
        return inv('pos:shifts:getSummary')({ shiftId });
      },
      getStatus: inv('pos:shifts:getStatus'),
      require: inv('pos:shifts:require'),
      list: inv('pos:shifts:list'),
      cashIn: inv('pos:shifts:cashIn'),
      cashOut: inv('pos:shifts:cashOut'),
      listCashMovements: inv('pos:shifts:listCashMovements'),
    },
    reports: {
      dailySales: inv('pos:reports:dailySales'),
      dailySalesSQL: inv('pos:reports:dailySalesSQL'),
      topProducts: inv('pos:reports:topProducts'),
      productSales: inv('pos:reports:productSales'),
      promotionUsage: inv('pos:reports:promotionUsage'),
      stock: inv('pos:reports:stock'),
      returns: inv('pos:reports:returns'),
      profit: inv('pos:reports:profit'),
      profitAndLossSQL: inv('pos:reports:profitAndLossSQL'),
      inventoryValuation: inv('pos:reports:inventoryValuation'),
      inventoryValuationSummary: inv('pos:reports:inventoryValuationSummary'),
      batchReconciliation: inv('pos:reports:batchReconciliation'),
      actSverka: inv('pos:reports:actSverka'),
      productActSverkaByPeriod: inv('pos:reports:productActSverkaByPeriod'),
      productDocumentHistory: inv('pos:reports:productDocumentHistory'),
      customerActSverka: inv('pos:reports:customerActSverka'),
      supplierActSverka: inv('pos:reports:supplierActSverka'),
      productTraceability: inv('pos:reports:productTraceability'),
      supplierProductSales: inv('pos:reports:supplierProductSales'),
      cashFlow: inv('pos:reports:cashFlow'),
      cashDiscrepancies: inv('pos:reports:cashDiscrepancies'),
      aging: inv('pos:reports:aging'),
      paymentMethodsSummary: inv('pos:reports:paymentMethodsSummary'),
      cashierPerformance: inv('pos:reports:cashierPerformance'),
      customerSalesReport: inv('pos:reports:customerSalesReport'),
      customerAging: inv('pos:reports:customerAging'),
      supplierAging: inv('pos:reports:supplierAging'),
      supplierPaymentsDue: inv('pos:reports:supplierPaymentsDue'),
      vipCustomers: inv('pos:reports:vipCustomers'),
      loyaltyPointsSummary: inv('pos:reports:loyaltyPointsSummary'),
      lostCustomers: inv('pos:reports:lostCustomers'),
      customerProfitability: inv('pos:reports:customerProfitability'),
      deliveryAccuracy: inv('pos:reports:deliveryAccuracy'),
      deliveryDetails: inv('pos:reports:deliveryDetails'),
      priceHistory: inv('pos:reports:priceHistory'),
      productPriceSummary: inv('pos:reports:productPriceSummary'),
      purchasePlanning: inv('pos:reports:purchasePlanning'),
      abcAnalysis: inv('pos:reports:abcAnalysis'),
      purchaseSaleSpread: inv('pos:reports:purchaseSaleSpread'),
      purchaseVsSold: inv('pos:reports:purchaseVsSold'),
      spreadTimeSeries: inv('pos:reports:spreadTimeSeries'),
      latestPurchaseCosts: inv('pos:reports:getLatestPurchaseCosts'),
      cashierErrors: inv('pos:reports:cashierErrors'),
      cashierErrorDetails: inv('pos:reports:cashierErrorDetails'),
      shiftProductivity: inv('pos:reports:shiftProductivity'),
      productivitySummary: inv('pos:reports:productivitySummary'),
      fraudSignals: inv('pos:reports:fraudSignals'),
      fraudIncidents: inv('pos:reports:fraudIncidents'),
      deviceHealth: inv('pos:reports:deviceHealth'),
      deviceIncidents: inv('pos:reports:deviceIncidents'),
      auditLog: inv('pos:reports:auditLog'),
      priceChangeHistory: inv('pos:reports:priceChangeHistory'),
      executiveKPI: inv('pos:reports:executiveKPI'),
      executiveTrends: inv('pos:reports:executiveTrends'),
    },
    dashboard: {
      getStats: inv('pos:dashboard:getStats'),
      getAnalytics: inv('pos:dashboard:getAnalytics'),
      getLowStock: inv('pos:dashboard:getLowStock'),
    },
    settings: {
      get: inv('pos:settings:get'),
      set: inv('pos:settings:set'),
      getAll: inv('pos:settings:getAll'),
      delete: inv('pos:settings:delete'),
      testTelegramReport: inv('pos:settings:testTelegramReport'),
      testTelegramAiAnalysis: inv('pos:settings:testTelegramAiAnalysis'),
      testTelegramDailyPoster: inv('pos:settings:testTelegramDailyPoster'),
      openaiStatus: inv('pos:settings:openaiStatus'),
      resetDatabase: inv('pos:settings:resetDatabase'),
    },
    database: {
      // Electron-only IPC channels — over web RPC we proxy to export/chunked upload.
      downloadToPc: () => downloadDatabaseToPcOverRpc(baseUrl, secret),
      uploadToServer: (payload?: { confirmText?: string }) =>
        uploadDatabaseToServerOverRpc(baseUrl, secret, payload),
      onUploadProgress: (callback: (progress: DbUploadProgress) => void) => {
        if (typeof callback !== 'function') return () => {};
        dbUploadProgressListeners.add(callback);
        return () => {
          dbUploadProgressListeners.delete(callback);
        };
      },
    },
    exchangeRates: {
      getLatest: inv('pos:exchangeRates:getLatest'),
      list: inv('pos:exchangeRates:list'),
      upsert: inv('pos:exchangeRates:upsert'),
    },
    auth: {
      login: inv('pos:auth:login'),
      logout: inv('pos:auth:logout'),
      me: inv('pos:auth:me'),
      setSessionUser: inv('pos:auth:setSessionUser'),
      getUser: inv('pos:auth:getUser'),
      checkPermission: inv('pos:auth:checkPermission'),
      requestPasswordReset: inv('pos:auth:requestPasswordReset'),
      confirmPasswordReset: inv('pos:auth:confirmPasswordReset'),
    },
    // Multi-tenant surface (Bosqich 16). Server returns errors for these when
    // POS_MULTI_TENANT=0 — the frontend uses pos:health.multi_tenant to gate
    // access to the admin UI so users don't hit dead endpoints.
    master: {
      login: inv('pos:master:login'),
      me: inv('pos:master:me'),
    },
    tenants: {
      list: inv('pos:tenants:list'),
      get: inv('pos:tenants:get'),
      create: inv('pos:tenants:create'),
      disable: inv('pos:tenants:disable'),
      enable: inv('pos:tenants:enable'),
      publicProfile: inv('pos:tenants:publicProfile'),
      setBranding: inv('pos:tenants:setBranding'),
    },
    users: {
      list: inv('pos:users:list'),
      get: inv('pos:users:get'),
      create: inv('pos:users:create'),
      update: inv('pos:users:update'),
      delete: inv('pos:users:delete'),
      listLoginSessions: inv('pos:users:listLoginSessions'),
      resetPassword: inv('pos:users:resetPassword'),
    },
    quotes: {
      list: inv('pos:quotes:list'),
      get: inv('pos:quotes:get'),
      create: inv('pos:quotes:create'),
      update: inv('pos:quotes:update'),
      delete: inv('pos:quotes:delete'),
      generateNumber: inv('pos:quotes:generateNumber'),
      convertToSale: inv('pos:quotes:convertToSale'),
    },
    orders: {
      list: inv('pos:orders:list'),
      get: inv('pos:orders:get'),
      getByNumber: inv('pos:orders:getByNumber'),
      getByCustomer: inv('pos:orders:getByCustomer'),
      cancel: inv('pos:orders:cancel'),
    },
    couriers: {
      list: inv('pos:couriers:list'),
      upsert: inv('pos:couriers:upsert'),
      setActive: inv('pos:couriers:setActive'),
    },
    webOrders: {
      // Backward compatibility: some older server builds expose a legacy
      // channel name without the second colon.
      list: invokeWithFallback('pos:webOrders:list', 'pos:webOrdersList'),
      get: invokeWithFallback('pos:webOrders:get', 'pos:webOrdersGet'),
      updateStatus: invokeWithFallback('pos:webOrders:updateStatus', 'pos:webOrdersUpdateStatus'),
      update: invokeWithFallback('pos:webOrders:update', 'pos:webOrdersUpdate'),
      cancel: invokeWithFallback('pos:webOrders:cancel', 'pos:webOrdersCancel'),
      dispatchToCourier: invokeWithFallback('pos:webOrders:dispatchToCourier', 'pos:webOrdersDispatchToCourier'),
      countsByQueue: invokeWithFallback('pos:webOrders:countsByQueue', 'pos:webOrdersCountsByQueue'),
      reportSummary: invokeWithFallback('pos:webOrders:reportSummary', 'pos:webOrdersReportSummary'),
    },
    // Admin-managed mini-app home content (promo banners + daily deal). The
    // page (src/pages/MarketplaceContent.tsx) calls these via the same nested
    // shape as Electron preload — channel names MUST match rpcDispatch.cjs.
    marketplaceContent: {
      listBanners: inv('pos:marketplaceContent:listBanners'),
      saveBanner: inv('pos:marketplaceContent:saveBanner'),
      deleteBanner: inv('pos:marketplaceContent:deleteBanner'),
      reorderBanners: inv('pos:marketplaceContent:reorderBanners'),
      getDailyDeal: inv('pos:marketplaceContent:getDailyDeal'),
      setDailyDeal: inv('pos:marketplaceContent:setDailyDeal'),
      dailyDealHistory: inv('pos:marketplaceContent:dailyDealHistory'),
    },
    files: {
      selectSavePath: inv('pos:files:selectSavePath'),
      writeFile: inv('pos:files:writeFile'),
      readFile: inv('pos:files:readFile'),
      exists: inv('pos:files:exists'),
      saveTextFile: inv('pos:files:saveTextFile'),
      openTextFile: inv('pos:files:openTextFile'),
      selectImageFile: inv('pos:files:selectImageFile'),
      saveProductImage: inv('pos:files:saveProductImage'),
      uploadProductImage: (file: File, productIdOrTempId?: string, index?: number) =>
        uploadProductImageOverHttp(baseUrl, secret, file, productIdOrTempId, index),
      pathToFileUrl: inv('pos:files:pathToFileUrl'),
    },
    print: {
      receipt: inv('pos:print:receipt'),
    },
    health: inv('pos:health'),
    debug: {
      tableCounts: inv('pos:debug:tableCounts'),
    },
    // Non-channel helpers for the renderer layer.
    _session: {
      getToken: getSessionToken,
      setToken: setSessionToken,
      hasToken: () => !!getSessionToken(),
      getTenantSlug,
      setTenantSlug,
      getAuthScope,
      setAuthScope,
      extractTenantSlugFromHost,
    },
  };
}

export type RemotePosApi = ReturnType<typeof createRemotePosApi>;

export function installRemotePosApiIfConfigured(): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { posApi?: unknown };
  if (w.posApi) return;

  const rawBase = String(import.meta.env.VITE_POS_RPC_URL || '').trim();
  // SECURITY: `VITE_POS_RPC_SECRET` is a Vite env var, so it is COMPILED INTO
  // the client JS bundle and is effectively PUBLIC — anyone with the web app
  // can read it from the shipped assets. Treat it strictly as a low-trust
  // bootstrap credential, never as a real authorization secret:
  //   - The RPC server MUST rate-limit + scope what a raw bootstrap token can
  //     do (it should only mint a real, short-lived session token, not grant
  //     full data access on its own).
  //   - Rotate it on exposure (see deploy/scripts/rotate-secrets.sh).
  // The hosted/public web build intentionally OMITS this secret (see
  // .github/workflows/deploy-frontend.yml), so installRemotePosApiIfConfigured
  // is a no-op there. Proper fix (backend, out of scope): terminate RPC auth in
  // a server-side proxy so no shared secret ever reaches the browser.
  const secret = import.meta.env.VITE_POS_RPC_SECRET;
  if (!rawBase || !secret) return;

  // Safety net for web deploys: if a localhost RPC URL is accidentally baked
  // into production assets, route RPC to the current origin instead.
  let base = rawBase;
  try {
    const u = new URL(rawBase);
    const isLocalHost = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    if (isLocalHost && window.location.protocol === 'https:') {
      base = window.location.origin;
    }
  } catch {
    // Keep original base if URL parsing fails.
  }

  w.posApi = createRemotePosApi(String(base), String(secret));
}
