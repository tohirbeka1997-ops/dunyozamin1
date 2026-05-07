import { useState, useEffect, useRef } from 'react';
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
  ChevronLeft,
  ChevronRight,
  Globe,
  Check,
} from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import routes, { type RouteConfig } from '@/routes';
import { getElectronAPI, handleIpcResponse } from '@/utils/electron';
import { useToast } from '@/hooks/use-toast';

const iconMap: Record<string, React.ReactNode> = {
  Dashboard: <LayoutDashboard className="h-5 w-5" />,
  'POS Terminal': <ShoppingCart className="h-5 w-5" />,
  Products: <Package className="h-5 w-5" />,
  Categories: <FolderTree className="h-5 w-5" />,
  Orders: <Receipt className="h-5 w-5" />,
  'Online Orders': <Globe className="h-5 w-5" />,
  Courier: <Truck className="h-5 w-5" />,
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
  'Courier': 'navigation.courier',
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
  const { toast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pendingWebOrdersCount, setPendingWebOrdersCount] = useState(0);
  const hasInitializedWebOrdersCountRef = useRef(false);
  const previousWebOrdersCountRef = useRef(0);

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

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ count?: number }>;
      const count = Number(custom?.detail?.count ?? 0);
      const nextCount = Number.isFinite(count) ? Math.max(0, count) : 0;
      setPendingWebOrdersCount(nextCount);
      previousWebOrdersCountRef.current = nextCount;
      if (!hasInitializedWebOrdersCountRef.current) {
        hasInitializedWebOrdersCountRef.current = true;
      }
    };
    window.addEventListener('pos:web-orders-pending-count', handler as EventListener);
    return () => window.removeEventListener('pos:web-orders-pending-count', handler as EventListener);
  }, []);

  useEffect(() => {
    const canUseOnlineOrders =
      !!user && (user.role === 'admin' || user.role === 'manager');
    if (!canUseOnlineOrders) return;

    const api = getElectronAPI();
    if (!api?.webOrders?.list) return;

    let isCancelled = false;
    const isWebOrdersPage = location.pathname.startsWith('/web-orders');

    const refreshPendingOrders = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const res = await handleIpcResponse<{ data: unknown[]; meta?: { total?: number } }>(
          api.webOrders.list({ status: 'new', page: 1, limit: 1 }),
        );
        if (isCancelled) return;

        const total = Number(res?.meta?.total ?? 0);
        const nextCount = Number.isFinite(total) ? Math.max(0, total) : 0;
        setPendingWebOrdersCount(nextCount);

        if (!hasInitializedWebOrdersCountRef.current) {
          hasInitializedWebOrdersCountRef.current = true;
          previousWebOrdersCountRef.current = nextCount;
          return;
        }

        if (nextCount > previousWebOrdersCountRef.current) {
          const delta = nextCount - previousWebOrdersCountRef.current;
          toast({
            title: t('navigation.new_online_order_title'),
            description:
              delta === 1
                ? t('navigation.new_online_order_singular')
                : t('navigation.new_online_order_plural', { count: delta }),
          });
        }
        previousWebOrdersCountRef.current = nextCount;
      } catch {
        // Keep UI responsive; transient network/auth errors should not crash layout polling.
      }
    };

    void refreshPendingOrders();
    const intervalMs = isWebOrdersPage ? 15000 : 60000;
    const intervalId = window.setInterval(refreshPendingOrders, intervalMs);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [toast, t, user, location.pathname]);

  const isPosPage = Boolean(matchPath({ path: '/pos', end: true }, location.pathname));

  const visibleRoutes = routes.filter((route) => {
    if (!route.visible) return false;
    if (route.allowedRoles && user && !route.allowedRoles.includes(user.role)) {
      return false;
    }
    return true;
  });

  /** Sidebar dropdown: ko'rinadigan route'lardan tezkor ro'yxat */
  const quickNavRoutes = visibleRoutes.slice(0, 12);

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      // Force navigation even if storage cleanup hits a non-fatal error
      navigate('/login', { replace: true });
    }
  };

  const NavLinks = ({ compact = false }: { compact?: boolean }) => (
    <>
      {visibleRoutes.map((route) => {
        const isActive = location.pathname === route.path;
        const isOnlineOrdersRoute = route.path === '/web-orders';
        return (
          <Link
            key={route.path}
            to={route.path}
            onClick={() => setMobileMenuOpen(false)}
            title={compact ? (routeNameMap[route.name] ? t(routeNameMap[route.name]) : route.name) : undefined}
            className={`flex items-center rounded-lg px-3 py-2 transition-colors ${
              compact ? 'mx-auto h-10 w-10 justify-center px-0 py-0' : 'gap-3'
            } ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground/80 hover:bg-muted hover:text-foreground'
            }`}
          >
            <span className="inline-flex h-5 w-5 items-center justify-center shrink-0">
              {iconMap[route.name] ?? <LayoutDashboard className="h-5 w-5" />}
            </span>
            {!compact && (
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate">
                  {routeNameMap[route.name] ? t(routeNameMap[route.name]) : route.name}
                </span>
                {isOnlineOrdersRoute && pendingWebOrdersCount > 0 && (
                  <span className="ml-auto inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground">
                    {pendingWebOrdersCount > 99 ? '99+' : pendingWebOrdersCount}
                  </span>
                )}
              </span>
            )}
            {compact && isOnlineOrdersRoute && pendingWebOrdersCount > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-destructive" />
            )}
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
      <aside className={`hidden border-r bg-card transition-all duration-200 xl:flex xl:flex-col ${sidebarCollapsed ? 'w-[4.5rem]' : 'w-64'}`}>
        <div className={`${sidebarCollapsed ? 'p-2' : 'p-6'} border-b`}>
          <div className={`flex items-start ${sidebarCollapsed ? 'flex-col gap-2' : 'gap-2'}`}>
            <Link
              to="/"
              className={`flex items-center ${sidebarCollapsed ? 'w-full justify-center' : 'min-w-0 flex-1 gap-2'}`}
              title={sidebarCollapsed ? t('common.pos_system') : undefined}
            >
              <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
                <Store className="h-6 w-6 text-primary-foreground" />
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <h1 className="font-bold text-lg truncate">{t('common.pos_system')}</h1>
                  <p className="text-xs text-muted-foreground truncate">{t('common.point_of_sale')}</p>
                </div>
              )}
            </Link>
            <div className={`flex ${sidebarCollapsed ? 'w-full justify-center gap-1' : 'ml-auto items-center gap-1'}`}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="flex-shrink-0"
                title={theme === 'dark' ? t('navigation.theme_light_mode') : t('navigation.theme_dark_mode')}
              >
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0"
                onClick={() => setSidebarCollapsed((v) => !v)}
                title={sidebarCollapsed ? t('navigation.sidebar_open') : t('navigation.sidebar_close')}
                aria-label={sidebarCollapsed ? t('navigation.sidebar_open') : t('navigation.sidebar_close')}
              >
                {sidebarCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>
        {/* Qidiruv (1 bosish) + tezkor sahifalar (dropdown) */}
        <div className={`px-4 pt-3 pb-1 flex gap-1.5 ${sidebarCollapsed ? 'justify-center' : ''}`}>
          {!sidebarCollapsed && (
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
          )}
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
            <DropdownMenuContent className="min-w-[14rem] z-[70]" align="end" sideOffset={6}>
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
                  onClick={() => {
                    navigate(route.path);
                    setMobileMenuOpen(false);
                  }}
                >
                  <span className="mr-2 flex shrink-0 [&_svg]:h-4 [&_svg]:w-4">
                    {iconMap[route.name]}
                  </span>
                  <span className="truncate">
                    {routeNameMap[route.name] ? t(routeNameMap[route.name]) : route.name}
                  </span>
                  {location.pathname === route.path && (
                    <Check className="ml-auto h-4 w-4 text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          <NavLinks compact={sidebarCollapsed} />
        </nav>
        <div className="p-4 border-t">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            {!sidebarCollapsed && <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{user?.full_name || user?.email}</p>
              <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
            </div>}
          </div>
          <Button variant="outline" size="sm" className={sidebarCollapsed ? 'w-10 px-0' : 'w-full'} onClick={handleSignOut} title={sidebarCollapsed ? t('common.sign_out') : undefined}>
            <LogOut className={`h-4 w-4 ${sidebarCollapsed ? '' : 'mr-2'}`} />
            {!sidebarCollapsed && t('common.sign_out')}
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
              : 'overflow-y-auto px-4 pb-4 pt-2 xl:px-6 xl:pb-6 xl:pt-3'
          }`}
        >
          <div className="flex h-full min-h-0 min-w-0 w-full max-w-full flex-1 flex-col">{children}</div>
        </main>
      </div>
    </div>
    </>
  );
}
