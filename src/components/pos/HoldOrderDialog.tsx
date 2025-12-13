import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
          <DialogTitle>{t('pos.holdOrder.title')}</DialogTitle>
          <DialogDescription>
            {t('pos.holdOrder.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="customer-name">{t('pos.holdOrder.customerNameLabel')}</Label>
            <Input
              id="customer-name"
              placeholder={t('pos.holdOrder.customerNamePlaceholder')}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t('pos.holdOrder.customerNameHelper')}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="note">{t('pos.holdOrder.noteLabel')}</Label>
            <Textarea
              id="note"
              placeholder={t('pos.holdOrder.notePlaceholder')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t('pos.holdOrder.cancel')}
          </Button>
          <Button onClick={handleConfirm}>
            {t('pos.holdOrder.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
