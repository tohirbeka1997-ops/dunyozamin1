import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  addPurchaseOrderExpense,
  deletePurchaseOrderExpense,
  getPurchaseOrderById,
  updatePurchaseOrder,
  approvePurchaseOrder,
  getSupplierPayments,
  deleteSupplierPayment,
  productUpdateEmitter,
} from '@/db/api';
import type { PurchaseOrderWithDetails } from '@/types/database';
import { ArrowLeft, Edit, Package, X, DollarSign, CheckCircle, Trash2, Plus } from 'lucide-react';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate, formatDateTime } from '@/lib/datetime';
import PaySupplierDialog from '@/components/suppliers/PaySupplierDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import MoneyInput from '@/components/common/MoneyInput';
import { createBackNavigationState, navigateBackTo, resolveBackTarget } from '@/lib/pageState';

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { profile, role } = useAuth();
  const confirmDialog = useConfirmDialog();

  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrderWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState<number | null>(null);
  const [expenseMethod, setExpenseMethod] = useState<'by_value' | 'by_qty'>('by_value');
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [deletingPayment, setDeletingPayment] = useState(false);
  const isAdmin = role === 'admin' || profile?.role === 'admin';
  const backTo = resolveBackTarget(location, '/purchase-orders');

  useEffect(() => {
    if (id) {
      loadPurchaseOrder();
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const unsubscribe = productUpdateEmitter.subscribe(() => {
      loadPurchaseOrder();
    });
    return unsubscribe;
  }, [id]);

  const loadPurchaseOrder = async () => {
    try {
      setLoading(true);
      const data = await getPurchaseOrderById(id!);
      setPurchaseOrder(data);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Xarid buyurtmasini yuklab bo‘lmadi',
        variant: 'destructive',
      });
      navigate(backTo);
    } finally {
      setLoading(false);
    }
  };

  const handleReceiveGoods = async () => {
    if (!purchaseOrder || !id) return;
    navigate(`/purchase-orders/${id}/receive`, {
      state: createBackNavigationState(location),
    });
  };

  const handleApprove = async () => {
    if (!purchaseOrder || !id) return;

    try {
      setProcessing(true);
      await approvePurchaseOrder(id, profile?.id || 'default-admin-001');

      toast({
        title: 'Muvaffaqiyatli',
        description: 'Xarid buyurtmasi tasdiqlandi',
      });

      await loadPurchaseOrder(); // Refresh to show updated status
      const goReceive = await confirmDialog({
        title: 'Qabul qilish',
        description: 'Tovarlarni omborga kiritish uchun receipt yaratishni xohlaysizmi?',
        confirmText: 'Ha, qabul qilish',
        cancelText: 'Hozir emas',
        variant: 'default',
      });
      if (goReceive) {
        navigate(`/purchase-orders/${id}/receive`, {
          state: createBackNavigationState(location),
        });
      }
    } catch (error: any) {
      toast({
        title: 'Xatolik',
        description: error.message || 'Xarid buyurtmasini tasdiqlab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!id) return;

    try {
      setProcessing(true);

      await updatePurchaseOrder(id, { status: 'cancelled' });

      toast({
        title: 'Muvaffaqiyatli',
        description: 'Xarid buyurtmasi bekor qilindi',
      });

      setShowCancelDialog(false);
      loadPurchaseOrder();
    } catch (error: any) {
      toast({
        title: 'Xatolik',
        description: error.message || 'Xarid buyurtmasini bekor qilib bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteLatestPayment = async () => {
    if (!purchaseOrder?.supplier_id || !purchaseOrder?.id) return;
    if (!isAdmin) {
      toast({
        title: 'Xatolik',
        description: 'Faqat administrator to‘lovni o‘chirishi mumkin',
        variant: 'destructive',
      });
      return;
    }
    const ok = await confirmDialog({
      title: 'Ogohlantirish',
      description: 'Oxirgi to‘lovni bekor qilmoqchimisiz? Bu amalni ortga qaytarib bo‘lmaydi.',
      confirmText: 'Bekor qilish',
      cancelText: 'Yo‘q',
      variant: 'destructive',
    });
    if (!ok) return;

    try {
      setDeletingPayment(true);
      const payments = await getSupplierPayments(purchaseOrder.supplier_id);
      const related = payments.filter((p) => p.purchase_order_id === purchaseOrder.id);
      if (related.length === 0) {
        toast({
          title: 'Xatolik',
          description: 'Ushbu buyurtma uchun to‘lov topilmadi',
          variant: 'destructive',
        });
        return;
      }
      const latest = [...related].sort((a, b) => {
        const aTime = new Date(a.paid_at || a.created_at || 0).getTime();
        const bTime = new Date(b.paid_at || b.created_at || 0).getTime();
        return bTime - aTime;
      })[0];
      await deleteSupplierPayment(latest.id);
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Oxirgi to‘lov bekor qilindi',
      });
      loadPurchaseOrder();
    } catch (error: any) {
      toast({
        title: 'Xatolik',
        description: error.message || 'To‘lovni bekor qilib bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setDeletingPayment(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      draft: { label: 'Qoralama', className: 'bg-muted text-muted-foreground' },
      approved: { label: 'Tasdiqlangan', className: 'bg-primary text-primary-foreground' },
      partially_received: {
        label: 'Qisman qabul qilingan',
        className: 'bg-warning text-warning-foreground',
      },
      received: { label: 'Qabul qilingan', className: 'bg-success text-white' },
      cancelled: { label: 'Bekor qilingan', className: 'bg-destructive text-destructive-foreground' },
    };

    const config = statusConfig[status] || { label: status, className: '' };
    return <Badge className={config.className}>{config.label}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!purchaseOrder) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Xarid buyurtmasi topilmadi</p>
        <Button onClick={() => navigate(backTo)} className="mt-4">
          Xarid buyurtmalariga qaytish
        </Button>
      </div>
    );
  }

  const canApprove = purchaseOrder.status === 'draft';
  const canEdit =
    purchaseOrder.status === 'draft' ||
    purchaseOrder.status === 'approved' ||
    purchaseOrder.status === 'partially_received' ||
    purchaseOrder.status === 'received';
  const canReceive =
    purchaseOrder.status === 'approved' || purchaseOrder.status === 'partially_received';
  const canCancel = purchaseOrder.status === 'draft' || purchaseOrder.status === 'approved';
  const totalReceivedQty = (purchaseOrder.items || []).reduce((sum, it) => sum + Number(it.received_qty || 0), 0);
  const canEditExpenses = purchaseOrder.status !== 'cancelled';

  const handleAddExpense = async () => {
    if (!id) return;
    if (!expenseTitle.trim()) {
      toast({ title: 'Xatolik', description: 'Xarajat nomini kiriting', variant: 'destructive' });
      return;
    }
    const amt = Number(expenseAmount || 0);
    if (!amt || amt <= 0) {
      toast({ title: 'Xatolik', description: 'Xarajat summasi 0 dan katta bo‘lishi kerak', variant: 'destructive' });
      return;
    }
    try {
      setExpenseSaving(true);
      await addPurchaseOrderExpense(id, {
        title: expenseTitle.trim(),
        amount: amt,
        allocation_method: expenseMethod,
        created_by: profile?.id || 'default-admin-001',
      });
      setExpenseTitle('');
      setExpenseAmount(null);
      setExpenseMethod('by_value');
      toast({ title: 'Muvaffaqiyatli', description: 'Xarajat qo‘shildi' });
      loadPurchaseOrder();
    } catch (e: any) {
      toast({ title: 'Xatolik', description: e?.message || 'Xarajatni qo‘shib bo‘lmadi', variant: 'destructive' });
    } finally {
      setExpenseSaving(false);
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!id) return;
    try {
      setExpenseSaving(true);
      await deletePurchaseOrderExpense(id, expenseId);
      toast({ title: 'Muvaffaqiyatli', description: 'Xarajat o‘chirildi' });
      loadPurchaseOrder();
    } catch (e: any) {
      toast({ title: 'Xatolik', description: e?.message || 'Xarajatni o‘chirib bo‘lmadi', variant: 'destructive' });
    } finally {
      setExpenseSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigateBackTo(navigate, location, '/purchase-orders')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Xarid buyurtmasi tafsilotlari</h1>
            <p className="text-muted-foreground">{purchaseOrder.po_number}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap justify-end gap-2">
            {canApprove && (
              <Button onClick={handleApprove} disabled={processing}>
                <CheckCircle className="h-4 w-4 mr-2" />
                Tasdiqlash
              </Button>
            )}
            {canEdit && (
              <Button
                variant="outline"
                onClick={() =>
                  navigate(`/purchase-orders/${id}/edit`, {
                    state: createBackNavigationState(location),
                  })
                }
              >
                <Edit className="h-4 w-4 mr-2" />
                Tahrirlash
              </Button>
            )}
            {canReceive && (
              <Button onClick={handleReceiveGoods}>
                <Package className="h-4 w-4 mr-2" />
                Tovar qabul qilish
              </Button>
            )}
            {canCancel && (
              <Button variant="destructive" onClick={() => setShowCancelDialog(true)}>
                <X className="h-4 w-4 mr-2" />
                Bekor qilish
              </Button>
            )}
          </div>
          {canEdit && purchaseOrder.status === 'approved' && (
            <p className="text-xs text-muted-foreground max-w-sm text-right">
              Omborga qabul qilinmaguncha buyurtmani tahrirlashingiz mumkin.
            </p>
          )}
          {canEdit && purchaseOrder.status === 'received' && (
            <p className="text-xs text-muted-foreground max-w-sm text-right">
              Qabul qilingan buyurtmani hujjat bo‘yicha tahrirlash mumkin (narx, izoh, xarajat).
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Buyurtma ma’lumotlari</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">PO raqami</p>
                  <p className="font-medium">{purchaseOrder.po_number}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Holati</p>
                  <div className="mt-1">{getStatusBadge(purchaseOrder.status)}</div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Yetkazib beruvchi</p>
                  {purchaseOrder.supplier_id ? (
                    <Button
                      variant="link"
                      className="h-auto p-0 font-medium text-primary"
                      onClick={() => navigate(`/suppliers/${purchaseOrder.supplier_id}`)}
                    >
                      {purchaseOrder.supplier?.name || purchaseOrder.supplier_name || '-'}
                    </Button>
                  ) : (
                    <p className="font-medium">
                      {purchaseOrder.supplier_name || '-'}
                    </p>
                  )}
                  {purchaseOrder.supplier?.phone && (
                    <p className="text-sm text-muted-foreground">{purchaseOrder.supplier.phone}</p>
                  )}
                  {purchaseOrder.supplier?.email && (
                    <p className="text-sm text-muted-foreground">{purchaseOrder.supplier.email}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Buyurtma sanasi</p>
                  <p className="font-medium">
                    {formatDate(purchaseOrder.order_date)}
                  </p>
                </div>
                {purchaseOrder.expected_date && (
                  <div>
                    <p className="text-sm text-muted-foreground">Kutilayotgan sana</p>
                    <p className="font-medium">
                      {formatDate(purchaseOrder.expected_date)}
                    </p>
                  </div>
                )}
                {purchaseOrder.reference && (
                  <div>
                    <p className="text-sm text-muted-foreground">Ma’lumot</p>
                    <p className="font-medium">{purchaseOrder.reference}</p>
                  </div>
                )}
                {purchaseOrder.created_by_profile && (
                  <div>
                    <p className="text-sm text-muted-foreground">Yaratgan</p>
                    <p className="font-medium">
                      {purchaseOrder.created_by_profile.full_name ||
                        purchaseOrder.created_by_profile.username}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Yaratilgan vaqt</p>
                  <p className="font-medium">
                    {formatDateTime(purchaseOrder.created_at)}
                  </p>
                </div>
              </div>
              {purchaseOrder.notes && (
                <div className="mt-4">
                  <p className="text-sm text-muted-foreground">Izoh</p>
                  <p className="mt-1">{purchaseOrder.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle>Buyurtma mahsulotlari</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mahsulot</TableHead>
                    <TableHead className="text-right">Buyurtma miqdori</TableHead>
                    <TableHead className="text-right">Qabul qilingan</TableHead>
                    <TableHead className="text-right">Tannarx</TableHead>
                    <TableHead className="text-right">Xarajat</TableHead>
                    <TableHead className="text-right">Landed tannarx</TableHead>
                    <TableHead className="text-right">Jami</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(purchaseOrder.items || []).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.product_name}</TableCell>
                      <TableCell className="text-right">{item.ordered_qty}</TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            item.received_qty >= item.ordered_qty
                              ? 'text-success'
                              : item.received_qty > 0
                                ? 'text-warning'
                                : ''
                          }
                        >
                          {item.received_qty}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(item.unit_cost)}</TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(Number((item as any).allocated_expenses || 0) || 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(Number((item as any).landed_unit_cost ?? item.unit_cost) || 0)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoneyUZS(item.line_total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Expenses */}
          <Card>
            <CardHeader>
              <CardTitle>Xarajatlar (tannarxga uriladi)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {totalReceivedQty > 0 && canEditExpenses && (
                <p className="text-sm text-muted-foreground">
                  Qabul qilingan buyurtmada ham xarajat va tannarx ma’lumotlarini tuzatishingiz mumkin.
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <Label>Xarajat nomi</Label>
                  <Input
                    value={expenseTitle}
                    onChange={(e) => setExpenseTitle(e.target.value)}
                    placeholder="Transport / Yuk tushirish / Bojxona..."
                    disabled={!canEditExpenses || expenseSaving}
                  />
                </div>
                <div>
                  <Label>Summasi</Label>
                  <MoneyInput
                    value={expenseAmount}
                    onValueChange={(v) => setExpenseAmount(v)}
                    placeholder="0"
                    min={0}
                    allowZero={false}
                    disabled={!canEditExpenses || expenseSaving}
                    className="h-10"
                  />
                </div>
                <div>
                  <Label>Taqsimlash</Label>
                  <Select value={expenseMethod} onValueChange={(v) => setExpenseMethod(v as any)} disabled={!canEditExpenses || expenseSaving}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="by_value">Qiymat bo‘yicha</SelectItem>
                      <SelectItem value="by_qty">Miqdor bo‘yicha</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleAddExpense} disabled={!canEditExpenses || expenseSaving}>
                  <Plus className="h-4 w-4 mr-2" />
                  Qo‘shish
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nomi</TableHead>
                    <TableHead>Taqsimlash</TableHead>
                    <TableHead className="text-right">Summasi</TableHead>
                    <TableHead className="text-right">Amal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {((purchaseOrder as any).expenses || []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        Xarajat yo‘q
                      </TableCell>
                    </TableRow>
                  ) : (
                    ((purchaseOrder as any).expenses || []).map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell>{e.title}</TableCell>
                        <TableCell>{e.allocation_method === 'by_qty' ? 'Miqdor bo‘yicha' : 'Qiymat bo‘yicha'}</TableCell>
                        <TableCell className="text-right">{formatMoneyUZS(Number(e.amount || 0) || 0)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={!canEditExpenses || expenseSaving}
                            onClick={() => handleDeleteExpense(e.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Summary */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatMoneyUZS(purchaseOrder.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Xarajatlar</span>
                  <span className="font-medium">{formatMoneyUZS(Number((purchaseOrder as any).total_expenses || 0) || 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="font-medium">{formatMoneyUZS(purchaseOrder.discount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="font-medium">{formatMoneyUZS(purchaseOrder.tax)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between">
                  <span className="font-semibold">Total</span>
                  <span className="font-bold text-lg">
                    {formatMoneyUZS(purchaseOrder.total_amount)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total + xarajat</span>
                  <span className="font-semibold">
                    {formatMoneyUZS(Number(purchaseOrder.total_amount || 0) + (Number((purchaseOrder as any).total_expenses || 0) || 0))}
                  </span>
                </div>
                {(purchaseOrder.status === 'received' || purchaseOrder.status === 'partially_received') && (
                  <>
                    <div className="border-t pt-2 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">To'langan:</span>
                        <span className="font-medium">{formatMoneyUZS(purchaseOrder.paid_amount ?? 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Qoldiq:</span>
                        <span className={`font-medium ${(purchaseOrder.remaining_amount ?? purchaseOrder.total_amount) > 0 ? 'text-destructive' : 'text-success'}`}>
                          {formatMoneyUZS(purchaseOrder.remaining_amount ?? purchaseOrder.total_amount)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">To'lov holati:</span>
                        <Badge className={
                          purchaseOrder.payment_status === 'PAID' 
                            ? 'bg-success text-white'
                            : purchaseOrder.payment_status === 'PARTIALLY_PAID'
                            ? 'bg-warning text-warning-foreground'
                            : 'bg-destructive text-destructive-foreground'
                        }>
                          {purchaseOrder.payment_status === 'PAID' ? 'To\'langan' :
                           purchaseOrder.payment_status === 'PARTIALLY_PAID' ? 'Qisman to\'langan' :
                           'To\'lanmagan'}
                        </Badge>
                      </div>
                      {(purchaseOrder.remaining_amount ?? purchaseOrder.total_amount) > 0 && purchaseOrder.supplier && (
                        <div className="pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => setPayDialogOpen(true)}
                          >
                            <DollarSign className="h-4 w-4 mr-2" />
                            To'lov qilish
                          </Button>
                        </div>
                      )}
                      {isAdmin &&
                        (Number(purchaseOrder.paid_amount ?? 0) > 0 ||
                          Number((purchaseOrder as any).paid_amount_usd ?? 0) > 0) && (
                        <div className="pt-2">
                          <Button
                            variant="destructive"
                            size="sm"
                            className="w-full"
                            onClick={handleDeleteLatestPayment}
                            disabled={deletingPayment}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {deletingPayment ? 'Bekor qilinmoqda...' : 'Oxirgi to‘lovni bekor qilish'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="pt-4 border-t space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Items</span>
                  <span className="font-medium">{purchaseOrder.items?.length || 0}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Ordered Qty</span>
                  <span className="font-medium">
                    {(purchaseOrder.items || []).reduce(
                      (sum, item) => sum + item.ordered_qty,
                      0
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Received Qty</span>
                  <span className="font-medium">
                    {(purchaseOrder.items || []).reduce(
                      (sum, item) => sum + item.received_qty,
                      0
                    )}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Cancel Order Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xarid buyurtmasini bekor qilish</DialogTitle>
            <DialogDescription>
              Ushbu xarid buyurtmasini bekor qilmoqchimisiz? Bu amalni ortga qaytarib bo‘lmaydi.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelDialog(false)}>
              Yo‘q, qoldiraman
            </Button>
            <Button variant="destructive" onClick={handleCancelOrder} disabled={processing}>
              {processing ? 'Bekor qilinmoqda...' : 'Ha, bekor qilish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay Supplier Dialog */}
      {purchaseOrder && purchaseOrder.supplier && (
        <PaySupplierDialog
          supplier={{ ...purchaseOrder.supplier, balance: 0 }}
          purchaseOrder={purchaseOrder}
          open={payDialogOpen}
          onOpenChange={setPayDialogOpen}
          onSuccess={() => {
            loadPurchaseOrder(); // Reload to refresh payment info
          }}
        />
      )}
    </div>
  );
}
