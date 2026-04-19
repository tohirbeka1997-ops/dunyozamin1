import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronsUpDown, ArrowLeft, Printer, Copy, Wand2, Minus, Plus, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProductWithCategory } from '@/types/database';
import { generateBarcode, searchProducts, updateProduct } from '@/db/api';
import { useToast } from '@/hooks/use-toast';
import { checkDuplicateBarcode, validateProductBarcode } from '@/lib/barcodes/productBarcode';
import { Checkbox } from '@/components/ui/checkbox';
import { formatMoneyUZS } from '@/lib/format';
import {
  defaultProductLabelLayout,
  type ProductLabelElement,
} from '@/components/barcodes/ProductLabelLayoutEditor';
import ProductLabelLayoutPrint from '@/components/barcodes/ProductLabelLayoutPrint';
import { openPrintWindowLabel } from '@/lib/print';

type BarcodeType = 'EAN13' | 'CODE128' | 'QR';
type LabelPreset = '39x20' | '50x30' | '70x35';
type SizeMode = 'preset' | 'custom';

const PRESETS: Record<LabelPreset, { w: number; h: number; label: string }> = {
  '39x20': { w: 39, h: 20, label: '39×20' },
  '50x30': { w: 50, h: 30, label: '50×30' },
  '70x35': { w: 70, h: 35, label: '70×35' },
};

function randomDigits(n: number): string {
  const digits = Array.from({ length: n }, () => String(Math.floor(Math.random() * 10))).join('');
  return digits.padStart(n, '0').slice(0, n);
}

