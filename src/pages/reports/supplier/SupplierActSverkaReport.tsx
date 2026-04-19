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
import { ArrowLeft, FileDown, RefreshCcw, Truck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { todayYMD } from '@/lib/datetime';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { getSuppliers } from '@/db/api';
import type { SupplierWithBalance } from '@/types/database';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';

type ActRow = {
  id: string;
  created_at: string;
  type: 'purchase' | 'payment' | 'credit_note' | string;
  ref_no?: string | null;
  amount: number; // signed delta ( + increases debt, - decreases debt )
  in_amount: number;
  out_amount: number;
  balance_after: number;
  method?: string | null;
  note?: string | null;
  created_by_name?: string | null;
};

type ActResponse = {
  supplier: { id: string; name: string; phone?: string | null; email?: string | null; status?: string | null; settlement_currency?: 'UZS' | 'USD' | string };
  period: { date_from?: string | null; date_to?: string | null };
  opening_balance: number;
  closing_balance: number;
  totals: { in_amount: number; out_amount: number; net_amount: number };
  rows: ActRow[];
};

function formatActAmount(amount: number, currency?: string) {
  const c = String(currency || 'UZS').toUpperCase();
  if (c === 'USD') return `${Number(amount || 0).toFixed(2)} USD`;
  return formatMoneyUZS(amount || 0);
}

function toCsv(rows: ActRow[]) {
  const headers = [
    'date_time',
    'type',
    'ref_no',
    'method',
    'in_amount',
    'out_amount',
    'balance_after',
    'note',
  ];
  const escape = (v: any) => {
    const s = String(v ?? '');
    if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.created_at,
        r.type,
        r.ref_no || '',
        r.method || '',
        r.in_amount,
        r.out_amount,
        r.balance_after,
        r.note || '',
      ]
        .map(escape)
        .join(',')
    ),
  ];
  return lines.join('\n');
}

export default function SupplierActSverkaReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: 'report.supplier-act-sverka.filters.query',
    trackedKeys: ['supplierId', 'dateFrom', 'dateTo'],
  });

  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const supplierId = searchParams.get('supplierId') || '';
  const dateFrom =
    searchParams.get('dateFrom') ||
    new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0];
  const dateTo = searchParams.get('dateTo') || todayYMD();

  const [data, setData] = useState<ActResponse | null>(null);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    (async () => {
      try {
        const list = await getSuppliers(true);
        setSuppliers(Array.isArray(list) ? list : []);
      } catch (e: any) {
        setSuppliers([]);
        toast({
          title: 'Xatolik',
          description: e?.message || "Yetkazib beruvchilar ro'yxatini yuklab bo'lmadi",
          variant: 'destructive',
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (supplierId) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, dateFrom, dateTo]);

  async function loadData() {
    try {
      if (!supplierId) {
        setData(null);
        return;
      }
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }

      setLoading(true);
      const api = requireElectron();
      const res = await handleIpcResponse<ActResponse>(
        api.reports?.supplierActSverka?.({
          supplier_id: supplierId,
          date_from: dateFrom,
          date_to: dateTo,
        }) || Promise.resolve(null)
      );

      setData(res || null);
    } catch (error: any) {
      console.error('[SupplierActSverkaReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => data?.rows || [], [data]);
  const summary = useMemo(() => {
    const opening = data?.opening_balance ?? 0;
    const closing = data?.closing_balance ?? opening;
    const inAmount = data?.totals?.in_amount ?? 0;
    const outAmount = data?.totals?.out_amount ?? 0;
    const net = data?.totals?.net_amount ?? inAmount - outAmount;
    return { opening, closing, inAmount, outAmount, net };
  }, [data]);

  const actCurrency = data?.supplier?.settlement_currency || 'USD';

  const handleExportCsv = async () => {
    try {
      if (!data) return;
      if (!isElectron()) {
        toast({ title: 'Xatolik', description: 'Eksport faqat desktop ilovada mavjud.', variant: 'destructive' });
        return;
      }

      const api = requireElectron();
      const csv = toCsv(rows);
      const name = data.supplier?.name || data.supplier?.id || 'supplier';
      await api.files.saveTextFile({
        defaultFileName: `supplier-act-sverka-${name}-${dateFrom}_${dateTo}.csv`,
        content: csv,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        encoding: 'utf8',
      });
      toast({ title: 'Tayyor', description: 'CSV eksport qilindi.' });
    } catch (error: any) {
      console.error('[SupplierActSverkaReport] export error:', error);
      toast({ title: 'Xatolik', description: error?.message || "Eksportni bajarib bo'lmadi", variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Truck className="h-8 w-8 text-primary" />
              Yetkazib beruvchi akt sverka
            </h1>
            <p className="text-muted-foreground">
              Bitta yetkazib beruvchi bo‘yicha xarid va to‘lovlar (debt) timeline
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadData} disabled={!supplierId || loading}>
            <RefreshCcw className="h-4 w-4 mr-2" />
            Yangilash
          </Button>
          <Button variant="outline" onClick={handleExportCsv} disabled={!data || rows.length === 0}>
            <FileDown className="h-4 w-4 mr-2" />
            CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="text-sm text-muted-foreground">Yetkazib beruvchi</label>
              <Select value={supplierId} onValueChange={(value) => updateParams({ supplierId: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Yetkazib beruvchi tanlang..." />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} {s.phone ? `(${s.phone})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sana</label>
              <Input type="date" value={dateFrom} onChange={(e) => updateParams({ dateFrom: e.target.value })} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sana</label>
              <Input type="date" value={dateTo} onChange={(e) => updateParams({ dateTo: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center items-center min-h-[300px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : !data ? (
        <div className="text-center text-muted-foreground py-10">Yetkazib beruvchi tanlang</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Boshlang‘ich balans</div>
                <div className="text-2xl font-bold">{formatActAmount(summary.opening, actCurrency)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Kirim (qarz oshishi)</div>
                <div className="text-2xl font-bold text-primary">{formatActAmount(summary.inAmount, actCurrency)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Chiqim (to‘lov/credit note)</div>
                <div className="text-2xl font-bold text-success">{formatActAmount(summary.outAmount, actCurrency)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Yakuniy balans</div>
                <div className="text-2xl font-bold">{formatActAmount(summary.closing, actCurrency)}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="pt-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sana/vaqt</TableHead>
                      <TableHead>Turi</TableHead>
                      <TableHead>Hujjat</TableHead>
                      <TableHead className="text-right">Kirim</TableHead>
                      <TableHead className="text-right">Chiqim</TableHead>
                      <TableHead className="text-right">Balans</TableHead>
                      <TableHead>Izoh</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          Ma’lumot topilmadi
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap">{r.created_at}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {r.type === 'purchase'
                              ? 'Xarid'
                              : r.type === 'credit_note'
                                ? 'Qaytarish (credit note)'
                                : 'To‘lov'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{r.ref_no || '-'}</TableCell>
                          <TableCell className="text-right">
                            {r.in_amount > 0 ? formatActAmount(r.in_amount, actCurrency) : '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.out_amount > 0 ? formatActAmount(r.out_amount, actCurrency) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatActAmount(r.balance_after, actCurrency)}</TableCell>
                          <TableCell className="max-w-[420px] truncate" title={r.note || ''}>
                            {r.note || ''}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

