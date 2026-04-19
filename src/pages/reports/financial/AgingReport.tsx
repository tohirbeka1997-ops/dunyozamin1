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

export default function AgingReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: 'report.aging.filters.query',
    trackedKeys: ['search', 'tab'],
  });

  const [loading, setLoading] = useState(true);
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Qarzdorlik yoshi (Aging)</h1>
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
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <Input
              placeholder="Qidirish (nomi yoki telefon)..."
              value={searchTerm}
              onChange={(e) => updateParams({ search: e.target.value })}
              className="max-w-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">0-7 kun</div>
            <div className="text-2xl font-bold">
              {formatMoneyUZS(
                activeTab === 'customers' ? customerTotals.current : supplierTotals.current
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Yangi qarzdorlik</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">8-30 kun</div>
            <div className="text-2xl font-bold text-warning">
              {formatMoneyUZS(
                activeTab === 'customers' ? customerTotals.days_8_30 : supplierTotals.days_8_30
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Ogohlantirish</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">31-60 kun</div>
            <div className="text-2xl font-bold text-orange-500">
              {formatMoneyUZS(
                activeTab === 'customers' ? customerTotals.days_31_60 : supplierTotals.days_31_60
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Kechikish</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">60+ kun</div>
            <div className="text-2xl font-bold text-destructive">
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

        <TabsContent value="customers" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {renderTable(filteredCustomers, customerTotals)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suppliers" className="mt-6">
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
