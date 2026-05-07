import { useState, useEffect } from 'react';
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
import { getEmployeeSessions } from '@/db/api';
import type { EmployeeSessionWithProfile } from '@/types/database';
import { FileDown, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { formatDateTime, todayYMD } from '@/lib/datetime';
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh';

export default function LoginActivityReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<EmployeeSessionWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(todayYMD());
  const [dateTo, setDateTo] = useState(todayYMD());

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo]);

  async function loadData() {
    try {
      setLoading(true);
      const sessionsData = await getEmployeeSessions({ dateFrom, dateTo });

      const sorted = [...sessionsData].sort((a, b) => {
        const timeA = a.login_time ? new Date(a.login_time).getTime() : 0;
        const timeB = b.login_time ? new Date(b.login_time).getTime() : 0;
        return timeB - timeA;
      });

      setSessions(sorted);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Tizimga kirishlar jurnalini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  useReportAutoRefresh(loadData);

  const calculateDuration = (loginTime: string, logoutTime: string | null) => {
    if (!logoutTime) return '-';
    const login = new Date(loginTime).getTime();
    const logout = new Date(logoutTime).getTime();
    const diffMs = logout - login;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${diffHours} soat ${diffMinutes} min`;
  };

  const handleExport = (format: 'excel' | 'pdf') => {
    toast({
      title: 'Eksport',
      description: `${format.toUpperCase()} ga eksport qilinmoqda...`,
    });
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
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports/employee')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">Tizimga kirishlar jurnali</h1>
            <p className="text-muted-foreground">Xodimlarning tizimga kirish va chiqishlarini ko'rish</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport('excel')}>
            <FileDown className="h-4 w-4 mr-2" />
            Excel
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')}>
            <FileDown className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sanasi</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sanasi</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {sessions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Tizimga kirishlar jurnali topilmadi</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Xodim</TableHead>
                  <TableHead>Kirish vaqti</TableHead>
                  <TableHead>Chiqish vaqti</TableHead>
                  <TableHead>Davomiyligi</TableHead>
                  <TableHead>IP manzil</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="font-medium">
                      {session.employee?.full_name || session.employee?.username || 'Noma\'lum'}
                    </TableCell>
                    <TableCell>
                      {session.login_time 
                        ? formatDateTime(session.login_time)
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {session.logout_time 
                        ? formatDateTime(session.logout_time)
                        : 'Aktiv'}
                    </TableCell>
                    <TableCell>
                      {session.login_time && session.logout_time
                        ? calculateDuration(session.login_time, session.logout_time)
                        : '-'}
                    </TableCell>
                    <TableCell>{session.ip_address || '-'}</TableCell>
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

