/**
 * Supabase Auth API Wrapper
 * Typed functions for authentication operations
 */

import { supabase } from '@/lib/supabase';
import type { User, Session } from '@supabase/supabase-js';
import type { Profile } from '@/types/database';

/**
 * Get current session
 */
export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('Error getting session:', error);
    throw error;
  }
  return data.session;
}

/**
 * Sign in with email and password
 */
export async function signIn(email: string, password: string): Promise<{ user: User; session: Session }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error('Sign in error:', error);
    throw error;
  }

  if (!data.user || !data.session) {
    throw new Error('Sign in failed: No user or session returned');
  }

  return { user: data.user, session: data.session };
}

/**
 * Sign up with email and password
 */
export async function signUp(
  email: string,
  password: string,
  options?: {
    fullName?: string;
    username?: string;
  }
): Promise<{ user: User; session: Session | null }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: options?.fullName || options?.username || email.split('@')[0],
      },
    },
  });

  if (error) {
    console.error('Sign up error:', error);
    throw error;
  }

  if (!data.user) {
    throw new Error('Sign up failed: No user returned');
  }

  return { user: data.user, session: data.session };
}

/**
 * Sign out
 */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('Sign out error:', error);
    throw error;
  }
}

/**
 * Fetch profile from public.profiles table
 */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned - profile doesn't exist
      return null;
    }
    console.error('Error fetching profile:', error);
    throw error;
  }

  return data as Profile;
}

/**
 * Ensure profile exists for user
 * Creates a minimal profile if it doesn't exist
 * Returns the profile (existing or newly created)
 */
export async function ensureProfileForUser(
  userId: string,
  email: string,
  options?: {
    fullName?: string;
    username?: string;
    role?: 'admin' | 'cashier' | 'manager';
  }
): Promise<Profile> {
  // Check if profile exists
  const existing = await fetchProfile(userId);
  if (existing) {
    return existing;
  }

  // Determine default role: admin if first user, else cashier
  const { count, error: countError } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('Error counting profiles:', countError);
    // Default to cashier if count fails
  }

  const defaultRole: 'admin' | 'cashier' = (count === 0 || count === null) ? 'admin' : (options?.role || 'cashier');

  // Create profile
  const username = options?.username || email.split('@')[0];
  const fullName = options?.fullName || username || email.split('@')[0];

  const { data, error } = await supabase
    .from('profiles')
    .insert({
      id: userId,
      username,
      full_name: fullName,
      email,
      role: defaultRole,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating profile:', error);
    throw error;
  }

  if (!data) {
    throw new Error('Failed to create profile');
  }

  return data as Profile;
}

/**
 * Update profile
 */
export async function updateProfile(
  userId: string,
  updates: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>
): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error('Error updating profile:', error);
    throw error;
  }

  if (!data) {
    throw new Error('Failed to update profile');
  }

  return data as Profile;
}

/**
 * Fetch user role from app_users table
 * This is the source of truth for user roles
 * @throws Error if user not found or role is missing
 */
export async function fetchUserRole(authUserId: string): Promise<'admin' | 'cashier' | 'manager'> {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, role')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) {
    console.error('[AUTH] Role fetch error:', error);
    throw error;
  }

  if (!data?.role) {
    console.error('[AUTH] User role not found in app_users for:', authUserId);
    throw new Error('User role not found');
  }

  const role = data.role as 'admin' | 'cashier' | 'manager';
  console.log('[AUTH] Fetched role from app_users:', { authUserId, role, appUserId: data.id });
  return role;
}

