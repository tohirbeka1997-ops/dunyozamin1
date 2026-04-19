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
      // CRITICAL: Preserve the full error message from backend
      const errorMessage = wrapped.error.message || wrapped.error.error || 'IPC operation failed';
      const error = new Error(errorMessage);
      (error as any).code = wrapped.error.code;
      (error as any).details = wrapped.error.details;
      (error as any).originalError = wrapped.error; // Preserve original error structure
      throw error;
    }
    if (wrapped.success) {
      const innerData = wrapped.data as any;
      // Guard against double-wrapped errors (preload wrapped a wrapHandler error response)
      if (innerData && typeof innerData === 'object' && 'success' in innerData && innerData.success === false && innerData.error) {
        const innerErr = innerData.error;
        const err = new Error(innerErr.message || 'IPC operation failed');
        (err as any).code = innerErr.code;
        (err as any).details = innerErr.details;
        throw err;
      }
      return innerData as T; // Can be undefined for void operations (e.g. delete)
    }
    throw new Error('Invalid IPC response format');
  }

  // Raw success response
  return response as T;
}

