import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { createCustomer, findCustomerByPhone } from '@/db/api';
import type { Customer } from '@/types/database';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DUPLICATE_PHONE_MESSAGE_UZ, formatUserFacingError } from '@/utils/electron';
import { assertOptionalUzPhone } from '@/lib/posHardening';

interface QuickCustomerCreateProps {
  onCreated?: (customer: Customer) => void;
  showLabel?: boolean;
  className?: string;
}

export default function QuickCustomerCreate({ onCreated, showLabel = false, className = '' }: QuickCustomerCreateProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+998');
  const [pricingTier, setPricingTier] = useState<'retail' | 'master'>('retail');

  const reset = () => {
    setName('');
    setPhone('+998');
    setPricingTier('retail');
  };

  const handleSave = async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      toast({
        title: 'Validatsiya',
        description: "Mijoz ismini kiriting",
        variant: 'destructive',
      });
      return;
    }

    const phoneGate = assertOptionalUzPhone(phone);
    if (!phoneGate.ok) {
      toast({
        title: 'Validatsiya xatosi',
        description: "Telefon raqami noto'g'ri formatda. Masalan: +998 90 123 45 67",
        variant: 'destructive',
      });
      return;
    }
    const resolvedPhone = phoneGate.phone;

    if (saving) return;

    try {
      setSaving(true);
      if (phoneGate.normalized && resolvedPhone) {
        const existingByPhone = await findCustomerByPhone(resolvedPhone);
        if (existingByPhone) {
          toast({
            title: 'Xatolik',
            description: DUPLICATE_PHONE_MESSAGE_UZ,
            variant: 'destructive',
          });
          onCreated?.(existingByPhone);
          setOpen(false);
          reset();
          return;
        }
      }

      const created = await createCustomer({
        name: cleanName,
        phone: resolvedPhone,
        email: null,
        address: null,
        type: 'individual',
        status: 'active',
        pricing_tier: pricingTier,
        company_name: null,
        tax_number: null,
        notes: null,
        bonus_points: 0,
        credit_limit: 0,
        // Server nasiya gate: allow_debt/allow_credit OR credit_limit>0
        allow_debt: true,
      });
      toast({
        title: 'Muvaffaqiyatli',
        description: "Mijoz POS oynasidan yaratildi",
      });
      onCreated?.(created);
      setOpen(false);
      reset();
    } catch (error) {
      const errObj = error && typeof error === 'object' ? (error as { code?: string; details?: { existing_id?: string } }) : null;
      const code = errObj?.code;
      const existingId = errObj?.details?.existing_id;
      if (code === 'DUPLICATE_PHONE' && existingId) {
        toast({
          title: 'Xatolik',
          description: DUPLICATE_PHONE_MESSAGE_UZ,
          variant: 'destructive',
        });
        navigate(`/customers/${existingId}`);
        setOpen(false);
        reset();
        return;
      }
      toast({
        title: 'Xatolik',
        description: formatUserFacingError(error, "Mijozni yaratib bo'lmadi"),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[28rem]">
          <DialogHeader>
            <DialogTitle>Yangi mijoz</DialogTitle>
            <DialogDescription>POSdan chiqmasdan mijoz qo'shing.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="quick-customer-name">Ism</Label>
              <Input
                id="quick-customer-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mijoz ismi"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-customer-phone">Telefon</Label>
              <Input
                id="quick-customer-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="90 123 45 67"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Narx turi</Label>
              <Select value={pricingTier} onValueChange={(v) => setPricingTier(v as 'retail' | 'master')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="retail">Retail</SelectItem>
                  <SelectItem value="master">Master/Usta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                disabled={saving}
              >
                Bekor qilish
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving || !name.trim()}>
                {saving ? 'Saqlanmoqda...' : 'Saqlash'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
