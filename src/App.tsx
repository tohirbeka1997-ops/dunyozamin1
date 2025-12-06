import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Toaster } from './components/ui/toaster';
import routes from './routes';
import MainLayout from './components/layout/MainLayout';

function PrivateRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user, profile, loading } = useAuth();
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

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
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
        return <Route key={index} path={route.path} element={route.element} />;
      })}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Toaster />
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;

