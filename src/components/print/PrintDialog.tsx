import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getOrderById, getSettingsByCategory } from '@/db/api';
import type { CompanySettings, OrderWithDetails, ReceiptSettings, ReceiptTemplateStore } from '@/types/database';
import ReceiptPrintView from './ReceiptPrintView';
import { openPrintWindow, openPrintWindowA4 } from '@/lib/print';
import ReceiptTemplateView from '@/components/print/ReceiptTemplateView';
import { renderReceiptTemplate } from '@/lib/receipts/renderReceiptTemplate';
import { getActiveReceiptTemplate, resolveReceiptTemplateStore } from '@/lib/receipts/templateStore';
import { buildReceiptInputFromOrder } from '@/lib/receipts/receiptModel';
import { buildReceiptLines, DEFAULT_CHARS_PER_LINE, DEFAULT_CHARS_PER_LINE_58 } from '@/lib/receipts/receiptTextBuilder';
import { printEscposReceipt } from '@/lib/receipts/escposPrint';
import { isElectron } from '@/utils/electron';
import { Printer, Download, X } from 'lucide-react';

interface PrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  order?: OrderWithDetails; // If order is already loaded, use it
}

export default function PrintDialog({ open, onOpenChange, orderId, order: initialOrder }: PrintDialogProps) {
  const { toast } = useToast();
  const [order, setOrder] = useState<OrderWithDetails | null>(initialOrder || null);
  const [loading, setLoading] = useState(!initialOrder);
  const [error, setError] = useState<string | null>(null);
  const [variant, setVariant] = useState<'thermal' | 'a4'>('thermal');
  const [isPrinting, setIsPrinting] = useState(false);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings | null>(null);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [receiptTemplateStore, setReceiptTemplateStore] = useState<ReceiptTemplateStore | null>(null);
  const activeTemplate = getActiveReceiptTemplate(receiptTemplateStore);

  useEffect(() => {
    if (open && !initialOrder) {
      loadOrder();
    } else if (open && initialOrder) {
      setOrder(initialOrder);
      setLoading(false);
      setError(null);
      loadReceiptSettings();
    }
  }, [open, orderId, initialOrder]);

  const loadReceiptSettings = async () => {
    try {
      const [receipt, company, receiptTemplates] = await Promise.all([
        getSettingsByCategory('receipt'),
        getSettingsByCategory('company'),
        getSettingsByCategory('receipt_templates'),
      ]);
      setReceiptSettings(receipt as ReceiptSettings);
      setCompanySettings(company as CompanySettings);
      setReceiptTemplateStore(resolveReceiptTemplateStore(receiptTemplates));
    } catch {
      setReceiptSettings(null);
      setCompanySettings(null);
      setReceiptTemplateStore(null);
    }
  };

  const loadOrder = async () => {
    try {
      setLoading(true);
      setError(null);
      const orderData = await getOrderById(orderId);
      if (!orderData) {
        throw new Error('Buyurtma topilmadi');
      }
      setOrder(orderData);
      await loadReceiptSettings();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Buyurtmani yuklab bo\'lmadi';
      setError(errorMessage);
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = async () => {
    if (!order) return;

    try {
      setIsPrinting(true);

      const canEscpos = variant === 'thermal' && isElectron() && (window as any)?.posApi?.print?.receipt;
      if (canEscpos) {
        try {
          const receiptInput = buildReceiptInputFromOrder(order, companySettings, receiptSettings);
          const charsPerLine =
            receiptSettings?.paper_size === '58mm' ? DEFAULT_CHARS_PER_LINE_58 : DEFAULT_CHARS_PER_LINE;
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
      
      // Get the receipt HTML
      const receiptElement = document.getElementById('receipt-print-content');
      if (!receiptElement) {
        throw new Error('Receipt content not found');
      }

      const htmlContent = receiptElement.innerHTML;

      const paperSize =
        receiptSettings?.paper_size === '58mm' ||
        receiptSettings?.paper_size === '78mm' ||
        receiptSettings?.paper_size === '80mm'
          ? receiptSettings.paper_size
          : '78mm';

      if (variant === 'thermal') {
        // Always print the same HTML shown in the preview
        const size = activeTemplate ? `${activeTemplate.paperWidth}mm` : paperSize;
        openPrintWindow(htmlContent, size as '58mm' | '78mm' | '80mm');
      } else {
        openPrintWindowA4(htmlContent);
      }

      toast({
        title: 'Chop etish',
        description: 'Chop etish oynasi ochildi',
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Chop etishda xatolik yuz berdi';
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsPrinting(false);
    }
  };

  const handleDownloadPDF = () => {
    // TODO: Implement PDF download using jsPDF or similar
    toast({
      title: 'PDF yuklab olish',
      description: 'PDF funksiyasi tez orada qo\'shiladi',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Chek chop etish</DialogTitle>
          <DialogDescription>
            Buyurtma chekini ko'rib chiqing va chop eting
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Variant selector */}
          <div className="flex gap-2">
            <Button
              variant={variant === 'thermal' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setVariant('thermal')}
            >
              Thermal
            </Button>
            <Button
              variant={variant === 'a4' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setVariant('a4')}
            >
              A4 (Invoice)
            </Button>
          </div>

          {/* Receipt preview */}
          <div className="border rounded-lg p-4 bg-white">
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : error ? (
              <div className="text-center py-8">
                <p className="text-destructive mb-4">{error}</p>
                <Button onClick={loadOrder} variant="outline">
                  Qayta urinish
                </Button>
              </div>
            ) : order ? (
              <div id="receipt-print-content">
                {variant === 'thermal' && activeTemplate ? (
                  <ReceiptTemplateView
                    template={activeTemplate}
                    order={order}
                    company={companySettings}
                    mode="preview"
                    settingsMiddleText={receiptSettings?.middle_text?.trim() || undefined}
                  />
                ) : (
                  <ReceiptPrintView order={order} variant={variant} settings={receiptSettings ?? undefined} />
                )}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-2" />
            Yopish
          </Button>
          <Button
            variant="outline"
            onClick={handleDownloadPDF}
            disabled={loading || !order}
          >
            <Download className="h-4 w-4 mr-2" />
            PDF yuklab olish
          </Button>
          <Button
            onClick={handlePrint}
            disabled={loading || !order || isPrinting}
          >
            <Printer className="h-4 w-4 mr-2" />
            {isPrinting ? 'Chop etilmoqda...' : 'Chop etish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

