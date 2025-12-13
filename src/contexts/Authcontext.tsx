import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  AuthUser,
  getStoredUser,
  signInMock,
  signOutMock,
  signUpMock,
  resetPasswordRequest,
  resetPasswordWithToken,
} from '@/db/auth-mock';
import type { Profile } from '@/types/database';

type AuthContextValue = {
  user: AuthUser | null;
  profile: Profile | null; // Backward compatibility - maps to user
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signUp: (email: string, password: string, fullName?: string, username?: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resetPasswordWithToken: (token: string, newPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthProviderProps = { children: ReactNode };

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Convert AuthUser to Profile for backward compatibility
  const userToProfile = (authUser: AuthUser | null): Profile | null => {
    if (!authUser) return null;
    return {
      id: authUser.id,
      username: authUser.email.split('@')[0],
      full_name: authUser.full_name,
      phone: null,
      email: authUser.email,
      role: authUser.role,
      is_active: true,
      last_login: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  };

  // On mount: read stored user from localStorage
  useEffect(() => {
    const stored = getStoredUser();
    if (stored) {
      setUser(stored);
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const loggedIn = await signInMock(email, password);
      setUser(loggedIn);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await signOutMock();
      setUser(null);
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
      const newUser = await signUpMock(email, password, fullName, username);
      setUser(newUser);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    await resetPasswordRequest(email);
  };

  const resetPasswordWithTokenMethod = async (token: string, newPassword: string) => {
    await resetPasswordWithToken(token, newPassword);
  };

  const profile = userToProfile(user);
  const value: AuthContextValue = {
    user,
    profile,
    loading,
    login,
    logout,
    signUp,
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
