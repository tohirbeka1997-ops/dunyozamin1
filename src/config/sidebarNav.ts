import type { RouteConfig } from '@/routes';

export type SidebarNavGroupId =
  | 'main'
  | 'catalog'
  | 'sales'
  | 'marketplace'
  | 'warehouse'
  | 'reports'
  | 'system'
  | 'other';

export type SidebarNavGroupConfig = {
  id: SidebarNavGroupId;
  labelKey: string;
  /** Route `name` values from routes.tsx (visible entries only) */
  routeNames: string[];
  defaultOpen?: boolean;
};

export const sidebarNavGroups: SidebarNavGroupConfig[] = [
  {
    id: 'main',
    labelKey: 'navigation.group_main',
    routeNames: ['Dashboard', 'POS Terminal'],
    defaultOpen: true,
  },
  {
    id: 'sales',
    labelKey: 'navigation.group_sales',
    routeNames: ['Orders', 'Sales Returns', 'Customers', 'Smeta'],
  },
  {
    id: 'marketplace',
    labelKey: 'navigation.group_marketplace',
    routeNames: [
      'Online Orders',
      'Web Orders Preparing',
      'Web Orders Ready',
      'Web Orders Delivering',
      'Web Orders Delivered',
      'Online Sales Report',
      'Courier',
    ],
  },
  {
    id: 'catalog',
    labelKey: 'navigation.group_catalog',
    routeNames: ['Products', 'Categories', 'Promotions', 'Mini-app Content'],
  },
  {
    id: 'warehouse',
    labelKey: 'navigation.group_warehouse',
    routeNames: ['Inventory', 'Suppliers', 'Purchase Orders', 'Expenses'],
  },
  {
    id: 'reports',
    labelKey: 'navigation.group_reports',
    routeNames: ['Reports'],
  },
  {
    id: 'system',
    labelKey: 'navigation.group_system',
    routeNames: ['Employees', 'Barcode Center', 'Settings'],
  },
];

export function isNavRouteActive(route: RouteConfig, pathname: string): boolean {
  const path = route.path;
  if (path === '/') {
    return pathname === '/' || pathname === '';
  }
  if (pathname === path) return true;
  const sectionRoots = [
    '/reports',
    '/products',
    '/categories',
    '/promotions',
    '/orders',
    '/web-orders',
    '/returns',
    '/customers',
    '/quotes',
    '/courier',
    '/expenses',
    '/inventory',
    '/purchase-orders',
    '/suppliers',
    '/barcodes',
    '/marketplace-content',
    '/employees',
    '/settings',
  ];
  if (sectionRoots.includes(path)) {
    return pathname.startsWith(`${path}/`);
  }
  return false;
}

export function buildSidebarNavGroups(
  visibleRoutes: RouteConfig[],
): Array<SidebarNavGroupConfig & { routes: RouteConfig[] }> {
  const byName = new Map(visibleRoutes.map((r) => [r.name, r]));
  const used = new Set<string>();

  const grouped = sidebarNavGroups
    .map((group) => {
      const routes = group.routeNames
        .map((name) => byName.get(name))
        .filter((r): r is RouteConfig => !!r);
      routes.forEach((r) => used.add(r.name));
      return { ...group, routes };
    })
    .filter((g) => g.routes.length > 0);

  const orphan = visibleRoutes.filter((r) => !used.has(r.name));
  if (orphan.length > 0) {
    grouped.push({
      id: 'other',
      labelKey: 'navigation.group_other',
      routeNames: [],
      routes: orphan,
    });
  }

  return grouped;
}
