import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionSearchParams } from '@/hooks/useSessionSearchParams';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, FileText, User, Clock, Edit, Trash2, Plus, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { todayYMD, formatDateYMD, formatDateTime } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { ReportLoadPanel } from '@/components/reports/ReportLoadPanel';
import {
  createReportCorrelationId,
  reportLoadErrorMessage,
  resolveReportStatus,
  telemetryFromReportError,
  type ReportLoadStatus,
} from '@/lib/reportLoadState';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { auditEntityTypeLabel, AUDIT_ENTITY_FILTER_OPTIONS } from '@/lib/auditEntityLabels';

interface AuditLog {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_name?: string;
  old_value?: string;
  new_value?: string;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
  description?: string;
}

function defaultAuditDateFrom() {
  const d = new Date();
  d.setTime(d.getTime() - 7 * 24 * 60 * 60 * 1000);
  return formatDateYMD(d, { timeZone: 'Asia/Tashkent' });
}

export default function AuditLogReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { searchParams, updateParams } = useSessionSearchParams({
    storageKey: 'reports.audit-log.filters',
    trackedKeys: ['dateFrom', 'dateTo', 'search', 'action', 'entityType', 'userId'],
  });

  const [loadStatus, setLoadStatus] = useState<ReportLoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [logRows, setLogRows] = useState<AuditLog[]>([]);
  const dateFrom = searchParams.get('dateFrom') || defaultAuditDateFrom();
  const dateTo = searchParams.get('dateTo') || todayYMD();
  const searchTerm = searchParams.get('search') || '';
  const actionFilter = searchParams.get('action') || 'all';
  const entityTypeFilter = searchParams.get('entityType') || 'all';
  const userFilter = searchParams.get('userId') || 'all';

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, actionFilter, entityTypeFilter, userFilter]);

  async function loadData() {
    const cid = createReportCorrelationId('audit-log');
    setCorrelationId(cid);
    setLoadStatus('loading');
    setLoadError(null);
    try {
      if (!isElectron()) {
        throw new Error(t('reports.audit_log.desktop_only', 'Bu hisobot faqat desktop ilovada mavjud.'));
      }
      const api = requireElectron();

      const logs = await handleIpcResponse<AuditLog[]>(
        api.reports?.auditLog?.({
          date_from: dateFrom,
          date_to: dateTo,
          action: actionFilter !== 'all' ? actionFilter : undefined,
          entity_type: entityTypeFilter !== 'all' ? entityTypeFilter : undefined,
          user_id: userFilter !== 'all' ? userFilter : undefined,
        }) || Promise.resolve([]),
      );

      const rows = Array.isArray(logs) ? logs : [];
      setLogRows(rows);
      setLoadStatus(resolveReportStatus(rows, (r) => r.length === 0));
    } catch (error: any) {
      console.error('[AuditLogReport] loadData error:', error);
      const message = reportLoadErrorMessage(error);
      setLoadError(message);
      setLogRows([]);
      setLoadStatus('error');
      telemetryFromReportError('reports/system/audit-log', 'pos:reports:auditLog', error, cid, user?.role);
      toast({
        title: t('reports.load_state.error_title', 'Xatolik'),
        description: message,
        variant: 'destructive',
      });
    }
  }

  useReportAutoRefresh(loadData);

  const filteredLogs = useMemo(() => {
    if (!searchTerm) return logRows;
    const term = searchTerm.toLowerCase();
    return logRows.filter(
      (row) =>
        (row.user_name || '').toLowerCase().includes(term) ||
        row.action.toLowerCase().includes(term) ||
        row.entity_type.toLowerCase().includes(term) ||
        auditEntityTypeLabel(row.entity_type).toLowerCase().includes(term) ||
        (row.entity_name && row.entity_name.toLowerCase().includes(term)) ||
        (row.description && row.description.toLowerCase().includes(term))
    );
  }, [logRows, searchTerm]);

  const uniqueUsers = useMemo(() => {
    const users = new Map<string, string>();
    for (const log of logRows) {
      const id = log.user_id || `__empty__${(log.user_name || '').slice(0, 20)}`;
      if (!users.has(id)) {
        users.set(id, log.user_name || "Noma'lum");
      }
    }
    return Array.from(users.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [logRows]);

  const summary = useMemo(() => {
    const totalActions = logRows.length;
    const uniqueUserCount = new Set(logRows.map((l) => l.user_id)).size;
    const creates = logRows.filter((l) => l.action === 'create').length;
    const updates = logRows.filter((l) => l.action === 'update').length;
    const deletes = logRows.filter((l) => l.action === 'delete').length;
    return { totalActions, uniqueUserCount, creates, updates, deletes };
  }, [logRows]);

  const getActionIcon = (action: string) => {
    if (action === 'create') return <Plus className="h-4 w-4 text-green-500" />;
    if (action === 'update') return <Edit className="h-4 w-4 text-blue-500" />;
    if (action === 'delete') return <Trash2 className="h-4 w-4 text-red-500" />;
    return <Eye className="h-4 w-4 text-gray-500" />;
  };

  const getActionBadge = (action: string) => {
    if (action === 'create') return <Badge className="bg-green-600">Yaratildi</Badge>;
    if (action === 'update') return <Badge className="bg-blue-600">Yangilandi</Badge>;
    if (action === 'delete') return <Badge variant="destructive">O'chirildi</Badge>;
    return <Badge variant="secondary">Ko'rildi</Badge>;
  };

  if (loadStatus === 'loading' || loadStatus === 'error') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/system')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="page-heading">{t('reports.audit_log.title', 'Harakatlar jurnali (Audit)')}</h1>
        </div>
        <ReportLoadPanel
          status={loadStatus}
          error={loadError}
          correlationId={correlationId}
          onRetry={() => void loadData()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/system')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading flex items-center gap-2">
              <FileText className="h-8 w-8 text-purple-500" />
              Harakatlar jurnali (Audit)
            </h1>
            <p className="text-muted-foreground">
              {t(
                'reports.audit_log.subtitle',
                'Markaziy audit: mahsulot, buyurtma, narx o‘zgarishlari va boshqa harakatlar (Toshkent vaqti).',
              )}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={loadData}>
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Foydalanuvchi, harakat..."
                value={searchTerm}
                onChange={(e) => updateParams({ search: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sana</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => updateParams({ dateFrom: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sana</label>
              <Input type="date" value={dateTo} onChange={(e) => updateParams({ dateTo: e.target.value })} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Harakat</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={actionFilter}
                onChange={(e) => updateParams({ action: e.target.value })}
              >
                <option value="all">Hammasi</option>
                <option value="create">Yaratildi</option>
                <option value="update">Yangilandi</option>
                <option value="delete">O'chirildi</option>
                <option value="view">Ko'rildi</option>
                <option value="free_sale">Bepul sotuv</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Obyekt turi</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={entityTypeFilter}
                onChange={(e) => updateParams({ entityType: e.target.value })}
              >
                <option value="all">Hammasi</option>
                {AUDIT_ENTITY_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Foydalanuvchi</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={userFilter}
                onChange={(e) => updateParams({ userId: e.target.value })}
              >
                <option value="all">Hammasi</option>
                {uniqueUsers.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">Jami harakatlar</p>
            </div>
            <div className="text-2xl font-bold mt-2">{summary.totalActions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-blue-500" />
              <p className="text-sm text-muted-foreground">Foydalanuvchilar</p>
            </div>
            <div className="text-2xl font-bold mt-2">{summary.uniqueUserCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-green-500" />
              <p className="text-sm text-muted-foreground">Yaratildi</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-green-600">{summary.creates}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Edit className="h-5 w-5 text-blue-500" />
              <p className="text-sm text-muted-foreground">Yangilandi</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-blue-600">{summary.updates}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-500" />
              <p className="text-sm text-muted-foreground">O'chirildi</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-red-600">{summary.deletes}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {filteredLogs.length === 0 ? (
            <ReportLoadPanel
              status="empty"
              overlay={false}
              emptyTitle={t('reports.audit_log.empty', 'Audit yozuvlari topilmadi')}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sana/Vaqt</TableHead>
                  <TableHead>Foydalanuvchi</TableHead>
                  <TableHead className="text-center">Harakat</TableHead>
                  <TableHead>Obyekt turi</TableHead>
                  <TableHead>Obyekt</TableHead>
                  <TableHead>Eski qiymat</TableHead>
                  <TableHead>Yangi qiymat</TableHead>
                  <TableHead>Tavsif</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        {formatDateTime(row.created_at)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium">{(row.user_name || "Noma'lum").trim() || "Noma'lum"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        {getActionIcon(row.action)}
                        {getActionBadge(row.action)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{auditEntityTypeLabel(row.entity_type)}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{row.entity_name || row.entity_id}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {row.old_value || '-'}
                    </TableCell>
                    <TableCell className="text-sm font-medium max-w-xs truncate">
                      {row.new_value || '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {row.description || '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.ip_address || '-'}
                    </TableCell>
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
