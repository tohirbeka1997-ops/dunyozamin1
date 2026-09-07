import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import SearchableCustomerCombobox from '@/components/common/SearchableCustomerCombobox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getSalesReturns, getCustomers, getSalesReturnById, getSettingsByCategory, getSalesReturnReasonBreakdown } from '@/db/api';
import type { CompanySettings, Customer, SalesReturnWithDetails } from '@/types/database';
import { ChevronDown, Plus, Search, Eye, Printer, RotateCcw, Edit, RefreshCw, ShoppingCart } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import PageQuickActions from '@/components/common/PageQuickActions';
import { formatReturnMoney, aggregateReturnAmounts, formatMoneyUZS } from '@/lib/format';
import { DualCurrencyAmount } from '@/components/common/DualCurrencyAmount';
import { formatOrderDateTime } from '@/lib/datetime';
import { printReturnReceipt } from '@/lib/receipts/printReturnReceipt';
import { useReceiptSettings } from '@/hooks/useReceiptSettings';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import { useMainScrollRestoration } from '@/hooks/useMainScrollRestoration';
import { createBackNavigationState, buildCurrentPath } from '@/lib/pageState';
import {
  clampListPage,
  listSessionStorageKey,
  pageToZeroBasedIndex,
  parseListPageParam,
  withReturnToPath,
} from '@/lib/listState';
import { useSalesReturnsListStore } from '@/store/salesReturnsListStore';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';

const KNOWN_RETURN_REASON_SLUGS = new Set([
  'damaged',
  'incorrect',
  'defective',
  'dissatisfaction',
  'expired',
  'other',
  'exchange',
  'unknown',
]);

type ReasonBreakdownRow = {
  reason: string;
  return_count: number;
  refund_total: number;
  orderless_count: number;
};

function formatReturnReasonLabel(
  reason: string | null | undefined,
  translate: (key: string) => string,
): string {
  const raw = String(reason ?? '').trim();
  if (!raw) return translate('sales_returns.create.reasons.unknown');
  const slug = raw.toLowerCase();
  if (KNOWN_RETURN_REASON_SLUGS.has(slug)) {
    return translate(`sales_returns.create.reasons.${slug}`);
  }
  return raw;
}

function sortReasonBreakdown(rows: ReasonBreakdownRow[]): ReasonBreakdownRow[] {
  return [...rows].sort((a, b) => {
    const byCount = Number(b.return_count || 0) - Number(a.return_count || 0);
    if (byCount !== 0) return byCount;
    return Number(b.refund_total || 0) - Number(a.refund_total || 0);
  });
}

const REASON_BREAKDOWN_OPEN_KEY = 'salesReturns:reasonBreakdownOpen';

