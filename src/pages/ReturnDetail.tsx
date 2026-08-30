import { useEffect, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { getSalesReturnById, deleteSalesReturn, cancelSalesReturn, completeSalesReturn, approveSalesReturn, rejectSalesReturn, getSalesReturnAuditTrail, getSettingsByCategory } from '@/db/api';
import type { CompanySettings, SalesReturnWithDetails } from '@/types/database';
import { ArrowLeft, Printer, Package, Edit, Trash2, Ban, Check, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { formatReturnMoney } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/datetime';
import { createBackNavigationState, navigateBackTo, resolveBackTarget } from '@/lib/pageState';
import { printReturnReceipt } from '@/lib/receipts/printReturnReceipt';
import { useReceiptSettings } from '@/hooks/useReceiptSettings';
import { useAuth } from '@/contexts/AuthContext';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from 'react-i18next';
import QRCodeDataUrl from '@/components/ui/qrcodedataurl';
import { getProductImageDisplayUrl } from '@/lib/productImageUrl';

export default function ReturnDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { profile, role } = useAuth();
  const isManagerOrAdmin = role === 'admin' || role === 'manager';
  const canApproveReject =
    role === 'admin' || role === 'manager' || role === 'senior_cashier';
  const [returnData, setReturnData] = useState<SalesReturnWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [approvalReason, setApprovalReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [auditTrail, setAuditTrail] = useState<any[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const receiptSettings = useReceiptSettings();
  const backTo = resolveBackTarget(location, '/returns');

  const fmtReturn = (amount?: number | null) =>
    formatReturnMoney(
      { total_amount: amount ?? 0 },
      returnData?.order ?? {
        currency: (returnData as any)?.order_currency,
      }
    );

  useEffect(() => {
    if (id) {
      loadReturnData();
    }
  }, [id]);

  useEffect(() => {
    void getSettingsByCategory('company')
      .then((raw) => setCompanySettings(raw as unknown as CompanySettings))
      .catch(() => setCompanySettings(null));
  }, []);

  const loadReturnData = async () => {
    if (!id) return;
    
    try {
      setLoading(true);
      const data = await getSalesReturnById(id);
      setReturnData(data);
      try {
        const logs = await getSalesReturnAuditTrail(id);
        setAuditTrail(Array.isArray(logs) ? logs : []);
      } catch {
        setAuditTrail([]);
      }
    } catch (error) {
      console.error('Error loading return:', error);
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Qaytarish tafsilotlarini yuklab bo‘lmadi',
        variant: 'destructive',
      });
      navigate(backTo);
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    if (!id) return;
    
    try {
      setActionLoading(true);
      await completeSalesReturn(id, {
        user_id: profile?.id,
        cashier_id: profile?.id,
        approval_reason: approvalReason.trim() || undefined,
      });
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Qaytarish yakunlandi',
      });
      loadReturnData();
    } catch (error) {
      console.error('Error completing return:', error);
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Qaytarishni yakunlab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!id || !approvalReason.trim()) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.detail.approval_reason_required'),
        variant: 'destructive',
      });
      return;
    }
    try {
      setActionLoading(true);
      await approveSalesReturn(id, {
        approval_reason: approvalReason.trim(),
        user_id: profile?.id,
        cashier_id: profile?.id,
      });
      toast({
        title: t('common.success', { defaultValue: 'OK' }),
        description: t('sales_returns.detail.approve_success'),
      });
      setApprovalReason('');
      await loadReturnData();
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('sales_returns.detail.approve_failed'),
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!id || !rejectReason.trim()) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.detail.reject_reason_required'),
        variant: 'destructive',
      });
      return;
    }
    try {
      setActionLoading(true);
      await rejectSalesReturn(id, {
        reject_reason: rejectReason.trim(),
        user_id: profile?.id,
        cashier_id: profile?.id,
      });
      toast({
        title: t('common.success', { defaultValue: 'OK' }),
        description: t('sales_returns.detail.reject_success'),
      });
      setRejectReason('');
      await loadReturnData();
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('sales_returns.detail.reject_failed'),
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    
    try {
      setActionLoading(true);
      await deleteSalesReturn(id);
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Qaytarish o‘chirildi. Ombordagi o‘zgarishlar bekor qilindi.',
      });
      navigate(backTo);
    } catch (error) {
      console.error('Error deleting return:', error);
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Qaytarishni o‘chirib bo‘lmadi',
        variant: 'destructive',
      });
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!id || !cancelReason.trim()) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.detail.cancel_reason_required'),
        variant: 'destructive',
      });
      return;
    }
    try {
      setActionLoading(true);
      await cancelSalesReturn(id, {
        cancel_reason: cancelReason.trim(),
        user_id: profile?.id,
        cashier_id: profile?.id,
      });
      toast({
        title: t('common.success', { defaultValue: 'OK' }),
        description: t('sales_returns.detail.cancel_success'),
      });
      setCancelReason('');
      await loadReturnData();
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('sales_returns.detail.cancel_failed'),
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePrint = async () => {
    if (!returnData) return;
    try {
      setPrinting(true);
      const transport = await printReturnReceipt(returnData, companySettings, receiptSettings);
      toast({
        title: 'Chek',
        description:
          transport === 'escpos'
            ? 'Qaytarish cheki printerga yuborildi'
            : 'Qaytarish cheki chop etish oynasi ochildi',
      });
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Chop etishda xatolik',
        variant: 'destructive',
      });
    } finally {
      setPrinting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (String(status || '').toLowerCase()) {
      case 'completed':
        return <Badge className="bg-success text-success-foreground">{t('sales_returns.status.completed')}</Badge>;
      case 'pending':
        return <Badge className="bg-primary text-primary-foreground">{t('sales_returns.status.pending')}</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">{t('sales_returns.status.cancelled')}</Badge>;
      case 'draft':
        return <Badge variant="secondary">{t('sales_returns.status.draft')}</Badge>;
      case 'approved':
        return <Badge className="bg-emerald-600 text-white">{t('sales_returns.status.approved')}</Badge>;
      case 'rejected':
        return <Badge variant="destructive">{t('sales_returns.status.rejected')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getReasonLabel = (reason: string) => {
    const reasons: Record<string, string> = {
      damaged: 'Shikastlangan mahsulot',
      incorrect: 'Noto‘g‘ri mahsulot',
      defective: 'Nuqsonli mahsulot',
      dissatisfaction: 'Mijoz rozi emas',
      expired: 'Muddati o‘tgan',
      other: 'Boshqa',
    };
    return reasons[reason] || reason;
  };

  const getRefundMethodLabel = (method: string) => {
    const methods: Record<string, string> = {
      cash: 'Naqd',
      card: 'Karta',
      credit: 'Mijoz hisobiga',
      customer_account: 'Mijoz hisobiga',
    };
    return methods[method] || method;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-64 bg-muted" />
          <Skeleton className="h-10 w-32 bg-muted" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64 bg-muted" />
          <Skeleton className="h-64 bg-muted" />
        </div>
        <Skeleton className="h-96 bg-muted" />
      </div>
    );
  }

  if (!returnData) {
    return (
      <div className="text-center py-12">
        <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Qaytarish topilmadi</p>
        <Button className="mt-4" onClick={() => navigate(backTo)}>
          Qaytarishlar ro‘yxatiga qaytish
        </Button>
      </div>
    );
  }

  const statusKey = String(returnData.status || '').toLowerCase();
  const canEdit = statusKey === 'draft' || statusKey === 'pending' || statusKey === 'approved';
  const canDelete =
    statusKey === 'draft' || statusKey === 'pending' || statusKey === 'approved' || statusKey === 'rejected';
  const canComplete =
    (statusKey === 'draft' || statusKey === 'pending' || statusKey === 'approved') &&
    (statusKey === 'draft' || canApproveReject);
  const canApprove = (statusKey === 'pending' || statusKey === 'draft') && canApproveReject;
  const canReject =
    (statusKey === 'pending' || statusKey === 'approved' || statusKey === 'draft') && canApproveReject;
  const canCancel = statusKey === 'completed' && isManagerOrAdmin;
  const returnDeepLink = `pos://returns/${returnData.id}`;
  const attachmentDisplayUrl = getProductImageDisplayUrl(
    (returnData as any).attachment_url || null,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigateBackTo(navigate, location, '/returns')}
            aria-label="Qaytarishlar ro'yxatiga qaytish"
            title="Orqaga"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">Qaytarish tafsilotlari</h1>
            <p className="text-sm text-muted-foreground">{returnData.return_number}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              variant="outline"
              onClick={() =>
                navigate(`/returns/${id}/edit`, {
                  state: createBackNavigationState(location),
                })
              }
            >
              <Edit className="h-4 w-4 mr-2" />
              Tahrirlash
            </Button>
          )}
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={actionLoading}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  O‘chirish
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Qaytarishni o‘chirasizmi?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Bu qaytarishni butunlay o‘chiradi va quyidagi rollback bajariladi:
                    <br />
                    • Omborda qaytarilgan <strong>{returnData.items?.length || 0}</strong> ta pozitsiya bekor qilinadi
                    <br />
                    • Jami qaytarilgan <strong>{fmtReturn(returnData.total_amount || 0)}</strong> summaga bog‘liq yozuvlar qaytariladi
                    <br />
                    Bu amalni ortga qaytarib bo‘lmaydi.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Bekor qilish</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                    O‘chirish
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canCancel && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={actionLoading}>
                  <Ban className="h-4 w-4 mr-2" />
                  {t('sales_returns.detail.cancel_return')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('sales_returns.detail.cancel_confirm_title')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('sales_returns.detail.cancel_confirm_body')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2 py-2">
                  <Label htmlFor="cancel_reason">{t('sales_returns.detail.cancel_reason')}</Label>
                  <Textarea
                    id="cancel_reason"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    rows={3}
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleCancel} disabled={!cancelReason.trim()}>
                    {t('sales_returns.detail.cancel_return')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canApprove && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="secondary" disabled={actionLoading}>
                  <Check className="h-4 w-4 mr-2" />
                  {t('sales_returns.detail.approve')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('sales_returns.detail.approve_confirm_title')}</AlertDialogTitle>
                </AlertDialogHeader>
                <div className="space-y-2 py-2">
                  <Label htmlFor="approval_reason">{t('sales_returns.detail.approval_reason')}</Label>
                  <Textarea
                    id="approval_reason"
                    value={approvalReason}
                    onChange={(e) => setApprovalReason(e.target.value)}
                    rows={3}
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleApprove} disabled={!approvalReason.trim()}>
                    {t('sales_returns.detail.approve')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canReject && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={actionLoading}>
                  <X className="h-4 w-4 mr-2" />
                  {t('sales_returns.detail.reject')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('sales_returns.detail.reject_confirm_title')}</AlertDialogTitle>
                </AlertDialogHeader>
                <div className="space-y-2 py-2">
                  <Label htmlFor="reject_reason">{t('sales_returns.detail.reject_reason')}</Label>
                  <Textarea
                    id="reject_reason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={3}
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleReject} disabled={!rejectReason.trim()}>
                    {t('sales_returns.detail.reject')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canComplete && (
            <Button onClick={handleComplete} disabled={actionLoading}>
              {t('sales_returns.detail.complete')}
            </Button>
          )}
          <Button variant="outline" onClick={handlePrint} disabled={printing}>
            <Printer className="h-4 w-4 mr-2" />
            {printing ? 'Chop etilmoqda...' : 'Chop etish'}
          </Button>
        </div>
      </div>

      {/* Return Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Qaytarish ma’lumotlari</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">{t('sales_returns.return_number')}</Label>
                <p className="font-medium font-mono">{returnData.return_number}</p>
                <p className="text-xs text-muted-foreground break-all mt-1">{returnDeepLink}</p>
                <div className="mt-2 inline-block rounded border bg-white p-1">
                  <QRCodeDataUrl text={returnDeepLink} width={120} />
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">Holati</Label>
                <div className="mt-1">{getStatusBadge(returnData.status)}</div>
              </div>
              <div>
                <Label className="text-muted-foreground">Manba</Label>
                <p className="font-medium">
                  {returnData.return_mode === 'manual' ? 'Ordersiz qaytarish' : 'Buyurtma bo‘yicha qaytarish'}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Buyurtma raqami</Label>
                <p className="font-medium">
                  {returnData.order_id ? (
                    <Button
                      variant="link"
                      className="p-0 h-auto font-medium"
                      onClick={() => navigate(`/orders/${returnData.order_id}`)}
                    >
                      {returnData.order?.order_number || returnData.order_id}
                    </Button>
                  ) : (
                    'Ordersiz'
                  )}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Jami summa</Label>
                <p className="font-medium text-lg">{fmtReturn(returnData.total_amount)}</p>
              </div>
              <div className="col-span-2">
                <Label className="text-muted-foreground">Mijoz</Label>
                <p className="font-medium">
                  {returnData.customer?.name || 'Yuruvchi mijoz'}
                </p>
                {returnData.customer?.phone && (
                  <p className="text-sm text-muted-foreground">{returnData.customer.phone}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Qaytarish tafsilotlari</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Qaytarish sababi</Label>
              <p className="font-medium">{getReasonLabel(returnData.reason)}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Pul qaytarish usuli</Label>
              <p className="font-medium">{getRefundMethodLabel(returnData.refund_method)}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Izoh</Label>
              <p className="text-sm">{returnData.notes || 'Izoh kiritilmagan'}</p>
            </div>
            {(returnData as any).attachment_note ? (
              <div>
                <Label className="text-muted-foreground">{t('sales_returns.detail.attachment_note')}</Label>
                <p className="text-sm">{(returnData as any).attachment_note}</p>
              </div>
            ) : null}
            {attachmentDisplayUrl ? (
              <div>
                <Label className="text-muted-foreground">{t('sales_returns.detail.attachment')}</Label>
                <a href={attachmentDisplayUrl} target="_blank" rel="noreferrer" className="block mt-1">
                  <img
                    src={attachmentDisplayUrl}
                    alt={(returnData as any).attachment_name || 'attachment'}
                    className="max-h-40 rounded border object-contain bg-white"
                  />
                </a>
                {(returnData as any).attachment_name ? (
                  <p className="text-xs text-muted-foreground mt-1">{(returnData as any).attachment_name}</p>
                ) : null}
              </div>
            ) : null}
            {(returnData as any).approval_reason ? (
              <div>
                <Label className="text-muted-foreground">{t('sales_returns.detail.approval_reason')}</Label>
                <p className="text-sm">{(returnData as any).approval_reason}</p>
              </div>
            ) : null}
            {(returnData as any).reject_reason ? (
              <div>
                <Label className="text-muted-foreground">{t('sales_returns.detail.reject_reason')}</Label>
                <p className="text-sm">{(returnData as any).reject_reason}</p>
              </div>
            ) : null}
            {(returnData as any).cancel_reason ? (
              <div>
                <Label className="text-muted-foreground">{t('sales_returns.detail.cancel_reason')}</Label>
                <p className="text-sm">{(returnData as any).cancel_reason}</p>
              </div>
            ) : null}
            <div>
              <Label className="text-muted-foreground">Qabul qilgan</Label>
              <p className="font-medium">{returnData.cashier?.username || 'N/A'}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Yaratilgan vaqt</Label>
              <p className="text-sm">
                {formatOrderDateTime(returnData.created_at)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Returned Items */}
      <Card>
        <CardHeader>
          <CardTitle>Qaytarilgan mahsulotlar</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mahsulot</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-center">Miqdori</TableHead>
                <TableHead className="text-right">Narxi</TableHead>
                <TableHead className="text-right">Jami</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returnData.items && returnData.items.length > 0 ? (
                returnData.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <div>{item.product?.name || item.product_name || 'Noma’lum mahsulot'}</div>
                      {returnData.return_mode === 'manual' && (
                        <div className="text-xs text-muted-foreground">
                          Narx turi: {item.price_source === 'usta' ? 'Usta' : 'Oddiy'}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{item.product?.sku || 'N/A'}</TableCell>
                    <TableCell className="text-center">{item.quantity}</TableCell>
                    <TableCell className="text-right">{fmtReturn(item.unit_price)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {fmtReturn(item.line_total)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Mahsulotlar topilmadi
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="mt-4 flex justify-end border-t pt-4">
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Jami qaytarilgan summa</p>
              <p className="text-2xl font-bold">{fmtReturn(returnData.total_amount)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Inventory Adjustments Info */}
      <Card>
        <CardHeader>
          <CardTitle>Omborga ta’siri</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {statusKey === 'completed'
              ? 'Qaytarish yakunlanganda omborda quyidagi o‘zgarishlar qilindi:'
              : 'Hold (draft/pending/approved) holatida ombor hali o‘zgarmagan — yakunlashda qo‘llanadi.'}
          </p>
          {statusKey === 'completed' ? (
            <ul className="mt-2 space-y-1">
              {returnData.items?.map((item) => (
                <li key={item.id} className="text-sm">
                  • <span className="font-medium">{item.product?.name}</span>:
                  ombordagi qoldiq <span className="font-medium">{item.quantity}</span> ga oshirildi
                </li>
              ))}
            </ul>
          ) : null}
          {canDelete && (
            <p className="mt-4 text-sm text-muted-foreground">
              Agar qaytarishni o‘chirsangiz, hold rezervi bo‘shatiladi (yakunlanmagan bo‘lsa).
            </p>
          )}
        </CardContent>
      </Card>

      {auditTrail.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('sales_returns.detail.audit_trail')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {auditTrail.map((log) => (
              <div key={log.id || `${log.action}-${log.created_at}`} className="text-sm border-b pb-2 last:border-0">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{log.action}</span>
                  <span className="text-muted-foreground text-xs">
                    {formatOrderDateTime(log.created_at)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {log.user_username || log.user_id || '—'}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
