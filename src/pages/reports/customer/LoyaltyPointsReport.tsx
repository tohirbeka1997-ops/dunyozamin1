import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Gift } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

type LedgerRow = { type: string; total_points: number; entry_count: number };
type TopRow = { customer_id: string; customer_name: string; customer_phone?: string; bonus_points: number };

export default function LoyaltyPointsReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [byType, setByType] = useState<LedgerRow[]>([]);
  const [topBalances, setTopBalances] = useState<TopRow[]>([]);

  async function loadData() {
    if (!isElectron()) {
      toast({
        title: 'Desktop',
        description: 'Bu hisobot faqat desktop ilovada mavjud.',
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const api = requireElectron();
      const data = await handleIpcResponse<{
        ledger_by_type: LedgerRow[];
        top_bonus_balances: TopRow[];
      }>(
        api.reports?.loyaltyPointsSummary?.({
          date_from: dateFrom,
          date_to: dateTo,
          top_limit: 25,
        }) || Promise.resolve({ ledger_by_type: [], top_bonus_balances: [] })
      );
      setByType(Array.isArray(data?.ledger_by_type) ? data.ledger_by_type : []);
      setTopBalances(Array.isArray(data?.top_bonus_balances) ? data.top_bonus_balances : []);
    } catch (e: any) {
      toast({
        title: 'Xatolik',
        description: e?.message || 'Yuklab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/reports/customer')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Gift className="h-7 w-7 text-amber-600" />
          <div>
            <h1 className="text-2xl font-bold">Bonus ball hisoboti</h1>
            <p className="text-muted-foreground text-sm">Ledger yig‘indilari va eng ko‘p balli mijozlar</p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Davr</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label htmlFor="loy-from">Dan</Label>
            <Input id="loy-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="loy-to">Gacha</Label>
            <Input id="loy-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <Button onClick={() => loadData()} disabled={loading}>
            Yangilash
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ledger (tanlangan davr)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-sm">Yuklanmoqda...</p>
            ) : byType.length === 0 ? (
              <p className="text-muted-foreground text-sm">Ma’lumot yo‘q</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tur</TableHead>
                    <TableHead className="text-right">Ball (yig‘indi)</TableHead>
                    <TableHead className="text-right">Yozuvlar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byType.map((r) => (
                    <TableRow key={r.type}>
                      <TableCell>
                        {r.type === 'earn' ? 'Yig‘ish' : r.type === 'redeem' ? 'Ishlatish' : r.type === 'adjust' ? 'Korreksiya' : r.type}
                      </TableCell>
                      <TableCell className="text-right font-mono">{Number(r.total_points).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{r.entry_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Eng ko‘p bonus balansi</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-sm">Yuklanmoqda...</p>
            ) : topBalances.length === 0 ? (
              <p className="text-muted-foreground text-sm">Mijozlar yo‘q</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mijoz</TableHead>
                    <TableHead>Telefon</TableHead>
                    <TableHead className="text-right">Ball</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topBalances.map((r) => (
                    <TableRow key={r.customer_id}>
                      <TableCell className="font-medium">{r.customer_name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.customer_phone || '—'}</TableCell>
                      <TableCell className="text-right font-mono">{Math.round(Number(r.bonus_points) || 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
