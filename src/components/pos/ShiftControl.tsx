import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useShiftStore } from '@/store/shiftStore';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Clock, Lock, Unlock } from 'lucide-react';
import { formatMoneyUZS } from '@/lib/format';
import { getShiftSummary } from '@/db/api';
import MoneyInput from '@/components/common/MoneyInput';
import { formatDateTime, formatTime } from '@/lib/datetime';

export default function ShiftControl() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { currentShift, openShift, closeShift, addSale, addRefund, sales, refunds, setCurrentShift, syncFromDatabase } = useShiftStore();
  
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState<number | null>(null);
  const [closingCash, setClosingCash] = useState<number | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<{
    shiftId: string;
    openedAt: string;
    closedAt: string | null;
    status: string;
    openingCash: number;
    totalSales: number;
    cashSales: number;
    orders: number; // Changed from orderCount to orders
    totalRefunds: number;
    expectedCash: number;
  } | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [checkingShift, setCheckingShift] = useState(false);
  const hasSyncedRef = useRef(false);

  // CRITICAL: Load shift from database on mount (only ONCE per component lifecycle)
  useEffect(() => {
    // Only sync once when component mounts
    if (!hasSyncedRef.current && user?.id) {
      hasSyncedRef.current = true;
      console.log('[ShiftControl] Syncing shift from database for user:', user.id);
      syncFromDatabase(user.id).catch(error => {
        console.error('[ShiftControl] Failed to sync shift:', error);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty array = run only once on mount

  // NOTE: Removed duplicate checkActiveShift useEffect - syncFromDatabase already handles this

  // Fetch shift summary from backend when close dialog opens
  // CRITICAL: Reset summary when dialog closes to force fresh fetch on next open
  useEffect(() => {
    if (closeDialogOpen && currentShift?.id) {
      setLoadingSummary(true);
      console.log('[SHIFT UI] Fetching shift summary for shiftId:', currentShift.id);
      getShiftSummary(currentShift.id)
        .then((data) => {
          // Normalize keys (handle both camelCase and snake_case from backend)
          const normalized = {
            shiftId: data.shiftId || currentShift.id,
            openedAt: data.openedAt || data.opened_at || currentShift.opened_at,
            closedAt: data.closedAt || data.closed_at || currentShift.closed_at || null,
            status: data.status || currentShift.status || 'open',
            openingCash: data.openingCash ?? data.opening_cash ?? currentShift.opening_cash ?? 0,
            totalSales: data.totalSales ?? data.total_payments ?? 0,
            cashSales: data.cashSales ?? data.cash_payments ?? 0,
            orders: data.orders ?? data.order_count ?? 0,
            totalRefunds: data.totalRefunds ?? data.total_refunds ?? 0,
            expectedCash: data.expectedCash ?? data.expected_cash ?? (data.openingCash ?? data.opening_cash ?? 0) + (data.cashSales ?? data.cash_payments ?? 0)
          };
          
          console.log('[UI] shift summary (normalized):', normalized);
          console.log('[UI] shift summary (raw from backend):', data);
          
          setShiftSummary(normalized);
          setLoadingSummary(false);
        })
        .catch((error) => {
          console.error('[SHIFT UI] Error fetching shift summary:', error);
          setLoadingSummary(false);
          // Fallback to local calculation if backend fails
          setShiftSummary({
            shiftId: currentShift.id,
            openedAt: currentShift.opened_at,
            closedAt: currentShift.closed_at || null,
            status: currentShift.status || 'open',
            openingCash: currentShift.opening_cash || 0,
            totalSales: sales.reduce((sum, sale) => sum + (sale.amount || sale.total_amount || 0), 0),
            cashSales: 0,
            orders: 0,
            totalRefunds: refunds.reduce((sum, refund) => sum + (refund.amount || refund.total_amount || 0), 0),
            expectedCash: currentShift.opening_cash || 0,
          });
        });
    } else if (!closeDialogOpen) {
      // Reset summary when dialog closes to ensure fresh fetch on next open
      setShiftSummary(null);
    }
  }, [closeDialogOpen, currentShift?.id]);

  const handleOpenShift = async () => {
    if (isOpening) {
      console.warn('[ShiftControl] Already opening shift, ignoring duplicate request');
      return;
    }

    if (!user) {
      toast({
        title: 'Xatolik',
        description: 'Foydalanuvchi aniqlanmadi',
        variant: 'destructive',
      });
      return;
    }

    const cash = Number(openingCash ?? 0);
    if (openingCash === null || isNaN(cash) || cash < 0) {
      toast({
        title: 'Xatolik',
        description: 'Ochilish naqd puli 0 dan katta yoki teng bo\'lishi kerak',
        variant: 'destructive',
      });
      return;
    }

    // Validate that openShift is a function
    if (typeof openShift !== 'function') {
      console.error("openShift API chaqiruvi import qilinmagan yoki noto'g'ri aniqlangan.");
      toast({
        title: 'Xatolik',
        description: 'Smena ochish funksiyasi mavjud emas',
        variant: 'destructive',
      });
      return;
    }

    setIsOpening(true);
    try {
      await openShift(cash, user.id);
      setOpenDialogOpen(false);
      setOpeningCash(null);
      
      // Sync shift from database to update UI
      await syncFromDatabase(user.id);
      
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Smena muvaffaqiyatli ochildi',
      });
    } catch (error) {
      console.error("Smena ochishda xato:", error);
      const errorMessage = error instanceof Error ? error.message : 'Smenani ochib bo\'lmadi';
      
      // Check if error is about existing shift
      if (errorMessage.includes('already has an open shift')) {
        toast({
          title: 'Diqqat',
          description: 'Sizda allaqachon ochiq smena bor. Sahifani yangilang.',
          variant: 'destructive',
        });
        // Try to sync shift from database
        syncFromDatabase(user.id).catch(console.error);
      } else {
        toast({
          title: 'Xatolik',
          description: errorMessage,
          variant: 'destructive',
        });
      }
    } finally {
      setIsOpening(false);
    }
  };

  const handleCloseShift = async () => {
    if (!user) {
      toast({
        title: 'Xatolik',
        description: 'Foydalanuvchi aniqlanmadi',
        variant: 'destructive',
      });
      return;
    }

    const cash = Number(closingCash ?? 0);
    if (closingCash === null || isNaN(cash) || cash < 0) {
      toast({
        title: 'Xatolik',
        description: 'Yopilish naqd puli 0 dan katta yoki teng bo‘lishi kerak',
        variant: 'destructive',
      });
      return;
    }

    // Validate that closeShift is a function
    if (typeof closeShift !== 'function') {
      console.error("closeShift API chaqiruvi import qilinmagan yoki noto'g'ri aniqlangan.");
      toast({
        title: 'Xatolik',
        description: 'Smenani yopish funksiyasi mavjud emas',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Use summary totals if available, otherwise fallback to local calculation
      const totals = shiftSummary ? {
        sales: shiftSummary.totalSales,
        refunds: shiftSummary.totalRefunds,
      } : {
        sales: sales.reduce((sum, sale) => sum + (sale.amount || sale.total_amount || 0), 0),
        refunds: refunds.reduce((sum, refund) => sum + (refund.amount || refund.total_amount || 0), 0),
      };
      
      await closeShift(cash, totals, user.id);
      setCloseDialogOpen(false);
      setClosingCash(null);
      setShiftSummary(null);
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Smena muvaffaqiyatli yopildi',
      });
    } catch (error) {
      console.error("Smena yopishda xato:", error);
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Smenani yopib bo‘lmadi',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <div className="flex items-center gap-3">
        {checkingShift ? (
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
            <span className="text-sm text-muted-foreground">Smena holati tekshirilmoqda...</span>
          </div>
        ) : currentShift ? (
          <>
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800">
              <Unlock className="h-3 w-3 mr-1" />
              Smena: Ochiq
            </Badge>
            <span className="text-sm text-muted-foreground">
              Ochilgan: {formatTime(currentShift.opened_at)}
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setCloseDialogOpen(true)}
              className="text-white"
            >
              <Lock className="h-4 w-4 mr-1" />
              Smenani yopish
            </Button>
          </>
        ) : (
          <>
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800">
              <Lock className="h-3 w-3 mr-1" />
              Ochiq smena yo‘q
            </Badge>
            <Button
              size="sm"
              onClick={() => setOpenDialogOpen(true)}
            >
              <Unlock className="h-4 w-4 mr-1" />
              Smenani ochish
            </Button>
          </>
        )}
      </div>

      {/* Open Shift Dialog */}
      <Dialog open={openDialogOpen} onOpenChange={setOpenDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yangi smena ochish</DialogTitle>
            <DialogDescription>
              Yangi smenani boshlash uchun kassadagi ochilish naqd pulini kiriting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <MoneyInput
                id="opening-cash"
                label="Ochilish naqd puli"
                value={openingCash}
                onValueChange={setOpeningCash}
                placeholder="0"
                required
                allowZero
                min={0}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Hozir kassada bor naqd pul miqdorini kiriting
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialogOpen(false)}>
              Bekor qilish
            </Button>
            <Button onClick={handleOpenShift} disabled={openingCash === null || openingCash < 0 || isOpening}>
              {isOpening ? 'Ochilmoqda...' : 'Smenani ochish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Shift Dialog */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Smenani yopish</DialogTitle>
            <DialogDescription>
              Smena yakunini ko‘rib chiqing va yopilish naqd pulini kiriting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {currentShift && (
              <div className="space-y-3 rounded-lg border p-4 bg-muted/50">
                {loadingSummary ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    <span className="ml-2 text-sm text-muted-foreground">Hisob-kitob yuklanmoqda...</span>
                  </div>
                ) : shiftSummary ? (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Ochilgan vaqt:</span>
                      <span className="font-medium">
                        {formatDateTime(shiftSummary.openedAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Ochilish naqd puli:</span>
                      <span className="font-medium">
                        {formatMoneyUZS(shiftSummary.openingCash ?? 0)}
                      </span>
                    </div>
                    <div className="border-t pt-2 mt-2">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Jami savdo:</span>
                        <span className="font-semibold text-green-600 dark:text-green-400">
                          {formatMoneyUZS(shiftSummary.totalSales ?? 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Naqd savdo:</span>
                        <span className="font-medium">
                          {formatMoneyUZS(shiftSummary.cashSales ?? 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Buyurtmalar:</span>
                        <span className="font-medium">
                          {shiftSummary.orders ?? 0}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Jami qaytarishlar:</span>
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          {formatMoneyUZS(shiftSummary.totalRefunds ?? 0)}
                        </span>
                      </div>
                      <div className="border-t pt-2 mt-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Kutilayotgan naqd:</span>
                          <span className="font-semibold">
                            {formatMoneyUZS(shiftSummary.expectedCash ?? shiftSummary.openingCash ?? 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  // Fallback display if summary not loaded
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Ochilgan vaqt:</span>
                      <span className="font-medium">
                        {formatDateTime(currentShift.opened_at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Ochilish naqd puli:</span>
                      <span className="font-medium">
                        {formatMoneyUZS(currentShift.opening_cash || 0)}
                      </span>
                    </div>
                    <div className="border-t pt-2 mt-2">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Jami savdo:</span>
                        <span className="font-semibold text-green-600 dark:text-green-400">
                          {formatMoneyUZS(sales.reduce((sum, sale) => sum + (sale.amount || sale.total_amount || 0), 0))}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Jami qaytarishlar:</span>
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          {formatMoneyUZS(refunds.reduce((sum, refund) => sum + (refund.amount || refund.total_amount || 0), 0))}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="space-y-2">
              <MoneyInput
                id="closing-cash"
                label="Kassadagi yopilish naqd puli"
                value={closingCash}
                onValueChange={setClosingCash}
                placeholder="0"
                required
                allowZero
                min={0}
                autoFocus
              />
            </div>

            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                <strong>Diqqat:</strong> Smena yopilgandan so‘ng, yangi smena ochilmaguncha sotuv qilish mumkin bo‘lmaydi.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialogOpen(false)}>
              Bekor qilish
            </Button>
            <Button
              onClick={handleCloseShift}
              disabled={closingCash === null || closingCash < 0}
              variant="destructive"
              className="text-white"
            >
              Smenani yopish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}







