import { useState, useEffect } from 'react';
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
import { getOrders, getProfiles } from '@/db/api';
import type { OrderWithDetails, Profile } from '@/types/database';
import { FileDown, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

export default function DailySalesReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [cashiers, setCashiers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [cashierFilter, setCashierFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo, cashierFilter, paymentFilter, statusFilter]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [ordersData, profilesData] = await Promise.all([
        getOrders(),
        getProfiles(),
      ]);
      
      let filtered = ordersData.filter((order) => {
        const orderDate = new Date(order.created_at).toISOString().split('T')[0];
        return orderDate >= dateFrom && orderDate <= dateTo;
      });

      if (cashierFilter !== 'all') {
        filtered = filtered.filter((order) => order.cashier_id === cashierFilter);
      }

      if (paymentFilter !== 'all') {
        filtered = filtered.filter((order) => {
          const payments = order.payments || [];
          if (paymentFilter === 'mixed') {
            return payments.length > 1;
          }
          return payments.some((p) => p.payment_method === paymentFilter);
        });
      }

      if (statusFilter !== 'all') {
        filtered = filtered.filter((order) => order.status === statusFilter);
      }

      setOrders(filtered);
      setCashiers(profilesData);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load sales data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const calculateProfit = (order: OrderWithDetails) => {
    const items = order.items || [];
    const totalCost = items.reduce((sum, item) => {
      const product = item.product;
      const cost = product?.purchase_price || 0;
      return sum + (cost * Number(item.quantity));
    }, 0);
    return Number(order.total_amount) - totalCost;
  };

  const getPaymentType = (order: OrderWithDetails) => {
    const payments = order.payments || [];
    if (payments.length === 0) return 'N/A';
    if (payments.length > 1) return 'Mixed';
    return payments[0].payment_method.charAt(0).toUpperCase() + payments[0].payment_method.slice(1);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      completed: { label: 'Completed', className: 'bg-success text-success-foreground' },
      returned: { label: 'Returned', className: 'bg-destructive text-destructive-foreground' },
      hold: { label: 'Hold', className: 'bg-warning text-warning-foreground' },
    };
    
    const config = statusConfig[status] || { label: status, className: '' };
    return <Badge className={config.className}>{config.label}</Badge>;
  };

  const totalSales = orders
    .filter((o) => o.status === 'completed')
    .reduce((sum, o) => sum + Number(o.total_amount), 0);
  
  const totalProfit = orders
    .filter((o) => o.status === 'completed')
    .reduce((sum, o) => sum + calculateProfit(o), 0);
  
  const totalReturns = orders
    .filter((o) => o.status === 'returned')
    .reduce((sum, o) => sum + Number(o.total_amount), 0);
  
  const completedOrders = orders.filter((o) => o.status === 'completed');
  const avgOrderValue = completedOrders.length > 0 
    ? totalSales / completedOrders.length 
    : 0;

  const handleExport = (format: 'excel' | 'pdf') => {
    toast({
      title: 'Export',
      description: `Exporting to ${format.toUpperCase()}...`,
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Daily Sales Report</h1>
            <p className="text-muted-foreground">Track daily sales performance and profit</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport('excel')}>
            <FileDown className="h-4 w-4 mr-2" />
            Excel
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')}>
            <FileDown className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Sales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalSales.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Profit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">${totalProfit.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Returns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">${totalReturns.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Order Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${avgOrderValue.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">From Date</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">To Date</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Cashier</label>
              <Select value={cashierFilter} onValueChange={setCashierFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Cashiers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Cashiers</SelectItem>
                  {cashiers.map((cashier) => (
                    <SelectItem key={cashier.id} value={cashier.id}>
                      {cashier.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Payment Type</label>
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="terminal">Terminal</SelectItem>
                  <SelectItem value="qr">QR</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="returned">Returned</SelectItem>
                  <SelectItem value="hold">Hold</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {orders.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No sales data found for the selected period</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice Number</TableHead>
                  <TableHead>Date/Time</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Payment Type</TableHead>
                  <TableHead className="text-right">Total Sale</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const profit = calculateProfit(order);
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.order_number}</TableCell>
                      <TableCell>
                        {format(new Date(order.created_at), 'MMM dd, yyyy HH:mm')}
                      </TableCell>
                      <TableCell>
                        {order.cashier?.username || order.cashier?.full_name || '-'}
                      </TableCell>
                      <TableCell>{getPaymentType(order)}</TableCell>
                      <TableCell className="text-right">
                        ${Number(order.total_amount).toFixed(2)}
                      </TableCell>
                      <TableCell className={`text-right ${profit >= 0 ? 'text-success' : 'text-destructive'}`}>
                        ${profit.toFixed(2)}
                      </TableCell>
                      <TableCell>{getStatusBadge(order.status)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
