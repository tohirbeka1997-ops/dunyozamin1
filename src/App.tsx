import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import React, { Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Toaster } from './components/ui/toaster';
import routes from './routes';
import MainLayout from './components/layout/MainLayout';
import { useSyncEngine } from './hooks/useSyncEngine';
import { openOfflineDB } from './offline/db';
import Loading from './components/common/Loading';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ConfirmDialogProvider } from './contexts/ConfirmDialogContext';
import { hasSessionTokenIfRequired } from '@/lib/auth/sessionToken';

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
  const Router = typeof window !== 'undefined' && window.location?.protocol === 'file:' ? HashRouter : BrowserRouter;
  if (typeof window !== 'undefined' && window.location.hostname === 'app.dunyozamin.com') {
    const nextUrl = new URL(window.location.href);
    nextUrl.hostname = 'api.dunyozamin.com';
    window.location.replace(nextUrl.toString());
    return <Loading />;
  }
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router>
          <Toaster />
          <GlobalErrorOverlay />
          <ConfirmDialogProvider>
            <SyncEngineInitializer />
            <AppContent />
          </ConfirmDialogProvider>
        </Router>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function GlobalErrorOverlay() {
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    const formatError = (value: unknown) => {
      if (value instanceof Error) return value.message;
      if (value && typeof value === 'object' && 'message' in value) {
        return String((value as { message?: unknown }).message || value);
      }
      return String(value || 'Nomaʼlum frontend xatosi');
    };
    const onError = (event: ErrorEvent) => {
      setMessage(formatError(event.error || event.message));
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      setMessage(formatError(event.reason));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  if (!message) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card p-5 text-card-foreground shadow-lg">
        <h2 className="text-lg font-semibold">Sahifa ochilishida xatolik</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Oq ekran o‘rniga xatolik ko‘rsatildi. Sahifani qayta yuklab ko‘ring yoki login sahifasiga qayting.
        </p>
        <pre className="mt-3 max-h-40 overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap">{message}</pre>
        <div className="mt-4 flex gap-2">
          <button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => window.location.reload()}>
            Qayta yuklash
          </button>
          <button className="rounded border px-3 py-2 text-sm" onClick={() => window.location.assign('/login')}>
            Login
          </button>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>
        <Routes>
          {routes.map((route, index) => {
            // Super-admin surface (Bosqich 16): /admin/login is public-but-
            // redirects-when-already-master, /admin/stores is master-gated.
            // No MainLayout — master sessions have no tenant chrome.
            if (route.path === '/admin/login') {
              return (
                <Route
                  key={index}
                  path={route.path}
                  element={<AdminPublicRoute>{route.element}</AdminPublicRoute>}
                />
              );
            }
            if (route.path.startsWith('/admin/')) {
              return (
                <Route
                  key={index}
                  path={route.path}
                  element={<AdminRoute>{route.element}</AdminRoute>}
                />
              );
            }

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
      </Suspense>
    </ErrorBoundary>
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

  // Web deployments can run in either session-token mode or legacy shared-secret
  // RPC mode. The auth store clears `user` on 401, so route guards should only
  // depend on the authenticated user state; requiring a token here can create a
  // /login <-> /pos redirect loop on legacy hosts.
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { user, scope, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  // If logged in as a tenant user, redirect to home (dashboard).
  // Master sessions have no tenant-scoped home — send them to /admin/stores
  // so a stale master token on /login doesn't get dropped into a tenant page.
  if (user && scope === 'tenant') return <Navigate to="/pos" replace />;
  if (user && scope === 'master') return <Navigate to="/admin/stores" replace />;

  return <>{children}</>;
}

/**
 * Guard for the super-admin login form. Redirects to the stores dashboard
 * when already authenticated as master; otherwise passes through.
 */
function AdminPublicRoute({ children }: { children: ReactNode }) {
  const { user, scope, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }
  if (user && scope === 'master') return <Navigate to="/admin/stores" replace />;
  return <>{children}</>;
}

/**
 * Guard for every /admin/* page except /admin/login.
 *
 * Access is granted only when BOTH:
 *   - a session token is present, AND
 *   - `scope === 'master'`.
 *
 * Anything else (anonymous, tenant user, or expired session) bounces to
 * /admin/login with the current location preserved for post-login redirect.
 */
function AdminRoute({ children }: { children: ReactNode }) {
  const { user, scope, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }
  if (!user || !hasSessionTokenIfRequired() || scope !== 'master') {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

export default App;

