import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  Package,
  Receipt,
  RotateCcw,
  ShoppingCart,
  Store,
  User,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/AuthContext';
import kassaRoutes from '@/routes.kassa';
import { cn } from '@/lib/utils';

const KASSA_SIDEBAR_COLLAPSED_KEY = 'kassa_sidebar_collapsed';

type Props = {
  children: ReactNode;
};

const navIconMap: Record<string, ReactNode> = {
  'POS Terminal': <ShoppingCart className="h-5 w-5" />,
  Customers: <Users className="h-5 w-5" />,
  Products: <Package className="h-5 w-5" />,
  Orders: <Receipt className="h-5 w-5" />,
  'Sales Returns': <RotateCcw className="h-5 w-5" />,
};

const navLabelMap: Record<string, string> = {
  'POS Terminal': 'navigation.pos_terminal',
  Customers: 'navigation.customers',
  Products: 'navigation.products',
  Orders: 'navigation.orders',
  'Sales Returns': 'navigation.sales_returns',
};

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(KASSA_SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function isRouteActive(path: string, pathname: string) {
  if (path === '/pos') {
    return Boolean(matchPath({ path: '/pos', end: true }, pathname));
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

function KassaNavLinks({
  pathname,
  t,
  compact,
  sidebar,
  onNavigate,
}: {
  pathname: string;
  t: TFunction;
  compact?: boolean;
  sidebar?: boolean;
  onNavigate?: () => void;
}) {
  const visibleRoutes = kassaRoutes.filter((route) => route.visible);

  return (
    <ul className="space-y-1">
      {visibleRoutes.map((route) => {
        const active = isRouteActive(route.path, pathname);
        const labelKey = navLabelMap[route.name];
        const label = labelKey ? t(labelKey, route.name) : route.name;

        return (
          <li key={route.path}>
            <Link
              to={route.path}
              onClick={onNavigate}
              title={compact ? label : undefined}
              className={cn(
                'sidebar-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                sidebar ? 'text-sidebar-foreground' : 'text-foreground',
                compact && 'justify-center px-2',
                active && 'sidebar-nav-link-active bg-primary/10 text-primary',
                !active && 'hover:bg-muted/80',
              )}
            >
              <span className="shrink-0">{navIconMap[route.name]}</span>
              {!compact && <span className="truncate">{label}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Compact shell for cashier mode — minimal sidebar, no full admin menu. */
export default function KassaLayout({ children }: Props) {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readSidebarCollapsed());

  useEffect(() => {
    try {
      localStorage.setItem(KASSA_SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  const isPosPage = Boolean(matchPath({ path: '/pos', end: true }, location.pathname));
  const menuOpenLabel = t('navigation.kassa_menu_open', 'Menyuni ochish');
  const menuCloseLabel = t('navigation.kassa_menu_close', 'Menyuni yopish');

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      navigate('/login', { replace: true });
    }
  };

  const sidebarFooter = (
    <div className="sidebar-border border-t p-4">
      <div className={cn('mb-3 flex items-center gap-3', sidebarCollapsed && 'justify-center')}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sidebar-accent">
          <User className="h-5 w-5 text-sidebar-foreground" />
        </div>
        {!sidebarCollapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {user?.full_name || user?.email}
            </p>
            <p className="sidebar-muted truncate text-xs capitalize">{user?.role}</p>
          </div>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        className={cn('sidebar-signout', sidebarCollapsed ? 'w-10 px-0' : 'w-full')}
        onClick={() => void handleSignOut()}
        title={sidebarCollapsed ? t('auth.logout', 'Chiqish') : undefined}
      >
        <LogOut className={cn('h-4 w-4', !sidebarCollapsed && 'mr-2')} />
        {!sidebarCollapsed && t('auth.logout', 'Chiqish')}
      </Button>
    </div>
  );

  return (
    <div className="flex h-screen w-full min-w-0 max-w-[100vw] overflow-hidden">
      <aside
        className={cn(
          'app-sidebar hidden shrink-0 border-r transition-all duration-200 xl:flex xl:flex-col',
          sidebarCollapsed ? 'w-16' : 'w-52',
        )}
      >
        <div className={cn('sidebar-border border-b', sidebarCollapsed ? 'p-2' : 'p-4')}>
          <div className={cn('flex items-start', sidebarCollapsed ? 'flex-col gap-2' : 'gap-2')}>
            <Link
              to="/pos"
              className={cn(
                'flex items-center',
                sidebarCollapsed ? 'w-full justify-center' : 'min-w-0 flex-1 gap-2',
              )}
              title={sidebarCollapsed ? t('navigation.pos_terminal', 'Kassa') : undefined}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-primary shadow-md">
                <Store className="h-6 w-6 text-primary-foreground" />
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <h1 className="truncate text-base font-bold text-sidebar-foreground">
                    {t('navigation.pos_terminal', 'Kassa')}
                  </h1>
                  <p className="sidebar-muted truncate text-xs">POS Kassa Lite</p>
                </div>
              )}
            </Link>
            <div
              className={cn(
                'flex',
                sidebarCollapsed ? 'w-full justify-center' : 'ml-auto items-center',
              )}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={() => setSidebarCollapsed((value) => !value)}
                title={sidebarCollapsed ? menuOpenLabel : menuCloseLabel}
                aria-label={sidebarCollapsed ? menuOpenLabel : menuCloseLabel}
              >
                {sidebarCollapsed ? (
                  <ChevronRight className="h-5 w-5" />
                ) : (
                  <ChevronLeft className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-3">
          <KassaNavLinks pathname={location.pathname} t={t} sidebar compact={sidebarCollapsed} />
        </nav>
        {sidebarFooter}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden">
        <header className="app-main-chrome flex shrink-0 items-center gap-2 border-b px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] xl:hidden">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => setMobileMenuOpen(true)}
            aria-label={menuOpenLabel}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Link to="/pos" className="min-w-0 flex-1 truncate text-center font-semibold">
            {t('navigation.pos_terminal', 'Kassa')}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => void handleSignOut()}
            aria-label={t('auth.logout', 'Chiqish')}
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </header>

        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetContent
            side="left"
            className="flex h-full min-h-0 w-[min(100vw-1rem,20rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[20rem]"
          >
            <SheetTitle className="sr-only">{t('navigation.menu', 'Menyu')}</SheetTitle>
            <div className="border-b p-4">
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary">
                  <Store className="h-6 w-6 text-primary-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{t('navigation.pos_terminal', 'Kassa')}</p>
                  <p className="truncate text-xs text-muted-foreground">POS Kassa Lite</p>
                </div>
              </div>
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto p-4">
              <KassaNavLinks
                pathname={location.pathname}
                t={t}
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
                {t('auth.logout', 'Chiqish')}
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        <main
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col',
            isPosPage
              ? 'w-full overflow-hidden overflow-x-hidden pb-4 pl-4 pt-4 !pr-0 xl:pb-6 xl:pl-6 xl:pt-6'
              : 'overflow-y-auto px-4 pb-4 pt-2 xl:px-6 xl:pb-6 xl:pt-3',
          )}
        >
          <div className="flex h-full min-h-0 min-w-0 w-full max-w-full flex-1 flex-col">{children}</div>
        </main>
      </div>
    </div>
  );
}
