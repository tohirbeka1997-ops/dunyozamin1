import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { isElectron } from '@/utils/electron';
import { todayYMD } from '@/lib/datetime';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { getSupplierProductSales, getSuppliers } from '@/db/api';
import type { SupplierWithBalance } from '@/types/database';
import type { SupplierProductSalesRow } from '@/types/financialReports';

export default function SupplierProductSalesReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [dateFrom, setDateFrom] = useState(todayYMD());
  const [dateTo, setDateTo] = useState(todayYMD());
  const [supplierId, setSupplierId] = useState<string>('all');
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SupplierProductSalesRow[]>([]);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadSuppliers();
  }, []);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, supplierId]);

  async function loadSuppliers() {
    try {
      const data = await getSuppliers(true);
      setSuppliers(Array.isArray(data) ? data : []);
    } catch {
      setSuppliers([]);
    }
  }

  async function loadData() {
    try {
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }
      setLoading(true);
      const data = await getSupplierProductSales({
        date_from: dateFrom,
        date_to: dateTo,
        supplier_id: supplierId !== 'all' ? supplierId : undefined,
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('[SupplierProductSalesReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  const summary = useMemo(() => {
    const sold = rows.reduce((sum, r) => sum + Number(r.sold_qty || 0), 0);
    const sales = rows.reduce((sum, r) => sum + Number(r.sales_amount_uzs || 0), 0);
    const cogs = rows.reduce((sum, r) => sum + Number(r.cogs_uzs || 0), 0);
    const profit = rows.reduce((sum, r) => sum + Number(r.gross_profit_uzs || 0), 0);
    return { sold, sales, cogs, profit };
  }, [rows]);

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
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/purchase')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Yetkazib beruvchi → Mahsulot sotuvlari</h1>
            <p className="text-muted-foreground">Supplier → product → sold qty (batch trace)</p>
          </div>
        </div>
        <Button variant="outline" onClick={loadData}>
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sana</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sana</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Yetkazib beruvchi</label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue placeholder="Barchasi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barchasi</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Sotilgan miqdor</p>
            <p className="text-2xl font-bold">{formatNumberUZ(summary.sold)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Sotuv summasi</p>
            <p className="text-2xl font-bold">{formatMoneyUZS(summary.sales)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">COGS</p>
            <p className="text-2xl font-bold text-destructive">{formatMoneyUZS(summary.cogs)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Gross foyda</p>
            <p className="text-2xl font-bold text-success">{formatMoneyUZS(summary.profit)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Ma'lumot topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Yetkazib beruvchi</TableHead>
                  <TableHead>Mahsulot</TableHead>
                  <TableHead className="text-right">Sotilgan miqdor</TableHead>
                  <TableHead className="text-right">Sotuv (UZS)</TableHead>
                  <TableHead className="text-right">Chegirma</TableHead>
                  <TableHead className="text-right">Netto</TableHead>
                  <TableHead className="text-right">COGS</TableHead>
                  <TableHead className="text-right">Foyda</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, idx) => (
                  <TableRow key={`${r.supplier_id}-${r.product_id}-${idx}`}>
                    <TableCell className="font-medium">{r.supplier_name || r.supplier_id || '-'}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.product_name || '-'}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.product_sku || r.product_barcode || ''}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{formatNumberUZ(Number(r.sold_qty || 0))}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(Number(r.sales_amount_uzs || 0))}</TableCell>
                    <TableCell className="text-right text-destructive">
                      {formatMoneyUZS(Number(r.discount_uzs || 0))}
                    </TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(Number(r.net_sales_uzs || 0))}</TableCell>
                    <TableCell className="text-right text-destructive">{formatMoneyUZS(Number(r.cogs_uzs || 0))}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        Number(r.gross_profit_uzs || 0) >= 0 ? 'text-success' : 'text-destructive'
                      }`}
                    >
                      {formatMoneyUZS(Number(r.gross_profit_uzs || 0))}
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
