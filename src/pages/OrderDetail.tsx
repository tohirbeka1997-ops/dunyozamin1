import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { getOrderById, cancelOrder, getSettingsByCategory } from '@/db/api';
import type { OrderWithDetails } from '@/types/database';
import { ArrowLeft, Printer, RotateCcw, XCircle } from 'lucide-react';
import { formatMoneyUZS } from '@/lib/format';
import { printHtml } from '@/lib/print';
import { renderReceiptTemplate } from '@/lib/receipts/renderReceiptTemplate';
import { getActiveReceiptTemplate, resolveReceiptTemplateStore } from '@/lib/receipts/templateStore';
import { buildReceiptInputFromOrder } from '@/lib/receipts/receiptModel';
import { buildReceiptLines, DEFAULT_CHARS_PER_LINE, DEFAULT_CHARS_PER_LINE_58 } from '@/lib/receipts/receiptTextBuilder';
import { printEscposReceipt } from '@/lib/receipts/escposPrint';
import { isElectron } from '@/utils/electron';
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
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardQueries } from '@/utils/dashboard';
import { formatOrderDateTime, formatReceiptDateTime } from '@/lib/datetime';
import { navigateBackTo, resolveBackTarget } from '@/lib/pageState';

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<OrderWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const backTo = resolveBackTarget(location, '/orders');

  const getEffectiveDiscountAmount = (o: OrderWithDetails | null | undefined) => {
    if (!o) return 0;
    const orderLevel = Number((o as any).discount_amount || 0);
    if (orderLevel > 0) return orderLevel;
    const items = Array.isArray((o as any).items) ? (o as any).items : [];
    const itemsSum = items.reduce((sum: number, it: any) => sum + Number(it?.discount_amount || 0), 0);
    return itemsSum > 0 ? itemsSum : 0;
  };

  useEffect(() => {
    if (id) {
      loadOrder();
    }
  }, [id]);

  const loadOrder = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const orderData = await getOrderById(id);
      setOrder(orderData);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Buyurtma tafsilotlarini yuklab bo\'lmadi',
        variant: 'destructive',
      });
      navigate(backTo);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; className: string }> = {
      completed: { label: 'Yakunlangan', className: 'bg-success text-success-foreground' },
      pending: { label: 'Kutilmoqda', className: 'bg-primary text-primary-foreground' },
      voided: { label: 'Bekor qilingan', className: 'bg-muted text-muted-foreground' },
      refunded: { label: 'Qaytarilgan', className: 'bg-warning text-warning-foreground' },
    };
    const variant = variants[status] || variants.completed;
    return <Badge className={variant.className}>{variant.label}</Badge>;
  };

  const getPaymentStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
      paid: { label: 'To\'langan', variant: 'default' },
      partial: { label: 'Qisman to\'langan', variant: 'secondary' },
      unpaid: { label: 'To\'lanmagan', variant: 'destructive' },
    };
    const variant = variants[status] || variants.paid;
    return <Badge variant={variant.variant}>{variant.label}</Badge>;
  };

  const getPaymentMethodIcon = (method: string) => {
    const icons: Record<string, string> = {
      cash: '💵',
      card: '💳',
      qr: '📱',
      credit: '📝',
    };
    return icons[method] || '💰';
  };

  const handlePrint = async () => {
    if (!order) return;
    
    try {
      setPrinting(true);
      // Load latest settings so printed receipts reflect saved header/footer/company info
      const [company, receipt, receiptTemplates] = await Promise.all([
        getSettingsByCategory('company'),
        getSettingsByCategory('receipt'),
        getSettingsByCategory('receipt_templates'),
      ]);
      const meta = {
        storeName: String((company as any)?.name || '').trim() || 'POS tizimi',
        storePhone: String((company as any)?.phone || '').trim() || '',
        headerText: String((receipt as any)?.header_text || '').trim() || '',
        middleText: String((receipt as any)?.middle_text || '').trim() || '',
        footerText: String((receipt as any)?.footer_text || '').trim() || '',
        showCashier: (receipt as any)?.show_cashier ?? true,
        showCustomer: (receipt as any)?.show_customer ?? true,
        showSku: (receipt as any)?.show_sku ?? true,
        paperSize:
          (receipt as any)?.paper_size === '58mm' ||
          (receipt as any)?.paper_size === '78mm' ||
          (receipt as any)?.paper_size === '80mm'
            ? ((receipt as any)?.paper_size as '58mm' | '78mm' | '80mm')
            : '78mm',
      };

      const templateStore = resolveReceiptTemplateStore(receiptTemplates);
      const activeTemplate = getActiveReceiptTemplate(templateStore);

      const canEscpos = isElectron() && (window as any)?.posApi?.print?.receipt;
      if (canEscpos) {
        try {
          const receiptInput = buildReceiptInputFromOrder(order, company as any, receipt as any);
          const charsPerLine = meta.paperSize === '58mm' ? DEFAULT_CHARS_PER_LINE_58 : DEFAULT_CHARS_PER_LINE;
          const lines = buildReceiptLines(receiptInput, { charsPerLine });
          await printEscposReceipt(lines, {
            charsPerLine,
            feedLines: 3,
            cut: true,
          });
          toast({
            title: 'Chop etish',
            description: 'Chek printerga yuborildi',
          });
          return;
        } catch (escposError) {
          console.warn('[Print] ESC/POS failed, falling back to HTML print', escposError);
        }
      }

      if (activeTemplate) {
        const htmlContent = renderReceiptTemplate(activeTemplate, order, company as any, undefined, {
          middleText: String((receipt as any)?.middle_text || '').trim() || undefined,
        });
        printHtml(`Chek - ${order.order_number}`, htmlContent, `${activeTemplate.paperWidth}mm` as '58mm' | '78mm' | '80mm');
      } else {
        const htmlContent = generateOrderReceiptHTML(order, 'thermal', meta);
        printHtml(`Chek - ${order.order_number}`, htmlContent, meta.paperSize ?? '78mm');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Chop etishda xatolik yuz berdi';
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setPrinting(false);
    }
  };

  const handleCreateReturn = () => {
    if (!order || !id) return;
    navigate(`/returns/create?orderId=${id}`);
  };

  const handleCancelOrder = async () => {
    if (!order || !id) return;
    
    try {
      setCancelling(true);
      await cancelOrder(id);
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      invalidateDashboardQueries(queryClient);
      
      // Reload order data
      await loadOrder();
      
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Buyurtma bekor qilindi',
      });
      
      setShowCancelDialog(false);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Buyurtmani bekor qilishda xatolik yuz berdi';
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setCancelling(false);
    }
  };

  const generateOrderReceiptHTML = (
    orderData: OrderWithDetails,
    variant: 'thermal' | 'a4',
    meta?: {
      storeName?: string;
      storePhone?: string;
      headerText?: string;
      middleText?: string;
      footerText?: string;
      showCashier?: boolean;
      showCustomer?: boolean;
      showSku?: boolean;
      paperSize?: '58mm' | '78mm' | '80mm';
    }
  ): string => {
    const escapeHtml = (v: unknown) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const storeName = meta?.storeName?.trim() || 'POS tizimi';
    const storePhone = meta?.storePhone?.trim() || '';
    const headerText = meta?.headerText?.trim() || '';
    const middleText = meta?.middleText?.trim() || '';
    const footerText = meta?.footerText?.trim() || '';
    const showCashier = meta?.showCashier ?? true;
    const showCustomer = meta?.showCustomer ?? true;
    const showSku = meta?.showSku ?? true;
    const paperSize = meta?.paperSize ?? '78mm';
    const dateTime = formatReceiptDateTime(orderData.created_at);
    const cashierName = orderData.cashier?.username || orderData.cashier?.full_name || '-';
    const customerName = orderData.customer?.name || 'Yangi mijoz';
    const effectiveDiscountAmount = getEffectiveDiscountAmount(orderData);
    
    // Calculate payment breakdown
    const payments = orderData.payments || [];
    const paymentBreakdown = payments.reduce((acc, payment) => {
      const method = payment.payment_method;
      if (!acc[method]) {
        acc[method] = 0;
      }
      acc[method] += payment.amount;
      return acc;
    }, {} as Record<string, number>);
    
    const paymentMethodLabels: Record<string, string> = {
      cash: 'Naqd pul',
      card: 'Karta',
      qr: 'QR to\'lov',
      credit: 'Nasiya',
      mixed: 'Aralash',
    };
    
    if (variant === 'a4') {
      return `
        <div class="receipt-a4">
          <div class="text-center mb-6">
            <h1 class="text-2xl font-bold mb-2">${escapeHtml(storeName)}</h1>
            ${storePhone ? `<p class="text-sm text-muted-foreground">${escapeHtml(storePhone)}</p>` : ''}
            ${headerText ? `<p class="text-sm mt-2 whitespace-pre-wrap">${escapeHtml(headerText)}</p>` : ''}
            <p class="text-sm text-muted-foreground mt-2">Chek</p>
          </div>
          <div class="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div><p class="font-semibold">Buyurtma raqami:</p><p class="font-mono">${orderData.order_number}</p></div>
            <div><p class="font-semibold">Sana va vaqt:</p><p>${dateTime}</p></div>
            ${showCashier ? `<div><p class="font-semibold">Kassir:</p><p>${escapeHtml(cashierName)}</p></div>` : ''}
            ${showCustomer ? `<div><p class="font-semibold">Mijoz:</p><p>${escapeHtml(customerName)}</p></div>` : ''}
          </div>
          <div class="mb-6">
            <table class="w-full border-collapse">
              <thead>
                <tr class="border-b-2 border-gray-300">
                  <th class="text-left py-2 px-2">Mahsulot</th>
                  <th class="text-center py-2 px-2">Miqdor</th>
                  <th class="text-right py-2 px-2">Narx</th>
                  <th class="text-right py-2 px-2">Jami</th>
                </tr>
              </thead>
              <tbody>
                ${(orderData.items?.length ? orderData.items : [])
                  .map((item) => {
                  const originalQty = Number(item.quantity) || 0;
                  const returned = Number(item.returned_quantity || 0);
                  const remaining =
                    item.remaining_quantity !== undefined && item.remaining_quantity !== null
                      ? Number(item.remaining_quantity)
                      : originalQty - returned;
                  const denom = Math.abs(originalQty) > 1e-9 ? originalQty : 1;
                  const lineBase =
                    Number(
                      item.line_total ??
                        item.total ??
                        (Number(item.unit_price) || 0) * Math.abs(originalQty)
                    ) || 0;
                  const rowTotal = denom !== 0 ? lineBase * (remaining / denom) : lineBase;
                  const sku = (item as any)?.product?.sku || '';
                  return `
                  <tr class="border-b border-gray-200">
                    <td class="py-2 px-2">
                      ${escapeHtml(item.product_name)}
                      ${showSku && sku ? `<div class="text-xs text-muted-foreground font-mono">SKU: ${escapeHtml(sku)}</div>` : ''}
                      ${originalQty !== 0 ? `<span class="text-xs text-gray-600 block">Sotilgan: ${originalQty}${returned > 0 ? ` · Qaytarilgan: <span class="text-red-600">${returned}</span>` : ''}${remaining <= 0 ? ' · <span class="text-red-600">To‘liq qaytarilgan</span>' : ''}</span>` : ''}
                    </td>
                    <td class="text-center py-2 px-2">
                      <span>${remaining}</span>
                    </td>
                    <td class="text-right py-2 px-2">${formatMoneyUZS(item.unit_price)}</td>
                    <td class="text-right py-2 px-2 font-medium">${formatMoneyUZS(rowTotal)}</td>
                  </tr>
                `;
                })
                  .join('') || ''}
              </tbody>
            </table>
          </div>
          ${middleText ? `<div class="mb-6 text-sm text-center whitespace-pre-wrap border-t border-dashed border-gray-300 pt-4">${escapeHtml(middleText)}</div>` : ''}
          <div class="mb-6 space-y-2 text-sm">
            <div class="flex justify-between">
              <span>Subtotal:</span>
              <span>${formatMoneyUZS(orderData.subtotal)}</span>
            </div>
            ${effectiveDiscountAmount > 0 ? `<div class="flex justify-between text-red-600"><span>Chegirma:</span><span>-${formatMoneyUZS(effectiveDiscountAmount)}</span></div>` : ''}
            ${orderData.tax_amount > 0 ? `<div class="flex justify-between"><span>Soliq:</span><span>${formatMoneyUZS(orderData.tax_amount)}</span></div>` : ''}
            <div class="flex justify-between font-bold text-lg border-t-2 border-gray-300 pt-2">
              <span>Jami:</span>
              <span>${formatMoneyUZS(orderData.total_amount)}</span>
            </div>
          </div>
          <div class="mb-6 space-y-2 text-sm">
            <p class="font-semibold text-base mb-2">To'lovlar:</p>
            ${Object.entries(paymentBreakdown).map(([method, amount]) => `
              <div class="flex justify-between">
                <span>${paymentMethodLabels[method] || method}:</span>
                <span>${formatMoneyUZS(amount)}</span>
              </div>
            `).join('')}
            ${orderData.change_amount > 0 ? `<div class="flex justify-between font-bold border-t pt-2"><span>Qaytim:</span><span>${formatMoneyUZS(orderData.change_amount)}</span></div>` : ''}
          </div>
          <div class="text-center mt-8 pt-4 border-t border-gray-300">
            ${footerText ? `<p class="text-sm mb-2 whitespace-pre-wrap">${escapeHtml(footerText)}</p>` : ''}
            <p class="text-sm text-muted-foreground">Xaridingiz uchun rahmat!</p>
          </div>
        </div>
      `;
    }
    
    // Thermal format
    return `
      <div class="receipt-thermal" style="max-width:${paperSize};margin:0 auto;">
        <div class="text-center mb-2">
          <h2 class="text-lg font-bold">${escapeHtml(storeName)}</h2>
          ${storePhone ? `<p class="text-xs">${escapeHtml(storePhone)}</p>` : ''}
          ${headerText ? `<p class="text-xs mt-1 whitespace-pre-wrap">${escapeHtml(headerText)}</p>` : ''}
          <p class="text-xs">Chek</p>
        </div>
        <div class="text-center mb-3 text-xs">
          <p class="font-mono">Buyurtma: ${orderData.order_number}</p>
          <p>${dateTime}</p>
          ${showCashier ? `<p>Kassir: ${escapeHtml(cashierName)}</p>` : ''}
          ${showCustomer ? `<p>Mijoz: ${escapeHtml(customerName)}</p>` : ''}
        </div>
        <div class="border-t border-b border-dashed border-gray-400 py-2 mb-3">
          ${(orderData.items?.length ? orderData.items : [])
            .map((item) => {
            const originalQty = Number(item.quantity) || 0;
            const returned = Number(item.returned_quantity || 0);
            const remaining =
              item.remaining_quantity !== undefined && item.remaining_quantity !== null
                ? Number(item.remaining_quantity)
                : originalQty - returned;
            const denom = Math.abs(originalQty) > 1e-9 ? originalQty : 1;
            const lineBase =
              Number(
                item.line_total ??
                  item.total ??
                  (Number(item.unit_price) || 0) * Math.abs(originalQty)
              ) || 0;
            const rowTotal = denom !== 0 ? lineBase * (remaining / denom) : lineBase;
            const sku = (item as any)?.product?.sku || '';
            return `
            <div class="mb-2 text-xs">
              <div class="font-medium">
                ${escapeHtml(item.product_name)}
                ${originalQty !== 0 ? `<span class="text-gray-600 font-normal"> · Qoldiq: ${remaining}${returned > 0 ? ` · Qayt: ${returned}` : ''}</span>` : ''}
              </div>
              ${showSku && sku ? `<div class="text-[10px] text-gray-600 font-mono">${escapeHtml(sku)}</div>` : ''}
              <div class="flex justify-between mt-1">
                <span class="text-gray-600">${remaining} x ${formatMoneyUZS(item.unit_price)}</span>
                <span class="font-semibold">${formatMoneyUZS(rowTotal)}</span>
              </div>
            </div>
          `;
          })
            .join('') || ''}
        </div>
        ${middleText ? `<div class="mb-2 text-xs text-center whitespace-pre-wrap border-t border-dashed border-gray-400 pt-2">${escapeHtml(middleText)}</div>` : ''}
        <div class="space-y-1 text-right border-t border-dashed py-2 mb-2 text-xs">
          <div class="flex justify-between">
            <span>Subtotal:</span>
            <span>${formatMoneyUZS(orderData.subtotal)}</span>
          </div>
          ${effectiveDiscountAmount > 0 ? `<div class="flex justify-between"><span>Chegirma:</span><span>-${formatMoneyUZS(effectiveDiscountAmount)}</span></div>` : ''}
          ${orderData.tax_amount > 0 ? `<div class="flex justify-between"><span>Soliq:</span><span>${formatMoneyUZS(orderData.tax_amount)}</span></div>` : ''}
          <div class="flex justify-between font-bold text-sm">
            <span>Jami:</span>
            <span>${formatMoneyUZS(orderData.total_amount)}</span>
          </div>
        </div>
        <div class="space-y-1 text-right border-t border-dashed py-2 mb-2 text-xs">
          ${Object.entries(paymentBreakdown).map(([method, amount]) => `
            <div class="flex justify-between">
              <span>${paymentMethodLabels[method] || method}:</span>
              <span>${formatMoneyUZS(amount)}</span>
            </div>
          `).join('')}
          ${orderData.change_amount > 0 ? `<div class="flex justify-between font-bold"><span>Qaytim:</span><span>${formatMoneyUZS(orderData.change_amount)}</span></div>` : ''}
        </div>
        <div class="text-center border-t border-dashed pt-2 text-xs">
          ${footerText ? `<p class="mb-1 whitespace-pre-wrap">${escapeHtml(footerText)}</p>` : ''}
          <p>Xaridingiz uchun rahmat!</p>
        </div>
      </div>
    `;
  };

  if (loading || !order) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  const canVoid = profile && ['admin', 'manager'].includes(profile.role) && order.status === 'completed';
  const effectiveDiscountAmount = getEffectiveDiscountAmount(order);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigateBackTo(navigate, location, '/orders')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Buyurtma tafsilotlari</h1>
            <p className="text-muted-foreground">Buyurtma haqida batafsil ma'lumot</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            onClick={handlePrint}
            disabled={printing}
          >
            {printing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2" />
                Chop etilmoqda...
              </>
            ) : (
              <>
                <Printer className="h-4 w-4 mr-2" />
                Chek chiqarish
              </>
            )}
          </Button>
          {order.status === 'completed' && order.status !== 'voided' && (
            <Button onClick={handleCreateReturn}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Qaytarish yaratish
            </Button>
          )}
          {canVoid && order.status !== 'voided' && (
            <Button 
              variant="destructive" 
              onClick={() => setShowCancelDialog(true)}
              disabled={cancelling}
            >
              {cancelling ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Bekor qilinmoqda...
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 mr-2" />
                  Buyurtmani bekor qilish
                </>
              )}
            </Button>
          )}
        </div>
        
        <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Buyurtmani bekor qilasizmi?</AlertDialogTitle>
              <AlertDialogDescription>
                Bu amal qaytarib bo'lmaydi. Buyurtma holati 'Bekor qilingan' bo'ladi.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cancelling}>Orqaga</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleCancelOrder}
                disabled={cancelling}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {cancelling ? 'Bekor qilinmoqda...' : 'Ha, bekor qilish'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Buyurtma ma'lumotlari</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Buyurtma raqami</p>
                <p className="font-mono font-bold text-lg">{order.order_number}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Sana va vaqt</p>
                <p className="font-medium">{formatOrderDateTime(order.created_at)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Kassir</p>
                <p className="font-medium">{order.cashier?.username || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Mijoz</p>
                <p className="font-medium">{order.customer?.name || 'Yangi mijoz'}</p>
              </div>
            </div>

            <div className="flex gap-2">
              {getStatusBadge(order.status)}
              {getPaymentStatusBadge(order.payment_status)}
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold mb-4">Buyurtma tarkibi</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mahsulot</TableHead>
                    <TableHead className="text-right">Qolgan miqdor</TableHead>
                    <TableHead className="text-right">Narxi (dona uchun)</TableHead>
                    <TableHead className="text-right">Chegirma</TableHead>
                    <TableHead className="text-right">Jami summa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(order.items?.length ? order.items : []).map((item) => {
                    const originalQty = Number(item.quantity) || 0;
                    const returned = Number(item.returned_quantity || 0);
                    const remaining =
                      item.remaining_quantity !== undefined && item.remaining_quantity !== null
                        ? Number(item.remaining_quantity)
                        : originalQty - returned;
                    const denom = Math.abs(originalQty) > 1e-9 ? originalQty : 1;
                    const lineBase =
                      Number(
                        item.line_total ??
                          item.total ??
                          (Number(item.unit_price) || 0) * Math.abs(originalQty)
                      ) || 0;
                    const displayLineTotal = denom !== 0 ? lineBase * (remaining / denom) : lineBase;
                    const fullyReturned = remaining <= 0 && originalQty !== 0;
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <p className="font-medium">{item.product_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {originalQty !== 0 && (
                              <>
                                Sotilgan: {originalQty}
                                {returned > 0 && (
                                  <>
                                    {' '}
                                    · Qaytarilgan: <span className="text-destructive">{returned}</span>
                                  </>
                                )}
                                {fullyReturned && (
                                  <Badge variant="outline" className="ml-2 text-[10px] border-destructive/50 text-destructive">
                                    To‘liq qaytarilgan
                                  </Badge>
                                )}
                              </>
                            )}
                          </p>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={remaining <= 0 ? 'text-muted-foreground' : 'font-medium'}>
                            {remaining}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoneyUZS(item.unit_price)}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.discount_amount > 0 ? (
                            <span className="text-destructive">
                              -{formatMoneyUZS(item.discount_amount)}
                            </span>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoneyUZS(displayLineTotal)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Buyurtma umumiy hisoboti</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Oraliq summa:</span>
                  <span className="font-medium">{formatMoneyUZS(order.subtotal)}</span>
                </div>
                {effectiveDiscountAmount > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>Chegirma:</span>
                    <span className="font-medium">-{formatMoneyUZS(effectiveDiscountAmount)}</span>
                  </div>
                )}
                {order.discount_percent > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Chegirma foizi:</span>
                    <span>{order.discount_percent}%</span>
                  </div>
                )}
                {order.tax_amount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Soliq:</span>
                    <span className="font-medium">{formatMoneyUZS(order.tax_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold pt-2 border-t">
                  <span>Jami:</span>
                  <span>{formatMoneyUZS(order.total_amount)}</span>
                </div>
                <div className="flex justify-between text-success">
                  <span>To'langan summa:</span>
                  <span className="font-medium">{formatMoneyUZS(order.paid_amount)}</span>
                </div>
                {order.change_amount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Qaytim:</span>
                    <span className="font-medium">{formatMoneyUZS(order.change_amount)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>To'lovlar</CardTitle>
            </CardHeader>
            <CardContent>
              {!order.payments || order.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">To'lovlar qayd etilmagan</p>
              ) : (
                <div className="space-y-3">
                  {order.payments.map((payment) => {
                    const paymentMethodLabels: Record<string, string> = {
                      cash: 'Naqd pul',
                      card: 'Karta',
                      qr: 'QR to\'lov',
                      mixed: 'Aralash to\'lov',
                    };
                    const paymentLabel = paymentMethodLabels[payment.payment_method] || payment.payment_method;
                    return (
                      <div key={payment.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{getPaymentMethodIcon(payment.payment_method)}</span>
                          <div>
                            <p className="font-medium">{paymentLabel}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatOrderDateTime(payment.created_at)}
                            </p>
                            {payment.reference_number && (
                              <p className="text-xs text-muted-foreground font-mono">
                                Ma\'lumot: {payment.reference_number}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold">{formatMoneyUZS(payment.amount)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {order.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Izohlar</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{order.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
