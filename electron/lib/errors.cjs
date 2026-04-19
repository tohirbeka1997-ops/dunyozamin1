/**
 * Error handling utilities for Electron IPC handlers and services
 */

/**
 * Error codes
 */
const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  DB_ERROR: 'DB_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  SHIFT_CLOSED: 'SHIFT_CLOSED',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INSUFFICIENT_BATCH_STOCK: 'INSUFFICIENT_BATCH_STOCK',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

/**
 * Create a structured error object
 * @param {string} code - Error code from ERROR_CODES
 * @param {string} message - Human-readable error message
 * @returns {Error} Error object with code and message properties
 */
function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.name = 'StructuredError';
  return error;
}

/**
 * Wrap an async IPC handler function with error handling
 * Ensures all errors are formatted consistently for the renderer process
 * @param {Function} handler - Async function to wrap
 * @returns {Function} Wrapped handler function
 */
function wrapHandler(handler) {
  if (typeof handler !== 'function') {
    throw new Error(`wrapHandler: handler must be a function, got ${typeof handler}`);
  }

  return async (...args) => {
    try {
      const result = await handler(...args);
      return result;
    } catch (error) {
      // Detect Electron ipcMain handler invocation.
      // In ipcMain.handle(fn), the first arg is an IpcMainInvokeEvent with `sender`.
      // In our LAN RPC dispatcher, we call handlers with event=null (no sender).
      const maybeEvent = args && args.length > 0 ? args[0] : null;
      const isIpcInvoke =
        !!maybeEvent && typeof maybeEvent === 'object' && ('sender' in maybeEvent || 'reply' in maybeEvent);

      // If error already has a code (from createError), preserve it
      if (error.code && error.message) {
        console.error(`[IPC Error] ${error.code}: ${error.message}`);
        const structured = {
          code: error.code,
          message: error.message,
          details: error.details || null,
        };
        // IMPORTANT:
        // - For ipcRenderer.invoke, throwing a plain object becomes "[object Object]" on the renderer side.
        //   Instead, return a wrapped error and let renderer-side handleIpcResponse unwrap it.
        // - For LAN RPC, keep throwing a structured object so hostServer can return { ok:false, error }.
        if (isIpcInvoke) return { success: false, error: structured };
        throw structured;
      }

      // Handle SQLite constraint errors
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        console.error('[IPC Error] DB constraint violation:', error.message);
        const structured = {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Duplicate entry: This record already exists',
          details: error.message,
        };
        if (isIpcInvoke) return { success: false, error: structured };
        throw structured;
      }

      if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        console.error('[IPC Error] DB foreign key violation:', error.message);
        const structured = {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Cannot perform this action: Related records exist',
          details: error.message,
        };
        if (isIpcInvoke) return { success: false, error: structured };
        throw structured;
      }

      // Handle generic database errors
      if (error.code && error.code.startsWith('SQLITE_')) {
        console.error('[IPC Error] Database error:', error.message);
        const structured = {
          code: ERROR_CODES.DB_ERROR,
          message: 'Database operation failed',
          details: error.message,
        };
        if (isIpcInvoke) return { success: false, error: structured };
        throw structured;
      }

      // Generic error handling
      console.error('[IPC Error] Unhandled error:', error);
      console.error('[IPC Error] Stack:', error.stack);
      const structured = {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: error.message || 'An unexpected error occurred',
        details: process.env.NODE_ENV === 'development' ? error.stack : null,
      };
      if (isIpcInvoke) return { success: false, error: structured };
      throw structured;
    }
  };
}

module.exports = {
  ERROR_CODES,
  createError,
  wrapHandler,
};
