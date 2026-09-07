import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { getCustomerById } from '@/db/api';
import type { Customer } from '@/types/database';
import { Plus, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DUPLICATE_PHONE_MESSAGE_UZ, formatUserFacingError } from '@/utils/electron';
import { useAuth } from '@/contexts/AuthContext';
import CustomerFormFields, { CustomerDuplicateCandidates } from '@/components/customers/CustomerFormFields';
import {
  createCustomerFromForm,
  emptyCustomerFormValues,
  type CustomerDupCandidate,
  type CustomerFormValues,
} from '@/components/customers/customerFormShared';

interface QuickCustomerCreateProps {
  onCreated?: (customer: Customer) => void;
  showLabel?: boolean;
  className?: string;
}

export default function QuickCustomerCreate({ onCreated, showLabel = false, className = '' }: QuickCustomerCreateProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<CustomerFormValues>(emptyCustomerFormValues);
  const [dupCandidates, setDupCandidates] = useState<CustomerDupCandidate[]>([]);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFormData(emptyCustomerFormValues());
    setDupCandidates([]);
  };

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => nameInputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  const selectExistingAndClose = async (existingId: string, existing?: Customer) => {
    let customer = existing;
    if (!customer) {
      try {
        customer = (await getCustomerById(existingId)) ?? undefined;
      } catch {
        customer = undefined;
      }
    }
    if (customer) {
      onCreated?.(customer);
      setOpen(false);
      reset();
      return true;
    }
    return false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    try {
      setSaving(true);
      const result = await createCustomerFromForm(formData, { isAdmin });
      if (result.status !== 'validation') {
        setDupCandidates(result.duplicates);
      }

      if (result.status === 'validation') {
        toast({
          title: result.title,
          description: result.description,
          variant: 'destructive',
        });
        return;
      }

      if (result.status === 'duplicate_phone') {
        toast({
          title: 'Xatolik',
          description: DUPLICATE_PHONE_MESSAGE_UZ,
          variant: 'destructive',
        });
        const selected = await selectExistingAndClose(result.existingId, result.existing);
        if (!selected) {
          navigate(`/customers/${result.existingId}`);
          setOpen(false);
          reset();
        }
        return;
      }

      if (result.status === 'error') {
        toast({
          title: 'Xatolik',
          description: formatUserFacingError(result.error, "Mijozni saqlab bo'lmadi"),
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Muvaffaqiyatli',
        description: 'Mijoz muvaffaqiyatli yaratildi',
      });
      onCreated?.(result.customer);
      setOpen(false);
      reset();
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) reset();
  };

  return (
    <>
      <Button
        variant="outline"
        size={showLabel ? 'sm' : 'icon'}
        className={showLabel ? `shrink-0 px-3 ${className}` : `shrink-0 ${className}`}
        onClick={() => setOpen(true)}
        title="Yangi mijoz qo'shish"
      >
        <Plus className="h-4 w-4" />
        {showLabel && <span className="ml-1">Yangi mijoz</span>}
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[min(100dvh,44rem)] min-h-0 w-[min(96vw,42rem)] max-w-[min(96vw,42rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,42rem)]">
          <DialogHeader className="shrink-0 border-b px-6 pb-3 pr-14 pt-6">
            <DialogTitle>Yangi mijoz qo'shish</DialogTitle>
            <DialogDescription>POSdan chiqmasdan mijoz qo'shing.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="grid gap-5">
                <CustomerDuplicateCandidates
                  candidates={dupCandidates}
                  onSelect={(customerId) => {
                    void selectExistingAndClose(customerId);
                  }}
                />
                <CustomerFormFields
                  values={formData}
                  onChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
                  isAdmin={isAdmin}
                  layout="dialog"
                  idPrefix="pos-customer-"
                  autoFocusName
                  nameInputRef={nameInputRef}
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t px-6 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={saving}
              >
                Bekor qilish
              </Button>
              <Button type="submit" disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saqlanmoqda...' : 'Saqlash'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
