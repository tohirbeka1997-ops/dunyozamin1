import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import SearchableSupplierCombobox from '@/components/common/SearchableSupplierCombobox';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoney, normalizeCurrency } from '@/lib/currency';
import { uploadProductImage } from '@/lib/uploadProductImage';
import { invoiceUnitLabel, invoiceUnitsEquivalent } from '@/lib/purchase/invoiceUnits';
import {
  confirmInvoicePurchase,
  extractInvoiceDraft,
  getLatestExchangeRate,
  getSuppliers,
  searchProducts,
} from '@/db/api';
import type { SupplierWithBalance } from '@/types/database';
import { ArrowLeft, FileImage, Save } from 'lucide-react';

type DraftLine = {
  key: string;
  name: string;
  qty: string;
  unit: string;
  unit_price: string;
  barcode: string | null;
  sku: string | null;
  article: string | null;
  action: 'pending' | 'match' | 'create' | 'skip';
  product_id: string | null;
  product_name: string | null;
  product_sku: string | null;
  product_unit: string | null;
  match_kind: string | null;
  warehouse_qty: string;
  sale_price: string;
  candidates: Array<{ id: string; name: string; sku?: string | null; unit?: string | null; reason?: string }>;
};

type SearchHit = { id: string; name: string; sku?: string | null; unit?: string | null };

function moneyLabel(currency: 'UZS' | 'USD') {
  return currency === 'USD' ? 'USD' : "so'm";
}

function productUnitOf(product: { base_unit?: string | null; unit?: string | null } | null | undefined) {
  return String(product?.base_unit || product?.unit || 'pcs');
}

