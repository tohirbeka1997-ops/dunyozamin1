import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { ArrowLeft, FileDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import { formatDateTime, todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { getShiftSummary, getShifts } from '@/db/api';

type ShiftRow = any;

type ShiftSummary = {
  shiftId: string;
  openedAt: string | null;
  closedAt: string | null;
  status: 'open' | 'closed';
  openingCash: number;
  totalSales: number;
  cashSales: number;
  orders: number;
  totalRefunds: number;
  expectedCash: number;
};

export default function ShiftClosingsReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(todayYMD());
  const [dateTo, setDateTo] = useState(todayYMD());
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const [rows, setRows] = useState<
    Array<{
      shift: ShiftRow;
      cashierName: string;
      summary: ShiftSummary | null;
    }>
  >([]);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, statusFilter]);

  async function loadData() {
    try {
      setLoading(true);

      const shifts = await getShifts({
        limit: 500,
        status: statusFilter,
        // IMPORTANT: Send YYYY-MM-DD (local calendar dates).
        // Backend applies DATE(opened_at, 'localtime') filtering so single-day ranges work correctly.
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });

      const uniqueCashierIds = Array.from(
        new Set(
          (shifts || [])
            .map((s: any) => s.cashier_id || s.user_id)
            .filter(Boolean)
            .map((x: any) => String(x))
        )
      );

      const cashierNameById = new Map<string, string>();
      if (typeof window !== 'undefined' && (window as any).posApi?.auth?.getUser) {
        const users = await Promise.all(
          uniqueCashierIds.map(async (id) => {
            try {
              return await (window as any).posApi.auth.getUser(id);
            } catch {
              return null;
            }
          })
        );
        users.forEach((u: any) => {
          if (!u?.id) return;
          cashierNameById.set(String(u.id), String(u.full_name || u.username || 'Noma\'lum'));
        });
      }

      const summaries = await Promise.all(
        (shifts || []).map(async (s: any) => {
          try {
            const summary = await getShiftSummary(String(s.id));
            return summary as ShiftSummary;
          } catch {
            return null;
          }
        })
      );

      const merged = (shifts || []).map((s: any, idx: number) => {
        const cashierId = String(s.cashier_id || s.user_id || '');
        const cashierName = cashierNameById.get(cashierId) || (cashierId ? cashierId : 'Noma\'lum');
        return { shift: s, cashierName, summary: summaries[idx] || null };
      });

      setRows(merged);
    } catch (error) {
      console.error('[ShiftClosingsReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: 'Smenalar hisobotini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  const filteredRows = useMemo(() => {
    if (!searchTerm) return rows;
    const s = searchTerm.toLowerCase();
    return rows.filter(({ shift, cashierName }) => {
      const shiftNumber = String(shift.shift_number || '').toLowerCase();
      const cashier = String(cashierName || '').toLowerCase();
      return shiftNumber.includes(s) || cashier.includes(s);
    });
  }, [rows, searchTerm]);

  const getStatusBadge = (status: string) => {
    const st = String(status || '').toLowerCase();
    if (st === 'open') return <Badge className="bg-primary text-white">Ochiq</Badge>;
    if (st === 'closed') return <Badge className="bg-success text-white">Yopilgan</Badge>;
    return <Badge className="bg-muted text-muted-foreground">{String(status || '-')}</Badge>;
  };

  const handleExport = (format: 'excel' | 'pdf') => {
    toast({
      title: 'Eksport',
      description: `${format.toUpperCase()} ga eksport qilinmoqda...`,
    });
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
            <h1 className="text-3xl font-bold">Smenalar (kassa) hisobotlari</h1>
            <p className="text-muted-foreground">Har bir kassa ochilishi/yopilishi bo\'yicha tahlil</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport('excel')}>
            <FileDown className="h-4 w-4 mr-2" />
            Excel
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')}>
            <FileDown className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sanasi</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sanasi</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Holati</label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                <SelectTrigger>
                  <SelectValue placeholder="Barchasi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barchasi</SelectItem>
                  <SelectItem value="open">Ochiq</SelectItem>
                  <SelectItem value="closed">Yopilgan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Smena raqami yoki kassir..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filteredRows.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Smenalar topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Smena</TableHead>
                  <TableHead>Kassir</TableHead>
                  <TableHead>Holati</TableHead>
                  <TableHead>Ochildi</TableHead>
                  <TableHead>Yopildi</TableHead>
                  <TableHead className="text-right">Ochilish naqd</TableHead>
                  <TableHead className="text-right">Kutilgan naqd</TableHead>
                  <TableHead className="text-right">Yopilish naqd</TableHead>
                  <TableHead className="text-right">Farq</TableHead>
                  <TableHead className="text-right">Jami tushum</TableHead>
                  <TableHead className="text-right">Naqd tushum</TableHead>
                  <TableHead className="text-right">Buyurtmalar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map(({ shift, cashierName, summary }) => {
                  const openingCash = Number(shift.opening_cash || 0);
                  const expectedCash =
                    Number(shift.expected_cash ?? summary?.expectedCash ?? (openingCash + Number(summary?.cashSales || 0)));
                  const closingCash = shift.closing_cash == null ? null : Number(shift.closing_cash);
                  const diff = shift.cash_difference == null ? null : Number(shift.cash_difference);

                  return (
                    <TableRow key={shift.id}>
                      <TableCell className="font-medium">{shift.shift_number || shift.id}</TableCell>
                      <TableCell>{cashierName}</TableCell>
                      <TableCell>{getStatusBadge(shift.status)}</TableCell>
                      <TableCell>{formatDateTime(shift.opened_at)}</TableCell>
                      <TableCell>{shift.closed_at ? formatDateTime(shift.closed_at) : '-'}</TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(openingCash)}</TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(expectedCash)}</TableCell>
                      <TableCell className="text-right">{closingCash == null ? '-' : formatMoneyUZS(closingCash)}</TableCell>
                      <TableCell className={`text-right ${diff == null ? '' : diff < 0 ? 'text-destructive' : 'text-success'}`}>
                        {diff == null ? '-' : formatMoneyUZS(diff)}
                      </TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(Number(summary?.totalSales || 0))}</TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(Number(summary?.cashSales || 0))}</TableCell>
                      <TableCell className="text-right">{Number(summary?.orders || 0)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}







