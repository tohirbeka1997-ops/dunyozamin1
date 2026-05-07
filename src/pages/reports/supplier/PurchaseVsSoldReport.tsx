import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PackageCheck, Search, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useToast } from '@/hooks/use-toast';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { formatMoneyUZS } from '@/lib/format';
import { todayYMD } from '@/lib/datetime';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { getSuppliers } from '@/db/api';
import type { SupplierWithBalance } from '@/types/database';

type SortKey = 'profit_uzs' | 'purchased_amount' | 'sold_amount' | 'purchased_qty' | 'sold_qty' | 'remaining_qty';

interface PurchaseVsSoldRow {
  product_id: string;
  product_name: string;
  product_sku?: string | null;
  category_name?: string | null;
  current_stock: number;
  purchased_qty: number;
  purchased_amount_uzs: number;
  avg_purchase_price: number;
  sold_qty: number;
  sold_amount_uzs: number;
  avg_sale_price: number;
  remaining_qty: number;
  estimated_sold_cost_uzs: number;
  profit_uzs: number;
  sell_through_percent: number;
}

interface PurchaseVsSoldResponse {
  totals?: Partial<PurchaseVsSoldRow>;
  rows?: PurchaseVsSoldRow[];
}

const n = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const fmtQty = (value: unknown): string =>
  n(value).toLocaleString('uz-UZ', { maximumFractionDigits: 3 });

