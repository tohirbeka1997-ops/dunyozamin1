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
import { getPurchaseOrders } from '@/db/api';
import type { PurchaseOrderWithDetails } from '@/types/database';
import { FileDown, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { formatMoneyUZS } from '@/lib/format';

export default function PurchaseOrderSummaryReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [orders, setOrders] = useState<PurchaseOrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo]);

  const loadData = async () => {
    try {
      setLoading(true);
      const ordersData = await getPurchaseOrders({
        date_from: dateFrom,
        date_to: dateTo,
      });

      setOrders(ordersData);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Xarid buyurtmalari hisobotini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      draft: { label: 'Qoralama', className: 'bg-muted text-muted-foreground' },
      approved: { label: 'Tasdiqlangan', className: 'bg-primary text-primary-foreground' },
      partially_received: { label: 'Qisman qabul qilingan', className: 'bg-warning text-warning-foreground' },
      received: { label: 'Qabul qilingan', className: 'bg-success text-success-foreground' },
      cancelled: { label: 'Bekor qilingan', className: 'bg-destructive text-destructive-foreground' },
    };
    
    const config = statusConfig[status] || { label: status, className: '' };
    return <Badge className={config.className}>{config.label}</Badge>;
  };

  const calculateReceivedAmount = (items: any[]) => {
    if (!items || items.length === 0) return 0;
    return items.reduce((sum, item) => {
      const receivedQty = Number(item.received_qty) || 0;
      const unitCost = Number(item.unit_cost) || 0;
      return sum + (receivedQty * unitCost);
    }, 0);
  };

  const totalOrdered = orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  const totalReceived = orders.reduce((sum, o) => sum + calculateReceivedAmount(o.items || []), 0);

  const handleExport = (format: 'excel' | 'pdf') => {
    toast({
      title: 'Eksport',
      description: `${format.toUpperCase()} ga eksport qilinmoqda...`,
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
            <h1 className="text-3xl font-bold">Xarid buyurtmalari umumiy hisobot</h1>
            <p className="text-muted-foreground">Xarid buyurtmalari haqida umumiy ma'lumot</p>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Jami buyurtma summasi</p>
                <p className="text-2xl font-bold">{formatMoneyUZS(totalOrdered)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Jami qabul qilingan summa</p>
                <p className="text-2xl font-bold text-success">{formatMoneyUZS(totalReceived)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {orders.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Xarid buyurtmalari topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyurtma raqami</TableHead>
                  <TableHead>Yetkazib beruvchi</TableHead>
                  <TableHead>Sana</TableHead>
                  <TableHead className="text-right">Buyurtma summasi</TableHead>
                  <TableHead className="text-right">Qabul qilingan summa</TableHead>
                  <TableHead>Holati</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const receivedAmount = calculateReceivedAmount(order.items || []);
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.po_number}</TableCell>
                      <TableCell>{order.supplier?.name || order.supplier_name || '-'}</TableCell>
                      <TableCell>
                        {format(new Date(order.order_date), 'MMM dd, yyyy')}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(order.total_amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(receivedAmount)}
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





