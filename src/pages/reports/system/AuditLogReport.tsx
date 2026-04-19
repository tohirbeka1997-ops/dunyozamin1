import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { todayYMD, formatDateTime } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

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

export default function AuditLogReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [logRows, setLogRows] = useState<AuditLog[]>([]);
  const [dateFrom, setDateFrom] = useState(
    new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(todayYMD());
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('all');
  const [userFilter, setUserFilter] = useState<string>('all');

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, actionFilter, entityTypeFilter, userFilter]);

  async function loadData() {
    try {
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }
      setLoading(true);
      const api = requireElectron();
      
      const logs = await handleIpcResponse<AuditLog[]>(
        api.reports?.auditLog?.({
          date_from: dateFrom,
          date_to: dateTo,
          action: actionFilter !== 'all' ? actionFilter : undefined,
          entity_type: entityTypeFilter !== 'all' ? entityTypeFilter : undefined,
          user_id: userFilter !== 'all' ? userFilter : undefined,
        }) || Promise.resolve([])
      );

      setLogRows(Array.isArray(logs) ? logs : []);
    } catch (error: any) {
      console.error('[AuditLogReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setLogRows([]);
    } finally {
      setLoading(false);
    }
  }

  const filteredLogs = useMemo(() => {
    if (!searchTerm) return logRows;
    const term = searchTerm.toLowerCase();
    return logRows.filter(
      (row) =>
        row.user_name.toLowerCase().includes(term) ||
        row.action.toLowerCase().includes(term) ||
        row.entity_type.toLowerCase().includes(term) ||
        (row.entity_name && row.entity_name.toLowerCase().includes(term)) ||
        (row.description && row.description.toLowerCase().includes(term))
    );
  }, [logRows, searchTerm]);

  const uniqueUsers = useMemo(() => {
    const users = new Map<string, string>();
    for (const log of logRows) {
      if (!users.has(log.user_id)) {
        users.set(log.user_id, log.user_name);
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
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <FileText className="h-8 w-8 text-purple-500" />
              Harakatlar jurnali (Audit)
            </h1>
            <p className="text-muted-foreground">
              Kim, qachon, nima qildi — barcha harakatlar jurnali
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
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sana</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sana</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Harakat</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              >
                <option value="all">Hammasi</option>
                <option value="create">Yaratildi</option>
                <option value="update">Yangilandi</option>
                <option value="delete">O'chirildi</option>
                <option value="view">Ko'rildi</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Obyekt turi</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={entityTypeFilter}
                onChange={(e) => setEntityTypeFilter(e.target.value)}
              >
                <option value="all">Hammasi</option>
                <option value="product">Mahsulot</option>
                <option value="order">Buyurtma</option>
                <option value="customer">Mijoz</option>
                <option value="supplier">Postavshik</option>
                <option value="user">Foydalanuvchi</option>
                <option value="setting">Sozlama</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Foydalanuvchi</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
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
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Audit yozuvlari topilmadi</p>
            </div>
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
                        <span className="font-medium">{row.user_name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        {getActionIcon(row.action)}
                        {getActionBadge(row.action)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.entity_type}</Badge>
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
