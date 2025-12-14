import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  Truck,
  FileText,
  Wallet,
} from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import routes from '@/routes';
import NetworkBadge from '@/components/common/NetworkBadge';

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
  Suppliers: <Truck className="h-5 w-5" />,
  'Expenses': <Wallet className="h-5 w-5" />,
  Reports: <BarChart3 className="h-5 w-5" />,
  Employees: <UserCog className="h-5 w-5" />,
  Settings: <Settings className="h-5 w-5" />,
  'Receipt & Barcode Tools': <FileText className="h-5 w-5" />,
};

const routeNameMap: Record<string, string> = {
  'Dashboard': 'navigation.dashboard',
  'POS Terminal': 'navigation.pos_terminal',
  'Products': 'navigation.products',
  'Categories': 'navigation.categories',
  'Orders': 'navigation.orders',
  'Sales Returns': 'navigation.sales_returns',
  'Customers': 'navigation.customers',
  'Inventory': 'navigation.inventory',
  'Purchase Orders': 'navigation.purchase_orders',
  'Suppliers': 'navigation.suppliers',
  'Expenses': 'navigation.expenses',
  'Reports': 'navigation.reports',
  'Employees': 'navigation.employees',
  'Settings': 'navigation.settings',
  'Receipt & Barcode Tools': 'navigation.receipt_barcode_tools',
};

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, profile, role, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const visibleRoutes = routes.filter((route) => {
    if (!route.visible) return false;
    if (route.allowedRoles && user && !route.allowedRoles.includes(role)) {
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
            <span>{routeNameMap[route.name] ? t(routeNameMap[route.name]) : route.name}</span>
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
              <h1 className="font-bold text-lg">{t('common.pos_system')}</h1>
              <p className="text-xs text-muted-foreground">{t('common.point_of_sale')}</p>
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
              <p className="font-medium text-sm truncate">{profile?.full_name || user?.email || 'User'}</p>
              <p className="text-xs text-muted-foreground capitalize">{role}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            {t('common.sign_out')}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b bg-card flex items-center justify-between px-4 xl:px-6 overflow-visible relative z-10">
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
                      <h1 className="font-bold text-lg">{t('common.pos_system')}</h1>
                      <p className="text-xs text-muted-foreground">{t('common.point_of_sale')}</p>
                    </div>
                  </Link>
                </div>
                <nav className="p-4 space-y-1">
                  <NavLinks />
                </nav>
              </SheetContent>
            </Sheet>

            <h2 className="text-lg font-semibold">
              {(() => {
                const currentRoute = routes.find((r) => r.path === location.pathname);
                if (!currentRoute) return t('common.pos_system');
                const translationKey = routeNameMap[currentRoute.name];
                return translationKey ? t(translationKey) : currentRoute.name;
              })()}
            </h2>
          </div>

          <div className="flex items-center gap-2 overflow-visible flex-shrink-0 ml-auto">
            <NetworkBadge />
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
                    <p className="font-medium">{profile?.full_name || user?.email || 'User'}</p>
                    <p className="text-xs text-muted-foreground capitalize">{role}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  {t('common.sign_out')}
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
