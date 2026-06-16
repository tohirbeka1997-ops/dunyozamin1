/**
 * Utility to detect if running in Electron
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && 'posApi' in window && typeof (window as any).posApi === 'object';
}

/**
 * Get Electron API if available
 */
export function getElectronAPI(): any {
  if (isElectron()) {
    return (window as any).posApi;
  }
  return null;
}

/**
 * Check if Electron API is available, throw error if not
 */
export function requireElectron(): any {
  const api = getElectronAPI();
  if (!api) {
    throw new Error('This application requires Electron to run. Please use the desktop application.');
  }
  return api;
}

export const DUPLICATE_PHONE_MESSAGE_UZ = "Bu telefon raqami allaqachon ro'yxatdan o'tgan";
export const GENERIC_ERROR_MESSAGE_UZ = "Xatolik yuz berdi. Qayta urinib ko'ring.";

function isTechnicalErrorMessage(msg: string): boolean {
  const m = msg.trim();
  if (!m) return true;
  return (
    /is not a function/i.test(m) ||
    /cannot read propert/i.test(m) ||
    /undefined|null/i.test(m) ||
    m.includes('api.customers') ||
    m.includes('posApi') ||
    m.includes('IPC operation failed') ||
    m.includes('Empty IPC response') ||
    m.includes('Invalid IPC response')
  );
}

function ipcErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }
  return undefined;
}

function ipcErrorMessage(err: unknown, fallback = GENERIC_ERROR_MESSAGE_UZ): string {
  const code = ipcErrorCode(err);
  if (code === 'DUPLICATE_PHONE') return DUPLICATE_PHONE_MESSAGE_UZ;

  if (typeof err === 'string' && err.trim()) {
    const msg = err.trim();
    return isTechnicalErrorMessage(msg) ? fallback : msg;
  }
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; error?: unknown };
    if (typeof o.message === 'string' && o.message.trim()) {
      const msg = o.message.trim();
      return isTechnicalErrorMessage(msg) ? fallback : msg;
    }
    if (typeof o.error === 'string' && o.error.trim()) {
      const msg = o.error.trim();
      return isTechnicalErrorMessage(msg) ? fallback : msg;
    }
  }
  return fallback;
}

/** Map IPC / renderer errors to user-facing Uzbek text (never expose technical strings). */
export function formatUserFacingError(error: unknown, fallback = GENERIC_ERROR_MESSAGE_UZ): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: string }).code;
    if (code === 'DUPLICATE_PHONE') return DUPLICATE_PHONE_MESSAGE_UZ;
  }
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    if (code === 'DUPLICATE_PHONE') return DUPLICATE_PHONE_MESSAGE_UZ;
    const msg = error.message?.trim();
    if (msg && !isTechnicalErrorMessage(msg)) return msg;
  }
  return fallback;
}

function ipcErrorMeta(err: unknown): { code?: string; details?: unknown } {
  if (err && typeof err === 'object') {
    const o = err as { code?: unknown; details?: unknown };
    return {
      code: typeof o.code === 'string' ? o.code : undefined,
      details: o.details,
    };
  }
  return {};
}

/**
 * Handle IPC response - unwraps { success, data/error } format
 */
export async function handleIpcResponse<T>(promise: Promise<any>): Promise<T> {
  const response = await promise;

  // Some IPC handlers return raw data directly (most of our services do).
  // Others may return a wrapped format: { success: boolean, data?: T, error?: any }.
  if (response === null || response === undefined) {
    throw new Error('Empty IPC response');
  }

  if (typeof response === 'object' && 'success' in response) {
    const wrapped = response as { success: boolean; data?: T; error?: any };
    if (wrapped.error) {
      const error = new Error(ipcErrorMessage(wrapped.error));
      const meta = ipcErrorMeta(wrapped.error);
      (error as any).code = meta.code;
      (error as any).details = meta.details;
      (error as any).originalError = wrapped.error;
      throw error;
    }
    if (wrapped.success) {
      const innerData = wrapped.data as any;
      // Guard against double-wrapped errors (preload wrapped a handler envelope
      // like `{ success: false, error: 'Invalid credentials' }`).
      if (innerData && typeof innerData === 'object' && 'success' in innerData && innerData.success === false && innerData.error) {
        const innerErr = innerData.error;
        const err = new Error(ipcErrorMessage(innerErr));
        const meta = ipcErrorMeta(innerErr);
        (err as any).code = meta.code;
        (err as any).details = meta.details;
        throw err;
      }
      return innerData as T; // Can be undefined for void operations (e.g. delete)
    }
    throw new Error('Invalid IPC response format');
  }

  // Raw success response
  return response as T;
}

