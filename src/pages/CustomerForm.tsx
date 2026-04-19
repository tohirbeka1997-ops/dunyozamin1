import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import { useAuth } from '@/contexts/AuthContext';
import { ArrowLeft, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { navigateBackTo, resolveBackTarget } from '@/lib/pageState';

export default function CustomerForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const fromParam = searchParams.get('from'); // 'pos' or null
  const backTo = resolveBackTarget(location, '/customers');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    type: 'individual' as 'individual' | 'company',
    pricing_tier: 'retail' as 'retail' | 'master',
    company_name: '',
    tax_number: '',
    status: 'active' as 'active' | 'inactive',
    notes: '',
    bonus_points: 0,
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
        pricing_tier: (customer as any).pricing_tier === 'master' ? 'master' : 'retail',
        company_name: customer.company_name || '',
        tax_number: customer.tax_number || '',
        status: customer.status,
        notes: customer.notes || '',
        bonus_points: Number((customer as Customer).bonus_points) || 0,
      });
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Mijozni yuklab bo\'lmadi',
        variant: 'destructive',
      });
      navigate(backTo);
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
        await updateCustomer(id, {
          name: formData.name,
          phone: formData.phone || null,
          email: formData.email || null,
          address: formData.address || null,
          type: formData.type,
          pricing_tier: formData.pricing_tier,
          company_name: formData.company_name || null,
          tax_number: formData.tax_number || null,
          status: formData.status,
          notes: formData.notes || null,
          ...(isAdmin ? { bonus_points: Math.max(0, Math.floor(Number(formData.bonus_points) || 0)) } : {}),
        });
        toast({
          title: 'Muvaffaqiyatli',
          description: 'Mijoz muvaffaqiyatli yangilandi',
        });
        navigate(backTo);
      } else {
        const newCustomer = await createCustomer({
          name: formData.name,
          phone: formData.phone || null,
          email: formData.email || null,
          address: formData.address || null,
          type: formData.type,
          pricing_tier: formData.pricing_tier,
          company_name: formData.company_name || null,
          tax_number: formData.tax_number || null,
          status: formData.status,
          notes: formData.notes || null,
          ...(isAdmin ? { bonus_points: Math.max(0, Math.floor(Number(formData.bonus_points) || 0)) } : {}),
        });
        toast({
          title: 'Muvaffaqiyatli',
          description: 'Mijoz muvaffaqiyatli yaratildi',
        });
        
        // If coming from POS, store customer ID and navigate back to POS
        if (fromParam === 'pos') {
          // Store customer ID in localStorage for POS to auto-select
          localStorage.setItem('pos:lastCreatedCustomerId', newCustomer.id);
          navigate('/pos');
        } else {
          // Otherwise navigate to customers list
          navigate(backTo);
        }
      }
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
        <Button variant="ghost" size="icon" onClick={() => navigateBackTo(navigate, location, '/customers')}>
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
                  <Label htmlFor="pricing_tier">Narx turi</Label>
                  <Select
                    value={formData.pricing_tier}
                    onValueChange={(value) => handleChange('pricing_tier', value)}
                  >
                    <SelectTrigger id="pricing_tier">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="retail">Oddiy mijoz</SelectItem>
                      <SelectItem value="master">Usta</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Usta bo‘lsa POS’da usta narxi avtomatik qo‘llanadi (min miqdor sharti bilan).
                  </p>
                </div>

                {(id || isAdmin) && (
                  <div className="space-y-2">
                    <Label htmlFor="bonus_points">Bonus ball</Label>
                    <Input
                      id="bonus_points"
                      type="number"
                      min={0}
                      step={1}
                      value={formData.bonus_points}
                      readOnly={!isAdmin}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          bonus_points: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {isAdmin
                        ? 'Sozlamalarda usta bonusi yoqilgan bo‘lsa, sotuvdan keyin ball avtomatik qo‘shiladi.'
                        : 'Faqat admin bonusni tahrirlashi mumkin.'}
                    </p>
                  </div>
                )}

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
            <Button
              type="button"
              variant="outline"
              onClick={() => navigateBackTo(navigate, location, '/customers')}
            >
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
