import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { getElectronAPI, handleIpcResponse } from '@/utils/electron';
import { formatMoneyUZS } from '@/lib/format';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

type Summary = {
  days?: number;
  totals?: { orders: number; amount: number };
  by_status?: Array<{ status: string; count: number; amount: number }>;
  by_channel?: Array<{ channel: string; count: number; amount: number }>;
};

const CHANNELS = ['all', 'telegram', 'website', 'uzum', 'yandex', 'other'] as const;

export default function WebOnlineSalesReport() {
  const { t } = useTranslation();
  const api = getElectronAPI();
  const [days, setDays] = useState('30');
  const [channel, setChannel] = useState<string>('all');
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const statusLabel = (s: string) => {
    const key = `web_orders.status_${s}` as const;
    const tr = t(key);
    return tr === key ? s : tr;
  };

  const channelLabel = (ch: string) => {
    const key = `web_orders.channel_${ch}` as const;
    const tr = t(key);
    return tr === key ? ch : tr;
  };

  const load = useCallback(async () => {
    if (!api?.webOrders?.reportSummary) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const filters: Record<string, unknown> = { days: Number(days) || 30 };
      if (channel !== 'all') filters.sales_channel = channel;
      const res = await handleIpcResponse<Summary>(api.webOrders.reportSummary(filters));
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, channel, days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">{t('navigation.web_orders_report')}</h1>
          <p className="page-heading-sub">{t('web_orders.report_subtitle')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
          {t('common.update')}
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 px-4 py-3">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="h-9 w-[10rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t('web_orders.report_days_7')}</SelectItem>
              <SelectItem value="30">{t('web_orders.report_days_30')}</SelectItem>
              <SelectItem value="90">{t('web_orders.report_days_90')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="h-9 w-[11rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c === 'all' ? t('web_orders.all_channels') : channelLabel(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('web_orders.report_total_orders')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{data?.totals?.orders ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('web_orders.report_total_amount')} (UZS)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {formatMoneyUZS(Number(data?.totals?.amount ?? 0))}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('web_orders.report_by_status')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('web_orders.status')}</TableHead>
                  <TableHead className="text-right">{t('web_orders.report_count')}</TableHead>
                  <TableHead className="text-right">{t('web_orders.total')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.by_status || []).map((row) => (
                  <TableRow key={row.status}>
                    <TableCell>{statusLabel(row.status)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoneyUZS(Number(row.amount || 0))}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && !(data?.by_status || []).length && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      {t('web_orders.empty')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('web_orders.report_by_channel')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('web_orders.channel')}</TableHead>
                  <TableHead className="text-right">{t('web_orders.report_count')}</TableHead>
                  <TableHead className="text-right">{t('web_orders.total')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.by_channel || []).map((row) => (
                  <TableRow key={row.channel}>
                    <TableCell>{channelLabel(row.channel)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoneyUZS(Number(row.amount || 0))}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && !(data?.by_channel || []).length && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      —
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
