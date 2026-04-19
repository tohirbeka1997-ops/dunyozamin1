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
import { FileText, Plus, RefreshCw, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

function TableRowSkeleton() {
  return (
    <TableRow>
      {Array.from({ length: 8 }).map((_, i) => (
        <TableCell key={i}>
          <Skeleton className="h-4 w-full max-w-[120px]" />
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
    <div className="space-y-6 w-full min-w-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('quotes.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('quotes.subtitle')}</p>
        </div>
        <Button asChild className="shrink-0">
          <Link to="/quotes/new">
            <Plus className="h-4 w-4 mr-2" />
            {t('quotes.new_quote')}
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 shrink-0" />
              {t('quotes.list_title')}
            </span>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4 mr-1', loading && 'animate-spin')} />
              {t('quotes.refresh')}
            </Button>
          </CardTitle>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 pt-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={t('quotes.search_placeholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label={t('quotes.search_placeholder')}
              />
            </div>
            <div className="w-full sm:w-[220px]">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger aria-label={t('quotes.filter_status')}>
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
          </div>
        </CardHeader>
        <CardContent>
          {!loading && (
            <p className="text-xs text-muted-foreground mb-3">
              {t('quotes.count_shown', { count: filtered.length })}
            </p>
          )}
          {loading ? (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('quotes.col_number')}</TableHead>
                    <TableHead>{t('quotes.col_customer')}</TableHead>
                    <TableHead>{t('quotes.col_phone')}</TableHead>
                    <TableHead>{t('quotes.col_price_type')}</TableHead>
                    <TableHead>{t('quotes.col_status')}</TableHead>
                    <TableHead className="text-right">{t('quotes.col_total')}</TableHead>
                    <TableHead>{t('quotes.col_date')}</TableHead>
                    <TableHead className="w-[100px]">{t('quotes.col_actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <TableRowSkeleton key={i} />
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center border rounded-lg bg-muted/20">
              <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground/60" />
              <p className="font-medium text-foreground">{t('quotes.empty_title')}</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                {t('quotes.empty_hint')}
              </p>
              <Button asChild className="mt-6">
                <Link to="/quotes/new">{t('quotes.new_quote')}</Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('quotes.col_number')}</TableHead>
                    <TableHead>{t('quotes.col_customer')}</TableHead>
                    <TableHead>{t('quotes.col_phone')}</TableHead>
                    <TableHead>{t('quotes.col_price_type')}</TableHead>
                    <TableHead>{t('quotes.col_status')}</TableHead>
                    <TableHead className="text-right">{t('quotes.col_total')}</TableHead>
                    <TableHead>{t('quotes.col_date')}</TableHead>
                    <TableHead className="w-[100px]">{t('quotes.col_actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((q) => (
                    <TableRow key={q.id} className="hover:bg-muted/40">
                      <TableCell className="font-medium">
                        <Link
                          to={`/quotes/${q.id}`}
                          className="text-primary hover:underline focus:outline-none focus:underline"
                        >
                          {q.quote_number}
                        </Link>
                      </TableCell>
                      <TableCell>{q.customer_name || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{q.phone || '—'}</TableCell>
                      <TableCell>
                        {q.price_type === 'usta' ? t('quotes.price_usta') : t('quotes.price_retail')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badgeVariant(q.status)}>{statusLabels[q.status]}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoneyUZS(q.total)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                        {q.created_at ? formatDate(q.created_at) : '—'}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/quotes/${q.id}`}>{t('quotes.open_detail')}</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
