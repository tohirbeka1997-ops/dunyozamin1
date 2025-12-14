import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from './components/ui/toaster';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import routes from './routes';
import MainLayout from './components/layout/MainLayout';
import { useSyncEngine } from './hooks/useSyncEngine';
import { openOfflineDB } from './offline/db';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Create QueryClient instance with optimized defaults for POS
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors (client errors)
        if (error && typeof error === 'object' && 'status' in error) {
          const status = (error as { status: number }).status;
          if (status >= 400 && status < 500) {
            return false;
          }
        }
        // Retry up to 1 time for network/server errors
        return failureCount < 1;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      staleTime: 5 * 60 * 1000, // 5 minutes - data is fresh for 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime) - keep unused data for 10 minutes
      refetchOnWindowFocus: false, // POS doesn't need refetch on focus
      refetchOnMount: true, // Refetch when component mounts (fresh data)
      refetchOnReconnect: true, // Refetch when network reconnects
    },
    mutations: {
      retry: false, // Mutations should not retry automatically
    },
  },
});

// Component to initialize sync engine inside QueryClientProvider
function SyncEngineInitializer() {
  try {
    useSyncEngine();
    
    // Initialize IndexedDB on app start
    React.useEffect(() => {
      openOfflineDB().catch(error => {
        // Only log in development
        if (import.meta.env.DEV) {
          console.error('Failed to initialize offline database:', error);
        }
      });
    }, []);
  } catch (error) {
    // Only log in development
    if (import.meta.env.DEV) {
      console.error('Failed to initialize sync engine:', error);
    }
  }
  
  return null;
}

function App() {
  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        // Log to error tracking service in production
        if (import.meta.env.PROD) {
          // TODO: Send to error tracking service (e.g., Sentry)
          // errorTrackingService.captureException(error, { extra: errorInfo });
        }
      }}
    >
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Router>
            <Toaster />
            <SyncEngineInitializer />
            <AppContent />
          </Router>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

function AppContent() {
  return (
    <Routes>
      {routes.map((route, index) => {
        if (route.requireAuth) {
          return (
            <Route
              key={index}
              path={route.path}
              element={
                <ProtectedRoute allowedRoles={route.allowedRoles as ('admin' | 'cashier' | 'manager')[] | undefined}>
                  <MainLayout>{route.element}</MainLayout>
                </ProtectedRoute>
              }
            />
          );
        }
        // For login, register, reset password routes, redirect if already logged in
        if (route.path === '/login' || route.path === '/register' || route.path === '/reset-password' || route.path === '/auth/reset-password') {
          return (
            <Route
              key={index}
              path={route.path}
              element={<PublicRoute>{route.element}</PublicRoute>}
            />
          );
        }
        return <Route key={index} path={route.path} element={route.element} />;
      })}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  // If user is logged in, redirect to home (dashboard)
  if (user) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default App;

