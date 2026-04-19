/**
 * scaleAgent.ts — tarozi (electronic scale) uchun lokal agent klient.
 *
 * Endpoints (served by print-agent):
 *   GET /scale/read   -> { weight, unit, stable, raw, ts }
 *   GET /scale/ports  -> list of serial ports available on the PC
 *
 * Agent run-time env / config is the same as for printing (VITE_PRINT_AGENT_URL,
 * VITE_PRINT_AGENT_SECRET) — the same daemon serves both.
 */

const DEFAULT_URL = 'http://127.0.0.1:9100';

export type ScaleReading = {
  weight: number;
  unit: string;
  stable: boolean;
  raw?: string;
  ts?: number;
};

export type ScalePortInfo = {
  path: string;
  manufacturer: string | null;
  pnpId: string | null;
  serialNumber: string | null;
  vendorId: string | null;
  productId: string | null;
  friendlyName: string | null;
};

type AgentResponse<T> =
  | { ok: true; data?: T }
  | { ok: false; error: { code?: string; message?: string; details?: unknown } };

function readEnv(name: string): string | undefined {
  const metaEnv: Record<string, string | undefined> = (import.meta as any)?.env || {};
  const win = typeof window !== 'undefined' ? (window as any) : undefined;
  return (metaEnv[name] || win?.__POS_ENV__?.[name]) as string | undefined;
}

function getAgentConfig(): { baseUrl: string; secret?: string } {
  const baseUrl = (readEnv('VITE_PRINT_AGENT_URL') || DEFAULT_URL).replace(/\/$/, '');
  const secret = readEnv('VITE_PRINT_AGENT_SECRET');
  return { baseUrl, secret };
}

async function agentFetch<T>(path: string, timeoutMs = 4000): Promise<AgentResponse<T>> {
  const { baseUrl, secret } = getAgentConfig();
  const headers: Record<string, string> = {};
  if (secret) headers.Authorization = `Bearer ${secret}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit',
    });
    if (!res.ok && res.status !== 200) {
      let body: any = null;
      try { body = await res.json(); } catch { /* ignore */ }
      return {
        ok: false,
        error: {
          code: body?.error?.code || `HTTP_${res.status}`,
          message: body?.error?.message || `Scale agent HTTP ${res.status}`,
        },
      };
    }
    return (await res.json()) as AgentResponse<T>;
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    return {
      ok: false,
      error: {
        code: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: err?.message || (isAbort ? 'Scale read timeout' : 'Failed to reach agent'),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Returns the latest weight reading or throws with a user-facing message. */
export async function readScaleWeight(timeoutMs = 4000): Promise<ScaleReading> {
  const resp = await agentFetch<ScaleReading>('/scale/read', timeoutMs);
  if (!resp.ok) {
    const err = new Error(resp.error?.message || 'Scale read failed');
    (err as any).code = resp.error?.code || 'SCALE_READ_FAILED';
    throw err;
  }
  const data = resp.data as ScaleReading | undefined;
  if (!data || typeof data.weight !== 'number') {
    throw new Error('Malformed scale response');
  }
  return data;
}

export async function listScalePorts(): Promise<ScalePortInfo[]> {
  const resp = await agentFetch<ScalePortInfo[]>('/scale/ports', 3000);
  if (!resp.ok) {
    const err = new Error(resp.error?.message || 'Could not list scale ports');
    (err as any).code = resp.error?.code || 'SCALE_UNAVAILABLE';
    throw err;
  }
  return Array.isArray(resp.data) ? resp.data : [];
}

export async function isScaleAgentAvailable(): Promise<boolean> {
  const resp = await agentFetch<{ ok: true }>('/health', 1200);
  return Boolean(resp.ok);
}
