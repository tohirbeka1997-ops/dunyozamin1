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
import { ArrowLeft, FileDown, RefreshCcw, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { todayYMD } from '@/lib/datetime';
import { formatMoneyUZS, formatCustomerBalance } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { getCustomers, getOrdersByCustomer } from '@/db/api';
import type { Customer, OrderWithDetails } from '@/types/database';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';

type ActRow = {
  id: string;
  created_at: string;
  type: 'sale' | 'payment_in' | 'payment_out' | 'refund' | 'adjustment' | string;
  ref_no?: string | null;
  amount: number; // signed delta
  in_amount: number;
  out_amount: number;
  balance_after: number;
  method?: string | null;
  note?: string | null;
  created_by_name?: string | null;
};

type ActResponse = {
  customer: { id: string; name: string; phone?: string | null; balance: number };
  period: { date_from?: string | null; date_to?: string | null };
  opening_balance: number;
  closing_balance: number;
  totals: { in_amount: number; out_amount: number; net_amount: number };
  rows: ActRow[];
};

type PurchasedProductRow = {
  id: string;
  created_at: string;
  order_number: string;
  product_name: string;
  quantity: number;
  sale_unit?: string | null;
  unit_price: number;
  line_total: number;
};

function toCsv(rows: ActRow[]) {
  const headers = [
    'date_time',
    'type',
    'ref_no',
    'method',
    'in_amount',
    'out_amount',
    'balance_after',
    'note',
  ];
  const escape = (v: any) => {
    const s = String(v ?? '');
    if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.created_at,
        r.type,
        r.ref_no || '',
        r.method || '',
        r.in_amount,
        r.out_amount,
        r.balance_after,
        r.note || '',
      ]
        .map(escape)
        .join(',')
    ),
  ];
  return lines.join('\n');
}

