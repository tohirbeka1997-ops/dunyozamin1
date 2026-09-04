import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowLeft, FileDown, Printer, ShoppingCart } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { getCategories } from '@/db/api';
import type { Category } from '@/types/database';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useReportFilters } from '@/hooks/useReportFilters';
import { useDebounce } from '@/hooks/use-debounce';
import { todayYMD } from '@/lib/datetime';
import { formatUnit } from '@/utils/formatters';
import { formatQuantity } from '@/utils/quantity';
import { formatMoney } from '@/lib/currency';
import { useAuth } from '@/contexts/AuthContext';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type PlanStatus = 'OK' | 'RISK' | 'SHORTAGE' | 'NO_SALES' | 'INSUFFICIENT_DATA';

type PurchasePlanningRow = {
  product_id: string;
  product_name: string;
  product_sku: string;
  unit: string;
  category_id: string | null;
  category_name: string | null;
  analysis_days: number;
  plan_days: number;
  safety_days: number;
  period_sales_qty: number;
  avg_daily_sales: number;
  avg_daily_sales_exact: string;
  forecast_demand_qty: number;
  safety_qty: number;
  on_hand_qty: number;
  reserved_qty: number;
  blocked_qty: number;
  confirmed_inbound_qty: number;
  in_transfer_qty: number;
  revision_qty: number;
  available_qty: number;
  recommended_qty: number;
  rounding_rule: string;
  unit_precision: number;
  status: PlanStatus;
  recommend_zero_reason: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  last_purchase_cost: number | null;
  last_purchase_date: string | null;
  lead_time_days: number | null;
  moq: number | null;
  order_step: number | null;
  recommended_value: number | null;
  currency: string;
  price_change_pct: number | null;
  current_stock?: number;
};

type PlanningResult = {
  rows: PurchasePlanningRow[];
  totals: {
    row_count: number;
    recommended_qty: number;
    recommended_value_uzs: number;
    recommended_value_usd: number;
    status_counts: Record<PlanStatus, number>;
  };
  meta: {
    analysis_days: number;
    plan_days: number;
    safety_days: number;
    timezone: string;
    as_of: string;
    calc_ms: number;
    formula: string;
    search?: string;
    only_risk?: boolean;
  };
};

type PreviewGroup = {
  supplier_id: string | null;
  supplier_name: string | null;
  currency: string;
  can_create: boolean;
  total_qty: number;
  total_value: number;
  items: Array<{
    product_id: string;
    product_name: string;
    ordered_qty: number;
    unit_cost: number | null;
    line_total: number | null;
  }>;
};

function qtyLabel(n: number | null | undefined, unit: string, precision?: number) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const p = precision ?? (unit ? undefined : 3);
  if (typeof p === 'number') return formatQuantity(Number(n), p);
  return formatQuantity(Number(n), unit);
}

function statusBadge(status: PlanStatus) {
  if (status === 'SHORTAGE') return <Badge className="bg-destructive text-white">🔴 Yetmaydi</Badge>;
  if (status === 'RISK') return <Badge className="bg-warning text-white">🟡 Xavf</Badge>;
  if (status === 'OK') return <Badge className="bg-success text-white">🟢 Yetadi</Badge>;
  if (status === 'NO_SALES') return <Badge variant="outline">⚪ Sotuv yo‘q</Badge>;
  return <Badge className="bg-zinc-800 text-white">⚫ Ma’lumot yetarli emas</Badge>;
}

