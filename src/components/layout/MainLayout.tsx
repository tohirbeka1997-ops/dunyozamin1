import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate, matchPath } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import GlobalSearch from '@/components/search/GlobalSearch';
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
  ChevronLeft,
  ChevronRight,
  Globe,
  Sparkles,
  ChefHat,
  PackageCheck,
} from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import routes from '@/routes';
import { getElectronAPI, handleIpcResponse } from '@/utils/electron';
import { useToast } from '@/hooks/use-toast';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { playNewOnlineOrderChime } from '@/lib/newOrderSound';
import NetworkBadge from '@/components/common/NetworkBadge';

const iconMap: Record<string, React.ReactNode> = {
  Dashboard: <LayoutDashboard className="h-5 w-5" />,
  'POS Terminal': <ShoppingCart className="h-5 w-5" />,
  Products: <Package className="h-5 w-5" />,
  Categories: <FolderTree className="h-5 w-5" />,
  Orders: <Receipt className="h-5 w-5" />,
  'Online Orders': <Globe className="h-5 w-5" />,
  'Web Orders Preparing': <ChefHat className="h-5 w-5" />,
  'Web Orders Ready': <PackageCheck className="h-5 w-5" />,
  'Web Orders Delivering': <Truck className="h-5 w-5" />,
  'Online Sales Report': <BarChart3 className="h-5 w-5" />,
  'Web Orders Delivered': <PackageCheck className="h-5 w-5" />,
  Courier: <Truck className="h-5 w-5" />,
  'Sales Returns': <RotateCcw className="h-5 w-5" />,
  Customers: <Users className="h-5 w-5" />,
  Inventory: <Warehouse className="h-5 w-5" />,
  'Purchase Orders': <ShoppingBag className="h-5 w-5" />,
  Suppliers: <Truck className="h-5 w-5" />,
  'Expenses': <Wallet className="h-5 w-5" />,
  'Promotions': <Tag className="h-5 w-5" />,
  'Mini-app Content': <Sparkles className="h-5 w-5" />,
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
  'Online Orders': 'navigation.web_orders_incoming',
  'Web Orders Preparing': 'navigation.web_orders_preparing',
  'Web Orders Ready': 'navigation.web_orders_ready',
  'Web Orders Delivering': 'navigation.web_orders_delivering',
  'Online Sales Report': 'navigation.web_orders_report',
  'Web Orders Delivered': 'navigation.web_orders_delivered',
  'Courier': 'navigation.courier',
  'Sales Returns': 'navigation.sales_returns',
  'Customers': 'navigation.customers',
  'Inventory': 'navigation.inventory',
  'Purchase Orders': 'navigation.purchase_orders',
  'Suppliers': 'navigation.suppliers',
  'Expenses': 'navigation.expenses',
  'Promotions': 'navigation.promotions',
  'Mini-app Content': 'navigation.mini_app_content',
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
  const [webOrderQueueBadges, setWebOrderQueueBadges] = useState<Record<string, number>>({});
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
    const queueHandler = (event: Event) => {
      const custom = event as CustomEvent<Record<string, number>>;
      const counts = custom?.detail;
      if (!counts || typeof counts !== 'object') return;
      const incoming = Math.max(0, Number(counts.incoming ?? 0));
      setPendingWebOrdersCount(incoming);
      setWebOrderQueueBadges({
        '/web-orders': incoming,
        '/web-orders/preparing': Math.max(0, Number(counts.preparing ?? 0)),
        '/web-orders/delivering': Math.max(0, Number(counts.delivering ?? 0)),
      });
    };
    window.addEventListener('pos:web-orders-queue-counts', queueHandler as EventListener);
    return () => {
      window.removeEventListener('pos:web-orders-pending-count', handler as EventListener);
      window.removeEventListener('pos:web-orders-queue-counts', queueHandler as EventListener);
    };
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
        let nextCount = 0;
        if (api.webOrders.countsByQueue) {
          const counts = await handleIpcResponse<Record<string, number>>(
            api.webOrders.countsByQueue(),
          );
          if (isCancelled) return;
          nextCount = Math.max(0, Number(counts?.incoming ?? 0));
          setPendingWebOrdersCount(nextCount);
          setWebOrderQueueBadges({
            '/web-orders': nextCount,
            '/web-orders/preparing': Math.max(0, Number(counts?.preparing ?? 0)),
            '/web-orders/ready': Math.max(0, Number(counts?.ready ?? 0)),
            '/web-orders/delivering': Math.max(0, Number(counts?.delivering ?? 0)),
          });
        } else {
          const res = await handleIpcResponse<{ meta?: { total?: number } }>(
            api.webOrders.list({ queue: 'incoming', page: 1, limit: 1 }),
          );
          if (isCancelled) return;
          nextCount = Number(res?.meta?.total ?? 0);
          nextCount = Number.isFinite(nextCount) ? Math.max(0, nextCount) : 0;
          setPendingWebOrdersCount(nextCount);
        }

        if (!hasInitializedWebOrdersCountRef.current) {
          hasInitializedWebOrdersCountRef.current = true;
          previousWebOrdersCountRef.current = nextCount;
          return;
        }

        if (nextCount > previousWebOrdersCountRef.current) {
          const delta = nextCount - previousWebOrdersCountRef.current;
          playNewOnlineOrderChime();
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

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      // Force navigation even if storage cleanup hits a non-fatal error
      navigate('/login', { replace: true });
    }
  };

  return (
    <>
    <GlobalSearch open={globalSearchOpen} onOpenChange={setGlobalSearchOpen} />
    <div className="flex h-screen w-full min-w-0 max-w-[100vw] overflow-hidden overflow-x-hidden">
      {/* Desktop Sidebar */}
      <aside className={`app-sidebar hidden border-r transition-all duration-200 xl:flex xl:flex-col ${sidebarCollapsed ? 'w-[4.5rem]' : 'w-64'}`}>
        <div className={`sidebar-border ${sidebarCollapsed ? 'p-2' : 'p-6'} border-b`}>
          <div className={`flex items-start ${sidebarCollapsed ? 'flex-col gap-2' : 'gap-2'}`}>
            <Link
              to="/"
              className={`flex items-center ${sidebarCollapsed ? 'w-full justify-center' : 'min-w-0 flex-1 gap-2'}`}
              title={sidebarCollapsed ? t('common.pos_system') : undefined}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-primary shadow-md">
                <Store className="h-6 w-6 text-primary-foreground" />
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-bold text-sidebar-foreground">{t('common.pos_system')}</h1>
                  <p className="sidebar-muted truncate text-xs">{t('common.point_of_sale')}</p>
                </div>
              )}
            </Link>
            <div className={`flex ${sidebarCollapsed ? 'w-full justify-center gap-1' : 'ml-auto items-center gap-1'}`}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="shrink-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                title={theme === 'dark' ? t('navigation.theme_light_mode') : t('navigation.theme_dark_mode')}
              >
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={() => setSidebarCollapsed((v) => !v)}
                title={sidebarCollapsed ? t('navigation.sidebar_open') : t('navigation.sidebar_close')}
                aria-label={sidebarCollapsed ? t('navigation.sidebar_open') : t('navigation.sidebar_close')}
              >
                {sidebarCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>
        <div className={`px-4 pt-3 pb-1 ${sidebarCollapsed ? 'flex justify-center' : ''}`}>
          <button
            type="button"
            onClick={() => setGlobalSearchOpen(true)}
            className={`sidebar-search flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
              sidebarCollapsed ? 'h-9 w-9 justify-center p-0' : 'min-w-0 w-full'
            }`}
            title={sidebarCollapsed ? t('navigation.sidebar_search_placeholder') : undefined}
            aria-label={t('navigation.sidebar_search_placeholder')}
          >
            <Search className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && (
              <>
                <span className="min-w-0 flex-1 truncate text-left">
                  {t('navigation.sidebar_search_placeholder')}
                </span>
                <kbd className="sidebar-kbd hidden shrink-0 items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-[10px] shadow-sm xl:inline-flex">
                  Ctrl K
                </kbd>
              </>
            )}
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 xl:p-4">
          <SidebarNav
            visibleRoutes={visibleRoutes}
            compact={sidebarCollapsed}
            variant="sidebar"
            iconMap={iconMap}
            routeNameMap={routeNameMap}
            pendingWebOrdersCount={pendingWebOrdersCount}
            routeBadges={webOrderQueueBadges}
          />
        </nav>
        <div className="sidebar-border border-t p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sidebar-accent">
              <User className="h-5 w-5 text-sidebar-foreground" />
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-sidebar-foreground">{user?.full_name || user?.email}</p>
                <p className="sidebar-muted truncate text-xs capitalize">{user?.role}</p>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" className={`sidebar-signout ${sidebarCollapsed ? 'w-10 px-0' : 'w-full'}`} onClick={handleSignOut} title={sidebarCollapsed ? t('common.sign_out') : undefined}>
            <LogOut className={`h-4 w-4 ${sidebarCollapsed ? '' : 'mr-2'}`} />
            {!sidebarCollapsed && t('common.sign_out')}
          </Button>
        </div>
      </aside>

      {/* Main Content — min-w-0: flex qatorida kontent kengayib o‘ngda bo‘sh joy qolmasin */}
      <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden">
        {/* Mobil / planshet: sidebar yo‘q — chap menyu Sheet orqali */}
        <header className="app-main-chrome flex shrink-0 items-center gap-2 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] xl:hidden">
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
              <nav className="min-h-0 flex-1 overflow-y-auto p-4">
                <SidebarNav
                  visibleRoutes={visibleRoutes}
                  variant="default"
                  iconMap={iconMap}
                  routeNameMap={routeNameMap}
                  pendingWebOrdersCount={pendingWebOrdersCount}
                  routeBadges={webOrderQueueBadges}
                  onNavigate={() => setMobileMenuOpen(false)}
                />
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
          <NetworkBadge />
        </header>

        {/* Page Content - flex so children (e.g. POS) can fill full height */}
        {/* POS: overflow-hidden so content fits viewport; other pages: overflow-y-auto for scroll */}
        <main
          className={`flex min-h-0 min-w-0 flex-1 flex-col ${
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
