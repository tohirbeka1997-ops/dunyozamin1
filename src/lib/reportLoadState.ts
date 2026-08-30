/**
 * Shared load-state helpers for report pages (loading / success / empty / error).
 */

import { extractHttpStatus, reportApiFailure, type ApiFailureTelemetry } from '@/lib/apiFailureTelemetry';

export type ReportLoadStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export type ReportLoadState<T> = {
  status: ReportLoadStatus;
  data: T;
  error: string | null;
  correlationId: string | null;
  loadedAt: string | null;
};

export function createReportCorrelationId(page: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `rpt-${page}-${Date.now()}-${suffix}`;
}

export function initialReportLoadState<T>(emptyValue: T): ReportLoadState<T> {
  return {
    status: 'idle',
    data: emptyValue,
    error: null,
    correlationId: null,
    loadedAt: null,
  };
}

export function resolveReportStatus<T>(
  data: T,
  isEmpty: (data: T) => boolean,
): 'success' | 'empty' {
  return isEmpty(data) ? 'empty' : 'success';
}

export function reportLoadErrorMessage(err: unknown, fallback = "Ma'lumotlarni yuklab bo'lmadi"): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

export function telemetryFromReportError(
  page: string,
  apiUrl: string,
  err: unknown,
  correlationId: string,
  userRole?: string | null,
): void {
  const event: ApiFailureTelemetry = {
    page,
    apiUrl,
    httpCode: extractHttpStatus(err),
    correlationId,
    userRole: userRole ?? null,
    message: reportLoadErrorMessage(err),
  };
  reportApiFailure(event);
}