export default function ProductBarcodeServicePage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchValue, setProductSearchValue] = useState('');
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductWithCategory | null>(null);

  const [barcodeType, setBarcodeType] = useState<BarcodeType>('EAN13');
  const [barcodeMode, setBarcodeMode] = useState<'auto' | 'manual'>('auto');
  const [barcodeValue, setBarcodeValue] = useState('');
  const [barcodeTouched, setBarcodeTouched] = useState(false);
  const [copies, setCopies] = useState(1);
  const [preset, setPreset] = useState<LabelPreset>('39x20');
  const [sizeMode, setSizeMode] = useState<SizeMode>('preset');
  const [customWmm, setCustomWmm] = useState<number>(39);
  const [customHmm, setCustomHmm] = useState<number>(20);

  const [attachBarcodeToProduct, setAttachBarcodeToProduct] = useState(false);
  const [showBarcode, setShowBarcode] = useState(true);
  const [showHeader, setShowHeader] = useState(false);
  const [showName, setShowName] = useState(true);
  const [showSku, setShowSku] = useState(true);
  const [layoutScale, setLayoutScale] = useState<'small' | 'standard' | 'large'>('standard');
  const [previewZoom, setPreviewZoom] = useState(1);
  const [showSafeArea, setShowSafeArea] = useState(true);
  const [duplicateWarning, setDuplicateWarning] = useState<null | { names: string[] }>(null);
  // Editable (label-only) product fields — prefilled from selected product, but user can tweak without retyping.
  const [labelHeader, setLabelHeader] = useState('');
  const [labelName, setLabelName] = useState('');
  const [labelSku, setLabelSku] = useState('');
  const [labelPriceText, setLabelPriceText] = useState('');
  const [labelFieldsTouched, setLabelFieldsTouched] = useState(false);

  const [layoutElements, setLayoutElements] = useState<ProductLabelElement[]>(() =>
    defaultProductLabelLayout(39, 20)
  );
  const [showBarcodeDigits] = useState(false);

  const previewRef = useRef<HTMLDivElement>(null);

  const doPrint = () => {
    try {
      if (!selectedProduct) {
        toast({ title: 'Mahsulot tanlanmagan', description: 'Avval mahsulotni tanlang.', variant: 'destructive' });
        return;
      }
      if (showBarcode && !barcodeValue.trim()) {
        toast({
          title: 'Barcode kerak',
          description: 'Barcode yoqilgan, shuning uchun qiymatini kiriting.',
          variant: 'destructive',
        });
        return;
      }

      const proceed = async () => {
        let normalized = barcodeValue;
        if (showBarcode) {
          const result = await runValidation({ showToast: true, confirmDuplicate: true });
          if (!result.ok) return;
          normalized = result.normalized || barcodeValue;
        }

        if (attachBarcodeToProduct && showBarcode && normalized && selectedProduct) {
          await updateProduct(selectedProduct.id, { barcode: normalized });
          setSelectedProduct((prev) => (prev ? { ...prev, barcode: normalized } : prev));
        }

        const html = renderToStaticMarkup(
          <ProductLabelLayoutPrint
            widthMm={effectiveWmm}
            heightMm={effectiveHmm}
            copies={copies}
            barcodeType={barcodeType === 'EAN13' ? 'EAN13' : barcodeType === 'QR' ? 'QR' : 'CODE128'}
            barcodeValue={showBarcode ? normalized : ''}
            showBarcodeDigits={showBarcodeDigits}
            texts={resolvedTexts}
            showPrice
            layout={activeLayout}
          />
        );

        openPrintWindowLabel(html, {
          widthMm: effectiveWmm,
          heightMm: effectiveHmm,
        });
        toast({ title: 'Chop etildi', description: `${copies} ta yorliq chop etildi.` });
      };

      void proceed();

    } catch (e: any) {
      toast({
        title: 'Chop etish xatoligi',
        description: e?.message || 'Chop etib bo‘lmadi',
        variant: 'destructive',
      });
    }
  };

  // Search products
  useEffect(() => {
    const term = String(productSearchValue || '').trim();
    if (term.length < 2) {
      setProducts([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const results = await searchProducts(term);
        setProducts(results);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('searchProducts failed', e);
        setProducts([]);
      }
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [productSearchValue]);

  useEffect(() => {
    if (!selectedProduct) return;
    // Pre-fill (only if user didn't start editing manually)
    if (!barcodeTouched) {
      // Only use real barcode; don't overwrite with SKU when barcode is missing.
      setBarcodeValue(selectedProduct.barcode || '');
    }

    // Prefill editable label fields (only if user hasn't touched them yet)
    if (!labelFieldsTouched) {
      const header = (selectedProduct.name || '').split(/\s+/)[0] || '';
      const name = selectedProduct.name || '';
      const sku = selectedProduct.sku ? String(selectedProduct.sku) : '';
      const priceText = formatMoneyUZS(Number(selectedProduct.sale_price)).replace(' so‘m', ' uzs');
      setLabelHeader(header);
      setLabelName(name);
      setLabelSku(sku);
      setLabelPriceText(priceText);
    }
  }, [selectedProduct, barcodeTouched]);

  const presetSize = PRESETS[preset];
  const effectiveWmm = sizeMode === 'custom' ? customWmm : presetSize.w;
  const effectiveHmm = sizeMode === 'custom' ? customHmm : presetSize.h;

  const productOptionLabel = (p: ProductWithCategory) => {
    const sku = p.sku ? ` (${p.sku})` : '';
    return `${p.name}${sku}`;
  };

  const resolvedTexts = useMemo(() => {
    const header = labelHeader || '';
    const name = labelName || '';
    const sku = labelSku || '';
    const price = labelPriceText || '';
    return { header, name, sku, price };
  }, [labelHeader, labelName, labelSku, labelPriceText]);

  const layoutScaleFactor = layoutScale === 'small' ? 0.9 : layoutScale === 'large' ? 1.1 : 1;
  const activeLayout = useMemo(() => {
    let next = layoutElements;
    if (!showBarcode) next = next.filter((el) => el.kind !== 'barcode');
    if (!showHeader) next = next.filter((el) => el.id !== 'header');
    if (!showName) next = next.filter((el) => el.id !== 'name');
    if (!showSku) next = next.filter((el) => el.id !== 'sku');
    if (layoutScaleFactor !== 1) {
      next = next.map((el) =>
        el.kind === 'text'
          ? { ...el, fontSizePt: Number(el.fontSizePt ?? 10) * layoutScaleFactor }
          : el
      );
    }
    return next;
  }, [layoutElements, showBarcode, showHeader, showName, showSku, layoutScaleFactor]);

  const manualValidation = useMemo(() => {
    if (!showBarcode || barcodeMode !== 'manual') return null;
    if (!barcodeValue.trim() && !barcodeTouched) return null;
    return validateProductBarcode({ type: barcodeType, value: barcodeValue });
  }, [showBarcode, barcodeMode, barcodeType, barcodeValue, barcodeTouched]);

  const manualError = manualValidation && !manualValidation.ok ? manualValidation.error : '';

  useEffect(() => {
    setLayoutElements(defaultProductLabelLayout(effectiveWmm, effectiveHmm));
  }, [effectiveWmm, effectiveHmm]);

  const onGenerate = async () => {
    try {
      // QR: auto-fill with SKU or product name (any text is valid for QR)
      if (barcodeType === 'QR') {
        const qrVal = selectedProduct?.sku || selectedProduct?.name || '';
        if (qrVal) {
          setBarcodeValue(qrVal);
          setBarcodeTouched(true);
          setDuplicateWarning(null);
          toast({ title: 'Tayyor', description: `QR: ${qrVal}` });
        } else {
          toast({ title: 'Maslahat', description: 'QR uchun matn kiriting (URL, SKU va h.k.)', variant: 'default' });
        }
        return;
      }

      // Prefer backend generator for uniqueness; normalize for EAN-13 if needed.
      const next = await generateBarcode();
      const v = validateProductBarcode({ type: barcodeType, value: next });
      if (v.ok && v.normalizedValue) {
        setBarcodeValue(v.normalizedValue);
        setBarcodeTouched(true);
        setDuplicateWarning(null);
        toast({ title: 'Tayyor', description: `Barcode: ${v.normalizedValue}` });
        return;
      }

      // Fallback for EAN-13: generate 12 digits locally and compute checksum on validate step.
      if (barcodeType === 'EAN13') {
        const local12 = randomDigits(12);
        setBarcodeValue(local12);
        setBarcodeTouched(true);
        setDuplicateWarning(null);
        toast({ title: 'Tayyor', description: `EAN-13 base (12): ${local12} — Validatsiya tugmasini bosing` });
        return;
      }

      setBarcodeValue(next);
      setBarcodeTouched(true);
      setDuplicateWarning(null);
      toast({ title: 'Tayyor', description: `Barcode: ${next}` });
    } catch (e: any) {
      toast({ title: 'Xatolik', description: e?.message || 'Barcode yaratib bo‘lmadi', variant: 'destructive' });
    }
  };

  const runValidation = async (opts?: { showToast?: boolean; confirmDuplicate?: boolean }) => {
    if (!showBarcode) return { ok: true, normalized: '' };
    const v = validateProductBarcode({ type: barcodeType, value: barcodeValue });
    if (!v.ok) {
      if (opts?.showToast !== false) {
        toast({ title: 'Xatolik', description: v.error || 'Noto‘g‘ri barcode', variant: 'destructive' });
      }
      return { ok: false, normalized: '' };
    }
    const normalized = v.normalizedValue || barcodeValue;
    if (normalized !== barcodeValue) {
      setBarcodeValue(normalized);
      setBarcodeTouched(true);
    }

    try {
      const dupe = await checkDuplicateBarcode(normalized, { currentProductId: selectedProduct?.id });
      if (dupe.duplicate) {
        setDuplicateWarning({ names: dupe.duplicates.map((d) => `${d.name} (${d.sku})`).slice(0, 3) });
        if (opts?.confirmDuplicate !== false) {
          const proceed = window.confirm(
            `Bu barcode boshqa mahsulotda ishlatilgan. Davom etasizmi?\n${dupe.duplicates
              .slice(0, 3)
              .map((d) => `${d.name} (${d.sku})`)
              .join(', ')}`
          );
          if (!proceed) return { ok: false, normalized };
        }
      } else {
        setDuplicateWarning(null);
      }
      if (opts?.showToast !== false) {
        toast({ title: 'OK', description: 'Barcode to‘g‘ri' });
      }
    } catch (e: any) {
      if (opts?.showToast !== false) {
        toast({ title: 'Xatolik', description: e?.message || 'Duplicate check ishlamadi', variant: 'destructive' });
      }
      return { ok: false, normalized };
    }

    return { ok: true, normalized };
  };

  const handleCopyBarcode = async () => {
    if (!barcodeValue.trim()) return;
    try {
      await navigator.clipboard.writeText(barcodeValue);
      toast({ title: 'Nusxalandi', description: 'Barcode clipboardga ko‘chirildi' });
    } catch (e: any) {
      toast({ title: 'Xatolik', description: e?.message || 'Nusxalash ishlamadi', variant: 'destructive' });
    }
  };

  const handleValidateClick = async () => {
    await runValidation({ showToast: true, confirmDuplicate: false });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Product Barcode Service</h1>
          <p className="text-muted-foreground mt-2">
            Mahsulotlar uchun barcode yaratish va yorliq chop etish (EAN-13 / CODE128 / QR).
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/barcodes')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Orqaga
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Yorliq sozlamalari</CardTitle>
            <CardDescription>Jarayon 4 bosqichga bo‘lingan: mahsulot → barcode → dizayn → chop.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="rounded-lg border p-4 space-y-3">
              <div>
                <div className="text-sm font-semibold">1. Mahsulot</div>
                <p className="text-xs text-muted-foreground">Mahsulotni tanlang.</p>
              </div>
              <div className="space-y-2">
                <Label>Mahsulot tanlash</Label>
                <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" aria-expanded={productSearchOpen} className="w-full justify-between">
                      {selectedProduct ? productOptionLabel(selectedProduct) : 'Mahsulotni tanlang'}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" style={{ width: 'var(--radix-popover-trigger-width)' }}>
                    <Command>
                      <CommandInput placeholder="Mahsulot qidirish..." value={productSearchValue} onValueChange={setProductSearchValue} />
                      <CommandList>
                        <CommandEmpty>Mahsulot topilmadi</CommandEmpty>
                        <CommandGroup>
                          {products.slice(0, 20).map((p) => (
                            <CommandItem
                              key={p.id}
                              value={`${p.name} ${p.sku || ''} ${p.barcode || ''}`.trim()}
                              onSelect={() => {
                                setSelectedProduct(p);
                                setBarcodeTouched(false);
                                setDuplicateWarning(null);
                                setLabelFieldsTouched(false);
                                setLabelHeader('');
                                setLabelName('');
                                setLabelSku('');
                                setLabelPriceText('');
                                setProductSearchOpen(false);
                                setProductSearchValue('');
                              }}
                            >
                              <Check className={cn('mr-2 h-4 w-4', selectedProduct?.id === p.id ? 'opacity-100' : 'opacity-0')} />
                              {productOptionLabel(p)}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">SKU: {selectedProduct?.sku || '—'}</Badge>
                <Badge variant="secondary">Narx: {selectedProduct ? formatMoneyUZS(Number(selectedProduct.sale_price)) : '—'}</Badge>
                <Badge variant="secondary">Kategoriya: {(selectedProduct as any)?.category?.name || '—'}</Badge>
              </div>
              <div className="space-y-1 rounded border p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={attachBarcodeToProduct}
                    onCheckedChange={(v) => setAttachBarcodeToProduct(Boolean(v))}
                    id="attach-barcode"
                    disabled={!selectedProduct}
                  />
                  <Label htmlFor="attach-barcode" className="cursor-pointer text-sm">
                    Mahsulotga barkod biriktirish
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">ON bo‘lsa, chop etilgan barkod mahsulot kartasiga saqlanadi.</p>
              </div>
              <div className="flex items-center gap-3 rounded border p-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!selectedProduct) return;
                    const header = (selectedProduct.name || '').split(/\s+/)[0] || '';
                    const name = selectedProduct.name || '';
                    const sku = selectedProduct.sku ? String(selectedProduct.sku) : '';
                    const priceText = formatMoneyUZS(Number(selectedProduct.sale_price)).replace(' so‘m', ' uzs');
                    setLabelHeader(header);
                    setLabelName(name);
                    setLabelSku(sku);
                    setLabelPriceText(priceText);
                    setLabelFieldsTouched(false);
                  }}
                  disabled={!selectedProduct}
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  Avto to‘ldirish
                </Button>
                <span className="text-xs text-muted-foreground">
                  Mahsulot kartasidan nom, SKU va narx olinadi.
                </span>
              </div>
            </section>

            <section className="rounded-lg border p-4 space-y-3">
              <div>
                <div className="text-sm font-semibold">2. Barcode sozlash</div>
                <p className="text-xs text-muted-foreground">Avto yaratish yoki qo‘lda kiritish.</p>
              </div>
              {barcodeType !== 'QR' && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={barcodeMode === 'auto' ? 'default' : 'outline'}
                    onClick={() => setBarcodeMode('auto')}
                  >
                    Avto yaratish
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={barcodeMode === 'manual' ? 'default' : 'outline'}
                    onClick={() => setBarcodeMode('manual')}
                  >
                    Qo’lda kiritish
                  </Button>
                </div>
              )}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Barcode formati</Label>
                  <Select value={barcodeType} onValueChange={(v: BarcodeType) => setBarcodeType(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EAN13">EAN-13</SelectItem>
                      <SelectItem value="CODE128">CODE128</SelectItem>
                      <SelectItem value="QR">QR Code</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{barcodeType === 'QR' ? 'QR mazmuni' : 'Barcode raqami'}</Label>
                  {barcodeType === 'QR' ? (
                    <>
                      <Input
                        value={barcodeValue}
                        onChange={(e) => {
                          setBarcodeTouched(true);
                          setBarcodeValue(e.target.value);
                          setDuplicateWarning(null);
                        }}
                        placeholder="URL, SKU yoki ixtiyoriy matn"
                        className="font-mono"
                      />
                      <div className={manualError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                        {manualError || 'QR kodga istalgan matn yoki URL kiritish mumkin.'}
                      </div>
                    </>
                  ) : barcodeMode === 'auto' ? (
                    <>
                      <div className="flex gap-2">
                        <Input value={barcodeValue} readOnly placeholder="Yaratilmagan" className="font-mono" />
                        <Button type="button" variant="outline" onClick={onGenerate}>
                          Yaratish
                        </Button>
                        <Button type="button" variant="outline" onClick={handleCopyBarcode} disabled={!barcodeValue.trim()} title="Nusxalash">
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        EAN-13: 12/13 raqam. CODE128: matn bo’lishi mumkin.
                      </div>
                    </>
                  ) : (
                    <>
                      <Input
                        value={barcodeValue}
                        onChange={(e) => {
                          setBarcodeTouched(true);
                          setBarcodeValue(e.target.value);
                          setDuplicateWarning(null);
                        }}
                        placeholder="13 raqam (EAN-13)"
                        className="font-mono"
                      />
                      <div className={manualError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                        {manualError || 'EAN-13 uchun 12/13 raqam, CODE128 uchun matn bo’lishi mumkin.'}
                      </div>
                    </>
                  )}
                </div>
              </div>
              {duplicateWarning && (
                <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <div>
                    Bu barcode boshqa mahsulotda ishlatilgan: {duplicateWarning.names.join(', ')}.
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-lg border p-4 space-y-3">
              <div>
                <div className="text-sm font-semibold">3. Label dizayni</div>
                <p className="text-xs text-muted-foreground">Yorliq o‘lchami va ko‘rinadigan maydonlarni tanlang.</p>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Yorliq (label) o‘lchami</Label>
                  <Select value={sizeMode} onValueChange={(v: SizeMode) => setSizeMode(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="preset">Andoza</SelectItem>
                      <SelectItem value="custom">Qo‘lda (W/H)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Layout</Label>
                  <Select value={layoutScale} onValueChange={(v: 'small' | 'standard' | 'large') => setLayoutScale(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Kichik</SelectItem>
                      <SelectItem value="standard">Standart</SelectItem>
                      <SelectItem value="large">Katta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {sizeMode === 'preset' ? (
                <div className="space-y-2">
                  <Label>Andoza</Label>
                  <Select value={preset} onValueChange={(v: LabelPreset) => setPreset(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="39x20">{PRESETS['39x20'].label}</SelectItem>
                      <SelectItem value="50x30">{PRESETS['50x30'].label}</SelectItem>
                      <SelectItem value="70x35">{PRESETS['70x35'].label}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>O‘lcham (mm)</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      value={customWmm}
                      onChange={(e) => setCustomWmm(Number(e.target.value) || 0)}
                      placeholder="W (mm)"
                    />
                    <Input
                      type="number"
                      value={customHmm}
                      onChange={(e) => setCustomHmm(Number(e.target.value) || 0)}
                      placeholder="H (mm)"
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">Masalan: 39×20, 50×30, 70×35</div>
                </div>
              )}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Ko‘rinadigan maydonlar</Label>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={showName} onCheckedChange={(v) => setShowName(Boolean(v))} id="show-name" />
                      <Label htmlFor="show-name" className="cursor-pointer text-sm">Mahsulot nomi</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox checked={showSku} onCheckedChange={(v) => setShowSku(Boolean(v))} id="show-sku" />
                      <Label htmlFor="show-sku" className="cursor-pointer text-sm">SKU</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox checked={showBarcode} onCheckedChange={(v) => setShowBarcode(Boolean(v))} id="show-barcode" />
                      <Label htmlFor="show-barcode" className="cursor-pointer text-sm">Barcode</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox checked={showHeader} onCheckedChange={(v) => setShowHeader(Boolean(v))} id="show-header" />
                      <Label htmlFor="show-header" className="cursor-pointer text-sm">Brand/Header</Label>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  {showHeader && (
                    <div className="space-y-1">
                      <Label>Header</Label>
                      <Input
                        value={labelHeader}
                        onChange={(e) => {
                          setLabelFieldsTouched(true);
                          setLabelHeader(e.target.value);
                        }}
                        placeholder="Masalan: BRAND"
                      />
                    </div>
                  )}
                  {showName && (
                    <div className="space-y-1">
                      <Label>Mahsulot nomi</Label>
                      <Input
                        value={labelName}
                        onChange={(e) => {
                          setLabelFieldsTouched(true);
                          setLabelName(e.target.value);
                        }}
                        placeholder="Masalan: Mahsulot nomi"
                      />
                    </div>
                  )}
                  {showSku && (
                    <div className="space-y-1">
                      <Label>SKU</Label>
                      <Input
                        value={labelSku}
                        onChange={(e) => {
                          setLabelFieldsTouched(true);
                          setLabelSku(e.target.value);
                        }}
                        placeholder="Masalan: 12345"
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label>Narx</Label>
                    <Input
                      value={labelPriceText}
                      onChange={(e) => {
                        setLabelFieldsTouched(true);
                        setLabelPriceText(e.target.value);
                      }}
                      placeholder="Masalan: 25 000 uzs"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-lg border p-4 space-y-3">
              <div>
                <div className="text-sm font-semibold">4. Chop etish</div>
                <p className="text-xs text-muted-foreground">Chop nusxasi va tekshiruv.</p>
              </div>
              <div className="flex items-center gap-3">
                <Label>Chop nusxasi</Label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => setCopies((prev) => Math.max(1, Number(prev || 1) - 1))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={copies}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 1 && n <= 100) setCopies(n);
                    }}
                    className="w-20 text-center"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => setCopies((prev) => Math.min(100, Number(prev || 1) + 1))}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={handleValidateClick} disabled={!showBarcode}>
                  Validatsiya
                </Button>
                <Button
                  onClick={doPrint}
                  disabled={
                    !selectedProduct ||
                    (showBarcode && !barcodeValue.trim()) ||
                    (barcodeMode === 'manual' && Boolean(manualError))
                  }
                >
                  <Printer className="h-4 w-4 mr-2" />
                  Chop etish
                </Button>
              </div>
              {!selectedProduct && (
                <div className="text-xs text-destructive">Mahsulot tanlanmagan — chop etish o‘chirilgan.</div>
              )}
              {showBarcode && barcodeMode === 'manual' && manualError && (
                <div className="text-xs text-destructive">{manualError}</div>
              )}
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Preview</CardTitle>
              <CardDescription>Chop etishda aynan shu ko‘rinish chiqadi.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={previewZoom === 1 ? 'default' : 'outline'}
                onClick={() => setPreviewZoom(1)}
              >
                100%
              </Button>
              <Button
                type="button"
                size="sm"
                variant={previewZoom === 1.5 ? 'default' : 'outline'}
                onClick={() => setPreviewZoom(1.5)}
              >
                150%
              </Button>
              <div className="flex items-center gap-2 rounded border px-2 py-1">
                <Checkbox checked={showSafeArea} onCheckedChange={(v) => setShowSafeArea(Boolean(v))} id="safe-area" />
                <Label htmlFor="safe-area" className="cursor-pointer text-xs">Safe area</Label>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div ref={previewRef} className="print:bg-white">
              <div style={{ transform: `scale(${previewZoom})`, transformOrigin: 'top left' }}>
                <div
                  className="relative"
                  style={{ width: `${effectiveWmm}mm`, height: `${effectiveHmm}mm` }}
                >
                  <ProductLabelLayoutPrint
                    widthMm={effectiveWmm}
                    heightMm={effectiveHmm}
                    copies={1}
                    barcodeType={barcodeType === 'EAN13' ? 'EAN13' : barcodeType === 'QR' ? 'QR' : 'CODE128'}
                    barcodeValue={showBarcode ? barcodeValue : ''}
                    showBarcodeDigits={showBarcodeDigits}
                    texts={resolvedTexts}
                    showPrice
                    layout={activeLayout}
                  />
                  {showSafeArea && (
                    <div
                      className="pointer-events-none absolute border border-dashed border-muted-foreground/40"
                      style={{ inset: '1.5mm' }}
                    />
                  )}
                </div>
              </div>
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Hozirgi o‘lcham: {effectiveWmm}×{effectiveHmm} mm
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

