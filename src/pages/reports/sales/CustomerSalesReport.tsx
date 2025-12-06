import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getOrders, getCustomers } from '@/db/api';
import type { OrderWithDetails, Customer } from '@/types/database';
import { FileDown, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

interface CustomerSalesData {
  customer_id: string;
  customer_name: string;
  total_purchases: number;
  order_count: number;
  average_order_value: number;
  outstanding_balance: number;
}

export default function CustomerSalesReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [customerSales, setCustomerSales] = useState<CustomerSalesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [ordersData, customersData] = await Promise.all([
        getOrders(),
        getCustomers(),
      ]);
      
      const filtered = ordersData.filter((order) => {
        const orderDate = new Date(order.created_at).toISOString().split('T')[0];
        return orderDate >= dateFrom && orderDate <= dateTo && order.status === 'completed';
      });

      const customerMap = new Map<string, CustomerSalesData>();

      filtered.forEach((order) => {
        const customerId = order.customer_id || 'walk-in';
        const customerName = order.customer?.name || 'Walk-in Customer';
        const existing = customerMap.get(customerId);
        
        const amount = Number(order.total_amount);

        if (existing) {
          existing.total_purchases += amount;
          existing.order_count += 1;
          existing.average_order_value = existing.total_purchases / existing.order_count;
        } else {
          const customer = customersData.find((c) => c.id === customerId);
          customerMap.set(customerId, {
            customer_id: customerId,
            customer_name: customerName,
            total_purchases: amount,
            order_count: 1,
            average_order_value: amount,
            outstanding_balance: customer ? Number(customer.balance || 0) : 0,
          });
        }
      });

      let salesData = Array.from(customerMap.values());
      salesData.sort((a, b) => b.total_purchases - a.total_purchases);

      setCustomerSales(salesData);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load customer sales data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredCustomers = customerSales.filter((customer) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return customer.customer_name.toLowerCase().includes(search);
  });

  const totalRevenue = customerSales.reduce((sum, c) => sum + c.total_purchases, 0);
  const totalOrders = customerSales.reduce((sum, c) => sum + c.order_count, 0);
  const totalOutstanding = customerSales.reduce((sum, c) => sum + c.outstanding_balance, 0);

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
            <h1 className="text-3xl font-bold">Customer Sales Report</h1>
            <p className="text-muted-foreground">Analyze customer purchase behavior and loyalty</p>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-bold">${totalRevenue.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Orders</p>
                <p className="text-2xl font-bold">{totalOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Outstanding Balance</p>
                <p className="text-2xl font-bold text-warning">${totalOutstanding.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <label className="text-sm text-muted-foreground">Search Customer</label>
              <Input
                placeholder="Search by customer name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filteredCustomers.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No customer sales data found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Total Purchases</TableHead>
                  <TableHead className="text-right">Number of Orders</TableHead>
                  <TableHead className="text-right">Avg Order Value</TableHead>
                  <TableHead className="text-right">Outstanding Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.map((customer) => (
                  <TableRow key={customer.customer_id}>
                    <TableCell className="font-medium">{customer.customer_name}</TableCell>
                    <TableCell className="text-right">${customer.total_purchases.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{customer.order_count}</TableCell>
                    <TableCell className="text-right">${customer.average_order_value.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      {customer.outstanding_balance > 0 ? (
                        <Badge className="bg-warning">${customer.outstanding_balance.toFixed(2)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">$0.00</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
