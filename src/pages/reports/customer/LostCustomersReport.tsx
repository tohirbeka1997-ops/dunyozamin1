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
import { ArrowLeft, UserX, AlertTriangle, TrendingDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

interface LostCustomer {
  customer_id: string;
  customer_name: string;
  customer_phone?: string;
  last_purchase_date: string;
  days_since_last: number;
  total_purchases: number;
  total_spent: number;
  avg_order_value: number;
  order_count: number;
  risk_level: 'high' | 'medium' | 'low';
}

export default function LostCustomersReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LostCustomer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [inactiveDays, setInactiveDays] = useState(7);
  const [riskFilter, setRiskFilter] = useState<string>('all');

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inactiveDays]);

  async function loadData() {
    try {
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }
      setLoading(true);
      const api = requireElectron();
      const data = await handleIpcResponse<LostCustomer[]>(
        api.reports?.lostCustomers?.({
          inactive_days: inactiveDays,
        }) || Promise.resolve([])
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('[LostCustomersReport] loadData error:', error);
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
    let result = rows;

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (row) =>
          row.customer_name.toLowerCase().includes(term) ||
          (row.customer_phone && row.customer_phone.toLowerCase().includes(term))
      );
    }

    // Risk filter
    if (riskFilter !== 'all') {
      result = result.filter((row) => row.risk_level === riskFilter);
    }

    return result;
  }, [rows, searchTerm, riskFilter]);

  const summary = useMemo(() => {
    const lostRevenue = filtered.reduce((sum, r) => sum + Number(r.total_spent || 0), 0);
    const avgLifetimeValue = filtered.length > 0 ? lostRevenue / filtered.length : 0;
    const highRisk = filtered.filter((r) => r.risk_level === 'high').length;
    const mediumRisk = filtered.filter((r) => r.risk_level === 'medium').length;
    return { lostRevenue, avgLifetimeValue, highRisk, mediumRisk, total: filtered.length };
  }, [filtered]);

  const getRiskBadge = (risk: string) => {
    if (risk === 'high') return <Badge variant="destructive">Yuqori</Badge>;
    if (risk === 'medium') return <Badge className="bg-orange-500">O'rtacha</Badge>;
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
              <UserX className="h-8 w-8 text-orange-500" />
              Yo'qolgan mijozlar
            </h1>
            <p className="text-muted-foreground">
              Oxirgi {inactiveDays} kun ichida xarid qilmaganlar
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={loadData}>
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Ism yoki telefon..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Faol emas (kunlar)</label>
              <Select
                value={String(inactiveDays)}
                onValueChange={(v) => setInactiveDays(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 kun</SelectItem>
                  <SelectItem value="14">14 kun</SelectItem>
                  <SelectItem value="15">15 kun</SelectItem>
                  <SelectItem value="30">30 kun</SelectItem>
                  <SelectItem value="60">60 kun</SelectItem>
                  <SelectItem value="90">90 kun</SelectItem>
                  <SelectItem value="180">180 kun</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Xavf darajasi</label>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Hammasi</SelectItem>
                  <SelectItem value="high">Yuqori</SelectItem>
                  <SelectItem value="medium">O'rtacha</SelectItem>
                  <SelectItem value="low">Past</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <UserX className="h-5 w-5 text-orange-500" />
              <p className="text-sm text-muted-foreground">Yo'qolgan mijozlar</p>
            </div>
            <div className="text-2xl font-bold mt-2">{summary.total}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Oxirgi {inactiveDays} kun
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-destructive" />
              <p className="text-sm text-muted-foreground">Yo'qolgan daromad</p>
            </div>
            <div className="text-2xl font-bold mt-2">{formatMoneyUZS(summary.lostRevenue)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Tarixiy LTV
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-muted-foreground">Yuqori xavf</p>
            </div>
            <div className="text-2xl font-bold mt-2">{summary.highRisk}</div>
            <div className="text-xs text-muted-foreground mt-1">
              VIP mijozlar
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <p className="text-sm text-muted-foreground">O'rtacha xavf</p>
            </div>
            <div className="text-2xl font-bold mt-2">{summary.mediumRisk}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Muntazam mijozlar
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <UserX className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {searchTerm ? 'Qidiruv natijasi topilmadi' : 'Yo\'qolgan mijozlar mavjud emas'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mijoz</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>Oxirgi xarid</TableHead>
                  <TableHead className="text-right">Faol emas (kun)</TableHead>
                  <TableHead className="text-right">Jami xarid</TableHead>
                  <TableHead className="text-right">Buyurtmalar</TableHead>
                  <TableHead className="text-right">O'rtacha check</TableHead>
                  <TableHead className="text-center">Xavf darajasi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.customer_id}>
                    <TableCell className="font-medium">{row.customer_name}</TableCell>
                    <TableCell>{row.customer_phone || '-'}</TableCell>
                    <TableCell>
                      {formatDate(row.last_purchase_date)}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-orange-600">
                      {row.days_since_last}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoneyUZS(row.total_spent)}
                    </TableCell>
                    <TableCell className="text-right">{row.order_count}</TableCell>
                    <TableCell className="text-right">
                      {formatMoneyUZS(row.avg_order_value)}
                    </TableCell>
                    <TableCell className="text-center">{getRiskBadge(row.risk_level)}</TableCell>
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
