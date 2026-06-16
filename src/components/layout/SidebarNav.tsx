import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RouteConfig } from '@/routes';
import {
  buildSidebarNavGroups,
  isNavRouteActive,
  type SidebarNavGroupId,
} from '@/config/sidebarNav';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  BarChart3,
  ChevronDown,
  Globe,
  LayoutDashboard,
  MoreHorizontal,
  Package,
  Receipt,
  Settings,
  Warehouse,
} from 'lucide-react';

const groupIconMap: Record<SidebarNavGroupId, React.ReactNode> = {
  main: <LayoutDashboard className="h-4 w-4" />,
  catalog: <Package className="h-4 w-4" />,
  sales: <Receipt className="h-4 w-4" />,
  marketplace: <Globe className="h-4 w-4" />,
  warehouse: <Warehouse className="h-4 w-4" />,
  reports: <BarChart3 className="h-4 w-4" />,
  system: <Settings className="h-4 w-4" />,
  other: <MoreHorizontal className="h-4 w-4" />,
};

type Props = {
  visibleRoutes: RouteConfig[];
  compact?: boolean;
  /** Sidebar (desktop) vs sheet (mobile) link styling */
  variant?: 'sidebar' | 'default';
  iconMap: Record<string, React.ReactNode>;
  routeNameMap: Record<string, string>;
  pendingWebOrdersCount: number;
  /** Badge count keyed by route path (e.g. /web-orders/preparing) */
  routeBadges?: Record<string, number>;
  onNavigate?: () => void;
};

function NavRouteLink({
  route,
  compact,
  sidebar,
  isActive,
  iconMap,
  routeNameMap,
  t,
  pendingWebOrdersCount,
  routeBadges,
  onNavigate,
}: {
  route: RouteConfig;
  compact: boolean;
  sidebar: boolean;
  isActive: boolean;
  iconMap: Record<string, React.ReactNode>;
  routeNameMap: Record<string, string>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  pendingWebOrdersCount: number;
  routeBadges?: Record<string, number>;
  onNavigate?: () => void;
}) {
  const badgeCount =
    route.path === '/web-orders'
      ? pendingWebOrdersCount
      : Math.max(0, Number(routeBadges?.[route.path] ?? 0));
  const label = routeNameMap[route.name] ? t(routeNameMap[route.name]) : route.name;

  return (
    <Link
      to={route.path}
      onClick={onNavigate}
      title={compact ? label : undefined}
      className={`flex items-center rounded-lg transition-colors ${
        compact ? 'relative mx-auto h-10 w-10 justify-center px-0 py-0' : 'gap-3 px-3 py-2'
      } ${
        sidebar
          ? isActive
            ? 'sidebar-nav-link sidebar-nav-link-active'
            : 'sidebar-nav-link'
          : isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-foreground/80 hover:bg-muted hover:text-foreground'
      }`}
    >
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
        {iconMap[route.name] ?? <LayoutDashboard className="h-5 w-5" />}
      </span>
      {!compact && (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm">{label}</span>
          {badgeCount > 0 && (
            <span className="ml-auto inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground">
              {badgeCount > 99 ? '99+' : badgeCount}
            </span>
          )}
        </span>
      )}
      {compact && badgeCount > 0 && (
        <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-destructive" />
      )}
    </Link>
  );
}

export function SidebarNav({
  visibleRoutes,
  compact = false,
  variant = 'sidebar',
  iconMap,
  routeNameMap,
  pendingWebOrdersCount,
  routeBadges,
  onNavigate,
}: Props) {
  const useSidebarStyles = variant === 'sidebar';
  const { t } = useTranslation();
  const location = useLocation();
  const groups = useMemo(() => buildSidebarNavGroups(visibleRoutes), [visibleRoutes]);

  const activeGroupIds = useMemo(
    () =>
      new Set(
        groups
          .filter((g) => g.routes.some((r) => isNavRouteActive(r, location.pathname)))
          .map((g) => g.id),
      ),
    [groups, location.pathname],
  );

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of groups) {
      init[g.id] = g.defaultOpen ?? false;
    }
    return init;
  });

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (activeGroupIds.has(g.id)) {
          next[g.id] = true;
        }
      }
      return next;
    });
  }, [groups, activeGroupIds]);

  if (compact) {
    return (
      <div className="flex flex-col items-center gap-1 py-1">
        {groups.map((group) => (
          <DropdownMenu key={group.id}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={`h-10 w-10 text-sidebar-foreground hover:bg-sidebar-accent ${
                  group.routes.some((r) => isNavRouteActive(r, location.pathname))
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary'
                    : ''
                }`}
                title={t(group.labelKey)}
              >
                {groupIconMap[group.id] ?? groupIconMap.system}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="z-[70] min-w-[12rem]">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {t(group.labelKey)}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {group.routes.map((route) => (
                <DropdownMenuItem key={route.path} asChild className="cursor-pointer">
                  <Link
                    to={route.path}
                    onClick={onNavigate}
                    className="flex w-full items-center gap-2"
                  >
                    <span className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">
                      {iconMap[route.name]}
                    </span>
                    <span className="truncate">
                      {routeNameMap[route.name] ? t(routeNameMap[route.name]) : route.name}
                    </span>
                    {(route.path === '/web-orders'
                      ? pendingWebOrdersCount
                      : Math.max(0, Number(routeBadges?.[route.path] ?? 0))) > 0 && (
                      <span className="ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-[10px] text-destructive-foreground">
                        {(() => {
                          const n =
                            route.path === '/web-orders'
                              ? pendingWebOrdersCount
                              : Math.max(0, Number(routeBadges?.[route.path] ?? 0));
                          return n > 99 ? '99+' : n;
                        })()}
                      </span>
                    )}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {groups.map((group) => {
        const isOpen = openGroups[group.id] ?? false;
        const groupActive = activeGroupIds.has(group.id);
        return (
          <Collapsible
            key={group.id}
            open={isOpen}
            onOpenChange={(open) => setOpenGroups((prev) => ({ ...prev, [group.id]: open }))}
          >
            <CollapsibleTrigger
              type="button"
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide transition-colors ${
                useSidebarStyles
                  ? groupActive
                    ? 'text-sidebar-foreground'
                    : 'text-sidebar-foreground/65 hover:text-sidebar-foreground hover:bg-sidebar-accent/60'
                  : groupActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                  useSidebarStyles
                    ? 'bg-sidebar-accent/50 text-sidebar-foreground'
                    : 'bg-muted text-foreground'
                }`}
              >
                {groupIconMap[group.id] ?? groupIconMap.system}
              </span>
              <span className="min-w-0 flex-1 truncate">{t(group.labelKey)}</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 opacity-70 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-0.5 pb-1 pl-1 pt-0.5">
              {group.routes.map((route) => (
                <NavRouteLink
                  key={route.path}
                  route={route}
                  compact={false}
                  sidebar={useSidebarStyles}
                  isActive={isNavRouteActive(route, location.pathname)}
                  iconMap={iconMap}
                  routeNameMap={routeNameMap}
                  t={t}
                  pendingWebOrdersCount={pendingWebOrdersCount}
                  routeBadges={routeBadges}
                  onNavigate={onNavigate}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
