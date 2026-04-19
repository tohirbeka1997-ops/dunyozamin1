import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
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
import { useToast } from '@/hooks/use-toast';
import { getSupplierById, createSupplier, updateSupplier } from '@/db/api';
import type { Supplier } from '@/types/database';
import { ArrowLeft, Save } from 'lucide-react';
import { navigateBackTo, resolveBackTarget } from '@/lib/pageState';

export default function SupplierForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const isEditMode = !!id;
  const backTo = resolveBackTarget(location, '/suppliers');

  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [settlementCurrency, setSettlementCurrency] = useState<'UZS' | 'USD'>('USD');

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (id) {
      loadSupplier();
    }
  }, [id]);

  const loadSupplier = async () => {
    try {
      setLoading(true);
      const data = await getSupplierById(id!);
      setName(data.name);
      setContactPerson(data.contact_person || '');
      setPhone(data.phone || '');
      setEmail(data.email || '');
      setAddress(data.address || '');
      setNote(data.note || '');
      setStatus(data.status);
      setSettlementCurrency((data.settlement_currency || 'USD') as 'UZS' | 'USD');
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Yetkazib beruvchini yuklab bo‘lmadi',
        variant: 'destructive',
      });
      navigate(backTo);
    } finally {
      setLoading(false);
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Yetkazib beruvchi nomi majburiy';
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Email formati noto‘g‘ri';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      toast({
        title: 'Tekshiruv xatosi',
        description: 'Iltimos, formadagi xatolarni to‘g‘rilang',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);

      const supplierData: Omit<Supplier, 'id' | 'created_at' | 'updated_at'> = {
        name: name.trim(),
        contact_person: contactPerson.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        note: note.trim() || null,
        status,
        settlement_currency: settlementCurrency,
      };

      if (isEditMode && id) {
        await updateSupplier(id, supplierData);
        toast({
          title: 'Muvaffaqiyatli',
          description: 'Yetkazib beruvchi yangilandi',
        });
      } else {
        await createSupplier(supplierData);
        toast({
          title: 'Muvaffaqiyatli',
          description: 'Yetkazib beruvchi yaratildi',
        });
      }

      navigate(backTo);
    } catch (error: any) {
      toast({
        title: 'Xatolik',
        description: error.message || 'Yetkazib beruvchini saqlab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading && isEditMode) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigateBackTo(navigate, location, '/suppliers')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">
            {isEditMode ? 'Yetkazib beruvchini tahrirlash' : 'Yangi yetkazib beruvchi'}
          </h1>
          <p className="text-muted-foreground">
            {isEditMode
              ? 'Yetkazib beruvchi maʼlumotlarini yangilang'
              : 'Tizimga yangi yetkazib beruvchini qoʻshing'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Yetkazib beruvchi maʼlumotlari</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">
                      Yetkazib beruvchi nomi <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Yetkazib beruvchi nomini kiriting"
                      className={errors.name ? 'border-destructive' : ''}
                    />
                    {errors.name && (
                      <p className="text-sm text-destructive">{errors.name}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="contact-person">Masʼul shaxs</Label>
                    <Input
                      id="contact-person"
                      value={contactPerson}
                      onChange={(e) => setContactPerson(e.target.value)}
                      placeholder="Masʼul shaxs ism-sharifini kiriting"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefon</Label>
                    <Input
                      id="phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Telefon raqamini kiriting"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Email manzilini kiriting"
                      className={errors.email ? 'border-destructive' : ''}
                    />
                    {errors.email && (
                      <p className="text-sm text-destructive">{errors.email}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">Manzil</Label>
                  <Textarea
                    id="address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Yetkazib beruvchi manzilini kiriting"
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="note">Izoh</Label>
                  <Textarea
                    id="note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Qo‘shimcha izoh kiriting..."
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <Card>
              <CardHeader>
                <CardTitle>Holati</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="settlement_currency">Hisob valyutasi</Label>
                  <Select
                    value={settlementCurrency}
                    onValueChange={(value) => setSettlementCurrency(value as 'UZS' | 'USD')}
                  >
                    <SelectTrigger id="settlement_currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UZS">UZS (so‘m)</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    Supplier bilan qarz/to‘lovlar shu valyutada yuradi (MVP)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Yetkazib beruvchi holati</Label>
                  <Select value={status} onValueChange={(value) => setStatus(value as 'active' | 'inactive')}>
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Faol</SelectItem>
                      <SelectItem value="inactive">Nofaol</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    Faqat faol yetkazib beruvchilar xarid buyurtmasi formalarida ko‘rinadi
                  </p>
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  <Save className="h-4 w-4 mr-2" />
                  {loading ? 'Saqlanmoqda...' : isEditMode ? 'Yetkazib beruvchini yangilash' : 'Yetkazib beruvchini yaratish'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
