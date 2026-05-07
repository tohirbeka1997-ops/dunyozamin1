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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Check, ChevronsUpDown, DollarSign, Percent, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { formatDateYMD, todayYMD } from '@/lib/datetime';
import { formatMoneyUZS } from '@/lib/format';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { useTableSort } from '@/hooks/useTableSort';
import { compareScalar } from '@/lib/tableSort';
import { SortableTableHead } from '@/components/reports/SortableTableHead';
import { getCustomers } from '@/db/api';
import type { Customer } from '@/types/database';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';

interface CustomerProfitability {
  customer_id: string;
  customer_name: string;
  customer_phone?: string;
  /** Loyallik: joriy qoldiq (A+/A badge emas) */
  bonus_points: number;
  total_sales: number;
  total_cost: number;
  total_discounts: number;
  total_returns: number;
  net_profit: number;
  profit_margin: number;
  order_count: number;
  avg_profit_per_order: number;
  profitability_score: number;
}

const WALK_IN_ID = 'default-customer-001';

type ProfitSortKey =
  | 'customer_name'
  | 'customer_phone'
  | 'total_sales'
  | 'total_cost'
  | 'total_discounts'
  | 'total_returns'
  | 'net_profit'
  | 'profit_margin'
  | 'order_count'
  | 'profitability_score'
  | 'bonus_points';

function defaultDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return formatDateYMD(d);
}

