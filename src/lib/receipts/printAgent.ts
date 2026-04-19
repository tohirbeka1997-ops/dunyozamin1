/**
 * Print Agent client
 * ----------------------------------------------------------------------------
 * Talks to the local `pos-print-agent` HTTP daemon running on the cashier PC
 * (default: http://127.0.0.1:9100). Used by the web/SaaS build — when the
 * browser cannot reach the local USB / Windows printer, the agent bridges
 * the gap.
 *
 * The agent is configured via Vite env vars (see .env.example):
 *   VITE_PRINT_AGENT_URL    default: http://127.0.0.1:9100
 *   VITE_PRINT_AGENT_SECRET optional Bearer token — must match agent config.json
 */
import type { ReceiptLine } from './receiptTextBuilder';

const DEFAULT_URL = 'http://127.0.0.1:9100';

export type PrintAgentHealth = {
  ok: boolean;
  agent?: string;
  version?: string;
  platform?: string;
  printer?: { interface?: string; type?: string };
  time?: string;
};

type AgentResponse<T> = { ok: true; data?: T } | { ok: false; error: { code?: string; message?: string; details?: unknown } };

function readEnv(name: string): string | undefined {
  const metaEnv: Record<string, string | undefined> = (import.meta as any)?.env || {};
  const win = typeof window !== 'undefined' ? (window as any) : undefined;
  return (metaEnv[name] || win?.__POS_ENV__?.[name]) as string | undefined;
}

export function getPrintAgentConfig(): { baseUrl: string; secret?: string } {
  const baseUrl = (readEnv('VITE_PRINT_AGENT_URL') || DEFAULT_URL).replace(/\/$/, '');
  const secret = readEnv('VITE_PRINT_AGENT_SECRET');
  return { baseUrl, secret };
}

async function agentFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 12000
): Promise<AgentResponse<T>> {
  const { baseUrl, secret } = getPrintAgentConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
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
          message: body?.error?.message || `Print agent HTTP ${res.status}`,
        },
      };
    }
    const body = (await res.json()) as AgentResponse<T>;
    return body;
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    return {
      ok: false,
      error: {
        code: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: err?.message || (isAbort ? 'Print agent timeout' : 'Failed to reach print agent'),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns true if the local print agent is reachable and running.
 * Never throws — use this for UI "Print agent connected?" indicators.
 */
export async function isPrintAgentAvailable(timeoutMs = 1200): Promise<boolean> {
  const resp = await agentFetch<PrintAgentHealth>('/health', { method: 'GET' }, timeoutMs);
  return Boolean(resp.ok);
}

export async function getPrintAgentHealth(timeoutMs = 1500): Promise<PrintAgentHealth | null> {
  const resp = await agentFetch<PrintAgentHealth>('/health', { method: 'GET' }, timeoutMs);
  if (!resp.ok) return null;
  return (resp.data as PrintAgentHealth) || { ok: true };
}

export type AgentPrintOptions = {
  charsPerLine?: number;
  feedLines?: number;
  cut?: boolean;
  timeoutMs?: number;
};

export async function printReceiptViaAgent(
  lines: ReceiptLine[],
  options?: AgentPrintOptions
): Promise<void> {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Empty receipt');
  }
  const resp = await agentFetch<unknown>(
    '/print',
    { method: 'POST', body: JSON.stringify({ lines, options }) },
    Math.max(2000, Number(options?.timeoutMs ?? 15000))
  );
  if (!resp.ok) {
    const code = resp.error?.code || 'PRINT_FAILED';
    const message = resp.error?.message || 'Print agent failed';
    const error = new Error(message);
    (error as any).code = code;
    throw error;
  }
}

export async function printTestReceiptViaAgent(): Promise<void> {
  const resp = await agentFetch<unknown>('/print/test', { method: 'POST' }, 15000);
  if (!resp.ok) {
    const msg = resp.error?.message || 'Print agent test failed';
    throw new Error(msg);
  }
}
