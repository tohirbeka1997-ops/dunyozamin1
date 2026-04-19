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
import { getExpenses, getExpenseStats, getProfiles, deleteExpense } from '@/db/api';
import type { ExpenseWithDetails, Profile, ExpenseCategory, ExpensePaymentMethod } from '@/types/database';
import { Search, Eye, Edit, Trash2, Plus, Wallet, TrendingDown, Calendar, Download } from 'lucide-react';
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
    queryKey: ['expenses', { dateFrom, dateTo, categoryFilter, paymentMethodFilter, employeeFilter, searchTerm }],
    queryFn: async () => {
      try {
        return await getExpenses({
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          category: categoryFilter !== 'all' ? categoryFilter as ExpenseCategory : undefined,
          paymentMethod: paymentMethodFilter !== 'all' ? paymentMethodFilter as ExpensePaymentMethod : undefined,
          employeeId: employeeFilter !== 'all' ? employeeFilter : undefined,
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
    queryKey: ['expenseStats', { dateFrom, dateTo }],
    queryFn: async () => {
      try {
        return await getExpenseStats({
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
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

  const handleResetFilters = () => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setCategoryFilter('all');
    setPaymentMethodFilter('all');
    setEmployeeFilter('all');
  };

  const getPaymentMethodLabel = (method: ExpensePaymentMethod): string => {
    return PAYMENT_METHODS.find(m => m.value === method)?.label || method;
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
      <div className="space-y-6">
        <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Xarajatlar</h1>
          <p className="text-muted-foreground">Korxona xarajatlarini hisobga olish va nazorat qilish</p>
        </div>
        <div className="flex gap-2">
          {expenses && expenses.length > 0 && (
            <Button variant="outline" onClick={handleExportCSV}>
              <Download className="h-4 w-4 mr-2" />
              Eksport (CSV)
            </Button>
          )}
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Yangi xarajat
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jami xarajatlar</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? (
                <div className="h-8 w-24 bg-muted animate-pulse rounded" />
              ) : (
                formatMoneyUZS(filteredTotal)
              )}
            </div>
            <p className="text-xs text-muted-foreground">Tanlangan filtrlarga mos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bugungi xarajatlar</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? (
                <div className="h-8 w-24 bg-muted animate-pulse rounded" />
              ) : (
                formatMoneyUZS(stats?.today || 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground">Bugun</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Oylik xarajatlar</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? (
                <div className="h-8 w-24 bg-muted animate-pulse rounded" />
              ) : (
                formatMoneyUZS(stats?.monthly || 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground">Ushbu oy</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Eng katta kategoriya</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? (
                <div className="h-8 w-24 bg-muted animate-pulse rounded" />
              ) : stats?.topCategory ? (
                formatMoneyUZS(stats.topCategory.amount)
              ) : (
                '-'
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.topCategory?.category || 'Ma\'lumot yo\'q'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filtrlar</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-8 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Qidirish (izoh, kategoriya)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            <Input
              type="date"
              placeholder="Dan"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />

            <Input
              type="date"
              placeholder="Gacha"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
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

            <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
              <SelectTrigger>
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

            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger>
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

            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger>
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

            <Button variant="outline" onClick={handleResetFilters}>
              Tozalash
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Expenses Table */}
      <Card>
        <CardHeader>
          <CardTitle>Xarajatlar ({expenses?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : expensesError ? (
            <div className="text-center py-12">
              <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
              <p className="text-lg font-semibold mb-2">Xatolik</p>
              <p className="text-muted-foreground mb-4">
                {expensesError instanceof Error ? expensesError.message : 'Xarajatlarni yuklab bo\'lmadi'}
              </p>
              <Button onClick={() => queryClient.invalidateQueries({ queryKey: ['expenses'] })} variant="outline">
                Qayta urinish
              </Button>
            </div>
          ) : !expenses || expenses.length === 0 ? (
            <div className="text-center py-12">
              <Wallet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Hozircha xarajatlar yo'q</p>
              <p className="text-sm text-muted-foreground mt-2">Birinchi xarajatni qo'shing</p>
              <Button onClick={handleCreate} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Yangi xarajat
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Xarajat raqami</TableHead>
                    <TableHead>Sana</TableHead>
                    <TableHead>Kategoriya</TableHead>
                    <TableHead>Izoh</TableHead>
                    <TableHead>To'lov usuli</TableHead>
                    <TableHead>Mas'ul xodim</TableHead>
                    <TableHead className="text-right">Summa</TableHead>
                    <TableHead className="text-right">Amallar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedExpenses.map((expense) => {
                    if (!expense || !expense.id) return null;
                    return (
                      <TableRow key={expense.id}>
                        <TableCell className="font-mono font-medium">
                          {expense.expense_number || '-'}
                        </TableCell>
                        <TableCell>
                          {expense.expense_date ? formatDate(expense.expense_date) : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{expense.category || 'Noma\'lum'}</Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {expense.note || '-'}
                        </TableCell>
                        <TableCell>
                          {getPaymentMethodLabel(expense.payment_method || 'cash')}
                        </TableCell>
                        <TableCell>
                          {expense.employee?.full_name || expense.employee?.username || '-'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoneyUZS(expense.amount || 0)}
                        </TableCell>
                        <TableCell className="text-right">
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

