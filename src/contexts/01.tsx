import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
// import { supabase } from '@/db/supabase'; // Supabase ulanishi hozircha kerak emas
// import type { User } from '@supabase/supabase-js'; // Yana to'g'ri import
import type { User } from '@supabase/supabase-js'; // Asl User type
import type { Profile } from '@/types/database';
// import { getCurrentProfile } from '@/db/api'; // API funksiyasi hozircha kerak emas

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const defaultAuthContext: AuthContextType = {
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
};

const AuthContext = createContext<AuthContextType>(defaultAuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  // ============================================================================
  // ✅ MOCK LOGIN BOSHLANISHI: Frontend rivojlanish uchun
  // TODO: Loyiha tugagach, bu qismni o'chiring va ASL kodingizni qaytaring!
  // ============================================================================
  

  // Helper function to create mock profile
  const createMockProfile = (user: User, username?: string, fullName?: string): Profile => ({
    id: user.id,
    username: username || 'Mock Admin',
    full_name: fullName || 'Mock Admin User',
    phone: null,
    email: user.email || '',
    role: 'admin',
    is_active: true,
    last_login: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Initialize state from localStorage (like the example pattern)
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('mockUser');
    return stored ? JSON.parse(stored) : null;
  });

  const [profile, setProfile] = useState<Profile | null>(() => {
    const stored = localStorage.getItem('mockProfile');
    return stored ? JSON.parse(stored) : null;
  });
  
  const [loading] = useState(false);

  // Load profile when user changes
  useEffect(() => {
    if (user) {
      const mockProfile = createMockProfile(user);
      setProfile(mockProfile);
      localStorage.setItem('mockProfile', JSON.stringify(mockProfile));
    } else {
      setProfile(null);
      localStorage.removeItem('mockProfile');
    }
  }, [user]);

  const refreshProfile = async () => {
    if (user) {
      const mockProfile = createMockProfile(user);
      setProfile(mockProfile);
      localStorage.setItem('mockProfile', JSON.stringify(mockProfile));
    }
  };

  const handleSignOut = async () => {
    setUser(null);
    setProfile(null);
    localStorage.removeItem('mockUser');
    localStorage.removeItem('mockProfile');
  };

  // ============================================================================
  // MOCK LOGIN YAKUNI
  // ============================================================================

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut: handleSignOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  return context;
}