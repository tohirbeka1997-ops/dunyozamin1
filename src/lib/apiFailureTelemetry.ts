/**
 * Lightweight client telemetry for important API failures (5xx / timeout).
 * Uses existing console logger; does not require an external APM.
 */

export type ApiFailureTelemetry = {
  page: string;
  apiUrl: string;
  httpCode?: number | null;
  time?: string;
  userRole?: string | null;
  requestId?: string | null;
  message?: string | null;
};

export function reportApiFailure(event: ApiFailureTelemetry): void {
  const payload = {
    type: 'api_failure',
    page: event.page,
    apiUrl: event.apiUrl,
    httpCode: event.httpCode ?? null,
    time: event.time || new Date().toISOString(),
    userRole: event.userRole ?? null,
    requestId: event.requestId ?? null,
    message: event.message ?? null,
  };
  try {
    // Always emit — cashiers need ops visibility; APM hook can replace later.
    console.error('[telemetry:api_failure]', payload);
    if (typeof window !== 'undefined') {
      const w = window as Window & { __posApiFailures?: ApiFailureTelemetry[] };
      const list = w.__posApiFailures || [];
      list.push(payload);
      w.__posApiFailures = list.slice(-50);
    }
  } catch {
    /* never throw from telemetry */
  }
}

/** Extract HTTP status from common Error / IPC / fetch failure shapes. */
export function extractHttpStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as Record<string, unknown>;
  const candidates = [e.status, e.statusCode, e.httpStatus, (e as any).details?.httpStatus];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n >= 100) return n;
  }
  const msg = String((e as Error).message || e.code || '');
  const m = msg.match(/\b([45]\d{2})\b/);
  return m ? Number(m[1]) : null;
}
