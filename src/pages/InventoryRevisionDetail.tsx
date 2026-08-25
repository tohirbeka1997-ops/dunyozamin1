import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Clock3,
  AlertTriangle,
  Ban,
  ScanBarcode,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import PageBreadcrumb from '@/components/common/PageBreadcrumb';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import {
  bulkSetInventoryRevisionItemCounts,
  cancelInventoryRevision,
  clearInventoryRevisionItemCount,
  completeInventoryRevision,
  countInventoryRevisionByBarcode,
  getInventoryRevision,
  updateInventoryRevisionItemCount,
} from '@/db/api';
import { formatNumberUZ } from '@/lib/format';
import { formatUnit } from '@/utils/formatters';

type RevisionItem = {
  id: string;
  product_id: string;
  product_name?: string;
  product_sku?: string;
  product_barcode?: string | null;
  unit?: string | null;
  product_unit?: string | null;
  system_qty: number;
  live_qty?: number | null;
  current_qty?: number | null;
  stock_drift?: boolean;
  counted_qty: number | null;
  variance: number | null;
  is_counted?: boolean;
  count_status?: 'pending' | 'counted' | 'variance';
};

type RevisionDetail = {
  id: string;
  revision_number: string;
  status: string;
  notes?: string | null;
  items: RevisionItem[];
  summary?: {
    total_items: number;
    counted_items: number;
    pending_items: number;
    variance_items: number;
    stock_drift_items?: number;
    progress_percent?: number;
  };
  adjusted_items?: number;
  counted_items?: number;
  stock_drift_items?: number;
  stock_changed_since_snapshot?: boolean;
};

type CountFilter = 'all' | 'counted' | 'pending' | 'variance';