export default function CustomerActSverkaReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: 'report.customer-act-sverka.filters.query',
    trackedKeys: ['customerId', 'dateFrom', 'dateTo'],
  });

  // Loading should reflect "data fetch in progress", not initial page mount.
  // Otherwise the page can get stuck showing a spinner before a customer is selected.
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const customerId = searchParams.get('customerId') || '';
  const dateFrom =
    searchParams.get('dateFrom') ||
    new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0];
  const dateTo = searchParams.get('dateTo') || todayYMD();

  const [data, setData] = useState<ActResponse | null>(null);
  const [customerOrders, setCustomerOrders] = useState<OrderWithDetails[]>([]);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    (async () => {
      try {
        const list = await getCustomers();
        setCustomers(Array.isArray(list) ? list : []);
      } catch (e: any) {
        setCustomers([]);
        toast({
          title: 'Xatolik',
          description: e?.message || "Mijozlar ro'yxatini yuklab bo'lmadi",
          variant: 'destructive',
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (customerId) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, dateFrom, dateTo]);

  async function loadData() {
    try {
      if (!customerId) {
        setData(null);
        setCustomerOrders([]);
        return;
      }
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }
      setLoading(true);
      const api = requireElectron();

      const [res, orders] = await Promise.all([
        handleIpcResponse<ActResponse>(
          api.reports?.customerActSverka?.({
            customer_id: customerId,
            date_from: dateFrom,
            date_to: dateTo,
          }) || Promise.resolve(null)
        ),
        getOrdersByCustomer(customerId),
      ]);

      const filteredOrders = (Array.isArray(orders) ? orders : []).filter((order) => {
        const orderDate = String(order.created_at || '').slice(0, 10);
        return orderDate >= dateFrom && orderDate <= dateTo;
      });

      setData(res || null);
      setCustomerOrders(filteredOrders);
    } catch (error: any) {
      console.error('[CustomerActSverkaReport] loadData error:', error);
      const msg = String(error?.message || '');
      const code = String(error?.code || '');
      const isNoHandler =
        code === 'NOT_FOUND' || msg.includes("No handler registered for 'pos:reports:customerActSverka'");
      const friendly =
        isNoHandler
          ? "HOST/CLIENT sozlamasi noto'g'ri yoki HOST ilova yangilanmagan. Agar bitta kompyuterda ishlatsangiz: Settings → POS Network → Mode = HOST qilib saqlang va app'ni qayta oching. Agar CLIENT ishlatayotgan bo'lsangiz: HOST kompyuterda ham app'ni yangilab/restart qiling."
          : error?.message || "Ma'lumotlarni yuklab bo'lmadi";
      toast({
        title: 'Xatolik',
        description: friendly,
        variant: 'destructive',
      });
      setData(null);
      setCustomerOrders([]);
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => data?.rows || [], [data]);

  const purchasedProducts = useMemo<PurchasedProductRow[]>(
    () =>
      customerOrders.flatMap((order) =>
        (order.items || []).map((item) => ({
          id: item.id,
          created_at: order.created_at,
          order_number: order.order_number,
          product_name: item.product_name,
          quantity: Number(item.qty_sale ?? item.quantity ?? 0),
          sale_unit: item.sale_unit || item.product?.unit || null,
          unit_price: Number(item.final_unit_price ?? item.unit_price ?? 0),
          line_total: Number(item.final_total ?? item.total ?? 0),
        }))
      ),
    [customerOrders]
  );

  const purchasedSummary = useMemo(() => {
    const totalAmount = purchasedProducts.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
    return {
      orderCount: customerOrders.length,
      itemCount: purchasedProducts.length,
      totalAmount,
    };
  }, [customerOrders, purchasedProducts]);

  const summary = useMemo(() => {
    const opening = data?.opening_balance ?? 0;
    const closing = data?.closing_balance ?? opening;
    const inAmount = data?.totals?.in_amount ?? 0;
    const outAmount = data?.totals?.out_amount ?? 0;
    const net = data?.totals?.net_amount ?? inAmount - outAmount;
    return { opening, closing, inAmount, outAmount, net };
  }, [data]);

  const handleExportCsv = () => {
    if (!data) return;
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customer-act-sverka-${data.customer?.name || data.customer?.id}-${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Users className="h-8 w-8 text-primary" />
              Mijoz akt sverka
            </h1>
            <p className="text-muted-foreground">Bitta mijoz bo‘yicha barcha tranzaksiyalar (nima/qancha/qachon/qanday)</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadData} disabled={!customerId || loading}>
            <RefreshCcw className="h-4 w-4 mr-2" />
            Yangilash
          </Button>
          <Button variant="outline" onClick={handleExportCsv} disabled={!data || rows.length === 0}>
            <FileDown className="h-4 w-4 mr-2" />
            CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="text-sm text-muted-foreground">Mijoz</label>
              <Select value={customerId} onValueChange={(value) => updateParams({ customerId: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Mijoz tanlang..." />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sana</label>
              <Input type="date" value={dateFrom} onChange={(e) => updateParams({ dateFrom: e.target.value })} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sana</label>
              <Input type="date" value={dateTo} onChange={(e) => updateParams({ dateTo: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center items-center min-h-[300px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : !data ? (
        <div className="text-center text-muted-foreground py-10">Mijoz tanlang</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Boshlang‘ich balans</p>
                <p className="text-xl font-bold">{formatCustomerBalance(summary.opening).label}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Kirim (+)</p>
                <p className="text-xl font-bold text-green-600">{formatMoneyUZS(summary.inAmount)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Chiqim (-)</p>
                <p className="text-xl font-bold text-destructive">{formatMoneyUZS(summary.outAmount)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Yakuniy balans</p>
                <p className="text-xl font-bold">{formatCustomerBalance(summary.closing).label}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-semibold">Olingan mahsulotlar</h3>
                  <p className="text-sm text-muted-foreground">
                    Shu davrda mijoz olgan mahsulotlar ro‘yxati
                  </p>
                </div>
                <div className="text-sm text-muted-foreground text-right">
                  <div>Buyurtmalar: {purchasedSummary.orderCount}</div>
                  <div>Pozitsiyalar: {purchasedSummary.itemCount}</div>
                  <div>Jami: {formatMoneyUZS(purchasedSummary.totalAmount)}</div>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sana</TableHead>
                    <TableHead>Hujjat</TableHead>
                    <TableHead>Mahsulot</TableHead>
                    <TableHead className="text-right">Miqdor</TableHead>
                    <TableHead className="text-right">Narx</TableHead>
                    <TableHead className="text-right">Jami</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchasedProducts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Bu davrda olingan mahsulotlar topilmadi
                      </TableCell>
                    </TableRow>
                  ) : (
                    purchasedProducts.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-sm">{item.created_at}</TableCell>
                        <TableCell className="font-mono text-sm">{item.order_number}</TableCell>
                        <TableCell className="font-medium">{item.product_name}</TableCell>
                        <TableCell className="text-right">
                          {item.quantity} {item.sale_unit || ''}
                        </TableCell>
                        <TableCell className="text-right">{formatMoneyUZS(item.unit_price)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatMoneyUZS(item.line_total)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sana</TableHead>
                    <TableHead>Turi</TableHead>
                    <TableHead>Hujjat</TableHead>
                    <TableHead>Izoh</TableHead>
                    <TableHead className="text-right">Kirim</TableHead>
                    <TableHead className="text-right">Chiqim</TableHead>
                    <TableHead className="text-right">Balans</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        Bu davrda yozuv yo‘q
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-sm">{r.created_at}</TableCell>
                        <TableCell className="font-medium">{r.type}</TableCell>
                        <TableCell className="font-mono text-sm">{r.ref_no || '-'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.note || ''}</TableCell>
                        <TableCell className="text-right text-green-600 font-medium">
                          {r.in_amount > 0 ? formatMoneyUZS(r.in_amount) : '-'}
                        </TableCell>
                        <TableCell className="text-right text-destructive font-medium">
                          {r.out_amount > 0 ? formatMoneyUZS(r.out_amount) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCustomerBalance(r.balance_after).label}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

