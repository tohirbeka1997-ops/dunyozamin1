import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Save, Eye, EyeOff } from 'lucide-react';
import { createEmployee, updateEmployee, getEmployeeById } from '@/db/api';
import type { Profile, UserRole } from '@/types/database';
import { useToast } from '@/hooks/use-toast';

type PermissionModule = 'products' | 'orders' | 'reports' | 'customers' | 'inventory' | 'settings';
type PermissionAction = 'view' | 'add' | 'edit' | 'delete' | 'change_price';

interface ModulePermissions {
  [key: string]: {
    view: boolean;
    add: boolean;
    edit: boolean;
    delete: boolean;
    change_price?: boolean;
  };
}

const MODULES: PermissionModule[] = ['products', 'orders', 'reports', 'customers', 'inventory', 'settings'];
const MODULE_LABELS: Record<PermissionModule, string> = {
  products: 'Mahsulotlar',
  orders: 'Buyurtmalar',
  reports: 'Hisobotlar',
  customers: 'Mijozlar',
  inventory: 'Ombor',
  settings: 'Sozlamalar',
};

const ACTIONS: PermissionAction[] = ['view', 'add', 'edit', 'delete', 'change_price'];
const ACTION_LABELS: Record<PermissionAction, string> = {
  view: 'Ko\'rish',
  add: 'Qo\'shish',
  edit: 'Tahrirlash',
  delete: 'O\'chirish',
  change_price: 'Narxni o\'zgartirish',
};

interface EmployeeFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId?: string;
  onSuccess?: () => void;
}

