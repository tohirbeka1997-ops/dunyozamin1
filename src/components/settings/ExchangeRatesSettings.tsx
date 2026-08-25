import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import NumberInput from '@/components/common/NumberInput';
import { formatNumberDots } from '@/lib/money';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { getLatestExchangeRate, listExchangeRates, upsertExchangeRate } from '@/db/api';
import { formatDate } from '@/lib/datetime';
import { RefreshCw, Save } from 'lucide-react';
import { todayYMD } from '@/lib/datetime';

export function ExchangeRatesSettings() {
  const { toast } = useToast();
  const [rate, setRate] = useState<number | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(todayYMD());
  const [latest, setLatest] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [last, rows] = await Promise.all([
        getLatestExchangeRate({
          base_currency: 'USD',
          quote_currency: 'UZS',
          on_date: effectiveDate,
        }),
        listExchangeRates({
          base_currency: 'USD',
          quote_currency: 'UZS',
          limit: 30,
        }),
      ]);
      setLatest(last);
      setHistory(Array.isArray(rows) ? rows : []);
      if (last?.rate != null && rate == null) {
        setRate(Number(last.rate));
      }
    } catch (e: any) {
      toast({
        title: 'Xatolik',
        description: e?.message || 'Kurslarni yuklab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [effectiveDate, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    const r = rate ?? 0;
    if (!Number.isFinite(r) || r <= 0) {
      toast({ title: 'Xatolik', description: 'Kurs musbat son bo‘lishi kerak', variant: 'destructive' });
      return;
    }
    try {
      setSaving(true);
      await upsertExchangeRate({
        base_currency: 'USD',
        quote_currency: 'UZS',
        rate: r,
        effective_date: effectiveDate,
        source: 'manual',
      });
      toast({ title: 'Saqlandi', description: `1 USD = ${formatNumberDots(r)} UZS` });
      await load();
    } catch (e: any) {
      toast({
        title: 'Xatolik',
        description: e?.message || 'Kursni saqlab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Valyuta kurslari (USD → UZS)</CardTitle>
        <CardDescription>
          Xarid va yetkazib beruvchi to‘lovlarida UZS/USD konvertatsiyasi uchun. Ombor tannarxi doim UZS da
          qoladi.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3 max-w-xl">
          <div className="space-y-2">
            <Label htmlFor="fx-date">Sana</Label>
            <Input
              id="fx-date"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="fx-rate">1 USD = so‘m</Label>
            <div className="flex gap-2">
              <NumberInput
                id="fx-rate"
                value={rate}
                onValueChange={setRate}
                min={1}
                placeholder="12.800"
                containerClassName="flex-1 space-y-0"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                Saqlash
              </Button>
            </div>
          </div>
        </div>

        {latest?.rate != null && (
          <p className="text-sm text-muted-foreground">
            Oxirgi kurs ({formatDate(latest.effective_date)}):{' '}
            <span className="font-medium text-foreground">
              1 USD = {formatNumberDots(Number(latest.rate))} UZS
            </span>
          </p>
        )}

        <div>
          <h4 className="text-sm font-medium mb-2">So‘nggi kurslar</h4>
          <div className="rounded-md border overflow-auto max-h-64">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sana</TableHead>
                  <TableHead className="text-right">1 USD</TableHead>
                  <TableHead>Manba</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      Hozircha kurs yo‘q
                    </TableCell>
                  </TableRow>
                ) : (
                  history.map((row) => (
                    <TableRow key={row.id || `${row.effective_date}-${row.rate}`}>
                      <TableCell>{formatDate(row.effective_date)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatNumberDots(Number(row.rate || 0))} UZS
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.source || '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
