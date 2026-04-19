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
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, FileDown, Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { getCategories } from '@/db/api';
import type { Category } from '@/types/database';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { todayYMD } from '@/lib/datetime';
import { formatUnit } from '@/utils/formatters';

type Status = 'OK' | 'RISK' | 'SHORTAGE';

type PurchasePlanningRow = {
  product_id: string;
  product_name: string;
  product_sku: string;
  unit: string;
  category_id: string | null;
  category_name: string | null;

  analysis_days: number;
  plan_days: number;
  period_sales_qty: number;
  avg_daily_sales: number;
  current_stock: number;
  stock_days: number;
  shortage_qty: number;
  safety_qty: number;
  recommended_qty: number;
  status: Status;
};

function roundDisplay(n: number, unit: string) {
  const u = String(unit || '').toLowerCase();
  const x = Number(n || 0) || 0;
  if (u === 'kg') return x.toFixed(3).replace(/\.?0+$/, '');
  return String(Math.round(x));
}

export default function PurchasePlanningReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PurchasePlanningRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [analysisDays, setAnalysisDays] = useState<'7' | '14' | '30'>('7');
  const [planDays, setPlanDays] = useState<'7' | '14'>('7');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [onlyRisk, setOnlyRisk] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisDays, planDays, categoryId, onlyRisk]);

  async function loadData() {
    try {
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }
      setLoading(true);

      const [cats, data] = await Promise.all([
        getCategories().catch(() => [] as Category[]),
        (async () => {
          const api = requireElectron();
          return handleIpcResponse<PurchasePlanningRow[]>(
            api.reports?.purchasePlanning?.({
              analysis_days: Number(analysisDays),
              plan_days: Number(planDays),
              date_to: todayYMD(),
              category_id: categoryId !== 'all' ? categoryId : undefined,
              only_risk: onlyRisk,
            }) || Promise.resolve([])
          );
        })(),
      ]);

      setCategories(Array.isArray(cats) ? cats : []);
      setRows(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('[PurchasePlanningReport] loadData error:', error);
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

  const filtered = useMemo(() => {
    const term = String(searchTerm || '').trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => {
      return (
        String(r.product_name || '').toLowerCase().includes(term) ||
        String(r.product_sku || '').toLowerCase().includes(term)
      );
    });
  }, [rows, searchTerm]);

  const summary = useMemo(() => {
    const shortageCount = filtered.filter((r) => r.status === 'SHORTAGE').length;
    const riskCount = filtered.filter((r) => r.status === 'RISK').length;
    const okCount = filtered.filter((r) => r.status === 'OK').length;
    const totalRecommended = filtered.reduce((sum, r) => sum + Number(r.recommended_qty || 0), 0);
    return { shortageCount, riskCount, okCount, totalRecommended };
  }, [filtered]);

  const getStatusBadge = (status: Status) => {
    if (status === 'SHORTAGE') return <Badge className="bg-destructive text-white">Yetmaydi</Badge>;
    if (status === 'RISK') return <Badge className="bg-warning text-white">Xavf</Badge>;
    return <Badge className="bg-success text-white">Yetadi</Badge>;
  };

  const handlePrint = () => window.print();

  const handleExportCsv = async () => {
    try {
      if (!isElectron()) {
        toast({ title: 'Xatolik', description: 'Eksport faqat desktop ilovada mavjud.', variant: 'destructive' });
        return;
      }
      const api = requireElectron();
      const headers = [
        'product_name',
        'sku',
        'unit',
        `sales_${analysisDays}d`,
        'avg_daily_sales',
        'current_stock',
        'stock_days',
        `plan_${planDays}d`,
        'shortage_qty',
        'recommended_qty',
        'status',
      ];

      const escape = (v: any) => {
        const s = String(v ?? '');
        if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const lines = [
        headers.join(','),
        ...filtered.map((r) =>
          [
            r.product_name,
            r.product_sku,
            r.unit,
            r.period_sales_qty,
            r.avg_daily_sales,
            r.current_stock,
            r.stock_days,
            r.plan_days,
            r.shortage_qty,
            r.recommended_qty,
            r.status,
          ]
            .map(escape)
            .join(',')
        ),
      ];

      await api.files.saveTextFile({
        defaultFileName: `purchase-planning-${analysisDays}d-to-plan-${planDays}d-${todayYMD()}.csv`,
        content: lines.join('\n'),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        encoding: 'utf8',
      });

      toast({ title: 'Tayyor', description: 'CSV eksport qilindi.' });
    } catch (error: any) {
      console.error('[PurchasePlanningReport] export error:', error);
      toast({ title: 'Xatolik', description: error?.message || "Eksportni bajarib bo'lmadi", variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Print-only view: shopping list (only red/yellow by default)
  const printList = filtered.filter((r) => r.status !== 'OK' && Number(r.recommended_qty || 0) > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Bozorga borish hisoboti</h1>
            <p className="text-muted-foreground">
              Oxirgi {analysisDays} kun sotuv + reja {planDays} kun (zaxira: 2 kun) — asosiy ombor
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            PDF / Print
          </Button>
          <Button variant="outline" onClick={handleExportCsv} disabled={!filtered.length}>
            <FileDown className="h-4 w-4 mr-2" />
            CSV
          </Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Nomi / SKU..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Sotuv tahlili</label>
              <Select value={analysisDays} onValueChange={(v: any) => setAnalysisDays(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Oxirgi 7 kun</SelectItem>
                  <SelectItem value="14">Oxirgi 14 kun</SelectItem>
                  <SelectItem value="30">Oxirgi 30 kun</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Reja davri</label>
              <Select value={planDays} onValueChange={(v: any) => setPlanDays(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Keyingi 7 kun</SelectItem>
                  <SelectItem value="14">Keyingi 14 kun</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Kategoriya</label>
              <Select value={categoryId} onValueChange={(v) => setCategoryId(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Hammasi</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button
                variant={onlyRisk ? 'default' : 'outline'}
                className="w-full"
                onClick={() => setOnlyRisk((v) => !v)}
              >
                {onlyRisk ? 'Faqat 🔴/🟡' : 'Barchasi'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">🔴 Yetmaydi</div>
              <div className="text-xl font-bold">{summary.shortageCount}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">🟡 Xavf</div>
              <div className="text-xl font-bold">{summary.riskCount}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">🟢 Yetadi</div>
              <div className="text-xl font-bold">{summary.okCount}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Tavsiya (jami)</div>
              <div className="text-xl font-bold">{summary.totalRecommended.toFixed(2)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Ma’lumot topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mahsulot</TableHead>
                  <TableHead>Birlik</TableHead>
                  <TableHead className="text-right">Oxirgi {analysisDays} kun sotuv</TableHead>
                  <TableHead className="text-right">Kunlik o‘rtacha</TableHead>
                  <TableHead className="text-right">Omborda</TableHead>
                  <TableHead className="text-right">Yetadigan kun</TableHead>
                  <TableHead className="text-right">Reja</TableHead>
                  <TableHead className="text-right">Yetishmovchilik</TableHead>
                  <TableHead className="text-right">Tavsiya</TableHead>
                  <TableHead className="text-center">Holat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.product_id}>
                    <TableCell>
                      <div className="font-medium">{r.product_name}</div>
                      <div className="text-xs text-muted-foreground">SKU: {r.product_sku}</div>
                    </TableCell>
                    <TableCell>{formatUnit(r.unit)}</TableCell>
                    <TableCell className="text-right">{roundDisplay(r.period_sales_qty, r.unit)}</TableCell>
                    <TableCell className="text-right">{roundDisplay(r.avg_daily_sales, r.unit)}</TableCell>
                    <TableCell className="text-right">{roundDisplay(r.current_stock, r.unit)}</TableCell>
                    <TableCell className="text-right">
                      {r.stock_days === Infinity ? '∞' : Number(r.stock_days || 0).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right">{r.plan_days} kun</TableCell>
                    <TableCell className="text-right">{roundDisplay(r.shortage_qty, r.unit)}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {roundDisplay(r.recommended_qty, r.unit)}
                    </TableCell>
                    <TableCell className="text-center">{getStatusBadge(r.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Print-only */}
      <div className="hidden print:block space-y-3">
        <div>
          <div className="text-xl font-bold">BOZORGA BORISH RO‘YXATI</div>
          <div className="text-sm text-muted-foreground">
            Sana: {todayYMD()} | Sotuv tahlili: {analysisDays} kun | Reja: {planDays} kun | Zaxira: 2 kun
          </div>
        </div>
        <ol className="list-decimal pl-5 space-y-1">
          {printList.map((r) => (
            <li key={r.product_id}>
              {r.product_name} — {roundDisplay(r.recommended_qty, r.unit)} {formatUnit(r.unit)} (
              {r.status === 'SHORTAGE' ? 'Yetmaydi' : 'Xavf'})
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

