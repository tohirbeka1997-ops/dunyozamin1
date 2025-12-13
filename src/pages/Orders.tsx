import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { getOrders, getProfiles, getCustomers, getSalesReturnByOrderId } from '@/db/api';
import type { OrderWithDetails, Profile, Customer } from '@/types/database';
import { Search, Eye, Printer, RotateCcw, DollarSign, ShoppingCart, TrendingUp } from 'lucide-react';
import { formatMoneyUZS } from '@/lib/format';
import PrintDialog from '@/components/print/PrintDialog';

export default function Orders() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [cashiers, setCashiers] = useState<Profile[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [cashierFilter, setCashierFilter] = useState('all');
  const [customerFilter, setCustomerFilter] = useState<string | null>(null); // Customer filter
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('all');
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedOrderForPrint, setSelectedOrderForPrint] = useState<OrderWithDetails | null>(null);
  const [returnLoadingOrderId, setReturnLoadingOrderId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    loadCustomers();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [ordersData, cashiersData] = await Promise.all([
        getOrders(),
        getProfiles(),
      ]);
      setOrders(ordersData);
      setCashiers(cashiersData);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Buyurtmalarni yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Load customers for filter dropdown
  const loadCustomers = async () => {
    try {
      setCustomersLoading(true);
      // Load only active customers
      const customersData = await getCustomers({
        status: 'active',
        sortBy: 'name',
        sortOrder: 'asc',
      });
      setCustomers(customersData);
    } catch (error) {
      console.error('Failed to load customers:', error);
      // Don't show toast, just log error and render disabled select
    } finally {
      setCustomersLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; className: string }> = {
      completed: { label: 'Yakunlangan', className: 'bg-success text-success-foreground' },
      pending: { label: 'Kutilmoqda', className: 'bg-primary text-primary-foreground' },
      voided: { label: 'Bekor qilingan', className: 'bg-muted text-muted-foreground' },
      refunded: { label: 'Qaytarilgan', className: 'bg-warning text-warning-foreground' },
    };
    const variant = variants[status] || variants.completed;
    return <Badge className={variant.className}>{variant.label}</Badge>;
  };

  const getPaymentStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
      paid: { label: 'To\'langan', variant: 'default' },
      partial: { label: 'Qisman to\'langan', variant: 'secondary' },
      unpaid: { label: 'To\'lanmagan', variant: 'destructive' },
    };
    const variant = variants[status] || variants.paid;
    return <Badge variant={variant.variant}>{variant.label}</Badge>;
  };

  const getPaymentMethodIcons = (order: OrderWithDetails) => {
    if (!order.payments || order.payments.length === 0) return '-';
    
    const methods = [...new Set(order.payments.map(p => p.payment_method))];
    
    if (methods.length > 1) {
      return <Badge variant="outline">Aralash to'lov</Badge>;
    }
    
    const method = methods[0];
    const icons: Record<string, string> = {
      cash: '💵',
      card: '💳',
      qr: '📱',
    };
    
    const labels: Record<string, string> = {
      cash: 'Naqd pul',
      card: 'Karta',
      qr: 'QR to\'lov',
    };
    
    return (
      <div className="flex items-center gap-1">
        <span>{icons[method] || '💰'}</span>
        <span className="text-sm">{labels[method] || method}</span>
      </div>
    );
  };

  // Memoize date filter function
  const filterOrdersByDate = useCallback((order: OrderWithDetails) => {
    if (dateFilter === 'all') return true;
    
    const orderDate = new Date(order.created_at);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (dateFilter === 'today') {
      return orderDate >= today;
    }
    
    if (dateFilter === 'week') {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return orderDate >= weekAgo;
    }
    
    if (dateFilter === 'month') {
      const monthAgo = new Date(today);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return orderDate >= monthAgo;
    }
    
    return true;
  }, [dateFilter]);

  // Memoize filtered orders to prevent recalculation on every render
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesSearch =
        searchTerm === '' ||
        order.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (order.customer?.name && order.customer.name.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesDate = filterOrdersByDate(order);
      const matchesCashier = cashierFilter === 'all' || order.cashier_id === cashierFilter;
      // Customer filter - match if no filter selected OR customer_id matches
      const matchesCustomer = !customerFilter || order.customer_id === customerFilter;
      const matchesPaymentStatus = paymentStatusFilter === 'all' || order.payment_status === paymentStatusFilter;
      const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
      
      const matchesPaymentMethod = paymentMethodFilter === 'all' || 
        (order.payments && order.payments.some(p => p.payment_method === paymentMethodFilter));

      return matchesSearch && matchesDate && matchesCashier && matchesCustomer && matchesPaymentStatus && matchesStatus && matchesPaymentMethod;
    });
  }, [orders, searchTerm, dateFilter, cashierFilter, customerFilter, paymentStatusFilter, statusFilter, paymentMethodFilter, filterOrdersByDate]);

  // Memoize stats calculation
  const stats = useMemo(() => {
    const totalSales = filteredOrders.reduce((sum, order) => sum + Number(order.total_amount), 0);
    const totalOrders = filteredOrders.length;
    const averageOrder = totalOrders > 0 ? totalSales / totalOrders : 0;
    return { totalSales, totalOrders, averageOrder };
  }, [filteredOrders]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Buyurtmalar</h1>
          <p className="text-muted-foreground">Barcha savdo buyurtmalarini ko'rish va boshqarish</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jami savdo</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoneyUZS(stats.totalSales)}</div>
            <p className="text-xs text-muted-foreground">Tanlangan davr bo'yicha umumiy tushum</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jami buyurtmalar</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalOrders}</div>
            <p className="text-xs text-muted-foreground">Qayta ishlangan buyurtmalar soni</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">O'rtacha buyurtma qiymati</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoneyUZS(stats.averageOrder)}</div>
            <p className="text-xs text-muted-foreground">Bir buyurtma uchun o'rtacha summa</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtrlar</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buyurtmalarni qidirish..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Sana oralig'i" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha vaqtlar</SelectItem>
                <SelectItem value="today">Bugun</SelectItem>
                <SelectItem value="week">Ushbu hafta</SelectItem>
                <SelectItem value="month">Ushbu oy</SelectItem>
              </SelectContent>
            </Select>

            <Select value={cashierFilter} onValueChange={setCashierFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Barcha kassirlar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha kassirlar</SelectItem>
                {cashiers.map((cashier) => (
                  <SelectItem key={cashier.id} value={cashier.id}>
                    {cashier.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Customer filter */}
            <Select
              value={customerFilter || 'all'}
              onValueChange={(value) => setCustomerFilter(value === 'all' ? null : value)}
              disabled={customersLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={customersLoading ? 'Yuklanmoqda...' : 'Barcha mijozlar'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha mijozlar</SelectItem>
                {customers.length === 0 && !customersLoading ? (
                  <SelectItem value="none" disabled>Mijozlar yuklanmadi</SelectItem>
                ) : (
                  customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            <Select value={paymentStatusFilter} onValueChange={setPaymentStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="To'lov holati" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha to'lov holatlari</SelectItem>
                <SelectItem value="paid">To'langan</SelectItem>
                <SelectItem value="partial">Qisman to'langan</SelectItem>
                <SelectItem value="unpaid">To'lanmagan</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Buyurtma holati" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha buyurtma holatlari</SelectItem>
                <SelectItem value="completed">Yakunlangan</SelectItem>
                <SelectItem value="pending">Kutilmoqda</SelectItem>
                <SelectItem value="voided">Bekor qilingan</SelectItem>
                <SelectItem value="refunded">Qaytarilgan</SelectItem>
              </SelectContent>
            </Select>

            <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
              <SelectTrigger>
                <SelectValue placeholder="To'lov usuli" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha to'lov usullari</SelectItem>
                <SelectItem value="cash">Naqd pul</SelectItem>
                <SelectItem value="card">Karta</SelectItem>
                <SelectItem value="qr">QR to'lov</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Buyurtmalar ({filteredOrders.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Buyurtmalar topilmadi</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Buyurtma raqami</TableHead>
                    <TableHead>Sana va vaqt</TableHead>
                    <TableHead>Kassir</TableHead>
                    <TableHead>Mijoz</TableHead>
                    <TableHead className="text-right">Jami summa</TableHead>
                    <TableHead>To'lov holati</TableHead>
                    <TableHead>To'lov usuli</TableHead>
                    <TableHead>Holati</TableHead>
                    <TableHead className="text-right">Amallar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono font-medium">
                        {order.order_number}
                      </TableCell>
                      <TableCell>
                        {new Date(order.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {order.cashier?.username || '-'}
                      </TableCell>
                      <TableCell>
                        {order.customer?.name || 'Yangi mijoz'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoneyUZS(order.total_amount)}
                      </TableCell>
                      <TableCell>
                        {getPaymentStatusBadge(order.payment_status)}
                      </TableCell>
                      <TableCell>
                        {getPaymentMethodIcons(order)}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(order.status)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/orders/${order.id}`)}
                            title="Tafsilotlarini ko'rish"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedOrderForPrint(order);
                              setPrintDialogOpen(true);
                            }}
                            title="Chek chiqarish"
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                          {order.status === 'completed' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={async () => {
                                try {
                                  setReturnLoadingOrderId(order.id);
                                  // Check if return already exists for this order
                                  const existingReturn = await getSalesReturnByOrderId(order.id);
                                  
                                  if (existingReturn) {
                                    // Return exists - navigate to return detail page
                                    navigate(`/returns/${existingReturn.id}`);
                                  } else {
                                    // No return exists - navigate to create return with orderId prefilled
                                    navigate(`/returns/create?orderId=${order.id}`);
                                  }
                                } catch (error) {
                                  const errorMessage = error instanceof Error ? error.message : 'Xatolik yuz berdi';
                                  toast({
                                    title: 'Xatolik',
                                    description: `Qaytarishni tekshirib bo'lmadi: ${errorMessage}`,
                                    variant: 'destructive',
                                    action: (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                          try {
                                            const existingReturn = await getSalesReturnByOrderId(order.id);
                                            if (existingReturn) {
                                              navigate(`/returns/${existingReturn.id}`);
                                            } else {
                                              navigate(`/returns/create?orderId=${order.id}`);
                                            }
                                          } catch (retryError) {
                                            toast({
                                              title: 'Xatolik',
                                              description: 'Qayta urinish muvaffaqiyatsiz',
                                              variant: 'destructive',
                                            });
                                          }
                                        }}
                                      >
                                        Qayta urinish
                                      </Button>
                                    ),
                                  });
                                } finally {
                                  setReturnLoadingOrderId(null);
                                }
                              }}
                              disabled={returnLoadingOrderId === order.id}
                              title="Qaytarish yaratish yoki ko'rish"
                            >
                              {returnLoadingOrderId === order.id ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                              ) : (
                                <RotateCcw className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Print Dialog */}
      {selectedOrderForPrint && (
        <PrintDialog
          open={printDialogOpen}
          onOpenChange={setPrintDialogOpen}
          orderId={selectedOrderForPrint.id}
          order={selectedOrderForPrint}
        />
      )}
    </div>
  );
}
