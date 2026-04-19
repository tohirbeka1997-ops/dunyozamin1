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
import { ArrowLeft, Activity, Printer, Scale, Wifi, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handleIpcResponse, isElectron, requireElectron } from '@/utils/electron';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';
import { formatDateTime } from '@/lib/datetime';

interface DeviceStatus {
  device_id: string;
  device_name: string;
  device_type: 'printer' | 'scale' | 'internet' | 'other';
  location: string;
  status: 'online' | 'offline' | 'warning';
  last_check: string;
  uptime_percent: number;
  error_count: number;
  last_error?: string;
  last_error_time?: string;
}

interface DeviceIncident {
  id: string;
  device_name: string;
  device_type: string;
  incident_type: 'offline' | 'error' | 'warning';
  occurred_at: string;
  resolved_at?: string;
  duration_minutes?: number;
  error_message?: string;
  affected_operations: number;
}

export default function DeviceHealthReport() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [deviceRows, setDeviceRows] = useState<DeviceStatus[]>([]);
  const [incidentRows, setIncidentRows] = useState<DeviceIncident[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'status' | 'incidents'>('status');

  useReportAutoRefresh(loadData);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      if (!isElectron()) {
        throw new Error('Bu hisobot faqat desktop ilovada mavjud.');
      }
      setLoading(true);
      const api = requireElectron();
      
      const [devices, incidents] = await Promise.all([
        handleIpcResponse<DeviceStatus[]>(
          api.reports?.deviceHealth?.() || Promise.resolve([])
        ),
        handleIpcResponse<DeviceIncident[]>(
          api.reports?.deviceIncidents?.() || Promise.resolve([])
        ),
      ]);

      setDeviceRows(Array.isArray(devices) ? devices : []);
      setIncidentRows(Array.isArray(incidents) ? incidents : []);
    } catch (error: any) {
      console.error('[DeviceHealthReport] loadData error:', error);
      toast({
        title: 'Xatolik',
        description: error?.message || "Ma'lumotlarni yuklab bo'lmadi",
        variant: 'destructive',
      });
      setDeviceRows([]);
      setIncidentRows([]);
    } finally {
      setLoading(false);
    }
  }

  const filteredDevices = useMemo(() => {
    let result = deviceRows;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (row) =>
          row.device_name.toLowerCase().includes(term) ||
          row.location.toLowerCase().includes(term)
      );
    }

    if (deviceTypeFilter !== 'all') {
      result = result.filter((row) => row.device_type === deviceTypeFilter);
    }

    if (statusFilter !== 'all') {
      result = result.filter((row) => row.status === statusFilter);
    }

    return result;
  }, [deviceRows, searchTerm, deviceTypeFilter, statusFilter]);

  const filteredIncidents = useMemo(() => {
    if (!searchTerm) return incidentRows;
    const term = searchTerm.toLowerCase();
    return incidentRows.filter(
      (row) =>
        row.device_name.toLowerCase().includes(term) ||
        (row.error_message && row.error_message.toLowerCase().includes(term))
    );
  }, [incidentRows, searchTerm]);

  const summary = useMemo(() => {
    const total = deviceRows.length;
    const online = deviceRows.filter((d) => d.status === 'online').length;
    const offline = deviceRows.filter((d) => d.status === 'offline').length;
    const warning = deviceRows.filter((d) => d.status === 'warning').length;
    const avgUptime =
      total > 0
        ? deviceRows.reduce((sum, d) => sum + Number(d.uptime_percent || 0), 0) / total
        : 100;
    const totalErrors = deviceRows.reduce((sum, d) => sum + Number(d.error_count || 0), 0);
    return { total, online, offline, warning, avgUptime, totalErrors };
  }, [deviceRows]);

  const getStatusBadge = (status: string) => {
    if (status === 'online') {
      return (
        <Badge className="bg-green-600 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Online
        </Badge>
      );
    }
    if (status === 'offline') {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <XCircle className="h-3 w-3" />
          Offline
        </Badge>
      );
    }
    return (
      <Badge className="bg-yellow-600 flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        Ogohlantirish
      </Badge>
    );
  };

  const getDeviceIcon = (type: string) => {
    if (type === 'printer') return <Printer className="h-4 w-4" />;
    if (type === 'scale') return <Scale className="h-4 w-4" />;
    if (type === 'internet') return <Wifi className="h-4 w-4" />;
    return <Activity className="h-4 w-4" />;
  };

  const getIncidentBadge = (type: string) => {
    if (type === 'offline') return <Badge variant="destructive">Offline</Badge>;
    if (type === 'error') return <Badge className="bg-orange-500">Xato</Badge>;
    return <Badge className="bg-yellow-600">Ogohlantirish</Badge>;
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
              <Activity className="h-8 w-8 text-blue-500" />
              Qurilma holati
            </h1>
            <p className="text-muted-foreground">
              Printer, tarozi, internet holati monitoring
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={loadData}>
          Yangilash
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Qidirish</label>
              <Input
                placeholder="Qurilma yoki joylashuv..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Turi</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={deviceTypeFilter}
                onChange={(e) => setDeviceTypeFilter(e.target.value)}
              >
                <option value="all">Hammasi</option>
                <option value="printer">Printer</option>
                <option value="scale">Tarozi</option>
                <option value="internet">Internet</option>
                <option value="other">Boshqa</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Holat</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">Hammasi</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="warning">Ogohlantirish</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Ko'rinish</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as any)}
              >
                <option value="status">Holat</option>
                <option value="incidents">Hodisalar</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <p className="text-sm text-muted-foreground">Jami qurilmalar</p>
            </div>
            <div className="text-2xl font-bold mt-2">{summary.total}</div>
          </CardContent>
        </Card>
        <Card className="border-green-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <p className="text-sm text-muted-foreground">Online</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-green-600">{summary.online}</div>
          </CardContent>
        </Card>
        <Card className="border-red-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" />
              <p className="text-sm text-muted-foreground">Offline</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-red-600">{summary.offline}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-500" />
              <p className="text-sm text-muted-foreground">Uptime</p>
            </div>
            <div className="text-2xl font-bold mt-2">{summary.avgUptime.toFixed(1)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <p className="text-sm text-muted-foreground">Xatolar</p>
            </div>
            <div className="text-2xl font-bold mt-2 text-orange-600">{summary.totalErrors}</div>
          </CardContent>
        </Card>
      </div>

      {viewMode === 'status' ? (
        <Card>
          <CardContent className="p-0">
            {filteredDevices.length === 0 ? (
              <div className="text-center py-12">
                <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Qurilmalar topilmadi</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Turi</TableHead>
                    <TableHead>Qurilma nomi</TableHead>
                    <TableHead>Joylashuv</TableHead>
                    <TableHead className="text-center">Holat</TableHead>
                    <TableHead className="text-right">Uptime %</TableHead>
                    <TableHead className="text-right">Xatolar</TableHead>
                    <TableHead>Oxirgi tekshiruv</TableHead>
                    <TableHead>Oxirgi xato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDevices.map((row) => (
                    <TableRow
                      key={row.device_id}
                      className={
                        row.status === 'offline'
                          ? 'bg-red-50'
                          : row.status === 'warning'
                          ? 'bg-yellow-50'
                          : ''
                      }
                    >
                      <TableCell>{getDeviceIcon(row.device_type)}</TableCell>
                      <TableCell className="font-medium">{row.device_name}</TableCell>
                      <TableCell>{row.location}</TableCell>
                      <TableCell className="text-center">{getStatusBadge(row.status)}</TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            row.uptime_percent >= 95
                              ? 'text-green-600 font-semibold'
                              : row.uptime_percent >= 80
                              ? 'text-yellow-600'
                              : 'text-red-600 font-semibold'
                          }
                        >
                          {row.uptime_percent.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.error_count > 0 ? (
                          <span className="text-orange-600 font-semibold">{row.error_count}</span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {formatDateTime(row.last_check)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {row.last_error || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {filteredIncidents.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
                <p className="text-muted-foreground">Hodisalar topilmadi</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Qurilma</TableHead>
                    <TableHead>Turi</TableHead>
                    <TableHead className="text-center">Hodisa</TableHead>
                    <TableHead>Sodir bo'ldi</TableHead>
                    <TableHead>Hal qilindi</TableHead>
                    <TableHead className="text-right">Davomiyligi</TableHead>
                    <TableHead className="text-right">Ta'sir</TableHead>
                    <TableHead>Xato xabari</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIncidents.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.device_name}</TableCell>
                      <TableCell>{getDeviceIcon(row.device_type)}</TableCell>
                      <TableCell className="text-center">{getIncidentBadge(row.incident_type)}</TableCell>
                      <TableCell>
                        {formatDateTime(row.occurred_at)}
                      </TableCell>
                      <TableCell>
                        {row.resolved_at
                          ? formatDateTime(row.resolved_at)
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.duration_minutes ? `${row.duration_minutes} daq` : '-'}
                      </TableCell>
                      <TableCell className="text-right text-orange-600">
                        {row.affected_operations || 0}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {row.error_message || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