export default function PurchasePlanningReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const { get, set, restored } = useReportFilters({
    storageKey: 'report:purchase-planning',
    trackedKeys: ['q', 'analysis', 'plan', 'cat', 'risk', 'sort', 'page'],
    defaults: { analysis: '7', plan: '7', risk: '1', page: '1' },
  });

  const searchTerm = get('q', '');
  const debouncedSearch = useDebounce(searchTerm, 300);
  const analysisDays = (get('analysis', '7') as '7' | '14' | '30') || '7';
  const planDays = (get('plan', '7') as '7' | '14') || '7';
  const categoryId = get('cat', 'all') || 'all';
  const onlyRisk = get('risk', '1') !== '0';
  const sortBy = get('sort', 'status') || 'status';
  const page = Math.max(1, Number(get('page', '1')) || 1);

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<PlanningResult | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{
    groups: PreviewGroup[];
    open_orders: Array<{ po_number: string; product_name: string; status: string; ordered_qty: number }>;
    duplicate_product_ids: string[];
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const reqIdRef = useRef(0);

  const loadData = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    try {
      if (!isElectron()) throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      setLoading(true);
      const api = requireElectron();
      const [cats, data] = await Promise.all([
        getCategories().catch(() => [] as Category[]),
        handleIpcResponse<PlanningResult>(
          api.reports?.purchasePlanning?.({
            analysis_days: Number(analysisDays),
            plan_days: Number(planDays),
            date_to: todayYMD(),
            category_id: categoryId !== 'all' ? categoryId : undefined,
            only_risk: onlyRisk,
            search: debouncedSearch,
            sort_by: sortBy,
            page,
          }) || Promise.resolve(null),
        ),
      ]);
      if (reqId !== reqIdRef.current) return;
      setCategories(Array.isArray(cats) ? cats : []);
      if (data && Array.isArray((data as PlanningResult).rows)) {
        setResult(data as PlanningResult);
      } else if (Array.isArray(data)) {
        setResult({
          rows: data as PurchasePlanningRow[],
          totals: {
            row_count: (data as PurchasePlanningRow[]).length,
            recommended_qty: 0,
            recommended_value_uzs: 0,
            recommended_value_usd: 0,
            status_counts: { SHORTAGE: 0, RISK: 0, OK: 0, NO_SALES: 0, INSUFFICIENT_DATA: 0 },
          },
          meta: {
            analysis_days: Number(analysisDays),
            plan_days: Number(planDays),
            safety_days: 2,
            timezone: 'Asia/Tashkent',
            as_of: new Date().toISOString(),
            calc_ms: 0,
            formula: '',
          },
        });
      } else {
        setResult(null);
      }
    } catch (error: any) {
      if (reqId !== reqIdRef.current) return;
      console.error('[PurchasePlanningReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setResult(null);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [analysisDays, planDays, categoryId, onlyRisk, debouncedSearch, sortBy, page, toast]);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    if (!restored) return;
    void loadData();
  }, [loadData, restored]);

  const rows = result?.rows || [];
  const totals = result?.totals;
  const meta = result?.meta;

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected],
  );

  const exportRows = rows;
  const exportMeta = meta;

  const handlePrint = () => window.print();

  const formulaLines = (meta?.formula || '').split('\n').filter(Boolean);

  const buildExportMatrix = () => {
    const headers = [
      'product',
      'sku',
      'unit',
      'analysis_days',
      'sold_qty',
      'avg_daily_exact',
      'forecast_demand',
      'safety_stock',
      'on_hand',
      'reserved',
      'blocked',
      'inbound',
      'in_transfer',
      'revision',
      'available',
      'recommended_qty',
      'rounding_rule',
      'supplier',
      'last_cost',
      'last_purchase_date',
      'lead_time',
      'moq',
      'order_step',
      'recommended_value',
      'currency',
      'price_change_pct',
      'status',
    ];
    const body = exportRows.map((r) => [
      r.product_name,
      r.product_sku,
      r.unit,
      r.analysis_days,
      r.period_sales_qty,
      r.avg_daily_sales_exact,
      r.forecast_demand_qty,
      r.safety_qty,
      r.on_hand_qty,
      r.reserved_qty,
      r.blocked_qty,
      r.confirmed_inbound_qty,
      r.in_transfer_qty,
      r.revision_qty,
      r.available_qty,
      r.recommended_qty,
      r.rounding_rule,
      r.supplier_name,
      r.last_purchase_cost,
      r.last_purchase_date,
      r.lead_time_days,
      r.moq,
      r.order_step,
      r.recommended_value,
      r.currency,
      r.price_change_pct,
      r.status,
    ]);
    return { headers, body };
  };

  const handleExportCsv = async () => {
    try {
      if (!isElectron()) {
        toast({ title: 'Xatolik', description: 'Eksport faqat desktop ilovada mavjud.', variant: 'destructive' });
        return;
      }
      const api = requireElectron();
      const { headers, body } = buildExportMatrix();
      const escape = (v: unknown) => {
        const s = String(v ?? '');
        if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const paramLines = [
        `# Bozorga borish`,
        `# timezone=${exportMeta?.timezone || ''}`,
        `# as_of=${exportMeta?.as_of || ''}`,
        `# calc_ms=${exportMeta?.calc_ms ?? ''}`,
        `# analysis_days=${analysisDays}; plan_days=${planDays}; safety_days=${exportMeta?.safety_days ?? 2}`,
        `# search=${debouncedSearch}; category=${categoryId}; only_risk=${onlyRisk}`,
        `# formula=${(exportMeta?.formula || '').replace(/\n/g, ' | ')}`,
        `# totals_recommended_qty=${totals?.recommended_qty ?? ''}; row_count=${totals?.row_count ?? ''}`,
      ];
      const lines = [...paramLines, headers.join(','), ...body.map((row) => row.map(escape).join(','))];
      await api.files.saveTextFile({
        defaultFileName: `purchase-planning-${analysisDays}d-${todayYMD()}.csv`,
        content: lines.join('\n'),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        encoding: 'utf8',
      });
      toast({ title: 'Tayyor', description: 'CSV eksport qilindi.' });
    } catch (error: any) {
      toast({ title: 'Xatolik', description: error?.message || "Eksportni bajarib bo'lmadi", variant: 'destructive' });
    }
  };

  const handleExportXlsx = () => {
    const { headers, body } = buildExportMatrix();
    const wb = XLSX.utils.book_new();
    const params = [
      ['Hisobot', 'Bozorga borish'],
      ['Timezone', exportMeta?.timezone || ''],
      ['As of', exportMeta?.as_of || ''],
      ['Calc ms', exportMeta?.calc_ms ?? ''],
      ['Analysis days', analysisDays],
      ['Plan days', planDays],
      ['Safety days', exportMeta?.safety_days ?? 2],
      ['Search', debouncedSearch],
      ['Category', categoryId],
      ['Only risk', String(onlyRisk)],
      ['Formula', exportMeta?.formula || ''],
      ['Row count', totals?.row_count ?? 0],
      ['Total recommended qty', totals?.recommended_qty ?? 0],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(params), 'Params');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...body]), 'Rows');
    XLSX.writeFile(wb, `purchase-planning-${analysisDays}d-${todayYMD()}.xlsx`);
  };

  const handleExportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text('Bozorga borish hisoboti', 14, 12);
    doc.setFontSize(8);
    doc.text(
      `TZ ${meta?.timezone || ''} | as of ${meta?.as_of || ''} | ${meta?.calc_ms ?? 0} ms | tahlil ${analysisDays} | reja ${planDays} | qidiruv="${debouncedSearch}" | faqat risk=${onlyRisk}`,
      14,
      18,
    );
    autoTable(doc, {
      startY: 22,
      head: [['Mahsulot', 'SKU', 'Tavsiya', 'Mavjud', 'Holat', 'Yetkazuvchi']],
      body: exportRows.map((r) => [
        r.product_name,
        r.product_sku,
        String(r.recommended_qty),
        String(r.available_qty),
        r.status,
        r.supplier_name || '',
      ]),
      styles: { fontSize: 7 },
    });
    doc.save(`purchase-planning-${todayYMD()}.pdf`);
  };

  async function openPreview() {
    try {
      if (!isElectron()) throw new Error('Faqat desktop');
      const api = requireElectron();
      const data = await handleIpcResponse<any>(
        api.purchases?.previewPlanningDraft?.({
          product_ids: selectedIds,
          planning_filters: {
            analysis_days: Number(analysisDays),
            plan_days: Number(planDays),
            date_to: todayYMD(),
            category_id: categoryId !== 'all' ? categoryId : undefined,
          },
        }),
      );
      setPreview(data);
      setPreviewOpen(true);
    } catch (error: any) {
      toast({ title: 'Xatolik', description: error?.message || 'Preview ochilmadi', variant: 'destructive' });
    }
  }

  async function confirmCreateDraft() {
    try {
      if (!isElectron()) return;
      setCreating(true);
      const api = requireElectron();
      const data = await handleIpcResponse<any>(
        api.purchases?.createPlanningDraft?.({
          product_ids: selectedIds,
          confirm: true,
          created_by: user?.id,
          planning_filters: {
            analysis_days: Number(analysisDays),
            plan_days: Number(planDays),
            date_to: todayYMD(),
            category_id: categoryId !== 'all' ? categoryId : undefined,
          },
        }),
      );
      toast({
        title: 'Draft yaratildi',
        description: `${(data?.created || []).map((x: any) => x.po_number).join(', ') || 'OK'}`,
      });
      setPreviewOpen(false);
      setSelected({});
      void loadData();
    } catch (error: any) {
      toast({ title: 'Xatolik', description: error?.message || 'Draft yaratilmadi', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  }

  const printList = rows.filter((r) => (r.status === 'SHORTAGE' || r.status === 'RISK') && Number(r.recommended_qty) > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/inventory')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">Bozorga borish hisoboti</h1>
            <p className="text-muted-foreground text-sm">
              Tahlil {analysisDays} kun · reja {planDays} kun · zaxira {meta?.safety_days ?? 2} kun
              {meta ? ` · ${meta.timezone} · ${meta.calc_ms} ms · ${meta.as_of}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            PDF / Print
          </Button>
          <Button variant="outline" onClick={handleExportPdf} disabled={!rows.length}>
            PDF
          </Button>
          <Button variant="outline" onClick={handleExportXlsx} disabled={!rows.length}>
            Excel
          </Button>
          <Button variant="outline" onClick={handleExportCsv} disabled={!rows.length}>
            <FileDown className="h-4 w-4 mr-2" />
            CSV
          </Button>
          <Button onClick={() => void openPreview()} disabled={!selectedIds.length}>
            <ShoppingCart className="h-4 w-4 mr-2" />
            Draft PO ({selectedIds.length})
          </Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Nomi / SKU..."
                value={searchTerm}
                onChange={(e) => set({ q: e.target.value || null, page: '1' })}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Sotuv tahlili</label>
              <Select value={analysisDays} onValueChange={(v) => set({ analysis: v, page: '1' })}>
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
              <Select value={planDays} onValueChange={(v) => set({ plan: v, page: '1' })}>
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
              <Select value={categoryId} onValueChange={(v) => set({ cat: v === 'all' ? null : v, page: '1' })}>
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
            <div>
              <label className="text-sm text-muted-foreground">Saralash</label>
              <Select value={sortBy} onValueChange={(v) => set({ sort: v, page: '1' })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="status">Holat</SelectItem>
                  <SelectItem value="recommended_qty">Tavsiya</SelectItem>
                  <SelectItem value="name">Nomi</SelectItem>
                  <SelectItem value="sku">SKU</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                variant={onlyRisk ? 'default' : 'outline'}
                className={`w-full ${onlyRisk ? 'ring-2 ring-destructive/70' : ''}`}
                onClick={() => set({ risk: onlyRisk ? '0' : '1', page: '1' })}
              >
                {onlyRisk ? 'Faqat 🔴/🟡 — YOQIQ' : 'Faqat 🔴/🟡 — o‘chiq (barchasi)'}
              </Button>
            </div>
          </div>

          {formulaLines.length > 0 && (
            <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{meta?.formula}</pre>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">🔴 Yetmaydi</div>
              <div className="text-xl font-bold">{totals?.status_counts?.SHORTAGE ?? 0}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">🟡 Xavf</div>
              <div className="text-xl font-bold">{totals?.status_counts?.RISK ?? 0}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">🟢 Yetadi</div>
              <div className="text-xl font-bold">{totals?.status_counts?.OK ?? 0}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">⚪ / ⚫</div>
              <div className="text-xl font-bold">
                {(totals?.status_counts?.NO_SALES ?? 0) + (totals?.status_counts?.INSUFFICIENT_DATA ?? 0)}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Tavsiya jami (qatorlar yig‘indisi)</div>
              <div className="text-xl font-bold">{totals?.recommended_qty ?? 0}</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            🟢 Yetadi mahsulotlarda tavsiya 0: mavjud zaxira reja + xavfsizlik zaxirasini qoplaydi. Holat
            hisoblari jadvaldagi qatorlarga mos.
          </p>
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="flex justify-center items-center min-h-[240px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Ma’lumot topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Mahsulot</TableHead>
                  <TableHead>Tahlil kun</TableHead>
                  <TableHead className="text-right">Sotuv</TableHead>
                  <TableHead className="text-right">Kunlik (aniq)</TableHead>
                  <TableHead className="text-right">Reja talabi</TableHead>
                  <TableHead className="text-right">Xavfsizlik</TableHead>
                  <TableHead className="text-right">Omborda</TableHead>
                  <TableHead className="text-right">Rezerv</TableHead>
                  <TableHead className="text-right">Blok</TableHead>
                  <TableHead className="text-right">Kirim PO</TableHead>
                  <TableHead className="text-right">Transfer</TableHead>
                  <TableHead className="text-right">Reviziya</TableHead>
                  <TableHead className="text-right">Mavjud</TableHead>
                  <TableHead className="text-right">Tavsiya</TableHead>
                  <TableHead>Yaxlitlash</TableHead>
                  <TableHead>Yetkazuvchi</TableHead>
                  <TableHead className="text-right">Oxirgi tannarx</TableHead>
                  <TableHead>Oxirgi xarid</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>MOQ / qadam</TableHead>
                  <TableHead className="text-right">Tavsiya summa</TableHead>
                  <TableHead>Holat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.product_id}>
                    <TableCell>
                      <Checkbox
                        checked={!!selected[r.product_id]}
                        disabled={!(Number(r.recommended_qty) > 0)}
                        onCheckedChange={(v) =>
                          setSelected((prev) => ({ ...prev, [r.product_id]: v === true }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.product_name}</div>
                      <div className="text-xs text-muted-foreground">
                        SKU: {r.product_sku} · {formatUnit(r.unit)}
                      </div>
                    </TableCell>
                    <TableCell>{r.analysis_days}</TableCell>
                    <TableCell className="text-right">{qtyLabel(r.period_sales_qty, r.unit, r.unit_precision)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.avg_daily_sales_exact}</TableCell>
                    <TableCell className="text-right">{qtyLabel(r.forecast_demand_qty, r.unit, r.unit_precision)}</TableCell>
                    <TableCell className="text-right">{qtyLabel(r.safety_qty, r.unit, r.unit_precision)}</TableCell>
                    <TableCell className="text-right">{qtyLabel(r.on_hand_qty, r.unit, r.unit_precision)}</TableCell>
                    <TableCell className="text-right">{qtyLabel(r.reserved_qty, r.unit, r.unit_precision)}</TableCell>
                    <TableCell className="text-right">{qtyLabel(r.blocked_qty, r.unit, r.unit_precision)}</TableCell>
                    <TableCell className="text-right">{qtyLabel(r.confirmed_inbound_qty, r.unit, r.unit_precision)}</TableCell>
                    <TableCell className="text-right">{qtyLabel(r.in_transfer_qty, r.unit, r.unit_precision)}</TableCell>
                    <TableCell className="text-right">{qtyLabel(r.revision_qty, r.unit, r.unit_precision)}</TableCell>
                    <TableCell className="text-right">{qtyLabel(r.available_qty, r.unit, r.unit_precision)}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {qtyLabel(r.recommended_qty, r.unit, r.unit_precision)}
                      {r.status === 'OK' && r.recommend_zero_reason ? (
                        <div className="text-[10px] font-normal text-muted-foreground max-w-[140px]">
                          {r.recommend_zero_reason}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs max-w-[140px]">{r.rounding_rule}</TableCell>
                    <TableCell className="text-sm">{r.supplier_name || '—'}</TableCell>
                    <TableCell className="text-right">
                      {r.last_purchase_cost == null
                        ? '—'
                        : formatMoney(r.last_purchase_cost, r.currency === 'USD' ? 'USD' : 'UZS')}
                    </TableCell>
                    <TableCell className="text-xs">{r.last_purchase_date ? String(r.last_purchase_date).slice(0, 10) : '—'}</TableCell>
                    <TableCell>{r.lead_time_days ?? '—'}</TableCell>
                    <TableCell className="text-xs">
                      {r.moq ?? '—'} / {r.order_step ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.recommended_value == null
                        ? '—'
                        : formatMoney(r.recommended_value, r.currency === 'USD' ? 'USD' : 'UZS')}
                      {r.price_change_pct != null ? (
                        <div className="text-[10px] text-muted-foreground">
                          {r.price_change_pct > 0 ? '+' : ''}
                          {r.price_change_pct.toFixed(2)}%
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-center">{statusBadge(r.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="hidden print:block space-y-3">
        <div>
          <div className="text-xl font-bold">BOZORGA BORISH RO‘YXATI</div>
          <div className="text-sm">
            {todayYMD()} | tahlil {analysisDays} | reja {planDays} | {meta?.timezone} | {meta?.as_of}
          </div>
        </div>
        <ol className="list-decimal pl-5 space-y-1">
          {printList.map((r) => (
            <li key={r.product_id}>
              {r.product_name} — {qtyLabel(r.recommended_qty, r.unit, r.unit_precision)} {formatUnit(r.unit)} (
              {r.status === 'SHORTAGE' ? 'Yetmaydi' : 'Xavf'})
            </li>
          ))}
        </ol>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Draft xarid buyurtmasi — tasdiq</DialogTitle>
            <DialogDescription>
              Hisobot avtomatik PO yaratmaydi. Quyidagi guruhlar bo‘yicha DRAFT yaratiladi.
            </DialogDescription>
          </DialogHeader>
          {preview?.duplicate_product_ids?.length ? (
            <div className="text-sm rounded-md border border-warning/50 bg-warning/10 p-3">
              Ochilgan buyurtmalarda allaqachon bor mahsulotlar: {preview.duplicate_product_ids.length} ta. Mavjud
              ochiq PO: {(preview.open_orders || []).map((o) => o.po_number).filter(Boolean).slice(0, 8).join(', ') || '—'}
            </div>
          ) : null}
          <div className="space-y-4">
            {(preview?.groups || []).map((g) => (
              <div key={g.supplier_id || 'none'} className="border rounded-md p-3">
                <div className="font-medium">
                  {g.supplier_name || 'Yetkazib beruvchi yo‘q'}{' '}
                  {!g.can_create ? <span className="text-destructive text-xs">(yaratib bo‘lmaydi)</span> : null}
                </div>
                <ul className="text-sm mt-2 space-y-1">
                  {g.items.map((it) => (
                    <li key={it.product_id}>
                      {it.product_name}: {it.ordered_qty} × {it.unit_cost ?? '—'} = {it.line_total ?? '—'}
                    </li>
                  ))}
                </ul>
                <div className="text-sm mt-2 font-medium">Jami: {g.total_value} {g.currency}</div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Bekor
            </Button>
            <Button onClick={() => void confirmCreateDraft()} disabled={creating}>
              {creating ? 'Yaratilmoqda…' : 'Tasdiqlayman — DRAFT yaratish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
