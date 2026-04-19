import { useState, useEffect, useMemo } from 'react';
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
import { formatMoneyUZS } from '@/lib/format';
import { formatDateYMD, todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useTableSort } from '@/hooks/useTableSort';
import { compareScalar } from '@/lib/tableSort';
import { SortableTableHead } from '@/components/reports/SortableTableHead';

interface CustomerSalesData {
  customer_id: string;
  customer_name: string;
  total_purchases: number;
  order_count: number;
  average_order_value: number;
  // Signed balance from customers table:
  // < 0 => debt (Qarz), > 0 => credit (Haq)
  balance: number;
}

const toNumber = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

type CustomerSalesSortKey =
  | 'customer_name'
  | 'total_purchases'
  | 'order_count'
  | 'average_order_value'
  | 'balance';

export default function CustomerSalesReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [customerSales, setCustomerSales] = useState<CustomerSalesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(todayYMD());
  const [dateTo, setDateTo] = useState(todayYMD());
  const [searchTerm, setSearchTerm] = useState('');
  const { sortKey, sortOrder, toggleSort } = useTableSort<CustomerSalesSortKey>(
    'total_purchases',
    'desc'
  );

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo]);

  async function loadData() {
    try {
      setLoading(true);
      const [ordersData, customersData] = await Promise.all([
        getOrders(),
        getCustomers(),
      ]);
      
      const filtered = ordersData.filter((order) => {
        const orderDate = formatDateYMD(order.created_at);
        return orderDate >= dateFrom && orderDate <= dateTo && order.status === 'completed';
      });

      const customerMap = new Map<string, CustomerSalesData>();

      filtered.forEach((order) => {
        const customerId = order.customer_id || 'walk-in';
        const customerFromList = order.customer_id
          ? customersData.find((c) => c.id === order.customer_id)
          : undefined;

        // Prefer real name from backend fields; avoid "Tasodifiy mijoz" placeholder.
        const customerName =
          order.customer?.name ||
          (order as any).customer_name ||
          customerFromList?.name ||
          (customerId === 'walk-in' || customerId === 'default-customer-001' ? 'Yangi mijoz' : 'Noma\'lum mijoz');

        const existing = customerMap.get(customerId);
        
        const amount = Number(order.total_amount);

        if (existing) {
          existing.total_purchases += amount;
          existing.order_count += 1;
          existing.average_order_value = existing.total_purchases / existing.order_count;
        } else {
          customerMap.set(customerId, {
            customer_id: customerId,
            customer_name: customerName,
            total_purchases: amount,
            order_count: 1,
            average_order_value: amount,
            balance: toNumber(customerFromList?.balance),
          });
        }
      });

      const salesData = Array.from(customerMap.values());
      setCustomerSales(salesData);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Mijozlar bo\'yicha sotuv ma\'lumotlarini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  const filteredCustomers = useMemo(() => {
    return customerSales.filter((customer) => {
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      return customer.customer_name.toLowerCase().includes(search);
    });
  }, [customerSales, searchTerm]);

  const sortedCustomers = useMemo(() => {
    const list = [...filteredCustomers];
    const key = sortKey;
    const ord = sortOrder;
    list.sort((a, b) => {
      switch (key) {
        case 'customer_name':
          return compareScalar(a.customer_name.toLowerCase(), b.customer_name.toLowerCase(), ord);
        case 'total_purchases':
          return compareScalar(a.total_purchases, b.total_purchases, ord);
        case 'order_count':
          return compareScalar(a.order_count, b.order_count, ord);
        case 'average_order_value':
          return compareScalar(a.average_order_value, b.average_order_value, ord);
        case 'balance':
          return compareScalar(a.balance, b.balance, ord);
        default:
          return 0;
      }
    });
    return list;
  }, [filteredCustomers, sortKey, sortOrder]);

  const totalRevenue = customerSales.reduce((sum, c) => sum + c.total_purchases, 0);
  const totalOrders = customerSales.reduce((sum, c) => sum + c.order_count, 0);
  const totalOutstanding = customerSales.reduce((sum, c) => sum + (c.balance < 0 ? Math.abs(c.balance) : 0), 0);

  const handleExport = (format: 'excel' | 'pdf') => {
    toast({
      title: 'Eksport',
      description: `${format.toUpperCase()} formatiga eksport qilinmoqda...`,
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
            <h1 className="text-3xl font-bold">Mijozlar bo'yicha sotuv hisobotlari</h1>
            <p className="text-muted-foreground">Mijozlarning xarid qilish odatlari va sodiqligini tahlil qilish</p>
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
                <p className="text-sm text-muted-foreground">Umumiy tushum</p>
                <p className="text-2xl font-bold">{formatMoneyUZS(totalRevenue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Umumiy buyurtmalar</p>
                <p className="text-2xl font-bold">{totalOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Qoldiq qarz</p>
                <p className="text-2xl font-bold text-warning">{formatMoneyUZS(totalOutstanding)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sanasi</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sanasi</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Mijozni qidirish</label>
              <Input
                placeholder="Mijoz ismi bo'yicha qidirish..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {sortedCustomers.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Mijozlar bo'yicha sotuv ma'lumotlari topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead<CustomerSalesSortKey>
                    columnKey="customer_name"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    Mijoz
                  </SortableTableHead>
                  <SortableTableHead<CustomerSalesSortKey>
                    columnKey="total_purchases"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Umumiy xarid summasi
                  </SortableTableHead>
                  <SortableTableHead<CustomerSalesSortKey>
                    columnKey="order_count"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Buyurtmalar soni
                  </SortableTableHead>
                  <SortableTableHead<CustomerSalesSortKey>
                    columnKey="average_order_value"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    O&apos;rtacha buyurtma qiymati
                  </SortableTableHead>
                  <SortableTableHead<CustomerSalesSortKey>
                    columnKey="balance"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Qoldiq qarz
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCustomers.map((customer) => (
                  <TableRow key={customer.customer_id}>
                    <TableCell className="font-medium">{customer.customer_name}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(customer.total_purchases)}</TableCell>
                    <TableCell className="text-right">{customer.order_count}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(customer.average_order_value)}</TableCell>
                    <TableCell className="text-right">
                      {customer.balance < 0 ? (
                        <Badge className="bg-destructive text-white">
                          {formatMoneyUZS(Math.abs(customer.balance))}
                        </Badge>
                      ) : customer.balance > 0 ? (
                        <Badge className="bg-success text-white">
                          {formatMoneyUZS(customer.balance)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">{formatMoneyUZS(0)}</span>
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
