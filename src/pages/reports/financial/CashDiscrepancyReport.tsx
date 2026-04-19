import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { formatDateYMD, todayYMD } from '@/lib/datetime';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import type { CashDiscrepancyRow } from '@/types/financialReports';
import { getShifts } from '@/db/api';

export default function CashDiscrepancyReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [dateFrom, setDateFrom] = useState(todayYMD());
  const [dateTo, setDateTo] = useState(todayYMD());
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CashDiscrepancyRow[]>([]);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  async function loadData() {
    try {
      setLoading(true);
      let data: CashDiscrepancyRow[] | null = null;
      if (isElectron()) {
        try {
          const api = requireElectron();
          const res = await handleIpcResponse<CashDiscrepancyRow[]>(
            api.reports.cashDiscrepancies({
              date_from: dateFrom,
              date_to: dateTo,
            })
          );
          data = Array.isArray(res) ? res : [];
        } catch (error: any) {
          console.warn('[CashDiscrepancyReport] IPC cashDiscrepancies failed, using fallback:', error);
        }
      }

      if (!data || data.length === 0) {
        data = await buildFallbackRows();
      }

      setRows(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('[CashDiscrepancyReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  const buildFallbackRows = async (): Promise<CashDiscrepancyRow[]> => {
    const shifts = await getShifts(1000);
    const inRange = (ymd: string) => ymd >= dateFrom && ymd <= dateTo;

    const byCashier = new Map<string, CashDiscrepancyRow>();
    for (const s of shifts || []) {
      if (s.status !== 'closed') continue;
      const closedAt = s.closed_at || s.opened_at;
      const ymd = formatDateYMD(closedAt);
      if (!ymd || !inRange(ymd)) continue;

      const diff =
        Number(s.cash_difference ?? 0) ||
        (Number(s.closing_cash ?? 0) - Number(s.expected_cash ?? 0));
      const over = diff > 0 ? diff : 0;
      const short = diff < 0 ? Math.abs(diff) : 0;
      const key = String(s.cashier_id || 'unknown');
      const existing =
        byCashier.get(key) || ({
          user_id: key,
          cashier_name: (s as any)?.cashier?.full_name || (s as any)?.cashier_name || key,
          shift_count: 0,
          sum_diff: 0,
          over_amount: 0,
          short_amount: 0,
          avg_diff: 0,
          last_closed_at: null,
        } as CashDiscrepancyRow);

      existing.shift_count += 1;
      existing.sum_diff += diff;
      existing.over_amount += over;
      existing.short_amount += short;
      existing.avg_diff = existing.shift_count > 0 ? existing.sum_diff / existing.shift_count : 0;
      if (!existing.last_closed_at || String(existing.last_closed_at) < String(closedAt || '')) {
        existing.last_closed_at = closedAt || existing.last_closed_at;
      }
      byCashier.set(key, existing);
    }

    return Array.from(byCashier.values());
  };

  const totals = useMemo(() => {
    const over = rows.reduce((sum, r) => sum + Number(r.over_amount || 0), 0);
    const short = rows.reduce((sum, r) => sum + Number(r.short_amount || 0), 0);
    const net = rows.reduce((sum, r) => sum + Number(r.sum_diff || 0), 0);
    return { over, short, net };
  }, [rows]);

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
            <h1 className="text-3xl font-bold">Kassa tafovutlari</h1>
            <p className="text-muted-foreground">Kassir bo‘yicha ortiqcha / kamomad</p>
          </div>
        </div>
        <Button variant="outline" onClick={loadData}>
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sana</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sana</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="flex items-end gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <div className="text-sm text-muted-foreground">
                Net: <span className="font-medium">{formatMoneyUZS(totals.net)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Ortiqcha (jami)</p>
            <p className="text-2xl font-bold text-success">{formatMoneyUZS(totals.over)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Kamomad (jami)</p>
            <p className="text-2xl font-bold text-destructive">{formatMoneyUZS(totals.short)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Net tafovut</p>
            <p className={`text-2xl font-bold ${totals.net >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatMoneyUZS(totals.net)}
            </p>
          </CardContent>
        </Card>
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
                  <TableHead>Kassir</TableHead>
                  <TableHead className="text-right">Smenalar</TableHead>
                  <TableHead className="text-right">Ortiqcha</TableHead>
                  <TableHead className="text-right">Kamomad</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">O‘rtacha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.user_id}>
                    <TableCell className="font-medium">{r.cashier_name}</TableCell>
                    <TableCell className="text-right">{Number(r.shift_count || 0)}</TableCell>
                    <TableCell className="text-right text-success">{formatMoneyUZS(Number(r.over_amount || 0))}</TableCell>
                    <TableCell className="text-right text-destructive">{formatMoneyUZS(Number(r.short_amount || 0))}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${Number(r.sum_diff || 0) >= 0 ? 'text-success' : 'text-destructive'}`}
                    >
                      {formatMoneyUZS(Number(r.sum_diff || 0))}
                    </TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(Number(r.avg_diff || 0))}</TableCell>
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

