/**
 * Global Supabase Error Logger
 * Centralized logging for all Supabase errors with context
 */

import type { PostgrestError } from '@supabase/supabase-js';

export interface SupabaseErrorContext {
  table?: string;
  operation?: string;
  queryKey?: string;
  userId?: string;
}

/**
 * Log Supabase error with context
 */
export function logSupabaseError(
  error: unknown,
  context: SupabaseErrorContext = {}
): void {
  const { table, operation, queryKey, userId } = context;
  
  if (error && typeof error === 'object') {
    const pgError = error as PostgrestError;
    
    console.error('[Supabase Error]', {
      table: table || 'unknown',
      operation: operation || 'unknown',
      queryKey: queryKey || 'unknown',
      userId: userId || 'unknown',
      code: pgError.code,
      message: pgError.message,
      details: pgError.details,
      hint: pgError.hint,
      error,
    });
  } else {
    console.error('[Supabase Error]', {
      table: table || 'unknown',
      operation: operation || 'unknown',
      queryKey: queryKey || 'unknown',
      userId: userId || 'unknown',
      error,
    });
  }
}

/**
 * Check if error is an RLS/permission error
 */
export function isRLSError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const pgError = error as PostgrestError;
    // RLS errors typically have code '42501' (insufficient_privilege) or 'PGRST301' (not found)
    return pgError.code === '42501' || pgError.code === 'PGRST301' || 
           pgError.message?.toLowerCase().includes('permission') ||
           pgError.message?.toLowerCase().includes('row-level security');
  }
  return false;
}

/**
 * Check if error is an auth error (401/403)
 */
export function isAuthError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const pgError = error as PostgrestError;
    return pgError.code === 'PGRST301' || 
           pgError.message?.toLowerCase().includes('jwt') ||
           pgError.message?.toLowerCase().includes('authentication');
  }
  return false;
}


