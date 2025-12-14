/**
 * Hook to check if auth is ready (not loading and user exists or doesn't exist)
 * Use this to enable React Query queries only when auth is ready
 */

import { useAuth } from '@/contexts/AuthContext';

export function useAuthReady(): boolean {
  const { loading, user } = useAuth();
  
  // Auth is ready when:
  // 1. Not loading anymore
  // 2. Either user exists (authenticated) or user is null (not authenticated)
  return !loading;
}


