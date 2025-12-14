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
import { formatMoneyUZS } from '@/lib/format';
import { exportDailySalesToExcel, exportDailySalesToPDF } from '@/lib/export';

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
  const [isExporting, setIsExporting] = useState(false);

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
        title: 'Xatolik',
        description: 'Sotuv ma\'lumotlarini yuklab bo\'lmadi',
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
      completed: { label: 'Tugallangan', className: 'bg-success text-success-foreground' },
      returned: { label: 'Qaytarilgan', className: 'bg-destructive text-destructive-foreground' },
      hold: { label: 'Kutilmoqda', className: 'bg-warning text-warning-foreground' },
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

  const handleExport = async (format: 'excel' | 'pdf') => {
    if (orders.length === 0) {
      toast({
        title: 'Xatolik',
        description: 'Eksport qilish uchun ma\'lumot yo\'q',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsExporting(true);

      // Prepare data for export
      const exportData = orders.map((order) => ({
        order_number: order.order_number,
        created_at: order.created_at,
        cashier: order.cashier,
        payment_type: getPaymentType(order),
        total_amount: order.total_amount,
        profit: calculateProfit(order),
        status: order.status,
      }));

      const filters = {
        dateFrom,
        dateTo,
        cashierFilter,
        paymentFilter,
        statusFilter,
      };

      const summary = {
        totalSales,
        totalProfit,
        totalReturns,
        avgOrderValue,
      };

      if (format === 'excel') {
        await exportDailySalesToExcel(exportData, filters, summary, cashiers);
      } else {
        await exportDailySalesToPDF(exportData, filters, summary, cashiers);
      }

      toast({
        title: 'Muvaffaqiyatli',
        description: `${format.toUpperCase()} formatida eksport qilindi`,
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Xatolik',
        description: 'Eksportda xatolik yuz berdi',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
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
            <h1 className="text-3xl font-bold">Kunlik sotuv hisobotlari</h1>
            <p className="text-muted-foreground">Kunlik sotuvlar samaradorligi va foydasini kuzatish</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={() => handleExport('excel')}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2" />
                Yuklanmoqda...
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4 mr-2" />
                Excel
              </>
            )}
          </Button>
          <Button 
            variant="outline" 
            onClick={() => handleExport('pdf')}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2" />
                Yuklanmoqda...
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4 mr-2" />
                PDF
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Jami sotuv
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoneyUZS(totalSales)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Jami foyda
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{formatMoneyUZS(totalProfit)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Qaytarilganlar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{formatMoneyUZS(totalReturns)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              O'rtacha buyurtma qiymati
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoneyUZS(avgOrderValue)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
              <label className="text-sm text-muted-foreground">Kassir</label>
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
            </div>
            <div>
              <label className="text-sm text-muted-foreground">To'lov turi</label>
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Barcha turlar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha turlar</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="terminal">Terminal</SelectItem>
                  <SelectItem value="qr">QR</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Holati</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Barcha holatlar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha holatlar</SelectItem>
                  <SelectItem value="completed">Tugallangan</SelectItem>
                  <SelectItem value="returned">Qaytarilgan</SelectItem>
                  <SelectItem value="hold">Kutilmoqda</SelectItem>
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
              <p className="text-muted-foreground">Tanlangan davr uchun sotuv ma'lumotlari topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hisob-faktura raqami</TableHead>
                  <TableHead>Sana / Vaqt</TableHead>
                  <TableHead>Kassir</TableHead>
                  <TableHead>To'lov turi</TableHead>
                  <TableHead className="text-right">Jami sotuv</TableHead>
                  <TableHead className="text-right">Foyda</TableHead>
                  <TableHead>Holat</TableHead>
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
                        {formatMoneyUZS(order.total_amount)}
                      </TableCell>
                      <TableCell className={`text-right ${profit >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {formatMoneyUZS(profit)}
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
