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
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Crown, TrendingUp, Repeat } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useTableSort } from '@/hooks/useTableSort';
import { SortableTableHead } from '@/components/reports/SortableTableHead';

interface VIPCustomer {
  customer_id: string;
  customer_name: string;
  customer_phone?: string;
  bonus_points?: number;
  total_purchases: number;
  total_spent: number;
  avg_order_value: number;
  order_count: number;
  first_purchase_date: string;
  last_purchase_date: string;
  days_since_last: number;
  loyalty_score: number; // calculated metric
}

/** Electron getVIPCustomers sort_by bilan mos */
type VipSortKey =
  | 'customer_name'
  | 'customer_phone'
  | 'total_spent'
  | 'order_count'
  | 'bonus_points'
  | 'avg_order_value'
  | 'loyalty_score'
  | 'last_purchase';

export default function VIPCustomersReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<VIPCustomer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const { sortKey, sortOrder, toggleSort } = useTableSort<VipSortKey>('total_spent', 'desc');
  const [minOrders, setMinOrders] = useState(1);
  const [limit, setLimit] = useState(50);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey, sortOrder, minOrders, limit]);

  async function loadData() {
    try {
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }
      setLoading(true);
      const api = requireElectron();
      const data = await handleIpcResponse<VIPCustomer[]>(
        api.reports?.vipCustomers?.({
          sort_by: sortKey,
          sort_order: sortOrder,
          min_orders: minOrders,
          limit,
        }) || Promise.resolve([])
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('[VIPCustomersReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!searchTerm) return rows;
    const term = searchTerm.toLowerCase();
    return rows.filter(
      (row) =>
        row.customer_name.toLowerCase().includes(term) ||
        (row.customer_phone && row.customer_phone.toLowerCase().includes(term))
    );
  }, [rows, searchTerm]);

  const summary = useMemo(() => {
    const totalSpent = filtered.reduce((sum, r) => sum + Number(r.total_spent || 0), 0);
    const totalOrders = filtered.reduce((sum, r) => sum + Number(r.order_count || 0), 0);
    const avgValue = totalOrders > 0 ? totalSpent / totalOrders : 0;
    return { totalSpent, totalOrders, avgValue };
  }, [filtered]);

  const getTierBadge = (spent: number) => {
    if (spent >= 50000000) return <Badge className="bg-yellow-500">Platinum</Badge>;
    if (spent >= 20000000) return <Badge className="bg-gray-400">Gold</Badge>;
    if (spent >= 10000000) return <Badge className="bg-orange-500">Silver</Badge>;
    return <Badge variant="secondary">Bronze</Badge>;
  };

  const getLoyaltyBadge = (score: number) => {
    if (score >= 80) return <Badge className="bg-green-600">Juda yuqori</Badge>;
    if (score >= 60) return <Badge className="bg-blue-600">Yuqori</Badge>;
    if (score >= 40) return <Badge className="bg-yellow-600">O'rtacha</Badge>;
    return <Badge variant="secondary">Past</Badge>;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
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
              <Crown className="h-8 w-8 text-yellow-500" />
              VIP mijozlar
            </h1>
            <p className="text-muted-foreground">
              Eng ko'p xarid qilganlar va qayta-qayta keluvchilar
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={loadData}>
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Ism yoki telefon..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Min buyurtmalar</label>
              <Input
                type="number"
                min="1"
                value={minOrders}
                onChange={(e) => setMinOrders(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Limit</label>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">Top 25</SelectItem>
                  <SelectItem value="50">Top 50</SelectItem>
                  <SelectItem value="100">Top 100</SelectItem>
                  <SelectItem value="200">Top 200</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground pt-2">
            Ustun sarlavhasiga bosing — eng ko‘p / eng kam tartibda server bo‘yicha saralanadi.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">Jami sotuv</p>
            </div>
            <div className="text-2xl font-bold mt-2">{formatMoneyUZS(summary.totalSpent)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              VIP mijozlar tomonidan
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Repeat className="h-5 w-5 text-blue-500" />
              <p className="text-sm text-muted-foreground">Jami buyurtmalar</p>
            </div>
            <div className="text-2xl font-bold mt-2">{summary.totalOrders}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {filtered.length} ta mijoz
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-yellow-500" />
              <p className="text-sm text-muted-foreground">O'rtacha check</p>
            </div>
            <div className="text-2xl font-bold mt-2">{formatMoneyUZS(summary.avgValue)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              VIP mijoz uchun
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <Crown className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {searchTerm ? 'Qidiruv natijasi topilmadi' : 'VIP mijozlar mavjud emas'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <SortableTableHead<VipSortKey>
                    columnKey="customer_name"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    Mijoz
                  </SortableTableHead>
                  <SortableTableHead<VipSortKey>
                    columnKey="customer_phone"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    Telefon
                  </SortableTableHead>
                  <SortableTableHead<VipSortKey>
                    columnKey="total_spent"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Jami xarid
                  </SortableTableHead>
                  <TableHead className="text-center">Daraja</TableHead>
                  <SortableTableHead<VipSortKey>
                    columnKey="order_count"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Buyurtmalar
                  </SortableTableHead>
                  <SortableTableHead<VipSortKey>
                    columnKey="bonus_points"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    Bonus ball
                  </SortableTableHead>
                  <SortableTableHead<VipSortKey>
                    columnKey="avg_order_value"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="right"
                  >
                    O&apos;rtacha check
                  </SortableTableHead>
                  <SortableTableHead<VipSortKey>
                    columnKey="loyalty_score"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="number"
                    align="center"
                  >
                    Sodiqlik
                  </SortableTableHead>
                  <SortableTableHead<VipSortKey>
                    columnKey="last_purchase"
                    sortKey={sortKey}
                    sortOrder={sortOrder}
                    onSort={toggleSort}
                    kind="string"
                  >
                    Oxirgi xarid
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row, idx) => (
                  <TableRow key={row.customer_id}>
                    <TableCell className="font-medium">{idx + 1}</TableCell>
                    <TableCell className="font-medium">{row.customer_name}</TableCell>
                    <TableCell>{row.customer_phone || '-'}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatMoneyUZS(row.total_spent)}
                    </TableCell>
                    <TableCell className="text-center">{getTierBadge(row.total_spent)}</TableCell>
                    <TableCell className="text-right">{row.order_count}</TableCell>
                    <TableCell className="text-right font-mono">
                      {Math.round(Number(row.bonus_points) || 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoneyUZS(row.avg_order_value)}
                    </TableCell>
                    <TableCell className="text-center">
                      {getLoyaltyBadge(row.loyalty_score)}
                    </TableCell>
                    <TableCell>
                      {formatDate(row.last_purchase_date)}
                      <span className="text-xs text-muted-foreground block">
                        ({row.days_since_last} kun oldin)
                      </span>
                    </TableCell>
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
