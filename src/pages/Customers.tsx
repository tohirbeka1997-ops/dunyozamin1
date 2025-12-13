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
import type { Customer } from '@/types/database';
import { Search, Plus, Eye, Edit, Trash2, Download, ArrowUpDown, DollarSign } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ReceivePaymentDialog from '@/components/customers/ReceivePaymentDialog';
import { formatMoneyUZS } from '@/lib/format';

export default function Customers() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [debtFilter, setDebtFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedCustomerForPayment, setSelectedCustomerForPayment] = useState<Customer | null>(null);

  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      const hasDebt = debtFilter === 'with_debt' ? true : debtFilter === 'no_debt' ? false : undefined;
      const data = await getCustomers({
        searchTerm: searchTerm || undefined,
        type: typeFilter,
        status: statusFilter,
        hasDebt,
        sortBy,
        sortOrder,
      });
      setCustomers(data);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Mijozlarni yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [searchTerm, typeFilter, statusFilter, debtFilter, sortBy, sortOrder, toast]);

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

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const getBalanceBadge = (balance: number) => {
    if (balance > 0) {
      return <Badge variant="destructive">{formatMoneyUZS(balance)} Qarz</Badge>;
    } else if (balance < 0) {
      return <Badge className="bg-success text-success-foreground">{formatMoneyUZS(Math.abs(balance))} Avans</Badge>;
    } else {
      return <Badge variant="outline">{formatMoneyUZS(0)}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    return status === 'active' ? (
      <Badge className="bg-success text-success-foreground">Faol</Badge>
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

  const handleExport = () => {
    toast({
      title: 'Eksport qilish',
      description: 'Eksport funksiyasi tez orada qo\'shiladi',
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Mijozlar</h1>
          <p className="text-muted-foreground">Mijozlar bazasini boshqarish</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Eksport qilish
          </Button>
          <Button onClick={() => navigate('/customers/new')}>
            <Plus className="h-4 w-4 mr-2" />
            Yangi mijoz qo'shish
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Ism, telefon yoki email bo'yicha qidirish..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Mijoz turi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha turlar</SelectItem>
                  <SelectItem value="individual">Jismoniy shaxs</SelectItem>
                  <SelectItem value="company">Yuridik shaxs</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Holati" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha holatlar</SelectItem>
                  <SelectItem value="active">Faol</SelectItem>
                  <SelectItem value="inactive">Faol emas</SelectItem>
                </SelectContent>
              </Select>

              <Select value={debtFilter} onValueChange={setDebtFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Balans" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha balanslar</SelectItem>
                  <SelectItem value="with_debt">Qarzdor</SelectItem>
                  <SelectItem value="no_debt">Qarz yo'q</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : customers.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Mijozlar topilmadi</p>
                <Button className="mt-4" onClick={() => navigate('/customers/new')}>
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
                  {customers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{customer.name}</p>
                          {customer.company_name && (
                            <p className="text-sm text-muted-foreground">{customer.company_name}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{customer.phone || '-'}</TableCell>
                      <TableCell>{getTypeBadge(customer.type)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoneyUZS(customer.total_sales)}
                      </TableCell>
                      <TableCell className="text-right">
                        {getBalanceBadge(Number(customer.balance))}
                      </TableCell>
                      <TableCell>
                        {customer.last_order_date
                          ? new Date(customer.last_order_date).toLocaleDateString()
                          : '-'}
                      </TableCell>
                      <TableCell>{getStatusBadge(customer.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Receive Payment button - only show if customer has debt */}
                          {customer.balance > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleReceivePayment(customer)}
                              className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            >
                              <DollarSign className="h-4 w-4 mr-1" />
                              To'lov qabul qilish
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/customers/${customer.id}`)}
                            title="Ko'rish"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/customers/${customer.id}/edit`)}
                            title="Tahrirlash"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" title="O'chirish">
                                <Trash2 className="h-4 w-4" />
                              </Button>
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
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Receive Payment Dialog */}
      {selectedCustomerForPayment && (
        <ReceivePaymentDialog
          open={paymentDialogOpen}
          onOpenChange={setPaymentDialogOpen}
          customer={selectedCustomerForPayment}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
}
