import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ArrowDown, ArrowUp, Copy, Save, Trash2 } from 'lucide-react';
import { getSettingsByCategory, bulkUpdateSettings } from '@/db/api';
import type { CompanySettings, OrderWithDetails, ReceiptTemplate, ReceiptTemplateStore } from '@/types/database';
import {
  ensureReceiptTemplates,
  saveReceiptTemplateStoreToLocalStorage,
  loadReceiptTemplateStoreFromLocalStorage,
} from '@/lib/receipts/templateStore';
import ReceiptTemplateView from '@/components/print/ReceiptTemplateView';

const SECTION_LABELS: Record<string, string> = {
  header: 'Header (Do‘kon ma’lumoti)',
  orderInfo: 'Order info',
  products: 'Products list',
  totals: 'Totals',
  payments: 'Payments',
  footer: 'Footer',
  barcode: 'Barcode / QR',
};

const makeId = () => `rtpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function cloneTemplate(template: ReceiptTemplate): ReceiptTemplate {
  return {
    ...template,
    id: makeId(),
    name: `${template.name} (copy)`,
    updatedAt: new Date().toISOString(),
  };
}

const mockOrder: OrderWithDetails = {
  id: 'order-mock',
  order_number: 'ORD-000123',
  created_at: new Date().toISOString(),
  subtotal: 120000,
  discount_amount: 5000,
  tax_amount: 0,
  total_amount: 115000,
  change_amount: 0,
  credit_amount: 0,
  customer_id: null,
  cashier_id: null,
  warehouse_id: null,
  status: 'completed',
  payment_status: 'paid',
  payment_method: 'cash',
  created_by: null,
  updated_by: null,
  shift_id: null,
  customer: { id: 'cust-1', name: 'Mijoz' } as any,
  cashier: { id: 'cash-1', username: 'kassir', full_name: 'Kassir' } as any,
  items: [
    {
      id: 'item-1',
      product_name: 'Mahsulot A',
      unit_price: 25000,
      quantity: 2,
      total: 50000,
      product: { sku: 'SKU-001', unit: 'pcs' },
    },
    {
      id: 'item-2',
      product_name: 'Mahsulot B juda uzun nomli bo‘lishi mumkin',
      unit_price: 70000,
      quantity: 1,
      total: 70000,
      product: { sku: 'SKU-002', unit: 'pcs' },
    },
  ] as any,
  payments: [{ payment_method: 'cash', amount: 115000 }] as any,
} as OrderWithDetails;

export default function ReceiptDesignerPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [store, setStore] = useState<ReceiptTemplateStore>({ templates: [], active_id: undefined });
  const [selectedId, setSelectedId] = useState<string>('');

  const selectedTemplate = useMemo(
    () => store.templates.find((t) => t.id === selectedId) || store.templates[0] || null,
    [store.templates, selectedId]
  );

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [company, receiptTemplates] = await Promise.all([
          getSettingsByCategory('company'),
          getSettingsByCategory('receipt_templates'),
        ]);
        if (cancelled) return;
        const ensured = ensureReceiptTemplates(
          (receiptTemplates as ReceiptTemplateStore) || loadReceiptTemplateStoreFromLocalStorage()
        );
        setCompanySettings(company as CompanySettings);
        setStore(ensured);
        setSelectedId(ensured.active_id || ensured.templates[0]?.id || '');

        if ((receiptTemplates as any)?.templates?.length !== ensured.templates.length) {
          await bulkUpdateSettings('receipt_templates', {
            templates: ensured.templates,
            active_id: ensured.active_id,
          }, user?.id || '');
          saveReceiptTemplateStoreToLocalStorage(ensured);
        }
      } catch (e) {
        toast({
          title: 'Xatolik',
          description: 'Receipt template sozlamalarini yuklab bo‘lmadi',
          variant: 'destructive',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast, user]);

  const updateSelectedTemplate = (patch: Partial<ReceiptTemplate>) => {
    if (!selectedTemplate) return;
    setStore((prev) => ({
      ...prev,
      templates: prev.templates.map((t) =>
        t.id === selectedTemplate.id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t
      ),
    }));
  };

  const updateSection = (key: keyof ReceiptTemplate['sections'], patch: any) => {
    if (!selectedTemplate) return;
    updateSelectedTemplate({
      sections: {
        ...selectedTemplate.sections,
        [key]: {
          ...(selectedTemplate.sections as any)[key],
          ...patch,
        },
      },
    });
  };

  const handleMoveSection = (key: string, dir: -1 | 1) => {
    if (!selectedTemplate) return;
    const order = [...selectedTemplate.sectionsOrder];
    const idx = order.indexOf(key as any);
    const nextIdx = idx + dir;
    if (idx < 0 || nextIdx < 0 || nextIdx >= order.length) return;
    const next = [...order];
    const [item] = next.splice(idx, 1);
    next.splice(nextIdx, 0, item);
    updateSelectedTemplate({ sectionsOrder: next });
  };

  const handleSave = async () => {
    if (!user?.id) return;
    try {
      await bulkUpdateSettings(
        'receipt_templates',
        { templates: store.templates, active_id: store.active_id },
        user.id
      );
      saveReceiptTemplateStoreToLocalStorage(store);
      toast({ title: 'Saqlandi', description: 'Receipt template sozlamalari yangilandi' });
    } catch (e) {
      toast({
        title: 'Xatolik',
        description: 'Receipt template saqlanmadi',
        variant: 'destructive',
      });
    }
  };

  const handleSetActive = () => {
    if (!selectedTemplate) return;
    setStore((prev) => ({ ...prev, active_id: selectedTemplate.id }));
  };

  const handleDuplicate = () => {
    if (!selectedTemplate) return;
    const copy = cloneTemplate(selectedTemplate);
    setStore((prev) => ({ ...prev, templates: [...prev.templates, copy] }));
    setSelectedId(copy.id);
  };

  const handleDelete = () => {
    if (!selectedTemplate) return;
    if (store.templates.length <= 1) return;
    const filtered = store.templates.filter((t) => t.id !== selectedTemplate.id);
    setStore((prev) => ({
      ...prev,
      templates: filtered,
      active_id: prev.active_id === selectedTemplate.id ? filtered[0]?.id : prev.active_id,
    }));
    setSelectedId(filtered[0]?.id || '');
  };

  if (!user || user.role !== 'admin') {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Chek Designer</CardTitle>
            <CardDescription>Bu bo‘lim faqat admin uchun</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (loading || !selectedTemplate) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-muted-foreground">Yuklanmoqda...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Receipt Designer (Pro)</h1>
        <p className="text-muted-foreground mt-2">Chek shablonlari va real-time preview.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Sozlamalar</CardTitle>
            <CardDescription>Template, bo‘limlar va format</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {store.templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={handleDuplicate}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDelete}
                  disabled={store.templates.length <= 1}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
                <Button variant="secondary" size="sm" onClick={handleSetActive}>
                  Active
                </Button>
              </div>
              <div className="flex items-center gap-2 pt-1">
                {store.active_id === selectedTemplate.id && <Badge>Active</Badge>}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Template nomi</Label>
              <Input
                value={selectedTemplate.name}
                onChange={(e) => updateSelectedTemplate({ name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Qog‘oz kengligi</Label>
              <Select
                value={String(selectedTemplate.paperWidth)}
                onValueChange={(value) => updateSelectedTemplate({ paperWidth: Number(value) as 58 | 80 })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="58">58mm</SelectItem>
                  <SelectItem value="80">80mm</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="text-sm font-semibold">Section order</div>
              {selectedTemplate.sectionsOrder.map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <div className="flex-1 text-sm">{SECTION_LABELS[key]}</div>
                  <Button variant="ghost" size="icon" onClick={() => handleMoveSection(key, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleMoveSection(key, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Header</Label>
                <Switch
                  checked={selectedTemplate.sections.header.enabled}
                  onCheckedChange={(checked) => updateSection('header', { enabled: checked })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Align</Label>
                  <Select
                    value={selectedTemplate.sections.header.align}
                    onValueChange={(value: 'left' | 'center') => updateSection('header', { align: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Chap</SelectItem>
                      <SelectItem value="center">Markaz</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Font size</Label>
                  <Input
                    type="number"
                    value={selectedTemplate.sections.header.fontSize}
                    onChange={(e) => updateSection('header', { fontSize: Number(e.target.value || 12) })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span>Bold</span>
                  <Switch
                    checked={selectedTemplate.sections.header.bold}
                    onCheckedChange={(checked) => updateSection('header', { bold: checked })}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>Logo</span>
                  <Switch
                    checked={selectedTemplate.sections.header.showLogo}
                    onCheckedChange={(checked) => updateSection('header', { showLogo: checked })}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>Do‘kon nomi</span>
                  <Switch
                    checked={selectedTemplate.sections.header.showStoreName}
                    onCheckedChange={(checked) => updateSection('header', { showStoreName: checked })}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>Filial</span>
                  <Switch
                    checked={selectedTemplate.sections.header.showBranchName}
                    onCheckedChange={(checked) => updateSection('header', { showBranchName: checked })}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>Manzil</span>
                  <Switch
                    checked={selectedTemplate.sections.header.showAddress}
                    onCheckedChange={(checked) => updateSection('header', { showAddress: checked })}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>Telefon</span>
                  <Switch
                    checked={selectedTemplate.sections.header.showPhone}
                    onCheckedChange={(checked) => updateSection('header', { showPhone: checked })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Filial nomi (ixtiyoriy)</Label>
                <Input
                  value={selectedTemplate.sections.header.branchName || ''}
                  onChange={(e) => updateSection('header', { branchName: e.target.value })}
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Order info</Label>
                <Switch
                  checked={selectedTemplate.sections.orderInfo.enabled}
                  onCheckedChange={(checked) => updateSection('orderInfo', { enabled: checked })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Layout</Label>
                  <Select
                    value={selectedTemplate.sections.orderInfo.layout}
                    onValueChange={(value: 'single' | 'two-column') => updateSection('orderInfo', { layout: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">1 qator</SelectItem>
                      <SelectItem value="two-column">2 ustun</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sana formati</Label>
                  <Input
                    value={selectedTemplate.sections.orderInfo.dateFormat}
                    onChange={(e) => updateSection('orderInfo', { dateFormat: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span>Kassir</span>
                  <Switch
                    checked={selectedTemplate.sections.orderInfo.showCashier}
                    onCheckedChange={(checked) => updateSection('orderInfo', { showCashier: checked })}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>Mijoz</span>
                  <Switch
                    checked={selectedTemplate.sections.orderInfo.showCustomer}
                    onCheckedChange={(checked) => updateSection('orderInfo', { showCustomer: checked })}
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Products list</Label>
                <Switch checked disabled />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span>SKU</span>
                  <Switch
                    checked={selectedTemplate.sections.products.showSku}
                    onCheckedChange={(checked) => updateSection('products', { showSku: checked })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Wrap</Label>
                  <Select
                    value={selectedTemplate.sections.products.wrapMode}
                    onValueChange={(value: 'wrap' | 'truncate') => updateSection('products', { wrapMode: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wrap">Wrap</SelectItem>
                      <SelectItem value="truncate">Truncate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Qator oralig‘i</Label>
                <Input
                  type="number"
                  value={selectedTemplate.sections.products.lineSpacing}
                  onChange={(e) => updateSection('products', { lineSpacing: Number(e.target.value || 1) })}
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Totals</Label>
                <Switch
                  checked={selectedTemplate.sections.totals.enabled}
                  onCheckedChange={(checked) => updateSection('totals', { enabled: checked })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center justify-between">
                  <span>Subtotal</span>
                  <Switch
                    checked={selectedTemplate.sections.totals.showSubtotal}
                    onCheckedChange={(checked) => updateSection('totals', { showSubtotal: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Chegirma</span>
                  <Switch
                    checked={selectedTemplate.sections.totals.showDiscount}
                    onCheckedChange={(checked) => updateSection('totals', { showDiscount: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Soliq</span>
                  <Switch
                    checked={selectedTemplate.sections.totals.showTax}
                    onCheckedChange={(checked) => updateSection('totals', { showTax: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Bold total</span>
                  <Switch
                    checked={selectedTemplate.sections.totals.boldTotal}
                    onCheckedChange={(checked) => updateSection('totals', { boldTotal: checked })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Kattaroq JAMI</span>
                  <Switch
                    checked={selectedTemplate.sections.totals.largerTotal}
                    onCheckedChange={(checked) => updateSection('totals', { largerTotal: checked })}
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Payments</Label>
                <Switch
                  checked={selectedTemplate.sections.payments.enabled}
                  onCheckedChange={(checked) => updateSection('payments', { enabled: checked })}
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Footer</Label>
                <Switch
                  checked={selectedTemplate.sections.footer.enabled}
                  onCheckedChange={(checked) => updateSection('footer', { enabled: checked })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Matn</Label>
                <Input
                  value={selectedTemplate.sections.footer.text}
                  onChange={(e) => updateSection('footer', { text: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Align</Label>
                  <Select
                    value={selectedTemplate.sections.footer.align}
                    onValueChange={(value: 'left' | 'center') => updateSection('footer', { align: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Chap</SelectItem>
                      <SelectItem value="center">Markaz</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Font size</Label>
                  <Input
                    type="number"
                    value={selectedTemplate.sections.footer.fontSize}
                    onChange={(e) => updateSection('footer', { fontSize: Number(e.target.value || 12) })}
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Barcode / QR</Label>
                <Switch
                  checked={selectedTemplate.sections.barcode.enabled}
                  onCheckedChange={(checked) => updateSection('barcode', { enabled: checked })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select
                    value={selectedTemplate.sections.barcode.type}
                    onValueChange={(value: 'order_id' | 'qr') => updateSection('barcode', { type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="order_id">Barcode</SelectItem>
                      <SelectItem value="qr">QR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Size</Label>
                  <Input
                    type="number"
                    value={selectedTemplate.sections.barcode.size}
                    onChange={(e) => updateSection('barcode', { size: Number(e.target.value || 100) })}
                  />
                </div>
              </div>
            </div>

            <Button onClick={handleSave} className="w-full">
              <Save className="h-4 w-4 mr-2" />
              Saqlash
            </Button>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardTitle>Chek preview</CardTitle>
            <CardDescription>Real-time ko‘rinish (printerga mos)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
              <span>Safe area: 2mm</span>
              <span>•</span>
              <span>Width: {selectedTemplate.paperWidth}mm</span>
            </div>
            <div className="relative p-4 bg-muted/40 rounded-lg overflow-auto">
              <div
                className="absolute border border-dashed border-primary/60 pointer-events-none"
                style={{
                  top: 8,
                  left: 8,
                  right: 8,
                  bottom: 8,
                }}
              />
              <div className="relative z-10">
                <ReceiptTemplateView
                  template={selectedTemplate}
                  order={mockOrder}
                  company={companySettings}
                  mode="preview"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
