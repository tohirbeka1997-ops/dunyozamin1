import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { getCustomerById, getCustomers, updateCustomer } from '@/db/api';
import type { Customer } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowLeft, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFormListReturn } from '@/hooks/useFormListReturn';
import { DUPLICATE_PHONE_MESSAGE_UZ, formatUserFacingError } from '@/utils/electron';
import CustomerFormFields, { CustomerDuplicateCandidates } from '@/components/customers/CustomerFormFields';
import {
  buildCustomerWritePayload,
  createCustomerFromForm,
  customerToFormValues,
  emptyCustomerFormValues,
  validateCustomerForm,
  type CustomerDupCandidate,
  type CustomerFormValues,
} from '@/components/customers/customerFormShared';

export default function CustomerForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const fromParam = searchParams.get('from'); // 'pos' or null
  const { goToList, leaveToList } = useFormListReturn({ fallbackListPath: '/customers' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dupCandidates, setDupCandidates] = useState<CustomerDupCandidate[]>([]);
  const [formData, setFormData] = useState<CustomerFormValues>(() => {
    const empty = emptyCustomerFormValues();
    if (id) empty.phone = '';
    return empty;
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

      setFormData(customerToFormValues(customer));
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

    if (id) {
      const validated = validateCustomerForm(formData, { isAdmin });
      if (validated.ok === false) {
        toast({
          title: validated.title,
          description: validated.description,
          variant: 'destructive',
        });
        return;
      }

      if (saving) return;

      try {
        setSaving(true);
        await updateCustomer(id, buildCustomerWritePayload(formData, validated, { isAdmin }) as Partial<Customer> & {
          telegram?: string | null;
        });
        toast({
          title: 'Muvaffaqiyatli',
          description: 'Mijoz muvaffaqiyatli yangilandi',
        });
        goToList();
      } catch (error) {
        const errObj = error && typeof error === 'object' ? (error as { code?: string; details?: { existing_id?: string } }) : null;
        const existingId = errObj?.code === 'DUPLICATE_PHONE' ? errObj.details?.existing_id : undefined;
        if (existingId) {
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
      return;
    }

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
        navigate(`/customers/${result.existingId}`);
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

      if (fromParam === 'pos') {
        localStorage.setItem('pos:lastCreatedCustomerId', result.customer.id);
        navigate('/pos');
      } else {
        goToList();
      }
    } finally {
      setSaving(false);
    }
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
          {!id && (
            <CustomerDuplicateCandidates
              candidates={dupCandidates}
              onSelect={(customerId) => navigate(`/customers/${customerId}`)}
            />
          )}
          <CustomerFormFields
            values={formData}
            onChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
            isAdmin={isAdmin}
            isEdit={Boolean(id)}
          />

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
