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
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import {
  bulkSetInventoryRevisionItemCounts,
  cancelInventoryRevision,
  clearInventoryRevisionItemCount,
  completeInventoryRevision,
  countInventoryRevisionByBarcode,
  getInventoryRevision,
  getInventoryRevisionCompletePreview,
  updateInventoryRevisionItemCount,
} from '@/db/api';
import { formatNumberUZ } from '@/lib/format';
import { formatUnit } from '@/utils/formatters';
import { roleCanApproveInventoryRevision } from '@/lib/posHardening';
import {
  cleanRevisionScanCode,
  createScanEventId,
  isRevisionExactCodeQuery,
  type PendingRevisionScan,
} from '@/lib/inventoryRevisionScan';

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

/** Read-only fallback if preview RPC is not wired — does not change counts. */
function localCompletePreview(revision: RevisionDetail) {
  let surplus_qty = 0;
  let shortage_qty = 0;
  for (const item of revision.items || []) {
    if (item.counted_qty == null) continue;
    const variance = Number(
      item.variance ?? Number(item.counted_qty) - Number(item.system_qty)
    );
    if (!Number.isFinite(variance) || Math.abs(variance) <= 0.0001) continue;
    if (variance > 0) surplus_qty += variance;
    else shortage_qty += Math.abs(variance);
  }
  const stockDrift =
    Number(revision.summary?.stock_drift_items || revision.stock_drift_items || 0) > 0 ||
    (revision.items || []).some((i) => i.stock_drift);
  return {
    can_complete: true,
    surplus_qty,
    shortage_qty,
    surplus_value: 0,
    shortage_value: 0,
    requires_stock_drift_approval: stockDrift,
    movements_during_revision: [] as unknown[],
  };
}

