import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getPriceTiers, getProfitAndLossSQL } from '@/db/api';
import { FileDown, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, endOfDay } from 'date-fns';
import { formatMoneyUZS } from '@/lib/format';
import { todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { exportProfitLoss } from '@/lib/exportManager';
type PriceTier = {
  id: number;
  name: string;
  code?: string;
};

export default function ProfitLossReport() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reportData, setReportData] = useState<any>(null);
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<null | 'excel' | 'pdf'>(null);
  const [period, setPeriod] = useState<'daily' | 'day' | 'weekly' | 'monthly' | 'custom'>('daily');
  const [dateFrom, setDateFrom] = useState(todayYMD());
  const [dateTo, setDateTo] = useState(todayYMD());

  const parseYMDLocal = (ymd: string): Date => {
    const [y, m, d] = ymd.split('-').map((v) => Number(v));
    // Month is 0-based in JS Date
    return new Date(y, (m || 1) - 1, d || 1);
  };

  const ymdToDMY = (ymd: string) => {
    const [y, m, d] = String(ymd || '').split('-');
    if (!y || !m || !d) return ymd;
    return `${d}.${m}.${y}`;
  };

  const dateToYMDLocal = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
  }, [period, dateFrom, dateTo, tierFilter]);

  const selectedRange = useMemo(() => {
    const today = todayYMD(); // Asia/Tashkent "today"
    const todayLocal = parseYMDLocal(today);
    let from: Date;
    let to: Date;
    let fromYMD: string;
    let toYMD: string;

    if (period === 'daily') {
      // IMPORTANT: Filter by YMD strings in Asia/Tashkent, not local Date boundaries
      from = startOfDay(todayLocal);
      to = endOfDay(todayLocal);
      fromYMD = today;
      toYMD = today;
    } else if (period === 'day') {
      // Single day (user-selected)
      const ymd = dateFrom || today;
      const d = parseYMDLocal(ymd);
      from = startOfDay(d);
      to = endOfDay(d);
      fromYMD = ymd;
      toYMD = ymd;
    } else if (period === 'weekly') {
      // Uzbekistan typically considers Monday as week start
      from = startOfWeek(todayLocal, { weekStartsOn: 1 });
      to = endOfWeek(todayLocal, { weekStartsOn: 1 });
      fromYMD = dateToYMDLocal(from);
      toYMD = dateToYMDLocal(to);
    } else if (period === 'monthly') {
      from = startOfMonth(todayLocal);
      to = endOfMonth(todayLocal);
      fromYMD = dateToYMDLocal(from);
      toYMD = dateToYMDLocal(to);
    } else {
      // custom: use selected YMD range as-is for string comparisons
      const a = dateFrom || today;
      const b = dateTo || today;
      // Guard: if user selects inverted range, swap.
      const fromStr = a <= b ? a : b;
      const toStr = a <= b ? b : a;
      from = startOfDay(parseYMDLocal(fromStr));
      to = endOfDay(parseYMDLocal(toStr));
      fromYMD = fromStr;
      toYMD = toStr;
    }

    return { from, to, fromYMD, toYMD };
  }, [period, dateFrom, dateTo]);

  async function loadData() {
    try {
      setLoading(true);
      const [report, tiers] = await Promise.all([
        getProfitAndLossSQL({
          date_from: selectedRange.fromYMD,
          date_to: selectedRange.toYMD,
          warehouse_id: 'main-warehouse-001',
          price_tier_id: tierFilter !== 'all' ? Number(tierFilter) : null,
        }),
        getPriceTiers(),
      ]);

      setReportData(report || null);
      setPriceTiers(tiers || []);

      const missingCost = Number(report?.warnings?.missing_cost_count || 0);
      if (missingCost > 0) {
        toast({
          title: t('common.warning') || 'Warning',
          description: `Some order items are missing cost_price (${missingCost}). COGS may be understated.`,
        });
      }
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('reports.profit_loss_page.errors.load_failed'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  const summary = reportData?.summary || {};
  const grossSales = Number(summary.revenue || 0);
  const totalDiscounts = Number(summary.discount || 0);
  const netSales = Number(summary.net_sales || 0);
  const cogs = Number(summary.cogs || 0);
  const grossProfit = Number(summary.gross_profit || 0);
  const returnsRevenue = Number(summary.returns_revenue || 0);
  const returnsCogs = Number(summary.returns_cogs || 0);
  const totalExpenses = Number(summary.expenses || 0);
  const finalProfit = Number(summary.net_profit || 0);
  const profitMargin = Number(summary.profit_margin || 0);
  const returnRate = Number(summary.return_rate || 0);

  const formatMinusMoney = (value: number) => {
    // UX: don't show "-0 so'm"
    if (!value || value === 0) return formatMoneyUZS(0);
    return `-${formatMoneyUZS(value)}`;
  };

  const formatDayLabel = (d: Date) => {
    return new Intl.DateTimeFormat('uz-UZ', { month: 'short', day: '2-digit' }).format(d);
  };

  const chartData = Array.isArray(reportData?.series)
    ? reportData.series.map((row: any) => {
        const day = row?.day ? parseYMDLocal(String(row.day)) : new Date();
        return {
          date: formatDayLabel(day),
          sales: Number(row?.net_sales ?? row?.revenue ?? 0),
          cost: Number(row?.cogs ?? 0),
          profit: Number(row?.gross_profit ?? 0),
        };
      })
    : [];

  const handleExport = async (format: 'excel' | 'pdf') => {
    try {
      setExporting(format);
      toast({
        title: t('reports.profit_loss_page.export.title'),
        description: t('reports.profit_loss_page.export.exporting_to', { format: format.toUpperCase() }),
      });
      await exportProfitLoss(format, { dateFrom: selectedRange.fromYMD, dateTo: selectedRange.toYMD });
    } catch (e) {
      toast({
        title: t('common.error'),
        description: t('reports.profit_loss_page.errors.export_failed'),
        variant: 'destructive',
      });
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          <span className="text-sm text-muted-foreground">{t('reports.profit_loss_page.states.loading')}</span>
        </div>
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
            <h1 className="text-3xl font-bold">{t('reports.profit_loss_page.title')}</h1>
            <p className="text-muted-foreground">{t('reports.profit_loss_page.subtitle')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport('excel')} disabled={exporting !== null}>
            <FileDown className="h-4 w-4 mr-2" />
            {exporting === 'excel' ? t('reports.profit_loss_page.states.loading') : t('reports.profit_loss_page.export.excel')}
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')} disabled={exporting !== null}>
            <FileDown className="h-4 w-4 mr-2" />
            {exporting === 'pdf' ? t('reports.profit_loss_page.states.loading') : t('reports.profit_loss_page.export.pdf')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">{t('reports.profit_loss_page.filters.period')}</label>
              <Select value={period} onValueChange={(v: any) => setPeriod(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">{t('reports.profit_loss_page.filters.today')}</SelectItem>
                  <SelectItem value="day">{t('reports.profit_loss_page.filters.day')}</SelectItem>
                  <SelectItem value="weekly">{t('reports.profit_loss_page.filters.this_week')}</SelectItem>
                  <SelectItem value="monthly">{t('reports.profit_loss_page.filters.this_month')}</SelectItem>
                  <SelectItem value="custom">{t('reports.profit_loss_page.filters.custom')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Narx turi</label>
              <Select value={tierFilter} onValueChange={setTierFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Barchasi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barchasi</SelectItem>
                  {priceTiers.map((tier) => (
                    <SelectItem key={tier.id} value={String(tier.id)}>
                      {tier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3 flex items-end">
              <div className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{t('reports.profit_loss_page.filters.range_label')}:</span>{' '}
                {ymdToDMY(selectedRange.fromYMD)} — {ymdToDMY(selectedRange.toYMD)}
              </div>
            </div>
            {period === 'custom' && (
              <>
                <div>
                  <label className="text-sm text-muted-foreground">{t('reports.profit_loss_page.filters.from_date')}</label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">{t('reports.profit_loss_page.filters.to_date')}</label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              </>
            )}
            {period === 'day' && (
              <div>
                <label className="text-sm text-muted-foreground">{t('reports.profit_loss_page.filters.day_date')}</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('reports.profit_loss_page.statement.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="font-medium">{t('reports.profit_loss_page.statement.gross_sales')}</span>
                <span className="font-bold">{formatMoneyUZS(grossSales)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-muted-foreground">{t('reports.profit_loss_page.statement.discounts')}</span>
                <span className="text-destructive">{formatMinusMoney(totalDiscounts)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="font-medium">{t('reports.profit_loss_page.statement.net_sales')}</span>
                <span className="font-bold">{formatMoneyUZS(netSales)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-muted-foreground">{t('reports.profit_loss_page.statement.cogs')}</span>
                <span className="text-destructive">{formatMinusMoney(cogs)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="font-medium">{t('reports.profit_loss_page.statement.gross_profit')}</span>
                <span className="font-bold text-success">{formatMoneyUZS(grossProfit)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-muted-foreground">{t('reports.profit_loss_page.statement.returns')}</span>
                <span className="text-destructive">{formatMinusMoney(returnsRevenue)}</span>
              </div>
              {returnsCogs > 0 && (
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="text-muted-foreground">
                    {t('reports.profit_loss_page.statement.returns_cogs')}
                  </span>
                  <span className="text-success">{formatMoneyUZS(returnsCogs)}</span>
                </div>
              )}
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-muted-foreground">{t('reports.profit_loss_page.statement.approved_expenses')}</span>
                <span className="text-destructive">{formatMinusMoney(totalExpenses)}</span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-lg font-bold">{t('reports.profit_loss_page.statement.final_profit')}</span>
                <span className={`text-lg font-bold ${finalProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {formatMoneyUZS(finalProfit)}
                </span>
              </div>
            </div>
            {reportData?.warnings?.valuation_mismatch ? (
              <div className="mt-4 text-xs text-destructive">
                FIFO va weighted avg baholashlarida farq aniqlandi. Hisobotni tekshiring.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('reports.profit_loss_page.metrics.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-muted-foreground">{t('reports.profit_loss_page.metrics.profit_margin')}</span>
                  <span className="font-bold">{profitMargin.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-success h-2 rounded-full"
                    style={{ width: `${Math.min(profitMargin, 100)}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-muted-foreground">{t('reports.profit_loss_page.metrics.total_orders')}</span>
                  <span className="font-bold">{Number(summary.orders_count || 0)}</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-muted-foreground">{t('reports.profit_loss_page.metrics.avg_order_value')}</span>
                  <span className="font-bold">
                    {formatMoneyUZS(Number(summary.avg_order_value || 0))}
                  </span>
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-muted-foreground">{t('reports.profit_loss_page.metrics.return_rate')}</span>
                  <span className="font-bold">
                    {returnRate.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('reports.profit_loss_page.trend.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-muted-foreground">{t('reports.profit_loss_page.states.no_data')}</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sales" stroke="hsl(var(--primary))" name={t('reports.profit_loss_page.trend.sales')} />
                <Line type="monotone" dataKey="cost" stroke="hsl(var(--destructive))" name={t('reports.profit_loss_page.trend.cost')} />
                <Line type="monotone" dataKey="profit" stroke="hsl(var(--success))" name={t('reports.profit_loss_page.trend.profit')} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