export default function EmployeeFormModal({
  open,
  onOpenChange,
  employeeId,
  onSuccess,
}: EmployeeFormModalProps) {
  const { toast } = useToast();
  const isEditMode = Boolean(employeeId);

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showAdminConfirm, setShowAdminConfirm] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    full_name: '',
    phone: '',
    email: '',
    role: 'cashier' as UserRole | 'warehouse',
    is_active: true,
  });
  const [permissions, setPermissions] = useState<ModulePermissions>({
    products: { view: false, add: false, edit: false, delete: false, change_price: false },
    orders: { view: false, add: false, edit: false, delete: false },
    reports: { view: false, add: false, edit: false, delete: false },
    customers: { view: false, add: false, edit: false, delete: false },
    inventory: { view: false, add: false, edit: false, delete: false },
    settings: { view: false, add: false, edit: false, delete: false },
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && isEditMode && employeeId) {
      loadEmployee(employeeId);
    } else if (open && !isEditMode) {
      // Reset form for new employee
      setFormData({
        username: '',
        password: '',
        confirmPassword: '',
        full_name: '',
        phone: '',
        email: '',
        role: 'cashier',
        is_active: true,
      });
      setPermissions({
        products: { view: false, add: false, edit: false, delete: false, change_price: false },
        orders: { view: false, add: false, edit: false, delete: false },
        reports: { view: false, add: false, edit: false, delete: false },
        customers: { view: false, add: false, edit: false, delete: false },
        inventory: { view: false, add: false, edit: false, delete: false },
        settings: { view: false, add: false, edit: false, delete: false },
      });
      setErrors({});
    }
  }, [open, employeeId, isEditMode]);

  const loadEmployee = async (employeeId: string) => {
    try {
      setLoading(true);
      const employee = await getEmployeeById(employeeId);
      if (employee) {
        setFormData({
          username: employee.username,
          password: '',
          confirmPassword: '',
          full_name: employee.full_name || '',
          phone: employee.phone || '',
          email: employee.email || '',
          role: employee.role as UserRole | 'warehouse',
          is_active: employee.is_active,
        });
        setDefaultPermissions(employee.role);
      }
    } catch (error) {
      console.error('Error loading employee:', error);
      toast({
        title: 'Xatolik',
        description: 'Xodim ma\'lumotlarini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const setDefaultPermissions = (role: string) => {
    const defaultPerms: ModulePermissions = {
      products: { view: false, add: false, edit: false, delete: false, change_price: false },
      orders: { view: false, add: false, edit: false, delete: false },
      reports: { view: false, add: false, edit: false, delete: false },
      customers: { view: false, add: false, edit: false, delete: false },
      inventory: { view: false, add: false, edit: false, delete: false },
      settings: { view: false, add: false, edit: false, delete: false },
    };

    if (role === 'admin') {
      MODULES.forEach((module) => {
        defaultPerms[module] = {
          view: true,
          add: true,
          edit: true,
          delete: true,
          change_price: module === 'products',
        };
      });
    } else if (role === 'manager') {
      ['products', 'orders', 'reports', 'customers', 'inventory'].forEach((module) => {
        defaultPerms[module as PermissionModule] = {
          view: true,
          add: true,
          edit: true,
          delete: true,
          change_price: module === 'products',
        };
      });
    } else if (role === 'cashier') {
      defaultPerms.orders = { view: true, add: true, edit: false, delete: false };
      defaultPerms.products = { view: true, add: false, edit: false, delete: false, change_price: false };
      defaultPerms.customers = { view: true, add: true, edit: false, delete: false };
    }

    setPermissions(defaultPerms);
  };

  const handleRoleChange = (role: string) => {
    setFormData((prev) => ({ ...prev, role: role as UserRole | 'warehouse' }));
    setDefaultPermissions(role);
  };

  const handleModuleToggle = (module: PermissionModule, checked: boolean) => {
    setPermissions((prev) => ({
      ...prev,
      [module]: {
        view: checked,
        add: checked,
        edit: checked,
        delete: checked,
        change_price: module === 'products' ? checked : undefined,
      },
    }));
  };

  const handlePermissionChange = (
    module: PermissionModule,
    action: PermissionAction,
    checked: boolean
  ) => {
    setPermissions((prev) => ({
      ...prev,
      [module]: {
        ...prev[module],
        [action]: checked,
      },
    }));
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.full_name.trim()) {
      newErrors.full_name = 'To\'liq ism talab qilinadi';
    }

    if (!isEditMode) {
      if (!formData.username.trim()) {
        newErrors.username = 'Foydalanuvchi nomi talab qilinadi';
      } else if (formData.username.length < 3) {
        newErrors.username = 'Foydalanuvchi nomi kamida 3 ta belgi bo\'lishi kerak';
      }

      if (!formData.password) {
        newErrors.password = 'Parol talab qilinadi';
      } else if (formData.password.length < 6) {
        newErrors.password = 'Parol kamida 6 ta belgi bo\'lishi kerak';
      }

      if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = 'Parollar mos kelmaydi';
      }
    }

    if (formData.phone && !formData.phone.match(/^\+998\d{9}$/)) {
      newErrors.phone = 'Telefon +998XXXXXXXXX formatida bo\'lishi kerak';
    }

    if (formData.email && !formData.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      newErrors.email = 'Email formati noto\'g\'ri';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    if (formData.role === 'admin' && !showAdminConfirm) {
      setShowAdminConfirm(true);
      return;
    }

    try {
      setLoading(true);

      if (isEditMode && employeeId) {
        await updateEmployee(employeeId, {
          full_name: formData.full_name,
          phone: formData.phone || null,
          email: formData.email || null,
          role: formData.role as UserRole,
          is_active: formData.is_active,
        } as Partial<Profile>);

      toast({
        title: 'Muvaffaqiyatli',
        description: 'Xodim muvaffaqiyatli yangilandi',
      });
      } else {
        await createEmployee({
          username: formData.username,
          password: formData.password,
          full_name: formData.full_name,
          phone: formData.phone || undefined,
          email: formData.email || undefined,
          role: formData.role as UserRole,
          is_active: formData.is_active,
        });

        toast({
          title: 'Muvaffaqiyatli',
          description: 'Xodim muvaffaqiyatli yaratildi',
        });
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error: unknown) {
      console.error('Error saving employee:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save employee';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setShowAdminConfirm(false);
    }
  };

  const handleChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditMode ? 'Xodimni tahrirlash' : 'Yangi xodim qo\'shish'}</DialogTitle>
            <DialogDescription>
              {isEditMode
                ? 'Xodim ma\'lumotlari va huquqlarini yangilash'
                : 'Kirish huquqlari bilan yangi xodim hisobi yaratish'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit}>
            <Tabs defaultValue="basic" className="space-y-4">
              <TabsList>
                <TabsTrigger value="basic">Asosiy ma'lumotlar</TabsTrigger>
                <TabsTrigger value="permissions">Huquqlar</TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-4">
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="full_name">
                      To'liq ismi <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="full_name"
                      value={formData.full_name}
                      onChange={(e) => handleChange('full_name', e.target.value)}
                      placeholder="To'liq ismni kiriting"
                      disabled={loading}
                    />
                    {errors.full_name && (
                      <p className="text-sm text-destructive">{errors.full_name}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefon raqami (Login)</Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => handleChange('phone', e.target.value)}
                      placeholder="+998XXXXXXXXX"
                      disabled={loading}
                    />
                    {errors.phone && <p className="text-sm text-destructive">{errors.phone}</p>}
                    <p className="text-xs text-muted-foreground">
                      Telefon raqamidan login sifatida foydalanish mumkin
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="role">
                      Lavozimi <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={formData.role}
                      onValueChange={handleRoleChange}
                      disabled={loading}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cashier">Kassir</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="warehouse">Ombor xodimi</SelectItem>
                        <SelectItem value="admin">Administrator</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                      placeholder="employee@example.com"
                      disabled={loading}
                    />
                    {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                  </div>
                </div>

                {!isEditMode && (
                  <div className="border-t pt-4 space-y-4">
                    <h3 className="text-lg font-semibold">Yangi parol o'rnatish</h3>
                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="username">
                          Foydalanuvchi nomi <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="username"
                          value={formData.username}
                          onChange={(e) => handleChange('username', e.target.value)}
                          placeholder="Foydalanuvchi nomini kiriting"
                          disabled={loading}
                        />
                        {errors.username && (
                          <p className="text-sm text-destructive">{errors.username}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="password">
                          Parol <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative">
                          <Input
                            id="password"
                            type={showPassword ? 'text' : 'password'}
                            value={formData.password}
                            onChange={(e) => handleChange('password', e.target.value)}
                            placeholder="Parolni kiriting"
                            disabled={loading}
                            className="pr-10"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                        </div>
                        {errors.password && (
                          <p className="text-sm text-destructive">{errors.password}</p>
                        )}
                        <p className="text-xs text-muted-foreground">Kamida 6 ta belgi</p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="confirmPassword">
                          Parolni tasdiqlash <span className="text-destructive">*</span>
                        </Label>
                        <div className="relative">
                          <Input
                            id="confirmPassword"
                            type={showConfirmPassword ? 'text' : 'password'}
                            value={formData.confirmPassword}
                            onChange={(e) => handleChange('confirmPassword', e.target.value)}
                            placeholder="Parolni tasdiqlang"
                            disabled={loading}
                            className="pr-10"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          >
                            {showConfirmPassword ? (
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                        </div>
                        {errors.confirmPassword && (
                          <p className="text-sm text-destructive">{errors.confirmPassword}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between border-t pt-4">
                  <div className="space-y-1">
                    <Label htmlFor="is_active">Hisob holati</Label>
                    <p className="text-sm text-muted-foreground">
                      {formData.is_active ? 'Hisob faol' : 'Hisob o\'chirilgan'}
                    </p>
                  </div>
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => handleChange('is_active', checked)}
                    disabled={loading}
                  />
                </div>
              </TabsContent>

              <TabsContent value="permissions" className="space-y-4">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium mb-2">Kirish huquqlari</h3>
                    <p className="text-sm text-muted-foreground">
                      Ushbu xodim tizimda qanday resurslarga kirish va nimalar qilish huquqiga ega ekanligini sozlang
                    </p>
                  </div>
                  {MODULES.map((module) => (
                    <div key={module} className="space-y-3 rounded-lg border p-4">
                      <div className="flex items-center justify-between">
                        <Label className="text-base font-semibold">
                          {MODULE_LABELS[module]}
                        </Label>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id={`module-${module}`}
                            checked={
                              permissions[module]?.view &&
                              permissions[module]?.add &&
                              permissions[module]?.edit &&
                              permissions[module]?.delete
                            }
                            onCheckedChange={(checked) =>
                              handleModuleToggle(module, checked as boolean)
                            }
                          />
                          <Label htmlFor={`module-${module}`} className="text-sm">
                            Hammasini tanlash
                          </Label>
                        </div>
                      </div>
                      <div className="ml-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
                        {ACTIONS.filter(
                          (action) =>
                            action !== 'change_price' || module === 'products'
                        ).map((action) => (
                          <div key={action} className="flex items-center space-x-2">
                            <Checkbox
                              id={`${module}-${action}`}
                              checked={permissions[module]?.[action] || false}
                              onCheckedChange={(checked) =>
                                handlePermissionChange(module, action, checked as boolean)
                              }
                            />
                            <Label
                              htmlFor={`${module}-${action}`}
                              className="text-sm font-normal cursor-pointer"
                            >
                              {ACTION_LABELS[action]}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Bekor qilish
              </Button>
              <Button type="submit" disabled={loading}>
                <Save className="mr-2 h-4 w-4" />
                {loading ? 'Saqlanmoqda...' : isEditMode ? 'Xodimni yangilash' : 'Xodim yaratish'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Admin Confirmation Dialog */}
      <Dialog open={showAdminConfirm} onOpenChange={setShowAdminConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Administrator lavozimini tasdiqlash</DialogTitle>
            <DialogDescription>
              Siz ushbu xodimga Administrator lavozimini berishga tayyormisiz. Administratorlar quyidagilarni o'z ichiga olgan barcha tizim funksiyalariga to'liq kirish huquqiga ega:
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Xodimlarni yaratish va boshqarish</li>
                <li>Barcha moliyaviy hisobotlarni ko'rish</li>
                <li>Tizim sozlamalarini o'zgartirish</li>
                <li>Barcha ma'lumotlarga to'liq kirish</li>
              </ul>
              <p className="mt-3 font-semibold">Davom etishni xohlaysizmi?</p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdminConfirm(false)}>
              Bekor qilish
            </Button>
            <Button onClick={handleSubmit}>Tasdiqlash</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}




