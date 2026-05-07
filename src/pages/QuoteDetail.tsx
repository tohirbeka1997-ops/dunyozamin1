import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate } from '@/lib/datetime';
import { formatUnit } from '@/utils/formatters';
import { getQuoteById, deleteQuote } from '@/db/api';
import type { Quote, QuoteStatus } from '@/types/database';
import { ArrowLeft, FileText, ShoppingCart, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
export default function QuoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const statusLabel = useCallback(
    (s: QuoteStatus | string) => {
      const map: Record<string, string> = {
        draft: t('quotes.status_draft'),
        confirmed: t('quotes.status_confirmed'),
        expired: t('quotes.status_expired'),
        converted: t('quotes.status_converted'),
      };
      return map[s] || s;
    },
    [t]
  );

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setQuote(null);
    try {
      const q = await getQuoteById(id);
      setQuote(q);
    } catch (e) {
      toast({
        title: t('common.error'),
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
      navigate('/quotes');
    } finally {
      setLoading(false);
    }
  }, [id, navigate, t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConvertToPosCart = () => {
    if (!quote) return;
    if (quote.status === 'converted') {
      toast({ title: t('quotes.toast_already_converted'), variant: 'destructive' });
      return;
    }
    try {
      setConverting(true);
      /** Electron `file:` + HashRouter da `location.state` ba’zan yo‘qoladi — POS import uchun zaxira */
      try {
        sessionStorage.setItem('pos_import_quote_id', quote.id);
      } catch {
        /* ignore */
      }
      navigate('/pos', { state: { importQuoteId: quote.id } });
    } finally {
      setConverting(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      setDeleting(true);
      await deleteQuote(id);
      toast({ title: t('quotes.toast_deleted') });
      navigate('/quotes');
    } catch (e) {
      toast({
        title: t('common.error'),
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1200px] space-y-4 px-3 py-4 sm:space-y-6 sm:p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-8 w-48 max-w-full" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
          <Skeleton className="h-36 rounded-lg sm:h-40" />
          <Skeleton className="h-36 rounded-lg sm:h-40" />
        </div>
        <Skeleton className="h-56 rounded-lg sm:h-64" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center space-y-4">
        <FileText className="h-14 w-14 mx-auto text-muted-foreground/50" />
        <h1 className="page-heading">{t('quotes.not_found')}</h1>
        <p className="text-sm text-muted-foreground">{t('quotes.not_found_hint')}</p>
        <Button asChild>
          <Link to="/quotes">{t('quotes.back_to_list')}</Link>
        </Button>
      </div>
    );
  }

  const items = quote.items || [];

  const subtotalOddiy = items.reduce((s, it) => {
    const retail = (it as { retail_price?: number }).retail_price ?? it.unit_price;
    const qty = Number(it.quantity) || 0;
    const disc = Number(it.discount_amount) || 0;
    const pct = Number(it.discount_percent) || 0;
    const before = retail * qty;
    const discAmt = pct > 0 ? (before * pct) / 100 : disc;
    return s + Math.max(0, before - discAmt);
  }, 0);
  const subtotalUsta = items.reduce((s, it) => {
    const usta = (it as { usta_price?: number }).usta_price ?? it.unit_price;
    const qty = Number(it.quantity) || 0;
    const disc = Number(it.discount_amount) || 0;
    const pct = Number(it.discount_percent) || 0;
    const before = usta * qty;
    const discAmt = pct > 0 ? (before * pct) / 100 : disc;
    return s + Math.max(0, before - discAmt);
  }, 0);
  const totalTafovut = subtotalOddiy - subtotalUsta;

  const badgeVariant =
    quote.status === 'converted'
      ? ('default' as const)
      : quote.status === 'expired'
        ? ('destructive' as const)
        : ('secondary' as const);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1200px] space-y-4 px-3 py-4 sm:space-y-6 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 touch-manipulation"
            onClick={() => navigate(-1)}
            aria-label={t('common.back')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs text-muted-foreground">{t('quotes.quote_number')}</p>
            <h1 className="page-heading break-words">{quote.quote_number}</h1>
            <p className="page-heading-sub mt-0.5">{t('quotes.subtitle')}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={badgeVariant}>{statusLabel(quote.status)}</Badge>
              {quote.price_type === 'usta' ? (
                <span className="text-xs text-muted-foreground">{t('quotes.price_usta')}</span>
              ) : (
                <span className="text-xs text-muted-foreground">{t('quotes.price_retail')}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          {quote.status !== 'converted' && (
            <>
              <Button
                variant="outline"
                className="h-10 w-full touch-manipulation sm:h-9 sm:w-auto"
                onClick={() => navigate(`/quotes/${id}/edit`)}
              >
                {t('quotes.edit')}
              </Button>
              <Button
                className="h-10 w-full touch-manipulation sm:h-9 sm:w-auto"
                onClick={handleConvertToPosCart}
                disabled={converting}
              >
                <ShoppingCart className="mr-2 h-4 w-4" />
                {converting ? t('common.loading') : t('quotes.convert_to_pos_cart')}
              </Button>
            </>
          )}
          {quote.status === 'converted' && quote.converted_order_id && (
            <Button
              variant="outline"
              className="h-10 w-full sm:h-9 sm:w-auto"
              onClick={() => navigate(`/orders/${quote.converted_order_id}`)}
            >
              {t('quotes.view_order')}
            </Button>
          )}
          {quote.status !== 'converted' && (
            <Button
              variant="destructive"
              className="h-10 w-full touch-manipulation sm:h-9 sm:w-auto"
              onClick={() => setDeleteOpen(true)}
              disabled={deleting}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('quotes.delete')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <Card className="shadow-sm">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-base">{t('quotes.customer_section')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium text-base">{quote.customer_name || '—'}</p>
            <p className="text-muted-foreground">{quote.phone || '—'}</p>
            <dl className="pt-3 border-t space-y-1 text-muted-foreground">
              <div className="flex justify-between gap-2">
                <dt>{t('quotes.created_at')}</dt>
                <dd className="tabular-nums">{quote.created_at ? formatDate(quote.created_at) : '—'}</dd>
              </div>
              {quote.valid_until ? (
                <div className="flex justify-between gap-2">
                  <dt>{t('quotes.valid_until')}</dt>
                  <dd className="tabular-nums">{formatDate(quote.valid_until)}</dd>
                </div>
              ) : null}
            </dl>
            {quote.notes ? (
              <p className="text-sm text-foreground pt-3 border-t whitespace-pre-wrap">{quote.notes}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-base">{t('quotes.totals')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{t('quotes.subtotal')}</span>
              <span className="tabular-nums">{formatMoneyUZS(quote.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>{t('quotes.discount')}</span>
              <span className="tabular-nums">-{formatMoneyUZS(quote.discount_amount)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg border-t pt-2">
              <span>{t('quotes.total')}</span>
              <span className="tabular-nums">{formatMoneyUZS(quote.total)}</span>
            </div>
            {Math.abs(totalTafovut) > 0.01 && (
              <div className="pt-2 mt-2 border-t space-y-1 text-muted-foreground text-xs">
                <div className="flex justify-between gap-2">
                  <span>{t('quotes.compare_retail')}</span>
                  <span className="tabular-nums shrink-0">{formatMoneyUZS(subtotalOddiy)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>{t('quotes.compare_usta')}</span>
                  <span className="tabular-nums shrink-0">{formatMoneyUZS(subtotalUsta)}</span>
                </div>
                <div
                  className={cn(
                    'flex justify-between font-medium gap-2',
                    'text-green-600 dark:text-green-500'
                  )}
                >
                  <span>{t('quotes.compare_diff')}</span>
                  <span className="tabular-nums shrink-0 text-right">
                    {formatMoneyUZS(totalTafovut)}{' '}
                    {totalTafovut > 0 ? t('quotes.compare_usta_cheaper') : ''}
                  </span>
                </div>
              </div>
            )}
            {quote.total_profit != null && (
              <div className="flex justify-between text-muted-foreground text-sm pt-2 border-t">
                <span>{t('quotes.profit_label')}</span>
                <span className="tabular-nums font-medium">{formatMoneyUZS(quote.total_profit)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-base">{t('quotes.items_title')}</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-3 pt-0 sm:px-6 sm:pb-6">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-0">
              {t('quotes.items_empty_title')}
            </p>
          ) : (
            <>
              <div className="space-y-2 p-3 md:hidden">
                {items.map((it, idx) => {
                  const name =
                    (it as { name_snapshot?: string; product_name?: string }).name_snapshot ||
                    (it as { product_name?: string }).product_name ||
                    '—';
                  return (
                    <div
                      key={it.id || idx}
                      className="rounded-lg border border-border bg-card p-3 text-sm shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-muted-foreground tabular-nums">{idx + 1}.</span>
                        <span className="min-w-0 flex-1 font-medium leading-snug">{name}</span>
                        <span className="shrink-0 font-semibold tabular-nums">
                          {formatMoneyUZS(it.line_total)}
                        </span>
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <div className="flex justify-between gap-2">
                          <dt>{t('quotes.col_qty')}</dt>
                          <dd className="tabular-nums text-foreground">
                            {it.quantity} {formatUnit(it.unit)}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>{t('quotes.col_price')}</dt>
                          <dd className="tabular-nums text-foreground">{formatMoneyUZS(it.unit_price)}</dd>
                        </div>
                        <div className="col-span-2 flex justify-between gap-2 border-t border-border/60 pt-1">
                          <dt>{t('quotes.col_discount')}</dt>
                          <dd className="tabular-nums text-foreground">
                            {it.discount_amount
                              ? formatMoneyUZS(it.discount_amount)
                              : it.discount_percent
                                ? `${it.discount_percent}%`
                                : '—'}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-10 py-2 text-xs font-semibold">№</TableHead>
                      <TableHead className="py-2 text-xs font-semibold">{t('quotes.col_name')}</TableHead>
                      <TableHead className="py-2 text-xs font-semibold">{t('quotes.col_qty')}</TableHead>
                      <TableHead className="py-2 text-xs font-semibold">{t('quotes.col_price')}</TableHead>
                      <TableHead className="py-2 text-xs font-semibold">{t('quotes.col_discount')}</TableHead>
                      <TableHead className="py-2 text-right text-xs font-semibold">
                        {t('quotes.col_line_total')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((it, idx) => (
                      <TableRow key={it.id || idx} className="text-xs sm:text-sm">
                        <TableCell className="py-2 text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="max-w-[14rem] py-2 font-medium">
                          {(it as { name_snapshot?: string; product_name?: string }).name_snapshot ||
                            (it as { product_name?: string }).product_name ||
                            '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-2 tabular-nums">
                          {it.quantity} {formatUnit(it.unit)}
                        </TableCell>
                        <TableCell className="py-2 tabular-nums">{formatMoneyUZS(it.unit_price)}</TableCell>
                        <TableCell className="py-2 tabular-nums">
                          {it.discount_amount
                            ? formatMoneyUZS(it.discount_amount)
                            : it.discount_percent
                              ? `${it.discount_percent}%`
                              : '—'}
                        </TableCell>
                        <TableCell className="py-2 text-right text-xs font-medium tabular-nums sm:text-sm">
                          {formatMoneyUZS(it.line_total)}
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

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('quotes.delete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('quotes.delete_confirm_description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('quotes.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? t('common.loading') : t('quotes.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
