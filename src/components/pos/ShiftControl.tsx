import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { format } from 'date-fns';
import { Clock, Lock, Unlock } from 'lucide-react';
import { formatMoneyUZS } from '@/lib/format';

export default function ShiftControl() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { currentShift, openShift, closeShift, addSale, addRefund } = useShiftStore();
  
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [shiftTotals, setShiftTotals] = useState({ sales: 0, refunds: 0 });

  // Calculate totals from current shift
  useEffect(() => {
    if (currentShift) {
      setShiftTotals({
        sales: currentShift.total_sales,
        refunds: currentShift.total_refunds,
      });
    }
  }, [currentShift]);

  const handleOpenShift = () => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'User not authenticated',
        variant: 'destructive',
      });
      return;
    }

    const cash = parseFloat(openingCash);
    if (isNaN(cash) || cash < 0) {
      toast({
        title: 'Error',
        description: 'Opening cash must be a valid number >= 0',
        variant: 'destructive',
      });
      return;
    }

    try {
      openShift(cash, user.id);
      setOpenDialogOpen(false);
      setOpeningCash('');
      toast({
        title: 'Success',
        description: 'Shift opened successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to open shift',
        variant: 'destructive',
      });
    }
  };

  const handleCloseShift = () => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'User not authenticated',
        variant: 'destructive',
      });
      return;
    }

    const cash = parseFloat(closingCash);
    if (isNaN(cash) || cash < 0) {
      toast({
        title: 'Error',
        description: 'Closing cash must be a valid number >= 0',
        variant: 'destructive',
      });
      return;
    }

    try {
      closeShift(cash, shiftTotals, user.id);
      setCloseDialogOpen(false);
      setClosingCash('');
      toast({
        title: 'Success',
        description: 'Shift closed successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to close shift',
        variant: 'destructive',
      });
    }
  };

  const formatTime = (dateString: string) => {
    try {
      return format(new Date(dateString), 'HH:mm');
    } catch {
      return '';
    }
  };

  return (
    <>
      <div className="flex items-center gap-3">
        {currentShift ? (
          <>
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800">
              <Unlock className="h-3 w-3 mr-1" />
              Shift: OPEN
            </Badge>
            <span className="text-sm text-muted-foreground">
              Opened {formatTime(currentShift.opened_at)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCloseDialogOpen(true)}
              className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
            >
              <Lock className="h-4 w-4 mr-1" />
              Close Shift
            </Button>
          </>
        ) : (
          <>
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800">
              <Lock className="h-3 w-3 mr-1" />
              No Active Shift
            </Badge>
            <Button
              size="sm"
              onClick={() => setOpenDialogOpen(true)}
            >
              <Unlock className="h-4 w-4 mr-1" />
              Open Shift
            </Button>
          </>
        )}
      </div>

      {/* Open Shift Dialog */}
      <Dialog open={openDialogOpen} onOpenChange={setOpenDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open New Shift</DialogTitle>
            <DialogDescription>
              Enter the opening cash amount in the drawer to start a new shift.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="opening-cash">
                Opening Cash <span className="text-destructive">*</span>
              </Label>
              <Input
                id="opening-cash"
                type="number"
                step="0.01"
                min="0"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Enter the amount of cash currently in the drawer
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleOpenShift} disabled={!openingCash || parseFloat(openingCash) < 0}>
              Open Shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Shift Dialog */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Close Shift</DialogTitle>
            <DialogDescription>
              Review shift summary and enter closing cash amount.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {currentShift && (
              <div className="space-y-3 rounded-lg border p-4 bg-muted/50">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Opened At:</span>
                  <span className="font-medium">
                    {format(new Date(currentShift.opened_at), 'MMM dd, yyyy HH:mm')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Opening Cash:</span>
                  <span className="font-medium">
                    {formatMoneyUZS(currentShift.opening_cash)}
                  </span>
                </div>
                <div className="border-t pt-2 mt-2">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Total Sales:</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      {formatMoneyUZS(shiftTotals.sales)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total Refunds:</span>
                    <span className="font-semibold text-red-600 dark:text-red-400">
                      {formatMoneyUZS(shiftTotals.refunds)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="closing-cash">
                Closing Cash in Drawer <span className="text-destructive">*</span>
              </Label>
              <Input
                id="closing-cash"
                type="number"
                step="0.01"
                min="0"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </div>

            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                <strong>Warning:</strong> After closing shift, you will not be able to make sales
                until a new shift is opened.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCloseShift}
              disabled={!closingCash || parseFloat(closingCash) < 0}
              variant="destructive"
            >
              Close Shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}