export default function CustomerProfitabilityReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CustomerProfitability[]>([]);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(todayYMD);
  const { sortKey, sortOrder, toggleSort } = useTableSort<ProfitSortKey>('net_profit', 'desc');
  const [filterProfitable, setFilterProfitable] = useState<string>('all');

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
  }, [dateFrom, dateTo]);

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
        setPickerCustomers(
          (Array.isArray(list) ? list : []).filter((c) => c.id !== WALK_IN_ID)
        );
      } catch {
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
      const data = await handleIpcResponse<CustomerProfitability[]>(
        api.reports?.customerProfitability?.({
          date_from: dateFrom,
          date_to: dateTo,
        }) || Promise.resolve([])
      );
      setRows(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('[CustomerProfitabilityReport] loadData error:', error);
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
    if (selectedCustomer) {
      result = result.filter((r) => r.customer_id === selectedCustomer.id);
    }
    if (filterProfitable === 'profitable') {
      result = result.filter((row) => row.net_profit > 0);
    } else if (filterProfitable === 'unprofitable') {
      result = result.filter((row) => row.net_profit < 0);
    }
    return result;
  }, [rows, selectedCustomer, filterProfitable]);

  const sortedFiltered = useMemo(() => {
    const list = [...filtered];
    const key = sortKey;
    const ord = sortOrder;
    list.sort((a, b) => {
      let va: string | number;
      let vb: string | number;
      switch (key) {
        case 'customer_name':
          va = a.customer_name.toLowerCase();
          vb = b.customer_name.toLowerCase();
          break;
        case 'customer_phone':
          va = (a.customer_phone || '').toLowerCase();
          vb = (b.customer_phone || '').toLowerCase();
          break;
        case 'total_sales':
          va = Number(a.total_sales);
          vb = Number(b.total_sales);
          break;
        case 'total_cost':
          va = Number(a.total_cost);
          vb = Number(b.total_cost);
          break;
        case 'total_discounts':
          va = Number(a.total_discounts);
          vb = Number(b.total_discounts);
          break;
        case 'total_returns':
          va = Number(a.total_returns);
          vb = Number(b.total_returns);
          break;
        case 'net_profit':
          va = Number(a.net_profit);
          vb = Number(b.net_profit);
          break;
        case 'profit_margin':
          va = Number(a.profit_margin);
          vb = Number(b.profit_margin);
          break;
        case 'order_count':
          va = Number(a.order_count);
          vb = Number(b.order_count);
          break;
        case 'profitability_score':
          va = Number(a.profitability_score);
          vb = Number(b.profitability_score);
          break;
        case 'bonus_points':
          va = Number(a.bonus_points);
          vb = Number(b.bonus_points);
          break;
        default:
          return 0;
      }
      return compareScalar(va, vb, ord);
    });
    return list;
  }, [filtered, sortKey, sortOrder]);

  const summary = useMemo(() => {
    const totalSales = filtered.reduce((sum, r) => sum + Number(r.total_sales || 0), 0);
    const totalCost = filtered.reduce((sum, r) => sum + Number(r.total_cost || 0), 0);
    const totalDiscounts = filtered.reduce((sum, r) => sum + Number(r.total_discounts || 0), 0);
    const totalReturns = filtered.reduce((sum, r) => sum + Number(r.total_returns || 0), 0);
    const netProfit = filtered.reduce((sum, r) => sum + Number(r.net_profit || 0), 0);
    const avgMargin =
      filtered.length > 0
        ? filtered.reduce((sum, r) => sum + Number(r.profit_margin || 0), 0) / filtered.length
        : 0;
    const profitable = filtered.filter((r) => r.net_profit > 0).length;
    const unprofitable = filtered.filter((r) => r.net_profit < 0).length;
    return {
      totalSales,
      totalCost,
      totalDiscounts,
      totalReturns,
      netProfit,
      avgMargin,
      profitable,
      unprofitable,
    };
  }, [filtered]);

  const getGradeBadge = (score: number) => {
    if (score >= 80) return <Badge className="bg-green-600">A+</Badge>;
    if (score >= 60) return <Badge className="bg-blue-600">A</Badge>;
    if (score >= 40) return <Badge className="bg-yellow-600">B</Badge>;
    if (score >= 20) return <Badge className="bg-orange-600">C</Badge>;
    return <Badge variant="destructive">D</Badge>;
  };

  if (loading) {
    return (
      <div className="flex min-h-[240px] justify-center items-center">
        <div className="h-7 w-7 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate('/reports/customer')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="page-heading flex items-center gap-1.5 text-base md:text-lg">
              <DollarSign className="h-6 w-6 shrink-0 text-green-500" />
              Mijoz rentabelligi
            </h1>
            <p className="text-muted-foreground text-xs">Sotuv, tan narx, chegirma, qaytarish · KPI tanlangan/ filtrlangan qatorlarga nisbatan</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={loadData}>
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">Mijoz (qidirish va tanlash)</Label>
              <div className="flex gap-1.5">
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
                      className="h-8 min-w-0 flex-1 justify-between font-normal"
                    >
                      <span className="truncate text-left text-sm">
                        {selectedCustomer ? (
                          <span className="text-foreground">
                            {selectedCustomer.name}
                            {selectedCustomer.phone ? ` — ${selectedCustomer.phone}` : ''}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Barcha mijozlar…</span>
                        )}
                      </span>
                      <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[min(92vw,32rem)] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Ism, telefon, email…"
                        value={customerSearch}
                        onValueChange={setCustomerSearch}
                      />
                      <CommandList>
                        {pickerLoading ? (
                          <p className="p-2 text-xs text-muted-foreground">Qidirilmoqda…</p>
                        ) : (
                          <>
                            <CommandEmpty>Topilmadi</CommandEmpty>
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
                                  <div className="min-w-0 text-sm">
                                    <div className="font-medium leading-tight">{c.name}</div>
                                    {(c.phone || c.email) && (
                                      <div className="text-xs text-muted-foreground">
                                        {[c.phone, c.email].filter(Boolean).join(' · ')}
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
                {selectedCustomer && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    title="Tanlovni olib tashlash"
                    onClick={() => setSelectedCustomer(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Boshlanish</Label>
              <Input
                className="h-8"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tugash</Label>
              <Input className="h-8" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2 xl:col-span-2">
              <Label className="text-xs text-muted-foreground">Foyd/zarar</Label>
              <Select value={filterProfitable} onValueChange={setFilterProfitable}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Hammasi</SelectItem>
                  <SelectItem value="profitable">Foydali</SelectItem>
                  <SelectItem value="unprofitable">Zararli</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-muted-foreground mt-2 text-[11px] leading-snug">
            Ustun sarlavhasiga bosing — tartib almashadi. «Daraja» = rentabellik indeksi, «Bonus ball» = loyallik
            qoldiqi.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
        {[
          {
            k: 'sales',
            icon: DollarSign,
            iconC: 'text-primary',
            label: 'Jami sotuv',
            val: formatMoneyUZS(summary.totalSales),
            sub: null,
          },
          {
            k: 'cost',
            icon: TrendingDown,
            iconC: 'text-orange-500',
            label: 'Tan narx',
            val: formatMoneyUZS(summary.totalCost),
            sub: null,
          },
          {
            k: 'disc',
            icon: Percent,
            iconC: 'text-yellow-500',
            label: 'Chegirma',
            val: formatMoneyUZS(summary.totalDiscounts),
            sub: null,
          },
          {
            k: 'ret',
            icon: TrendingDown,
            iconC: 'text-destructive',
            label: 'Qaytarish',
            val: formatMoneyUZS(summary.totalReturns),
            sub: null,
          },
          {
            k: 'net',
            icon: TrendingUp,
            iconC: 'text-green-500',
            label: 'Net foyda',
            val: formatMoneyUZS(summary.netProfit),
            sub: `Marja ø ${summary.avgMargin.toFixed(1)}%`,
            valClass: summary.netProfit >= 0 ? 'text-green-600' : 'text-red-600',
          },
          {
            k: 'prof',
            icon: TrendingUp,
            iconC: 'text-green-500',
            label: 'Foydali',
            val: String(summary.profitable),
            sub:
              filtered.length > 0 ? `${((summary.profitable / filtered.length) * 100).toFixed(0)}%` : '0%',
            valClass: 'text-green-600',
          },
          {
            k: 'unp',
            icon: TrendingDown,
            iconC: 'text-destructive',
            label: 'Zararli',
            val: String(summary.unprofitable),
            sub:
              filtered.length > 0
                ? `${((summary.unprofitable / filtered.length) * 100).toFixed(0)}%`
                : '0%',
            valClass: 'text-red-600',
          },
        ].map((c) => (
          <Card key={c.k} className="shadow-sm">
            <CardContent className="p-2.5 sm:p-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <c.icon className={cn('h-3.5 w-3.5 shrink-0', c.iconC)} />
                <p className="text-muted-foreground truncate text-[10px] sm:text-xs">{c.label}</p>
              </div>
              <div
                className={cn('mt-1 text-sm font-bold leading-tight sm:text-base', (c as any).valClass)}
              >
                {c.val}
              </div>
              {c.sub != null && (
                <p className="text-muted-foreground mt-0.5 truncate text-[10px]">{c.sub}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {selectedCustomer && filtered.length === 0 ? (
            <div className="text-muted-foreground p-6 text-center text-sm">
              «{selectedCustomer.name}» ushbu sana oralig&apos;ida yoki tanlangan foyda filtrida ko&apos;rinmadi
              (shu davrda tugallangan sotuv yo&apos;q).
            </div>
          ) : sortedFiltered.length === 0 ? (
            <div className="py-10 text-center">
              <DollarSign className="text-muted-foreground mx-auto mb-2 h-10 w-10" />
              <p className="text-muted-foreground text-sm">Ma&apos;lumot yo&apos;q</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full min-w-[780px] table-auto text-xs sm:text-sm [&_th]:p-1.5 [&_td]:p-1.5">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <SortableTableHead<ProfitSortKey>
                      className="min-w-[5.5rem] max-w-[10rem]"
                      columnKey="customer_name"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="string"
                    >
                      Mijoz
                    </SortableTableHead>
                    <SortableTableHead<ProfitSortKey>
                      className="min-w-[4.5rem] max-w-[7rem]"
                      columnKey="customer_phone"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="string"
                    >
                      Telefon
                    </SortableTableHead>
                    <SortableTableHead<ProfitSortKey>
                      className="min-w-[4.25rem] whitespace-nowrap"
                      columnKey="total_sales"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="right"
                    >
                      Sotuv
                    </SortableTableHead>
                    <SortableTableHead<ProfitSortKey>
                      className="min-w-[4.25rem] whitespace-nowrap"
                      columnKey="total_cost"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="right"
                    >
                      Tan narx
                    </SortableTableHead>
                    <SortableTableHead<ProfitSortKey>
                      className="min-w-[3.5rem] whitespace-nowrap"
                      columnKey="total_discounts"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="right"
                    >
                      Cheg.
                    </SortableTableHead>
                    <SortableTableHead<ProfitSortKey>
                      className="min-w-[3.5rem] whitespace-nowrap"
                      columnKey="total_returns"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="right"
                    >
                      Qayt.
                    </SortableTableHead>
                    <SortableTableHead<ProfitSortKey>
                      className="min-w-[4.5rem] whitespace-nowrap"
                      columnKey="net_profit"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="right"
                    >
                      Net
                    </SortableTableHead>
                    <SortableTableHead<ProfitSortKey>
                      className="min-w-[2.75rem] whitespace-nowrap"
                      columnKey="profit_margin"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="right"
                    >
                      Marja
                    </SortableTableHead>
                    <SortableTableHead<ProfitSortKey>
                      className="min-w-[2.25rem] whitespace-nowrap"
                      columnKey="order_count"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="right"
                    >
                      Buyr.
                    </SortableTableHead>
                    <SortableTableHead<ProfitSortKey>
                      className="min-w-[2.5rem] whitespace-nowrap"
                      columnKey="profitability_score"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="center"
                    >
                      Daraja
                    </SortableTableHead>
                    <SortableTableHead<ProfitSortKey>
                      className="min-w-[2.5rem] whitespace-nowrap"
                      columnKey="bonus_points"
                      sortKey={sortKey}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                      kind="number"
                      align="right"
                    >
                      Bonus
                    </SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedFiltered.map((row) => {
                    const isProfitable = row.net_profit >= 0;
                    return (
                      <TableRow key={row.customer_id}>
                        <TableCell className="truncate font-medium" title={row.customer_name}>
                          {row.customer_name}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-0 truncate text-xs" title={row.customer_phone || ''}>
                          {row.customer_phone || '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs tabular-nums sm:text-sm">
                          {formatMoneyUZS(row.total_sales)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs text-orange-600 tabular-nums sm:text-sm">
                          {formatMoneyUZS(row.total_cost)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs text-yellow-700 tabular-nums sm:text-sm">
                          {formatMoneyUZS(row.total_discounts)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs text-destructive tabular-nums sm:text-sm">
                          {formatMoneyUZS(row.total_returns)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'whitespace-nowrap text-right text-xs font-semibold tabular-nums sm:text-sm',
                            isProfitable ? 'text-green-600' : 'text-red-600'
                          )}
                        >
                          {formatMoneyUZS(row.net_profit)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'whitespace-nowrap text-right text-xs tabular-nums sm:text-sm',
                            row.profit_margin >= 20
                              ? 'text-green-600'
                              : row.profit_margin >= 10
                                ? 'text-yellow-700'
                                : 'text-red-600'
                          )}
                        >
                          {row.profit_margin.toFixed(1)}%
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs tabular-nums sm:text-sm">
                          {row.order_count}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {getGradeBadge(row.profitability_score)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs font-mono tabular-nums sm:text-sm">
                          {Math.round(Number(row.bonus_points) || 0)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
