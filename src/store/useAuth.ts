/**
 * Auth Store (Zustand)
 * Manages authentication state, session, profile, and role
 */

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { User, Session } from '@supabase/supabase-js';
import type { Profile } from '@/types/database';
import {
  getSession,
  signIn as apiSignIn,
  signUp as apiSignUp,
  signOut as apiSignOut,
  fetchProfile,
  ensureProfileForUser,
} from '@/api/supabaseAuth';
import { clearAllBrowserStorage } from '@/lib/clearBrowserStorage';

type UserRole = 'admin' | 'cashier' | 'manager';

interface AuthState {
  // State
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: UserRole;
  loading: boolean;
  initialized: boolean;

  // Actions
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, profileFields?: { fullName?: string; username?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

/**
 * Derive role from profile or default to cashier
 */
function deriveRole(profile: Profile | null): UserRole {
  if (!profile) return 'cashier';
  const role = profile.role;
  if (role === 'admin' || role === 'cashier' || role === 'manager') {
    return role;
  }
  return 'cashier';
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // Initial state
  session: null,
  user: null,
  profile: null,
  role: 'cashier',
  loading: true,
  initialized: false,

  /**
   * Initialize auth: load session, subscribe to auth changes, fetch profile
   */
  init: async () => {
    if (get().initialized) {
      return; // Already initialized
    }

    set({ loading: true });

    try {
      // Get current session
      const session = await getSession();
      if (session?.user) {
        // Fetch profile
        let profile = await fetchProfile(session.user.id);
        
        // Ensure profile exists
        if (!profile) {
          profile = await ensureProfileForUser(
            session.user.id,
            session.user.email || '',
            {
              fullName: session.user.user_metadata?.full_name,
              username: session.user.user_metadata?.username,
            }
          );
        }

        set({
          session,
          user: session.user,
          profile,
          role: deriveRole(profile),
          loading: false,
          initialized: true,
        });
      } else {
        set({
          session: null,
          user: null,
          profile: null,
          role: 'cashier',
          loading: false,
          initialized: true,
        });
      }

      // Subscribe to auth state changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          // Fetch profile
          let profile = await fetchProfile(session.user.id);
          
          // Ensure profile exists
          if (!profile) {
            profile = await ensureProfileForUser(
              session.user.id,
              session.user.email || '',
            );
          }

          set({
            session,
            user: session.user,
            profile,
            role: deriveRole(profile),
          });
        } else if (event === 'SIGNED_OUT') {
          // Clear all browser storage (queryClient will be passed from component)
          await clearAllBrowserStorage();
          
          set({
            session: null,
            user: null,
            profile: null,
            role: 'cashier',
          });
        } else if (event === 'TOKEN_REFRESHED' && session) {
          set({ session });
        }
      });

      // Store subscription for cleanup (if needed)
      // Note: Zustand doesn't have built-in cleanup, but Supabase manages subscriptions
    } catch (error) {
      console.error('Auth initialization error:', error);
      set({
        session: null,
        user: null,
        profile: null,
        role: 'cashier',
        loading: false,
        initialized: true,
      });
    }
  },

  /**
   * Sign in with email and password
   */
  signIn: async (email: string, password: string) => {
    set({ loading: true });
    try {
      const { user, session } = await apiSignIn(email, password);
      
      // Fetch profile
      let profile = await fetchProfile(user.id);
      
      // Ensure profile exists
      if (!profile) {
        profile = await ensureProfileForUser(user.id, user.email || '');
      }

      set({
        session,
        user,
        profile,
        role: deriveRole(profile),
        loading: false,
      });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  /**
   * Sign up with email and password
   * After signup, ensures profile is created and auto-logs in
   */
  signUp: async (email: string, password: string, profileFields?: { fullName?: string; username?: string }) => {
    set({ loading: true });
    try {
      const { user, session } = await apiSignUp(email, password, profileFields);
      
      // Ensure profile is created
      const profile = await ensureProfileForUser(user.id, email, {
        fullName: profileFields?.fullName,
        username: profileFields?.username,
      });

      set({
        session,
        user,
        profile,
        role: deriveRole(profile),
        loading: false,
      });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  /**
   * Sign out
   */
  signOut: async () => {
    set({ loading: true });
    try {
      await apiSignOut();
      
      // Clear all browser storage (queryClient will be passed from component if needed)
      await clearAllBrowserStorage();
      
      set({
        session: null,
        user: null,
        profile: null,
        role: 'cashier',
        loading: false,
      });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  /**
   * Refresh profile from database
   */
  refreshProfile: async () => {
    const { user } = get();
    if (!user) return;

    try {
      const profile = await fetchProfile(user.id);
      if (profile) {
        set({
          profile,
          role: deriveRole(profile),
        });
      }
    } catch (error) {
      console.error('Error refreshing profile:', error);
    }
  },
}));

