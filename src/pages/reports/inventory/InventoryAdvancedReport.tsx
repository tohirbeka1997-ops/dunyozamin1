import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, PackageSearch, RotateCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import type { Category } from '@/types/database';
import type { DaysOption, DeadStockRow, ReorderRow, TurnoverRow } from '@/types/inventoryAdvanced';

function safeNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function InventoryAdvancedReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [tab, setTab] = useState<'dead' | 'turnover' | 'reorder'>('dead');
  const [days, setDays] = useState<DaysOption>(30);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [deadRows, setDeadRows] = useState<DeadStockRow[]>([]);
  const [turnoverRows, setTurnoverRows] = useState<TurnoverRow[]>([]);
  const [reorderRows, setReorderRows] = useState<ReorderRow[]>([]);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, days]);

  async function loadData() {
    try {
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }

      setLoading(true);
      const api = requireElectron();

      // Categories (once, but safe to call)
      const cats = await handleIpcResponse<Category[]>(
        api.categories.list({})
      );
      setCategories(Array.isArray(cats) ? cats : []);

      if (tab === 'dead') {
        const rows = await handleIpcResponse<DeadStockRow[]>(
          api.inventory.getDeadStock({ days })
        );
        setDeadRows(Array.isArray(rows) ? rows : []);
      } else if (tab === 'turnover') {
        const rows = await handleIpcResponse<TurnoverRow[]>(
          api.inventory.getStockTurnover({ days })
        );
        setTurnoverRows(Array.isArray(rows) ? rows : []);
      } else {
        const rows = await handleIpcResponse<ReorderRow[]>(
          api.inventory.getReorderSuggestions()
        );
        setReorderRows(Array.isArray(rows) ? rows : []);
      }
    } catch (error: any) {
      console.error('[InventoryAdvancedReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  const filteredDead = useMemo(() => {
    const s = search.trim().toLowerCase();
    return deadRows.filter((r) => {
      if (categoryFilter !== 'all' && r.category_id !== categoryFilter) return false;
      if (!s) return true;
      return (
        String(r.product_name || '').toLowerCase().includes(s) ||
        String(r.product_sku || '').toLowerCase().includes(s)
      );
    });
  }, [deadRows, search, categoryFilter]);

  const filteredTurnover = useMemo(() => {
    const s = search.trim().toLowerCase();
    return turnoverRows.filter((r) => {
      if (categoryFilter !== 'all' && r.category_id !== categoryFilter) return false;
      if (!s) return true;
      return (
        String(r.product_name || '').toLowerCase().includes(s) ||
        String(r.product_sku || '').toLowerCase().includes(s)
      );
    });
  }, [turnoverRows, search, categoryFilter]);

  const filteredReorder = useMemo(() => {
    const s = search.trim().toLowerCase();
    return reorderRows.filter((r) => {
      if (categoryFilter !== 'all' && r.category_id !== categoryFilter) return false;
      if (!s) return true;
      return (
        String(r.product_name || '').toLowerCase().includes(s) ||
        String(r.product_sku || '').toLowerCase().includes(s)
      );
    });
  }, [reorderRows, search, categoryFilter]);

  const deadSummary = useMemo(() => {
    const totalFrozen = filteredDead.reduce((sum, r) => sum + safeNum(r.frozen_value), 0);
    const totalQty = filteredDead.reduce((sum, r) => sum + safeNum(r.current_stock), 0);
    return { count: filteredDead.length, totalFrozen, totalQty };
  }, [filteredDead]);

  const turnoverSummary = useMemo(() => {
    const totalStockValue = filteredTurnover.reduce((sum, r) => sum + safeNum(r.stock_value), 0);
    const totalSold = filteredTurnover.reduce((sum, r) => sum + safeNum(r.sold_qty_n), 0);
    return { count: filteredTurnover.length, totalStockValue, totalSold };
  }, [filteredTurnover]);

  const reorderSummary = useMemo(() => {
    const needCount = filteredReorder.filter((r) => safeNum(r.recommended_order_qty) > 0).length;
    const totalRecommended = filteredReorder.reduce((sum, r) => sum + safeNum(r.recommended_order_qty), 0);
    return { count: filteredReorder.length, needCount, totalRecommended };
  }, [filteredReorder]);

  const speedBadge = (label: TurnoverRow['speed_label']) => {
    if (!label) return <Badge variant="secondary">Sotuv yo‘q</Badge>;
    if (label === 'fast') return <Badge className="bg-success text-white">Tez</Badge>;
    if (label === 'medium') return <Badge className="bg-warning text-white">O‘rtacha</Badge>;
    return <Badge className="bg-destructive text-white">Sekin</Badge>;
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
            <h1 className="text-3xl font-bold">Ombor va zaxira (kengaytirilgan)</h1>
            <p className="text-muted-foreground">
              O‘lik zaxira, aylanma tezligi va qayta buyurtma tavsiyalari
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={loadData}>
          <RotateCw className="h-4 w-4 mr-2" />
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Davr</label>
              <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as DaysOption)}>
                <SelectTrigger>
                  <SelectValue placeholder="Kun" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 kun</SelectItem>
                  <SelectItem value="60">60 kun</SelectItem>
                  <SelectItem value="90">90 kun</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground">Kategoriya</label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Barchasi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barchasi</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Nomi yoki SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="dead">O‘lik zaxira</TabsTrigger>
          <TabsTrigger value="turnover">Aylanma</TabsTrigger>
          <TabsTrigger value="reorder">Qayta buyurtma</TabsTrigger>
        </TabsList>

        <TabsContent value="dead" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Mahsulotlar</p>
                    <p className="text-2xl font-bold">{deadSummary.count}</p>
                  </div>
                  <PackageSearch className="h-6 w-6 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Jami qoldiq</p>
                <p className="text-2xl font-bold">{formatNumberUZ(deadSummary.totalQty)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Muzlab yotgan pul</p>
                <p className="text-2xl font-bold text-warning">{formatMoneyUZS(deadSummary.totalFrozen)}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              {filteredDead.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">Ma'lumot topilmadi</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mahsulot</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Qoldiq</TableHead>
                      <TableHead className="text-right">Tannarx</TableHead>
                      <TableHead className="text-right">Muzlagan pul</TableHead>
                      <TableHead className="text-right">Oxirgi sotuv (kun)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDead.map((r) => (
                      <TableRow key={r.product_id}>
                        <TableCell className="font-medium">{r.product_name}</TableCell>
                        <TableCell>{r.product_sku}</TableCell>
                        <TableCell className="text-right">{formatNumberUZ(safeNum(r.current_stock))}</TableCell>
                        <TableCell className="text-right">{formatMoneyUZS(safeNum(r.purchase_price))}</TableCell>
                        <TableCell className="text-right font-medium">{formatMoneyUZS(safeNum(r.frozen_value))}</TableCell>
                        <TableCell className="text-right">
                          {r.days_since_last_sale === null ? '-' : formatNumberUZ(r.days_since_last_sale)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="turnover" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Mahsulotlar</p>
                <p className="text-2xl font-bold">{turnoverSummary.count}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Sotilgan (davr)</p>
                <p className="text-2xl font-bold">{formatNumberUZ(turnoverSummary.totalSold)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Joriy zaxira qiymati</p>
                <p className="text-2xl font-bold">{formatMoneyUZS(turnoverSummary.totalStockValue)}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              {filteredTurnover.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">Ma'lumot topilmadi</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mahsulot</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Qoldiq</TableHead>
                      <TableHead className="text-right">Sotilgan</TableHead>
                      <TableHead className="text-right">O‘rtacha/kun</TableHead>
                      <TableHead className="text-right">Tugash (kun)</TableHead>
                      <TableHead>Tezlik</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTurnover.map((r) => (
                      <TableRow key={r.product_id}>
                        <TableCell className="font-medium">{r.product_name}</TableCell>
                        <TableCell>{r.product_sku}</TableCell>
                        <TableCell className="text-right">{formatNumberUZ(safeNum(r.current_stock))}</TableCell>
                        <TableCell className="text-right">{formatNumberUZ(safeNum(r.sold_qty_n))}</TableCell>
                        <TableCell className="text-right">
                          {formatNumberUZ(Number(safeNum(r.avg_daily_sales).toFixed(2)))}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.days_to_sell_out === null ? '-' : formatNumberUZ(Number(r.days_to_sell_out.toFixed(1)))}
                        </TableCell>
                        <TableCell>{speedBadge(r.speed_label)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reorder" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Mahsulotlar</p>
                <p className="text-2xl font-bold">{reorderSummary.count}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Buyurtma kerak</p>
                <p className="text-2xl font-bold text-warning">{reorderSummary.needCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Tavsiya miqdor (jami)</p>
                <p className="text-2xl font-bold">{formatNumberUZ(reorderSummary.totalRecommended)}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              {filteredReorder.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">Ma'lumot topilmadi</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mahsulot</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Qoldiq</TableHead>
                      <TableHead className="text-right">Minimum</TableHead>
                      <TableHead className="text-right">Maqsad</TableHead>
                      <TableHead className="text-right">Tavsiya</TableHead>
                      <TableHead className="text-right">Zaxira qiymati</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReorder.map((r) => {
                      const need = safeNum(r.recommended_order_qty) > 0;
                      return (
                        <TableRow key={r.product_id}>
                          <TableCell className="font-medium">{r.product_name}</TableCell>
                          <TableCell>{r.product_sku}</TableCell>
                          <TableCell className="text-right">{formatNumberUZ(safeNum(r.current_stock))}</TableCell>
                          <TableCell className="text-right">{formatNumberUZ(safeNum(r.min_stock_level))}</TableCell>
                          <TableCell className="text-right">{formatNumberUZ(safeNum(r.target_level))}</TableCell>
                          <TableCell className={`text-right font-medium ${need ? 'text-warning' : ''}`}>
                            {formatNumberUZ(safeNum(r.recommended_order_qty))}
                          </TableCell>
                          <TableCell className="text-right">{formatMoneyUZS(safeNum(r.stock_value))}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

