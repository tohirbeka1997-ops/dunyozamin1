import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { clearAllBrowserStorage } from '@/lib/clearBrowserStorage';
import type { User, Session } from '@supabase/supabase-js';
import type { Profile } from '@/types/database';

type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'cashier' | 'manager';
};

type AuthContextValue = {
  user: User | null; // Supabase User
  profile: Profile | null;
  role: 'admin' | 'cashier' | 'manager';
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName?: string, username?: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resetPasswordWithToken: (token: string, newPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthProviderProps = { children: ReactNode };

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<'admin' | 'cashier' | 'manager'>('cashier');
  const [loading, setLoading] = useState(true);

  /**
   * Ensure profile exists for user
   * First user gets 'admin' role, others get 'cashier'
   */
  const ensureProfile = useCallback(async (supabaseUser: User): Promise<Profile> => {
    // Check if profile exists
    const { data: existingProfile, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', supabaseUser.id)
      .single();

    if (existingProfile && !fetchError) {
      // Profile exists, return it
      setProfile(existingProfile);
      setRole((existingProfile.role as 'admin' | 'cashier' | 'manager') || 'cashier');
      return existingProfile;
    }

    // Profile doesn't exist, create it
    // Check if this is the first user (profiles table is empty)
    const { count, error: countError } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('Error counting profiles:', countError);
    }

    // First user gets admin, others get cashier
    const defaultRole: 'admin' | 'cashier' = (count === 0 || count === null) ? 'admin' : 'cashier';

    // Create profile
    const email = supabaseUser.email || '';
    const username = email.split('@')[0] || 'user';
    const fullName = supabaseUser.user_metadata?.full_name || username;

    const { data: newProfile, error: insertError } = await supabase
      .from('profiles')
      .insert({
        id: supabaseUser.id,
        username,
        full_name: fullName,
        email,
        role: defaultRole,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating profile:', insertError);
      throw new Error(`Failed to create profile: ${insertError.message}`);
    }

    if (!newProfile) {
      throw new Error('Failed to create profile: No data returned');
    }

    setProfile(newProfile);
    setRole(defaultRole);
    return newProfile;
  }, []);

  /**
   * Load role from app_users table (source of truth)
   */
  const loadUserRole = useCallback(async (supabaseUser: User): Promise<'admin' | 'cashier' | 'manager'> => {
    console.log('[AUTH] Loading role for user.id:', supabaseUser.id);
    
    try {
      const { fetchUserRole } = await import('@/api/supabaseAuth');
      const role = await fetchUserRole(supabaseUser.id);
      
      // fetchUserRole now throws if role not found, so we don't need null check
      console.log('[AUTH] app_user role:', role);
      setRole(role);
      return role;
    } catch (error) {
      console.error('[AUTH] Error loading user role:', error);
      // Re-throw to prevent silent fallback
      throw error;
    }
  }, []);

  /**
   * Load profile for user (for display purposes)
   */
  const loadProfile = useCallback(async (supabaseUser: User): Promise<void> => {
    try {
      await ensureProfile(supabaseUser);
    } catch (error) {
      console.error('Error loading profile:', error);
      // Profile load failure is non-critical, but role load failure is critical
    }
  }, [ensureProfile]);

  // Initialize: Check for existing session and subscribe to auth changes
  useEffect(() => {
    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    const initializeAuth = async () => {
      // Set a timeout to prevent infinite loading
      const timeoutId = setTimeout(() => {
        if (mounted) {
          console.warn('Auth initialization timeout - setting loading to false');
          setLoading(false);
        }
      }, 10000); // 10 second timeout

      try {
        // Check for existing Supabase session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          console.error('Error getting session:', sessionError);
          if (mounted) {
            setUser(null);
            setProfile(null);
            setRole('cashier');
            console.log('Session Status: Anon (Error)');
          }
          return;
        }

        if (session?.user && mounted) {
          console.log('[AUTH] Session Status: Authenticated', session.user.id);
          console.log('[AUTH] user.id', session.user.id);
          setUser(session.user);
          // CRITICAL: Load role from app_users first (source of truth)
          // This must succeed or we block the app
          try {
            await loadUserRole(session.user);
            // Load profile for display (non-critical)
            await loadProfile(session.user).catch((err) => {
              console.error('Failed to load profile during init:', err);
            });
          } catch (err) {
            console.error('[AUTH] Failed to load user role during init:', err);
            // If role load fails, we cannot proceed - user must be in app_users
            if (mounted) {
              setUser(null);
              setProfile(null);
              setRole('cashier');
              // Show error to user
              alert(err instanceof Error ? err.message : 'Authentication failed: User role not found. Please contact administrator.');
            }
            return;
          }
        } else if (mounted) {
          // No session - ensure state is cleared
          setUser(null);
          setProfile(null);
          setRole('cashier');
        }

        // Listen for auth state changes
        const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (!mounted) return;

          // Always set loading to false on any auth state change
          setLoading(false);

          if (event === 'SIGNED_IN' && session?.user) {
            console.log('[AUTH] SIGNED_IN event, user.id:', session.user.id);
            setUser(session.user);
            try {
              await loadUserRole(session.user);
              await loadProfile(session.user).catch((err) => {
                console.error('Failed to load profile on sign in:', err);
              });
            } catch (err) {
              console.error('[AUTH] Failed to load user role on sign in:', err);
              // If role load fails, sign out the user
              setUser(null);
              setProfile(null);
              setRole('cashier');
              alert(err instanceof Error ? err.message : 'Authentication failed: User role not found.');
            }
          } else if (event === 'SIGNED_OUT') {
            setUser(null);
            setProfile(null);
            setRole('cashier');
            // Clear all browser storage including React Query cache
            await clearAllBrowserStorage(queryClient);
          } else if (event === 'TOKEN_REFRESHED' && session?.user) {
            setUser(session.user);
            // Refresh role and profile on token refresh
            loadUserRole(session.user).catch((err) => {
              console.error('[AUTH] Failed to load user role on token refresh:', err);
            });
            loadProfile(session.user).catch((err) => {
              console.error('Failed to load profile on token refresh:', err);
            });
          } else if (event === 'USER_UPDATED' && session?.user) {
            setUser(session.user);
          }
        });

        subscription = authSubscription;
      } catch (error) {
        console.error('Auth initialization error:', error);
        if (mounted) {
          setUser(null);
          setProfile(null);
          setRole('cashier');
        }
      } finally {
        // CRITICAL: Always set loading to false in finally block
        clearTimeout(timeoutId);
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    return () => {
      mounted = false;
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [loadProfile, loadUserRole, queryClient]);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Sign in error:', error);
        throw error;
      }

      if (data.user) {
        console.log('[AUTH] Sign in successful, user.id:', data.user.id);
        setUser(data.user);
        try {
          await loadUserRole(data.user);
          await loadProfile(data.user).catch((err) => {
            console.error('Failed to load profile after sign in:', err);
          });
        } catch (roleError) {
          console.error('[AUTH] Failed to load user role after sign in:', roleError);
          // If role load fails, sign out and show error
          setUser(null);
          setProfile(null);
          setRole('cashier');
          throw new Error(roleError instanceof Error ? roleError.message : 'Failed to load user role');
        }
      }
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    } finally {
      // CRITICAL: Always reset loading state
      setLoading(false);
    }
  };

  const signOut = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      setUser(null);
      setProfile(null);
      setRole('cashier');

      // Clear all browser storage (localStorage, sessionStorage, IndexedDB, caches, React Query cache)
      await clearAllBrowserStorage(queryClient);
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (
    email: string,
    password: string,
    fullName?: string,
    username?: string
  ) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName || username || email.split('@')[0],
          },
        },
      });

      if (error) throw error;

      // Create profile (ensureProfile will handle first user = admin logic)
      if (data.user) {
        setUser(data.user);
        await loadProfile(data.user);
      }
    } catch (error) {
      console.error('Sign up error:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Reset password error:', error);
      throw error;
    }
  };

  const resetPasswordWithTokenMethod = async (token: string, newPassword: string) => {
    try {
      // Supabase handles password reset via URL hash, not token
      // This is typically called from the reset password page
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Reset password with token error:', error);
      throw error;
    }
  };

  const value: AuthContextValue = {
    user,
    profile,
    role,
    loading,
    signIn,
    signUp,
    signOut,
    resetPassword,
    resetPasswordWithToken: resetPasswordWithTokenMethod,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
