import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from 'react-i18next';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate } from '@/lib/datetime';
import { getQuotes } from '@/db/api';
import type { Quote, QuoteStatus } from '@/types/database';
import { useToast } from '@/hooks/use-toast';
import { FileText, Plus, RefreshCw, Search, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

function TableRowSkeleton() {
  return (
    <TableRow className="h-11">
      {Array.from({ length: 8 }).map((_, i) => (
        <TableCell key={i} className="py-2">
          <Skeleton className="h-3.5 w-full max-w-[120px]" />
        </TableCell>
      ))}
    </TableRow>
  );
}

export default function Quotes() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const statusLabels = useMemo(
    () =>
      ({
        draft: t('quotes.status_draft'),
        confirmed: t('quotes.status_confirmed'),
        expired: t('quotes.status_expired'),
        converted: t('quotes.status_converted'),
      }) satisfies Record<QuoteStatus, string>,
    [t]
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const filters: { status?: string; limit: number } = { limit: 200 };
      if (statusFilter && statusFilter !== 'all') filters.status = statusFilter;
      const data = await getQuotes(filters);
      setQuotes(Array.isArray(data) ? data : []);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setQuotes([]);
      toast({
        title: t('common.error'),
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      quotes.filter(
        (q) =>
          !search.trim() ||
          q.quote_number?.toLowerCase().includes(search.toLowerCase()) ||
          q.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
          (q.phone && q.phone.includes(search.trim()))
      ),
    [quotes, search]
  );

  const badgeVariant = (status: QuoteStatus) => {
    if (status === 'converted') return 'default' as const;
    if (status === 'draft') return 'secondary' as const;
    if (status === 'expired') return 'destructive' as const;
    return 'outline' as const;
  };

  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">{t('quotes.title')}</h1>
          <p className="page-heading-sub">{t('quotes.subtitle')}</p>
        </div>
        <Button asChild size="sm" className="h-10 w-full shrink-0 text-xs sm:h-8 sm:w-auto">
          <Link to="/quotes/new">
            <Plus className="mr-2 h-3.5 w-3.5" />
            {t('quotes.new_quote')}
          </Link>
        </Button>
      </div>

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="px-3 py-2 sm:px-3">
          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
            <span className="mb-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('products.filters')}
            </span>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative h-8 min-w-0 flex-1 sm:min-w-[14rem]">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('quotes.search_placeholder')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 py-1 pl-8 text-xs sm:text-sm"
                  aria-label={t('quotes.search_placeholder')}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 sm:flex-[2]">
                <div className="min-w-[10rem] flex-1 sm:max-w-[16rem]">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger
                      className="h-8 w-full bg-background text-xs [&_span]:truncate"
                      aria-label={t('quotes.filter_status')}
                    >
                      <SelectValue placeholder={t('quotes.filter_status')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('quotes.status_all')}</SelectItem>
                      {(Object.keys(statusLabels) as QuoteStatus[]).map((v) => (
                        <SelectItem key={v} value={v}>
                          {statusLabels[v]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 text-xs"
                  onClick={() => void load()}
                  disabled={loading}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                  {t('quotes.refresh')}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b px-3 py-2 space-y-0 sm:px-4">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold sm:text-base">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{t('quotes.list_title')}</span>
            {!loading && (
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                ({filtered.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-3 pt-0">
          {loading ? (
            <div className="overflow-x-auto hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-semibold sm:text-sm">{t('quotes.col_number')}</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">{t('quotes.col_customer')}</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">{t('quotes.col_phone')}</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">{t('quotes.col_price_type')}</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">{t('quotes.col_status')}</TableHead>
                    <TableHead className="text-right text-xs font-semibold sm:text-sm">{t('quotes.col_total')}</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">{t('quotes.col_date')}</TableHead>
                    <TableHead className="w-[1%] text-xs font-semibold sm:text-sm">{t('quotes.col_actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <TableRowSkeleton key={i} />
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          {loading ? (
            <div className="space-y-2 p-3 md:hidden">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                  <Skeleton className="h-4 w-2/3 max-w-[200px]" />
                  <Skeleton className="h-3 w-1/2 max-w-[140px]" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="mx-4 my-8 rounded-lg border bg-muted/20 py-12 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <p className="font-medium text-foreground">{t('quotes.empty_title')}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('quotes.empty_hint')}</p>
              <Button asChild size="sm" className="mt-4 h-10 w-full max-w-xs text-xs sm:h-8">
                <Link to="/quotes/new">{t('quotes.new_quote')}</Link>
              </Button>
            </div>
          ) : (
            <>
            {/* Mobil: kartalar */}
            <div className="space-y-2 p-3 md:hidden">
              {filtered.map((q) => (
                <Link
                  key={q.id}
                  to={`/quotes/${q.id}`}
                  className="block rounded-lg border border-border bg-card p-3 shadow-sm transition-colors hover:bg-muted/40 active:bg-muted/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-semibold text-primary">{q.quote_number}</p>
                      <p className="mt-0.5 truncate text-sm font-medium">{q.customer_name || '—'}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{q.phone || '—'}</p>
                    </div>
                    <Badge variant={badgeVariant(q.status)} className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
                      {statusLabels[q.status]}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs">
                    <span className="text-muted-foreground">
                      {q.price_type === 'usta' ? t('quotes.price_usta') : t('quotes.price_retail')}
                    </span>
                    <span className="font-semibold tabular-nums text-foreground">{formatMoneyUZS(q.total)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {q.created_at ? formatDate(q.created_at) : '—'}
                  </p>
                </Link>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="whitespace-nowrap py-2 text-xs font-semibold sm:text-sm">
                      {t('quotes.col_number')}
                    </TableHead>
                    <TableHead className="min-w-[8rem] py-2 text-xs font-semibold sm:text-sm">
                      {t('quotes.col_customer')}
                    </TableHead>
                    <TableHead className="py-2 text-xs font-semibold sm:text-sm">{t('quotes.col_phone')}</TableHead>
                    <TableHead className="py-2 text-xs font-semibold sm:text-sm">{t('quotes.col_price_type')}</TableHead>
                    <TableHead className="py-2 text-xs font-semibold sm:text-sm">{t('quotes.col_status')}</TableHead>
                    <TableHead className="whitespace-nowrap py-2 text-right text-xs font-semibold sm:text-sm">
                      {t('quotes.col_total')}
                    </TableHead>
                    <TableHead className="whitespace-nowrap py-2 text-xs font-semibold sm:text-sm">
                      {t('quotes.col_date')}
                    </TableHead>
                    <TableHead className="w-[1%] py-2 text-right text-xs font-semibold sm:text-sm">
                      {t('quotes.col_actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((q) => (
                    <TableRow key={q.id} className="text-xs hover:bg-muted/40 sm:text-sm">
                      <TableCell className="max-w-[11rem] truncate py-2 font-medium">
                        <Link
                          to={`/quotes/${q.id}`}
                          className="font-mono text-xs text-primary hover:underline focus:outline-none focus:underline"
                        >
                          {q.quote_number}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate py-2">{q.customer_name || '—'}</TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{q.phone || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-xs">
                        {q.price_type === 'usta' ? t('quotes.price_usta') : t('quotes.price_retail')}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant={badgeVariant(q.status)} className="px-1.5 py-0 text-[10px] font-normal sm:text-xs">
                          {statusLabels[q.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 text-right text-xs tabular-nums font-medium">
                        {formatMoneyUZS(q.total)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                        {q.created_at ? formatDate(q.created_at) : '—'}
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" asChild>
                          <Link to={`/quotes/${q.id}`}>
                            <Eye className="h-3.5 w-3.5" />
                            {t('quotes.open_detail')}
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
