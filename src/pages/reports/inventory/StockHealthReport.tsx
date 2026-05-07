import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { ArrowLeft, RotateCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';
import { getCategories, getWarehouses } from '@/db/api';
import type { Category, Warehouse } from '@/types/database';
import type { DaysOption, DeadStockRow, TurnoverRow } from '@/types/inventoryAdvanced';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

export default function StockHealthReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [days, setDays] = useState<DaysOption>(30);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>('all');
  const [deadRows, setDeadRows] = useState<DeadStockRow[]>([]);
  const [turnoverRows, setTurnoverRows] = useState<TurnoverRow[]>([]);
  useReportAutoRefresh(loadData);

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, warehouseId]);

  async function loadData() {
    try {
      if (!isElectron()) throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      setLoading(true);
      const [cats, whs, dead, turnover] = await Promise.all([
        getCategories(),
        getWarehouses(),
        handleIpcResponse<DeadStockRow[]>(
          requireElectron().inventory.getDeadStock({
            days,
            warehouse_id: warehouseId === 'all' ? undefined : warehouseId,
          })
        ),
        handleIpcResponse<TurnoverRow[]>(
          requireElectron().inventory.getStockTurnover({
            days,
            warehouse_id: warehouseId === 'all' ? undefined : warehouseId,
          })
        ),
      ]);
      setCategories(Array.isArray(cats) ? cats : []);
      setWarehouses(Array.isArray(whs) ? (whs as Warehouse[]) : []);
      setDeadRows(Array.isArray(dead) ? dead : []);
      setTurnoverRows(Array.isArray(turnover) ? turnover : []);
    } catch (error: any) {
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setDeadRows([]);
      setTurnoverRows([]);
    } finally {
      setLoading(false);
    }
  }

  const searchLower = search.trim().toLowerCase();
  const byCommonFilter = <T extends { category_id: string | null; product_name: string; product_sku: string }>(row: T) => {
    if (categoryFilter !== 'all' && row.category_id !== categoryFilter) return false;
    if (!searchLower) return true;
    return row.product_name.toLowerCase().includes(searchLower) || row.product_sku.toLowerCase().includes(searchLower);
  };

  const frozen = useMemo(() => deadRows.filter(byCommonFilter).sort((a, b) => Number(b.frozen_value || 0) - Number(a.frozen_value || 0)), [deadRows, categoryFilter, searchLower]);
  const goodSelling = useMemo(
    () =>
      turnoverRows
        .filter((r) => r.speed_label === 'fast')
        .filter(byCommonFilter)
        .sort((a, b) => Number(b.sold_qty_n || 0) - Number(a.sold_qty_n || 0)),
    [turnoverRows, categoryFilter, searchLower]
  );

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
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/inventory')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">Yaxshi sotilayotgan & muzlab yotgan mahsulotlar</h1>
            <p className="text-muted-foreground text-sm">
              {warehouseId === 'all' ? 'Global (barcha omborlar)' : 'Tanlangan ombor'} ikki tomonlama ro‘yxat (davr kesimida)
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>
          <RotateCw className="h-4 w-4 mr-2" />
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Davr</label>
              <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as DaysOption)}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 kun</SelectItem>
                  <SelectItem value="60">60 kun</SelectItem>
                  <SelectItem value="90">90 kun</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Kategoriya</label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-8">
                  <SelectValue />
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
              <label className="text-xs text-muted-foreground">Ombor</label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha omborlar</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Qidirish</label>
              <Input className="h-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nomi yoki SKU..." />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Muzlab yotgan mahsulotlar ({frozen.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mahsulot</TableHead>
                  <TableHead className="text-right">Qoldiq</TableHead>
                  <TableHead className="text-right">Muzlagan pul</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {frozen.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={3}>
                      Filtr bo‘yicha muzlab yotgan mahsulot topilmadi
                    </TableCell>
                  </TableRow>
                ) : (
                  frozen.slice(0, 50).map((r) => (
                    <TableRow key={r.product_id}>
                      <TableCell>
                        <div className="font-medium">{r.product_name}</div>
                        <div className="text-xs text-muted-foreground">{r.product_sku}</div>
                      </TableCell>
                      <TableCell className="text-right">{formatNumberUZ(Number(r.current_stock || 0))}</TableCell>
                      <TableCell className="text-right text-warning font-medium">{formatMoneyUZS(Number(r.frozen_value || 0))}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Yaxshi sotilayotgan mahsulotlar ({goodSelling.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mahsulot</TableHead>
                  <TableHead className="text-right">Sotilgan</TableHead>
                  <TableHead className="text-right">O‘rtacha/kun</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {goodSelling.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={3}>
                      Filtr bo‘yicha yaxshi sotilayotgan mahsulot topilmadi
                    </TableCell>
                  </TableRow>
                ) : (
                  goodSelling.slice(0, 50).map((r) => (
                    <TableRow key={r.product_id}>
                      <TableCell>
                        <div className="font-medium">{r.product_name}</div>
                        <div className="text-xs text-muted-foreground">{r.product_sku}</div>
                      </TableCell>
                      <TableCell className="text-right">{formatNumberUZ(Number(r.sold_qty_n || 0))}</TableCell>
                      <TableCell className="text-right text-success font-medium">{formatNumberUZ(Number(r.avg_daily_sales || 0))}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

