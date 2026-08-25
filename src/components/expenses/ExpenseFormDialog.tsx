import { useState, useEffect, useMemo } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { createExpense, updateExpense, getProfiles } from '@/db/api';
import { fetchUzsPerUsdRate } from '@/lib/fxRate';
import type { ExpenseWithDetails, ExpenseCategory, ExpensePaymentMethod } from '@/types/database';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import MoneyInput from '@/components/common/MoneyInput';
import { invalidateDashboardQueries } from '@/utils/dashboard';
import { todayYMD } from '@/lib/datetime';
import { formatMoney, type AppCurrency } from '@/lib/currency';
import SearchableCombobox from '@/components/common/SearchableCombobox';
import { useTranslation } from 'react-i18next';
import { isElectron } from '@/utils/electron';

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Ijara',
  'Oylik maosh',
  'Kommunal',
  'Transport',
  'Soliq',
  'Marketing',
  'Boshqa',
];

const PAYMENT_METHODS: { value: ExpensePaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Naqd pul' },
  { value: 'card', label: 'Karta' },
  { value: 'bank_transfer', label: 'Bank o\'tkazma' },
  { value: 'other', label: 'Boshqa' },
];

interface ExpenseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: ExpenseWithDetails | null;
  onSuccess: () => void;
}

export default function ExpenseFormDialog({
  open,
  onOpenChange,
  expense,
  onSuccess,
}: ExpenseFormDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  
  // Safety check - ensure we have queryClient
  if (!queryClient) {
    console.error('QueryClient is not available');
    return null;
  }
  
  const [expenseDate, setExpenseDate] = useState<string>('');
  const [category, setCategory] = useState<ExpenseCategory>('Boshqa');
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('cash');
  const [note, setNote] = useState<string>('');
  const [employeeId, setEmployeeId] = useState<string | undefined>(undefined);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [expenseCurrency, setExpenseCurrency] = useState<AppCurrency>('UZS');
  const [expenseFxRate, setExpenseFxRate] = useState<number | null>(null);
  const [expenseFxLoading, setExpenseFxLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const employeeOptions = useMemo(
    () =>
      employees
        .filter((emp) => emp?.id)
        .map((emp) => ({
          value: emp.id,
          label: emp.name || "Noma'lum",
        })),
    [employees]
  );

  // Load employees
  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const profiles = await getProfiles();
        setEmployees(profiles.map(p => ({
          id: p.id,
          name: p.full_name || p.username || p.email || 'Noma\'lum',
        })));
      } catch (error) {
        console.error('Failed to load employees:', error);
        // Set empty array on error to prevent crash
        setEmployees([]);
      }
    };
    if (open) {
      loadEmployees();
    }
  }, [open]);

  // Initialize form when expense changes or dialog opens
  useEffect(() => {
    if (open) {
      if (expense) {
        // Edit mode
        setExpenseDate(expense.expense_date);
        setCategory(expense.category);
        setAmount(expense.amount);
        setPaymentMethod(expense.payment_method);
        setNote(expense.note || '');
        setEmployeeId(expense.employee_id && typeof expense.employee_id === 'string' && expense.employee_id.trim() !== '' ? expense.employee_id : undefined);
        setExpenseCurrency(expense.currency === 'USD' ? 'USD' : 'UZS');
        setExpenseFxRate(expense.fx_rate != null ? Number(expense.fx_rate) : null);
      } else {
        // Create mode
        const today = todayYMD();
        setExpenseDate(today);
        setCategory('Boshqa');
        setAmount(undefined);
        setPaymentMethod('cash');
        setNote('');
        setEmployeeId(profile?.id && typeof profile.id === 'string' && profile.id.trim() !== '' ? profile.id : undefined);
        setExpenseCurrency('UZS');
        setExpenseFxRate(null);
      }
      setErrors({});
    }
  }, [open, expense, profile]);

  useEffect(() => {
    if (!open || expenseCurrency !== 'USD') {
      if (expenseCurrency !== 'USD') setExpenseFxRate(null);
      return;
    }
    if (!isElectron()) return;
    let cancelled = false;
    setExpenseFxLoading(true);
    void fetchUzsPerUsdRate(expenseDate || todayYMD())
      .then((rate) => {
        if (cancelled) return;
        if (rate != null && rate > 0) {
          setExpenseFxRate(rate);
        } else {
          setExpenseFxRate(null);
          toast({
            title: 'Valyuta kursi topilmadi',
            description: 'Sozlamalar → Valyuta bo‘limida 1 USD = UZS kursini kiriting.',
            variant: 'destructive',
          });
          setExpenseCurrency('UZS');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setExpenseFxRate(null);
        setExpenseCurrency('UZS');
      })
      .finally(() => {
        if (!cancelled) setExpenseFxLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, expenseCurrency, toast]);

  // React Query v5: onSuccess/onError in useMutation options no longer fire.
  // Handlers are passed to mutate() in handleSubmit so they still run.
  const createMutation = useMutation({
    mutationFn: createExpense,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof updateExpense>[1] }) =>
      updateExpense(id, updates),
  });

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!expenseDate) {
      newErrors.expenseDate = 'Xarajat sanasi majburiy';
    }

    if (!category) {
      newErrors.category = 'Kategoriya majburiy';
    }

    if (amount === undefined || amount === null || amount <= 0) {
      newErrors.amount = 'Summa 0 dan katta bo\'lishi kerak';
    }

    if (expenseCurrency === 'USD' && (!expenseFxRate || expenseFxRate <= 0)) {
      newErrors.amount = 'USD xarajat uchun kurs yuklanmagan';
    }

    if (!paymentMethod) {
      newErrors.paymentMethod = 'To\'lov usuli majburiy';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    if (amount === undefined || amount === null) {
      return; // Should not happen due to validation, but safety check
    }

    if (expense) {
      // Update
      updateMutation.mutate(
        {
          id: expense.id,
          updates: {
            expense_date: expenseDate,
            category,
            amount: amount,
            payment_method: paymentMethod,
            note: note || null,
            employee_id: employeeId || null,
            currency: expenseCurrency,
            fx_rate: expenseCurrency === 'USD' ? expenseFxRate : null,
          },
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['expenses'] });
            queryClient.invalidateQueries({ queryKey: ['expenseStats'] });
            invalidateDashboardQueries(queryClient);
            toast({
              title: 'Muvaffaqiyatli',
              description: 'Xarajat yangilandi',
            });
            onSuccess();
          },
          onError: (error) => {
            toast({
              title: 'Xatolik',
              description: error instanceof Error ? error.message : 'Xarajatni yangilab bo\'lmadi',
              variant: 'destructive',
            });
          },
        },
      );
    } else {
      // Create
      createMutation.mutate(
        {
          expense_date: expenseDate,
          category,
          amount: amount,
          payment_method: paymentMethod,
          note: note || null,
          employee_id: employeeId || null,
          created_by: profile?.id || null,
          status: 'approved',
          currency: expenseCurrency,
          fx_rate: expenseCurrency === 'USD' ? expenseFxRate : null,
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['expenses'] });
            queryClient.invalidateQueries({ queryKey: ['expenseStats'] });
            invalidateDashboardQueries(queryClient);
            toast({
              title: 'Muvaffaqiyatli',
              description: 'Xarajat muvaffaqiyatli qo\'shildi',
            });
            onSuccess();
          },
          onError: (error) => {
            toast({
              title: 'Xatolik',
              description: error instanceof Error ? error.message : 'Xarajatni qo\'shib bo\'lmadi',
              variant: 'destructive',
            });
          },
        },
      );
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {expense ? 'Xarajatni tahrirlash' : 'Yangi xarajat'}
          </DialogTitle>
          <DialogDescription>
            {expense
              ? 'Xarajat ma\'lumotlarini o\'zgartiring'
              : 'Yangi xarajat qo\'shish'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="expenseDate">
                Xarajat sanasi <span className="text-destructive">*</span>
              </Label>
              <Input
                id="expenseDate"
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className={errors.expenseDate ? 'border-destructive' : ''}
              />
              {errors.expenseDate && (
                <p className="text-sm text-destructive">{errors.expenseDate}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">
                Kategoriya <span className="text-destructive">*</span>
              </Label>
              <Select value={category} onValueChange={(value) => setCategory(value as ExpenseCategory)}>
                <SelectTrigger id="category" className={errors.category ? 'border-destructive' : ''}>
                  <SelectValue placeholder="Kategoriyani tanlang" />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.category && (
                <p className="text-sm text-destructive">{errors.category}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Valyuta</Label>
            <div className="flex items-center gap-1 rounded-md border p-0.5 w-fit">
              <Button
                type="button"
                size="sm"
                variant={expenseCurrency === 'UZS' ? 'default' : 'ghost'}
                className="h-7 px-2.5 text-xs"
                disabled={expenseFxLoading}
                onClick={() => setExpenseCurrency('UZS')}
              >
                UZS
              </Button>
              <Button
                type="button"
                size="sm"
                variant={expenseCurrency === 'USD' ? 'default' : 'ghost'}
                className="h-7 px-2.5 text-xs"
                disabled={expenseFxLoading || !isElectron()}
                onClick={() => setExpenseCurrency('USD')}
              >
                USD
              </Button>
            </div>
            {expenseCurrency === 'USD' && expenseFxRate != null && expenseFxRate > 0 && (
              <p className="text-xs text-muted-foreground tabular-nums">
                1 USD = {formatMoney(expenseFxRate, 'UZS')}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <MoneyInput
              id="amount"
              label={expenseCurrency === 'USD' ? 'Summa (USD)' : "Summa (so'm)"}
              value={amount ?? null}
              onValueChange={(val) => setAmount(val ?? undefined)}
              placeholder="0"
              required
              min={1}
              error={errors.amount}
            />

            <div className="space-y-2">
              <Label htmlFor="paymentMethod">
                To'lov usuli <span className="text-destructive">*</span>
              </Label>
              <Select
                value={paymentMethod}
                onValueChange={(value) => setPaymentMethod(value as ExpensePaymentMethod)}
              >
                <SelectTrigger id="paymentMethod" className={errors.paymentMethod ? 'border-destructive' : ''}>
                  <SelectValue placeholder="To'lov usulini tanlang" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method.value} value={method.value}>
                      {method.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.paymentMethod && (
                <p className="text-sm text-destructive">{errors.paymentMethod}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="employeeId">Mas'ul xodim</Label>
            <SearchableCombobox
              id="employeeId"
              value={employeeId && employeeId.trim() !== '' ? employeeId : ''}
              onValueChange={(value) =>
                setEmployeeId(value && value.trim() !== '' ? value : undefined)
              }
              options={employeeOptions}
              placeholder={t('combobox.select_employee', 'Xodimni tanlang (ixtiyoriy)')}
              searchPlaceholder={t('combobox.search_employee', "Nom yoki email bo'yicha qidirish...")}
              emptyMessage={t('combobox.no_employee', 'Xodim topilmadi')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Izoh</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Xarajat haqida qo'shimcha ma'lumot..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Bekor qilish
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saqlanmoqda...' : expense ? 'Yangilash' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

