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
import { formatDateYMD, todayYMD } from '@/lib/datetime';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

type LedgerRow = { type: string; total_points: number; entry_count: number };
type TopRow = { customer_id: string; customer_name: string; customer_phone?: string; bonus_points: number };
type LoyaltyMeta = {
  general_enabled: boolean;
  master_enabled: boolean;
  earn_scope: string;
};

function defaultFrom30dTashkent(): string {
  const t = new Date();
  t.setDate(t.getDate() - 30);
  return formatDateYMD(t);
}

export default function LoyaltyPointsReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(defaultFrom30dTashkent);
  const [dateTo, setDateTo] = useState(todayYMD);
  const [byType, setByType] = useState<LedgerRow[]>([]);
  const [topBalances, setTopBalances] = useState<TopRow[]>([]);
  const [ledgerTotalRows, setLedgerTotalRows] = useState(0);
  const [loyaltyMeta, setLoyaltyMeta] = useState<LoyaltyMeta | null>(null);

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
        bonus_ledger_total_rows?: number;
        loyalty?: LoyaltyMeta;
      }>(
        api.reports?.loyaltyPointsSummary?.({
          date_from: dateFrom,
          date_to: dateTo,
          top_limit: 25,
        }) || Promise.resolve({ ledger_by_type: [], top_bonus_balances: [] })
      );
      setByType(Array.isArray(data?.ledger_by_type) ? data.ledger_by_type : []);
      setTopBalances(Array.isArray(data?.top_bonus_balances) ? data.top_bonus_balances : []);
      setLedgerTotalRows(
        typeof data?.bonus_ledger_total_rows === 'number' ? data.bonus_ledger_total_rows : 0
      );
      setLoyaltyMeta(
        data?.loyalty && typeof data.loyalty === 'object'
          ? {
              general_enabled: !!data.loyalty.general_enabled,
              master_enabled: !!data.loyalty.master_enabled,
              earn_scope: String(data.loyalty.earn_scope || 'master_only'),
            }
          : null
      );
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
            <h1 className="page-heading">Bonus ball hisoboti</h1>
            <p className="text-muted-foreground text-sm">Ledger yig‘indilari va eng ko‘p balli mijozlar</p>
          </div>
        </div>
      </div>

      {!loading && byType.length === 0 && loyaltyMeta && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Nima uchun bo‘sh ko‘rinishi mumkin?</AlertTitle>
          <AlertDescription className="space-y-2 text-muted-foreground">
            {ledgerTotalRows === 0 ? (
              <p>
                Hozircha bonus ball <span className="text-foreground">jadvali</span>da (yig‘ish/ishlatish) yozuvi
                yo‘q. Odatda <strong>Sozlamalar → Sotish</strong> bo‘limida <strong>umumiy ball yig‘ish</strong> o‘chirilgan
                yoki <strong>«Faqat usta (master)»</strong> tanlangan bo‘ladi: unda ball faqat usta (master) kategoriyadagilarga
                yig‘iladi, oddiy mijozlarga emas. Kerak bo‘lsa umumiy yig‘ishni yoqing va/ yoki <strong>harakat
                doirasini</strong> barcha ro‘yxatdan o‘tganlarga o‘rnating. Ballar faqat to‘langan sotuvlar bo‘yicha hisoblanadi
                (to‘lovsiz qarz buyurtmalar odatda ball bermaydi).
              </p>
            ) : (
              <p>
                Tanlangan davrda (Asia/Tashkent) bonus ball <strong>harakati</strong> bo‘lmagan. Boshqa davrni tanab
                <strong> Yangilash</strong> ni bosing. Agar barcha vaqtda ham yozuv bo‘lmasa, yuqoridagi sozlamalarni tekshiring.
              </p>
            )}
            {loyaltyMeta.earn_scope === 'master_only' && !loyaltyMeta.general_enabled && (
              <p className="text-foreground/90 text-xs">
                Hozirgi sozlamalar: umumiy yig‘ish = o‘chiq, doira = <code className="text-xs">fakat usta</code>
                {loyaltyMeta.master_enabled
                  ? ' (usta sotish uchun usta-loyalnost yoqilgan).'
                  : ' (ustalar uchun ham ball yoqilmagan bo‘lishi mumkin).'}
              </p>
            )}
            <p>
              <Button type="button" variant="link" className="h-auto p-0" onClick={() => navigate('/settings')}>
                Sozlamalarga o‘tish
              </Button>
            </p>
          </AlertDescription>
        </Alert>
      )}

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
