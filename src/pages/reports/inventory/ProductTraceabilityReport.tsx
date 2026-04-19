import { useEffect, useMemo, useState, Fragment } from 'react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, FileDown, Search, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS, formatNumberUZ } from '@/lib/format';
import { getProducts } from '@/db/api';
import type { ProductWithCategory } from '@/types/database';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

type LedgerAllocation = {
  batch_id: string;
  quantity: number;
  unit_cost: number;
  line_cost: number;
};

type LedgerRow = {
  movement_id: string;
  created_at: string;
  movement_type: string;
  qty_in: number;
  qty_out: number;
  reference_type: string | null;
  reference_id: string | null;
  document_no: string | null;
  from_name: string | null;
  to_name: string | null;
  unit_price: number | null;
  cost_price: number | null;
  margin: number;
  running_balance: number;
  allocations?: LedgerAllocation[];
};

type LedgerSummary = {
  total_in: number;
  total_out: number;
  ending_balance: number;
  total_margin: number;
  missing_cost_count: number;
  negative_margin_count: number;
  negative_balance_count: number;
};

export default function ProductTraceabilityReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [productId, setProductId] = useState<string>('');

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(Date.now() - 30 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  useReportAutoRefresh(() => {
    if (productId) void loadData();
  });

  useEffect(() => {
    // initial product list (top 50)
    void searchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function searchProducts() {
    try {
      setLoadingProducts(true);
      const data = await getProducts(false, { searchTerm: productSearch, limit: 50, offset: 0, sortBy: 'name', sortOrder: 'asc', stockStatus: 'all' });
      setProducts(Array.isArray(data) ? data : []);
      if (!productId && Array.isArray(data) && data.length > 0) {
        setProductId(data[0].id);
      }
    } catch (e) {
      console.error('[ProductTraceabilityReport] searchProducts error:', e);
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  }

  async function loadData() {
    try {
      if (!isElectron()) throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      if (!productId) throw new Error('Mahsulot tanlang.');
      setLoading(true);
      const api = requireElectron();
      const data = await handleIpcResponse<{ rows: LedgerRow[]; summary: LedgerSummary }>(
        api.inventory?.getProductLedger?.({
          product_id: productId,
          date_from: dateFrom,
          date_to: dateTo,
        }) || Promise.resolve([])
      );
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setSummary(data?.summary || null);
    } catch (error: any) {
      console.error('[ProductTraceabilityReport] loadData error:', error);
      toast({ title: 'Xatolik', description: error?.message || "Ma'lumotlarni yuklab bo'lmadi", variant: 'destructive' });
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  const selectedProduct = useMemo(() => products.find((p) => p.id === productId) || null, [products, productId]);

  const totals = useMemo(() => {
    const qtyIn = rows.reduce((sum, r) => sum + Number(r.qty_in || 0), 0);
    const qtyOut = rows.reduce((sum, r) => sum + Number(r.qty_out || 0), 0);
    return { qtyIn, qtyOut };
  }, [rows]);

  const eventLabel = (t: string) => {
    if (t === 'purchase') return 'Xarid (kirim)';
    if (t === 'sale') return 'Sotuv (chiqim)';
    if (t === 'return') return 'Qaytish (kirim)';
    if (t === 'supplier_return') return 'Postavshikka qaytarish (chiqim)';
    if (t === 'adjustment') return 'Korreksiya';
    return t;
  };

  const warningCount = useMemo(() => {
    if (!summary) return 0;
    return (
      Number(summary.missing_cost_count || 0) +
      Number(summary.negative_margin_count || 0) +
      Number(summary.negative_balance_count || 0)
    );
  }, [summary]);

  const handleExportCsv = async () => {
    try {
      if (!isElectron()) {
        toast({ title: 'Xatolik', description: 'Eksport faqat desktop ilovada mavjud.', variant: 'destructive' });
        return;
      }
      const api = requireElectron();
      const headers = [
        'event_at',
        'event_type',
        'doc_number',
        'from_name',
        'to_name',
        'qty_in',
        'qty_out',
        'running_balance',
        'cost_price',
        'unit_price',
        'margin',
        'warnings',
        'allocations',
      ];

      const escape = (v: any) => {
        const s = String(v ?? '');
        if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const lines = [
        headers.join(','),
        ...rows.map((r) => {
          const warnings = [
            r.qty_out > 0 && r.cost_price == null ? 'missing_cost' : '',
            r.qty_out > 0 && r.margin < 0 ? 'negative_margin' : '',
            r.running_balance < 0 ? 'negative_balance' : '',
          ].filter(Boolean).join(';');
          const allocations = (r.allocations || [])
            .map((a) => `${a.batch_id}:${a.quantity}@${a.unit_cost}`)
            .join(';');
          return [
            r.created_at,
            r.movement_type,
            r.document_no,
            r.from_name,
            r.to_name,
            r.qty_in,
            r.qty_out,
            r.running_balance,
            r.cost_price,
            r.unit_price,
            r.margin,
            warnings,
            allocations,
          ]
            .map(escape)
            .join(',');
        }),
      ];

      const sku = selectedProduct?.sku ? String(selectedProduct.sku) : 'product';
      await api.files.saveTextFile({
        defaultFileName: `traceability-${sku}-${dateFrom}-to-${dateTo}.csv`,
        content: lines.join('\n'),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        encoding: 'utf8',
      });

      toast({ title: 'Tayyor', description: 'CSV eksport qilindi.' });
    } catch (error: any) {
      console.error('[ProductTraceabilityReport] export error:', error);
      toast({ title: 'Xatolik', description: error?.message || "Eksportni bajarib bo'lmadi", variant: 'destructive' });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Mahsulot tarixi (Traceability)</h1>
            <p className="text-muted-foreground">Qachon, qancha, qaysi narxda, kimdan-kimga</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handlePrint}>
            PDF / Print
          </Button>
          <Button variant="outline" onClick={handleExportCsv} disabled={!rows.length}>
            <FileDown className="h-4 w-4 mr-2" />
            CSV
          </Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Mahsulot qidirish</label>
              <div className="flex gap-2">
                <Input
                  placeholder="Nomi / SKU / barcode..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
                <Button variant="outline" onClick={searchProducts} disabled={loadingProducts}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Mahsulot</label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Mahsulot tanlang" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm text-muted-foreground">Dan</label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Gacha</label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={loadData} disabled={!productId || loading}>
              Yuklash
            </Button>
            <Button variant="outline" onClick={() => setRows([])} disabled={loading}>
              Tozalash
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="hidden print:block">
        <h2 className="text-xl font-semibold">Mahsulot tarixi (Traceability)</h2>
        <div className="text-sm text-muted-foreground">
          Mahsulot: {selectedProduct?.name || productId} • {dateFrom} → {dateTo}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Jami kirim</div>
            <div className="text-2xl font-bold">{formatNumberUZ(totals.qtyIn)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Jami chiqim</div>
            <div className="text-2xl font-bold">{formatNumberUZ(totals.qtyOut)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Yakuniy qoldiq</div>
            <div className="text-2xl font-bold">{formatNumberUZ(summary?.ending_balance || 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Jami marja</div>
            <div className="text-2xl font-bold">{formatMoneyUZS(summary?.total_margin || 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Ogohlantirishlar</div>
            <div className="text-2xl font-bold">{warningCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center items-center min-h-[240px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Ma'lumot yo'q</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Sana</TableHead>
                  <TableHead>Hodisa</TableHead>
                  <TableHead>Hujjat</TableHead>
                  <TableHead>Kimdan</TableHead>
                  <TableHead>Kimga</TableHead>
                  <TableHead className="text-right">Kirim</TableHead>
                  <TableHead className="text-right">Chiqim</TableHead>
                  <TableHead className="text-right">Qoldiq</TableHead>
                  <TableHead className="text-right">Tannarx</TableHead>
                  <TableHead className="text-right">Narx</TableHead>
                  <TableHead className="text-right">Marja</TableHead>
                  <TableHead>Ogohlantirish</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, idx) => {
                  const rowKey = String(r.movement_id || idx);
                  const hasAllocations = Array.isArray(r.allocations) && r.allocations.length > 0;
                  const missingCost = r.qty_out > 0 && r.cost_price == null;
                  const negativeMargin = r.qty_out > 0 && r.margin < 0;
                  const negativeBalance = r.running_balance < 0;
                  const warnings = [missingCost && 'Tannarx yo‘q', negativeMargin && 'Manfiy marja', negativeBalance && 'Manfiy qoldiq']
                    .filter(Boolean)
                    .join(', ');

                  return (
                    <Fragment key={rowKey}>
                      <TableRow key={`${rowKey}-main`}>
                        <TableCell>
                          {hasAllocations ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setExpandedRows((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }))
                              }
                            >
                              {expandedRows[rowKey] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          ) : null}
                        </TableCell>
                        <TableCell>{String(r.created_at).slice(0, 10)}</TableCell>
                        <TableCell>{eventLabel(String(r.movement_type))}</TableCell>
                        <TableCell>{r.document_no || '-'}</TableCell>
                        <TableCell>{r.from_name || '-'}</TableCell>
                        <TableCell>{r.to_name || '-'}</TableCell>
                        <TableCell className="text-right">{r.qty_in ? formatNumberUZ(r.qty_in) : '-'}</TableCell>
                        <TableCell className="text-right">{r.qty_out ? formatNumberUZ(r.qty_out) : '-'}</TableCell>
                        <TableCell className="text-right">{formatNumberUZ(r.running_balance)}</TableCell>
                        <TableCell className="text-right">
                          {r.cost_price == null ? '-' : formatMoneyUZS(r.cost_price)}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.unit_price == null ? '-' : formatMoneyUZS(r.unit_price)}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.margin ? formatMoneyUZS(r.margin) : '-'}
                        </TableCell>
                        <TableCell>
                          {warnings ? (
                            <div className="flex items-center gap-2 text-destructive text-sm">
                              <AlertTriangle className="h-4 w-4" />
                              <span>{warnings}</span>
                            </div>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                      </TableRow>
                      {hasAllocations && expandedRows[rowKey] ? (
                        <TableRow key={`${rowKey}-alloc`}>
                          <TableCell colSpan={13} className="bg-muted/50">
                            <div className="text-sm font-medium mb-2">Partiya taqsimoti (FIFO)</div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Batch ID</TableHead>
                                  <TableHead className="text-right">Miqdor</TableHead>
                                  <TableHead className="text-right">Batch tannarx</TableHead>
                                  <TableHead className="text-right">Line tannarx</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(r.allocations || []).map((a) => (
                                  <TableRow key={`${rowKey}-${a.batch_id}`}>
                                    <TableCell>{a.batch_id}</TableCell>
                                    <TableCell className="text-right">{formatNumberUZ(a.quantity)}</TableCell>
                                    <TableCell className="text-right">{formatMoneyUZS(a.unit_cost)}</TableCell>
                                    <TableCell className="text-right">{formatMoneyUZS(a.line_cost)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

