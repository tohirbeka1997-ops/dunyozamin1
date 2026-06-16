export type WebOrderQueueId = 'incoming' | 'preparing' | 'ready' | 'delivering' | 'delivered';

export const WEB_ORDER_QUEUE_IDS: WebOrderQueueId[] = [
  'incoming',
  'preparing',
  'ready',
  'delivering',
  'delivered',
];

export type WebOrderQueueConfig = {
  statuses: readonly string[];
  titleKey: string;
  subtitleKey: string;
  path: string;
  routeName: string;
};

export const WEB_ORDER_QUEUES: Record<WebOrderQueueId, WebOrderQueueConfig> = {
  incoming: {
    statuses: ['new', 'paid'],
    titleKey: 'navigation.web_orders_incoming',
    subtitleKey: 'web_orders.queue_incoming_subtitle',
    path: '/web-orders',
    routeName: 'Online Orders',
  },
  preparing: {
    statuses: ['processing'],
    titleKey: 'navigation.web_orders_preparing',
    subtitleKey: 'web_orders.queue_preparing_subtitle',
    path: '/web-orders/preparing',
    routeName: 'Web Orders Preparing',
  },
  ready: {
    statuses: ['ready'],
    titleKey: 'navigation.web_orders_ready',
    subtitleKey: 'web_orders.queue_ready_subtitle',
    path: '/web-orders/ready',
    routeName: 'Web Orders Ready',
  },
  delivering: {
    statuses: ['out_for_delivery'],
    titleKey: 'navigation.web_orders_delivering',
    subtitleKey: 'web_orders.queue_delivering_subtitle',
    path: '/web-orders/delivering',
    routeName: 'Web Orders Delivering',
  },
  delivered: {
    statuses: ['delivered'],
    titleKey: 'navigation.web_orders_delivered',
    subtitleKey: 'web_orders.queue_delivered_subtitle',
    path: '/web-orders/delivered',
    routeName: 'Web Orders Delivered',
  },
};

export function normalizeWebOrderQueueId(raw?: string | null): WebOrderQueueId | null {
  const id = String(raw || '').trim().toLowerCase();
  return id in WEB_ORDER_QUEUES ? (id as WebOrderQueueId) : null;
}

export function webOrderQueueFromPath(pathname: string): WebOrderQueueId | null {
  if (pathname === '/web-orders' || pathname === '/web-orders/') return 'incoming';
  if (pathname.startsWith('/web-orders/preparing')) return 'preparing';
  if (pathname.startsWith('/web-orders/ready')) return 'ready';
  if (pathname.startsWith('/web-orders/delivering')) return 'delivering';
  if (pathname.startsWith('/web-orders/delivered')) return 'delivered';
  return null;
}
