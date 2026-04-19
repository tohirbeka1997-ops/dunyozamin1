import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, DollarSign, TrendingUp, TrendingDown, Package, Users, AlertCircle, BarChart3 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

interface KPIData {
  revenue: number;
  revenue_previous: number;
  revenue_growth: number;
  profit: number;
  profit_previous: number;
  profit_margin: number;
  profit_growth: number;
  total_debt: number;
  customer_debt: number;
  supplier_debt: number;
  debt_growth: number;
  inventory_value: number;
  inventory_value_previous: number;
  inventory_growth: number;
  orders_count: number;
  customers_count: number;
  avg_order_value: number;
}

interface TrendData {
  period: string;
  revenue: number;
  profit: number;
  orders: number;
}

export default function ExecutiveDashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [kpiData, setKpiData] = useState<KPIData | null>(null);
  const [trendData, setTrendData] = useState<TrendData[]>([]);
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  async function loadData() {
    try {
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }
      setLoading(true);
      const api = requireElectron();
      
      const [kpi, trends] = await Promise.all([
        handleIpcResponse<KPIData>(
          api.reports?.executiveKPI?.({ period }) || Promise.resolve({})
        ),
        handleIpcResponse<TrendData[]>(
          api.reports?.executiveTrends?.({ period }) || Promise.resolve([])
        ),
      ]);

      setKpiData(kpi || null);
      setTrendData(Array.isArray(trends) ? trends : []);
    } catch (error: any) {
      console.error('[ExecutiveDashboard] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setKpiData(null);
      setTrendData([]);
    } finally {
      setLoading(false);
    }
  }

  const getGrowthBadge = (growth: number) => {
    const isPositive = growth >= 0;
    const color = isPositive ? 'text-green-600' : 'text-red-600';
    const Icon = isPositive ? TrendingUp : TrendingDown;
    const sign = isPositive ? '+' : '';
    
    return (
      <div className={`flex items-center gap-1 ${color} font-semibold`}>
        <Icon className="h-4 w-4" />
        {sign}{growth.toFixed(1)}%
      </div>
    );
  };

  const getPeriodLabel = () => {
    if (period === 'day') return 'Kunlik';
    if (period === 'week') return 'Haftalik';
    return 'Oylik';
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!kpiData) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Ma'lumotlar yuklanmadi</p>
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
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <BarChart3 className="h-8 w-8 text-blue-500" />
              Boshqaruv Dashboard
            </h1>
            <p className="text-muted-foreground">
              KPI ko'rsatkichlari va trendlar tahlili
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-muted rounded-lg p-1">
            <Button
              size="sm"
              variant={period === 'day' ? 'default' : 'ghost'}
              onClick={() => setPeriod('day')}
            >
              Kun
            </Button>
            <Button
              size="sm"
              variant={period === 'week' ? 'default' : 'ghost'}
              onClick={() => setPeriod('week')}
            >
              Hafta
            </Button>
            <Button
              size="sm"
              variant={period === 'month' ? 'default' : 'ghost'}
              onClick={() => setPeriod('month')}
            >
              Oy
            </Button>
          </div>
          <Button variant="outline" onClick={loadData}>
            Yangilash
          </Button>
        </div>
      </div>

      {/* KPI Overview */}
      <div>
        <h2 className="text-xl font-semibold mb-4">KPI ko‘rsatkichlari</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Revenue */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Tushum</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatMoneyUZS(kpiData.revenue)}</div>
              <div className="flex items-center justify-between mt-2">
                {getGrowthBadge(kpiData.revenue_growth)}
                <span className="text-xs text-muted-foreground">
                  {getPeriodLabel()} taqqoslash
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Oldingi: {formatMoneyUZS(kpiData.revenue_previous)}
              </div>
            </CardContent>
          </Card>

          {/* Profit */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Foyda</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {formatMoneyUZS(kpiData.profit)}
              </div>
              <div className="flex items-center justify-between mt-2">
                {getGrowthBadge(kpiData.profit_growth)}
                <span className="text-xs text-muted-foreground">
                  Marja: {kpiData.profit_margin.toFixed(1)}%
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Oldingi: {formatMoneyUZS(kpiData.profit_previous)}
              </div>
            </CardContent>
          </Card>

          {/* Debt */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Qarzdorlik</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {formatMoneyUZS(kpiData.total_debt)}
              </div>
              <div className="flex items-center justify-between mt-2">
                {getGrowthBadge(kpiData.debt_growth)}
                <span className="text-xs text-muted-foreground">
                  O'zgarish
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Mijozlar:</span>
                  <div className="font-medium">{formatMoneyUZS(kpiData.customer_debt)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Postavshik:</span>
                  <div className="font-medium">{formatMoneyUZS(kpiData.supplier_debt)}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Inventory Value */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Ombor qiymati</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {formatMoneyUZS(kpiData.inventory_value)}
              </div>
              <div className="flex items-center justify-between mt-2">
                {getGrowthBadge(kpiData.inventory_growth)}
                <span className="text-xs text-muted-foreground">
                  O'zgarish
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Oldingi: {formatMoneyUZS(kpiData.inventory_value_previous)}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Additional Metrics */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Qo'shimcha ko'rsatkichlar</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Buyurtmalar</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpiData.orders_count}</div>
              <div className="text-xs text-muted-foreground mt-2">
                Jami buyurtmalar soni
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Mijozlar</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpiData.customers_count}</div>
              <div className="text-xs text-muted-foreground mt-2">
                Faol mijozlar
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">O'rtacha check</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatMoneyUZS(kpiData.avg_order_value)}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Buyurtma uchun
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Trends */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Trendlar ({getPeriodLabel()})</h2>
        {trendData.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                Trend ma'lumotlari mavjud emas
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Revenue Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Tushum trendi</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {trendData.map((item, idx) => {
                    const isLast = idx === trendData.length - 1;
                    const prevValue = idx > 0 ? trendData[idx - 1].revenue : item.revenue;
                    const change = prevValue > 0 ? ((item.revenue - prevValue) / prevValue) * 100 : 0;
                    
                    return (
                      <div
                        key={item.period}
                        className={`flex items-center justify-between p-3 rounded-lg ${
                          isLast ? 'bg-primary/10 border border-primary' : 'bg-muted'
                        }`}
                      >
                        <div>
                          <div className="font-medium">{item.period}</div>
                          <div className="text-sm text-muted-foreground">
                            {item.orders} buyurtma
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{formatMoneyUZS(item.revenue)}</div>
                          {idx > 0 && (
                            <div className="text-xs">{getGrowthBadge(change)}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Profit Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Foyda trendi</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {trendData.map((item, idx) => {
                    const isLast = idx === trendData.length - 1;
                    const prevValue = idx > 0 ? trendData[idx - 1].profit : item.profit;
                    const change = prevValue > 0 ? ((item.profit - prevValue) / prevValue) * 100 : 0;
                    const margin = item.revenue > 0 ? (item.profit / item.revenue) * 100 : 0;
                    
                    return (
                      <div
                        key={item.period}
                        className={`flex items-center justify-between p-3 rounded-lg ${
                          isLast ? 'bg-green-50 border border-green-500' : 'bg-muted'
                        }`}
                      >
                        <div>
                          <div className="font-medium">{item.period}</div>
                          <div className="text-sm text-muted-foreground">
                            Marja: {margin.toFixed(1)}%
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-green-600">
                            {formatMoneyUZS(item.profit)}
                          </div>
                          {idx > 0 && (
                            <div className="text-xs">{getGrowthBadge(change)}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-600" />
              Growth Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm">Tushum o'sishi:</span>
                <div className="text-lg font-bold">{getGrowthBadge(kpiData.revenue_growth)}</div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Foyda o'sishi:</span>
                <div className="text-lg font-bold">{getGrowthBadge(kpiData.profit_growth)}</div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Ombor o'sishi:</span>
                <div className="text-lg font-bold">{getGrowthBadge(kpiData.inventory_growth)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-purple-600" />
              Performance Indicators
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm">Foyda marjasi:</span>
                <div className="text-lg font-bold text-green-600">
                  {kpiData.profit_margin.toFixed(1)}%
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Qarzdorlik darajasi:</span>
                <div className="text-lg font-bold text-orange-600">
                  {kpiData.revenue > 0
                    ? ((kpiData.total_debt / kpiData.revenue) * 100).toFixed(1)
                    : 0}%
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Ombor aylanishi:</span>
                <div className="text-lg font-bold text-blue-600">
                  {kpiData.inventory_value > 0
                    ? (kpiData.revenue / kpiData.inventory_value).toFixed(1)
                    : 0}x
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
