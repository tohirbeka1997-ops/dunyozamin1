import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { getOrdersPage, getProfiles, getCustomers, getWarehouses } from '@/db/api';
import type { OrderWithDetails, Profile, Customer } from '@/types/database';
import { Search, Eye, Printer, RotateCcw, DollarSign, ShoppingCart, TrendingUp, Pencil } from 'lucide-react';
import { highlightMatch } from '@/utils/searchHighlight';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { formatMoneyUZS, formatOrderMoney } from '@/lib/format';
import { formatDateYMD, formatOrderDateTime } from '@/lib/datetime';
import PrintDialog from '@/components/print/PrintDialog';
import VirtualizedOrdersTable from '@/components/orders/VirtualizedOrdersTable';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import { useMainScrollRestoration } from '@/hooks/useMainScrollRestoration';
import { createBackNavigationState, buildCurrentPath } from '@/lib/pageState';
import { withReturnToPath } from '@/lib/listState';
import { useOrdersListStore } from '@/store/ordersListStore';
import { useDebounce } from '@/hooks/use-debounce';
import { useTranslation } from 'react-i18next';
import SearchableCombobox, {
  type SearchableComboboxOption,
  type SearchableComboboxProps,
} from '@/components/common/SearchableCombobox';
import SearchableCustomerCombobox from '@/components/common/SearchableCustomerCombobox';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { canCreateSalesReturnForOrder } from '@/lib/posHardening';

function isWebOrderRow(o: { order_source?: string; id?: string } | null | undefined) {
  return o?.order_source === 'web' || String(o?.id || '').startsWith('web:');
}