export default function PurchaseFromInvoice() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [rawAi, setRawAi] = useState<unknown>(null);
  const [currencyWarning, setCurrencyWarning] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState<Record<string, string>>({});
  const [hits, setHits] = useState<Record<string, SearchHit[]>>({});

  useEffect(() => {
    getSuppliers()
      .then((rows) => setSuppliers(Array.isArray(rows) ? rows : []))
      .catch((err) => {
        toast({
          title: 'Xatolik',
          description: err?.message || 'Yetkazib beruvchilar yuklanmadi',
          variant: 'destructive',
        });
      });
  }, [toast]);

  const supplier = suppliers.find((row) => row.id === supplierId) || null;
  const currency = normalizeCurrency((supplier as { settlement_currency?: string } | null)?.settlement_currency, 'UZS');

  useEffect(() => {
    if (currency !== 'USD') {
      setFxRate('');
      return;
    }
    getLatestExchangeRate({ base_currency: 'USD', quote_currency: 'UZS' })
      .then((row) => {
        const rate = Number(row?.rate);
        if (Number.isFinite(rate) && rate > 0) setFxRate(String(rate));
      })
      .catch(() => {});
  }, [currency, supplierId]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const blockers = useMemo(() => {
    const reasons: string[] = [];
    if (!supplierId) reasons.push('Yetkazib beruvchini tanlang');
    if (currency === 'USD' && !(Number(fxRate) > 0)) reasons.push('USD kursi kiritilmagan');
    if (!lines.length) reasons.push('Nakladnoy qatorlari yo‘q');
    const active = lines.filter((line) => line.action !== 'skip');
    if (lines.length && !active.length) reasons.push('Kamida bitta qatorni qabul qiling');
    for (const line of active) {
      if (line.action === 'pending') {
        reasons.push(`«${line.name}»: bog‘lang, yarating yoki o‘tkazib yuboring`);
      } else if (line.action === 'match' && !line.product_id) {
        reasons.push(`«${line.name}»: mahsulot tanlanmagan`);
      } else if (line.action === 'create' && !(Number(line.sale_price) > 0)) {
        reasons.push(`«${line.name}»: sotuv narxi kerak`);
      }
      if (line.action === 'match' && line.product_id && !invoiceUnitsEquivalent(line.unit, line.product_unit)) {
        if (!(Number(line.warehouse_qty) > 0)) {
          reasons.push(`«${line.name}»: ombor birligida miqdor kiriting`);
        }
      }
    }
    return reasons;
  }, [supplierId, currency, fxRate, lines]);

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const onFile = (next: File | null) => {
    setFile(next);
    setImageUrl(null);
    setLines([]);
    setRawAi(null);
    setExtractError(null);
    setDuplicateWarning(null);
    setCurrencyWarning(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next ? URL.createObjectURL(next) : null;
    });
  };

  const readInvoice = async () => {
    if (!supplierId) {
      toast({ title: 'Yetkazib beruvchi shart', variant: 'destructive' });
      return;
    }
    if (!file) {
      toast({ title: 'Bitta rasm yuklang', variant: 'destructive' });
      return;
    }
    setReading(true);
    setExtractError(null);
    try {
      const uploaded = imageUrl || (await uploadProductImage(file, `invoice-${Date.now()}`, 0));
      if (!uploaded) throw new Error('Rasm saqlanmadi');
      setImageUrl(uploaded);
      const draft = await extractInvoiceDraft({
        supplier_id: supplierId,
        image_url: uploaded,
        invoice_number: invoiceNumber || null,
      });
      const nextLines: DraftLine[] = (draft.lines || []).map((line: any, index: number) => ({
        key: `${index}-${line.name || 'line'}`,
        name: String(line.name || ''),
        qty: String(line.qty ?? ''),
        unit: String(line.unit || ''),
        unit_price: String(line.unit_price ?? ''),
        barcode: line.barcode || null,
        sku: line.sku || null,
        article: line.article || null,
        action: line.product_id ? 'match' : 'pending',
        product_id: line.product_id || null,
        product_name: line.product_name || null,
        product_sku: line.product_sku || null,
        product_unit: line.product_unit || null,
        match_kind: line.match_kind || null,
        warehouse_qty: '',
        sale_price: '',
        candidates: Array.isArray(line.candidates) ? line.candidates : [],
      }));
      setLines(nextLines);
      setRawAi(draft.raw_ai || null);
      if (draft.invoice_number && !invoiceNumber) setInvoiceNumber(String(draft.invoice_number));
      setCurrencyWarning(draft.currency_warning || null);
      const dups = Array.isArray(draft.duplicate_warning) ? draft.duplicate_warning : [];
      setDuplicateWarning(
        dups.length
          ? `Bu ta'minotchi va nakladnoy raqami avval qabul qilingan (${dups
              .map((row: any) => row.po_number || row.receipt_number || row.invoice_number)
              .filter(Boolean)
              .slice(0, 3)
              .join(', ')}). Saqlash baribir mumkin.`
          : null,
      );
      if (!nextLines.length) {
        setExtractError('AI qator topmadi. Qo‘lda xarid formasidan foydalaning yoki rasmni qayta yuklang.');
      }
    } catch (err: any) {
      setExtractError(err?.message || 'Nakladnoyni o‘qib bo‘lmadi');
    } finally {
      setReading(false);
    }
  };

  const findProducts = async (key: string) => {
    const term = String(search[key] || '').trim();
    if (term.length < 2) return;
    try {
      const rows = await searchProducts(term);
      const list = (Array.isArray(rows) ? rows : []).slice(0, 8).map((row: any) => ({
        id: String(row.id),
        name: String(row.name || ''),
        sku: row.sku || null,
        unit: productUnitOf(row),
      }));
      setHits((prev) => ({ ...prev, [key]: list }));
    } catch (err: any) {
      toast({ title: 'Qidiruv xatosi', description: err?.message, variant: 'destructive' });
    }
  };

  const pickProduct = (key: string, hit: SearchHit) => {
    updateLine(key, {
      action: 'match',
      product_id: hit.id,
      product_name: hit.name,
      product_sku: hit.sku || null,
      product_unit: hit.unit || 'pcs',
      match_kind: null,
    });
  };

  const save = async () => {
    if (blockers.length) {
      toast({ title: 'Tasdiqlab bo‘lmaydi', description: blockers[0], variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const result = await confirmInvoicePurchase({
        supplier_id: supplierId,
        invoice_number: invoiceNumber || null,
        fx_rate: currency === 'USD' ? Number(fxRate) : null,
        image_url: imageUrl,
        raw_ai: rawAi,
        created_by: (user as { id?: string } | null)?.id || null,
        lines: lines.map((line) => ({
          action: line.action,
          product_id: line.product_id,
          name: line.name,
          qty: Number(line.qty),
          unit: line.unit,
          unit_price: Number(line.unit_price),
          warehouse_qty: line.warehouse_qty === '' ? null : Number(line.warehouse_qty),
          sale_price: line.sale_price === '' ? null : Number(line.sale_price),
          barcode: line.barcode,
          sku: line.sku,
          article: line.article,
        })),
      });
      const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
      toast({
        title: 'Xarid qabul qilindi',
        description: warnings.length
          ? 'Ombor yangilandi. Bu nakladnoy raqami avval ham qabul qilingan.'
          : 'Ombor va partiyalar oddiy qabul orqali yangilandi.',
      });
      const id = result?.purchase_order?.id;
      navigate(id ? `/purchase-orders/${id}` : '/purchase-orders');
    } catch (err: any) {
      toast({
        title: 'Saqlanmadi',
        description: err?.message || 'Xaridni qabul qilib bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <h1 className="page-heading">Nakladnoydan xarid</h1>
          <p className="page-heading-sub">
            Rasm faqat qoralama. Ombor tasdiqlaguncha o‘zgarmaydi. AI ishlamasa, qo‘lda xarid ochiq qoladi.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => navigate('/purchase-orders')}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Xaridlar
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => navigate('/purchase-orders/new')}>
            Qo‘lda xarid
          </Button>
        </div>
      </div>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="border-b px-4 py-3">
          <CardTitle className="text-base">Nakladnoy</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 px-4 py-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label>Yetkazib beruvchi</Label>
            <SearchableSupplierCombobox
              value={supplierId}
              onValueChange={setSupplierId}
              suppliers={suppliers}
              placeholder="Tanlang"
            />
            {supplier ? (
              <p className="text-xs text-muted-foreground">
                Hisob valyutasi: {moneyLabel(currency)}. Butun nakladnoy shu valyutada.
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label>Nakladnoy raqami</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Ixtiyoriy" />
          </div>
          {currency === 'USD' ? (
            <div className="space-y-1">
              <Label>Kurs (1 USD = so‘m)</Label>
              <Input
                inputMode="decimal"
                value={fxRate}
                onChange={(e) => setFxRate(e.target.value)}
                placeholder="Masalan 12500"
              />
            </div>
          ) : null}
          <div className="space-y-1 sm:col-span-2">
            <Label>Bitta rasm</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => onFile(e.target.files?.[0] || null)}
            />
            {previewUrl ? (
              <img src={previewUrl} alt="Nakladnoy" className="mt-2 max-h-48 rounded-md border object-contain" />
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <Button type="button" disabled={reading || !file || !supplierId} onClick={readInvoice}>
              <FileImage className="mr-1.5 h-4 w-4" />
              {reading ? 'O‘qilmoqda…' : 'Nakladnoyni o‘qish'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {extractError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          {extractError}{' '}
          <button type="button" className="underline" onClick={() => navigate('/purchase-orders/new')}>
            Qo‘lda xarid
          </button>
        </div>
      ) : null}
      {currencyWarning ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{currencyWarning}</div>
      ) : null}
      {duplicateWarning ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{duplicateWarning}</div>
      ) : null}

      {lines.length ? (
        <Card className="gap-0 py-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
            <CardTitle className="text-base">Qatorlar</CardTitle>
            <Button type="button" disabled={saving || blockers.length > 0} onClick={save}>
              <Save className="mr-1.5 h-4 w-4" />
              {saving ? 'Saqlanmoqda…' : 'Qabul qilish'}
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-3 pt-0">
            {blockers.length ? (
              <p className="px-4 py-2 text-xs text-muted-foreground">{blockers[0]}</p>
            ) : null}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nakladnoy nomi</TableHead>
                    <TableHead>Miqdor</TableHead>
                    <TableHead>Birlik</TableHead>
                    <TableHead>Narx ({moneyLabel(currency)})</TableHead>
                    <TableHead>Qator jami</TableHead>
                    <TableHead>Ombor mahsuloti</TableHead>
                    <TableHead>Amal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const qty = Number(line.qty) || 0;
                    const price = Number(line.unit_price) || 0;
                    const unitMismatch =
                      line.action === 'match' &&
                      !!line.product_id &&
                      !invoiceUnitsEquivalent(line.unit, line.product_unit);
                    return (
                      <TableRow key={line.key} className={line.action === 'skip' ? 'opacity-50' : undefined}>
                        <TableCell className="min-w-[12rem] align-top">
                          <Input
                            value={line.name}
                            onChange={(e) => updateLine(line.key, { name: e.target.value })}
                            className="h-8"
                          />
                          {line.match_kind ? (
                            <p className="mt-1 text-[11px] text-muted-foreground">Aniq mos: {line.match_kind}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            value={line.qty}
                            onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                            className="h-8 w-20"
                          />
                        </TableCell>
                        <TableCell className="align-top text-sm">
                          <div>{line.unit || '—'}</div>
                          {line.product_unit ? (
                            <div className="text-[11px] text-muted-foreground">
                              Ombor: {invoiceUnitLabel(line.product_unit)}
                            </div>
                          ) : null}
                          {unitMismatch ? (
                            <div className="mt-1 space-y-1">
                              <p className="text-[11px] text-amber-700">Birlik mos emas. Qutini donaga o‘zi aylantirmaydi.</p>
                              <Input
                                value={line.warehouse_qty}
                                onChange={(e) => updateLine(line.key, { warehouse_qty: e.target.value })}
                                placeholder={`Miqdor, ${invoiceUnitLabel(line.product_unit)}`}
                                className="h-8 w-28"
                              />
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            value={line.unit_price}
                            onChange={(e) => updateLine(line.key, { unit_price: e.target.value })}
                            className="h-8 w-28"
                          />
                          <div className="mt-1 text-[11px] text-muted-foreground">{moneyLabel(currency)}</div>
                        </TableCell>
                        <TableCell className="align-top text-sm">{formatMoney(qty * price, currency)}</TableCell>
                        <TableCell className="min-w-[16rem] align-top">
                          {line.action === 'match' && line.product_name ? (
                            <div className="text-sm">
                              {line.product_name}
                              {line.product_sku ? (
                                <span className="text-muted-foreground"> · {line.product_sku}</span>
                              ) : null}
                            </div>
                          ) : null}
                          {line.action === 'create' ? (
                            <div className="space-y-1">
                              <p className="text-xs">Yangi mahsulot: {line.name}</p>
                              <Input
                                value={line.sale_price}
                                onChange={(e) => updateLine(line.key, { sale_price: e.target.value })}
                                placeholder={`Sotuv narxi, ${moneyLabel('UZS')}`}
                                className="h-8"
                              />
                            </div>
                          ) : null}
                          {line.action !== 'skip' ? (
                            <div className="mt-2 flex gap-1">
                              <Input
                                value={search[line.key] || ''}
                                onChange={(e) => setSearch((prev) => ({ ...prev, [line.key]: e.target.value }))}
                                placeholder="Nom, SKU, shtrix"
                                className="h-8"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void findProducts(line.key);
                                }}
                              />
                              <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => findProducts(line.key)}>
                                Qidirish
                              </Button>
                            </div>
                          ) : null}
                          {(hits[line.key] || []).map((hit) => (
                            <button
                              key={hit.id}
                              type="button"
                              className="mt-1 block w-full rounded border px-2 py-1 text-left text-xs hover:bg-muted"
                              onClick={() => pickProduct(line.key, hit)}
                            >
                              {hit.name}
                              <span className="text-muted-foreground"> · {invoiceUnitLabel(hit.unit)}</span>
                            </button>
                          ))}
                          {line.candidates?.length && line.action === 'pending' ? (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              O‘xshashlar avtomatik bog‘lanmaydi:
                              {line.candidates.map((hit) => (
                                <button
                                  key={hit.id}
                                  type="button"
                                  className="mt-1 block w-full rounded border px-2 py-1 text-left hover:bg-muted"
                                  onClick={() =>
                                    pickProduct(line.key, {
                                      id: hit.id,
                                      name: hit.name,
                                      sku: hit.sku,
                                      unit: hit.unit,
                                    })
                                  }
                                >
                                  {hit.name}
                                  {hit.reason === 'fuzzy' ? ' (taxminiy)' : ''}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-col gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant={line.action === 'create' ? 'default' : 'outline'}
                              className="h-7 text-xs"
                              onClick={() =>
                                updateLine(line.key, {
                                  action: 'create',
                                  product_id: null,
                                  product_name: null,
                                  product_unit: null,
                                })
                              }
                            >
                              Yaratish
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={line.action === 'skip' ? 'default' : 'outline'}
                              className="h-7 text-xs"
                              onClick={() => updateLine(line.key, { action: 'skip' })}
                            >
                              O‘tkazish
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
