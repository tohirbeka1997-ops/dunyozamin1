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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Users, Truck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import { todayYMD } from '@/lib/datetime';

interface AgingRow {
  id: string;
  name: string;
  phone?: string;
  total_debt: number;
  current: number; // 0-7 days
  days_8_30: number; // 8-30 days
  days_31_60: number; // 31-60 days
  days_60_plus: number; // 60+ days
}

interface AgingInsight {
  level: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
}

export default function AgingReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: 'report.aging.filters.query',
    trackedKeys: ['search', 'tab'],
  });

  const [loading, setLoading] = useState(true);
  const [showInsights, setShowInsights] = useState(false);
  const [customerRows, setCustomerRows] = useState<AgingRow[]>([]);
  const [supplierRows, setSupplierRows] = useState<AgingRow[]>([]);
  const searchTerm = searchParams.get('search') || '';
  const activeTab = (searchParams.get('tab') || 'customers') as 'customers' | 'suppliers';

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }
      setLoading(true);
      const api = requireElectron();
      
      const [customerData, supplierData] = await Promise.all([
        handleIpcResponse<AgingRow[]>(api.reports?.customerAging?.() || Promise.resolve([])),
        handleIpcResponse<AgingRow[]>(api.reports?.supplierAging?.() || Promise.resolve([])),
      ]);

      setCustomerRows(Array.isArray(customerData) ? customerData : []);
      setSupplierRows(Array.isArray(supplierData) ? supplierData : []);
    } catch (error: any) {
      console.error('[AgingReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      // Set empty arrays on error
      setCustomerRows([]);
      setSupplierRows([]);
    } finally {
      setLoading(false);
    }
  }

  const filteredCustomers = useMemo(() => {
    if (!searchTerm) return customerRows;
    const term = searchTerm.toLowerCase();
    return customerRows.filter(
      (row) =>
        row.name.toLowerCase().includes(term) ||
        (row.phone && row.phone.toLowerCase().includes(term))
    );
  }, [customerRows, searchTerm]);

  const filteredSuppliers = useMemo(() => {
    if (!searchTerm) return supplierRows;
    const term = searchTerm.toLowerCase();
    return supplierRows.filter(
      (row) =>
        row.name.toLowerCase().includes(term) ||
        (row.phone && row.phone.toLowerCase().includes(term))
    );
  }, [supplierRows, searchTerm]);

  const customerTotals = useMemo(() => {
    return filteredCustomers.reduce(
      (acc, row) => ({
        total: acc.total + Number(row.total_debt || 0),
        current: acc.current + Number(row.current || 0),
        days_8_30: acc.days_8_30 + Number(row.days_8_30 || 0),
        days_31_60: acc.days_31_60 + Number(row.days_31_60 || 0),
        days_60_plus: acc.days_60_plus + Number(row.days_60_plus || 0),
      }),
      { total: 0, current: 0, days_8_30: 0, days_31_60: 0, days_60_plus: 0 }
    );
  }, [filteredCustomers]);

  const supplierTotals = useMemo(() => {
    return filteredSuppliers.reduce(
      (acc, row) => ({
        total: acc.total + Number(row.total_debt || 0),
        current: acc.current + Number(row.current || 0),
        days_8_30: acc.days_8_30 + Number(row.days_8_30 || 0),
        days_31_60: acc.days_31_60 + Number(row.days_31_60 || 0),
        days_60_plus: acc.days_60_plus + Number(row.days_60_plus || 0),
      }),
      { total: 0, current: 0, days_8_30: 0, days_31_60: 0, days_60_plus: 0 }
    );
  }, [filteredSuppliers]);

  const insights = useMemo(() => {
    const rows = activeTab === 'customers' ? filteredCustomers : filteredSuppliers;
    const totals = activeTab === 'customers' ? customerTotals : supplierTotals;
    const sideLabel = activeTab === 'customers' ? 'mijoz' : 'yetkazib beruvchi';
    const sideLabelPlural = activeTab === 'customers' ? 'mijozlar' : 'yetkazib beruvchilar';

    const severeRows = rows
      .filter((r) => Number(r.days_60_plus || 0) > 0)
      .sort((a, b) => Number(b.days_60_plus || 0) - Number(a.days_60_plus || 0))
      .slice(0, 3);

    const delayedRows = rows
      .filter((r) => Number(r.days_31_60 || 0) > 0)
      .sort((a, b) => Number(b.days_31_60 || 0) - Number(a.days_31_60 || 0))
      .slice(0, 3);

    const severeShare = totals.total > 0 ? (totals.days_60_plus / totals.total) * 100 : 0;
    const delayedShare = totals.total > 0 ? ((totals.days_31_60 + totals.days_60_plus) / totals.total) * 100 : 0;

    const reminders: AgingInsight[] = [];
    const recommendations: AgingInsight[] = [];

    if (severeRows.length > 0) {
      reminders.push({
        level: 'critical',
        title: `60+ kunlik qarzdorlik bo'yicha zudlik bilan aloqa`,
        description: `${severeRows
          .map((r) => `${r.name} (${formatMoneyUZS(r.days_60_plus)})`)
          .join(', ')}`,
      });
    } else {
      reminders.push({
        level: 'info',
        title: `60+ kunlik qarzdorlik topilmadi`,
        description: `Hozircha ${sideLabelPlural} orasida jiddiy kechikkan qarzdorlik yo'q.`,
      });
    }

    if (delayedRows.length > 0) {
      reminders.push({
        level: 'warning',
        title: `31-60 kun oralig'idagi risk guruh`,
        description: `${delayedRows
          .map((r) => `${r.name} (${formatMoneyUZS(r.days_31_60)})`)
          .join(', ')}`,
      });
    }

    if (severeShare >= 30) {
      recommendations.push({
        level: 'critical',
        title: `Qattiq nazorat rejimi`,
        description: `60+ kun ulushi ${severeShare.toFixed(
          1
        )}% — yangi ${sideLabel} limitlarini vaqtincha cheklang va qayta jadval tuzing.`,
      });
    } else if (severeShare >= 10) {
      recommendations.push({
        level: 'warning',
        title: `Undirish/to'lov jadvalini kuchaytirish`,
        description: `60+ kun ulushi ${severeShare.toFixed(
          1
        )}% — haftalik eslatma qo'ng'iroqlari va bosqichma-bosqich yopish rejasini yoqing.`,
      });
    } else {
      recommendations.push({
        level: 'info',
        title: `Sog'lom qarzdorlik profili`,
        description: `60+ kun ulushi past (${severeShare.toFixed(
          1
        )}%). Mavjud nazorat tartibini saqlang.`,
      });
    }

    recommendations.push({
      level: delayedShare >= 40 ? 'warning' : 'info',
      title: `Oldindan ogohlantirish siyosati`,
      description:
        delayedShare >= 40
          ? `31+ kun ulushi ${delayedShare.toFixed(
              1
            )}% — 8-kundan boshlab avtomatik eslatma va 30-kunda majburiy follow-up kiriting.`
          : `31+ kun ulushi ${delayedShare.toFixed(
              1
            )}%. 8-30 kun segmentida yumshoq eslatma rejimini davom ettiring.`,
    });

    return { reminders, recommendations };
  }, [activeTab, filteredCustomers, filteredSuppliers, customerTotals, supplierTotals]);

  const copyInsights = async (kind: 'reminders' | 'recommendations') => {
    try {
      const isCustomers = activeTab === 'customers';
      const title = isCustomers ? 'Mijozlar qarzdorligi' : 'Yetkazib beruvchilar qarzdorligi';
      const list = kind === 'reminders' ? insights.reminders : insights.recommendations;
      const header = kind === 'reminders' ? 'QARZDORLIK ESLATMALARI' : 'QARZDORLIK TAVSIYALARI';
      const payload = [
        `${header}`,
        `Sana: ${todayYMD()}`,
        `Bo'lim: ${title}`,
        '',
        ...list.map((x, idx) => `${idx + 1}) ${x.title}\n   ${x.description}`),
      ].join('\n');
      await navigator.clipboard.writeText(payload);
      toast({
        title: 'Nusxalandi',
        description: kind === 'reminders' ? "Eslatma matni nusxalandi" : "Tavsiyalar matni nusxalandi",
      });
    } catch (error: any) {
      toast({
        title: 'Xatolik',
        description: error?.message || "Nusxalab bo'lmadi",
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const renderTable = (rows: AgingRow[], totals: typeof customerTotals) => (
    <>
      {rows.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {searchTerm ? 'Qidiruv natijasi topilmadi' : 'Qarzdorlik mavjud emas'}
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nomi</TableHead>
              <TableHead>Telefon</TableHead>
              <TableHead className="text-right">Jami qarz</TableHead>
              <TableHead className="text-right">0-7 kun</TableHead>
              <TableHead className="text-right">8-30 kun</TableHead>
              <TableHead className="text-right">31-60 kun</TableHead>
              <TableHead className="text-right">60+ kun</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>{row.phone || '-'}</TableCell>
                <TableCell className="text-right font-semibold">
                  {formatMoneyUZS(row.total_debt)}
                </TableCell>
                <TableCell className="text-right">{formatMoneyUZS(row.current)}</TableCell>
                <TableCell className="text-right text-warning">
                  {formatMoneyUZS(row.days_8_30)}
                </TableCell>
                <TableCell className="text-right text-orange-500">
                  {formatMoneyUZS(row.days_31_60)}
                </TableCell>
                <TableCell className="text-right text-destructive font-semibold">
                  {formatMoneyUZS(row.days_60_plus)}
                </TableCell>
              </TableRow>
            ))}
            {/* Totals row */}
            <TableRow className="font-bold bg-muted/50">
              <TableCell colSpan={2}>JAMI</TableCell>
              <TableCell className="text-right">{formatMoneyUZS(totals.total)}</TableCell>
              <TableCell className="text-right">{formatMoneyUZS(totals.current)}</TableCell>
              <TableCell className="text-right text-warning">
                {formatMoneyUZS(totals.days_8_30)}
              </TableCell>
              <TableCell className="text-right text-orange-500">
                {formatMoneyUZS(totals.days_31_60)}
              </TableCell>
              <TableCell className="text-right text-destructive">
                {formatMoneyUZS(totals.days_60_plus)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/financial')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">Qarzdorlik yoshi (Aging)</h1>
            <p className="text-muted-foreground">
              Mijoz va yetkazib beruvchi qarzdorliklari bo'yicha yosh tahlili
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={loadData}>
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="py-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <Input
              placeholder="Qidirish (nomi yoki telefon)..."
              value={searchTerm}
              onChange={(e) => updateParams({ search: e.target.value })}
              className="w-full lg:max-w-sm h-8"
            />
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => copyInsights('reminders')}>
                Eslatma nusxalash
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => copyInsights('recommendations')}
              >
                Tavsiya nusxalash
              </Button>
              <Button
                variant={showInsights ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setShowInsights((v) => !v)}
              >
                {showInsights ? 'Yopish' : 'Ko‘rsatish'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">0-7 kun</div>
            <div className="text-xl font-bold">
              {formatMoneyUZS(
                activeTab === 'customers' ? customerTotals.current : supplierTotals.current
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Yangi qarzdorlik</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">8-30 kun</div>
            <div className="text-xl font-bold text-warning">
              {formatMoneyUZS(
                activeTab === 'customers' ? customerTotals.days_8_30 : supplierTotals.days_8_30
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Ogohlantirish</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">31-60 kun</div>
            <div className="text-xl font-bold text-orange-500">
              {formatMoneyUZS(
                activeTab === 'customers' ? customerTotals.days_31_60 : supplierTotals.days_31_60
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Kechikish</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-xs text-muted-foreground">60+ kun</div>
            <div className="text-xl font-bold text-destructive">
              {formatMoneyUZS(
                activeTab === 'customers'
                  ? customerTotals.days_60_plus
                  : supplierTotals.days_60_plus
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Jiddiy kechikish</div>
          </CardContent>
        </Card>
      </div>

      {showInsights && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <Card>
            <CardContent className="py-3 space-y-2">
              <h3 className="text-sm font-semibold">Qarzdorlik bo'yicha eslatmalar</h3>
              {insights.reminders.map((item, idx) => (
                <div
                  key={`reminder-${idx}`}
                  className={`rounded-md p-2 border ${
                    item.level === 'critical'
                      ? 'border-destructive/40 bg-destructive/5'
                      : item.level === 'warning'
                        ? 'border-warning/50 bg-warning/10'
                        : 'border-border bg-muted/40'
                  }`}
                >
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-3 space-y-2">
              <h3 className="text-sm font-semibold">Tavsiyalar</h3>
              {insights.recommendations.map((item, idx) => (
                <div
                  key={`recommendation-${idx}`}
                  className={`rounded-md p-2 border ${
                    item.level === 'critical'
                      ? 'border-destructive/40 bg-destructive/5'
                      : item.level === 'warning'
                        ? 'border-warning/50 bg-warning/10'
                        : 'border-border bg-muted/40'
                  }`}
                >
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) => updateParams({ tab: value === 'customers' ? null : value })}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="customers" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Mijozlar ({filteredCustomers.length})
          </TabsTrigger>
          <TabsTrigger value="suppliers" className="flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Yetkazib beruvchilar ({filteredSuppliers.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="customers" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {renderTable(filteredCustomers, customerTotals)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suppliers" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {renderTable(filteredSuppliers, supplierTotals)}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
