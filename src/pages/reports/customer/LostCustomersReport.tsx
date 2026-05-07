import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ArrowLeft, Check, ChevronsUpDown, UserX, AlertTriangle, TrendingDown, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { getCustomers } from '@/db/api';
import type { Customer } from '@/types/database';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

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

const WALK_IN_ID = 'default-customer-001';

export default function LostCustomersReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LostCustomer[]>([]);
  const [inactiveDays, setInactiveDays] = useState(7);
  const [riskFilter, setRiskFilter] = useState<string>('all');

  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedCustomerSearch = useDebounce(customerSearch, 200);
  const [pickerCustomers, setPickerCustomers] = useState<Customer[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inactiveDays]);

  useEffect(() => {
    if (!customerPickerOpen) return;
    let cancelled = false;
    (async () => {
      setPickerLoading(true);
      try {
        const list = await getCustomers({
          searchTerm: debouncedCustomerSearch.trim() || undefined,
        });
        if (cancelled) return;
        const arr = (Array.isArray(list) ? list : []).filter((c) => c.id !== WALK_IN_ID);
        setPickerCustomers(arr);
      } catch (e) {
        if (!cancelled) setPickerCustomers([]);
      } finally {
        if (!cancelled) setPickerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerPickerOpen, debouncedCustomerSearch]);

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

  const selectedInLostList = useMemo(() => {
    if (!selectedCustomer) return true;
    return rows.some((r) => r.customer_id === selectedCustomer.id);
  }, [rows, selectedCustomer]);

  const filtered = useMemo(() => {
    let result = rows;

    if (selectedCustomer) {
      result = result.filter((row) => row.customer_id === selectedCustomer.id);
    }

    if (riskFilter !== 'all') {
      result = result.filter((row) => row.risk_level === riskFilter);
    }

    return result;
  }, [rows, riskFilter, selectedCustomer]);

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
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/customer')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading flex items-center gap-2">
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="md:col-span-2 space-y-2">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label className="text-sm text-muted-foreground">Mijoz (qidirish va tanlash)</Label>
                  <Popover
                    open={customerPickerOpen}
                    onOpenChange={(open) => {
                      setCustomerPickerOpen(open);
                      if (!open) setCustomerSearch('');
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={customerPickerOpen}
                        className="h-9 w-full justify-between font-normal"
                      >
                        <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
                          {selectedCustomer
                            ? (
                                <span className="text-foreground">
                                  {selectedCustomer.name}
                                  {selectedCustomer.phone ? ` — ${selectedCustomer.phone}` : ''}
                                </span>
                              )
                            : 'Barcha yo‘qolganlar — mijoz qidiring yoki tanlang...'}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[min(92vw,32rem)] p-0"
                      align="start"
                    >
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Ism, telefon yoki email bo‘yicha qidirish..."
                          value={customerSearch}
                          onValueChange={setCustomerSearch}
                        />
                        <CommandList>
                          {pickerLoading ? (
                            <p className="p-3 text-sm text-muted-foreground">Qidirilmoqda...</p>
                          ) : (
                            <>
                              <CommandEmpty>Mijoz topilmadi</CommandEmpty>
                              <CommandGroup>
                                {pickerCustomers.map((c) => (
                                  <CommandItem
                                    key={c.id}
                                    value={`${c.id}-${c.name}`}
                                    onSelect={() => {
                                      setSelectedCustomer(c);
                                      setCustomerPickerOpen(false);
                                      setCustomerSearch('');
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        'mr-2 h-4 w-4',
                                        selectedCustomer?.id === c.id ? 'opacity-100' : 'opacity-0'
                                      )}
                                    />
                                    <div className="min-w-0">
                                      <div className="truncate font-medium">{c.name}</div>
                                      {(c.phone || c.email) && (
                                        <div className="text-xs text-muted-foreground">
                                          {c.phone || ''}
                                          {c.phone && c.email ? ' · ' : ''}
                                          {c.email || ''}
                                        </div>
                                      )}
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                {selectedCustomer && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-9 shrink-0"
                    title="Tanlovni olib tashlash"
                    onClick={() => setSelectedCustomer(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">Faol emas (kunlar)</Label>
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
            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">Xavf darajasi</Label>
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

      {selectedCustomer && !loading && !selectedInLostList && (
        <Alert>
          <UserX className="h-4 w-4" />
          <AlertTitle>Tanlangan mijoz hozircha «yo‘qolgan» emas</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            {selectedCustomer.name} hozirgi «oxirgi {inactiveDays} kun ichida sotimagan» sharti bo‘yicha yo‘qolgan
            deb hisoblanmayapti: yaqinda sotuv bo‘lgan yoki umuman tugallangan buyurtma topilmaydi. Kun yoki
            xavf filtrini o‘zgartirib ko‘ring, yoki tanlovni olib qo‘ying.
          </AlertDescription>
        </Alert>
      )}

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
                {selectedCustomer && !selectedInLostList
                  ? 'Jadvalda qator yo‘q — tafsilot yuqoridagi xabarda.'
                  : selectedCustomer && selectedInLostList && riskFilter !== 'all'
                    ? 'Xavf darajasi bo‘yicha mos qator yo‘q. «Hammasi» ni tanlang.'
                    : 'Yo‘qolgan mijozlar mavjud emas'}
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
