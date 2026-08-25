import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Toaster } from './components/ui/toaster';
import kassaRoutes from './routes.kassa';
import KassaLayout from './components/layout/KassaLayout';
import Loading from './components/common/Loading';
import RpcNotifications from './components/common/RpcNotifications';
import CreditStaffAlerts from './components/pos/CreditStaffAlerts';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ConfirmDialogProvider } from './contexts/ConfirmDialogContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function useKassaHashRouter(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol === 'file:') return true;
  return /kassa\.html/i.test(window.location.pathname || '');
}

export default function KassaApp() {
  const Router = useKassaHashRouter() ? HashRouter : BrowserRouter;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router>
          <Toaster />
          <RpcNotifications />
          <CreditStaffAlerts />
          <ConfirmDialogProvider>
            <KassaAppContent />
          </ConfirmDialogProvider>
        </Router>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function KassaAppContent() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>
        <Routes>
          {kassaRoutes.map((route, index) => {
            if (route.requireAuth) {
              return (
                <Route
                  key={index}
                  path={route.path}
                  element={
                    <PrivateRoute>
                      <KassaLayout>{route.element}</KassaLayout>
                    </PrivateRoute>
                  }
                />
              );
            }
            if (route.path === '/login') {
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
          <Route path="/" element={<Navigate to="/pos" replace />} />
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

function PrivateRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { user, scope, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (user && scope === 'tenant') return <Navigate to="/pos" replace />;

  return <>{children}</>;
}
