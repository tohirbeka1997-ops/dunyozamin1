import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getPromotionById, createPromotion, updatePromotion, getCategories, getProducts, searchProductsScreen } from '@/db/api';
import type { PromotionType, PromotionStatus, Category, Product } from '@/types/database';
import { ArrowLeft, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';
import MoneyInput from '@/components/common/MoneyInput';
import { formatPromotionDbError } from '@/utils/promotionErrors';

const TYPES: { value: PromotionType; label: string }[] = [
  { value: 'percent_discount', label: 'Foizli chegirma' },
  { value: 'amount_discount', label: 'Summali chegirma' },
  { value: 'fixed_price', label: 'Fixed narx' },
];

const STATUSES: { value: PromotionStatus; label: string }[] = [
  { value: 'draft', label: 'Qoralama' },
  { value: 'scheduled', label: 'Rejalashtirilgan' },
  { value: 'active', label: 'Faol' },
  { value: 'paused', label: "To'xtatilgan" },
];

export default function PromotionForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isEdit = !!id;

  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [productSearchResults, setProductSearchResults] = useState<Product[]>([]);

  const [form, setForm] = useState({
    name: '',
    code: '',
    description: '',
    type: 'percent_discount' as PromotionType,
    status: 'draft' as PromotionStatus,
    start_at: '',
    end_at: '',
    priority: 0,
    combinable: false,
    scope_type: 'all' as 'all' | 'products' | 'categories',
    scope_ids: [] as string[],
    min_qty: '' as string | number,
    min_amount: '' as string | number,
    promo_code: '',
    discount_percent: '' as string | number,
    discount_amount: '' as string | number,
    fixed_price: '' as string | number,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [cats, prods] = await Promise.all([getCategories(), getProducts(false, { limit: 2000 })]);
        setCategories(cats);
        setProducts(prods);
      } catch (e) {
        console.error(e);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (form.scope_type !== 'products') return;
    const term = String(productSearchTerm || '').trim();
    if (!term) {
      setProductSearchResults(products.slice(0, 100));
      return;
    }
    let cancelled = false;
    const search = async () => {
      try {
        const results = await searchProductsScreen(term);
        if (!cancelled) setProductSearchResults(results.slice(0, 100));
      } catch {
        if (!cancelled) setProductSearchResults(products.filter((p) => p.name.toLowerCase().includes(term.toLowerCase())).slice(0, 100));
      }
    };
    search();
    return () => { cancelled = true; };
  }, [form.scope_type, productSearchTerm, products]);

  const productsToShow = form.scope_type === 'products' ? productSearchResults : products;

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        setLoading(true);
        const p = await getPromotionById(id);
        if (!p) {
          toast({ title: 'Aksiya topilmadi', variant: 'destructive' });
          navigate('/promotions');
          return;
        }
        const scopeIds = p.scope?.scope_ids ? JSON.parse(p.scope.scope_ids || '[]') : [];
        setForm({
          name: p.name,
          code: p.code || '',
          description: p.description || '',
          type: p.type as PromotionType,
          status: p.status as PromotionStatus,
          start_at: p.start_at.slice(0, 10),
          end_at: p.end_at.slice(0, 10),
          priority: p.priority,
          combinable: !!p.combinable,
          scope_type: (p.scope?.scope_type as 'all' | 'products' | 'categories') || 'all',
          scope_ids: Array.isArray(scopeIds) ? scopeIds : [],
          min_qty: p.condition?.min_qty ?? '',
          min_amount: p.condition?.min_amount ?? '',
          promo_code: p.condition?.promo_code || '',
          discount_percent: p.reward?.discount_percent ?? '',
          discount_amount: p.reward?.discount_amount ?? '',
          fixed_price: p.reward?.fixed_price ?? '',
        });
      } catch (e) {
        toast({
          title: 'Yuklash xatosi',
          description: formatPromotionDbError((e as Error).message),
          variant: 'destructive',
        });
        navigate('/promotions');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const today = new Date().toISOString().slice(0, 10);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: 'Nomi kiritilishi shart', variant: 'destructive' });
      return;
    }
    if (!form.start_at || !form.end_at) {
      toast({ title: 'Boshlanish va tugash sanasi kiritilishi shart', variant: 'destructive' });
      return;
    }
    if (new Date(form.start_at) > new Date(form.end_at)) {
      toast({ title: 'Tugash sanasi boshlanish sanasidan keyin bo\'lishi kerak', variant: 'destructive' });
      return;
    }

    const reward: any = {};
    if (form.type === 'percent_discount') reward.discount_percent = Number(form.discount_percent) || 0;
    else if (form.type === 'amount_discount') reward.discount_amount = Number(form.discount_amount) || 0;
    else if (form.type === 'fixed_price') reward.fixed_price = Number(form.fixed_price) || 0;

    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      description: form.description.trim() || null,
      type: form.type,
      status: form.status,
      start_at: form.start_at + 'T00:00:00.000Z',
      end_at: form.end_at + 'T23:59:59.999Z',
      priority: Number(form.priority) || 0,
      combinable: form.combinable,
      scope: {
        scope_type: form.scope_type,
        scope_ids: JSON.stringify(form.scope_ids || []),
      },
      condition: {
        min_qty: form.min_qty !== '' ? Number(form.min_qty) : null,
        min_amount: form.min_amount !== '' ? Number(form.min_amount) : null,
        promo_code: form.promo_code.trim() || null,
      },
      reward,
    };

    try {
      setLoading(true);
      if (isEdit) {
        await updatePromotion(id!, { ...payload, id });
        toast({ title: 'Aksiya yangilandi' });
      } else {
        await createPromotion(payload);
        toast({ title: 'Aksiya yaratildi' });
      }
      navigate('/promotions');
    } catch (err) {
      toast({
        title: 'Saqlash amalga oshmadi',
        description: formatPromotionDbError((err as Error).message),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleScopeId = (scopeType: 'products' | 'categories', scopeId: string) => {
    const list = scopeType === 'categories' ? categories : products;
    const key = scopeType === 'categories' ? 'id' : 'id';
    const ids = form.scope_ids.filter((x) => list.some((l: any) => l[key] === x));
    const idx = ids.indexOf(scopeId);
    if (idx >= 0) ids.splice(idx, 1);
    else ids.push(scopeId);
    setForm((f) => ({ ...f, scope_ids: ids }));
  };

  if (loading && isEdit) {
    return <div className="p-6">Yuklanmoqda...</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <PageBreadcrumb
        items={[
          { label: 'Aksiyalar', href: '/promotions' },
          { label: isEdit ? 'Tahrirlash' : 'Yangi aksiya', href: '#' },
        ]}
      />
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={() => navigate('/promotions')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Orqaga
          </Button>
          <Button type="submit" disabled={loading}>
            <Save className="h-4 w-4 mr-2" />
            Saqlash
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Asosiy ma'lumotlar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nomi *</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Aksiya nomi" />
              </div>
              <div className="space-y-2">
                <Label>Ichki kod</Label>
                <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="PROMO-001" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Tavsif</Label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Turi</Label>
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as PromotionType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as PromotionStatus }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Boshlanish sanasi *</Label>
                <Input type="date" value={form.start_at} onChange={(e) => setForm((f) => ({ ...f, start_at: e.target.value }))} min={today} />
              </div>
              <div className="space-y-2">
                <Label>Tugash sanasi *</Label>
                <Input type="date" value={form.end_at} onChange={(e) => setForm((f) => ({ ...f, end_at: e.target.value }))} min={form.start_at || today} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Prioritet</Label>
                <Input type="number" min={0} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) || 0 }))} />
              </div>
              <div className="flex items-center space-x-2 pt-8">
                <Checkbox id="combinable" checked={form.combinable} onCheckedChange={(c) => setForm((f) => ({ ...f, combinable: !!c }))} />
                <Label htmlFor="combinable">Boshqa aksiyalar bilan birga qo'llash mumkin</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Qamrov</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Qamrov turi</Label>
              <Select value={form.scope_type} onValueChange={(v) => { setForm((f) => ({ ...f, scope_type: v as any, scope_ids: [] })); setProductSearchTerm(''); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha mahsulotlar</SelectItem>
                  <SelectItem value="categories">Kategoriyalar bo'yicha</SelectItem>
                  <SelectItem value="products">Mahsulotlar bo'yicha</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.scope_type === 'categories' && (
              <div className="space-y-2">
                <Label>Kategoriyalar</Label>
                <div className="border rounded-md p-3 max-h-40 overflow-y-auto space-y-2">
                  {categories.map((c) => (
                    <div key={c.id} className="flex items-center space-x-2">
                      <Checkbox
                        checked={form.scope_ids.includes(c.id)}
                        onCheckedChange={() => toggleScopeId('categories', c.id)}
                      />
                      <Label className="font-normal">{c.name}</Label>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {form.scope_type === 'products' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Mahsulotlar</Label>
                  <span className="text-sm text-muted-foreground">
                    Tanlangan: {form.scope_ids.length} ta
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Faqat tanlangan mahsulotlarga aksiya qo&apos;llanadi
                </p>
                <Input
                  placeholder="Mahsulot qidirish (nom, SKU, barkod)..."
                  value={productSearchTerm}
                  onChange={(e) => setProductSearchTerm(e.target.value)}
                  className="mb-2"
                />
                <div className="border rounded-md p-3 max-h-48 overflow-y-auto space-y-2">
                  {productsToShow.map((p) => (
                    <div key={p.id} className="flex items-center space-x-2">
                      <Checkbox
                        checked={form.scope_ids.includes(p.id)}
                        onCheckedChange={() => toggleScopeId('products', p.id)}
                      />
                      <Label className="font-normal">{p.name} ({p.sku})</Label>
                    </div>
                  ))}
                  {productsToShow.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {productSearchTerm ? 'Mahsulot topilmadi' : 'Qidiruvni boshlang'}
                    </p>
                  )}
                  {productsToShow.length >= 100 && <p className="text-sm text-muted-foreground">Faqat birinchi 100 ta ko'rsatilmoqda</p>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shartlar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Minimal miqdor</Label>
                <Input type="number" min={0} step={0.01} value={form.min_qty} onChange={(e) => setForm((f) => ({ ...f, min_qty: e.target.value }))} placeholder="Bo'sh = cheklov yo'q" />
              </div>
              <div className="space-y-2">
                <Label>Minimal chek summasi (so'm)</Label>
                <MoneyInput
                  value={form.min_amount === '' ? null : Number(form.min_amount)}
                  onValueChange={(v) => setForm((f) => ({ ...f, min_amount: v ?? '' }))}
                  placeholder="Bo'sh = cheklov yo'q"
                />
              </div>
              <div className="space-y-2">
                <Label>Promo kod</Label>
                <Input value={form.promo_code} onChange={(e) => setForm((f) => ({ ...f, promo_code: e.target.value }))} placeholder="Bo'sh = kerak emas" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Natija</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {form.type === 'percent_discount' && (
              <div className="space-y-2">
                <Label>Chegirma foizi (%)</Label>
                <Input type="number" min={0} max={100} step={0.1} value={form.discount_percent} onChange={(e) => setForm((f) => ({ ...f, discount_percent: e.target.value }))} />
              </div>
            )}
            {form.type === 'amount_discount' && (
              <div className="space-y-2">
                <Label>Chegirma summasi (so'm)</Label>
                <p className="text-xs text-muted-foreground">
                  Har bir birlik uchun chegirma (masalan: 5000 so&apos;m = 2 dona uchun 10 000 so&apos;m chegirma)
                </p>
                <MoneyInput
                  value={form.discount_amount === '' ? null : Number(form.discount_amount)}
                  onValueChange={(v) => setForm((f) => ({ ...f, discount_amount: v ?? '' }))}
                />
              </div>
            )}
            {form.type === 'fixed_price' && (
              <div className="space-y-2">
                <Label>Aksiya narxi (so'm)</Label>
                <p className="text-xs text-muted-foreground">
                  Har bir birlik uchun belgilangan narx (masalan: 15 000 so&apos;m)
                </p>
                <MoneyInput
                  value={form.fixed_price === '' ? null : Number(form.fixed_price)}
                  onValueChange={(v) => setForm((f) => ({ ...f, fixed_price: v ?? '' }))}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={loading}>
            <Save className="h-4 w-4 mr-2" />
            Saqlash
          </Button>
        </div>
      </form>
    </div>
  );
}
