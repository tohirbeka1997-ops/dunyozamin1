import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Search, Plus, Eye, Edit, Trash2, Download, ArrowUpDown, DollarSign, MoreVertical, AlertTriangle } from 'lucide-react';
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
    trackedKeys: ['search', 'type', 'status', 'sortBy', 'sortOrder'],
  });
  const searchTerm = searchParams.get('search') || '';
  const debouncedSearchTerm = useDebounce(searchTerm, 200);
  const typeFilter = searchParams.get('type') || 'all';
  const statusFilter = searchParams.get('status') || 'all';
  const sortBy = (searchParams.get('sortBy') || 'created_at') as 'created_at' | 'balance' | 'last_order_date' | 'total_sales' | 'name';
  const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';
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

  const getStatusBadge = (status: string) => {
    return status === 'active' ? (
      <Badge className="bg-success text-white">Faol</Badge>
    ) : (
      <Badge variant="outline">Faol emas</Badge>
    );
  };

  const getTypeBadge = (type: string) => {
    return type === 'company' ? (
      <Badge variant="secondary">Yuridik shaxs</Badge>
    ) : (
      <Badge variant="outline">Jismoniy shaxs</Badge>
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Mijozlar</h1>
          <p className="text-muted-foreground">Mijozlar bazasini boshqarish</p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            onClick={handleExport}
            disabled={exporting || loading}
          >
            {exporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                Eksportlanmoqda...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Eksport qilish
              </>
            )}
          </Button>
          <Button onClick={() => navigate('/customers/new', { state: createBackNavigationState(location) })}>
            <Plus className="h-4 w-4 mr-2" />
            Yangi mijoz qo'shish
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {/* Search and Filters */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Ism, telefon yoki email bo'yicha qidirish..."
                  value={searchTerm}
                  onChange={(e) => updateParams({ search: e.target.value })}
                  className="pl-9"
                />
              </div>

              <Select value={typeFilter} onValueChange={(value) => updateParams({ type: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Mijoz turi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha turlar</SelectItem>
                  <SelectItem value="individual">Jismoniy shaxs</SelectItem>
                  <SelectItem value="company">Yuridik shaxs</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={(value) => updateParams({ status: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Holati" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha holatlar</SelectItem>
                  <SelectItem value="active">Faol</SelectItem>
                  <SelectItem value="inactive">Faol emas</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={(value) => updateParams({ sortBy: value })}>
                <SelectTrigger>
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

            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : error ? (
              <div className="text-center py-12">
                <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
                <p className="text-lg font-semibold mb-2">Xatolik</p>
                <p className="text-muted-foreground mb-4">
                  {error.message || 'Mijozlarni yuklab bo\'lmadi'}
                </p>
                <Button onClick={() => loadCustomers()} variant="outline">
                  Qayta urinish
                </Button>
              </div>
            ) : customers.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Mijozlar topilmadi</p>
                <Button
                  className="mt-4"
                  onClick={() => navigate('/customers/new', { state: createBackNavigationState(location) })}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Birinchi mijozni qo'shish
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Button variant="ghost" size="sm" onClick={() => handleSort('name')}>
                        Ismi
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead>Telefon</TableHead>
                    <TableHead>Mijoz turi</TableHead>
                    <TableHead className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleSort('total_sales')}>
                        Jami savdo
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleSort('balance')}>
                        Balans
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead>
                      <Button variant="ghost" size="sm" onClick={() => handleSort('last_order_date')}>
                        Oxirgi buyurtma
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead>Holati</TableHead>
                    <TableHead className="text-right">Amallar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer) => {
                    const balanceInfo = formatCustomerBalance(customer.balance);
                    const hasDebt = (customer.balance || 0) < 0;
                    
                    // Handle row click to navigate to customer details
                    // Route: /customers/:id (as defined in src/routes.tsx)
                    const handleRowClick = () => {
                      navigate(`/customers/${customer.id}`, {
                        state: createBackNavigationState(location),
                      });
                    };
                    
                    // Prevent row click when clicking on action menu
                    const handleActionClick = (e: React.MouseEvent) => {
                      e.stopPropagation();
                    };
                    
                    return (
                      <TableRow 
                        key={customer.id}
                        onClick={handleRowClick}
                        className="cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {debouncedSearchTerm ? highlightMatch(customer.name, debouncedSearchTerm) : customer.name}
                            </p>
                            {customer.company_name && (
                              <p className="text-sm text-muted-foreground">{customer.company_name}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {customer.phone
                            ? (debouncedSearchTerm ? highlightMatch(customer.phone, debouncedSearchTerm) : customer.phone)
                            : '-'}
                        </TableCell>
                        <TableCell>{getTypeBadge(customer.type)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoneyUZS(customer.total_sales)}
                        </TableCell>
                        <TableCell className="text-right">
                          {/* SINGLE SOURCE OF TRUTH - No duplicate badges */}
                          <Badge variant={balanceInfo.variant} className={balanceInfo.type === 'balance' ? 'bg-green-600 text-white hover:bg-green-700' : ''}>
                            {balanceInfo.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {customer.last_order_date
                            ? formatDate(customer.last_order_date)
                            : '-'}
                        </TableCell>
                        <TableCell>{getStatusBadge(customer.status)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2" onClick={handleActionClick}>
                            {/* Primary action: Receive Payment button for customers with debt */}
                            {hasDebt && (
                              <Button
                                variant="default"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleReceivePayment(customer);
                                }}
                                className="bg-green-600 hover:bg-green-700 text-white"
                              >
                                <DollarSign className="h-4 w-4 mr-1" />
                                Qarz to'lovini qabul qilish
                              </Button>
                            )}
                            
                            {/* Secondary actions in dropdown menu */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  onClick={handleActionClick}
                                >
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
            )}
          </div>
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
