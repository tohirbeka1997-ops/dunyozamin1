import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  Store,
  LayoutDashboard,
  ShoppingCart,
  Package,
  FolderTree,
  Receipt,
  RotateCcw,
  Users,
  Warehouse,
  ShoppingBag,
  BarChart3,
  UserCog,
  Settings,
  Menu,
  LogOut,
  User,
  Moon,
  Sun,
} from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import routes from '@/routes';

const iconMap: Record<string, React.ReactNode> = {
  Dashboard: <LayoutDashboard className="h-5 w-5" />,
  'POS Terminal': <ShoppingCart className="h-5 w-5" />,
  Products: <Package className="h-5 w-5" />,
  Categories: <FolderTree className="h-5 w-5" />,
  Orders: <Receipt className="h-5 w-5" />,
  'Sales Returns': <RotateCcw className="h-5 w-5" />,
  Customers: <Users className="h-5 w-5" />,
  Inventory: <Warehouse className="h-5 w-5" />,
  'Purchase Orders': <ShoppingBag className="h-5 w-5" />,
  Reports: <BarChart3 className="h-5 w-5" />,
  Employees: <UserCog className="h-5 w-5" />,
  Settings: <Settings className="h-5 w-5" />,
};

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const visibleRoutes = routes.filter((route) => {
    if (!route.visible) return false;
    if (route.allowedRoles && profile && !route.allowedRoles.includes(profile.role)) {
      return false;
    }
    return true;
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const NavLinks = () => (
    <>
      {visibleRoutes.map((route) => {
        const isActive = location.pathname === route.path;
        return (
          <Link
            key={route.path}
            to={route.path}
            onClick={() => setMobileMenuOpen(false)}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {iconMap[route.name]}
            <span>{route.name}</span>
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden xl:flex xl:flex-col w-64 border-r bg-card">
        <div className="p-6 border-b">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <Store className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-lg">POS System</h1>
              <p className="text-xs text-muted-foreground">Point of Sale</p>
            </div>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          <NavLinks />
        </nav>
        <div className="p-4 border-t">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{profile?.full_name || profile?.username}</p>
              <p className="text-xs text-muted-foreground capitalize">{profile?.role}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b bg-card flex items-center justify-between px-4 xl:px-6">
          <div className="flex items-center gap-4">
            {/* Mobile Menu */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="xl:hidden">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <div className="p-6 border-b">
                  <Link to="/" className="flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
                    <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
                      <Store className="h-6 w-6 text-primary-foreground" />
                    </div>
                    <div>
                      <h1 className="font-bold text-lg">POS System</h1>
                      <p className="text-xs text-muted-foreground">Point of Sale</p>
                    </div>
                  </Link>
                </div>
                <nav className="p-4 space-y-1">
                  <NavLinks />
                </nav>
              </SheetContent>
            </Sheet>

            <h2 className="text-lg font-semibold">
              {routes.find((r) => r.path === location.pathname)?.name || 'POS System'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild className="xl:hidden">
                <Button variant="ghost" size="icon">
                  <User className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div>
                    <p className="font-medium">{profile?.full_name || profile?.username}</p>
                    <p className="text-xs text-muted-foreground capitalize">{profile?.role}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-muted/30 p-4 xl:p-6">{children}</main>
      </div>
    </div>
  );
}
