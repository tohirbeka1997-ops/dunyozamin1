import { useState, useEffect } from 'react';
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
  getPurchaseOrderById,
  getPurchaseOrders,
  getSuppliers,
  productUpdateEmitter,
  receiveGoods,
} from '@/db/api';
import type { PurchaseOrderWithDetails, SupplierWithBalance } from '@/types/database';
import { Plus, Search, FileDown, Eye, Edit, Package, X, DollarSign, CheckCircle, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import PaySupplierDialog from '@/components/suppliers/PaySupplierDialog';
import { useAuth } from '@/contexts/AuthContext';
import { formatDate } from '@/lib/datetime';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import { createBackNavigationState } from '@/lib/pageState';

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { profile, role } = useAuth();
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: 'purchase-orders.filters.query',
    trackedKeys: ['search', 'status', 'supplier', 'dateFrom', 'dateTo', 'sortBy'],
  });
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderWithDetails[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const searchTerm = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status') || 'all';
  const supplierFilter = searchParams.get('supplier') || 'all';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const sortBy = searchParams.get('sortBy') || 'order_date-desc';
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrderWithDetails | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseOrderWithDetails | null>(null);
  const [deleting, setDeleting] = useState(false);
  const isAdmin = role === 'admin' || profile?.role === 'admin';

  useEffect(() => {
    loadData();
  }, [statusFilter, supplierFilter, dateFrom, dateTo, searchTerm, sortBy]);

  useEffect(() => {
    const unsubscribe = productUpdateEmitter.subscribe(() => {
      loadData();
    });
    return unsubscribe;
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const filters: any = {};
      
      if (statusFilter !== 'all') {
        filters.status = statusFilter;
      }
      
      if (supplierFilter !== 'all') {
        filters.supplier_id = supplierFilter;
      }
      
      if (dateFrom) {
        filters.date_from = dateFrom;
      }
      
      if (dateTo) {
        filters.date_to = dateTo;
      }
      
      if (searchTerm) {
        filters.search = searchTerm;
      }
      
      const [ordersData, suppliersData] = await Promise.all([
        getPurchaseOrders(filters),
        getSuppliers(),
      ]);
      
      setPurchaseOrders(ordersData);
      setSuppliers(suppliersData);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Xarid buyurtmalarini yuklab bo\'lmadi',
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

  const getPaymentStatusBadge = (status?: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      UNPAID: { label: 'To\'lanmagan', className: 'bg-destructive text-white' },
      PARTIALLY_PAID: { label: 'Qisman to\'langan', className: 'bg-warning text-white' },
      PAID: { label: 'To\'langan', className: 'bg-success text-white' },
    };
    
    const config = statusConfig[status || 'UNPAID'] || statusConfig.UNPAID;
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

  const filteredOrders = (() => {
    const list = Array.isArray(purchaseOrders) ? purchaseOrders : [];
    const [field, dir] = String(sortBy || 'order_date-desc').split('-');
    const direction = dir === 'asc' ? 1 : -1;

    const getCurrency = (po: any) => String(po?.currency || 'UZS').toUpperCase();
    const getTotal = (po: any) => {
      const currency = getCurrency(po);
      return currency === 'USD'
        ? Number(po?.total_usd ?? 0)
        : Number(po?.total_amount ?? 0);
    };
    const getPaid = (po: any) => {
      const currency = getCurrency(po);
      if (currency === 'USD') return Number(po?.paid_amount_usd ?? po?.paid_amount ?? 0);
      return Number(po?.paid_amount_uzs ?? po?.paid_amount ?? 0);
    };
    const getRemaining = (po: any) => {
      const currency = getCurrency(po);
      if (currency === 'USD') {
        const paid = getPaid(po);
        return Number(po?.remaining_amount_usd ?? po?.remaining_amount ?? (Number(po?.total_usd ?? 0) - paid));
      }
      const paid = getPaid(po);
      return Number(po?.remaining_amount_uzs ?? po?.remaining_amount ?? (Number(po?.total_amount ?? 0) - paid));
    };

    return [...list].sort((a: any, b: any) => {
      if (field === 'order_date') {
        return (new Date(a.order_date).getTime() - new Date(b.order_date).getTime()) * direction;
      }
      if (field === 'total') {
        return (getTotal(a) - getTotal(b)) * direction;
      }
      if (field === 'remaining') {
        return (getRemaining(a) - getRemaining(b)) * direction;
      }
      if (field === 'paid') {
        return (getPaid(a) - getPaid(b)) * direction;
      }
      if (field === 'po_number') {
        return String(a.po_number || '').localeCompare(String(b.po_number || ''), undefined, { numeric: true }) * direction;
      }
      return 0;
    });
  })();

  const formatUsd = (value: any) => {
    const n = Number(value ?? 0) || 0;
    return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} USD`;
  };

  if (loading) {
    return (
      <div className="flex min-h-[220px] items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">Xarid buyurtmalari</h1>
          <p className="page-heading-sub">Xarid buyurtmalarini boshqarish va tovar qabul qilish</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => navigate('/purchase-receipts/new', { state: createBackNavigationState(location) })}
          >
            <Package className="mr-2 h-3.5 w-3.5" />
            Qabul qilish
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => navigate('/purchase-orders/new', { state: createBackNavigationState(location) })}
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            Yangi xarid buyurtmasi
          </Button>
        </div>
      </div>

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
                      onChange={(e) => updateParams({ search: e.target.value })}
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
                    <Select value={statusFilter} onValueChange={(value) => updateParams({ status: value })}>
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
                    <Select value={supplierFilter} onValueChange={(value) => updateParams({ supplier: value })}>
                      <SelectTrigger className="h-8 w-full bg-background text-xs [&_span]:truncate">
                        <SelectValue placeholder="Yetkazib beruvchi" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Barcha yetkazib beruvchilar</SelectItem>
                        {suppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-[10rem] flex-1 sm:max-w-[14rem]">
                    <Select value={sortBy} onValueChange={(value) => updateParams({ sortBy: value })}>
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
                    onClick={() =>
                      toast({ title: 'Eksport qilish', description: "Eksport funksiyasi tez orada qo'shiladi" })
                    }
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    Eksport
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
                    onChange={(e) => updateParams({ dateFrom: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="min-w-[10rem] flex-1 space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tugash</label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => updateParams({ dateTo: e.target.value })}
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
          {filteredOrders.length === 0 ? (
            <div className="mx-4 my-8 rounded-lg border bg-muted/20 py-10 text-center">
              <p className="text-sm text-muted-foreground">Xarid buyurtmalari topilmadi</p>
              <Button
                size="sm"
                className="mt-4 h-8 text-xs"
                onClick={() => navigate('/purchase-orders/new', { state: createBackNavigationState(location) })}
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Birinchi xarid buyurtmasini yaratish
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
                  const paidAmount =
                    currency === 'USD'
                      ? Number((po as any).paid_amount_usd ?? (po as any).paid_amount ?? 0)
                      : Number((po as any).paid_amount_uzs ?? (po as any).paid_amount ?? 0);
                  const remainingAmount =
                    currency === 'USD'
                      ? Number(
                          (po as any).remaining_amount_usd ??
                            (po as any).remaining_amount ??
                            (Number((po as any).total_usd ?? 0) - paidAmount)
                        )
                      : Number(
                          (po as any).remaining_amount_uzs ??
                            (po as any).remaining_amount ??
                            (Number((po as any).total_amount ?? 0) - paidAmount)
                        );
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
                            <span className="font-medium">{formatUsd((po as any).total_usd ?? 0)}</span>
                            <span className="text-xs text-muted-foreground">{formatMoneyUZS((po as any).total_amount ?? 0)}</span>
                          </div>
                        ) : (
                          formatMoneyUZS((po as any).total_amount ?? 0)
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-right text-xs">
                        {currency === 'USD' ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span>{formatUsd(paidAmount)}</span>
                            <span className="text-xs text-muted-foreground">{formatMoneyUZS((po as any).paid_amount_uzs ?? 0)}</span>
                          </div>
                        ) : (
                          formatMoneyUZS(paidAmount)
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-right text-xs">
                        <span className={remainingAmount > 0 ? 'font-medium' : ''}>
                          {currency === 'USD' ? formatUsd(remainingAmount) : formatMoneyUZS(remainingAmount)}
                        </span>
                        {currency === 'USD' && (
                          <div className="text-xs text-muted-foreground">
                            {formatMoneyUZS((po as any).remaining_amount_uzs ?? 0)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="py-2">{getPaymentStatusBadge(po.payment_status)}</TableCell>
                      <TableCell className="py-2">{getStatusBadge(po.status)}</TableCell>
                      <TableCell className="py-2 text-right">
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() =>
                              navigate(`/purchase-orders/${po.id}`, {
                                state: createBackNavigationState(location),
                              })
                            }
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
                              onClick={() =>
                                navigate(`/purchase-orders/${po.id}/edit`, {
                                  state: createBackNavigationState(location),
                                })
                              }
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
                              onClick={() =>
                                navigate(`/purchase-orders/${po.id}/receive`, {
                                  state: createBackNavigationState(location),
                                })
                              }
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

