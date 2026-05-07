import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { getCustomers, deleteCustomer } from '@/db/api';
import { useAuth } from '@/contexts/AuthContext';
import type { Customer } from '@/types/database';
import {
  Search,
  Plus,
  Eye,
  Edit,
  Trash2,
  Download,
  ArrowUpDown,
  DollarSign,
  MoreVertical,
  AlertTriangle,
  Users,
} from 'lucide-react';
import { highlightMatch } from '@/utils/searchHighlight';
import { useToast } from '@/hooks/use-toast';
import ReceivePaymentModal from '@/components/customers/ReceivePaymentModal';
import { formatMoneyUZS, formatCustomerBalance } from '@/lib/format';
import { useDebounce } from '@/hooks/use-debounce';
import { formatDate } from '@/lib/datetime';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import { createBackNavigationState } from '@/lib/pageState';

export default function Customers() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { updateParams, searchParams } = useSessionSearchParams({
    storageKey: 'customers.filters.query',
    trackedKeys: ['search', 'type', 'status', 'sortBy', 'sortOrder', 'page', 'pageSize'],
  });
  const searchTerm = searchParams.get('search') || '';
  const debouncedSearchTerm = useDebounce(searchTerm, 200);
  const typeFilter = searchParams.get('type') || 'all';
  const statusFilter = searchParams.get('status') || 'all';
  const sortBy = (searchParams.get('sortBy') || 'created_at') as 'created_at' | 'balance' | 'last_order_date' | 'total_sales' | 'name';
  const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';
  const page = Math.max(0, Number(searchParams.get('page') || 0) || 0);
  const pageSizeRaw = Number(searchParams.get('pageSize') || 50) || 50;
  const pageSize = [25, 50, 100].includes(pageSizeRaw) ? pageSizeRaw : 50;
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedCustomerForPayment, setSelectedCustomerForPayment] = useState<Customer | null>(null);
  const [exporting, setExporting] = useState(false);

  const loadCustomers = useCallback(async () => {
    // Don't load if auth is still loading or user is not authenticated
    if (authLoading || !user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const data = await getCustomers({
        searchTerm: debouncedSearchTerm || undefined,
        type: typeFilter,
        status: statusFilter,
        hasDebt: undefined, // No balance filter - show all
        sortBy,
        sortOrder,
      });
      
      // Client-side sorting for balance (biggest debt first)
      let filteredData = data;
      if (sortBy === 'balance') {
        filteredData = [...filteredData].sort((a, b) => {
          const balanceA = Number(a.balance || 0);
          const balanceB = Number(b.balance || 0);
          if (sortOrder === 'desc') {
            // Biggest debt first (most negative)
            return balanceA - balanceB;
          } else {
            return balanceB - balanceA;
          }
        });
      }
      
      setCustomers(filteredData);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Mijozlarni yuklab bo‘lmadi');
      console.error('Error loading customers:', error);
      setError(error);
      toast({
        title: 'Xatolik',
        description: error.message || 'Mijozlarni yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [debouncedSearchTerm, typeFilter, statusFilter, sortBy, sortOrder, toast, authLoading, user]);

  // Load customers on mount and when filters change
  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    updateParams({ page: '0' });
  }, [debouncedSearchTerm, typeFilter, statusFilter, sortBy, sortOrder, pageSize]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(customers.length / pageSize) - 1);
    if (page > maxPage) updateParams({ page: String(maxPage) });
  }, [customers.length, pageSize, page]);

  // Reload customers when navigating to this page (e.g., after creating a customer)
  useEffect(() => {
    if (location.pathname === '/customers') {
      loadCustomers();
    }
  }, [location.pathname, loadCustomers]);

  const handleDelete = async (id: string, name: string) => {
    try {
      await deleteCustomer(id);
      toast({
        title: 'Muvaffaqiyatli',
        description: `"${name}" muvaffaqiyatli o'chirildi`,
      });
      loadCustomers();
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Mijozni o\'chirib bo\'lmadi',
        variant: 'destructive',
      });
    }
  };

  const handleReceivePayment = (customer: Customer) => {
    setSelectedCustomerForPayment(customer);
    setPaymentDialogOpen(true);
  };

  const handlePaymentSuccess = () => {
    loadCustomers(); // Refresh customer list to show updated balance
  };

  const handleSort = (field: 'created_at' | 'balance' | 'last_order_date' | 'total_sales' | 'name') => {
    if (sortBy === field) {
      updateParams({ sortOrder: sortOrder === 'asc' ? 'desc' : 'asc' });
    } else {
      updateParams({ sortBy: field, sortOrder: 'desc' });
    }
  };

  const totalPages = Math.max(1, Math.ceil(customers.length / pageSize));
  const pagedCustomers = customers.slice(page * pageSize, page * pageSize + pageSize);

  const getStatusBadge = (status: string) => {
    return status === 'active' ? (
      <Badge className="bg-success px-1.5 py-0 text-[10px] font-normal text-white sm:text-xs">
        Faol
      </Badge>
    ) : (
      <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal sm:text-xs">
        Faol emas
      </Badge>
    );
  };

  const getTypeBadge = (type: string) => {
    return type === 'company' ? (
      <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal sm:text-xs">
        Yuridik shaxs
      </Badge>
    ) : (
      <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal sm:text-xs">
        Jismoniy shaxs
      </Badge>
    );
  };

  const handleExport = async () => {
    try {
      setExporting(true);
      
      // Prepare filters from current state
      const filters = {
        searchTerm: debouncedSearchTerm || undefined,
        type: typeFilter !== 'all' ? typeFilter : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        sortBy,
        sortOrder,
      };

      // Check if window.posApi exists (Electron)
      if (typeof window !== 'undefined' && (window as any).posApi?.customers?.exportCsv) {
        const result = await (window as any).posApi.customers.exportCsv(filters);
        
        if (result.cancelled) {
          // User cancelled, no toast needed
          return;
        }

        if (result.count !== undefined && result.count > 0) {
          toast({
            title: 'Muvaffaqiyatli',
            description: `Eksport qilindi: ${result.count} ta mijoz${result.path ? `\n${result.path}` : ''}`,
          });
        } else {
          toast({
            title: 'Ogohlantirish',
            description: 'Eksport qilish uchun mijozlar topilmadi',
            variant: 'destructive',
          });
        }
      } else {
        // Fallback for web mode (not implemented)
        toast({
          title: 'Xatolik',
          description: 'Eksport funksiyasi faqat desktop versiyada mavjud',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Eksportda xatolik yuz berdi',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">Mijozlar</h1>
          <p className="page-heading-sub">Mijozlar bazasini boshqarish</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={handleExport}
            disabled={exporting || loading}
          >
            {exporting ? (
              <>
                <div className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Eksportlanmoqda...
              </>
            ) : (
              <>
                <Download className="mr-2 h-3.5 w-3.5" />
                Eksport qilish
              </>
            )}
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => navigate('/customers/new', { state: createBackNavigationState(location) })}
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            Yangi mijoz qo'shish
          </Button>
        </div>
      </div>

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="px-3 py-2 sm:px-3">
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <span className="mb-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Filtrlar
            </span>
            <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
              <div className="relative h-8 min-w-0 flex-1 lg:min-w-[14rem] lg:max-w-md">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Ism, telefon yoki email bo'yicha qidirish..."
                  value={searchTerm}
                  onChange={(e) => updateParams({ search: e.target.value })}
                  className="h-8 py-1 pl-8 text-xs sm:text-sm"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:flex-[2]">
                <div className="min-w-[10rem] flex-1 sm:max-w-[13rem]">
                  <Select value={typeFilter} onValueChange={(value) => updateParams({ type: value })}>
                    <SelectTrigger className="h-8 w-full bg-background text-xs [&_span]:truncate">
                      <SelectValue placeholder="Mijoz turi" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Barcha turlar</SelectItem>
                      <SelectItem value="individual">Jismoniy shaxs</SelectItem>
                      <SelectItem value="company">Yuridik shaxs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[10rem] flex-1 sm:max-w-[13rem]">
                  <Select value={statusFilter} onValueChange={(value) => updateParams({ status: value })}>
                    <SelectTrigger className="h-8 w-full bg-background text-xs [&_span]:truncate">
                      <SelectValue placeholder="Holati" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Barcha holatlar</SelectItem>
                      <SelectItem value="active">Faol</SelectItem>
                      <SelectItem value="inactive">Faol emas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[10rem] flex-1 sm:max-w-[13rem]">
                  <Select value={sortBy} onValueChange={(value) => updateParams({ sortBy: value })}>
                    <SelectTrigger className="h-8 w-full bg-background text-xs [&_span]:truncate">
                      <SelectValue placeholder="Tartiblash" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="created_at">Yangi</SelectItem>
                      <SelectItem value="balance">Eng katta qarz</SelectItem>
                      <SelectItem value="last_order_date">Oxirgi buyurtma</SelectItem>
                      <SelectItem value="total_sales">Jami savdo</SelectItem>
                      <SelectItem value="name">Ism</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b px-4 py-2 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">Mijozlar ro&apos;yxati</span>
            {!loading && !error && (
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                ({customers.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-3 pt-0">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : error ? (
            <div className="mx-4 my-8 rounded-lg border bg-muted/20 py-10 text-center">
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive" />
              <p className="mb-1 font-semibold">Xatolik</p>
              <p className="mb-4 text-sm text-muted-foreground">
                {error.message || "Mijozlarni yuklab bo'lmadi"}
              </p>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => loadCustomers()}>
                Qayta urinish
              </Button>
            </div>
          ) : customers.length === 0 ? (
            <div className="mx-4 my-8 rounded-lg border bg-muted/20 py-10 text-center">
              <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">Mijozlar topilmadi</p>
              <Button
                size="sm"
                className="mt-4 h-8 text-xs"
                onClick={() => navigate('/customers/new', { state: createBackNavigationState(location) })}
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Birinchi mijozni qo'shish
              </Button>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="whitespace-nowrap text-xs font-semibold sm:text-sm">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-2 h-8 gap-1 px-2 text-xs font-semibold"
                        onClick={() => handleSort('name')}
                      >
                        Ismi
                        <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Telefon</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Mijoz turi</TableHead>
                    <TableHead className="text-right text-xs font-semibold sm:text-sm">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-mr-2 ml-auto h-8 gap-1 px-2 text-xs font-semibold"
                        onClick={() => handleSort('total_sales')}
                      >
                        Jami savdo
                        <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold sm:text-sm">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-mr-2 ml-auto h-8 gap-1 px-2 text-xs font-semibold"
                        onClick={() => handleSort('balance')}
                      >
                        Balans
                        <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      </Button>
                    </TableHead>
                    <TableHead className="whitespace-nowrap text-xs font-semibold sm:text-sm">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-2 h-8 gap-1 px-2 text-xs font-semibold"
                        onClick={() => handleSort('last_order_date')}
                      >
                        Oxirgi buyurtma
                        <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Holati</TableHead>
                    <TableHead className="w-[1%] text-right text-xs font-semibold sm:text-sm">Amallar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedCustomers.map((customer) => {
                    const balanceInfo = formatCustomerBalance(customer.balance);
                    const hasDebt = (customer.balance || 0) < 0;

                    const handleRowClick = () => {
                      navigate(`/customers/${customer.id}`, {
                        state: createBackNavigationState(location),
                      });
                    };

                    const handleActionClick = (e: React.MouseEvent) => {
                      e.stopPropagation();
                    };

                    return (
                      <TableRow
                        key={customer.id}
                        onClick={handleRowClick}
                        className="cursor-pointer text-sm hover:bg-muted/50"
                      >
                        <TableCell className="max-w-[14rem] py-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {debouncedSearchTerm ? highlightMatch(customer.name, debouncedSearchTerm) : customer.name}
                            </p>
                            {customer.company_name && (
                              <p className="truncate text-xs text-muted-foreground">{customer.company_name}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[9rem] truncate py-2 text-xs">
                          {customer.phone
                            ? debouncedSearchTerm
                              ? highlightMatch(customer.phone, debouncedSearchTerm)
                              : customer.phone
                            : '-'}
                        </TableCell>
                        <TableCell className="py-2">{getTypeBadge(customer.type)}</TableCell>
                        <TableCell className="py-2 text-right text-xs tabular-nums font-medium">
                          {formatMoneyUZS(customer.total_sales)}
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          <Badge
                            variant={balanceInfo.variant}
                            className={`px-1.5 py-0 text-[10px] font-normal sm:text-xs ${
                              balanceInfo.type === 'balance' ? 'bg-green-600 text-white hover:bg-green-700' : ''
                            }`}
                          >
                            {balanceInfo.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                          {customer.last_order_date ? formatDate(customer.last_order_date) : '-'}
                        </TableCell>
                        <TableCell className="py-2">{getStatusBadge(customer.status)}</TableCell>
                        <TableCell className="py-2 text-right">
                          <div className="flex items-center justify-end gap-1" onClick={handleActionClick}>
                            {hasDebt && (
                              <Button
                                variant="default"
                                size="sm"
                                title="Qarz to'lovini qabul qilish"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleReceivePayment(customer);
                                }}
                                className="h-8 shrink-0 gap-1 bg-green-600 px-2 text-xs text-white hover:bg-green-700"
                              >
                                <DollarSign className="h-3.5 w-3.5 shrink-0" />
                                <span className="hidden sm:inline">Qarz to'lovini qabul qilish</span>
                                <span className="sm:hidden">To&apos;lov</span>
                              </Button>
                            )}

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleActionClick}>
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" onClick={handleActionClick}>
                                {/* Debt payment option in menu (backup) */}
                                {hasDebt && (
                                  <>
                                    <DropdownMenuItem 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleReceivePayment(customer);
                                      }}
                                    >
                                      <DollarSign className="h-4 w-4 mr-2" />
                                      Qarz to'lovini qabul qilish
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                  </>
                                )}
                                <DropdownMenuItem 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/customers/${customer.id}`, {
                                      state: createBackNavigationState(location),
                                    });
                                  }}
                                >
                                  <Eye className="h-4 w-4 mr-2" />
                                  Ko'rish
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/customers/${customer.id}/edit`, {
                                      state: createBackNavigationState(location),
                                    });
                                  }}
                                >
                                  <Edit className="h-4 w-4 mr-2" />
                                  Tahrirlash
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem 
                                      onSelect={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      O'chirish
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Mijozni o'chirish?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        "{customer.name}" ni o'chirishni xohlaysizmi? Agar bu mijozning buyurtmalari bo'lsa, ular faol emas deb belgilanadi.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Bekor qilish</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => handleDelete(customer.id, customer.name)}
                                      >
                                        O'chirish
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between px-4 pt-3">
              <div className="text-xs text-muted-foreground">
                Jami: {customers.length} ta • Sahifa {page + 1} / {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => updateParams({ pageSize: String(Number(v) || 50), page: '0' })}
                >
                  <SelectTrigger className="h-8 w-[100px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25 / sahifa</SelectItem>
                    <SelectItem value="50">50 / sahifa</SelectItem>
                    <SelectItem value="100">100 / sahifa</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => updateParams({ page: String(Math.max(0, page - 1)) })}
                  disabled={page <= 0}
                >
                  Oldingi
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => updateParams({ page: String(Math.min(totalPages - 1, page + 1)) })}
                  disabled={page >= totalPages - 1}
                >
                  Keyingi
                </Button>
              </div>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Receive Payment Modal */}
      <ReceivePaymentModal
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        customer={selectedCustomerForPayment}
        source="customers"
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
}
