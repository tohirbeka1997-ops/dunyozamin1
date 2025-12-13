import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getCustomerById, createCustomer, updateCustomer } from '@/db/api';
import type { Customer } from '@/types/database';
import { ArrowLeft, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function CustomerForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    type: 'individual' as 'individual' | 'company',
    company_name: '',
    tax_number: '',
    status: 'active' as 'active' | 'inactive',
    notes: '',
  });

  useEffect(() => {
    if (id) {
      loadCustomer();
    }
  }, [id]);

  const loadCustomer = async () => {
    if (!id) return;

    try {
      setLoading(true);
      const customer = await getCustomerById(id);
      setFormData({
        name: customer.name,
        phone: customer.phone || '',
        email: customer.email || '',
        address: customer.address || '',
        type: customer.type,
        company_name: customer.company_name || '',
        tax_number: customer.tax_number || '',
        status: customer.status,
        notes: customer.notes || '',
      });
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Mijozni yuklab bo\'lmadi',
        variant: 'destructive',
      });
      navigate('/customers');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!formData.name.trim()) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Mijoz ismi kiritilishi shart',
        variant: 'destructive',
      });
      return;
    }

    if (formData.type === 'company' && !formData.company_name.trim()) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Yuridik shaxs turi uchun kompaniya nomi kiritilishi shart',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSaving(true);

      if (id) {
        await updateCustomer(id, formData);
        toast({
          title: 'Muvaffaqiyatli',
          description: 'Mijoz muvaffaqiyatli yangilandi',
        });
      } else {
        await createCustomer(formData);
        toast({
          title: 'Muvaffaqiyatli',
          description: 'Mijoz muvaffaqiyatli yaratildi',
        });
      }

      navigate('/customers');
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Mijozni saqlab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/customers')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{id ? 'Mijozni tahrirlash' : 'Yangi mijoz qo\'shish'}</h1>
          <p className="text-muted-foreground">
            {id ? 'Mijoz ma\'lumotlarini yangilash' : 'Bazaga yangi mijoz qo\'shish'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Asosiy ma'lumotlar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">
                    To'liq ismi <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder="Mijoz ismini kiriting"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type">
                    Mijoz turi <span className="text-destructive">*</span>
                  </Label>
                  <Select value={formData.type} onValueChange={(value) => handleChange('type', value)}>
                    <SelectTrigger id="type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="individual">Jismoniy shaxs</SelectItem>
                      <SelectItem value="company">Yuridik shaxs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Telefon raqami</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    placeholder="+998 90 123 45 67"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    placeholder="customer@example.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">
                    Holati <span className="text-destructive">*</span>
                  </Label>
                  <Select value={formData.status} onValueChange={(value) => handleChange('status', value)}>
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Faol</SelectItem>
                      <SelectItem value="inactive">Faol emas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">Manzil</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => handleChange('address', e.target.value)}
                    placeholder="Manzilni kiriting"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {formData.type === 'company' && (
            <Card>
              <CardHeader>
                <CardTitle>Kompaniya ma'lumotlari</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="company_name">
                      Kompaniya nomi <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="company_name"
                      value={formData.company_name}
                      onChange={(e) => handleChange('company_name', e.target.value)}
                      placeholder="Kompaniya nomini kiriting"
                      required={formData.type === 'company'}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="tax_number">STIR / INN</Label>
                    <Input
                      id="tax_number"
                      value={formData.tax_number}
                      onChange={(e) => handleChange('tax_number', e.target.value)}
                      placeholder="STIR raqamini kiriting"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Qo'shimcha ma'lumotlar</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="notes">Izoh</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  placeholder="Bu mijoz haqida qo'shimcha izohlar qo'shing..."
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => navigate('/customers')}>
              Bekor qilish
            </Button>
            <Button type="submit" disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saqlanmoqda...' : id ? 'Yangilash' : 'Saqlash'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