export default function InventoryRevisionDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile, user } = useAuth();

  const sessionKey = `inventory-revision-detail:${id || 'unknown'}`;
  const { searchParams, updateParams, restored } = useSessionSearchParams({
    storageKey: sessionKey,
    trackedKeys: ['q', 'filter', 'focus'],
  });

  const [revision, setRevision] = useState<RevisionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [countFilter, setCountFilter] = useState<CountFilter>('all');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [markZeroOpen, setMarkZeroOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [acting, setActing] = useState(false);
  const [highlightItemId, setHighlightItemId] = useState<string | null>(null);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [pendingScans, setPendingScans] = useState<PendingRevisionScan[]>([]);
  const [completePreview, setCompletePreview] = useState<{
    can_complete?: boolean;
    surplus_qty?: number;
    shortage_qty?: number;
    surplus_value?: number;
    shortage_value?: number;
    requires_stock_drift_approval?: boolean;
    movements_during_revision?: unknown[];
  } | null>(null);
  const [approveStockDrift, setApproveStockDrift] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const barcodeRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const highlightTimerRef = useRef<number | null>(null);
  const loadSeqRef = useRef(0);
  const scanInFlightRef = useRef(false);
  const skipNextLoadRef = useRef(false);
  const hydratedFromUrlRef = useRef(false);

  const userRole = user?.role || profile?.role || null;
  const canApprove = roleCanApproveInventoryRevision(userRole);

  const editable = revision?.status === 'in_progress' || revision?.status === 'draft';

  // Restore filter/search from URL once
  useEffect(() => {
    if (!restored || hydratedFromUrlRef.current) return;
    hydratedFromUrlRef.current = true;
    const q = searchParams.get('q') || '';
    const filter = (searchParams.get('filter') || 'all') as CountFilter;
    if (q) {
      setSearch(q);
      setSearchDebounced(q.trim());
    }
    if (['all', 'counted', 'pending', 'variance'].includes(filter)) {
      setCountFilter(filter);
    }
  }, [restored, searchParams]);

  // Persist filter/search to URL + session
  useEffect(() => {
    if (!restored || !hydratedFromUrlRef.current) return;
    updateParams(
      {
        q: search.trim() || null,
        filter: countFilter === 'all' ? null : countFilter,
      },
      { replace: true }
    );
  }, [search, countFilter, restored, updateParams]);

  // Debounce: exact code → immediate; name → 250ms; short name (<2) clears
  useEffect(() => {
    const trimmed = search.trim();
    if (!trimmed) {
      setSearchDebounced('');
      return;
    }
    if (isRevisionExactCodeQuery(trimmed)) {
      setSearchDebounced(trimmed);
      return;
    }
    if (trimmed.length < 2) {
      setSearchDebounced('');
      return;
    }
    const timer = window.setTimeout(() => setSearchDebounced(trimmed), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const flashHighlight = useCallback((itemId: string) => {
    setHighlightItemId(itemId);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightItemId((cur) => (cur === itemId ? null : cur));
    }, 2000);
  }, []);

  const scrollToItem = useCallback((itemId: string) => {
    requestAnimationFrame(() => {
      const el = rowRefs.current.get(itemId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }, []);

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

  const load = useCallback(
    async (opts?: { soft?: boolean }) => {
      if (!id) return;
      const soft = opts?.soft === true;
      const seq = ++loadSeqRef.current;
      try {
        if (soft) setSearching(true);
        else setLoading(true);
        setSearchError(null);
        const rev = await getInventoryRevision(id, {
          filter: countFilter,
          search: searchDebounced || undefined,
        });
        if (seq !== loadSeqRef.current) return;
        applyRevision(rev);
      } catch (err: any) {
        if (seq !== loadSeqRef.current) return;
        const msg = err?.message || String(err);
        setSearchError(msg);
        toast({
          title: t('inventory_revision.search_failed', {
            defaultValue: 'Qidiruv bajarilmadi. Qayta urinib ko‘ring.',
          }),
          description: msg,
          variant: 'destructive',
        });
      } finally {
        if (seq === loadSeqRef.current) {
          setLoading(false);
          setSearching(false);
        }
      }
    },
    [id, countFilter, searchDebounced, applyRevision, toast, t]
  );

  useEffect(() => {
    if (!restored) return;
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    void load({ soft: Boolean(revision) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on filter/search only
  }, [load, restored]);

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

  const canComplete = useMemo(() => {
    if (!summary || !editable || !canApprove) return false;
    const counted = Number(summary.counted_items || 0);
    const pending = Number(summary.pending_items || 0);
    return counted > 0 && pending === 0;
  }, [summary, editable, canApprove]);

  const pendingVisible = useMemo(
    () => (revision?.items || []).filter((i) => i.counted_qty == null),
    [revision]
  );

  const openCompleteDialog = async () => {
    if (!revision || !canComplete) return;
    try {
      setActing(true);
      const refreshed = await getInventoryRevision(revision.id, {
        filter: countFilter,
        search: searchDebounced || undefined,
      });
      applyRevision(refreshed);
      let preview: ReturnType<typeof localCompletePreview> | null = null;
      try {
        preview = await getInventoryRevisionCompletePreview(revision.id);
      } catch {
        preview = localCompletePreview(refreshed || revision);
      }
      setCompletePreview(preview);
      setApproveStockDrift(false);
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

  const focusBarcode = useCallback(() => {
    barcodeRef.current?.focus();
    barcodeRef.current?.select();
  }, []);

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);

  const locateScannedItem = useCallback(
    async (itemId: string, productName: string | undefined, countedQty: number) => {
      skipNextLoadRef.current = true;
      setSearch('');
      setSearchDebounced('');
      setCountFilter('all');
      updateParams({ q: null, filter: null, focus: itemId }, { replace: true });
      try {
        if (id) {
          const full = await getInventoryRevision(id, {
            filter: 'all',
          });
          const hasItem = (full.items || []).some((it: RevisionItem) => it.id === itemId);
          if (hasItem) {
            applyRevision(full);
          } else {
            const focused = await getInventoryRevision(id, {
              filter: 'all',
              focus_item_id: itemId,
            });
            applyRevision(focused);
          }
        }
      } catch {
        /* keep current list */
      }
      flashHighlight(itemId);
      window.setTimeout(() => scrollToItem(itemId), 50);
      toast({
        title: t('inventory_revision.scan_accepted', {
          defaultValue: 'Qabul qilindi: {{name}}, sanalgan: {{qty}}',
          name: productName || itemId,
          qty: countedQty,
        }),
      });
    },
    [id, applyRevision, flashHighlight, scrollToItem, toast, t, updateParams]
  );

  const handleBarcode = async (code: string) => {
    if (!revision || !editable) return;
    if (scanInFlightRef.current) return;
    const barcode = cleanRevisionScanCode(code);
    if (!barcode) return;

    const scanEventId = createScanEventId();
    scanInFlightRef.current = true;
    try {
      setActing(true);
      const result = await countInventoryRevisionByBarcode({
        revision_id: revision.id,
        barcode,
        scan_event_id: scanEventId,
        user_id: profile?.id || null,
      });

      if (result?.idempotent_replay) {
        // Already applied — still show the row, do not double-toast as new count
      }

      const matched = result?.matched_item || result?.items?.[0];
      const itemId = result?.focus_item_id || matched?.id;
      const countedQty = Number(result?.counted_qty ?? matched?.counted_qty ?? 0);

      if (itemId) {
        await locateScannedItem(itemId, matched?.product_name, countedQty);
      } else {
        toast({
          title: t('inventory_revision.scan_ok'),
          description: barcode,
        });
      }
      setBarcodeInput('');
      focusBarcode();
    } catch (err: any) {
      const details = err?.details || err?.data?.details;
      if (err?.code === 'CONFLICT' || details?.code === 'REVISION_BARCODE_AMBIGUOUS') {
        toast({
          title: t('inventory_revision.scan_ambiguous', {
            defaultValue: 'Bir nechta mahsulot topildi — tanlang',
          }),
          description: barcode,
          variant: 'destructive',
        });
        const candidates = details?.candidates;
        if (Array.isArray(candidates) && candidates[0]?.product_name) {
          setSearch(String(candidates[0].sku || barcode));
          setSearchDebounced(String(candidates[0].sku || barcode));
        }
      } else {
        // Queue for retry on network-ish failures
        const msg = String(err?.message || '');
        if (/network|offline|failed to fetch|ECONN|timeout/i.test(msg)) {
          setPendingScans((prev) => [
            ...prev,
            { scan_event_id: scanEventId, barcode, created_at: Date.now() },
          ]);
          toast({
            title: t('inventory_revision.scan_queued', {
              defaultValue: 'Tarmoq uzildi — skan navbatga qo‘yildi',
            }),
            description: barcode,
          });
        } else {
          toast({
            title: t('inventory_revision.scan_not_found', {
              defaultValue: 'Mahsulot ushbu reviziyada topilmadi',
            }),
            description: err?.message || barcode,
            variant: 'destructive',
          });
        }
      }
      setBarcodeInput('');
      focusBarcode();
    } finally {
      scanInFlightRef.current = false;
      setActing(false);
    }
  };

  // Flush pending scans when back online / idle
  useEffect(() => {
    if (!editable || !revision || !pendingScans.length || acting) return;
    let cancelled = false;
    const flush = async () => {
      const next = pendingScans[0];
      if (!next) return;
      try {
        await countInventoryRevisionByBarcode({
          revision_id: revision.id,
          barcode: next.barcode,
          scan_event_id: next.scan_event_id,
          user_id: profile?.id || null,
        });
        if (cancelled) return;
        setPendingScans((prev) => prev.filter((p) => p.scan_event_id !== next.scan_event_id));
        await load({ soft: true });
      } catch {
        /* keep in queue */
      }
    };
    const tmr = window.setTimeout(() => void flush(), 800);
    return () => {
      cancelled = true;
      window.clearTimeout(tmr);
    };
  }, [pendingScans, editable, revision, acting, profile?.id, load]);

  useBarcodeScanner({
    enabled: editable,
    onScan: (code) => {
      void handleBarcode(code);
    },
    whenInputFocused: 'auto',
  });

  const goToNextByStatus = useCallback(
    (status: 'pending' | 'variance') => {
      const items = revision?.items || [];
      if (!items.length) return;
      const start = Math.max(0, activeRowIndex);
      for (let offset = 1; offset <= items.length; offset += 1) {
        const idx = (start + offset) % items.length;
        const item = items[idx];
        const st = item.count_status || (item.is_counted ? 'counted' : 'pending');
        const isPending = item.counted_qty == null || st === 'pending';
        const isVariance =
          item.counted_qty != null &&
          Math.abs(Number(item.variance ?? Number(item.counted_qty) - Number(item.system_qty))) >
            0.0001;
        if (status === 'pending' && isPending) {
          setActiveRowIndex(idx);
          flashHighlight(item.id);
          scrollToItem(item.id);
          return;
        }
        if (status === 'variance' && isVariance) {
          setActiveRowIndex(idx);
          flashHighlight(item.id);
          scrollToItem(item.id);
          return;
        }
      }
      toast({
        title:
          status === 'pending'
            ? t('inventory_revision.no_more_pending', {
                defaultValue: 'Sanamagan mahsulot qolmadi',
              })
            : t('inventory_revision.no_more_variance', {
                defaultValue: 'Farqli mahsulot qolmadi',
              }),
      });
    },
    [revision, activeRowIndex, flashHighlight, scrollToItem, toast, t]
  );

  // Hotkeys: F2/F3/F4/F6/F7/Esc/arrows — do not block Ctrl+K, Ctrl+R, F5
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = String(target?.tagName || '').toLowerCase();
      const inEditableField =
        tag === 'textarea' ||
        (tag === 'input' &&
          target !== barcodeRef.current &&
          target !== searchRef.current &&
          (target as HTMLInputElement)?.type !== 'checkbox');

      if (e.key === 'F2') {
        e.preventDefault();
        focusBarcode();
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        focusSearch();
        return;
      }
      if (e.key === 'F4') {
        e.preventDefault();
        setFilterOpen(true);
        return;
      }
      if (e.key === 'F6') {
        e.preventDefault();
        goToNextByStatus('pending');
        return;
      }
      if (e.key === 'F7') {
        e.preventDefault();
        goToNextByStatus('variance');
        return;
      }
      if (e.key === 'Escape') {
        if (completeOpen || cancelOpen || markZeroOpen) return;
        e.preventDefault();
        setSearch('');
        setSearchDebounced('');
        setFilterOpen(false);
        focusBarcode();
        return;
      }
      if (e.key === 'ArrowDown' && !inEditableField) {
        const items = revision?.items || [];
        if (!items.length) return;
        e.preventDefault();
        const next = Math.min(items.length - 1, activeRowIndex + 1);
        setActiveRowIndex(next);
        scrollToItem(items[next].id);
        return;
      }
      if (e.key === 'ArrowUp' && !inEditableField) {
        const items = revision?.items || [];
        if (!items.length) return;
        e.preventDefault();
        const next = Math.max(0, activeRowIndex - 1);
        setActiveRowIndex(next);
        scrollToItem(items[next].id);
        return;
      }
      if (e.key === 'Enter' && e.ctrlKey && !e.altKey && !e.metaKey) {
        const items = revision?.items || [];
        const item = items[activeRowIndex];
        if (!item || !editable) return;
        const draft = qtyDrafts[item.id];
        if (draft == null || draft === '') return;
        e.preventDefault();
        void saveCount(item, draft);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    focusBarcode,
    focusSearch,
    goToNextByStatus,
    completeOpen,
    cancelOpen,
    markZeroOpen,
    revision,
    activeRowIndex,
    scrollToItem,
    editable,
    qtyDrafts,
  ]);

  const handleComplete = async () => {
    if (!revision) return;
    try {
      setActing(true);
      const result = await completeInventoryRevision({
        revision_id: revision.id,
        created_by: profile?.id || null,
        user_role: userRole,
        approve_stock_drift: approveStockDrift || canApprove,
        manager_approved: canApprove,
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
    if (!cancelReason.trim()) {
      toast({
        title: t('inventory_revision.cancel_reason_required'),
        variant: 'destructive',
      });
      return;
    }
    try {
      setActing(true);
      const result = await cancelInventoryRevision({
        revision_id: revision.id,
        cancel_reason: cancelReason.trim(),
        cancelled_by: profile?.id || null,
      });
      applyRevision(result);
      setCancelOpen(false);
      setCancelReason('');
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
              <Button
                size="sm"
                onClick={() => void openCompleteDialog()}
                disabled={acting || !canComplete}
                title={
                  !canComplete
                    ? t('inventory_revision.complete_disabled_hint')
                    : undefined
                }
              >
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
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('inventory_revision.search_placeholder')}
              className="h-8 max-w-md text-xs sm:text-sm"
              aria-label={t('inventory_revision.search_placeholder')}
            />
            <Select
              value={countFilter}
              open={filterOpen}
              onOpenChange={setFilterOpen}
              onValueChange={(v) => setCountFilter(v as CountFilter)}
            >
              <SelectTrigger className="h-8 w-[14rem] text-xs" aria-label={t('inventory_revision.filter_all')}>
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
            {pendingScans.length > 0 && (
              <Badge variant="outline" className="h-8 gap-1 text-xs">
                {t('inventory_revision.pending_scans', {
                  defaultValue: 'Navbatdagi skan: {{count}}',
                  count: pendingScans.length,
                })}
              </Badge>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            {t('inventory_revision.hotkeys_hint', {
              defaultValue: 'F2 skaner · F3 qidiruv · F4 filtr · F6 sanamagan · F7 farqli · Esc tozalash',
            })}
          </p>

          {loading && !revision ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('common.loading', { defaultValue: 'Yuklanmoqda...' })}
            </p>
          ) : searchError && !revision?.items?.length ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-center text-sm text-destructive">
                {t('inventory_revision.search_failed', {
                  defaultValue: 'Qidiruv bajarilmadi. Qayta urinib ko‘ring.',
                })}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void load({ soft: true })}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                {t('common.retry', { defaultValue: 'Qayta urinish' })}
              </Button>
            </div>
          ) : !revision?.items?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {searchDebounced || countFilter !== 'all'
                ? t('inventory_revision.no_search_results', {
                    defaultValue: 'Qidiruv bo‘yicha mahsulot topilmadi',
                  })
                : t('inventory_revision.no_items')}
            </p>
          ) : (
            <div className="relative overflow-x-auto rounded-md border">
              {searching && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-background/40 pt-16">
                  <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs shadow-sm">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('common.loading', { defaultValue: 'Yuklanmoqda...' })}
                  </div>
                </div>
              )}
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
                  {revision.items.map((item, rowIdx) => {
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
                    const isHighlighted = highlightItemId === item.id;
                    const isActive = activeRowIndex === rowIdx;
                    return (
                      <TableRow
                        key={item.id}
                        ref={(el) => {
                          if (el) rowRefs.current.set(item.id, el);
                          else rowRefs.current.delete(item.id);
                        }}
                        data-item-id={item.id}
                        onClick={() => setActiveRowIndex(rowIdx)}
                        className={[
                          isHighlighted
                            ? 'animate-[revScanFlash_2s_ease] bg-emerald-100/90 dark:bg-emerald-900/40'
                            : item.stock_drift
                              ? 'bg-amber-50/70 dark:bg-amber-950/25'
                              : item.count_status === 'variance'
                                ? 'bg-amber-50/60 dark:bg-amber-950/20'
                                : item.is_counted
                                  ? 'bg-emerald-50/40 dark:bg-emerald-950/10'
                                  : undefined,
                          isActive && !isHighlighted ? 'ring-1 ring-inset ring-primary/40' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
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
            <AlertDialogDescription className="space-y-3">
              <p>{t('inventory_revision.complete_confirm_body')}</p>
              <p className="text-sm font-medium text-foreground">
                {t('inventory_revision.complete_confirm_stats', {
                  total: summary?.total_items ?? 0,
                  counted: summary?.counted_items ?? 0,
                  pending: summary?.pending_items ?? 0,
                  variance: summary?.variance_items ?? variancePreview.length,
                })}
              </p>
              {completePreview && (
                <div className="rounded-md border bg-muted/40 p-2 text-sm space-y-1">
                  <p>
                    {t('inventory_revision.complete_surplus', {
                      qty: formatNumberUZ(completePreview.surplus_qty || 0),
                      value: formatNumberUZ(completePreview.surplus_value || 0),
                    })}
                  </p>
                  <p>
                    {t('inventory_revision.complete_shortage', {
                      qty: formatNumberUZ(completePreview.shortage_qty || 0),
                      value: formatNumberUZ(completePreview.shortage_value || 0),
                    })}
                  </p>
                  {Array.isArray(completePreview.movements_during_revision) &&
                    completePreview.movements_during_revision.length > 0 && (
                      <div className="pt-1">
                        <p className="font-medium">
                          {t('inventory_revision.movements_during', {
                            count: completePreview.movements_during_revision.length,
                          })}
                        </p>
                        <ul className="mt-1 max-h-24 list-inside list-disc overflow-y-auto text-xs text-muted-foreground">
                          {completePreview.movements_during_revision.slice(0, 12).map((m: any) => (
                            <li key={m.id || `${m.product_id}-${m.created_at}`}>
                              {m.product_name || m.product_sku || m.product_id}: {m.movement_type}{' '}
                              {m.quantity}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                </div>
              )}
              {stockDriftCount > 0 && (
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  {t('inventory_revision.complete_stock_drift_warn', {
                    count: stockDriftCount,
                  })}
                </p>
              )}
              {completePreview?.requires_stock_drift_approval && canApprove && (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="approve-drift"
                    checked={approveStockDrift}
                    onCheckedChange={(v) => setApproveStockDrift(v === true)}
                  />
                  <Label htmlFor="approve-drift" className="text-sm leading-snug">
                    {t('inventory_revision.approve_stock_drift')}
                  </Label>
                </div>
              )}
              {!canApprove && (
                <p className="text-sm text-destructive">
                  {t('inventory_revision.manager_approval_required')}
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>
              {t('common.cancel', { defaultValue: 'Bekor' })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                acting ||
                !canComplete ||
                (canApprove &&
                  !!completePreview?.requires_stock_drift_approval &&
                  !approveStockDrift)
              }
              onClick={(e) => {
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
            <AlertDialogDescription className="space-y-3">
              <p>{t('inventory_revision.cancel_confirm_body')}</p>
              <div className="space-y-2">
                <Label htmlFor="cancel-reason">{t('inventory_revision.cancel_reason_label')}</Label>
                <Textarea
                  id="cancel-reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={2}
                  placeholder={t('inventory_revision.cancel_reason_placeholder')}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>
              {t('common.back', { defaultValue: 'Orqaga' })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={acting || !cancelReason.trim()}
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

      <style>{`
        @keyframes revScanFlash {
          0% { background-color: rgb(167 243 208 / 0.95); }
          70% { background-color: rgb(167 243 208 / 0.55); }
          100% { background-color: transparent; }
        }
      `}</style>
    </div>
  );
}
