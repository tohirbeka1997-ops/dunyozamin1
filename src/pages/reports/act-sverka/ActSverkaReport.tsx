import { useState, useEffect } from 'react';
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

interface BatchReconciliation {
  product_id: string;
  product_name: string;
  product_sku: string;
  category_name: string;
  total_purchased_qty: number;
  total_sold_qty: number;
  remaining_qty: number;
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

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
  }, [categoryFilter]);

  async function loadData() {
    try {
      setLoading(true);
      
      // Fetch categories for filter
      const categoriesData = await getCategories();
      setCategories(categoriesData);

      // In Electron mode, call backend to get batch reconciliation data
      if (isElectron()) {
        const api = requireElectron();
        const response = await handleIpcResponse<BatchReconciliation[]>(
          api.reports?.actSverka?.({
            category_id: categoryFilter !== 'all' ? categoryFilter : undefined,
          }) || Promise.resolve([])
        );
        setReconciliations(response || []);
      } else {
        // Mock data for browser mode
        setReconciliations([]);
      }
    } catch (error) {
      console.error('Failed to load act sverka data:', error);
      toast({
        title: 'Xatolik',
        description: 'Act Sverka ma\'lumotlarini yuklab bo\'lmadi',
        variant: 'destructive',
      });
      setReconciliations([]);
    } finally {
      setLoading(false);
    }
  }

  const filteredReconciliations = reconciliations.filter((item) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      item.product_name.toLowerCase().includes(search) ||
      item.product_sku.toLowerCase().includes(search) ||
      item.category_name.toLowerCase().includes(search)
    );
  });

  const totals = filteredReconciliations.reduce(
    (acc, item) => ({
      purchased_qty: acc.purchased_qty + item.total_purchased_qty,
      sold_qty: acc.sold_qty + item.total_sold_qty,
      remaining_qty: acc.remaining_qty + item.remaining_qty,
      purchased_cost: acc.purchased_cost + item.total_purchased_cost,
      sold_revenue: acc.sold_revenue + item.total_sold_revenue,
      profit: acc.profit + item.total_profit,
    }),
    { purchased_qty: 0, sold_qty: 0, remaining_qty: 0, purchased_cost: 0, sold_revenue: 0, profit: 0 }
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
        'total_purchased_qty',
        'total_sold_qty',
        'remaining_qty',
        'total_purchased_cost',
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
        ...filteredReconciliations.map((r) =>
          [
            r.product_name,
            r.product_sku,
            r.category_name,
            r.total_purchased_qty,
            r.total_sold_qty,
            r.remaining_qty,
            r.total_purchased_cost,
            r.total_sold_revenue,
            r.total_profit,
            r.profit_margin,
          ]
            .map(escape)
            .join(',')
        ),
      ];

      const content = lines.join('\n');
      const today = new Date().toISOString().slice(0, 10);

      await api.files.saveTextFile({
        defaultFileName: `act-sverka-${today}.csv`,
        content,
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
    // In Electron, the print dialog supports "Save to PDF"
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
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Act Sverka (Partiya uzgartirish akti)</h1>
            <p className="text-muted-foreground">
              FIFO partiyalari bo'yicha xarid-sotuv uzgartirish hisoboti
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
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Mahsulot nomi yoki SKU..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Jami xarid (tannarx)</div>
            <div className="text-2xl font-bold text-primary">{formatMoneyUZS(totals.purchased_cost)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Jami sotuv (daromad)</div>
            <div className="text-2xl font-bold text-success">{formatMoneyUZS(totals.sold_revenue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Jami foyda</div>
            <div className="text-2xl font-bold text-accent">{formatMoneyUZS(totals.profit)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {filteredReconciliations.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {reconciliations.length === 0
                  ? 'FIFO partiya rejimi yoqilmagan yoki ma\'lumot yo\'q'
                  : 'Filtrga mos mahsulot topilmadi'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mahsulot</TableHead>
                  <TableHead>Kategoriya</TableHead>
                  <TableHead className="text-right">Xarid (dona)</TableHead>
                  <TableHead className="text-right">Sotilgan (dona)</TableHead>
                  <TableHead className="text-right">Qoldiq (dona)</TableHead>
                  <TableHead className="text-right">Xarid (tannarx)</TableHead>
                  <TableHead className="text-right">Sotuv (daromad)</TableHead>
                  <TableHead className="text-right">Foyda</TableHead>
                  <TableHead className="text-right">Foyda %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReconciliations.map((item) => (
                  <TableRow key={item.product_id}>
                    <TableCell className="font-medium">
                      <div>{item.product_name}</div>
                      <div className="text-xs text-muted-foreground">{item.product_sku}</div>
                    </TableCell>
                    <TableCell>{item.category_name}</TableCell>
                    <TableCell className="text-right">{formatNumberUZ(item.total_purchased_qty)}</TableCell>
                    <TableCell className="text-right">{formatNumberUZ(item.total_sold_qty)}</TableCell>
                    <TableCell className="text-right">{formatNumberUZ(item.remaining_qty)}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(item.total_purchased_cost)}</TableCell>
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
                ))}
                {/* Totals row */}
                <TableRow className="font-bold bg-muted/50">
                  <TableCell colSpan={2}>JAMI</TableCell>
                  <TableCell className="text-right">{formatNumberUZ(totals.purchased_qty)}</TableCell>
                  <TableCell className="text-right">{formatNumberUZ(totals.sold_qty)}</TableCell>
                  <TableCell className="text-right">{formatNumberUZ(totals.remaining_qty)}</TableCell>
                  <TableCell className="text-right">{formatMoneyUZS(totals.purchased_cost)}</TableCell>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
