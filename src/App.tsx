import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Toaster } from './components/ui/toaster';
import routes from './routes';
import MainLayout from './components/layout/MainLayout';
import { useSyncEngine } from './hooks/useSyncEngine';
import { openOfflineDB } from './offline/db';

// Create QueryClient instance with default options
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
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
        console.error('Failed to initialize offline database:', error);
      });
    }, []);
  } catch (error) {
    console.error('Failed to initialize sync engine:', error);
  }
  
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router>
          <Toaster />
          <SyncEngineInitializer />
          <AppContent />
        </Router>
      </AuthProvider>
    </QueryClientProvider>
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
                <PrivateRoute allowedRoles={route.allowedRoles}>
                  <MainLayout>{route.element}</MainLayout>
                </PrivateRoute>
              }
            />
          );
        }
        // For login and reset password routes, redirect if already logged in
        if (route.path === '/login' || route.path === '/reset-password' || route.path === '/auth/reset-password') {
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

function PrivateRoute({ children, allowedRoles }: { children: ReactNode; allowedRoles?: string[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
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

