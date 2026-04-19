import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getPromotionUsageReport } from '@/db/api';
import { ArrowLeft, Tag } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { formatMoneyUZS } from '@/lib/format';
import { formatDateYMD, todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

export default function PromotionReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(todayYMD());
  const [dateTo, setDateTo] = useState(todayYMD());

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getPromotionUsageReport({
        date_from: dateFrom,
        date_to: dateTo,
      });
      setRows(data || []);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: (error as Error).message,
        variant: 'destructive',
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, toast]);

  useReportAutoRefresh(loadData);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/reports/sales')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Tag className="h-8 w-8" />
            Aksiyalar bo'yicha hisobot
          </h1>
          <p className="text-muted-foreground">Aksiya ishlatilishi va chegirma summasi</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtrlash</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Boshlanish</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Tugash</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={loadData}>Yuklash</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Natijalar</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Yuklanmoqda...</div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              Tanlangan davrda aksiya ishlatilmagan
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aksiya nomi</TableHead>
                  <TableHead>Turi</TableHead>
                  <TableHead className="text-right">Ishlatilish soni</TableHead>
                  <TableHead className="text-right">Jami chegirma</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.promotion_id}>
                    <TableCell>{r.promotion_name || r.promotion_id || '—'}</TableCell>
                    <TableCell>{r.promotion_type || '—'}</TableCell>
                    <TableCell className="text-right">{r.usage_count ?? 0}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(r.total_discount ?? 0)}</TableCell>
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