function defaultDateFrom(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ALL_SUPPLIERS = 'ALL';

export default function PurchaseVsSoldReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(todayYMD());
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('profit_uzs');
  const [supplierId, setSupplierId] = useState<string>(ALL_SUPPLIERS);
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [rows, setRows] = useState<PurchaseVsSoldRow[]>([]);
  const [totals, setTotals] = useState<Partial<PurchaseVsSoldRow>>({});

  useReportAutoRefresh(loadData);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await getSuppliers(false);
        if (alive) setSuppliers(Array.isArray(list) ? list : []);
      } catch (error) {
        console.error('[PurchaseVsSoldReport] suppliers load error:', error);
        if (alive) setSuppliers([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, sortBy, supplierId]);

  async function loadData() {
    try {
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }
      setLoading(true);
      const api = requireElectron();
      const data = await handleIpcResponse<PurchaseVsSoldResponse>(
        api.reports?.purchaseVsSold?.({
          date_from: dateFrom,
          date_to: dateTo,
          sort_by: sortBy,
          supplier_id: supplierId === ALL_SUPPLIERS ? null : supplierId,
        }) || Promise.resolve({ rows: [], totals: {} })
      );
      const normalized = (Array.isArray(data?.rows) ? data.rows : []).map((row) => ({
        ...row,
        current_stock: n(row.current_stock),
        purchased_qty: n(row.purchased_qty),
        purchased_amount_uzs: n(row.purchased_amount_uzs),
        avg_purchase_price: n(row.avg_purchase_price),
        sold_qty: n(row.sold_qty),
        sold_amount_uzs: n(row.sold_amount_uzs),
        avg_sale_price: n(row.avg_sale_price),
        remaining_qty: n(row.remaining_qty),
        estimated_sold_cost_uzs: n(row.estimated_sold_cost_uzs),
        profit_uzs: n(row.profit_uzs),
        sell_through_percent: n(row.sell_through_percent),
      }));
      setRows(normalized);
      setTotals(data?.totals || {});
    } catch (error: any) {
      console.error('[PurchaseVsSoldReport] loadData error:', error);
      const rawMessage = String(error?.message || error?.error || '');
      const rawCode = String(error?.code || error?.originalError?.code || '');
      const friendlyMessage =
        rawCode === 'NOT_FOUND' ||
        rawMessage.includes('Unknown channel') ||
        rawMessage.includes('No handler registered') ||
        rawMessage.includes('purchaseVsSold') ||
        rawMessage.includes('[object Object]')
          ? "HOST server hali yangilanmagan. Serverni deploy/restart qiling, keyin hisobot ishlaydi."
          : rawMessage || "Hisobotni yuklab bo'lmadi";
      toast({
        title: 'Xatolik',
        description: friendlyMessage,
        variant: 'destructive',
      });
      setRows([]);
      setTotals({});
    } finally {
      setLoading(false);
    }
  }

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [row.product_name, row.product_sku, row.category_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [rows, search]);

  const filteredTotals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, row) => {
          acc.purchased_qty += row.purchased_qty;
          acc.purchased_amount_uzs += row.purchased_amount_uzs;
          acc.sold_qty += row.sold_qty;
          acc.sold_amount_uzs += row.sold_amount_uzs;
          acc.profit_uzs += row.profit_uzs;
          return acc;
        },
        {
          purchased_qty: 0,
          purchased_amount_uzs: 0,
          sold_qty: 0,
          sold_amount_uzs: 0,
          profit_uzs: 0,
        }
      ),
    [filteredRows]
  );

  const summary = search.trim() ? filteredTotals : totals;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/reports/purchase')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">Sotib oldim / Sotdim</h1>
            <p className="text-sm text-muted-foreground">
              Mahsulot bo‘yicha xarid va sotuv miqdori hamda summasini solishtirish
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadData()} disabled={loading}>
          Yangilash
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Sotib olingan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">{formatMoneyUZS(n(summary.purchased_amount_uzs))}</div>
            <p className="text-xs text-muted-foreground">{fmtQty(summary.purchased_qty)} dona</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Sotilgan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">{formatMoneyUZS(n(summary.sold_amount_uzs))}</div>
            <p className="text-xs text-muted-foreground">{fmtQty(summary.sold_qty)} dona</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Miqdor farqi</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">{fmtQty(n(summary.purchased_qty) - n(summary.sold_qty))}</div>
            <p className="text-xs text-muted-foreground">xarid - sotuv</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Taxminiy foyda</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">{formatMoneyUZS(n(summary.profit_uzs))}</div>
            <p className="text-xs text-muted-foreground">sotuv - tannarx</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Qatorlar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold">{filteredRows.length}</div>
            <p className="text-xs text-muted-foreground">mahsulot</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid gap-3 md:grid-cols-[160px_160px_220px_1fr_220px]">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <Select value={supplierId} onValueChange={(value) => setSupplierId(value)}>
              <SelectTrigger>
                <SelectValue placeholder="Yetkazib beruvchi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SUPPLIERS}>Barcha yetkazib beruvchilar</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Mahsulot, SKU yoki kategoriya bo‘yicha qidirish"
                className="pl-9"
              />
            </div>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortKey)}>
              <SelectTrigger>
                <SelectValue placeholder="Saralash" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="profit_uzs">Foyda bo‘yicha</SelectItem>
                <SelectItem value="sold_amount">Sotuv summasi</SelectItem>
                <SelectItem value="purchased_amount">Xarid summasi</SelectItem>
                <SelectItem value="sold_qty">Sotilgan miqdor</SelectItem>
                <SelectItem value="purchased_qty">Sotib olingan miqdor</SelectItem>
                <SelectItem value="remaining_qty">Miqdor farqi</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[62vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>Mahsulot</TableHead>
                  <TableHead className="text-right">Sotib olingan</TableHead>
                  <TableHead className="text-right">Xarid summa</TableHead>
                  <TableHead className="text-right">Sotilgan</TableHead>
                  <TableHead className="text-right">Sotuv summa</TableHead>
                  <TableHead className="text-right">Farq</TableHead>
                  <TableHead className="text-right">Foyda</TableHead>
                  <TableHead className="text-right">Sotilish %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      Yuklanmoqda...
                    </TableCell>
                  </TableRow>
                ) : filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      Ma'lumot topilmadi
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => (
                    <TableRow key={row.product_id}>
                      <TableCell className="min-w-[240px]">
                        <div className="flex items-start gap-2">
                          <PackageCheck className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{row.product_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {[row.product_sku, row.category_name].filter(Boolean).join(' · ') || '—'}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtQty(row.purchased_qty)}
                        <div className="text-xs text-muted-foreground">{formatMoneyUZS(row.avg_purchase_price)}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoneyUZS(row.purchased_amount_uzs)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtQty(row.sold_qty)}
                        <div className="text-xs text-muted-foreground">{formatMoneyUZS(row.avg_sale_price)}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoneyUZS(row.sold_amount_uzs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(row.remaining_qty)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={row.profit_uzs < 0 ? 'text-destructive' : 'text-emerald-600'}>
                          {formatMoneyUZS(row.profit_uzs)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="inline-flex items-center gap-1">
                          <TrendingUp className="h-3 w-3 text-muted-foreground" />
                          {n(row.sell_through_percent).toFixed(1)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