function readReasonBreakdownOpen(): boolean {
  try {
    return sessionStorage.getItem(REASON_BREAKDOWN_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export default function SalesReturns() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile } = useAuth();
  const { searchParams, updateParams, clearTrackedParams } = useSessionSearchParams({
    storageKey: listSessionStorageKey(
      'returns',
      user?.id,
      (profile as { branch_id?: string } | null)?.branch_id,
    ),
    trackedKeys: ['search', 'startDate', 'endDate', 'customer', 'status', 'mode', 'page', 'pageSize'],
  });
  const [returns, setReturns] = useState<SalesReturnWithDetails[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const searchTerm = searchParams.get('search') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  const selectedCustomer = searchParams.get('customer') || 'all';
  const selectedStatus = searchParams.get('status') || 'all';
  const selectedMode = searchParams.get('mode') || 'all';
  const page = parseListPageParam(searchParams.get('page'), 1);
  const pageIndex = pageToZeroBasedIndex(page);
  const pageSizeRaw = Number(searchParams.get('pageSize') || 50) || 50;
  const pageSize = [25, 50, 100].includes(pageSizeRaw) ? pageSizeRaw : 50;
  const listAnchorRef = useRef<HTMLDivElement | null>(null);
  const prevFilterKeyRef = useRef<string | null>(null);
  const listQueryKey = searchParams.toString();
  const storedQueryKey = useSalesReturnsListStore((state) => state.queryKey);
  const storedScrollTop = useSalesReturnsListStore((state) => state.scrollTop);
  const setStoredScrollTop = useSalesReturnsListStore((state) => state.setScrollTop);
  const resetForQuery = useSalesReturnsListStore((state) => state.resetForQuery);
  const restoredScrollTop = storedQueryKey === listQueryKey ? storedScrollTop : 0;
  const filterKey = `${searchTerm}|${startDate}|${endDate}|${selectedCustomer}|${selectedStatus}|${selectedMode}|${pageSize}`;
  const [printingReturnId, setPrintingReturnId] = useState<string | null>(null);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [reasonBreakdown, setReasonBreakdown] = useState<ReasonBreakdownRow[]>([]);
  const [reasonBreakdownOpen, setReasonBreakdownOpen] = useState(readReasonBreakdownOpen);
  const receiptSettings = useReceiptSettings();

  useEffect(() => {
    try {
      sessionStorage.setItem(REASON_BREAKDOWN_OPEN_KEY, reasonBreakdownOpen ? '1' : '0');
    } catch {
      /* ignore quota / private mode */
    }
  }, [reasonBreakdownOpen]);

  useEffect(() => {
    if (storedQueryKey !== listQueryKey) {
      resetForQuery(listQueryKey);
    }
  }, [storedQueryKey, listQueryKey, resetForQuery]);

  const { saveScroll } = useMainScrollRestoration({
    scrollTop: restoredScrollTop,
    setScrollTop: setStoredScrollTop,
    ready: !loading,
    anchorRef: listAnchorRef,
  });

  useEffect(() => {
    void getSettingsByCategory('company')
      .then((raw) => setCompanySettings(raw as unknown as CompanySettings))
      .catch(() => setCompanySettings(null));
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const filters: Record<string, string> = {};
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;
      if (selectedCustomer !== 'all') filters.customerId = selectedCustomer;
      if (selectedStatus !== 'all') filters.status = selectedStatus;
      if (selectedMode !== 'all') filters.returnMode = selectedMode;

      const [returnsData, customersData, reasons] = await Promise.all([
        getSalesReturns(Object.keys(filters).length ? filters : undefined),
        getCustomers(),
        getSalesReturnReasonBreakdown({
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          returnMode: selectedMode !== 'all' ? selectedMode : undefined,
        }).catch(() => []),
      ]);
      setReturns(returnsData);
      setCustomers(customersData);
      setReasonBreakdown(Array.isArray(reasons) ? (reasons as ReasonBreakdownRow[]) : []);
    } catch (error) {
      console.error('Error loading sales returns:', error);
      const errorMessage = error instanceof Error ? error.message : "Qaytarishlarni yuklab bo'lmadi";
      setLoadError(errorMessage);
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast is stable enough; avoid reload loops
  }, [startDate, endDate, selectedCustomer, selectedStatus, selectedMode]);

  // Reload on mount, filter change, and after create-return navigation (location.key).
  useEffect(() => {
    void loadData();
  }, [loadData, location.pathname, location.key]);

  useEffect(() => {
    if (prevFilterKeyRef.current === null) {
      prevFilterKeyRef.current = filterKey;
      return;
    }
    if (prevFilterKeyRef.current !== filterKey) {
      prevFilterKeyRef.current = filterKey;
      updateParams({ page: '1' });
    }
  }, [filterKey, updateParams]);

  const handleSearch = async () => {
    await loadData();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Completed':
        return <Badge className="bg-success px-1.5 py-0 text-[10px] text-white sm:text-xs">{t('sales_returns.status.completed')}</Badge>;
      case 'Pending':
        return <Badge className="bg-primary px-1.5 py-0 text-[10px] text-white sm:text-xs">{t('sales_returns.status.pending')}</Badge>;
      case 'Cancelled':
        return <Badge variant="destructive" className="px-1.5 py-0 text-[10px] sm:text-xs">{t('sales_returns.status.cancelled')}</Badge>;
      case 'Draft':
        return <Badge variant="secondary" className="px-1.5 py-0 text-[10px] sm:text-xs">{t('sales_returns.status.draft')}</Badge>;
      case 'Approved':
        return <Badge className="bg-emerald-600 px-1.5 py-0 text-[10px] text-white sm:text-xs">{t('sales_returns.status.approved')}</Badge>;
      case 'Rejected':
        return <Badge variant="destructive" className="px-1.5 py-0 text-[10px] sm:text-xs">{t('sales_returns.status.rejected')}</Badge>;
      default:
        return <Badge variant="outline" className="px-1.5 py-0 text-[10px] sm:text-xs">{status}</Badge>;
    }
  };

  const handlePrint = async (returnId: string) => {
    console.log('[RETURNS] handlePrint called with returnId:', returnId, typeof returnId);
    
    if (!returnId) {
      toast({
        title: 'Xatolik',
        description: 'Qaytarish ID topilmadi',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      setPrintingReturnId(returnId);
      const returnData = await getSalesReturnById(returnId);
      console.log('[RETURNS] handlePrint: loaded return data:', {
        id: returnData?.id,
        return_number: returnData?.return_number,
        items_count: returnData?.items?.length || 0,
      });

      if (!returnData?.items?.length) {
        toast({
          title: 'Ogohlantirish',
          description: 'Qaytarishda mahsulotlar topilmadi — chekda faqat jami summa chiqadi',
          variant: 'destructive',
        });
      }

      const transport = await printReturnReceipt(returnData, companySettings, receiptSettings);
      toast({
        title: 'Chek',
        description:
          transport === 'escpos'
            ? 'Qaytarish cheki printerga yuborildi'
            : 'Qaytarish cheki chop etish oynasi ochildi',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Chop etishda xatolik yuz berdi';
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setPrintingReturnId(null);
    }
  };
  const filteredReturns = returns.filter((ret) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      ret.return_number?.toLowerCase().includes(search) ||
      ret.order?.order_number?.toLowerCase().includes(search) ||
      ret.customer?.name?.toLowerCase().includes(search)
    );
  });

  useEffect(() => {
    const next = clampListPage({
      page,
      totalItems: filteredReturns.length,
      pageSize,
      loading,
    });
    if (next !== page) updateParams({ page: String(next) });
  }, [loading, filteredReturns.length, pageSize, page, updateParams]);

  const totalPages = Math.max(1, Math.ceil(filteredReturns.length / pageSize));
  const pagedReturns = filteredReturns.slice(
    pageIndex * pageSize,
    pageIndex * pageSize + pageSize,
  );

  // While loading, do not show stale/zero KPI totals (avoids "0 so'm / 0 returns" flash).
  const returnTotals = loading
    ? { totalUzs: null as number | null, totalUsd: null as number | null }
    : aggregateReturnAmounts(filteredReturns as any);
  const completedReturns = loading
    ? null
    : filteredReturns.filter((ret) => ret.status === 'Completed').length;
  const pendingReturns = loading
    ? null
    : filteredReturns.filter((ret) => ret.status === 'Pending').length;
  const sortedReasonBreakdown = useMemo(
    () => sortReasonBreakdown(reasonBreakdown),
    [reasonBreakdown],
  );
  const reasonBreakdownSummary = useMemo(() => {
    let count = 0;
    let total = 0;
    for (const row of sortedReasonBreakdown) {
      count += Number(row.return_count || 0);
      total += Number(row.refund_total || 0);
    }
    return { count, total };
  }, [sortedReasonBreakdown]);

  return (
    <div className="space-y-4" ref={listAnchorRef}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">Sotuv qaytarishlari</h1>
          <p className="page-heading-sub">Qaytarish va pulni qaytarishni boshqarish</p>
        </div>
      </div>

      <PageQuickActions
        aria-label={t('quickActions.aria_label')}
        actions={[
          {
            id: 'new-return',
            icon: <Plus />,
            label: t('quickActions.new_return'),
            variant: 'default',
            onClick: () =>
              navigate(withReturnToPath('/returns/create', buildCurrentPath(location))),
          },
          {
            id: 'pos',
            icon: <ShoppingCart />,
            label: t('quickActions.open_pos'),
            onClick: () => navigate('/pos'),
          },
        ]}
      />

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="px-3 py-3 sm:px-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
            <div className="flex gap-3 border-b pb-3 sm:border-b-0 sm:pb-0 sm:pr-6 sm:border-r">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Jami qaytarilgan</p>
                {loading ? (
                  <>
                    <Skeleton className="h-6 w-28" />
                    <Skeleton className="h-3 w-20" />
                  </>
                ) : (
                  <>
                    <p className="truncate text-base font-semibold tabular-nums leading-tight sm:text-lg">
                      <DualCurrencyAmount
                        uzs={returnTotals.totalUzs ?? 0}
                        usd={returnTotals.totalUsd ?? 0}
                      />
                    </p>
                    <p className="text-xs text-muted-foreground">{filteredReturns.length} qaytarish</p>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-3 border-b pb-3 sm:border-b-0 sm:pb-0 sm:pr-6 sm:border-r">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Yakunlangan</p>
                {loading ? (
                  <>
                    <Skeleton className="h-6 w-12" />
                    <Skeleton className="h-3 w-24" />
                  </>
                ) : (
                  <>
                    <p className="text-base font-semibold tabular-nums leading-tight sm:text-lg">{completedReturns}</p>
                    <p className="text-xs text-muted-foreground">Qayta ishlangan</p>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Kutilmoqda</p>
                {loading ? (
                  <>
                    <Skeleton className="h-6 w-12" />
                    <Skeleton className="h-3 w-16" />
                  </>
                ) : (
                  <>
                    <p className="text-base font-semibold tabular-nums leading-tight sm:text-lg">{pendingReturns}</p>
                    <p className="text-xs text-muted-foreground">Jarayonda</p>
                  </>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!loading && sortedReasonBreakdown.length > 0 ? (
        <Collapsible
          open={reasonBreakdownOpen}
          onOpenChange={setReasonBreakdownOpen}
          className="group"
        >
          <Card className="gap-0 py-0 shadow-sm">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left sm:px-4"
                aria-expanded={reasonBreakdownOpen}
              >
                <div className="min-w-0 flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="text-sm font-semibold">
                    {t('sales_returns.reason_breakdown_title')}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {reasonBreakdownSummary.count} · {formatMoneyUZS(reasonBreakdownSummary.total)}
                  </span>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="border-t px-3 pb-3 pt-2 sm:px-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="whitespace-nowrap text-xs font-semibold sm:text-sm">
                          {t('sales_returns.reason_column')}
                        </TableHead>
                        <TableHead className="w-[5.5rem] whitespace-nowrap text-right text-xs font-semibold sm:text-sm">
                          {t('sales_returns.reason_count')}
                        </TableHead>
                        <TableHead className="w-[9.5rem] whitespace-nowrap text-right text-xs font-semibold sm:text-sm">
                          {t('sales_returns.total')}
                        </TableHead>
                        <TableHead className="w-[6.5rem] whitespace-nowrap text-right text-xs font-semibold sm:text-sm">
                          {t('sales_returns.filters.mode_orderless')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedReasonBreakdown.map((row) => (
                        <TableRow key={row.reason}>
                          <TableCell className="text-sm">
                            {formatReturnReasonLabel(row.reason, t)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{row.return_count}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoneyUZS(Number(row.refund_total || 0))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(row.orderless_count || 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ) : null}

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="px-3 py-2 sm:px-3">
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <span className="mb-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Filtrlar
            </span>
            <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 lg:flex-[2]">
                <div className="relative h-8 min-w-[11rem] shrink-0 flex-[1.25]">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Qaytarishlarni qidirish..."
                    value={searchTerm}
                    onChange={(e) => updateParams({ search: e.target.value })}
                    className="h-8 py-1 pl-8 text-xs sm:text-sm"
                  />
                </div>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => updateParams({ startDate: e.target.value })}
                  className="h-8 min-w-[9.5rem] flex-1 bg-background px-2 font-mono text-xs sm:max-w-[11rem]"
                  aria-label="Dan"
                />
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => updateParams({ endDate: e.target.value })}
                  className="h-8 min-w-[9.5rem] flex-1 bg-background px-2 font-mono text-xs sm:max-w-[11rem]"
                  aria-label="Gacha"
                />
                <div className="min-w-[8rem] flex-1 basis-[10rem]">
                  <SearchableCustomerCombobox
                    value={selectedCustomer}
                    onValueChange={(value) => updateParams({ customer: value })}
                    knownCustomers={customers}
                    prefixOptions={[
                      { value: 'all', label: t('combobox.all_customers', 'Barcha mijozlar') },
                    ]}
                    triggerClassName="h-8 bg-background px-2 text-xs"
                  />
                </div>
                <div className="min-w-[8rem] flex-1 basis-[9rem]">
                  <Select value={selectedStatus} onValueChange={(value) => updateParams({ status: value })}>
                    <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                      <SelectValue placeholder="Barcha holatlar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('sales_returns.all_statuses')}</SelectItem>
                      <SelectItem value="Draft">{t('sales_returns.status.draft')}</SelectItem>
                      <SelectItem value="Pending">{t('sales_returns.status.pending')}</SelectItem>
                      <SelectItem value="Approved">{t('sales_returns.status.approved')}</SelectItem>
                      <SelectItem value="Completed">{t('sales_returns.status.completed')}</SelectItem>
                      <SelectItem value="Rejected">{t('sales_returns.status.rejected')}</SelectItem>
                      <SelectItem value="Cancelled">{t('sales_returns.status.cancelled')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[8rem] flex-1 basis-[9rem]">
                  <Select value={selectedMode} onValueChange={(value) => updateParams({ mode: value })}>
                    <SelectTrigger className="h-8 w-full min-w-0 bg-background px-2 text-xs [&_span]:truncate">
                      <SelectValue placeholder={t('sales_returns.filters.all_modes')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('sales_returns.filters.all_modes')}</SelectItem>
                      <SelectItem value="order">{t('sales_returns.filters.mode_order')}</SelectItem>
                      <SelectItem value="manual">{t('sales_returns.filters.mode_orderless')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 border-t border-dashed border-muted-foreground/25 pt-2 lg:border-t-0 lg:pt-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    clearTrackedParams();
                  }}
                >
                  Tozalash
                </Button>
                <Button type="button" size="sm" className="h-8 text-xs" onClick={handleSearch}>
                  Filtrni qo'llash
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="border-b px-4 py-2">
          <CardTitle className="text-base font-semibold">
            Qaytarishlar ro&apos;yxati {loading ? '' : `(${filteredReturns.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-3 pt-0">
          {loadError && !loading ? (
            <div className="px-4 py-12 text-center space-y-3">
              <p className="text-destructive">{loadError}</p>
              <Button size="sm" className="h-8 text-xs" onClick={() => void loadData()}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Qayta urinish
              </Button>
            </div>
          ) : loading ? (
            <div className="space-y-2 px-4 py-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-3/4" />
            </div>
          ) : filteredReturns.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <RotateCcw className="mx-auto mb-4 h-10 w-10 text-muted-foreground/70" />
              <p className="text-muted-foreground">Qaytarishlar topilmadi</p>
              <Button
                size="sm"
                className="mt-4 h-8 text-xs"
                onClick={() => navigate(withReturnToPath('/returns/create', buildCurrentPath(location)))}
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Birinchi qaytarishni yaratish
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="whitespace-nowrap text-xs font-semibold sm:text-sm">Qaytarish raqami</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold sm:text-sm">Sana va vaqt</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold sm:text-sm">Buyurtma raqami</TableHead>
                  <TableHead className="min-w-[8rem] text-xs font-semibold sm:text-sm">Mijoz</TableHead>
                  <TableHead className="text-xs font-semibold sm:text-sm">Kassir</TableHead>
                  <TableHead className="whitespace-nowrap text-right text-xs font-semibold sm:text-sm">Summa</TableHead>
                  <TableHead className="text-xs font-semibold sm:text-sm">Holati</TableHead>
                  <TableHead className="text-right text-xs font-semibold sm:text-sm">Amallar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedReturns.map((ret) => (
                  <TableRow key={ret.id} className="text-sm">
                    <TableCell className="max-w-[11rem] truncate py-2 font-medium font-mono text-xs">{ret.return_number}</TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-xs">
                      {formatOrderDateTime(ret.created_at)}
                    </TableCell>
                    <TableCell className="max-w-[9rem] truncate py-2 text-xs">
                      {ret.order_id ? (
                        <button
                          type="button"
                          className="text-primary underline-offset-2 hover:underline"
                          onClick={() =>
                            navigate(`/orders/${ret.order_id}`, {
                              state: createBackNavigationState(location),
                            })
                          }
                        >
                          {ret.order?.order_number || ret.order_id}
                        </button>
                      ) : (
                        ret.order?.order_number || (ret.return_mode === 'manual' ? 'Ordersiz' : '-')
                      )}
                    </TableCell>
                    <TableCell className="max-w-[10rem] truncate py-2">{ret.customer?.name || 'Yangi mijoz'}</TableCell>
                    <TableCell className="max-w-[7rem] truncate py-2 text-xs">{ret.cashier?.username || '-'}</TableCell>
                    <TableCell className="py-2 text-right text-xs tabular-nums font-medium">
                      {formatReturnMoney(ret, {
                        currency: (ret as any).order_currency ?? ret.order?.currency,
                      })}
                    </TableCell>
                    <TableCell className="py-2">{getStatusBadge(ret.status)}</TableCell>
                    <TableCell className="py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            console.log('[RETURNS] View button clicked:', {
                              id: ret.id,
                              return_number: ret.return_number,
                              type: typeof ret.id,
                            });
                            if (!ret.id) {
                              toast({
                                title: 'Xatolik',
                                description: 'Qaytarish ID topilmadi. Ro\'yxat ma\'lumotlarida xatolik.',
                                variant: 'destructive',
                              });
                              return;
                            }
                            saveScroll();
                            navigate(
                              withReturnToPath(`/returns/${ret.id}`, buildCurrentPath(location)),
                            );
                          }}
                          title="Tafsilotlarni ko'rish"
                          aria-label="Qaytarish tafsilotlarini ko'rish"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {String(ret.status || '').toLowerCase() !== 'completed' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              console.log('[RETURNS] Edit button clicked:', {
                                id: ret.id,
                                return_number: ret.return_number,
                                status: ret.status,
                              });
                              if (!ret.id) {
                                toast({
                                  title: 'Xatolik',
                                  description: 'Qaytarish ID topilmadi. Ro\'yxat ma\'lumotlarida xatolik.',
                                  variant: 'destructive',
                                });
                                return;
                              }
                              saveScroll();
                              navigate(
                                withReturnToPath(`/returns/${ret.id}/edit`, buildCurrentPath(location)),
                              );
                            }}
                            title="Qaytarishni tahrirlash"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            console.log('[RETURNS] Print button clicked:', {
                              id: ret.id,
                              return_number: ret.return_number,
                            });
                            if (!ret.id) {
                              toast({
                                title: 'Xatolik',
                                description: 'Qaytarish ID topilmadi. Ro\'yxat ma\'lumotlarida xatolik.',
                                variant: 'destructive',
                              });
                              return;
                            }
                            handlePrint(ret.id);
                          }}
                          disabled={printingReturnId === ret.id}
                          title="Chop etish"
                        >
                          {printingReturnId === ret.id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                          ) : (
                            <Printer className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
          {!loading && filteredReturns.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
              <p className="text-xs text-muted-foreground">
                {filteredReturns.length} ta · {page}/{totalPages} sahifa
              </p>
              <div className="flex items-center gap-2">
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => updateParams({ pageSize: String(Number(v) || 50), page: '1' })}
                >
                  <SelectTrigger className="h-8 w-[5.5rem] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={page <= 1}
                  onClick={() => updateParams({ page: String(Math.max(1, page - 1)) })}
                >
                  Oldingi
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={page >= totalPages}
                  onClick={() => updateParams({ page: String(Math.min(totalPages, page + 1)) })}
                >
                  Keyingi
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
