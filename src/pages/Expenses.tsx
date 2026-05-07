import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirmDialog } from '@/contexts/ConfirmDialogContext';
import { getExpenses, getExpenseStats, getProfiles, deleteExpense, updateExpense } from '@/db/api';
import type { ExpenseWithDetails, Profile, ExpenseCategory, ExpensePaymentMethod, ExpenseStatus } from '@/types/database';
import {
  Search,
  Eye,
  Edit,
  Trash2,
  Plus,
  Wallet,
  TrendingDown,
  Calendar,
  Download,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { formatMoneyUZS } from '@/lib/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ExpenseFormDialog from '@/components/expenses/ExpenseFormDialog';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { invalidateDashboardQueries } from '@/utils/dashboard';
import { formatDate, todayYMD } from '@/lib/datetime';

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

export default function Expenses() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('all');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<ExpenseStatus | 'all'>('approved');
  const [sortBy, setSortBy] = useState<string>('expense_date-desc');
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseWithDetails | null>(null);
  const [employees, setEmployees] = useState<Profile[]>([]);

  // Load employees for filter
  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const profiles = await getProfiles();
        setEmployees(profiles);
      } catch (error) {
        console.error('Failed to load employees:', error);
      }
    };
    loadEmployees();
  }, []);

  const { user, loading: authLoading } = useAuth();
  const authReady = !authLoading;

  // Fetch expenses
  const { data: expenses = [], isLoading, error: expensesError } = useQuery({
    queryKey: ['expenses', { dateFrom, dateTo, categoryFilter, paymentMethodFilter, employeeFilter, statusFilter, searchTerm }],
    queryFn: async () => {
      try {
        return await getExpenses({
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          category: categoryFilter !== 'all' ? categoryFilter as ExpenseCategory : undefined,
          paymentMethod: paymentMethodFilter !== 'all' ? paymentMethodFilter as ExpensePaymentMethod : undefined,
          employeeId: employeeFilter !== 'all' ? employeeFilter : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          search: searchTerm || undefined,
        });
      } catch (error) {
        console.error('Expenses error:', error);
        throw error;
      }
    },
    enabled: authReady && !!user,
    retry: 1,
  });

  // Calculate filtered total from expenses (for "Jami xarajatlar" card)
  const filteredTotal = expenses?.reduce((sum, e) => sum + (e?.amount || 0), 0) || 0;

  const sortedExpenses = (() => {
    const list = Array.isArray(expenses) ? expenses : [];
    const [field, dir] = String(sortBy || 'expense_date-desc').split('-');
    const direction = dir === 'asc' ? 1 : -1;
    return [...list].sort((a: any, b: any) => {
      if (field === 'expense_date') {
        return (new Date(a.expense_date).getTime() - new Date(b.expense_date).getTime()) * direction;
      }
      if (field === 'amount') {
        return (Number(a.amount) - Number(b.amount)) * direction;
      }
      if (field === 'category') {
        return String(a.category || '').localeCompare(String(b.category || ''), undefined, { numeric: true }) * direction;
      }
      return 0;
    });
  })();

  // Fetch stats - today and monthly are always unfiltered, total uses filtered data
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['expenseStats', { dateFrom, dateTo, statusFilter }],
    queryFn: async () => {
      try {
        return await getExpenseStats({
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
        });
      } catch (error) {
        console.error('Expense stats error:', error);
        throw error;
      }
    },
    enabled: authReady && !!user,
    retry: 1,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteExpense,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenseStats'] });
      invalidateDashboardQueries(queryClient);
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Xarajat o\'chirildi',
      });
    },
    onError: (error) => {
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Xarajatni o\'chirib bo\'lmadi',
        variant: 'destructive',
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => updateExpense(id, { status: 'approved' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenseStats'] });
      invalidateDashboardQueries(queryClient);
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Xarajat tasdiqlandi',
      });
    },
    onError: (error) => {
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Xarajatni tasdiqlab bo\'lmadi',
        variant: 'destructive',
      });
    },
  });

  const handleCreate = () => {
    setEditingExpense(null);
    setFormDialogOpen(true);
  };

  const handleEdit = (expense: ExpenseWithDetails) => {
    setEditingExpense(expense);
    setFormDialogOpen(true);
  };

  const handleDelete = async (id: string, expenseNumber: string) => {
    const confirmed = await confirmDialog({
      title: "Ogohlantirish",
      description: `"${expenseNumber}" xarajatini o'chirishni tasdiqlaysizmi? Bu amalni qaytarib bo'lmaydi.`,
      confirmText: "O'chirish",
      cancelText: "Bekor qilish",
      variant: 'destructive',
    });
    if (!confirmed) return;
    deleteMutation.mutate(id);
  };

  const handleView = (id: string) => {
    // For now, just show details in a toast or navigate to detail page
    const expense = expenses?.find(e => e?.id === id);
    if (expense) {
      toast({
        title: expense.expense_number || 'Xarajat',
        description: `${expense.category || 'Noma\'lum'} - ${formatMoneyUZS(expense.amount || 0)}`,
      });
    }
  };

  const handleApprove = async (expense: ExpenseWithDetails) => {
    if (!expense?.id) return;
    if (String(expense.status || '').toLowerCase() === 'approved') return;
    const confirmed = await confirmDialog({
      title: "Tasdiqlash",
      description: `"${expense.expense_number || 'Xarajat'}" ni tasdiqlaysizmi?`,
      confirmText: "Tasdiqlash",
      cancelText: "Bekor qilish",
    });
    if (!confirmed) return;
    approveMutation.mutate(expense.id);
  };

  const handleResetFilters = () => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setCategoryFilter('all');
    setPaymentMethodFilter('all');
    setEmployeeFilter('all');
    setStatusFilter('approved');
  };

  const getPaymentMethodLabel = (method: ExpensePaymentMethod): string => {
    return PAYMENT_METHODS.find(m => m.value === method)?.label || method;
  };

  const getStatusLabel = (status?: ExpenseStatus | string): string => {
    return String(status || '').toLowerCase() === 'approved' ? 'Tasdiqlangan' : 'Kutilmoqda';
  };

  const handleExportCSV = () => {
    if (!expenses || expenses.length === 0) {
      toast({
        title: 'Xatolik',
        description: 'Eksport qilish uchun xarajatlar mavjud emas',
        variant: 'destructive',
      });
      return;
    }

    // Create CSV headers
    const headers = [
      'Xarajat raqami',
      'Sana',
      'Kategoriya',
      'Summa',
      'To\'lov usuli',
      'Mas\'ul xodim',
      'Izoh',
    ];

    // Create CSV rows
    const rows = expenses.map(expense => [
      expense.expense_number,
      expense.expense_date,
      expense.category,
      expense.amount.toString(),
      getPaymentMethodLabel(expense.payment_method),
      expense.employee?.full_name || expense.employee?.username || '',
      expense.note || '',
    ]);

    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Add BOM for UTF-8 Excel compatibility
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    // Generate filename with date range
    const dateStr = dateFrom && dateTo 
      ? `${dateFrom}_${dateTo}`
      : todayYMD();
    link.download = `xarajatlar_${dateStr}.csv`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: 'Muvaffaqiyatli',
      description: `${expenses.length} ta xarajat eksport qilindi`,
    });
  };

  return (
    <ErrorBoundary>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <h1 className="page-heading">Xarajatlar</h1>
            <p className="page-heading-sub">Korxona xarajatlarini hisobga olish va nazorat qilish</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {expenses && expenses.length > 0 && (
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExportCSV}>
                <Download className="mr-2 h-3.5 w-3.5" />
                Eksport (CSV)
              </Button>
            )}
            <Button size="sm" className="h-8 text-xs" onClick={handleCreate}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              Yangi xarajat
            </Button>
          </div>
        </div>

        <Card className="gap-0 py-0 shadow-sm">
          <CardContent className="px-3 py-3 sm:px-4">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
              <div className="flex gap-2 border-b pb-3 lg:border-b-0 lg:pb-0 lg:pr-6 lg:border-r">
                <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Jami xarajatlar</p>
                  <div className="truncate text-base font-semibold tabular-nums leading-tight sm:text-lg">
                    {isLoading ? (
                      <div className="h-6 w-28 max-w-full animate-pulse rounded bg-muted" />
                    ) : (
                      formatMoneyUZS(filteredTotal)
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Filtrlarga mos</p>
                </div>
              </div>
              <div className="flex gap-2 border-b pb-3 lg:border-b-0 lg:pb-0 lg:pr-6 lg:border-r">
                <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Bugun</p>
                  <div className="truncate text-base font-semibold tabular-nums leading-tight sm:text-lg">
                    {statsLoading ? (
                      <div className="h-6 w-28 max-w-full animate-pulse rounded bg-muted" />
                    ) : (
                      formatMoneyUZS(stats?.today || 0)
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Bugungi xarajat</p>
                </div>
              </div>
              <div className="flex gap-2 border-b pb-3 lg:border-b-0 lg:pb-0 lg:pr-6 lg:border-r">
                <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ushbu oy</p>
                  <div className="truncate text-base font-semibold tabular-nums leading-tight sm:text-lg">
                    {statsLoading ? (
                      <div className="h-6 w-28 max-w-full animate-pulse rounded bg-muted" />
                    ) : (
                      formatMoneyUZS(stats?.monthly || 0)
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Oylik xarajat</p>
                </div>
              </div>
              <div className="flex gap-2">
                <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Eng katta</p>
                  <div className="truncate text-base font-semibold tabular-nums leading-tight sm:text-lg">
                    {statsLoading ? (
                      <div className="h-6 w-28 max-w-full animate-pulse rounded bg-muted" />
                    ) : stats?.topCategory ? (
                      formatMoneyUZS(stats.topCategory.amount)
                    ) : (
                      '—'
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {stats?.topCategory?.category || 'Ma\'lumot yo\'q'}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-0 py-0 shadow-sm">
          <CardContent className="px-3 py-2 sm:px-3">
            <div className="rounded-md border bg-muted/30 px-2 py-1.5">
              <span className="mb-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Filtrlar
              </span>
              <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 xl:flex-[3]">
                  <div className="relative h-8 min-w-[12rem] shrink-0 flex-[1.5]">
                    <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Qidirish (izoh, kategoriya)..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="h-8 py-1 pl-8 text-xs sm:text-sm"
                    />
                  </div>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="h-8 min-w-[9.5rem] flex-1 bg-background px-2 font-mono text-xs sm:max-w-[11rem]"
                    aria-label="Dan"
                  />
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="h-8 min-w-[9.5rem] flex-1 bg-background px-2 font-mono text-xs sm:max-w-[11rem]"
                    aria-label="Gacha"
                  />
                  <div className="min-w-[7.5rem] flex-1 basis-[8rem]">
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                        <SelectValue placeholder="Kategoriya" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Barcha kategoriyalar</SelectItem>
                        {EXPENSE_CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-[7.5rem] flex-1 basis-[8rem]">
                    <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                      <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                        <SelectValue placeholder="To'lov usuli" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Barcha to'lov usullari</SelectItem>
                        {PAYMENT_METHODS.map((method) => (
                          <SelectItem key={method.value} value={method.value}>
                            {method.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-[7.5rem] flex-1 basis-[8rem]">
                    <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                      <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                        <SelectValue placeholder="Mas'ul xodim" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Barcha xodimlar</SelectItem>
                        {employees?.map((emp) => {
                          if (!emp || !emp.id) return null;
                          return (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.full_name || emp.username || 'Noma\'lum'}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-[7.5rem] flex-1 basis-[8rem]">
                    <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ExpenseStatus | 'all')}>
                      <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="approved">Tasdiqlangan</SelectItem>
                        <SelectItem value="pending">Kutilmoqda</SelectItem>
                        <SelectItem value="all">Barchasi</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-[8rem] flex-1 basis-[9rem]">
                    <Select value={sortBy} onValueChange={setSortBy}>
                      <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                        <SelectValue placeholder="Saralash" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="expense_date-desc">Eng yangisi</SelectItem>
                        <SelectItem value="expense_date-asc">Eng eskisi</SelectItem>
                        <SelectItem value="amount-desc">Summa (Qimmat → Arzon)</SelectItem>
                        <SelectItem value="amount-asc">Summa (Arzon → Qimmat)</SelectItem>
                        <SelectItem value="category-asc">Kategoriya (A-Z)</SelectItem>
                        <SelectItem value="category-desc">Kategoriya (Z-A)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex shrink-0 justify-end border-t border-dashed border-muted-foreground/25 pt-2 xl:border-t-0 xl:pt-0 xl:pl-2">
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleResetFilters}>
                    Tozalash
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-0 py-0 shadow-sm">
          <CardHeader className="border-b px-4 py-2">
            <CardTitle className="text-base font-semibold">Xarajatlar ({expenses?.length || 0})</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-3 pt-0">
          {isLoading ? (
            <div className="flex justify-center py-10 px-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : expensesError ? (
            <div className="px-4 py-12 text-center">
              <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-destructive" />
              <p className="mb-2 text-base font-semibold">Xatolik</p>
              <p className="mb-4 text-muted-foreground">
                {expensesError instanceof Error ? expensesError.message : 'Xarajatlarni yuklab bo\'lmadi'}
              </p>
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['expenses'] })}
                variant="outline"
              >
                Qayta urinish
              </Button>
            </div>
          ) : !expenses || expenses.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Wallet className="mx-auto mb-3 h-10 w-10 text-muted-foreground/70" />
              <p className="text-muted-foreground">Hozircha xarajatlar yo&apos;q</p>
              <p className="mt-1 text-sm text-muted-foreground">Birinchi xarajatni qo&apos;shing</p>
              <Button size="sm" className="mt-4 h-8 text-xs" onClick={handleCreate}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                Yangi xarajat
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="whitespace-nowrap text-xs font-semibold sm:text-sm">Xarajat raqami</TableHead>
                    <TableHead className="whitespace-nowrap text-xs font-semibold sm:text-sm">Sana</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Kategoriya</TableHead>
                    <TableHead className="min-w-[8rem] text-xs font-semibold sm:text-sm">Izoh</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">To'lov usuli</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Status</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Mas'ul xodim</TableHead>
                    <TableHead className="text-right text-xs font-semibold sm:text-sm">Summa</TableHead>
                    <TableHead className="text-right text-xs font-semibold sm:text-sm">Amallar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedExpenses.map((expense) => {
                    if (!expense || !expense.id) return null;
                    const isPending = String(expense.status || '').toLowerCase() !== 'approved';
                    return (
                      <TableRow key={expense.id} className={`text-sm ${isPending ? 'bg-amber-50/40 hover:bg-amber-50/60' : ''}`}>
                        <TableCell className="max-w-[10rem] truncate py-2 font-mono text-xs font-medium">
                          {expense.expense_number || '-'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-2 text-xs">
                          {expense.expense_date ? formatDate(expense.expense_date) : '-'}
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal sm:text-xs">
                            {expense.category || 'Noma\'lum'}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[14rem] truncate py-2 text-xs">{expense.note || '-'}</TableCell>
                        <TableCell className="max-w-[8rem] truncate py-2 text-xs">
                          {getPaymentMethodLabel(expense.payment_method || 'cash')}
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge
                            variant={String(expense.status || '').toLowerCase() === 'approved' ? 'default' : 'secondary'}
                            className="px-1.5 py-0 text-[10px] font-normal sm:text-xs"
                          >
                            {getStatusLabel(expense.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[8rem] truncate py-2 text-xs">
                          {expense.employee?.full_name || expense.employee?.username || '-'}
                        </TableCell>
                        <TableCell className="py-2 text-right text-xs tabular-nums font-medium">
                          {formatMoneyUZS(expense.amount || 0)}
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleView(expense.id)}
                              title="Ko'rish"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(expense)}
                              title="Tahrirlash"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            {String(expense.status || '').toLowerCase() !== 'approved' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleApprove(expense)}
                                title="Tasdiqlash"
                                disabled={approveMutation.isPending}
                              >
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(expense.id, expense.expense_number || '')}
                              title="O'chirish"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Expense Form Dialog */}
      <ExpenseFormDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        expense={editingExpense}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['expenses'] });
          queryClient.invalidateQueries({ queryKey: ['expenseStats'] });
          setFormDialogOpen(false);
          setEditingExpense(null);
        }}
      />
      </div>
    </ErrorBoundary>
  );
}

