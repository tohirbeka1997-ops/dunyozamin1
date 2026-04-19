import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getSuppliers, getPurchaseOrders } from '@/db/api';
import type { Supplier, PurchaseOrderWithDetails } from '@/types/database';
import { FileDown, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { formatMoneyUZS } from '@/lib/format';
import { todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useTableSort } from '@/hooks/useTableSort';
import { compareScalar } from '@/lib/tableSort';
import { SortableTableHead } from '@/components/reports/SortableTableHead';

interface SupplierPerformance {
  supplier_id: string;
  supplier_name: string;
  total_orders: number;
  total_amount: number;
  average_order_value: number;
}

type SupplierPerfSortKey =
  | 'supplier_name'
  | 'total_orders'
  | 'total_amount'
  | 'average_order_value';

export default function SupplierPerformanceReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [performance, setPerformance] = useState<SupplierPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(todayYMD());
  const [dateTo, setDateTo] = useState(todayYMD());
  const [searchTerm, setSearchTerm] = useState('');
  const { sortKey, sortOrder, toggleSort } = useTableSort<SupplierPerfSortKey>(
    'total_amount',
    'desc'
  );

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo]);

  async function loadData() {
    try {
      setLoading(true);
      const [suppliersData, ordersData] = await Promise.all([
        getSuppliers(true),
        getPurchaseOrders({
          date_from: dateFrom,
          date_to: dateTo,
        }),
      ]);

      const supplierMap = new Map<string, SupplierPerformance>();

      ordersData.forEach((order) => {
        const supplierId = order.supplier_id || 'unknown';
        const existing = supplierMap.get(supplierId);
        const amount = Number(order.total_amount || 0);

        if (existing) {
          existing.total_orders += 1;
          existing.total_amount += amount;
          existing.average_order_value = existing.total_amount / existing.total_orders;
        } else {
          const supplier = suppliersData.find((s) => s.id === supplierId);
          supplierMap.set(supplierId, {
            supplier_id: supplierId,
            supplier_name: supplier?.name || order.supplier_name || 'Noma\'lum',
            total_orders: 1,
            total_amount: amount,
            average_order_value: amount,
          });
        }
      });

      const performanceData = Array.from(supplierMap.values());
      setPerformance(performanceData);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Yetkazib beruvchilar samaradorligi ma\'lumotlarini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  const filteredSuppliers = useMemo(() => {
    return performance.filter((supplier) => {
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      return supplier.supplier_name.toLowerCase().includes(search);
    });
  }, [performance, searchTerm]);

  const sortedSuppliers = useMemo(() => {
    const list = [...filteredSuppliers];
    const key = sortKey;
    const ord = sortOrder;
    list.sort((a, b) => {
      switch (key) {
        case 'supplier_name':
          return compareScalar(a.supplier_name.toLowerCase(), b.supplier_name.toLowerCase(), ord);
        case 'total_orders':
          return compareScalar(a.total_orders, b.total_orders, ord);
        case 'total_amount':
          return compareScalar(a.total_amount, b.total_amount, ord);
        case 'average_order_value':
          return compareScalar(a.average_order_value, b.average_order_value, ord);
        default:
          return 0;
      }
    });
    return list;
  }, [filteredSuppliers, sortKey, sortOrder]);

  const totalOrders = performance.reduce((sum, p) => sum + p.total_orders, 0);
  const totalAmount = performance.reduce((sum, p) => sum + p.total_amount, 0);

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
            <h1 className="text-3xl font-bold">Yetkazib beruvchilar samaradorligi</h1>
            <p className="text-muted-foreground">Yetkazib beruvchilarning xaridlar bo'yicha samaradorligini tahlil qilish</p>
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
                <p className="text-sm text-muted-foreground">Jami buyurtmalar</p>
                <p className="text-2xl font-bold">{totalOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Jami summa</p>
                <p className="text-2xl font-bold">{formatMoneyUZS(totalAmount)}</p>
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
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Yetkazib beruvchi nomi bo'yicha qidirish..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {sortedSuppliers.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Yetkazib beruvchilar samaradorligi ma'lumotlari topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead<SupplierPerfSortKey>
                    columnKey="supplier_name"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    Yetkazib beruvchi
                  </SortableTableHead>
                  <SortableTableHead<SupplierPerfSortKey>
                    columnKey="total_orders"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Buyurtmalar soni
                  </SortableTableHead>
                  <SortableTableHead<SupplierPerfSortKey>
                    columnKey="total_amount"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Jami summa
                  </SortableTableHead>
                  <SortableTableHead<SupplierPerfSortKey>
                    columnKey="average_order_value"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    O&apos;rtacha buyurtma qiymati
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSuppliers.map((supplier) => (
                  <TableRow key={supplier.supplier_id}>
                    <TableCell className="font-medium">{supplier.supplier_name}</TableCell>
                    <TableCell className="text-right">{supplier.total_orders}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(supplier.total_amount)}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(supplier.average_order_value)}</TableCell>
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





