import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
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
import SearchableSupplierCombobox from '@/components/common/SearchableSupplierCombobox';
import PageQuickActions from '@/components/common/PageQuickActions';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  approvePurchaseOrder,
  deletePurchaseOrder,
  exportPurchaseOrders,
  getPurchaseOrderById,
  getPurchaseOrders,
  getSuppliers,
  productUpdateEmitter,
  receiveGoods,
} from '@/db/api';
import type { PurchaseOrderWithDetails, SupplierWithBalance } from '@/types/database';
import { Plus, Search, FileDown, Eye, Edit, Package, X, DollarSign, CheckCircle, Trash2, CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import { formatMoney } from '@/lib/currency';
import PaySupplierDialog from '@/components/suppliers/PaySupplierDialog';
import { useAuth } from '@/contexts/AuthContext';
import { formatDate } from '@/lib/datetime';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import { useMainScrollRestoration } from '@/hooks/useMainScrollRestoration';
import { createBackNavigationState, buildCurrentPath } from '@/lib/pageState';
import { listSessionStorageKey, withReturnToPath } from '@/lib/listState';
import { usePurchaseOrdersListStore } from '@/store/purchaseOrdersListStore';
import {
  canExportPurchaseOrders,
  computePurchaseRemainder,
} from '@/lib/purchase/purchaseHardening';

const PAGE_SIZE = 50;

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { profile, role, user } = useAuth();
  const listAnchorRef = useRef<HTMLDivElement | null>(null);
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: listSessionStorageKey(
      'purchase-orders',
      user?.id,
      (profile as { branch_id?: string } | null)?.branch_id,
    ),
    trackedKeys: ['search', 'status', 'supplier', 'dateFrom', 'dateTo', 'sortBy', 'page'],
  });
  const listQueryKey = searchParams.toString();
  const storedQueryKey = usePurchaseOrdersListStore((state) => state.queryKey);
  const storedScrollTop = usePurchaseOrdersListStore((state) => state.scrollTop);
  const setStoredScrollTop = usePurchaseOrdersListStore((state) => state.setScrollTop);
  const resetForQuery = usePurchaseOrdersListStore((state) => state.resetForQuery);
  const restoredScrollTop = storedQueryKey === listQueryKey ? storedScrollTop : 0;
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderWithDetails[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const searchTerm = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status') || 'all';
  const supplierFilter = searchParams.get('supplier') || 'all';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const sortBy = searchParams.get('sortBy') || 'order_date-desc';
  const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrderWithDetails | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseOrderWithDetails | null>(null);
  const [deleting, setDeleting] = useState(false);
  const isAdmin = role === 'admin' || profile?.role === 'admin';
  const canExport = canExportPurchaseOrders(profile?.role || role);

  useEffect(() => {
    if (storedQueryKey !== listQueryKey) {
      resetForQuery(listQueryKey);
    }
  }, [storedQueryKey, listQueryKey, resetForQuery]);

  const { saveScroll } = useMainScrollRestoration({
    scrollTop: restoredScrollTop,
    setScrollTop: setStoredScrollTop,
    ready: !loading,
    anchorRef: listAnchorRef,
  });

  const navigateWithReturnTo = (detailPath: string) => {
    saveScroll();
    navigate(withReturnToPath(detailPath, buildCurrentPath(location)));
  };

  useEffect(() => {
    loadData();
  }, [statusFilter, supplierFilter, dateFrom, dateTo, searchTerm, sortBy, page]);

  useEffect(() => {
    const unsubscribe = productUpdateEmitter.subscribe(() => {
      loadData();
    });
    return unsubscribe;
  }, []);

  const buildListFilters = (opts?: { withTotal?: boolean; forExport?: boolean }) => {
    const [field, dir] = String(sortBy || 'order_date-desc').split('-');
    const filters: Record<string, unknown> = {
      sort_by: field || 'order_date',
      sort_dir: dir === 'asc' ? 'asc' : 'desc',
    };
    if (statusFilter !== 'all') filters.status = statusFilter;
    if (supplierFilter !== 'all') filters.supplier_id = supplierFilter;
    if (dateFrom) filters.date_from = dateFrom;
    if (dateTo) filters.date_to = dateTo;
    if (searchTerm) filters.search = searchTerm;
    if (opts?.forExport) return filters;
    filters.with_total = true;
    filters.limit = PAGE_SIZE;
    filters.offset = (page - 1) * PAGE_SIZE;
    return filters;
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const filters = buildListFilters({ withTotal: true });

      const [ordersData, suppliersData] = await Promise.all([
        getPurchaseOrders(filters as any),
        getSuppliers(),
      ]);

      if (Array.isArray(ordersData)) {
        setPurchaseOrders(ordersData);
        setTotalCount(ordersData.length);
      } else if (ordersData && typeof ordersData === 'object' && Array.isArray((ordersData as any).rows)) {
        setPurchaseOrders((ordersData as any).rows);
        setTotalCount(Number((ordersData as any).total || 0));
      } else {
        setPurchaseOrders([]);
        setTotalCount(0);
      }
      setSuppliers(Array.isArray(suppliersData) ? suppliersData : []);
    } catch (err) {
      const loadError = err instanceof Error ? err : new Error("Xarid buyurtmalarini yuklab bo'lmadi");
      console.error('Error loading purchase orders:', loadError);
      setError(loadError);
      setPurchaseOrders([]);
      setTotalCount(0);
      toast({
        title: 'Xatolik',
        description: loadError.message || "Xarid buyurtmalarini yuklab bo'lmadi",
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    loadData();
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      draft: { label: 'Qoralama', className: 'bg-muted text-muted-foreground' },
      approved: { label: 'Tasdiqlangan', className: 'bg-primary text-white' },
      partially_received: { label: 'Qisman qabul qilingan', className: 'bg-warning text-white' },
      received: { label: 'Qabul qilingan', className: 'bg-success text-white' },
      cancelled: { label: 'Bekor qilingan', className: 'bg-destructive text-destructive-foreground' },
    };
    
    const config = statusConfig[status] || { label: status, className: '' };
    return (
      <Badge className={`${config.className} px-1.5 py-0 text-[10px] font-normal sm:text-xs`}>{config.label}</Badge>
    );
  };

  const calculateTotalReceived = (items: any[]) => {
    if (!items || items.length === 0) return 0;
    return items.reduce((sum, item) => {
      const receivedQty = Number(item.received_qty) || 0;
      const unitCost = Number(item.unit_cost) || 0;
      return sum + (receivedQty * unitCost);
    }, 0);
  };

  const getPaymentStatusBadge = (status?: string, hasAdvance?: boolean) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      UNPAID: { label: 'To\'lanmagan', className: 'bg-destructive text-white' },
      PARTIALLY_PAID: { label: 'Qisman to\'langan', className: 'bg-warning text-white' },
      PAID: { label: 'To\'langan', className: 'bg-success text-white' },
      OVERPAID: { label: 'Avans mavjud', className: 'bg-blue-600 text-white' },
      SUPPLIER_ADVANCE: { label: 'Avans mavjud', className: 'bg-blue-600 text-white' },
    };

    const key =
      hasAdvance || status === 'OVERPAID' || status === 'SUPPLIER_ADVANCE'
        ? 'OVERPAID'
        : status || 'UNPAID';
    const config = statusConfig[key] || statusConfig.UNPAID;
    return (
      <Badge className={`${config.className} px-1.5 py-0 text-[10px] font-normal sm:text-xs`}>{config.label}</Badge>
    );
  };

  const handlePayClick = (po: PurchaseOrderWithDetails) => {
    if (!po.supplier) {
      toast({
        title: 'Xatolik',
        description: 'Yetkazib beruvchi topilmadi',
        variant: 'destructive',
      });
      return;
    }
    setSelectedPO(po);
    setPayDialogOpen(true);
  };

  const handlePaymentSuccess = () => {
    loadData(); // Reload to refresh payment info
  };

  const handleApprove = async (poId: string) => {
    try {
      await approvePurchaseOrder(poId, profile?.id || 'default-admin-001');

      // OPTIONAL FLOW (requested): approving a saved draft should also increase stock.
      // Receive all remaining quantities right away.
      const refreshed = await getPurchaseOrderById(poId);
      const receiveItems = (refreshed.items || []).map((item: any) => ({
        item_id: item.id,
        received_qty: item.ordered_qty - item.received_qty,
      })).filter((it: any) => Number(it.received_qty) > 0);

      if (receiveItems.length > 0) {
        await receiveGoods(poId, receiveItems);
        productUpdateEmitter.emit();
      }

      toast({
        title: 'Muvaffaqiyatli',
        description: receiveItems.length > 0
          ? 'Xarid buyurtmasi tasdiqlandi va omborga qabul qilindi'
          : 'Xarid buyurtmasi tasdiqlandi',
      });
      loadData(); // Refresh the list
    } catch (error: any) {
      toast({
        title: 'Xatolik',
        description: error.message || 'Xarid buyurtmasini tasdiqlab bo\'lmadi',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteClick = (po: PurchaseOrderWithDetails) => {
    if (!isAdmin) {
      toast({
        title: 'Xatolik',
        description: 'Faqat administrator qoralama yoki bekor qilingan buyurtmalarni o‘chirishi mumkin',
        variant: 'destructive',
      });
      return;
    }
    setDeleteTarget(po);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      const deleteId = deleteTarget.id;
      await deletePurchaseOrder(deleteId);
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Qoralama xarid buyurtmasi o‘chirildi',
      });
      setPurchaseOrders((prev) => prev.filter((po) => po.id !== deleteId));
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Xatolik',
        description: error.message || 'Xarid buyurtmasini o‘chirib bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = async () => {
    if (!canExport) {
      toast({
        title: t('common.error', 'Error'),
        description: t(
          'purchase_orders.export_role_required',
          'Export requires accountant/manager/admin',
        ),
        variant: 'destructive',
      });
      return;
    }
    try {
      setExporting(true);
      const result = await exportPurchaseOrders(buildListFilters({ forExport: true }), {
        exported_by: profile?.id || null,
      });
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      const header = [
        'po_number',
        'supplier_name',
        'order_date',
        'status',
        'currency',
        'total_amount',
        'total_usd',
        'paid_amount',
        'remaining_amount',
        'payment_status',
      ];
      const escape = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [
        header.join(','),
        ...rows.map((r: any) =>
          header
            .map((h) =>
              escape(
                h === 'supplier_name'
                  ? r.supplier_name || r.supplier?.name || ''
                  : r[h],
              ),
            )
            .join(','),
        ),
      ];
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: t('common.success', 'Success'),
        description: t('purchase_orders.export_done', 'Exported {{count}} orders', {
          count: rows.length,
        }),
      });
    } catch (e: any) {
      toast({
        title: t('common.error', 'Error'),
        description: e?.message || t('purchase_orders.export_failed', 'Export failed'),
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  const filteredOrders = Array.isArray(purchaseOrders) ? purchaseOrders : [];
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="w-full min-w-0 space-y-4" ref={listAnchorRef}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">Xarid buyurtmalari</h1>
          <p className="page-heading-sub">Xarid buyurtmalarini boshqarish va tovar qabul qilish</p>
        </div>
      </div>

      <PageQuickActions
        aria-label={t('quickActions.aria_label')}
        actions={[
          {
            id: 'new-po',
            icon: <Plus />,
            label: t('quickActions.new_po'),
            variant: 'default',
            onClick: () => navigateWithReturnTo('/purchase-orders/new'),
          },
          {
            id: 'receive',
            icon: <Package />,
            label: t('quickActions.receive_goods'),
            onClick: () =>
              navigate('/purchase-receipts/new', { state: createBackNavigationState(location) }),
          },
          {
            id: 'due',
            icon: <CalendarClock />,
            label: t('quickActions.po_due'),
            onClick: () =>
              navigate('/purchase-orders/due', { state: createBackNavigationState(location) }),
          },
        ]}
      />

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="px-3 py-2 sm:px-3">
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <span className="mb-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Filtrlar
            </span>
            <div className="flex flex-col gap-2">
              <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center">
                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center xl:max-w-xl">
                  <div className="relative h-8 min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buyurtma raqami yoki yetkazib beruvchi bo'yicha qidirish..."
                      value={searchTerm}
                      onChange={(e) => updateParams({ search: e.target.value, page: '1' })}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      className="h-8 py-1 pl-8 text-xs sm:text-sm"
                    />
                  </div>
                  <Button type="button" size="sm" className="h-8 shrink-0 text-xs sm:w-auto" onClick={handleSearch}>
                    Qidirish
                  </Button>
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <div className="min-w-[10rem] flex-1 sm:max-w-[13rem]">
                    <Select value={statusFilter} onValueChange={(value) => updateParams({ status: value, page: '1' })}>
                      <SelectTrigger className="h-8 w-full bg-background text-xs [&_span]:truncate">
                        <SelectValue placeholder="Holati" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Barcha holatlar</SelectItem>
                        <SelectItem value="draft">Qoralama</SelectItem>
                        <SelectItem value="approved">Tasdiqlangan</SelectItem>
                        <SelectItem value="partially_received">Qisman qabul qilingan</SelectItem>
                        <SelectItem value="received">Qabul qilingan</SelectItem>
                        <SelectItem value="cancelled">Bekor qilingan</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-[10rem] flex-1 sm:max-w-[14rem]">
                    <SearchableSupplierCombobox
                      value={supplierFilter}
                      onValueChange={(value) => updateParams({ supplier: value, page: '1' })}
                      suppliers={suppliers}
                      prefixOptions={[
                        {
                          value: 'all',
                          label: t('combobox.all_suppliers', 'Barcha yetkazib beruvchilar'),
                        },
                      ]}
                      triggerClassName="h-8 bg-background text-xs"
                    />
                  </div>
                  <div className="min-w-[10rem] flex-1 sm:max-w-[14rem]">
                    <Select value={sortBy} onValueChange={(value) => updateParams({ sortBy: value, page: '1' })}>
                      <SelectTrigger className="h-8 w-full bg-background text-xs [&_span]:truncate">
                        <SelectValue placeholder="Saralash" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="order_date-desc">Eng yangisi</SelectItem>
                        <SelectItem value="order_date-asc">Eng eskisi</SelectItem>
                        <SelectItem value="total-desc">Jami summa (Qimmat → Arzon)</SelectItem>
                        <SelectItem value="total-asc">Jami summa (Arzon → Qimmat)</SelectItem>
                        <SelectItem value="remaining-desc">Qoldiq (Ko'p → Kam)</SelectItem>
                        <SelectItem value="remaining-asc">Qoldiq (Kam → Ko'p)</SelectItem>
                        <SelectItem value="paid-desc">To'langan (Ko'p → Kam)</SelectItem>
                        <SelectItem value="paid-asc">To'langan (Kam → Ko'p)</SelectItem>
                        <SelectItem value="po_number-asc">Buyurtma raqami (A-Z)</SelectItem>
                        <SelectItem value="po_number-desc">Buyurtma raqami (Z-A)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 text-xs"
                    disabled={exporting || !canExport}
                    onClick={handleExport}
                    title={
                      canExport
                        ? undefined
                        : t(
                            'purchase_orders.export_role_required',
                            'Export requires accountant/manager/admin',
                          )
                    }
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    {exporting
                      ? t('common.exporting', 'Exporting...')
                      : t('common.export', 'Export')}
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="min-w-[10rem] flex-1 space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Boshlanish
                  </label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => updateParams({ dateFrom: e.target.value, page: '1' })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="min-w-[10rem] flex-1 space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tugash</label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => updateParams({ dateTo: e.target.value, page: '1' })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b px-4 py-2 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">Buyurtmalar</span>
            <span className="text-xs font-normal tabular-nums text-muted-foreground">({filteredOrders.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-3 pt-0">
          {loading ? (
            <div
              className="mx-4 my-10 flex min-h-[180px] flex-col items-center justify-center gap-3"
              role="status"
              aria-label="Yuklanmoqda"
            >
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">Yuklanmoqda...</p>
            </div>
          ) : error ? (
            <div className="mx-4 my-8 rounded-lg border border-destructive/30 bg-destructive/5 py-10 text-center">
              <p className="mb-1 font-semibold">Xatolik</p>
              <p className="mb-4 text-sm text-muted-foreground">
                {error.message || "Xarid buyurtmalarini yuklab bo'lmadi"}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                aria-label="Qayta urinish"
                onClick={() => loadData()}
              >
                Qayta urinish
              </Button>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="mx-4 my-8 rounded-lg border bg-muted/20 py-10 text-center">
              <p className="text-sm text-muted-foreground">Hozircha xarid buyurtmalari yo‘q</p>
              <Button
                size="sm"
                className="mt-4 h-8 text-xs"
                aria-label="Yangi xarid buyurtmasi yaratish"
                onClick={() => navigateWithReturnTo('/purchase-orders/new')}
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Yangi xarid buyurtmasi
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="whitespace-nowrap text-xs font-semibold sm:text-sm">Buyurtma raqami</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Yetkazib beruvchi</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Sana va vaqt</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Kutilayotgan sana</TableHead>
                    <TableHead className="text-right text-xs font-semibold sm:text-sm">Jami summa</TableHead>
                    <TableHead className="text-right text-xs font-semibold sm:text-sm">To'langan</TableHead>
                    <TableHead className="text-right text-xs font-semibold sm:text-sm">Qoldiq</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">To'lov holati</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Holati</TableHead>
                    <TableHead className="w-[1%] text-right text-xs font-semibold sm:text-sm">Amallar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((po) => {
                  const currency = String((po as any).currency || 'UZS').toUpperCase();
                  const totalAmount =
                    currency === 'USD'
                      ? Number((po as any).total_usd ?? (po as any).total_amount ?? 0)
                      : Number((po as any).total_amount ?? 0);
                  const paidAmount =
                    currency === 'USD'
                      ? Number((po as any).paid_amount_usd ?? (po as any).paid_amount ?? 0)
                      : Number((po as any).paid_amount_uzs ?? (po as any).paid_amount ?? 0);
                  const rem = computePurchaseRemainder(paidAmount, totalAmount);
                  // Never show negative debt; excess is supplier advance
                  const remainingAmount = rem.debt;
                  const hasAdvance =
                    rem.excess > 0.009 ||
                    !!(po as any).has_supplier_advance ||
                    String(po.payment_status || '').toUpperCase() === 'OVERPAID';
                  const canPay = po.status === 'received' || po.status === 'partially_received';
                  
                  return (
                    <TableRow key={po.id} className="text-sm">
                      <TableCell className="max-w-[10rem] truncate py-2 font-medium font-mono text-xs">{po.po_number}</TableCell>
                      <TableCell className="max-w-[12rem] truncate py-2 text-xs">
                        {po.supplier?.name || po.supplier_name || '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-xs">{formatDate(po.order_date)}</TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-xs">
                        {po.expected_date ? formatDate(po.expected_date) : '-'}
                      </TableCell>
                      <TableCell className="py-2 text-right text-xs font-medium">
                        {currency === 'USD' ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="font-medium">{formatMoney((po as any).total_usd ?? 0, 'USD')}</span>
                            <span className="text-xs text-muted-foreground">{formatMoneyUZS((po as any).total_amount ?? 0)}</span>
                          </div>
                        ) : (
                          formatMoneyUZS((po as any).total_amount ?? 0)
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-right text-xs">
                        {currency === 'USD' ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span>{formatMoney(paidAmount, 'USD')}</span>
                            <span className="text-xs text-muted-foreground">{formatMoneyUZS((po as any).paid_amount_uzs ?? 0)}</span>
                          </div>
                        ) : (
                          formatMoneyUZS(paidAmount)
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-right text-xs">
                        <span className={remainingAmount > 0 ? 'font-medium' : ''}>
                          {currency === 'USD' ? formatMoney(remainingAmount, 'USD') : formatMoneyUZS(remainingAmount)}
                        </span>
                        {hasAdvance && rem.excess > 0.009 && (
                          <div className="text-[10px] text-blue-600 dark:text-blue-400">
                            Avans: {currency === 'USD' ? formatMoney(rem.excess, 'USD') : formatMoneyUZS(rem.excess)}
                          </div>
                        )}
                        {currency === 'USD' && remainingAmount > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {formatMoneyUZS(Math.max(0, Number((po as any).remaining_amount_uzs ?? 0)))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        {getPaymentStatusBadge(po.payment_status, hasAdvance)}
                      </TableCell>
                      <TableCell className="py-2">{getStatusBadge(po.status)}</TableCell>
                      <TableCell className="py-2 text-right">
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => navigateWithReturnTo(`/purchase-orders/${po.id}`)}
                            title="Tafsilotlarni ko'rish"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {canPay && remainingAmount > 0 && po.supplier && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-primary hover:text-primary"
                              onClick={() => handlePayClick(po)}
                              title="To'lov qilish"
                            >
                              <DollarSign className="h-4 w-4" />
                            </Button>
                          )}
                          {po.status === 'draft' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-primary hover:text-primary"
                              onClick={() => handleApprove(po.id)}
                              title="Tasdiqlash"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          )}
                          {(po.status === 'draft' ||
                            po.status === 'approved' ||
                            po.status === 'partially_received' ||
                            po.status === 'received') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => navigateWithReturnTo(`/purchase-orders/${po.id}/edit`)}
                              title="Tahrirlash"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          )}
                          {(po.status === 'draft' || po.status === 'cancelled') && isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteClick(po)}
                              title="Qoralamani o‘chirish"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                          {(po.status === 'approved' || po.status === 'partially_received') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => navigateWithReturnTo(`/purchase-orders/${po.id}/receive`)}
                              title="Tovar qabul qilish"
                            >
                              <Package className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
          {!loading && !error && totalCount > 0 ? (
            <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {t('purchase_orders.page_of', 'Page {{page}} / {{pages}} · {{total}} orders', {
                  page,
                  pages: totalPages,
                  total: totalCount,
                })}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2"
                  disabled={page <= 1}
                  onClick={() => updateParams({ page: String(page - 1) })}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2"
                  disabled={page >= totalPages}
                  onClick={() => updateParams({ page: String(page + 1) })}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Pay Supplier Dialog */}
      {selectedPO && selectedPO.supplier && (
        <PaySupplierDialog
          supplier={{ ...selectedPO.supplier, balance: (selectedPO as any).supplier?.balance ?? 0 }}
          purchaseOrder={selectedPO}
          open={payDialogOpen}
          onOpenChange={setPayDialogOpen}
          onSuccess={handlePaymentSuccess}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Qoralama buyurtmani o‘chirish</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `“${deleteTarget.po_number}” qoralama buyurtmasi butunlay o‘chiriladi. Davom etasizmi?`
                : 'Qoralama buyurtmasi butunlay o‘chiriladi. Davom etasizmi?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Bekor qilish</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? 'O‘chirilmoqda...' : 'O‘chirish'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

