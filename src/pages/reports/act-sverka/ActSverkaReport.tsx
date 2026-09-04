import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { getCategories } from '@/db/api';
import type { Category } from '@/types/database';
import { FileDown, ArrowLeft, Package } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { todayYMD } from '@/lib/datetime';
import { useDebounce } from '@/hooks/use-debounce';

interface BatchReconciliation {
  product_id: string;
  product_name: string;
  product_sku: string;
  category_name: string;
  opening_qty?: number;
  purchase_qty?: number;
  return_in_qty?: number;
  adjustment_in_qty?: number;
  sale_qty?: number;
  supplier_return_qty?: number;
  adjustment_out_qty?: number;
  transfer_out_qty?: number;
  transfer_in_qty?: number;
  remaining_qty: number;
  expected_remaining_qty?: number;
  qty_balance_diff?: number;
  sale_cogs?: number;
  purchase_cost?: number;
  remaining_cost?: number;
  total_purchased_qty: number;
  total_sold_qty: number;
  total_purchased_cost: number;
  total_sold_revenue: number;
  total_profit: number;
  profit_margin: number;
}

export default function ActSverkaReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [reconciliations, setReconciliations] = useState<BatchReconciliation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const categoriesData = await getCategories();
      setCategories(categoriesData);

      if (!isElectron()) {
        throw new Error(
          'Act Sverka faqat POS terminalida ishlaydi (Electron rejimi talab qilinadi).'
        );
      }
      const api = requireElectron();
      const response = await handleIpcResponse<BatchReconciliation[]>(
        api.reports?.actSverka?.({
          category_id: categoryFilter !== 'all' ? categoryFilter : undefined,
          search: debouncedSearch.trim() || undefined,
        }) || Promise.resolve([])
      );
      setReconciliations(response || []);
    } catch (error: any) {
      console.error('Failed to load act sverka data:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Act Sverka ma'lumotlarini yuklab bo'lmadi",
        variant: 'destructive',
      });
      setReconciliations([]);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, debouncedSearch, toast]);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totals = useMemo(
    () =>
      reconciliations.reduce(
        (acc, item) => ({
          opening_qty: acc.opening_qty + Number(item.opening_qty || 0),
          purchase_qty: acc.purchase_qty + Number(item.purchase_qty || 0),
          return_in_qty: acc.return_in_qty + Number(item.return_in_qty || 0),
          adjustment_in_qty: acc.adjustment_in_qty + Number(item.adjustment_in_qty || 0),
          sale_qty: acc.sale_qty + Number(item.sale_qty || item.total_sold_qty || 0),
          supplier_return_qty: acc.supplier_return_qty + Number(item.supplier_return_qty || 0),
          adjustment_out_qty: acc.adjustment_out_qty + Number(item.adjustment_out_qty || 0),
          remaining_qty: acc.remaining_qty + Number(item.remaining_qty || 0),
          purchased_cost: acc.purchased_cost + Number(item.purchase_cost || item.total_purchased_cost || 0),
          sold_revenue: acc.sold_revenue + Number(item.total_sold_revenue || 0),
          cogs: acc.cogs + Number(item.sale_cogs || 0),
          profit: acc.profit + Number(item.total_profit || 0),
          qty_diff: acc.qty_diff + Number(item.qty_balance_diff || 0),
        }),
        {
          opening_qty: 0,
          purchase_qty: 0,
          return_in_qty: 0,
          adjustment_in_qty: 0,
          sale_qty: 0,
          supplier_return_qty: 0,
          adjustment_out_qty: 0,
          remaining_qty: 0,
          purchased_cost: 0,
          sold_revenue: 0,
          cogs: 0,
          profit: 0,
          qty_diff: 0,
        }
      ),
    [reconciliations]
  );

  const handleExport = async () => {
    try {
      if (!isElectron()) {
        toast({ title: 'Xatolik', description: 'Eksport faqat desktop ilovada mavjud.', variant: 'destructive' });
        return;
      }

      const api = requireElectron();
      const headers = [
        'product_name',
        'product_sku',
        'category_name',
        'opening_qty',
        'purchase_qty',
        'return_in_qty',
        'adjustment_in_qty',
        'sale_qty',
        'supplier_return_qty',
        'adjustment_out_qty',
        'transfer_in_qty',
        'transfer_out_qty',
        'remaining_qty',
        'expected_remaining_qty',
        'qty_balance_diff',
        'purchase_cost',
        'sale_cogs',
        'total_sold_revenue',
        'total_profit',
        'profit_margin',
      ];

      const escape = (v: any) => {
        const s = String(v ?? '');
        if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const lines = [
        headers.join(','),
        ...reconciliations.map((r) =>
          [
            r.product_name,
            r.product_sku,
            r.category_name,
            r.opening_qty ?? 0,
            r.purchase_qty ?? 0,
            r.return_in_qty ?? 0,
            r.adjustment_in_qty ?? 0,
            r.sale_qty ?? r.total_sold_qty ?? 0,
            r.supplier_return_qty ?? 0,
            r.adjustment_out_qty ?? 0,
            r.transfer_in_qty ?? 0,
            r.transfer_out_qty ?? 0,
            r.remaining_qty,
            r.expected_remaining_qty ?? '',
            r.qty_balance_diff ?? '',
            r.purchase_cost ?? r.total_purchased_cost,
            r.sale_cogs ?? '',
            r.total_sold_revenue,
            r.total_profit,
            r.profit_margin,
          ]
            .map(escape)
            .join(',')
        ),
      ];

      await api.files.saveTextFile({
        defaultFileName: `act-sverka-${todayYMD()}.csv`,
        content: lines.join('\n'),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        encoding: 'utf8',
      });

      toast({ title: 'Tayyor', description: 'CSV eksport qilindi.' });
    } catch (error: any) {
      console.error('[ActSverkaReport] export error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Eksportni bajarib bo'lmadi",
        variant: 'destructive',
      });
    }
  };

  const handlePrint = () => {
    window.print();
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
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/inventory')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">Akt sverka (FIFO partiya, barcha davr)</h1>
            <p className="text-muted-foreground">
              Partiya (FIFO) yoqilganda: barcha vaqtlar yig‘indisi. Davr bo‘yicha batafsil: Ombor → Mahsulot bo‘yicha
              akt sverka (davr).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handlePrint}>
            PDF / Print
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <FileDown className="h-4 w-4 mr-2" />
            CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Kategoriya</label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Barcha kategoriyalar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha kategoriyalar</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Qidirish (server)</label>
              <Input
                placeholder="Mahsulot nomi, SKU yoki barcode..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Xarid (tannarx)</div>
            <div className="text-2xl font-bold text-primary">{formatMoneyUZS(totals.purchased_cost)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Sotuv (daromad)</div>
            <div className="text-2xl font-bold text-success">{formatMoneyUZS(totals.sold_revenue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">COGS / Foyda</div>
            <div className="text-lg font-bold">{formatMoneyUZS(totals.cogs)}</div>
            <div className="text-2xl font-bold text-accent">{formatMoneyUZS(totals.profit)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Qoldiq farqi (Σ)</div>
            <div
              className={`text-2xl font-bold ${
                Math.abs(totals.qty_diff) > 0.0001 ? 'text-destructive' : 'text-success'
              }`}
            >
              {formatNumberUZ(totals.qty_diff)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {reconciliations.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                FIFO partiya rejimi yoqilmagan, filtrga mos emas, yoki ma&apos;lumot yo&apos;q
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mahsulot</TableHead>
                    <TableHead>Kategoriya</TableHead>
                    <TableHead className="text-right">Boshlang‘ich</TableHead>
                    <TableHead className="text-right">Xarid</TableHead>
                    <TableHead className="text-right">Qayt. (kirim)</TableHead>
                    <TableHead className="text-right">Korreksiya+</TableHead>
                    <TableHead className="text-right">Sotuv</TableHead>
                    <TableHead className="text-right">Yetkaz. qayt.</TableHead>
                    <TableHead className="text-right">Korreksiya−</TableHead>
                    <TableHead className="text-right">Qoldiq</TableHead>
                    <TableHead className="text-right">Farq</TableHead>
                    <TableHead className="text-right">Xarid $</TableHead>
                    <TableHead className="text-right">COGS</TableHead>
                    <TableHead className="text-right">Daromad</TableHead>
                    <TableHead className="text-right">Foyda</TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reconciliations.map((item) => {
                    const diff = Number(item.qty_balance_diff || 0);
                    return (
                      <TableRow key={item.product_id}>
                        <TableCell className="font-medium">
                          <div>{item.product_name}</div>
                          <div className="text-xs text-muted-foreground">{item.product_sku || '—'}</div>
                        </TableCell>
                        <TableCell>{item.category_name || '—'}</TableCell>
                        <TableCell className="text-right">{formatNumberUZ(item.opening_qty || 0)}</TableCell>
                        <TableCell className="text-right">{formatNumberUZ(item.purchase_qty || 0)}</TableCell>
                        <TableCell className="text-right">{formatNumberUZ(item.return_in_qty || 0)}</TableCell>
                        <TableCell className="text-right">{formatNumberUZ(item.adjustment_in_qty || 0)}</TableCell>
                        <TableCell className="text-right">
                          {formatNumberUZ(item.sale_qty ?? item.total_sold_qty ?? 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumberUZ(item.supplier_return_qty || 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumberUZ(item.adjustment_out_qty || 0)}
                        </TableCell>
                        <TableCell className="text-right">{formatNumberUZ(item.remaining_qty)}</TableCell>
                        <TableCell
                          className={`text-right ${Math.abs(diff) > 0.0001 ? 'text-destructive font-medium' : ''}`}
                        >
                          {formatNumberUZ(diff)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoneyUZS(item.purchase_cost ?? item.total_purchased_cost)}
                        </TableCell>
                        <TableCell className="text-right">{formatMoneyUZS(item.sale_cogs || 0)}</TableCell>
                        <TableCell className="text-right">{formatMoneyUZS(item.total_sold_revenue)}</TableCell>
                        <TableCell className="text-right">
                          <span className={item.total_profit >= 0 ? 'text-success' : 'text-destructive'}>
                            {formatMoneyUZS(item.total_profit)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={item.profit_margin >= 0 ? 'text-success' : 'text-destructive'}>
                            {formatNumberUZ(item.profit_margin)}%
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="font-bold bg-muted/50">
                    <TableCell colSpan={2}>JAMI ({reconciliations.length})</TableCell>
                    <TableCell className="text-right">{formatNumberUZ(totals.opening_qty)}</TableCell>
                    <TableCell className="text-right">{formatNumberUZ(totals.purchase_qty)}</TableCell>
                    <TableCell className="text-right">{formatNumberUZ(totals.return_in_qty)}</TableCell>
                    <TableCell className="text-right">{formatNumberUZ(totals.adjustment_in_qty)}</TableCell>
                    <TableCell className="text-right">{formatNumberUZ(totals.sale_qty)}</TableCell>
                    <TableCell className="text-right">{formatNumberUZ(totals.supplier_return_qty)}</TableCell>
                    <TableCell className="text-right">{formatNumberUZ(totals.adjustment_out_qty)}</TableCell>
                    <TableCell className="text-right">{formatNumberUZ(totals.remaining_qty)}</TableCell>
                    <TableCell className="text-right">{formatNumberUZ(totals.qty_diff)}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(totals.purchased_cost)}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(totals.cogs)}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(totals.sold_revenue)}</TableCell>
                    <TableCell className="text-right">
                      <span className={totals.profit >= 0 ? 'text-success' : 'text-destructive'}>
                        {formatMoneyUZS(totals.profit)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {totals.sold_revenue > 0
                        ? `${formatNumberUZ((totals.profit / totals.sold_revenue) * 100)}%`
                        : '-'}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
