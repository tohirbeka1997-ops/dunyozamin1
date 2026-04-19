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
import { Plus, Search, MoreVertical, Edit, Trash2, Key } from 'lucide-react';
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
    return <Badge className={positionData.className}>{positionData.label}</Badge>;
  };

  const getStatusIndicator = (isActive: boolean) => {
    return (
      <div className="flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${
            isActive ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span className="text-sm">{isActive ? 'Faol' : 'Faol emas'}</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageBreadcrumb
        items={[
          { label: 'Dashboard', href: '/' },
          { label: 'Xodimlar', href: '/employees' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Xodimlar</h1>
          <p className="text-muted-foreground">Xodimlar hisoblarini va huquqlarini boshqarish</p>
        </div>
        <Button onClick={() => {
          setEditingEmployeeId(undefined);
          setEmployeeFormOpen(true);
        }}>
          <Plus className="mr-2 h-4 w-4" />
          Yangi xodim qo'shish
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Umumiy xodimlar soni</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalEmployees}</div>
            <p className="text-xs text-muted-foreground">Ro'yxatdan o'tgan barcha xodimlar</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Faol xodimlar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeEmployees}</div>
            <p className="text-xs text-muted-foreground">Hozirda faol hisoblar</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Administratorlar soni</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{administratorsCount}</div>
            <p className="text-xs text-muted-foreground">Administrator huquqlariga ega foydalanuvchilar</p>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Xodimlar ro'yxati</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative flex-1 xl:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Ism yoki telefon raqam bo'yicha qidirish…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Select value={positionFilter} onValueChange={setPositionFilter}>
                <SelectTrigger className="w-[180px]">
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
                <SelectTrigger className="w-[150px]">
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

          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Xodimlar yuklanmoqda...</div>
          ) : filteredEmployees.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              Filtrlarga mos keladigan xodimlar topilmadi
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>To'liq ismi</TableHead>
                    <TableHead>Telefon raqami / Login</TableHead>
                    <TableHead>Lavozimi</TableHead>
                    <TableHead>Holati</TableHead>
                    <TableHead>Ishga kirgan sana</TableHead>
                    <TableHead className="text-right">Amallar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees.map((employee) => (
                    <TableRow key={employee.id}>
                      <TableCell className="font-medium">
                        {employee.full_name || employee.username}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div>{employee.phone || '-'}</div>
                          <div className="text-xs text-muted-foreground">
                            Login: {employee.username}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{getPositionBadge(employee.role)}</TableCell>
                      <TableCell>{getStatusIndicator(employee.is_active)}</TableCell>
                      <TableCell>
                        {employee.created_at
                          ? formatDate(employee.created_at)
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
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
