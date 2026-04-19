import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowLeft,
  Edit,
  User,
  Phone,
  Mail,
  Calendar,
  Clock,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Activity,
} from 'lucide-react';
import {
  getEmployeeById,
  getEmployeePerformance,
  getEmployeeSessions,
  getEmployeeActivityLogs,
} from '@/db/api';
import type {
  Profile,
  EmployeePerformance,
  EmployeeSessionWithProfile,
  EmployeeActivityLogWithProfile,
} from '@/types/database';
import { formatDate, formatDateTime } from '@/lib/datetime';
import { useToast } from '@/hooks/use-toast';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';
import { formatMoneyUZS } from '@/lib/format';

export default function EmployeeDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { toast } = useToast();

  const [employee, setEmployee] = useState<Profile | null>(null);
  const [performance, setPerformance] = useState<EmployeePerformance | null>(null);
  const [sessions, setSessions] = useState<EmployeeSessionWithProfile[]>([]);
  const [activityLogs, setActivityLogs] = useState<EmployeeActivityLogWithProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadEmployeeData(id);
    }
  }, [id]);

  const loadEmployeeData = async (employeeId: string) => {
    try {
      setLoading(true);
      const [employeeData, performanceData, sessionsData, logsData] = await Promise.all([
        getEmployeeById(employeeId),
        getEmployeePerformance(employeeId),
        getEmployeeSessions(employeeId),
        getEmployeeActivityLogs(employeeId),
      ]);

      setEmployee(employeeData);
      setPerformance(performanceData);
      setSessions(sessionsData);
      setActivityLogs(logsData);
    } catch (error) {
      console.error('Error loading employee data:', error);
      toast({
        title: 'Xatolik',
        description: 'Xodim ma\'lumotlarini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getRoleBadge = (role: string) => {
    const roles: Record<string, { label: string; className: string }> = {
      admin: { label: 'Administrator', className: 'bg-destructive' },
      manager: { label: 'Manager', className: 'bg-primary' },
      cashier: { label: 'Kassir', className: 'bg-muted' },
    };
    const roleData = roles[role] || { label: role, className: 'bg-muted' };
    return <Badge className={roleData.className}>{roleData.label}</Badge>;
  };

  const getStatusBadge = (isActive: boolean) => {
    return isActive ? (
      <Badge className="bg-success text-success-foreground">Faol</Badge>
    ) : (
      <Badge variant="outline" className="text-muted-foreground">
        O'chirilgan
      </Badge>
    );
  };

  const formatDuration = (duration: string | null) => {
    if (!duration) return '-';
    const match = duration.match(/(\d+):(\d+):(\d+)/);
    if (!match) return duration;
    const [, hours, minutes] = match;
    return `${hours}h ${minutes}m`;
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-muted-foreground">Xodim ma'lumotlari yuklanmoqda...</div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-muted-foreground">Xodim topilmadi</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageBreadcrumb
        items={[
          { label: 'Dashboard', href: '/' },
          { label: 'Xodimlar', href: '/employees' },
          { label: employee.full_name || employee.username, href: '#' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/employees')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Orqaga
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{employee.full_name || employee.username}</h1>
            <p className="text-muted-foreground">@{employee.username}</p>
          </div>
        </div>
        <Button onClick={() => navigate(`/employees/${id}/edit`)}>
          <Edit className="mr-2 h-4 w-4" />
          Xodimni tahrirlash
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Lavozimi</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>{getRoleBadge(employee.role)}</CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Holati</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>{getStatusBadge(employee.is_active)}</CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Oxirgi kirish</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              {employee.last_login
                ? formatDateTime(employee.last_login)
                : 'Hech qachon'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Qo'shilgan sana</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm">{formatDate(employee.created_at)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kontakt ma'lumotlari</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="flex items-center gap-3">
              <Phone className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Telefon</div>
                <div className="text-sm text-muted-foreground">{employee.phone || 'O\'rnatilmagan'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Email</div>
                <div className="text-sm text-muted-foreground">{employee.email || 'O\'rnatilmagan'}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="performance" className="space-y-6">
        <TabsList>
          <TabsTrigger value="performance">Faoliyat</TabsTrigger>
          <TabsTrigger value="sessions">Vaqt kuzatuv</TabsTrigger>
          <TabsTrigger value="activity">Faoliyat jurnali</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Jami sotuvlar</CardTitle>
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{performance?.total_sales || 0}</div>
                <p className="text-xs text-muted-foreground">Yakunlangan buyurtmalar</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Jami daromad</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatMoneyUZS(performance?.total_revenue || 0)}
                </div>
                <p className="text-xs text-muted-foreground">Yalpi daromad</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">O'rtacha buyurtma summasi</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatMoneyUZS(performance?.average_order_amount || 0)}
                </div>
                <p className="text-xs text-muted-foreground">Har bir operatsiya uchun</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Sof daromad</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatMoneyUZS(performance?.net_revenue || 0)}
                </div>
                <p className="text-xs text-muted-foreground">Qaytarilgandan keyin</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Qaytarishlar yig'indisi</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Jami qaytarishlar</span>
                    <span className="font-semibold">{performance?.total_returns || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Qaytarish summasi</span>
                    <span className="font-semibold">
                      {formatMoneyUZS(performance?.return_amount || 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Qaytarish foizi</span>
                    <span className="font-semibold">
                      {performance?.total_sales
                        ? (
                            (Number(performance.total_returns) / Number(performance.total_sales)) *
                            100
                          ).toFixed(1)
                        : 0}
                      %
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Operatsiyalar yig'indisi</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Jami operatsiyalar</span>
                    <span className="font-semibold">{performance?.transaction_count || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Yakunlangan sotuvlar</span>
                    <span className="font-semibold">{performance?.total_sales || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Muvaffaqiyat foizi</span>
                    <span className="font-semibold">
                      {performance?.transaction_count
                        ? (
                            (Number(performance.total_sales) /
                              Number(performance.transaction_count)) *
                            100
                          ).toFixed(1)
                        : 0}
                      %
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="sessions">
          <Card>
            <CardHeader>
              <CardTitle>Kirish sessiyalari</CardTitle>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">Sessiyalar topilmadi</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kirish vaqti</TableHead>
                        <TableHead>Chiqish vaqti</TableHead>
                        <TableHead>Davomiyligi</TableHead>
                        <TableHead>IP manzil</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sessions.map((session) => (
                        <TableRow key={session.id}>
                          <TableCell>
                            {formatDateTime(session.login_time)}
                          </TableCell>
                          <TableCell>
                            {session.logout_time
                              ? formatDateTime(session.logout_time)
                              : 'Faol'}
                          </TableCell>
                          <TableCell>{formatDuration(session.duration)}</TableCell>
                          <TableCell>{session.ip_address || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Faoliyat jurnali</CardTitle>
            </CardHeader>
            <CardContent>
              {activityLogs.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">Faoliyat jurnali topilmadi</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vaqt belgisi</TableHead>
                        <TableHead>Amal</TableHead>
                        <TableHead>Tavsif</TableHead>
                        <TableHead>Hujjat</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activityLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>
                            {formatDateTime(log.created_at, { withSeconds: true })}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{log.action_type}</Badge>
                          </TableCell>
                          <TableCell>{log.description}</TableCell>
                          <TableCell>
                            {log.document_type && log.document_id ? (
                              <span className="text-sm text-muted-foreground">
                                {log.document_type}
                              </span>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
