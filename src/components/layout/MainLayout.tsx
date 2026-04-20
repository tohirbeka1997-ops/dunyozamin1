import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, matchPath } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import GlobalSearch from '@/components/search/GlobalSearch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
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
  Barcode,
  Tag,
  Search,
  ChevronDown,
  Globe,
} from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import routes, { type RouteConfig } from '@/routes';

const iconMap: Record<string, React.ReactNode> = {
  Dashboard: <LayoutDashboard className="h-5 w-5" />,
  'POS Terminal': <ShoppingCart className="h-5 w-5" />,
  Products: <Package className="h-5 w-5" />,
  Categories: <FolderTree className="h-5 w-5" />,
  Orders: <Receipt className="h-5 w-5" />,
  'Online Orders': <Globe className="h-5 w-5" />,
  'Sales Returns': <RotateCcw className="h-5 w-5" />,
  Customers: <Users className="h-5 w-5" />,
  Inventory: <Warehouse className="h-5 w-5" />,
  'Purchase Orders': <ShoppingBag className="h-5 w-5" />,
  Suppliers: <Truck className="h-5 w-5" />,
  'Expenses': <Wallet className="h-5 w-5" />,
  'Promotions': <Tag className="h-5 w-5" />,
  Reports: <BarChart3 className="h-5 w-5" />,
  Employees: <UserCog className="h-5 w-5" />,
  Settings: <Settings className="h-5 w-5" />,
  'Barcode Center': <Barcode className="h-5 w-5" />,
  'Receipt & Barcode Tools': <FileText className="h-5 w-5" />,
  'Smeta': <FileText className="h-5 w-5" />,
};

