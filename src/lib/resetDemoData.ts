/**
 * Reset Demo Data Utility
 * Admin-only function to clear business data (dev/testing only)
 * 
 * IMPORTANT: This should only be available in development mode
 * and requires admin role verification
 */

import { supabase } from './supabase';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Reset demo data - truncates business tables
 * This function calls a Supabase Edge Function or RPC
 * that requires admin authentication
 */
export const resetDemoData = async (): Promise<void> => {
  // Only allow in development
  if (import.meta.env.PROD) {
    throw new Error('Reset demo data is only available in development mode');
  }

  // Get current user to verify admin role
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('Authentication required');
  }

  // Check if user is admin (from profile)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    throw new Error('Only administrators can reset demo data');
  }

  // Call Supabase Edge Function or RPC to reset data
  // Option 1: Use Edge Function (recommended for security)
  try {
    const { data, error } = await supabase.functions.invoke('reset-demo-data', {
      method: 'POST',
      body: { userId: user.id },
    });

    if (error) {
      // Fallback to RPC if Edge Function doesn't exist
      if (error.message?.includes('Function not found')) {
        return resetDemoDataViaRPC();
      }
      throw error;
    }

    return;
  } catch (e) {
    // Fallback to RPC
    return resetDemoDataViaRPC();
  }
};

/**
 * Fallback: Reset via RPC function
 * This requires a Supabase RPC function: reset_demo_data()
 */
const resetDemoDataViaRPC = async (): Promise<void> => {
  const { error } = await supabase.rpc('reset_demo_data');

  if (error) {
    // If RPC doesn't exist, provide instructions
    if (error.code === '42883') {
      throw new Error(
        'Reset demo data function not found. Please create a Supabase RPC function or Edge Function.'
      );
    }
    throw error;
  }
};

/**
 * Helper to check if reset is available
 */
export const isResetDemoDataAvailable = (): boolean => {
  return import.meta.env.DEV;
};


