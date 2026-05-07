import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Plus, Search, MoreVertical, Edit, Trash2, Key, Users } from 'lucide-react';
import { getAllEmployees, deleteEmployee } from '@/db/api';
import type { Profile } from '@/types/database';
import { useToast } from '@/hooks/use-toast';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';
import EmployeeFormModal from '@/components/employees/EmployeeFormModal';
import { formatDate } from '@/lib/datetime';

type Position = 'admin' | 'manager' | 'cashier' | 'warehouse';

export default function Employees() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [positionFilter, setPositionFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Profile | null>(null);
  const [employeeFormOpen, setEmployeeFormOpen] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | undefined>();

  useEffect(() => {
    loadEmployees();
  }, []);

  const loadEmployees = async () => {
    try {
      setLoading(true);
      const data = await getAllEmployees();
      setEmployees(data);
    } catch (error) {
      console.error('Error loading employees:', error);
      toast({
        title: 'Xatolik',
        description: 'Xodimlarni yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!employeeToDelete) return;

    try {
      await deleteEmployee(employeeToDelete.id);
      toast({
        title: 'Muvaffaqiyatli',
        description: `${employeeToDelete.full_name || employeeToDelete.username} o'chirildi`,
      });
      loadEmployees();
    } catch (error) {
      console.error('Error deleting employee:', error);
      toast({
        title: 'Xatolik',
        description: 'Xodimni o\'chirib bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setDeleteDialogOpen(false);
      setEmployeeToDelete(null);
    }
  };

  const openDeleteDialog = (employee: Profile) => {
    setEmployeeToDelete(employee);
    setDeleteDialogOpen(true);
  };

  const filteredEmployees = employees.filter((employee) => {
    const matchesSearch =
      !searchTerm ||
      employee.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      employee.phone?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      employee.username.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesPosition = positionFilter === 'all' || employee.role === positionFilter;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && employee.is_active) ||
      (statusFilter === 'inactive' && !employee.is_active);

    return matchesSearch && matchesPosition && matchesStatus;
  });

  // Calculate summary statistics
  const totalEmployees = employees.length;
  const activeEmployees = employees.filter((e) => e.is_active).length;
  const administratorsCount = employees.filter((e) => e.role === 'admin').length;

  const getPositionBadge = (role: string) => {
    const positions: Record<string, { label: string; className: string }> = {
      admin: { label: 'Administrator', className: 'bg-red-500/10 text-red-700 dark:text-red-400' },
      manager: { label: 'Manager', className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' },
      cashier: { label: 'Kassir', className: 'bg-green-500/10 text-green-700 dark:text-green-400' },
      warehouse: { label: 'Ombor xodimi', className: 'bg-purple-500/10 text-purple-700 dark:text-purple-400' },
    };
    const positionData = positions[role] || { label: role, className: 'bg-muted' };
    return (
      <Badge className={`${positionData.className} px-1.5 py-0 text-[10px] font-normal sm:text-xs`}>
        {positionData.label}
      </Badge>
    );
  };

  const getStatusIndicator = (isActive: boolean) => {
    return (
      <div className="flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${
            isActive ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span className="text-xs">{isActive ? 'Faol' : 'Faol emas'}</span>
      </div>
    );
  };

  return (
    <div className="w-full min-w-0 space-y-4">
      <PageBreadcrumb
        items={[
          { label: 'Dashboard', href: '/' },
          { label: 'Xodimlar', href: '/employees' },
        ]}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">Xodimlar</h1>
          <p className="page-heading-sub">Xodimlar hisoblarini va huquqlarini boshqarish</p>
        </div>
        <Button
          size="sm"
          className="h-8 shrink-0 text-xs"
          onClick={() => {
            setEditingEmployeeId(undefined);
            setEmployeeFormOpen(true);
          }}
        >
          <Plus className="mr-2 h-3.5 w-3.5" />
          Yangi xodim qo'shish
        </Button>
      </div>

      <div className="grid gap-2 xl:grid-cols-3">
        <Card className="gap-0 py-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">Umumiy xodimlar soni</CardTitle>
          </CardHeader>
          <CardContent className="pb-3 pt-0">
            <div className="text-xl font-bold tabular-nums">{totalEmployees}</div>
            <p className="text-[11px] text-muted-foreground">Ro'yxatdan o'tgan barcha xodimlar</p>
          </CardContent>
        </Card>

        <Card className="gap-0 py-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">Faol xodimlar</CardTitle>
          </CardHeader>
          <CardContent className="pb-3 pt-0">
            <div className="text-xl font-bold tabular-nums">{activeEmployees}</div>
            <p className="text-[11px] text-muted-foreground">Hozirda faol hisoblar</p>
          </CardContent>
        </Card>

        <Card className="gap-0 py-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">Administratorlar soni</CardTitle>
          </CardHeader>
          <CardContent className="pb-3 pt-0">
            <div className="text-xl font-bold tabular-nums">{administratorsCount}</div>
            <p className="text-[11px] text-muted-foreground">Administrator huquqlariga ega foydalanuvchilar</p>
          </CardContent>
        </Card>
      </div>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b px-4 py-2 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">Xodimlar ro&apos;yxati</span>
            {!loading && (
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                ({filteredEmployees.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-2">
          <div className="mb-3 rounded-md border bg-muted/30 px-2 py-1.5">
            <span className="mb-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Filtrlar
            </span>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative h-8 min-w-0 flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Ism yoki telefon raqam bo'yicha qidirish…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-8 py-1 pl-8 text-xs sm:text-sm"
                />
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Select value={positionFilter} onValueChange={setPositionFilter}>
                  <SelectTrigger className="h-8 w-[180px] bg-background text-xs [&_span]:truncate">
                    <SelectValue placeholder="Lavozim bo'yicha filtr" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Barcha lavozimlar</SelectItem>
                    <SelectItem value="admin">Administrator</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="cashier">Kassir</SelectItem>
                    <SelectItem value="warehouse">Ombor xodimi</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-[150px] bg-background text-xs [&_span]:truncate">
                    <SelectValue placeholder="Holat bo'yicha filtr" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Barcha holatlar</SelectItem>
                    <SelectItem value="active">Faol</SelectItem>
                    <SelectItem value="inactive">Faol emas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Xodimlar yuklanmoqda...</div>
          ) : filteredEmployees.length === 0 ? (
            <div className="rounded-lg border bg-muted/20 py-10 text-center text-sm text-muted-foreground">
              Filtrlarga mos keladigan xodimlar topilmadi
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-semibold sm:text-sm">To'liq ismi</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Telefon raqami / Login</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Lavozimi</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Holati</TableHead>
                    <TableHead className="text-xs font-semibold sm:text-sm">Ishga kirgan sana</TableHead>
                    <TableHead className="w-[1%] text-right text-xs font-semibold sm:text-sm">Amallar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees.map((employee) => (
                    <TableRow key={employee.id} className="text-sm">
                      <TableCell className="max-w-[14rem] truncate py-2 font-medium">
                        {employee.full_name || employee.username}
                      </TableCell>
                      <TableCell className="py-2">
                        <div>
                          <div className="text-xs">{employee.phone || '-'}</div>
                          <div className="text-[11px] text-muted-foreground">Login: {employee.username}</div>
                        </div>
                      </TableCell>
                      <TableCell className="py-2">{getPositionBadge(employee.role)}</TableCell>
                      <TableCell className="py-2">{getStatusIndicator(employee.is_active)}</TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                        {employee.created_at ? formatDate(employee.created_at) : '-'}
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingEmployeeId(employee.id);
                                setEmployeeFormOpen(true);
                              }}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Tahrirlash
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => navigate(`/employees/${employee.id}`)}
                            >
                              <Key className="mr-2 h-4 w-4" />
                              Huquqlar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openDeleteDialog(employee)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              O'chirish
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ishonchingiz komilmi?</AlertDialogTitle>
            <AlertDialogDescription>
              Siz haqiqatan ham{' '}
              <strong>{employeeToDelete?.full_name || employeeToDelete?.username}</strong> ni o'chirmoqchimisiz? Bu
              amalni bekor qilib bo'lmaydi va xodim tizimdan butunlay olib tashlanadi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor qilish</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              O'chirish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Employee Form Modal */}
      <EmployeeFormModal
        open={employeeFormOpen}
        onOpenChange={setEmployeeFormOpen}
        employeeId={editingEmployeeId}
        onSuccess={() => {
          loadEmployees();
          setEmployeeFormOpen(false);
          setEditingEmployeeId(undefined);
        }}
      />
    </div>
  );
}
