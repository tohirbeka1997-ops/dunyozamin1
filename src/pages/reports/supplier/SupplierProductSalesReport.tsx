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
import { ArrowLeft, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
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
  const [sortBy, setSortBy] = useState<
    'received_qty' | 'received_amount_uzs' | 'sold_qty' | 'delta' | 'sales_amount_uzs' | 'discount_uzs' | 'net_sales_uzs' | 'cogs_uzs' | 'gross_profit_uzs'
  >('gross_profit_uzs');
  const [sortAsc, setSortAsc] = useState(false); // false = ko'p -> kam

  const onSort = (
    key:
      | 'received_qty'
      | 'received_amount_uzs'
      | 'sold_qty'
      | 'delta'
      | 'sales_amount_uzs'
      | 'discount_uzs'
      | 'net_sales_uzs'
      | 'cogs_uzs'
      | 'gross_profit_uzs'
  ) => {
    if (sortBy === key) {
      setSortAsc((v) => !v);
      return;
    }
    setSortBy(key);
    setSortAsc(false);
  };

  const SortIcon = ({ col }: { col: typeof sortBy }) => {
    if (sortBy !== col) return <ArrowUpDown className="inline h-3 w-3 opacity-60" />;
    return sortAsc ? <ArrowUp className="inline h-3 w-3" /> : <ArrowDown className="inline h-3 w-3" />;
  };

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
    const received = rows.reduce((sum, r) => sum + Number(r.received_qty || 0), 0);
    const receivedAmount = rows.reduce((sum, r) => sum + Number(r.received_amount_uzs || 0), 0);
    const sold = rows.reduce((sum, r) => sum + Number(r.sold_qty || 0), 0);
    const sales = rows.reduce((sum, r) => sum + Number(r.sales_amount_uzs || 0), 0);
    const cogs = rows.reduce((sum, r) => sum + Number(r.cogs_uzs || 0), 0);
    const profit = rows.reduce((sum, r) => sum + Number(r.gross_profit_uzs || 0), 0);
    const delta = received - sold;
    return { received, receivedAmount, sold, delta, sales, cogs, profit };
  }, [rows]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    const valueOf = (r: SupplierProductSalesRow) => {
      if (sortBy === 'delta') return Number(r.received_qty || 0) - Number(r.sold_qty || 0);
      return Number((r as any)[sortBy] || 0);
    };
    list.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (av === bv) return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'uz');
      return sortAsc ? av - bv : bv - av;
    });
    return list;
  }, [rows, sortBy, sortAsc]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/purchase')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading text-xl">Yetkazib beruvchi → Mahsulot sotuvlari</h1>
            <p className="text-muted-foreground text-xs">Supplier → product → davr bo‘yicha kirdi va sotildi (batch trace)</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="pt-3 pb-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">Boshlanish sana</label>
              <Input className="h-8" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tugash sana</label>
              <Input className="h-8" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Yetkazib beruvchi</label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger className="h-8">
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

      <div className="space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Card>
            <CardContent className="py-3">
              <p className="text-xs text-muted-foreground">Kirim miqdori (davr)</p>
              <p className="text-xl font-bold leading-6">{formatNumberUZ(summary.received)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-xs text-muted-foreground">Kirim summasi (davr)</p>
              <p className="text-xl font-bold leading-6">{formatMoneyUZS(summary.receivedAmount)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-xs text-muted-foreground">Farq (davr kirim − davr sotilgan)</p>
              <p className={`text-xl font-bold leading-6 ${summary.delta >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>
                {formatNumberUZ(summary.delta)}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Card>
            <CardContent className="py-3">
              <p className="text-xs text-muted-foreground">Sotilgan miqdor (davr)</p>
              <p className="text-xl font-bold leading-6">{formatNumberUZ(summary.sold)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-xs text-muted-foreground">Sotuv summasi</p>
              <p className="text-xl font-bold leading-6">{formatMoneyUZS(summary.sales)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-xs text-muted-foreground">COGS</p>
              <p className="text-xl font-bold leading-6 text-destructive">{formatMoneyUZS(summary.cogs)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-xs text-muted-foreground">Gross foyda</p>
              <p className="text-xl font-bold leading-6 text-success">{formatMoneyUZS(summary.profit)}</p>
            </CardContent>
          </Card>
        </div>
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
                  <TableHead className="text-right cursor-pointer" onClick={() => onSort('received_qty')}>Kirim (davr) <SortIcon col="received_qty" /></TableHead>
                  <TableHead className="text-right cursor-pointer" onClick={() => onSort('received_amount_uzs')}>Kirim (UZS) <SortIcon col="received_amount_uzs" /></TableHead>
                  <TableHead className="text-right cursor-pointer" onClick={() => onSort('sold_qty')}>Sotilgan (davr) <SortIcon col="sold_qty" /></TableHead>
                  <TableHead className="text-right cursor-pointer" onClick={() => onSort('delta')}>Farq (davr) <SortIcon col="delta" /></TableHead>
                  <TableHead className="text-right cursor-pointer" onClick={() => onSort('sales_amount_uzs')}>Sotuv (UZS) <SortIcon col="sales_amount_uzs" /></TableHead>
                  <TableHead className="text-right cursor-pointer" onClick={() => onSort('discount_uzs')}>Chegirma <SortIcon col="discount_uzs" /></TableHead>
                  <TableHead className="text-right cursor-pointer" onClick={() => onSort('net_sales_uzs')}>Netto <SortIcon col="net_sales_uzs" /></TableHead>
                  <TableHead className="text-right cursor-pointer" onClick={() => onSort('cogs_uzs')}>COGS <SortIcon col="cogs_uzs" /></TableHead>
                  <TableHead className="text-right cursor-pointer" onClick={() => onSort('gross_profit_uzs')}>Foyda <SortIcon col="gross_profit_uzs" /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((r, idx) => (
                  <TableRow key={`${r.supplier_id}-${r.product_id}-${idx}`}>
                    <TableCell className="font-medium">{r.supplier_name || r.supplier_id || '-'}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.product_name || '-'}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.product_sku || r.product_barcode || ''}
                      </div>
                      {Number(r.is_estimated || 0) === 1 && (
                        <div className="text-[11px] text-amber-700">Taxminiy bog‘langan (allocation yo‘q)</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-emerald-700">{formatNumberUZ(Number(r.received_qty || 0))}</TableCell>
                    <TableCell className="text-right text-emerald-700">{formatMoneyUZS(Number(r.received_amount_uzs || 0))}</TableCell>
                    <TableCell className="text-right">{formatNumberUZ(Number(r.sold_qty || 0))}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        Number(r.received_qty || 0) - Number(r.sold_qty || 0) >= 0 ? 'text-emerald-700' : 'text-destructive'
                      }`}
                    >
                      {formatNumberUZ(Number(r.received_qty || 0) - Number(r.sold_qty || 0))}
                    </TableCell>
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
