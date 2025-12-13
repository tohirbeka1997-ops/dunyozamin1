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
import { getOrderById } from '@/db/api';
import type { OrderWithDetails } from '@/types/database';
import ReceiptPrintView from './ReceiptPrintView';
import { openPrintWindow, openPrintWindowA4 } from '@/lib/print';
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

  useEffect(() => {
    if (open && !initialOrder) {
      loadOrder();
    } else if (open && initialOrder) {
      setOrder(initialOrder);
      setLoading(false);
      setError(null);
    }
  }, [open, orderId, initialOrder]);

  const loadOrder = async () => {
    try {
      setLoading(true);
      setError(null);
      const orderData = await getOrderById(orderId);
      if (!orderData) {
        throw new Error('Buyurtma topilmadi');
      }
      setOrder(orderData);
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

  const handlePrint = () => {
    if (!order) return;

    try {
      setIsPrinting(true);
      
      // Get the receipt HTML
      const receiptElement = document.getElementById('receipt-print-content');
      if (!receiptElement) {
        throw new Error('Receipt content not found');
      }

      const htmlContent = receiptElement.innerHTML;

      if (variant === 'thermal') {
        openPrintWindow(htmlContent);
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
              Thermal (80mm)
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
                <ReceiptPrintView order={order} variant={variant} />
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