/** Plain select fallback so Orders filters never white-screen the page. */
function OrdersFilterSelect({
  value,
  onValueChange,
  options,
  placeholder,
  triggerClassName,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableComboboxOption[];
  placeholder?: string;
  triggerClassName?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className={
          triggerClassName
            ? `w-full min-w-0 [&_span]:truncate ${triggerClassName}`
            : 'h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate'
        }
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SafeOrdersFilterCombobox(props: SearchableComboboxProps) {
  return (
    <ErrorBoundary
      fallback={
        <OrdersFilterSelect
          value={props.value}
          onValueChange={props.onValueChange}
          options={props.options}
          placeholder={props.placeholder}
          triggerClassName={props.triggerClassName}
        />
      }
    >
      <SearchableCombobox {...props} />
    </ErrorBoundary>
  );
}

function canEditOrderInPos(o: { status?: string; order_source?: string; id?: string } | null | undefined) {
  if (isWebOrderRow(o)) return false;
  const s = String(o?.status || '').toLowerCase();
  return s !== 'voided' && s !== 'refunded' && s !== 'returned' && s !== 'amended';
}

export default function Orders() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: 'orders.filters.query',
    trackedKeys: [
      'search',
      'date',
      'df',
      'dt',
      'cashier',
      'customer',
      'paymentStatus',
      'status',
      'paymentMethod',
      'warehouse',
      'channel',
      'sortBy',
    ],
  });
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [cashiers, setCashiers] = useState<Profile[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const [customersLoading, setCustomersLoading] = useState(true);
  const searchTerm = searchParams.get('search') || '';
  const debouncedSearchTerm = useDebounce(searchTerm, 200);
  const dateFilter = searchParams.get('date') || 'all';
  const dfParam = searchParams.get('df') || '';
  const dtParam = searchParams.get('dt') || '';
  const cashierFilter = searchParams.get('cashier') || 'all';
  const customerFilter = searchParams.get('customer');
  const paymentStatusFilter = searchParams.get('paymentStatus') || 'all';
  const statusFilter = searchParams.get('status') || 'all';
  const paymentMethodFilter = searchParams.get('paymentMethod') || 'all';
  const warehouseFilter = searchParams.get('warehouse') || 'all';
  const channelFilter = searchParams.get('channel') || 'all';
  const sortBy = searchParams.get('sortBy') || 'created_at-desc';

  const cashierOptions = useMemo(
    () => [
      { value: 'all', label: t('combobox.all_cashiers', 'Barcha kassirlar') },
      ...cashiers.map((cashier) => ({
        value: cashier.id,
        label: cashier.username || cashier.full_name || cashier.email || cashier.id,
        keywords: [cashier.full_name, cashier.email].filter(Boolean).join(' '),
      })),
    ],
    [cashiers, t]
  );

  const warehouseOptions = useMemo(
    () => [
      { value: 'all', label: t('combobox.all_warehouses', 'Barcha omborlar') },
      ...warehouses.map((wh) => ({
        value: wh.id,
        label: wh.name || wh.id,
      })),
    ],
    [warehouses, t]
  );

  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedOrderIdForPrint, setSelectedOrderIdForPrint] = useState<string | null>(null);
  const [returnLoadingOrderId, setReturnLoadingOrderId] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const listAnchorRef = useRef<HTMLDivElement | null>(null);
  const prevFilterKeyRef = useRef<string | null>(null);
  const listQueryKey = searchParams.toString();
  const storedQueryKey = useOrdersListStore((state) => state.queryKey);
  const storedPage = useOrdersListStore((state) => state.page);
  const storedScrollTop = useOrdersListStore((state) => state.scrollTop);
  const setStoredPage = useOrdersListStore((state) => state.setPage);
  const setStoredScrollTop = useOrdersListStore((state) => state.setScrollTop);
  const resetForQuery = useOrdersListStore((state) => state.resetForQuery);
  const restoredPage = storedQueryKey === listQueryKey ? storedPage : 0;
  const restoredScrollTop = storedQueryKey === listQueryKey ? storedScrollTop : 0;
  const useVirtualizedList = orders.length > 500;
  const { saveScroll, resetRestoreFlag } = useMainScrollRestoration({
    scrollTop: restoredScrollTop,
    setScrollTop: setStoredScrollTop,
    enabled: !useVirtualizedList,
    ready: !loading && !loadingMore,
    anchorRef: listAnchorRef,
  });

  useEffect(() => {
    if (storedQueryKey !== listQueryKey) {
      resetForQuery(listQueryKey);
    }
  }, [storedQueryKey, listQueryKey, resetForQuery]);
  
  const getEffectiveDiscountAmount = (o: OrderWithDetails | null | undefined) => {
    if (!o) return 0;
    const orderLevel = Number((o as any).discount_amount || 0);
    if (orderLevel > 0) return orderLevel;
    const items = Array.isArray((o as any).items) ? (o as any).items : [];
    const itemsSum = items.reduce((sum: number, it: any) => sum + Number(it?.discount_amount || 0), 0);
    return itemsSum > 0 ? itemsSum : 0;
  };


  const buildBackendFilters = useCallback(() => {
    let date_from: string | undefined;
    let date_to: string | undefined;
    if (dateFilter === 'range' && dfParam && dtParam) {
      date_from = dfParam;
      date_to = dtParam;
    } else if (dateFilter !== 'all' && dateFilter !== 'range') {
      const toDate = new Date();
      const fromDate = new Date(toDate);
      if (dateFilter === 'today') {
        // keep same day
      } else if (dateFilter === 'week') {
        fromDate.setDate(fromDate.getDate() - 7);
      } else if (dateFilter === 'month') {
        fromDate.setMonth(fromDate.getMonth() - 1);
      }
      date_from = formatDateYMD(fromDate);
      date_to = formatDateYMD(toDate);
    }

    const [field, dir] = String(sortBy || 'created_at-desc').split('-');
    const sort_by =
      field === 'total' ? 'total_amount' : field === 'order_number' ? 'order_number' : 'created_at';
    const sort_order = String(dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    return {
      limit: PAGE_SIZE,
      with_details: false,
      search: debouncedSearchTerm?.trim() ? debouncedSearchTerm.trim() : null,
      date_from,
      date_to,
      cashier_id: cashierFilter !== 'all' ? cashierFilter : null,
      customer_id: customerFilter || null,
      payment_status: paymentStatusFilter !== 'all' ? paymentStatusFilter : null,
      status: statusFilter !== 'all' ? statusFilter : null,
      payment_method: paymentMethodFilter !== 'all' ? paymentMethodFilter : null,
      warehouse_id: warehouseFilter !== 'all' ? warehouseFilter : null,
      sales_channel: channelFilter !== 'all' ? channelFilter : null,
      sort_by,
      sort_order,
    } as const;
  }, [
    PAGE_SIZE,
    cashierFilter,
    channelFilter,
    customerFilter,
    dateFilter,
    paymentMethodFilter,
    paymentStatusFilter,
    warehouseFilter,
    debouncedSearchTerm,
    sortBy,
    statusFilter,
    dfParam,
    dtParam,
  ]);

  const loadPage = useCallback(
    async (pageToLoad: number, opts?: { append?: boolean; restore?: boolean }) => {
      try {
        if (opts?.append) setLoadingMore(true);
        else setLoading(true);

        const base = buildBackendFilters();
        const restoreLimit = PAGE_SIZE * (pageToLoad + 1);
        const effectiveLimit = opts?.restore ? restoreLimit : PAGE_SIZE;
        const effectiveOffset = opts?.restore ? 0 : pageToLoad * PAGE_SIZE;
        const rows = await getOrdersPage({
          ...base,
          limit: effectiveLimit,
          offset: effectiveOffset,
        });
        const next = Array.isArray(rows) ? rows : [];

        setOrders((prev) => (opts?.append ? [...prev, ...(next as any[])] : (next as any[])));
        setPage(pageToLoad);
        setHasMore(next.length >= effectiveLimit);

        // Load cashier list once (small)
        if (!opts?.append) {
          const cashiersData = await getProfiles();
          setCashiers(cashiersData);
        }
      } catch (_error) {
        toast({
          title: 'Xatolik',
          description: "Buyurtmalarni yuklab bo'lmadi",
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [PAGE_SIZE, buildBackendFilters, toast]
  );

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    void loadPage(page + 1, { append: true });
  }, [hasMore, loading, loadingMore, loadPage, page]);

  useEffect(() => {
    loadCustomers();
    void loadWarehouses();
  }, []);

  const filterKey = useMemo(
    () =>
      [
        debouncedSearchTerm,
        dateFilter,
        dfParam,
        dtParam,
        cashierFilter,
        customerFilter || '',
        paymentStatusFilter,
        statusFilter,
        paymentMethodFilter,
        warehouseFilter,
        channelFilter,
        sortBy,
      ].join('|'),
    [
      debouncedSearchTerm,
      dateFilter,
      dfParam,
      dtParam,
      cashierFilter,
      customerFilter,
      paymentStatusFilter,
      statusFilter,
      paymentMethodFilter,
      warehouseFilter,
      channelFilter,
      sortBy,
    ]
  );

  useEffect(() => {
    const prev = prevFilterKeyRef.current;
    const isFirst = prev === null;
    prevFilterKeyRef.current = filterKey;

    if (isFirst) {
      if (restoredPage > 0 && storedQueryKey === listQueryKey) {
        void loadPage(restoredPage, { append: false, restore: true });
      } else {
        void loadPage(0, { append: false });
      }
      return;
    }

    if (prev !== filterKey) {
      resetRestoreFlag();
      void loadPage(0, { append: false });
    }
  }, [filterKey, listQueryKey, loadPage, restoredPage, storedQueryKey, resetRestoreFlag]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    if (!hasMore) return;
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        loadMore();
      },
      { root: null, rootMargin: '200px', threshold: 0 }
    );
    observerRef.current.observe(el);
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [hasMore, loadMore]);

  useEffect(() => {
    setStoredPage(page);
  }, [page, setStoredPage]);

  const showReturnAction = (order: OrderWithDetails) =>
    !isWebOrderRow(order) && String(order?.status || '').toLowerCase() === 'completed';

  const canReturnOrder = (order: OrderWithDetails) =>
    showReturnAction(order) && canCreateSalesReturnForOrder(order);

  const fullyReturnedTooltip = t('orders.return_fully_returned_tooltip', {
    defaultValue: 'Bu sotuv to‘liq qaytarilgan. Yangi qaytarish yaratib bo‘lmaydi.',
  });

  const fullyReturnedLabel = t('orders.return_fully_returned_label', {
    defaultValue: 'To‘liq qaytarilgan',
  });

  const handleCreateReturn = (order: OrderWithDetails) => {
    if (!canReturnOrder(order)) return;
    navigate(`/returns/create?orderId=${order.id}`);
  };

  const goToPosEditOrder = (orderId: string) => {
    try {
      sessionStorage.setItem('pos_import_order_id', orderId);
    } catch {
      /* ignore */
    }
    navigate('/pos', { state: { importOrderId: orderId } });
  };

  // Load customers for filter dropdown
  const loadCustomers = async () => {
    try {
      setCustomersLoading(true);
      // Load only active customers
      const customersData = await getCustomers({
        status: 'active',
        sortBy: 'name',
        sortOrder: 'asc',
      });
      setCustomers(customersData);
    } catch (error) {
      console.error('Failed to load customers:', error);
      // Don't show toast, just log error and render disabled select
    } finally {
      setCustomersLoading(false);
    }
  };

  const loadWarehouses = async () => {
    try {
      const data = await getWarehouses({ is_active: true });
      setWarehouses(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load warehouses:', error);
      setWarehouses([]);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; className: string }> = {
      completed: { label: 'Yakunlangan', className: 'bg-success text-white' },
      pending: { label: 'Kutilmoqda', className: 'bg-primary text-white' },
      voided: { label: 'Bekor qilingan', className: 'bg-muted text-muted-foreground' },
      refunded: { label: 'Qaytarilgan', className: 'bg-warning text-white' },
      new: { label: 'Yangi', className: 'bg-primary text-white' },
      paid: { label: "To'langan", className: 'bg-success text-white' },
      processing: { label: 'Tayyorlanmoqda', className: 'bg-primary text-white' },
      ready: { label: 'Tayyor', className: 'bg-success text-white' },
      out_for_delivery: { label: 'Yetkazilmoqda', className: 'bg-warning text-white' },
      delivered: { label: 'Yetkazildi', className: 'bg-success text-white' },
      cancelled: { label: 'Bekor qilingan', className: 'bg-muted text-muted-foreground' },
    };
    const variant = variants[String(status || '').toLowerCase()] || variants.completed;
    return <Badge className={variant.className}>{variant.label}</Badge>;
  };

  const getReturnStatusBadge = (status: string | null | undefined) => {
    const key = String(status || 'not_returned').toLowerCase();
    if (key === 'not_returned' || key === '') return null;
    if (key === 'fully_returned') {
      return (
        <Badge className="bg-orange-600 text-white">
          {t('orders.return_status_fully_returned')}
        </Badge>
      );
    }
    if (key === 'partially_returned') {
      return (
        <Badge variant="outline" className="border-orange-500/50 text-orange-700 dark:text-orange-300">
          {t('orders.return_status_partially_returned')}
        </Badge>
      );
    }
    return null;
  };

  const salesChannelLabel = (order: any) => {
    const ch = String(order?.sales_channel || order?.order_source || 'pos').toLowerCase();
    const labels: Record<string, string> = {
      pos: 'Kassa',
      staff_mobile: 'Mobil sotuv',
      telegram: 'Telegram',
      website: 'Veb-sayt',
      uzum: 'Uzum',
      yandex: 'Yandex',
      other: 'Boshqa',
      web: 'Onlayn',
    };
    return labels[ch] || ch;
  };

  const navigateToOrder = useCallback(
    (order: any) => {
      if (!useVirtualizedList) saveScroll();
      if (isWebOrderRow(order)) {
        const wid = order.web_order_id ?? String(order.id).replace(/^web:/, '');
        navigate(`/web-orders?open=${wid}`, { state: createBackNavigationState(location) });
        return;
      }
      navigate(withReturnToPath(`/orders/${order.id}`, buildCurrentPath(location)));
    },
    [location, navigate, saveScroll, useVirtualizedList],
  );

  const getPaymentStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
      paid: { label: 'To\'langan', variant: 'default' },
      partial: { label: 'Qisman to\'langan', variant: 'secondary' },
      // Backward/IPC compatibility (should be normalized in API, but keep safe)
      on_credit: { label: 'Nasiya', variant: 'destructive' },
      partially_paid: { label: 'Qisman to\'langan', variant: 'secondary' },
      pending: { label: 'Kutilmoqda', variant: 'destructive' },
      unpaid: { label: 'To\'lanmagan', variant: 'destructive' },
    };
    const variant = variants[String(status || '').toLowerCase()] || variants.paid;
    return <Badge variant={variant.variant}>{variant.label}</Badge>;
  };

  const getPaymentMethodIcons = (order: any) => {
    // Lite list: backend provides payment_methods (comma-separated)
    const methodsRaw =
      Array.isArray(order?.payments) && order.payments.length > 0
        ? [...new Set(order.payments.map((p: any) => p.payment_method))].join(',')
        : String(order?.payment_methods || '');

    const methods = methodsRaw
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    if (methods.length === 0) return '-';
    if (methods.length > 1) return <Badge variant="outline">Aralash to'lov</Badge>;

    const method = methods[0];
    const icons: Record<string, string> = {
      cash: '💵',
      card: '💳',
      qr: '📱',
      credit: '📝',
    };
    
    const labels: Record<string, string> = {
      cash: 'Naqd pul',
      card: 'Karta',
      qr: 'QR to\'lov',
      credit: 'Nasiya',
    };
    
    return (
      <div className="flex items-center gap-1">
        <span>{icons[method] || '💰'}</span>
        <span className="text-sm">{labels[method] || method}</span>
      </div>
    );
  };

  // Orders are fetched already filtered/sorted server-side (paged). Keep UI work minimal.
  const filteredOrders = orders;

  // Memoize stats calculation
  const stats = useMemo(() => {
    const completedOrders = filteredOrders.filter((order: any) => String(order?.status || '').toLowerCase() === 'completed');
    const totalSales = completedOrders.reduce((sum, order) => sum + Number(order.total_amount), 0);
    const totalOrders = filteredOrders.length;
    const averageOrder = totalOrders > 0 ? totalSales / totalOrders : 0;
    return { totalSales, totalOrders, averageOrder };
  }, [filteredOrders]);

  const useVirtualized = filteredOrders.length > 500;

  const statTriggerClass =
    'h-7 w-7 shrink-0 rounded-md bg-muted text-muted-foreground flex items-center justify-center';

  const showFullPageSpinner = loading && orders.length === 0;

  return (
    <div
      ref={listAnchorRef}
      className="space-y-2 px-3 pb-3 pt-0 sm:space-y-3 sm:px-4 sm:pb-4 sm:pt-0"
    >
      <div className="flex flex-col gap-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-tight tracking-tight sm:text-lg">
            Buyurtmalar
          </h1>
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground sm:text-xs sm:mt-0.5">
            Kassa, mobil sotuv va onlayn buyurtmalar — bitta ro&apos;yxatda
          </p>
        </div>
      </div>

      {/* Kompakt qisqa statistik — bitta qator, vertikal joy tejalmaydi */}
      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="p-0">
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div
              className="flex items-center gap-2 px-3 py-2 sm:px-4"
              title="Tanlangan davr bo'yicha umumiy tushum"
            >
              <div className={statTriggerClass}>
                <DollarSign className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Jami savdo (yakunlangan)
                </p>
                <p className="truncate text-sm font-semibold tabular-nums leading-tight sm:text-base">
                  {formatMoneyUZS(stats.totalSales)}
                </p>
              </div>
            </div>
            <div
              className="flex items-center gap-2 px-3 py-2 sm:px-4"
              title="Yuklangan buyurtmalar soni"
            >
              <div className={statTriggerClass}>
                <ShoppingCart className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Buyurtmalar
                </p>
                <p className="text-sm font-semibold tabular-nums leading-tight sm:text-base">
                  {stats.totalOrders}
                </p>
              </div>
            </div>
            <div
              className="flex items-center gap-2 px-3 py-2 sm:px-4"
              title="Bir buyurtma uchun o'rtacha summa"
            >
              <div className={statTriggerClass}>
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  O&apos;rtacha chek
                </p>
                <p className="truncate text-sm font-semibold tabular-nums leading-tight sm:text-base">
                  {formatMoneyUZS(stats.averageOrder)}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card default py-6 — filtr uchun o‘chiriladi */}
      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="px-3 py-2 sm:px-3">
          <div className="rounded-md border bg-muted/30 px-2 py-1.5 space-y-1">
            <span className="inline-block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Filtrlar
            </span>

            {/* Bitta qator: qidiruv + barcha selectlar (tor ekranda gorizontal scroll) */}
            <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1">
              <div className="relative h-8 w-[min(14rem,calc(100vw-8rem))] shrink-0">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Qidiruv (raqam, mijoz...)"
                  value={searchTerm}
                  onChange={(e) => updateParams({ search: e.target.value })}
                  className="h-8 w-full bg-background py-1 pl-7 text-xs sm:text-sm"
                />
              </div>

            <div className="min-w-[6.5rem] shrink-0 flex-1 basis-0">
            <Select
              value={dateFilter}
              onValueChange={(value) => {
                const todayIso = formatDateYMD(new Date());
                if (value === 'range') {
                  updateParams({
                    date: 'range',
                    df: dfParam || todayIso,
                    dt: dtParam || todayIso,
                  });
                } else if (value === 'all') {
                  updateParams({ date: 'all', df: null, dt: null });
                } else {
                  updateParams({ date: value, df: null, dt: null });
                }
              }}
            >
              <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                <SelectValue placeholder="Vaqt oralig'i" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha vaqtlar</SelectItem>
                <SelectItem value="today">Bugun</SelectItem>
                <SelectItem value="week">Ushbu hafta</SelectItem>
                <SelectItem value="month">Ushbu oy</SelectItem>
                <SelectItem value="range">Belgilanilgan kunlar</SelectItem>
              </SelectContent>
            </Select>
            </div>

            <div className="min-w-[6.5rem] shrink-0 flex-1 basis-0">
            <SafeOrdersFilterCombobox
              value={cashierFilter}
              onValueChange={(value) => updateParams({ cashier: value })}
              options={cashierOptions}
              placeholder={t('combobox.all_cashiers', 'Barcha kassirlar')}
              searchPlaceholder={t('combobox.search_employee', "Nom yoki email bo'yicha qidirish...")}
              emptyMessage={t('combobox.no_employee', 'Xodim topilmadi')}
              triggerClassName="h-8 bg-background px-2 text-xs"
            />
            </div>

            {/* Customer filter */}
            <div className="min-w-[6.5rem] shrink-0 flex-1 basis-0">
            <SearchableCustomerCombobox
              value={customerFilter || 'all'}
              onValueChange={(value) => updateParams({ customer: value === 'all' ? null : value })}
              knownCustomers={customers}
              status="active"
              disabled={customersLoading}
              loading={customersLoading}
              prefixOptions={[
                { value: 'all', label: t('combobox.all_customers', 'Barcha mijozlar') },
              ]}
              placeholder={
                customersLoading
                  ? t('common.loading', 'Yuklanmoqda...')
                  : t('combobox.all_customers', 'Barcha mijozlar')
              }
              triggerClassName="h-8 bg-background px-2 text-xs"
            />
            </div>

            <div className="min-w-[6.5rem] shrink-0 flex-1 basis-0">
            <SafeOrdersFilterCombobox
              value={warehouseFilter}
              onValueChange={(value) => updateParams({ warehouse: value })}
              options={warehouseOptions}
              placeholder={t('combobox.select_warehouse', 'Omborni tanlang...')}
              searchPlaceholder={t('combobox.search_warehouse', "Ombor nomi bo'yicha qidirish...")}
              emptyMessage={t('combobox.no_warehouse', 'Ombor topilmadi')}
              triggerClassName="h-8 bg-background px-2 text-xs"
            />
            </div>

            <div className="min-w-[6.5rem] shrink-0 flex-1 basis-0">
            <Select value={channelFilter} onValueChange={(value) => updateParams({ channel: value })}>
              <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                <SelectValue placeholder="Kanal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('web_orders.all_channels', 'Barcha kanallar')}</SelectItem>
                <SelectItem value="pos">Kassa (POS)</SelectItem>
                <SelectItem value="staff_mobile">Mobil sotuv</SelectItem>
                <SelectItem value="telegram">{t('web_orders.channel_telegram', 'Telegram')}</SelectItem>
                <SelectItem value="website">{t('web_orders.channel_website', 'Veb-sayt')}</SelectItem>
                <SelectItem value="uzum">{t('web_orders.channel_uzum', 'Uzum')}</SelectItem>
                <SelectItem value="yandex">{t('web_orders.channel_yandex', 'Yandex')}</SelectItem>
                <SelectItem value="other">{t('web_orders.channel_other', 'Boshqa')}</SelectItem>
              </SelectContent>
            </Select>
            </div>

            <div className="min-w-[6.5rem] shrink-0 flex-1 basis-0">
            <Select value={paymentStatusFilter} onValueChange={(value) => updateParams({ paymentStatus: value })}>
              <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                <SelectValue placeholder="To'lov holati" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha to'lov holatlari</SelectItem>
                <SelectItem value="paid">To'langan</SelectItem>
                <SelectItem value="partial">Qisman to'langan</SelectItem>
                <SelectItem value="on_credit">Nasiya</SelectItem>
                <SelectItem value="pending">Kutilmoqda</SelectItem>
              </SelectContent>
            </Select>
            </div>

            <div className="min-w-[6.5rem] shrink-0 flex-1 basis-0">
            <Select value={statusFilter} onValueChange={(value) => updateParams({ status: value })}>
              <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                <SelectValue placeholder="Buyurtma holati" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha buyurtma holatlari</SelectItem>
                <SelectItem value="completed">Yakunlangan</SelectItem>
                <SelectItem value="pending">Kutilmoqda</SelectItem>
                <SelectItem value="voided">Bekor qilingan</SelectItem>
                <SelectItem value="refunded">Qaytarilgan</SelectItem>
              </SelectContent>
            </Select>
            </div>

            <div className="min-w-[6.5rem] shrink-0 flex-1 basis-0">
            <Select value={paymentMethodFilter} onValueChange={(value) => updateParams({ paymentMethod: value })}>
              <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                <SelectValue placeholder="To'lov usuli" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha to'lov usullari</SelectItem>
                <SelectItem value="cash">Naqd pul</SelectItem>
                <SelectItem value="card">Karta</SelectItem>
                <SelectItem value="qr">QR to'lov</SelectItem>
                <SelectItem value="credit">Nasiya</SelectItem>
              </SelectContent>
            </Select>
            </div>

            <div className="min-w-[6.5rem] shrink-0 flex-1 basis-0">
            <Select value={sortBy} onValueChange={(value) => updateParams({ sortBy: value })}>
              <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                <SelectValue placeholder="Saralash" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created_at-desc">Eng yangisi</SelectItem>
                <SelectItem value="created_at-asc">Eng eskisi</SelectItem>
                <SelectItem value="total-desc">Jami summa (Qimmat → Arzon)</SelectItem>
                <SelectItem value="total-asc">Jami summa (Arzon → Qimmat)</SelectItem>
                <SelectItem value="order_number-asc">Buyurtma raqami (A-Z)</SelectItem>
                <SelectItem value="order_number-desc">Buyurtma raqami (Z-A)</SelectItem>
              </SelectContent>
            </Select>
            </div>
            </div>

            {dateFilter === 'range' && (
              <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 border-t border-dashed border-muted-foreground/30 pt-1">
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Muddat
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex-nowrap">
                  <Label htmlFor="orders-df" className="sr-only">
                    Dan sanasi
                  </Label>
                  <Input
                    id="orders-df"
                    type="date"
                    className="h-8 min-w-[9.5rem] flex-1 bg-background px-2 font-mono text-xs"
                    value={dfParam}
                    onChange={(e) => updateParams({ df: e.target.value || null })}
                  />
                  <span className="shrink-0 text-muted-foreground" aria-hidden>
                    —
                  </span>
                  <Label htmlFor="orders-dt" className="sr-only">
                    Gacha sanasi
                  </Label>
                  <Input
                    id="orders-dt"
                    type="date"
                    className="h-8 min-w-[9.5rem] flex-1 bg-background px-2 font-mono text-xs"
                    value={dtParam}
                    min={dfParam || undefined}
                    onChange={(e) => updateParams({ dt: e.target.value || null })}
                  />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b px-4 py-2">
          <CardTitle className="text-base font-semibold">Buyurtmalar</CardTitle>
          <span className="text-xs font-normal text-muted-foreground tabular-nums sm:text-sm">
            Yuklangan: {filteredOrders.length}
          </span>
        </CardHeader>
        <CardContent className="px-2 pb-3 pt-0 sm:px-4">
          {showFullPageSpinner ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Buyurtmalar topilmadi</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              {useVirtualized ? (
                <VirtualizedOrdersTable
                  orders={filteredOrders as any[]}
                  getEffectiveDiscountAmount={getEffectiveDiscountAmount}
                  getPaymentStatusBadge={getPaymentStatusBadge}
                  getStatusBadge={getStatusBadge}
                  getReturnStatusBadge={getReturnStatusBadge}
                  getPaymentMethodIcons={getPaymentMethodIcons}
                  onView={(id) => {
                    const order = filteredOrders.find((o: any) => o.id === id);
                    if (order) navigateToOrder(order);
                  }}
                  onEditPos={goToPosEditOrder}
                  canEditInPos={canEditOrderInPos}
                  onPrint={(id) => {
                    setSelectedOrderIdForPrint(id);
                    setPrintDialogOpen(true);
                  }}
                  onReturn={(id) => navigate(`/returns/create?orderId=${id}`)}
                  showReturnAction={showReturnAction}
                  canReturn={canReturnOrder}
                  returnFullyReturnedLabel={fullyReturnedLabel}
                  returnFullyReturnedTooltip={fullyReturnedTooltip}
                  hasMore={hasMore}
                  loadingMore={loadingMore}
                  loadMore={loadMore}
                  initialScrollTop={
                    !loading && !loadingMore && storedQueryKey === listQueryKey ? restoredScrollTop : 0
                  }
                  onScrollTopChange={setStoredScrollTop}
                />
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-9 text-xs font-medium">Buyurtma raqami</TableHead>
                        <TableHead className="h-9 text-xs font-medium">Kanal</TableHead>
                        <TableHead className="h-9 text-xs font-medium">Sana va vaqt</TableHead>
                        <TableHead className="h-9 text-xs font-medium">Kassir</TableHead>
                        <TableHead className="h-9 text-xs font-medium">Mijoz</TableHead>
                        <TableHead className="h-9 text-right text-xs font-medium">{t('orders.gross_total')}</TableHead>
                        <TableHead className="h-9 text-right text-xs font-medium">{t('orders.returned_total')}</TableHead>
                        <TableHead className="h-9 text-right text-xs font-medium">{t('orders.net_total')}</TableHead>
                        <TableHead className="h-9 w-[120px] text-right text-xs font-medium">Chegirma</TableHead>
                        <TableHead className="h-9 text-xs font-medium">To'lov holati</TableHead>
                        <TableHead className="h-9 text-xs font-medium">To'lov usuli</TableHead>
                        <TableHead className="h-9 text-xs font-medium">Holati</TableHead>
                        <TableHead className="h-9 text-right text-xs font-medium">Amallar</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-sm [&_td]:py-2">
                      {filteredOrders.map((order: any) => (
                        <TableRow key={order.id} className="hover:bg-muted/40">
                          <TableCell className="font-mono font-medium">
                            {searchTerm ? highlightMatch(String(order.order_number ?? ''), searchTerm) : order.order_number}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-normal">
                              {salesChannelLabel(order)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {formatOrderDateTime(order.created_at)}
                          </TableCell>
                          <TableCell>
                            {order.cashier_name || order.cashier?.username || '-'}
                          </TableCell>
                          <TableCell>
                            {searchTerm && order.customer_name
                              ? highlightMatch(order.customer_name, searchTerm)
                              : (order.customer_name || 'Yangi mijoz')}
                          </TableCell>
                          <TableCell className="text-right align-top">
                            <span className="font-medium tabular-nums">
                              {formatOrderMoney(order, order.gross_total ?? order.total_amount)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right align-top">
                            {Number(order.returned_total || 0) > 0 ? (
                              <span className="tabular-nums text-destructive">
                                {formatOrderMoney(order, order.returned_total)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right align-top">
                            <span className="font-medium tabular-nums">
                              {formatOrderMoney(
                                order,
                                order.net_total ??
                                  Math.max(
                                    0,
                                    Number(order.total_amount || 0) - Number(order.returned_total || 0),
                                  ),
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-right align-top">
                            {(() => {
                              const d = getEffectiveDiscountAmount(order);
                              return d > 0 ? (
                                <Badge
                                  variant="outline"
                                  className="tabular-nums font-normal border-emerald-600/35 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/35 dark:text-emerald-50 dark:border-emerald-700/50"
                                  title="Aksiya yoki qator chegirmasi"
                                >
                                  −{formatOrderMoney(order, d)}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">—</span>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            {getPaymentStatusBadge(order.payment_status)}
                          </TableCell>
                          <TableCell>
                            {getPaymentMethodIcons(order)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1">
                              {getStatusBadge(order.status)}
                              {getReturnStatusBadge(order.return_status)}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {canEditOrderInPos(order) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => goToPosEditOrder(order.id)}
                                  title={t('orders.edit_in_pos_hint')}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => navigateToOrder(order)}
                                title="Tafsilotlarini ko'rish"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              {!isWebOrderRow(order) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setSelectedOrderIdForPrint(order.id);
                                    setPrintDialogOpen(true);
                                  }}
                                  title="Chek chiqarish"
                                >
                                  <Printer className="h-4 w-4" />
                                </Button>
                              )}
                              {!isWebOrderRow(order) && order.status === 'completed' && (
                                canReturnOrder(order) ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleCreateReturn(order)}
                                    title={t('orders.return_sale', { defaultValue: 'Sotuvni qaytarish' })}
                                    aria-label={t('orders.return_sale', { defaultValue: 'Sotuvni qaytarish' })}
                                    className="text-orange-500 hover:text-orange-600 hover:bg-orange-50"
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled
                                    title={fullyReturnedTooltip}
                                    aria-label={fullyReturnedLabel}
                                    className="text-muted-foreground opacity-60"
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                  </Button>
                                )
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {/* Infinite scroll sentinel (auto-load) */}
                  <div ref={loadMoreRef} className="h-1 w-full" />
                  <div className="flex items-center justify-between gap-3 pt-3">
                    <p className="text-xs text-muted-foreground">
                      Sahifa: <span className="font-medium">{page + 1}</span>
                    </p>
                    {hasMore ? (
                      <Button variant="outline" onClick={() => loadMore()} disabled={loadingMore}>
                        {loadingMore ? 'Yuklanmoqda...' : 'Yana yuklash'}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Barchasi yuklandi</span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Print Dialog */}
      {selectedOrderIdForPrint && (
        <PrintDialog
          open={printDialogOpen}
          onOpenChange={setPrintDialogOpen}
          orderId={selectedOrderIdForPrint}
        />
      )}

    </div>
  );
}
