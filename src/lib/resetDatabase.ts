/**
 * Reset Database Utility
 * Calls Supabase Edge Function to reset all database tables
 * 
 * SECURITY: Requires admin authentication and confirmation
 */

import { supabase } from './supabase';

export interface ResetDatabaseOptions {
  confirmText?: string;
}

/**
 * Reset all database tables via Supabase Edge Function
 * 
 * @param options - Reset options including optional confirmation text
 * @returns Promise that resolves when reset is complete
 * @throws Error if reset fails or user is not admin
 */
export const resetDatabase = async (options: ResetDatabaseOptions = {}): Promise<void> => {
  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('Authentication required');
  }

  // Verify user is admin
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile || profile.role !== 'admin') {
    throw new Error('Only administrators can reset the database');
  }

  // Get session token for authorization
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('No active session');
  }

  // Call Edge Function
  const { data, error } = await supabase.functions.invoke('reset-db', {
    body: {
      userId: user.id,
      confirmText: options.confirmText,
    },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    console.error('Error calling reset-db function:', error);
    throw new Error(error.message || 'Failed to reset database');
  }

  if (!data || !data.success) {
    throw new Error(data?.error || 'Database reset failed');
  }

  return;
};

/**
 * Check if database reset is available
 * (Only in development or for admin users)
 */
export const isDatabaseResetAvailable = (): boolean => {
  return import.meta.env.DEV || true; // Allow in production but require admin
};


