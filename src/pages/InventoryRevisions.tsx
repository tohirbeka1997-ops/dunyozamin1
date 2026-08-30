import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import PageBreadcrumb from '@/components/common/PageBreadcrumb';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { getOpenInventoryRevision, listInventoryRevisions } from '@/db/api';
import { formatDate } from '@/lib/datetime';
import CreateInventoryRevisionDialog from '@/components/inventory/CreateInventoryRevisionDialog';

type RevisionRow = {
  id: string;
  revision_number: string;
  status: string;
  warehouse_name?: string | null;
  created_at: string;
  completed_at?: string | null;
  total_items?: number;
  counted_items?: number;
  pending_items?: number;
  variance_items?: number;
  notes?: string | null;
};

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed') return 'default';
  if (status === 'cancelled') return 'destructive';
  if (status === 'in_progress') return 'secondary';
  return 'outline';
}

export default function InventoryRevisions() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [rows, setRows] = useState<RevisionRow[]>([]);
  const [openRevision, setOpenRevision] = useState<RevisionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const [list, open] = await Promise.all([
        listInventoryRevisions({
          status: statusFilter === 'all' ? undefined : statusFilter,
          limit: 200,
        }),
        getOpenInventoryRevision(),
      ]);
      setRows(Array.isArray(list) ? list : []);
      setOpenRevision(open || null);
    } catch (err: any) {
      // Do not clear existing rows on error — distinguish error vs empty.
      setLoadError(
        t('inventory_revision.load_failed_body', {
          defaultValue: 'Server did not respond',
        })
      );
      toast({
        title: t('common.error', { defaultValue: 'Xato' }),
        description: err?.message || String(err),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreateClick = () => {
    if (openRevision) {
      toast({
        title: t('common.error', { defaultValue: 'Xato' }),
        description: t('inventory_revision.already_open_hint', {
          number: openRevision.revision_number,
        }),
        variant: 'destructive',
      });
      navigate(`/inventory/revisions/${openRevision.id}`);
      return;
    }
    setCreateOpen(true);
  };

  const handleRevisionCreated = (rev: { id: string; revision_number?: string; summary?: { total_items?: number }; items?: unknown[] }) => {
    toast({
      title: t('inventory_revision.created_title'),
      description: t('inventory_revision.created_desc', {
        number: rev?.revision_number,
        count: rev?.summary?.total_items ?? rev?.items?.length ?? 0,
      }),
    });
    navigate(`/inventory/revisions/${rev.id}`);
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageBreadcrumb
        items={[
          { label: t('navigation.inventory'), href: '/inventory' },
          { label: t('navigation.inventory_revision'), href: '/inventory/revisions' },
        ]}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">{t('inventory_revision.title')}</h1>
          <p className="page-heading-sub">{t('inventory_revision.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('quotes.refresh', { defaultValue: 'Yangilash' })}
          </Button>
          <Button size="sm" onClick={handleCreateClick} disabled={!!openRevision}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('inventory_revision.new_revision')}
          </Button>
        </div>
      </div>

      {openRevision && (
        <Card className="border-amber-200 bg-amber-50 py-0 shadow-sm dark:border-amber-800 dark:bg-amber-950">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <p className="text-sm text-amber-900 dark:text-amber-100">
              {t('inventory_revision.already_open_hint', {
                number: openRevision.revision_number,
              })}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => navigate(`/inventory/revisions/${openRevision.id}`)}
            >
              {t('inventory_revision.open_banner_action')}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="gap-0 py-0 shadow-sm">
        <CardContent className="space-y-3 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[12rem] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('inventory_revision.filter_all_statuses')}</SelectItem>
                <SelectItem value="partially_completed">{t('inventory_revision.status_partially_completed')}</SelectItem>
                <SelectItem value="in_progress">{t('inventory_revision.status_in_progress')}</SelectItem>
                <SelectItem value="completed">{t('inventory_revision.status_completed')}</SelectItem>
                <SelectItem value="cancelled">{t('inventory_revision.status_cancelled')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading && rows.length === 0 ? (
            <div className="space-y-2 py-4" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : loadError && rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm font-medium text-destructive">
                {t('inventory_revision.load_failed_title', {
                  defaultValue: "Ma'lumot yuklanmadi",
                })}
              </p>
              <p className="text-sm text-muted-foreground">{loadError}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                {t('common.retry', { defaultValue: 'Qayta urinish' })}
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <ClipboardList className="h-10 w-10 opacity-40" />
              <p className="text-sm">{t('inventory_revision.no_revisions')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              {loadError && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span>{loadError}</span>
                  <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => void load()}>
                    {t('common.retry', { defaultValue: 'Qayta urinish' })}
                  </Button>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('inventory_revision.number')}</TableHead>
                    <TableHead>{t('inventory_revision.status')}</TableHead>
                    <TableHead className="text-right">{t('inventory_revision.progress')}</TableHead>
                    <TableHead className="text-right">{t('inventory_revision.variances')}</TableHead>
                    <TableHead>{t('inventory_revision.created_at')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/inventory/revisions/${row.id}`)}
                    >
                      <TableCell className="font-medium">{row.revision_number}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(row.status)}>
                          {t(`inventory_revision.status_${row.status}`, {
                            defaultValue: row.status,
                          })}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(() => {
                          const counted = Number(row.counted_items || 0);
                          const total = Number(row.total_items || 0);
                          const pct = total > 0 ? Math.round((counted / total) * 100) : 0;
                          return `${counted} / ${total} (${pct}%)`;
                        })()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(row.variance_items || 0)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(row.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateInventoryRevisionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        createdBy={profile?.id || null}
        onCreated={handleRevisionCreated}
      />
    </div>
  );
}
