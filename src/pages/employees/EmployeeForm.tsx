import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { ArrowLeft, Save } from 'lucide-react';
import { createEmployee, updateEmployee, getEmployeeById } from '@/db/api';
import type { Profile, UserRole } from '@/types/database';
import { useToast } from '@/hooks/use-toast';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';

export default function EmployeeForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { toast } = useToast();
  const isEditMode = Boolean(id);

  const [loading, setLoading] = useState(false);
  const [showAdminConfirm, setShowAdminConfirm] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    full_name: '',
    phone: '',
    email: '',
    role: 'cashier' as UserRole,
    is_active: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isEditMode && id) {
      loadEmployee(id);
    }
  }, [id, isEditMode]);

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
          role: employee.role,
          is_active: employee.is_active,
        });
      }
    } catch (error) {
      console.error('Error loading employee:', error);
      toast({
        title: 'Error',
        description: 'Failed to load employee data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.full_name.trim()) {
      newErrors.full_name = 'Full name is required';
    }

    if (!isEditMode) {
      if (!formData.username.trim()) {
        newErrors.username = 'Username is required';
      } else if (formData.username.length < 3) {
        newErrors.username = 'Username must be at least 3 characters';
      }

      if (!formData.password) {
        newErrors.password = 'Password is required';
      } else if (formData.password.length < 6) {
        newErrors.password = 'Password must be at least 6 characters';
      }

      if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
    }

    if (formData.phone && !formData.phone.match(/^\+998\d{9}$/)) {
      newErrors.phone = 'Phone must be in format +998XXXXXXXXX';
    }

    if (formData.email && !formData.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      newErrors.email = 'Invalid email format';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // Show confirmation dialog if changing role to admin
    if (formData.role === 'admin' && !showAdminConfirm) {
      setShowAdminConfirm(true);
      return;
    }

    try {
      setLoading(true);

      if (isEditMode && id) {
        await updateEmployee(id, {
          full_name: formData.full_name,
          phone: formData.phone || null,
          email: formData.email || null,
          role: formData.role,
          is_active: formData.is_active,
        } as Partial<Profile>);

        toast({
          title: 'Success',
          description: 'Employee updated successfully',
        });
      } else {
        await createEmployee({
          username: formData.username,
          password: formData.password,
          full_name: formData.full_name,
          phone: formData.phone || undefined,
          email: formData.email || undefined,
          role: formData.role,
          is_active: formData.is_active,
        });

        toast({
          title: 'Success',
          description: 'Employee created successfully',
        });
      }

      navigate('/employees');
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
    <div className="space-y-6">
      <PageBreadcrumb
        items={[
          { label: 'Dashboard', href: '/' },
          { label: 'Employees', href: '/employees' },
          { label: isEditMode ? 'Edit Employee' : 'Add Employee', href: '#' },
        ]}
      />

      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/employees')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{isEditMode ? 'Edit Employee' : 'Add Employee'}</h1>
          <p className="text-muted-foreground">
            {isEditMode ? 'Update employee information' : 'Create a new employee account'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Employee Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="full_name">
                  Full Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="full_name"
                  value={formData.full_name}
                  onChange={(e) => handleChange('full_name', e.target.value)}
                  placeholder="Enter full name"
                  disabled={loading}
                />
                {errors.full_name && (
                  <p className="text-sm text-destructive">{errors.full_name}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">
                  Role <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={formData.role}
                  onValueChange={(value) => handleChange('role', value)}
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cashier">Cashier</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  placeholder="+998XXXXXXXXX"
                  disabled={loading}
                />
                {errors.phone && <p className="text-sm text-destructive">{errors.phone}</p>}
                <p className="text-xs text-muted-foreground">Format: +998XXXXXXXXX</p>
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
              <>
                <div className="border-t pt-6">
                  <h3 className="mb-4 text-lg font-semibold">Login Credentials</h3>
                  <div className="grid gap-6 xl:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="username">
                        Username <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="username"
                        value={formData.username}
                        onChange={(e) => handleChange('username', e.target.value)}
                        placeholder="Enter username"
                        disabled={loading}
                      />
                      {errors.username && (
                        <p className="text-sm text-destructive">{errors.username}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="password">
                        Password <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        value={formData.password}
                        onChange={(e) => handleChange('password', e.target.value)}
                        placeholder="Enter password"
                        disabled={loading}
                      />
                      {errors.password && (
                        <p className="text-sm text-destructive">{errors.password}</p>
                      )}
                      <p className="text-xs text-muted-foreground">Minimum 6 characters</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">
                        Confirm Password <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        value={formData.confirmPassword}
                        onChange={(e) => handleChange('confirmPassword', e.target.value)}
                        placeholder="Confirm password"
                        disabled={loading}
                      />
                      {errors.confirmPassword && (
                        <p className="text-sm text-destructive">{errors.confirmPassword}</p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="flex items-center justify-between border-t pt-6">
              <div className="space-y-1">
                <Label htmlFor="is_active">Account Status</Label>
                <p className="text-sm text-muted-foreground">
                  {formData.is_active ? 'Account is active' : 'Account is disabled'}
                </p>
              </div>
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => handleChange('is_active', checked)}
                disabled={loading}
              />
            </div>

            <div className="flex justify-end gap-3 border-t pt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/employees')}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                <Save className="mr-2 h-4 w-4" />
                {loading ? 'Saving...' : isEditMode ? 'Update Employee' : 'Create Employee'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <Dialog open={showAdminConfirm} onOpenChange={setShowAdminConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Admin Role</DialogTitle>
            <DialogDescription>
              You are about to assign the Admin role to this employee. Admins have full access to
              all system features including:
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>Creating and managing employees</li>
                <li>Viewing all financial reports</li>
                <li>Changing system settings</li>
                <li>Full access to all data</li>
              </ul>
              <p className="mt-3 font-semibold">Are you sure you want to proceed?</p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdminConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
