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
import { getOrdersPage, getProfiles, getCustomers, getSalesReturnByOrderId } from '@/db/api';
import type { OrderWithDetails, Profile, Customer } from '@/types/database';
import { Search, Eye, Printer, RotateCcw, DollarSign, ShoppingCart, TrendingUp } from 'lucide-react';
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
import { formatMoneyUZS } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/datetime';
import PrintDialog from '@/components/print/PrintDialog';
import VirtualizedOrdersTable from '@/components/orders/VirtualizedOrdersTable';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import { createBackNavigationState } from '@/lib/pageState';
import { useOrdersListStore } from '@/store/ordersListStore';
import { useDebounce } from '@/hooks/use-debounce';

export default function Orders() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: 'orders.filters.query',
    trackedKeys: [
      'search',
      'date',
      'cashier',
      'customer',
      'paymentStatus',
      'status',
      'paymentMethod',
      'sortBy',
    ],
  });
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [cashiers, setCashiers] = useState<Profile[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const [customersLoading, setCustomersLoading] = useState(true);
  const searchTerm = searchParams.get('search') || '';
  const debouncedSearchTerm = useDebounce(searchTerm, 200);
  const dateFilter = searchParams.get('date') || 'all';
  const cashierFilter = searchParams.get('cashier') || 'all';
  const customerFilter = searchParams.get('customer');
  const paymentStatusFilter = searchParams.get('paymentStatus') || 'all';
  const statusFilter = searchParams.get('status') || 'all';
  const paymentMethodFilter = searchParams.get('paymentMethod') || 'all';
  const sortBy = searchParams.get('sortBy') || 'created_at-desc';
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedOrderIdForPrint, setSelectedOrderIdForPrint] = useState<string | null>(null);
  const [returnLoadingOrderId, setReturnLoadingOrderId] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const listQueryKey = searchParams.toString();
  const storedQueryKey = useOrdersListStore((state) => state.queryKey);
  const storedPage = useOrdersListStore((state) => state.page);
  const storedScrollTop = useOrdersListStore((state) => state.scrollTop);
  const setStoredPage = useOrdersListStore((state) => state.setPage);
  const setStoredScrollTop = useOrdersListStore((state) => state.setScrollTop);
  const resetForQuery = useOrdersListStore((state) => state.resetForQuery);
  const restoredPage = storedQueryKey === listQueryKey ? storedPage : 0;
  const restoredScrollTop = storedQueryKey === listQueryKey ? storedScrollTop : 0;

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
    // Date range
    let date_from: string | undefined;
    let date_to: string | undefined;
    if (dateFilter !== 'all') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const from = new Date(today);
      if (dateFilter === 'week') from.setDate(from.getDate() - 7);
      if (dateFilter === 'month') from.setMonth(from.getMonth() - 1);
      date_from = from.toISOString();
      date_to = new Date().toISOString();
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
      sort_by,
      sort_order,
    } as const;
  }, [
    PAGE_SIZE,
    cashierFilter,
    customerFilter,
    dateFilter,
    paymentMethodFilter,
    paymentStatusFilter,
    debouncedSearchTerm,
    sortBy,
    statusFilter,
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
  }, []);

  useEffect(() => {
    // Refetch first page when filters change (server-side filtering)
    loadPage(restoredPage, { append: false, restore: restoredPage > 0 });
  }, [buildBackendFilters, restoredPage]);

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

  // Navigate to Create Return screen with order preselected
  const handleCreateReturn = (order: OrderWithDetails) => {
    navigate(`/returns/create?orderId=${order.id}`);
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

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; className: string }> = {
      completed: { label: 'Yakunlangan', className: 'bg-success text-white' },
      pending: { label: 'Kutilmoqda', className: 'bg-primary text-white' },
      voided: { label: 'Bekor qilingan', className: 'bg-muted text-muted-foreground' },
      refunded: { label: 'Qaytarilgan', className: 'bg-warning text-white' },
    };
    const variant = variants[status] || variants.completed;
    return <Badge className={variant.className}>{variant.label}</Badge>;
  };

  const getPaymentStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
      paid: { label: 'To\'langan', variant: 'default' },
      partial: { label: 'Qisman to\'langan', variant: 'secondary' },
      unpaid: { label: 'To\'lanmagan', variant: 'destructive' },
      // Backward/IPC compatibility (should be normalized in API, but keep safe)
      on_credit: { label: 'Nasiya', variant: 'destructive' },
      partially_paid: { label: 'Qisman to\'langan', variant: 'secondary' },
      pending: { label: 'To\'lanmagan', variant: 'destructive' },
    };
    const variant = variants[status] || variants.paid;
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
    const totalSales = filteredOrders.reduce((sum, order) => sum + Number(order.total_amount), 0);
    const totalOrders = filteredOrders.length;
    const averageOrder = totalOrders > 0 ? totalSales / totalOrders : 0;
    return { totalSales, totalOrders, averageOrder };
  }, [filteredOrders]);

  const useVirtualized = filteredOrders.length > 500;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Buyurtmalar</h1>
          <p className="text-muted-foreground">Barcha savdo buyurtmalarini ko'rish va boshqarish</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jami savdo</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoneyUZS(stats.totalSales)}</div>
            <p className="text-xs text-muted-foreground">Tanlangan davr bo'yicha umumiy tushum</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jami buyurtmalar</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalOrders}</div>
            <p className="text-xs text-muted-foreground">Qayta ishlangan buyurtmalar soni</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">O'rtacha buyurtma qiymati</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoneyUZS(stats.averageOrder)}</div>
            <p className="text-xs text-muted-foreground">Bir buyurtma uchun o'rtacha summa</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtrlar</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-8 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buyurtmalarni qidirish..."
                value={searchTerm}
                onChange={(e) => updateParams({ search: e.target.value })}
                className="pl-9"
              />
            </div>

            <Select value={dateFilter} onValueChange={(value) => updateParams({ date: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Sana oralig'i" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha vaqtlar</SelectItem>
                <SelectItem value="today">Bugun</SelectItem>
                <SelectItem value="week">Ushbu hafta</SelectItem>
                <SelectItem value="month">Ushbu oy</SelectItem>
              </SelectContent>
            </Select>

            <Select value={cashierFilter} onValueChange={(value) => updateParams({ cashier: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Barcha kassirlar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha kassirlar</SelectItem>
                {cashiers.map((cashier) => (
                  <SelectItem key={cashier.id} value={cashier.id}>
                    {cashier.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Customer filter */}
            <Select
              value={customerFilter || 'all'}
              onValueChange={(value) => updateParams({ customer: value === 'all' ? null : value })}
              disabled={customersLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={customersLoading ? 'Yuklanmoqda...' : 'Barcha mijozlar'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha mijozlar</SelectItem>
                {customers.length === 0 && !customersLoading ? (
                  <SelectItem value="none" disabled>Mijozlar yuklanmadi</SelectItem>
                ) : (
                  customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            <Select value={paymentStatusFilter} onValueChange={(value) => updateParams({ paymentStatus: value })}>
              <SelectTrigger>
                <SelectValue placeholder="To'lov holati" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha to'lov holatlari</SelectItem>
                <SelectItem value="paid">To'langan</SelectItem>
                <SelectItem value="partial">Qisman to'langan</SelectItem>
                <SelectItem value="unpaid">To'lanmagan</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={(value) => updateParams({ status: value })}>
              <SelectTrigger>
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

            <Select value={paymentMethodFilter} onValueChange={(value) => updateParams({ paymentMethod: value })}>
              <SelectTrigger>
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

            <Select value={sortBy} onValueChange={(value) => updateParams({ sortBy: value })}>
              <SelectTrigger>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Buyurtmalar (Yuklangan: {filteredOrders.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
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
                  getPaymentStatusBadge={getPaymentStatusBadge}
                  getStatusBadge={getStatusBadge}
                  getPaymentMethodIcons={getPaymentMethodIcons}
                  onView={(id) =>
                    navigate(`/orders/${id}`, {
                      state: createBackNavigationState(location),
                    })
                  }
                  onPrint={(id) => {
                    setSelectedOrderIdForPrint(id);
                    setPrintDialogOpen(true);
                  }}
                  onReturn={(id) => navigate(`/returns/create?orderId=${id}`)}
                  canReturn={(o) => String(o?.status || '') === 'completed'}
                  hasMore={hasMore}
                  loadingMore={loadingMore}
                  loadMore={loadMore}
                  initialScrollTop={restoredScrollTop}
                  onScrollTopChange={setStoredScrollTop}
                />
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Buyurtma raqami</TableHead>
                        <TableHead>Sana va vaqt</TableHead>
                        <TableHead>Kassir</TableHead>
                        <TableHead>Mijoz</TableHead>
                        <TableHead className="text-right">Jami summa</TableHead>
                        <TableHead>To'lov holati</TableHead>
                        <TableHead>To'lov usuli</TableHead>
                        <TableHead>Holati</TableHead>
                        <TableHead className="text-right">Amallar</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.map((order: any) => (
                        <TableRow key={order.id}>
                          <TableCell className="font-mono font-medium">
                            {searchTerm ? highlightMatch(String(order.order_number ?? ''), searchTerm) : order.order_number}
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
                          <TableCell className="text-right font-medium">
                            <div>{formatMoneyUZS(order.total_amount)}</div>
                            {getEffectiveDiscountAmount(order) > 0 && (
                              <div className="text-xs text-destructive">
                                Chegirma: -{formatMoneyUZS(getEffectiveDiscountAmount(order))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {getPaymentStatusBadge(order.payment_status)}
                          </TableCell>
                          <TableCell>
                            {getPaymentMethodIcons(order)}
                          </TableCell>
                          <TableCell>
                            {getStatusBadge(order.status)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  navigate(`/orders/${order.id}`, {
                                    state: createBackNavigationState(location),
                                  })
                                }
                                title="Tafsilotlarini ko'rish"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
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
                              {order.status === 'completed' && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleCreateReturn(order)}
                                  title="Sotuvni qaytarish"
                                  className="text-orange-500 hover:text-orange-600 hover:bg-orange-50"
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </Button>
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