const routeNameMap: Record<string, string> = {
  'Dashboard': 'navigation.dashboard',
  'POS Terminal': 'navigation.pos_terminal',
  'Products': 'navigation.products',
  'Categories': 'navigation.categories',
  'Orders': 'navigation.orders',
  'Online Orders': 'navigation.web_online_orders',
  'Sales Returns': 'navigation.sales_returns',
  'Customers': 'navigation.customers',
  'Inventory': 'navigation.inventory',
  'Purchase Orders': 'navigation.purchase_orders',
  'Suppliers': 'navigation.suppliers',
  'Expenses': 'navigation.expenses',
  'Promotions': 'navigation.promotions',
  'Reports': 'navigation.reports',
  'Employees': 'navigation.employees',
  'Settings': 'navigation.settings',
  'Barcode Center': 'navigation.barcode_center',
  'Receipt & Barcode Tools': 'navigation.receipt_barcode_tools',
  'Smeta': 'navigation.smeta',
};

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

  // Ctrl+K opens global search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setGlobalSearchOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const isPosPage = Boolean(matchPath({ path: '/pos', end: true }, location.pathname));

  const visibleRoutes = routes.filter((route) => {
    if (!route.visible) return false;
    if (route.allowedRoles && user && !route.allowedRoles.includes(user.role)) {
      return false;
    }
    return true;
  });

  /** Sidebar dropdown: tezkor havolalar (tartib saqlangan) */
  const quickNavOrder = ['/', '/pos', '/products', '/orders', '/customers', '/inventory', '/promotions'];
  const quickNavRoutes = quickNavOrder
    .map((path) => visibleRoutes.find((r) => r.path === path))
    .filter((r): r is RouteConfig => Boolean(r));

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      // Force navigation even if storage cleanup hits a non-fatal error
      navigate('/login', { replace: true });
    }
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
    <>
    <GlobalSearch open={globalSearchOpen} onOpenChange={setGlobalSearchOpen} />
    <div className="flex h-screen w-full min-w-0 max-w-[100vw] overflow-hidden overflow-x-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden xl:flex xl:flex-col w-64 border-r bg-card">
        <div className="p-6 border-b">
          <div className="flex items-center gap-2">
            <Link to="/" className="flex items-center gap-2 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
                <Store className="h-6 w-6 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <h1 className="font-bold text-lg truncate">{t('common.pos_system')}</h1>
                <p className="text-xs text-muted-foreground truncate">{t('common.point_of_sale')}</p>
              </div>
              {/* Night mode button AFTER "POS Tizimi" text */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="flex-shrink-0 ml-auto"
                title={theme === 'dark' ? "Light mode" : "Night mode"}
              >
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
            </Link>
          </div>
        </div>
        {/* Qidiruv (1 bosish) + tezkor sahifalar (dropdown) */}
        <div className="px-4 pt-3 pb-1 flex gap-1.5">
          <button
            type="button"
            onClick={() => setGlobalSearchOpen(true)}
            className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/50 hover:bg-muted text-muted-foreground text-sm transition-colors"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left truncate">
              {t('navigation.sidebar_search_placeholder')}
            </span>
            <kbd className="hidden xl:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-background border border-border shadow-sm shrink-0">
              Ctrl K
            </kbd>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0 border-border bg-muted/50 hover:bg-muted"
                title={t('navigation.sidebar_quick_pages')}
                aria-label={t('navigation.sidebar_quick_pages')}
              >
                <ChevronDown className="h-4 w-4 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-[14rem]" align="end">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {t('navigation.sidebar_quick_pages')}
              </DropdownMenuLabel>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => setGlobalSearchOpen(true)}
              >
                <Search className="h-4 w-4 mr-2" />
                {t('navigation.sidebar_global_search')}
                <span className="ml-auto text-xs text-muted-foreground pl-2">Ctrl+K</span>
              </DropdownMenuItem>
              {quickNavRoutes.length > 0 && <DropdownMenuSeparator />}
              {quickNavRoutes.map((route) => (
                <DropdownMenuItem
                  key={route.path}
                  className="cursor-pointer"
                  onClick={() => navigate(route.path)}
                >
                  <span className="mr-2 flex shrink-0 [&_svg]:h-4 [&_svg]:w-4">
                    {iconMap[route.name]}
                  </span>
                  <span className="truncate">
                    {routeNameMap[route.name] ? t(routeNameMap[route.name]) : route.name}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
              <p className="font-medium text-sm truncate">{user?.full_name || user?.email}</p>
              <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            {t('common.sign_out')}
          </Button>
        </div>
      </aside>

      {/* Main Content — min-w-0: flex qatorida kontent kengayib o‘ngda bo‘sh joy qolmasin */}
      <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden">
        {/* Mobil / planshet: sidebar yo‘q — chap menyu Sheet orqali */}
        <header className="flex shrink-0 items-center gap-2 border-b bg-card px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] xl:hidden">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => setMobileMenuOpen(true)}
              aria-label={t('navigation.open_menu')}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <SheetContent
              side="left"
              className="flex h-full min-h-0 w-[min(100vw-1rem,20rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[20rem]"
            >
              <SheetTitle className="sr-only">{t('navigation.menu')}</SheetTitle>
              <div className="border-b p-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary">
                    <Store className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{t('common.pos_system')}</p>
                    <p className="truncate text-xs text-muted-foreground">{t('common.point_of_sale')}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    title={theme === 'dark' ? 'Light mode' : 'Night mode'}
                  >
                    {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                  </Button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setGlobalSearchOpen(true);
                  }}
                  className="mt-3 flex w-full items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
                >
                  <Search className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t('navigation.sidebar_search_placeholder')}</span>
                </button>
              </div>
              <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4">
                <NavLinks />
              </nav>
              <div className="border-t p-4">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{user?.full_name || user?.email}</p>
                    <p className="truncate text-xs capitalize text-muted-foreground">{user?.role}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    void handleSignOut();
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {t('common.sign_out')}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
          <Link to="/" className="min-w-0 flex-1 truncate text-center font-semibold">
            {t('common.pos_system')}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => setGlobalSearchOpen(true)}
            aria-label={t('navigation.sidebar_global_search')}
          >
            <Search className="h-5 w-5" />
          </Button>
        </header>

        {/* Page Content - flex so children (e.g. POS) can fill full height */}
        {/* POS: overflow-hidden so content fits viewport; other pages: overflow-y-auto for scroll */}
        <main
          className={`flex min-h-0 min-w-0 flex-1 flex-col bg-muted/30 ${
            isPosPage
              ? 'w-full min-w-0 overflow-hidden overflow-x-hidden pb-4 pl-4 pt-4 !pr-0 xl:pb-6 xl:pl-6 xl:pt-6'
              : 'overflow-y-auto px-4 pb-4 pt-3 xl:px-6 xl:pb-6 xl:pt-4'
          }`}
        >
          <div className="flex h-full min-h-0 min-w-0 w-full max-w-full flex-1 flex-col">{children}</div>
        </main>
      </div>
    </div>
    </>
  );
}
