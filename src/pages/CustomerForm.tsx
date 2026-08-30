import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import NumberInput from '@/components/common/NumberInput';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getCustomerById, getCustomers, createCustomer, updateCustomer, findCustomerByPhone, findCustomerDuplicates } from '@/db/api';
import type { Customer } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowLeft, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFormListReturn } from '@/hooks/useFormListReturn';
import { DUPLICATE_PHONE_MESSAGE_UZ, formatUserFacingError } from '@/utils/electron';
import {
  assertInitialBonusPoints,
  assertOptionalEmail,
  assertOptionalUzPhone,
  DEFAULT_INITIAL_BONUS_LIMIT,
} from '@/lib/posHardening';

export default function CustomerForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const fromParam = searchParams.get('from'); // 'pos' or null
  const { goToList, leaveToList } = useFormListReturn({ fallbackListPath: '/customers' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dupCandidates, setDupCandidates] = useState<
    Array<{ id: string; name: string; phone?: string | null; email?: string | null; match: string }>
  >([]);
  const [formData, setFormData] = useState({
    name: '',
    phone: id ? '' : '+998',
    email: '',
    address: '',
    type: 'individual' as 'individual' | 'company',
    pricing_tier: 'retail' as 'retail' | 'master',
    company_name: '',
    tax_number: '',
    status: 'active' as 'active' | 'inactive',
    notes: '',
    bonus_points: 0,
    credit_limit: 0,
    telegram: '',
  });
  const baselineSnapshotRef = useRef<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(!id);

  const formSnapshot = useMemo(() => JSON.stringify(formData), [formData]);
  const isDirty =
    baselineSnapshotRef.current !== null && formSnapshot !== baselineSnapshotRef.current;

  useEffect(() => {
    if (!initialLoadDone || loading) return;
    if (baselineSnapshotRef.current !== null) return;
    baselineSnapshotRef.current = formSnapshot;
  }, [initialLoadDone, loading, formSnapshot]);

  useEffect(() => {
    if (id) {
      void loadCustomer();
    } else {
      setInitialLoadDone(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadCustomer = async () => {
    if (!id) return;

    try {
      setLoading(true);
      // Prefer get-by-id first; fall back to list scan for environments where get(id) fails.
      let customer: Customer | null | undefined = null;
      try {
        customer = await getCustomerById(id);
      } catch {
        customer = null;
      }
      if (!customer) {
        const allCustomers = await getCustomers();
        customer = allCustomers.find((c) => String((c as any).id) === String(id));
      }
      if (!customer) throw new Error('Customer not found');

      const tgUsername = (customer as Customer).telegram_username;
      const tgId = (customer as Customer).telegram_id;
      const telegramDisplay = tgUsername
        ? `@${String(tgUsername).replace(/^@+/, '')}`
        : tgId != null && String(tgId).trim() !== ''
          ? String(tgId)
          : '';

      setFormData({
        name: customer.name,
        phone: customer.phone || '',
        email: customer.email || '',
        address: customer.address || '',
        type: customer.type === 'company' ? 'company' : 'individual',
        pricing_tier: (customer as any).pricing_tier === 'master' ? 'master' : 'retail',
        company_name: customer.company_name || '',
        tax_number: customer.tax_number || '',
        status: customer.status === 'inactive' ? 'inactive' : 'active',
        notes: customer.notes || '',
        bonus_points: Number((customer as Customer).bonus_points) || 0,
        credit_limit: Math.max(0, Number(customer.credit_limit) || 0),
        telegram: telegramDisplay,
      });
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Mijozni yuklab bo\'lmadi',
        variant: 'destructive',
      });
      goToList();
    } finally {
      setLoading(false);
      setInitialLoadDone(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!formData.name.trim()) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Mijoz ismi kiritilishi shart',
        variant: 'destructive',
      });
      return;
    }

    if (formData.type === 'company' && !formData.company_name.trim()) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Yuridik shaxs turi uchun kompaniya nomi kiritilishi shart',
        variant: 'destructive',
      });
      return;
    }

    const phoneInput = formData.phone?.trim();
    if (phoneInput) {
      const phoneGate = assertOptionalUzPhone(phoneInput);
      if (!phoneGate.ok) {
        toast({
          title: 'Validatsiya xatosi',
          description: "Telefon raqami noto'g'ri formatda. Masalan: +998 90 123 45 67",
          variant: 'destructive',
        });
        return;
      }
    }

    const emailGate = assertOptionalEmail(formData.email);
    if (!emailGate.ok) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Email formati noto‘g‘ri',
        variant: 'destructive',
      });
      return;
    }

    if (isAdmin) {
      const bonusGate = assertInitialBonusPoints(formData.bonus_points, {
        maxInitial: DEFAULT_INITIAL_BONUS_LIMIT,
      });
      if (!bonusGate.ok) {
        toast({
          title: 'Validatsiya xatosi',
          description: bonusGate.error,
          variant: 'destructive',
        });
        return;
      }
    }

    const telegramInput = formData.telegram?.trim() || '';
    if (telegramInput) {
      const isNumeric = /^-?\d+$/.test(telegramInput);
      const username = telegramInput.replace(/^@+/, '');
      const isUsername = /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username);
      if (!isNumeric && !isUsername) {
        toast({
          title: 'Validatsiya xatosi',
          description: 'Telegram: @username (masalan @ali) yoki raqamli chat id kiriting',
          variant: 'destructive',
        });
        return;
      }
    }

    if (saving) return;

    try {
      setSaving(true);

      if (!id) {
        const dups = await findCustomerDuplicates({
          phone: phoneInput || null,
          email: emailGate.email,
          name: formData.name.trim(),
        });
        setDupCandidates(dups);
        if (dups.some((d) => d.match === 'phone')) {
          const byPhone = dups.find((d) => d.match === 'phone');
          toast({
            title: 'Xatolik',
            description: DUPLICATE_PHONE_MESSAGE_UZ,
            variant: 'destructive',
          });
          if (byPhone) navigate(`/customers/${byPhone.id}`);
          return;
        }
      }

      if (id) {
        await updateCustomer(id, {
          name: formData.name,
          phone: formData.phone || null,
          email: emailGate.email,
          address: formData.address || null,
          type: formData.type,
          pricing_tier: formData.pricing_tier,
          company_name: formData.company_name || null,
          tax_number: formData.tax_number || null,
          status: formData.status,
          notes: formData.notes || null,
          telegram: formData.telegram.trim() || null,
          ...(isAdmin
            ? {
                bonus_points: Math.max(0, Math.floor(Number(formData.bonus_points) || 0)),
                credit_limit: Math.max(0, Number(formData.credit_limit) || 0),
              }
            : {}),
        } as Partial<Customer> & { telegram?: string | null });
        toast({
          title: 'Muvaffaqiyatli',
          description: 'Mijoz muvaffaqiyatli yangilandi',
        });
        goToList();
      } else {
        const phoneInput2 = formData.phone?.trim();
        if (phoneInput2) {
          const existingByPhone = await findCustomerByPhone(phoneInput2);
          if (existingByPhone) {
            toast({
              title: 'Xatolik',
              description: DUPLICATE_PHONE_MESSAGE_UZ,
              variant: 'destructive',
            });
            navigate(`/customers/${existingByPhone.id}`);
            return;
          }
        }

        const newCustomer = await createCustomer({
          name: formData.name,
          phone: formData.phone || null,
          email: emailGate.email,
          address: formData.address || null,
          type: formData.type,
          pricing_tier: formData.pricing_tier,
          company_name: formData.company_name || null,
          tax_number: formData.tax_number || null,
          status: formData.status,
          notes: formData.notes || null,
          telegram: formData.telegram.trim() || null,
          ...(isAdmin
            ? {
                bonus_points: Math.max(0, Math.floor(Number(formData.bonus_points) || 0)),
                credit_limit: Math.max(0, Number(formData.credit_limit) || 0),
              }
            : {}),
        });
        toast({
          title: 'Muvaffaqiyatli',
          description: 'Mijoz muvaffaqiyatli yaratildi',
        });
        
        // If coming from POS, store customer ID and navigate back to POS
        if (fromParam === 'pos') {
          // Store customer ID in localStorage for POS to auto-select
          localStorage.setItem('pos:lastCreatedCustomerId', newCustomer.id);
          navigate('/pos');
        } else {
          // Otherwise navigate to customers list
          goToList();
        }
      }
    } catch (error) {
      const errObj = error && typeof error === 'object' ? (error as { code?: string; details?: { existing_id?: string; existing_name?: string } }) : null;
      const code = errObj?.code;
      const existingId = errObj?.details?.existing_id;
      if (code === 'DUPLICATE_PHONE' && existingId) {
        toast({
          title: 'Xatolik',
          description: DUPLICATE_PHONE_MESSAGE_UZ,
          variant: 'destructive',
        });
        navigate(`/customers/${existingId}`);
        return;
      }
      toast({
        title: 'Xatolik',
        description: formatUserFacingError(error, "Mijozni saqlab bo'lmadi"),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void leaveToList(isDirty)}
          aria-label="Mijozlar ro'yxatiga qaytish"
          title="Orqaga"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div>
          <h1 className="page-heading">{id ? 'Mijozni tahrirlash' : 'Yangi mijoz qo\'shish'}</h1>
          <p className="text-muted-foreground">
            {id ? 'Mijoz ma\'lumotlarini yangilash' : 'Bazaga yangi mijoz qo\'shish'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6">
          {!id && dupCandidates.length > 0 && (
            <Card className="border-amber-500/50">
              <CardHeader>
                <CardTitle className="text-base">O‘xshash mijozlar</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {dupCandidates.map((d) => (
                  <button
                    key={`${d.id}-${d.match}`}
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => navigate(`/customers/${d.id}`)}
                  >
                    <span>
                      {d.name} {d.phone ? `(${d.phone})` : ''} — {d.match}
                    </span>
                    <span className="text-xs text-muted-foreground">Ochish</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Asosiy ma'lumotlar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">
                    To'liq ismi <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder="Mijoz ismini kiriting"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type">
                    Mijoz turi <span className="text-destructive">*</span>
                  </Label>
                  <Select value={formData.type} onValueChange={(value) => handleChange('type', value)}>
                    <SelectTrigger id="type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="individual">Jismoniy shaxs</SelectItem>
                      <SelectItem value="company">Yuridik shaxs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pricing_tier">Narx turi</Label>
                  <Select
                    value={formData.pricing_tier}
                    onValueChange={(value) => handleChange('pricing_tier', value)}
                  >
                    <SelectTrigger id="pricing_tier">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="retail">Oddiy mijoz</SelectItem>
                      <SelectItem value="master">Usta</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Usta bo‘lsa POS’da usta narxi avtomatik qo‘llanadi (min miqdor sharti bilan).
                  </p>
                </div>

                {(id || isAdmin) && (
                  <div className="space-y-2">
                    <Label htmlFor="bonus_points">Bonus ball</Label>
                    <NumberInput
                      id="bonus_points"
                      value={formData.bonus_points > 0 ? formData.bonus_points : null}
                      onValueChange={(v) =>
                        setFormData((prev) => ({
                          ...prev,
                          bonus_points: Math.max(0, Math.floor(v ?? 0)),
                        }))
                      }
                      placeholder="0"
                      min={0}
                      disabled={!isAdmin}
                    />
                    {!isAdmin && (
                      <p className="text-xs text-muted-foreground">Bonusni faqat admin o‘zgartiradi.</p>
                    )}
                  </div>
                )}

                {isAdmin && (
                  <div className="space-y-2">
                    <Label htmlFor="credit_limit">Kredit limiti (UZS)</Label>
                    <NumberInput
                      id="credit_limit"
                      value={formData.credit_limit > 0 ? formData.credit_limit : null}
                      onValueChange={(v) =>
                        setFormData((prev) => ({
                          ...prev,
                          credit_limit: Math.max(0, Number(v ?? 0)),
                        }))
                      }
                      placeholder="0 = nasiya/qarz berish yo‘q"
                      min={0}
                      allowZero
                    />
                    <p className="text-xs text-muted-foreground">
                      0 yoki bo‘sh — yangi qarz berish va nasiya sotuv bloklanadi.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="phone">Telefon raqami</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    placeholder="90 123 45 67"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="telegram">Telegram</Label>
                  <Input
                    id="telegram"
                    value={formData.telegram}
                    onChange={(e) => handleChange('telegram', e.target.value)}
                    placeholder="@username yoki chat id"
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Nasiya eslatmasi uchun: @username yoki raqamli chat id. Mini App bogʻlangan boʻlsa, u ustuvor.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    placeholder="customer@example.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">
                    Holati <span className="text-destructive">*</span>
                  </Label>
                  <Select value={formData.status} onValueChange={(value) => handleChange('status', value)}>
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Faol</SelectItem>
                      <SelectItem value="inactive">Faol emas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">Manzil</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => handleChange('address', e.target.value)}
                    placeholder="Manzilni kiriting"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {formData.type === 'company' && (
            <Card>
              <CardHeader>
                <CardTitle>Kompaniya ma'lumotlari</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="company_name">
                      Kompaniya nomi <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="company_name"
                      value={formData.company_name}
                      onChange={(e) => handleChange('company_name', e.target.value)}
                      placeholder="Kompaniya nomini kiriting"
                      required={formData.type === 'company'}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="tax_number">STIR / INN</Label>
                    <Input
                      id="tax_number"
                      value={formData.tax_number}
                      onChange={(e) => handleChange('tax_number', e.target.value)}
                      placeholder="STIR raqamini kiriting"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Qo'shimcha ma'lumotlar</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="notes">Izoh</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  placeholder="Bu mijoz haqida qo'shimcha izohlar qo'shing..."
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => void leaveToList(isDirty)}
            >
              Bekor qilish
            </Button>
            <Button type="submit" disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saqlanmoqda...' : id ? 'Yangilash' : 'Saqlash'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
