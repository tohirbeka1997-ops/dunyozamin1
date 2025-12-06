import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface HoldOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (customerName: string, note: string) => void;
}

export default function HoldOrderDialog({
  open,
  onOpenChange,
  onConfirm,
}: HoldOrderDialogProps) {
  const [customerName, setCustomerName] = useState('');
  const [note, setNote] = useState('');

  const handleConfirm = () => {
    onConfirm(customerName, note);
    setCustomerName('');
    setNote('');
  };

  const handleCancel = () => {
    setCustomerName('');
    setNote('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Hold Order</DialogTitle>
          <DialogDescription>
            Save this order to the waiting list. You can restore it later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="customer-name">Customer Name / Label (Optional)</Label>
            <Input
              id="customer-name"
              placeholder="e.g., Green T-shirt guy, Table 3, Tohirbek"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Add a label to easily identify this order later
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="note">Note (Optional)</Label>
            <Textarea
              id="note"
              placeholder="Add any notes about this order..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            Hold Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