function CountStatusBadge({
  item,
  t,
}: {
  item: RevisionItem;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const status = item.count_status || (item.is_counted ? 'counted' : 'pending');
  if (status === 'variance') {
    return (
      <Badge className="gap-1 bg-amber-600 hover:bg-amber-600">
        <AlertTriangle className="h-3 w-3" />
        {t('inventory_revision.badge_variance')}
      </Badge>
    );
  }
  if (status === 'counted') {
    return (
      <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
        <CheckCircle2 className="h-3 w-3" />
        {t('inventory_revision.badge_counted')}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Clock3 className="h-3 w-3" />
      {t('inventory_revision.badge_pending')}
    </Badge>
  );
}

export default function InventoryRevisionDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useAuth();

  const [revision, setRevision] = useState<RevisionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [countFilter, setCountFilter] = useState<CountFilter>('all');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [markZeroOpen, setMarkZeroOpen] = useState(false);
  const [acting, setActing] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const editable = revision?.status === 'in_progress' || revision?.status === 'draft';

  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search.trim()), 200);
    return () => clearTimeout(timer);
  }, [search]);

  const applyRevision = useCallback((rev: RevisionDetail) => {
    setRevision(rev);
    const drafts: Record<string, string> = {};
    for (const item of rev.items || []) {
      if (item.counted_qty != null) {
        drafts[item.id] = String(item.counted_qty);
      }
    }
    setQtyDrafts(drafts);
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const rev = await getInventoryRevision(id, {
        filter: countFilter,
        search: searchDebounced || undefined,
      });
      applyRevision(rev);
    } catch (err: any) {
      toast({
        title: t('common.error', { defaultValue: 'Xato' }),
        description: err?.message || String(err),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [id, countFilter, searchDebounced, applyRevision, toast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = revision?.summary;

  const progressPercent = useMemo(() => {
    if (summary?.progress_percent != null) return Number(summary.progress_percent) || 0;
    const total = Number(summary?.total_items || 0);
    const counted = Number(summary?.counted_items || 0);
    return total > 0 ? Math.round((counted / total) * 100) : 0;
  }, [summary]);

  const stockDriftCount = useMemo(() => {
    if (summary?.stock_drift_items != null) return Number(summary.stock_drift_items) || 0;
    return (revision?.items || []).filter((i) => i.stock_drift).length;
  }, [summary, revision]);

  const variancePreview = useMemo(() => {
    const items = revision?.items || [];
    return items.filter(
      (i) =>
        i.counted_qty != null &&
        Math.abs(Number(i.variance ?? Number(i.counted_qty) - Number(i.system_qty))) > 0.0001
    );
  }, [revision]);

  const pendingVisible = useMemo(
    () => (revision?.items || []).filter((i) => i.counted_qty == null),
    [revision]
  );

  const openCompleteDialog = async () => {
    if (!revision) return;
    try {
      setActing(true);
      const refreshed = await getInventoryRevision(revision.id, {
        filter: countFilter,
        search: searchDebounced || undefined,
      });
      applyRevision(refreshed);
      setCompleteOpen(true);
    } catch (err: any) {
      toast({
        title: t('common.error', { defaultValue: 'Xato' }),
        description: err?.message || String(err),
        variant: 'destructive',
      });
    } finally {
      setActing(false);
    }
  };

  const saveCount = async (item: RevisionItem, raw: string) => {
    if (!revision || !editable) return;
    const qty = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(qty) || qty < 0) {
      toast({
        title: t('inventory_revision.invalid_qty'),
        variant: 'destructive',
      });
      return;
    }
    try {
      setBusyItemId(item.id);
      const rev = await updateInventoryRevisionItemCount({
        revision_id: revision.id,
        item_id: item.id,
        counted_qty: qty,
      });
      const refreshed = await getInventoryRevision(revision.id, {
        filter: countFilter,
        search: searchDebounced || undefined,
      });
      applyRevision(refreshed || rev);
    } catch (err: any) {
      toast({
        title: t('common.error', { defaultValue: 'Xato' }),
        description: err?.message || String(err),
        variant: 'destructive',
      });
    } finally {
      setBusyItemId(null);
    }
  };

  const clearCount = async (item: RevisionItem) => {
    if (!revision || !editable) return;
    try {
      setBusyItemId(item.id);
      await clearInventoryRevisionItemCount({
        revision_id: revision.id,
        item_id: item.id,
      });
      const refreshed = await getInventoryRevision(revision.id, {
        filter: countFilter,
        search: searchDebounced || undefined,
      });
      applyRevision(refreshed);
      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } catch (err: any) {
      toast({
        title: t('common.error', { defaultValue: 'Xato' }),
        description: err?.message || String(err),
        variant: 'destructive',
      });
    } finally {
      setBusyItemId(null);
    }
  };

  const handleMarkZero = async () => {
    if (!revision || !editable || !pendingVisible.length) return;
    try {
      setActing(true);
      const rev = await bulkSetInventoryRevisionItemCounts({
        revision_id: revision.id,
        counted_qty: 0,
        item_ids: pendingVisible.map((i) => i.id),
        only_pending: true,
        filter: countFilter,
        search: searchDebounced || undefined,
      });
      applyRevision(rev);
      setMarkZeroOpen(false);
      toast({
        title: t('inventory_revision.mark_zero_done', { count: pendingVisible.length }),
      });
    } catch (err: any) {
      toast({
        title: t('common.error', { defaultValue: 'Xato' }),
        description: err?.message || String(err),
        variant: 'destructive',
      });
    } finally {
      setActing(false);
    }
  };

  const handleBarcode = async (code: string) => {
    if (!revision || !editable) return;
    const barcode = String(code || '').trim();
    if (!barcode) return;
    try {
      setActing(true);
      await countInventoryRevisionByBarcode({
        revision_id: revision.id,
        barcode,
      });
      const refreshed = await getInventoryRevision(revision.id, {
        filter: countFilter,
        search: searchDebounced || undefined,
      });
      applyRevision(refreshed);
      toast({
        title: t('inventory_revision.scan_ok'),
        description: barcode,
      });
      setBarcodeInput('');
      barcodeRef.current?.focus();
    } catch (err: any) {
      toast({
        title: t('inventory_revision.scan_fail'),
        description: err?.message || String(err),
        variant: 'destructive',
      });
    } finally {
      setActing(false);
    }
  };

  useBarcodeScanner({
    enabled: editable,
    onScan: (code) => {
      void handleBarcode(code);
    },
    whenInputFocused: 'auto',
  });

  const handleComplete = async () => {
    if (!revision) return;
    try {
      setActing(true);
      const result = await completeInventoryRevision({
        revision_id: revision.id,
        created_by: profile?.id || null,
      });
      applyRevision(result);
      setCompleteOpen(false);
      toast({
        title: t('inventory_revision.completed_title'),
        description: t('inventory_revision.completed_desc', {
          counted: result?.counted_items ?? summary?.counted_items ?? 0,
          adjusted: result?.adjusted_items ?? 0,
        }),
      });
    } catch (err: any) {
      toast({
        title: t('common.error', { defaultValue: 'Xato' }),
        description: err?.message || String(err),
        variant: 'destructive',
      });
    } finally {
      setActing(false);
    }
  };

  const handleCancel = async () => {
    if (!revision) return;
    try {
      setActing(true);
      const result = await cancelInventoryRevision({ revision_id: revision.id });
      applyRevision(result);
      setCancelOpen(false);
      toast({ title: t('inventory_revision.cancelled_title') });
    } catch (err: any) {
      toast({
        title: t('common.error', { defaultValue: 'Xato' }),
        description: err?.message || String(err),
        variant: 'destructive',
      });
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageBreadcrumb
        items={[
          { label: t('navigation.inventory'), href: '/inventory' },
          { label: t('navigation.inventory_revision'), href: '/inventory/revisions' },
          {
            label: revision?.revision_number || '...',
            href: `/inventory/revisions/${id || ''}`,
          },
        ]}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="page-heading">
            {t('inventory_revision.detail_title', {
              number: revision?.revision_number || '',
            })}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {revision && (
              <Badge variant="secondary">
                {t(`inventory_revision.status_${revision.status}`, {
                  defaultValue: revision.status,
                })}
              </Badge>
            )}
            {summary && (
              <span>
                {t('inventory_revision.summary_line', {
                  counted: summary.counted_items,
                  total: summary.total_items,
                  percent: progressPercent,
                  variance: summary.variance_items,
                  pending: summary.pending_items,
                })}
              </span>
            )}
            {editable && stockDriftCount > 0 && (
              <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                {t('inventory_revision.badge_stock_drift')} ({stockDriftCount})
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/inventory/revisions')}>
            {t('common.back', { defaultValue: 'Orqaga' })}
          </Button>
          {editable && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCancelOpen(true)}
                disabled={acting}
              >
                <Ban className="mr-1.5 h-4 w-4" />
                {t('inventory_revision.cancel')}
              </Button>
              <Button size="sm" onClick={() => void openCompleteDialog()} disabled={acting}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                {t('inventory_revision.complete')}
              </Button>
            </>
          )}
        </div>
      </div>

      {editable && (
        <Card className="gap-0 py-0 shadow-sm">
          <CardContent className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <ScanBarcode className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={barcodeRef}
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleBarcode(barcodeInput);
                  }
                }}
                placeholder={t('inventory_revision.barcode_placeholder')}
                className="h-9 pl-8"
                disabled={acting}
              />
            </div>
            <p className="text-xs text-muted-foreground sm:max-w-xs">
              {t('inventory_revision.barcode_hint')}
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="px-3 py-3">
          <CardTitle className="text-base">{t('inventory_revision.items_title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-3 pb-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('inventory_revision.search_placeholder')}
              className="h-8 max-w-md text-xs sm:text-sm"
            />
            <Select
              value={countFilter}
              onValueChange={(v) => setCountFilter(v as CountFilter)}
            >
              <SelectTrigger className="h-8 w-[14rem] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('inventory_revision.filter_all')}</SelectItem>
                <SelectItem value="counted">{t('inventory_revision.filter_counted')}</SelectItem>
                <SelectItem value="pending">{t('inventory_revision.filter_pending')}</SelectItem>
                <SelectItem value="variance">{t('inventory_revision.filter_variance')}</SelectItem>
              </SelectContent>
            </Select>
            {editable && countFilter === 'pending' && pendingVisible.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={acting}
                onClick={() => setMarkZeroOpen(true)}
              >
                {t('inventory_revision.mark_zero')} ({pendingVisible.length})
              </Button>
            )}
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('common.loading', { defaultValue: 'Yuklanmoqda...' })}
            </p>
          ) : !revision?.items?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('inventory_revision.no_items')}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('inventory_revision.product')}</TableHead>
                    <TableHead>{t('inventory_revision.status')}</TableHead>
                    <TableHead className="text-right">{t('inventory_revision.system_qty')}</TableHead>
                    <TableHead className="text-right">{t('inventory_revision.live_qty')}</TableHead>
                    <TableHead className="text-right">{t('inventory_revision.counted_qty')}</TableHead>
                    <TableHead className="text-right">{t('inventory_revision.variance')}</TableHead>
                    {editable && <TableHead className="w-[7rem]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revision.items.map((item) => {
                    const unit = formatUnit(item.unit || item.product_unit || '');
                    const draft = qtyDrafts[item.id] ?? '';
                    const live =
                      item.live_qty != null
                        ? Number(item.live_qty)
                        : item.current_qty != null
                          ? Number(item.current_qty)
                          : null;
                    const variance =
                      item.counted_qty != null
                        ? Number(item.variance ?? Number(item.counted_qty) - Number(item.system_qty))
                        : null;
                    return (
                      <TableRow
                        key={item.id}
                        className={
                          item.stock_drift
                            ? 'bg-amber-50/70 dark:bg-amber-950/25'
                            : item.count_status === 'variance'
                              ? 'bg-amber-50/60 dark:bg-amber-950/20'
                              : item.is_counted
                                ? 'bg-emerald-50/40 dark:bg-emerald-950/10'
                                : undefined
                        }
                      >
                        <TableCell>
                          <div className="min-w-0">
                            <div className="font-medium leading-snug">{item.product_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.product_sku}
                              {item.product_barcode ? ` · ${item.product_barcode}` : ''}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <CountStatusBadge item={item} t={t} />
                            {item.stock_drift && (
                              <Badge
                                variant="outline"
                                className="w-fit gap-1 border-amber-500 text-[10px] text-amber-700 dark:text-amber-400"
                              >
                                {t('inventory_revision.badge_stock_drift')}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumberUZ(item.system_qty)}
                          {unit ? ` ${unit}` : ''}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            item.stock_drift
                              ? 'font-medium text-amber-700 dark:text-amber-400'
                              : ''
                          }`}
                        >
                          {live == null
                            ? '—'
                            : `${formatNumberUZ(live)}${unit ? ` ${unit}` : ''}`}
                        </TableCell>
                        <TableCell className="text-right">
                          {editable ? (
                            <Input
                              value={draft}
                              onChange={(e) =>
                                setQtyDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              onBlur={() => {
                                if (draft === '' || draft == null) return;
                                if (
                                  item.counted_qty != null &&
                                  String(item.counted_qty) === String(draft)
                                ) {
                                  return;
                                }
                                void saveCount(item, draft);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                              className="ml-auto h-8 w-24 text-right text-xs tabular-nums"
                              inputMode="decimal"
                              disabled={busyItemId === item.id}
                            />
                          ) : (
                            <span className="tabular-nums">
                              {item.counted_qty == null
                                ? '—'
                                : formatNumberUZ(item.counted_qty)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            variance != null && Math.abs(variance) > 0.0001
                              ? variance > 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-destructive'
                              : ''
                          }`}
                        >
                          {variance == null
                            ? '—'
                            : `${variance > 0 ? '+' : ''}${formatNumberUZ(variance)}`}
                        </TableCell>
                        {editable && (
                          <TableCell className="text-right">
                            {item.is_counted && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                disabled={busyItemId === item.id}
                                onClick={() => void clearCount(item)}
                                title={t('inventory_revision.clear_count')}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('inventory_revision.complete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>{t('inventory_revision.complete_confirm_body')}</p>
              <p className="text-sm font-medium text-foreground">
                {t('inventory_revision.complete_confirm_stats', {
                  counted: summary?.counted_items ?? 0,
                  pending: summary?.pending_items ?? 0,
                  variance: summary?.variance_items ?? variancePreview.length,
                })}
              </p>
              {stockDriftCount > 0 && (
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  {t('inventory_revision.complete_stock_drift_warn', {
                    count: stockDriftCount,
                  })}
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>
              {t('common.cancel', { defaultValue: 'Bekor' })}
            </AlertDialogCancel>
            <AlertDialogAction disabled={acting} onClick={(e) => {
              e.preventDefault();
              void handleComplete();
            }}>
              {t('inventory_revision.complete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={markZeroOpen} onOpenChange={setMarkZeroOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('inventory_revision.mark_zero_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('inventory_revision.mark_zero_confirm_body', {
                count: pendingVisible.length,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>
              {t('common.cancel', { defaultValue: 'Bekor' })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={acting}
              onClick={(e) => {
                e.preventDefault();
                void handleMarkZero();
              }}
            >
              {t('inventory_revision.mark_zero')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('inventory_revision.cancel_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('inventory_revision.cancel_confirm_body')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>
              {t('common.back', { defaultValue: 'Orqaga' })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={acting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void handleCancel();
              }}
            >
              {t('inventory_revision.cancel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
