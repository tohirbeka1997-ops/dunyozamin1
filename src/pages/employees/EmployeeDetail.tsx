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
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';

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
        title: 'Error',
        description: 'Failed to load employee data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getRoleBadge = (role: string) => {
    const roles: Record<string, { label: string; className: string }> = {
      admin: { label: 'Admin', className: 'bg-destructive' },
      manager: { label: 'Manager', className: 'bg-primary' },
      cashier: { label: 'Cashier', className: 'bg-muted' },
    };
    const roleData = roles[role] || { label: role, className: 'bg-muted' };
    return <Badge className={roleData.className}>{roleData.label}</Badge>;
  };

  const getStatusBadge = (isActive: boolean) => {
    return isActive ? (
      <Badge className="bg-success">Active</Badge>
    ) : (
      <Badge variant="outline" className="text-muted-foreground">
        Disabled
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
        <div className="text-muted-foreground">Loading employee data...</div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-muted-foreground">Employee not found</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageBreadcrumb
        items={[
          { label: 'Dashboard', href: '/' },
          { label: 'Employees', href: '/employees' },
          { label: employee.full_name || employee.username, href: '#' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/employees')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{employee.full_name || employee.username}</h1>
            <p className="text-muted-foreground">@{employee.username}</p>
          </div>
        </div>
        <Button onClick={() => navigate(`/employees/${id}/edit`)}>
          <Edit className="mr-2 h-4 w-4" />
          Edit Employee
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Role</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>{getRoleBadge(employee.role)}</CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>{getStatusBadge(employee.is_active)}</CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Last Login</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              {employee.last_login
                ? format(new Date(employee.last_login), 'MMM dd, yyyy HH:mm')
                : 'Never'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Joined</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm">{format(new Date(employee.created_at), 'MMM dd, yyyy')}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contact Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="flex items-center gap-3">
              <Phone className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Phone</div>
                <div className="text-sm text-muted-foreground">{employee.phone || 'Not set'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Email</div>
                <div className="text-sm text-muted-foreground">{employee.email || 'Not set'}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="performance" className="space-y-6">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="sessions">Time Tracking</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{performance?.total_sales || 0}</div>
                <p className="text-xs text-muted-foreground">Completed orders</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Number(performance?.total_revenue || 0).toLocaleString()} UZS
                </div>
                <p className="text-xs text-muted-foreground">Gross revenue</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Order Value</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Number(performance?.average_order_amount || 0).toLocaleString()} UZS
                </div>
                <p className="text-xs text-muted-foreground">Per transaction</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Net Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Number(performance?.net_revenue || 0).toLocaleString()} UZS
                </div>
                <p className="text-xs text-muted-foreground">After returns</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Returns Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Total Returns</span>
                    <span className="font-semibold">{performance?.total_returns || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Return Amount</span>
                    <span className="font-semibold">
                      {Number(performance?.return_amount || 0).toLocaleString()} UZS
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Return Rate</span>
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
                <CardTitle>Transaction Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Total Transactions</span>
                    <span className="font-semibold">{performance?.transaction_count || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Completed Sales</span>
                    <span className="font-semibold">{performance?.total_sales || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Success Rate</span>
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
              <CardTitle>Login Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No sessions found</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Login Time</TableHead>
                        <TableHead>Logout Time</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>IP Address</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sessions.map((session) => (
                        <TableRow key={session.id}>
                          <TableCell>
                            {format(new Date(session.login_time), 'MMM dd, yyyy HH:mm')}
                          </TableCell>
                          <TableCell>
                            {session.logout_time
                              ? format(new Date(session.logout_time), 'MMM dd, yyyy HH:mm')
                              : 'Active'}
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
              <CardTitle>Activity Log</CardTitle>
            </CardHeader>
            <CardContent>
              {activityLogs.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No activity logs found</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Document</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activityLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>
                            {format(new Date(log.created_at), 'MMM dd, yyyy HH:mm:ss')}
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
