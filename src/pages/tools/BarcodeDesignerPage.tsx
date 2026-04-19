import { useEffect, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { openPrintWindowLabel } from '@/lib/print';
import { validateProductBarcode } from '@/lib/barcodes/productBarcode';
import ProductLabelLayoutEditor, {
  defaultProductLabelLayout,
  type ProductLabelElement,
  type ProductLabelElementId,
  type ProductLabelBarcodeType,
} from '@/components/barcodes/ProductLabelLayoutEditor';
import ProductLabelLayoutPrint from '@/components/barcodes/ProductLabelLayoutPrint';
import { cn } from '@/lib/utils';
import { ArrowUp, ArrowDown, Lock, Unlock, Printer, Save, Trash2, Check, ChevronsUpDown } from 'lucide-react';
import type { ProductWithCategory } from '@/types/database';
import { searchProducts } from '@/db/api';
import { formatNumberUZ } from '@/lib/format';

type LabelPreset = '39x20' | '50x30' | '58x40' | '70x35';
type SizeMode = 'preset' | 'custom';

type DesignerElement = ProductLabelElement & {
  visible: boolean;
  locked: boolean;
};

const PRESETS: Record<LabelPreset, { w: number; h: number; label: string }> = {
  '39x20': { w: 39, h: 20, label: '39×20' },
  '50x30': { w: 50, h: 30, label: '50×30' },
  '58x40': { w: 58, h: 40, label: '58×40' },
  '70x35': { w: 70, h: 35, label: '70×35' },
};

const TEMPLATE_STORAGE_KEY = 'barcodeDesignerTemplates:v1';

function initDesignerElements(widthMm: number, heightMm: number): DesignerElement[] {
  return defaultProductLabelLayout(widthMm, heightMm).map((el) => ({
    ...el,
    visible: true,
    locked: false,
    fontFamily: 'Arial',
    letterSpacingPt: 0,
    uppercase: false,
  }));
}

export default function BarcodeDesignerPage() {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [sizeMode, setSizeMode] = useState<SizeMode>('preset');
  const [preset, setPreset] = useState<LabelPreset>('39x20');
  const [customWmm, setCustomWmm] = useState(39);
  const [customHmm, setCustomHmm] = useState(20);

  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [gridSizeMm, setGridSizeMm] = useState(1);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(true);
  const [safePaddingMm, setSafePaddingMm] = useState(1.5);

  const [barcodeType, setBarcodeType] = useState<ProductLabelBarcodeType>('EAN13');
  const [barcodeValue, setBarcodeValue] = useState('4780001234567');
  const [barcodeShowDigits, setBarcodeShowDigits] = useState(false);
  const [barcodeRotateDeg, setBarcodeRotateDeg] = useState(0);
  const [barcodeQuietZoneMm, setBarcodeQuietZoneMm] = useState(0);

  const [headerText, setHeaderText] = useState('BRAND');
  const [nameText, setNameText] = useState('Product name');
  const [skuText, setSkuText] = useState('SKU 0363');
  const [priceText, setPriceText] = useState('957.000');
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchValue, setProductSearchValue] = useState('');
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductWithCategory | null>(null);

  const [elements, setElements] = useState<DesignerElement[]>(() => initDesignerElements(39, 20));
  const [selectedId, setSelectedId] = useState<ProductLabelElementId | null>(null);
  const [copies, setCopies] = useState(1);

  const [templateName, setTemplateName] = useState('');
  const [templates, setTemplates] = useState<Array<{ name: string; payload: any }>>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [dragLayerId, setDragLayerId] = useState<ProductLabelElementId | null>(null);

  const labelSize = useMemo(() => {
    const presetSize = PRESETS[preset];
    return sizeMode === 'custom'
      ? { w: Math.max(10, customWmm), h: Math.max(10, customHmm) }
      : { w: presetSize.w, h: presetSize.h };
  }, [sizeMode, preset, customWmm, customHmm]);

  useEffect(() => {
    setElements(initDesignerElements(labelSize.w, labelSize.h));
    setSelectedId(null);
  }, [labelSize.w, labelSize.h]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setTemplates(parsed);
    } catch {
      // ignore
    }
  }, []);

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
      } catch {
        setProducts([]);
      }
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [productSearchValue]);

  const visibleElements = elements.filter((el) => el.visible);
  const lockedIds = elements.filter((el) => el.locked).map((el) => el.id);

  const texts = useMemo(
    () => ({
      header: headerText,
      name: nameText,
      sku: skuText,
      price: priceText,
    }),
    [headerText, nameText, skuText, priceText]
  );

  const productOptionLabel = (p: ProductWithCategory) => {
    const sku = p.sku ? ` (${p.sku})` : '';
    return `${p.name}${sku}`;
  };

  const selectedEl = useMemo(() => elements.find((el) => el.id === selectedId) || null, [elements, selectedId]);
  const barcodeValidation = useMemo(() => {
    if (!barcodeValue.trim()) return null;
    if (barcodeType === 'QR') return { ok: true };
    return validateProductBarcode({ type: barcodeType === 'EAN13' ? 'EAN13' : 'CODE128', value: barcodeValue });
  }, [barcodeType, barcodeValue]);

  useEffect(() => {
    if (barcodeType !== 'EAN13') return;
    const v = validateProductBarcode({ type: 'EAN13', value: barcodeValue });
    if (v.ok && v.normalizedValue && v.normalizedValue !== barcodeValue) {
      setBarcodeValue(v.normalizedValue);
    }
  }, [barcodeType, barcodeValue]);

  const updateElement = (id: ProductLabelElementId, patch: Partial<DesignerElement>) => {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, ...patch } : el)));
  };

  const handleLayerMove = (id: ProductLabelElementId, dir: -1 | 1) => {
    setElements((prev) => {
      const idx = prev.findIndex((el) => el.id === id);
      if (idx < 0) return prev;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(nextIdx, 0, item);
      return next;
    });
  };

  const handleLayerDrop = (id: ProductLabelElementId, targetId: ProductLabelElementId) => {
    if (id === targetId) return;
    setElements((prev) => {
      const next = [...prev];
      const fromIdx = next.findIndex((el) => el.id === id);
      const toIdx = next.findIndex((el) => el.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      return next;
    });
  };

  const outOfBounds = useMemo(() => {
    return elements
      .filter((el) => {
        if (!el.visible) return false;
        return el.xMm <= 0.1 || el.yMm <= 0.1 || el.xMm + el.wMm >= labelSize.w - 0.1 || el.yMm + el.hMm >= labelSize.h - 0.1;
      })
      .map((el) => el.id);
  }, [elements, labelSize.w, labelSize.h]);

  const minFontWarn = useMemo(() => {
    return elements.some((el) => el.kind === 'text' && (el.fontSizePt ?? 10) < 7);
  }, [elements]);

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) {
      toast({ title: 'Nomi kerak', description: 'Template nomini kiriting.', variant: 'destructive' });
      return;
    }
    const payload = {
      labelSize,
      sizeMode,
      preset,
      customWmm,
      customHmm,
      elements,
      gridSizeMm,
      showGrid,
      snapToGrid,
      showSafeArea,
      safePaddingMm,
      barcodeType,
      barcodeShowDigits,
      barcodeRotateDeg,
      barcodeQuietZoneMm,
    };
    const next = templates.filter((t) => t.name !== name).concat({ name, payload });
    setTemplates(next);
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next));
    toast({ title: 'Saqlangan', description: `Template: ${name}` });
  };

  const loadTemplate = (name: string) => {
    const found = templates.find((t) => t.name === name);
    if (!found) return;
    const p = found.payload;
    if (p?.labelSize) {
      setSizeMode(p.sizeMode || 'custom');
      setPreset(p.preset || '39x20');
      setCustomWmm(p.customWmm || p.labelSize.w || 39);
      setCustomHmm(p.customHmm || p.labelSize.h || 20);
    }
    if (Array.isArray(p?.elements)) setElements(p.elements);
    setGridSizeMm(p.gridSizeMm ?? 1);
    setShowGrid(Boolean(p.showGrid));
    setSnapToGrid(Boolean(p.snapToGrid));
    setShowSafeArea(Boolean(p.showSafeArea));
    setSafePaddingMm(p.safePaddingMm ?? 1.5);
    setBarcodeType(p.barcodeType || 'EAN13');
    setBarcodeShowDigits(Boolean(p.barcodeShowDigits));
    setBarcodeRotateDeg(p.barcodeRotateDeg ?? 0);
    setBarcodeQuietZoneMm(p.barcodeQuietZoneMm ?? 0);
    setSelectedId(null);
    setSelectedTemplate(name);
  };

  const deleteTemplate = (name: string) => {
    const next = templates.filter((t) => t.name !== name);
    setTemplates(next);
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next));
    if (selectedTemplate === name) setSelectedTemplate('');
  };

  const handlePrint = () => {
    const html = renderToStaticMarkup(
      <ProductLabelLayoutPrint
        widthMm={labelSize.w}
        heightMm={labelSize.h}
        copies={copies}
        barcodeType={barcodeType}
        barcodeValue={barcodeValue}
        showBarcodeDigits={barcodeShowDigits}
        barcodeRotateDeg={barcodeRotateDeg}
        barcodeQuietZoneMm={barcodeQuietZoneMm}
        texts={texts}
        showPrice
        layout={visibleElements}
      />
    );
    openPrintWindowLabel(html, { widthMm: labelSize.w, heightMm: labelSize.h });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Barcode Designer — Pro Mode</h1>
        <p className="text-muted-foreground mt-2">Erkin layout: drag, resize, font, align, show/hide.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Controls</CardTitle>
            <CardDescription>Faqat tanlangan element sozlamalari ko‘rinadi.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <section className="rounded border p-3 space-y-2">
              <div className="text-sm font-medium">Mahsulot</div>
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
                              setHeaderText((p.name || '').split(/\s+/)[0] || '');
                              setNameText(p.name || '');
                              setSkuText(p.sku ? String(p.sku) : '');
                              setPriceText(formatNumberUZ(Number(p.sale_price)));
                              if (p.barcode) {
                                setBarcodeValue(String(p.barcode));
                              }
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
                <div className="flex flex-wrap gap-2">
                  <div className="text-xs text-muted-foreground">SKU: {selectedProduct?.sku || '—'}</div>
                  <div className="text-xs text-muted-foreground">Narx: {selectedProduct ? formatNumberUZ(Number(selectedProduct.sale_price)) : '—'}</div>
                  <div className="text-xs text-muted-foreground">Kategoriya: {(selectedProduct as any)?.category?.name || '—'}</div>
                </div>
              </div>
            </section>

            <section className="rounded border p-3 space-y-2">
              <div className="text-sm font-medium">Data</div>
              <div className="grid grid-cols-1 gap-2">
                <Input value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Header/Brand" />
                <Input value={nameText} onChange={(e) => setNameText(e.target.value)} placeholder="Product name" />
                <Input value={skuText} onChange={(e) => setSkuText(e.target.value)} placeholder="SKU" />
                <Input value={priceText} onChange={(e) => setPriceText(e.target.value)} placeholder="Price" />
              </div>
            </section>

            <section className="rounded border p-3 space-y-2">
              <div className="text-sm font-medium">Templates</div>
              <div className="flex gap-2">
                <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template nomi" />
                <Button size="icon" variant="outline" onClick={saveTemplate}>
                  <Save className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-2">
                <Select value={selectedTemplate} onValueChange={loadTemplate}>
                  <SelectTrigger>
                    <SelectValue placeholder="Template tanlang" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.length === 0 && <SelectItem value="__none" disabled>Template yo‘q</SelectItem>}
                    {templates.map((t) => (
                      <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectedTemplate && deleteTemplate(selectedTemplate)}
                    disabled={!selectedTemplate}
                  >
                    <Trash2 className="h-3 w-3 mr-2" />
                    O‘chirish
                  </Button>
                  {selectedTemplate && (
                    <span className="text-xs text-muted-foreground">Tanlangan: {selectedTemplate}</span>
                  )}
                </div>
              </div>
            </section>

            {selectedEl ? (
              <section className="rounded border p-3 space-y-2">
                <div className="text-sm font-medium">Tanlangan element: {selectedEl.id}</div>
                {selectedEl.kind === 'text' ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>Font family</Label>
                        <Select
                          value={selectedEl.fontFamily || 'Arial'}
                          onValueChange={(v) => updateElement(selectedEl.id, { fontFamily: v })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Arial">Arial</SelectItem>
                            <SelectItem value="Inter">Inter</SelectItem>
                            <SelectItem value="Roboto">Roboto</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Font size</Label>
                        <Input
                          type="number"
                          value={selectedEl.fontSizePt ?? 10}
                          onChange={(e) => updateElement(selectedEl.id, { fontSizePt: Number(e.target.value) || 8 })}
                        />
                      </div>
                      <div>
                        <Label>Font weight</Label>
                        <Select
                          value={String(selectedEl.fontWeight ?? 600)}
                          onValueChange={(v) => updateElement(selectedEl.id, { fontWeight: Number(v) })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="400">400</SelectItem>
                            <SelectItem value="500">500</SelectItem>
                            <SelectItem value="600">600</SelectItem>
                            <SelectItem value="700">700</SelectItem>
                            <SelectItem value="800">800</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>Align</Label>
                        <Select value={selectedEl.align || 'left'} onValueChange={(v: any) => updateElement(selectedEl.id, { align: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="left">left</SelectItem>
                            <SelectItem value="center">center</SelectItem>
                            <SelectItem value="right">right</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Letter spacing (pt)</Label>
                        <Input
                          type="number"
                          value={selectedEl.letterSpacingPt ?? 0}
                          onChange={(e) => updateElement(selectedEl.id, { letterSpacingPt: Number(e.target.value) || 0 })}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={Boolean(selectedEl.uppercase)}
                        onCheckedChange={(v) => updateElement(selectedEl.id, { uppercase: Boolean(v) })}
                        id="uppercase"
                      />
                      <Label htmlFor="uppercase" className="cursor-pointer text-sm">Uppercase</Label>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>Barcode type</Label>
                        <Select value={barcodeType} onValueChange={(v: ProductLabelBarcodeType) => setBarcodeType(v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="EAN13">EAN-13</SelectItem>
                            <SelectItem value="CODE128">CODE128</SelectItem>
                            <SelectItem value="QR">QR</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Rotate</Label>
                        <Select value={String(barcodeRotateDeg)} onValueChange={(v) => setBarcodeRotateDeg(Number(v))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">0°</SelectItem>
                            <SelectItem value="90">90°</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>Barcode value</Label>
                        <Input value={barcodeValue} onChange={(e) => setBarcodeValue(e.target.value)} />
                        {barcodeValidation && !barcodeValidation.ok && (
                          <div className="text-xs text-destructive">{barcodeValidation.error}</div>
                        )}
                      </div>
                      <div>
                        <Label>Quiet zone (mm)</Label>
                        <Input
                          type="number"
                          value={barcodeQuietZoneMm}
                          onChange={(e) => setBarcodeQuietZoneMm(Number(e.target.value) || 0)}
                        />
                      </div>
                      <div className="flex items-center gap-2 mt-6">
                        <Checkbox checked={barcodeShowDigits} onCheckedChange={(v) => setBarcodeShowDigits(Boolean(v))} id="digits" />
                        <Label htmlFor="digits" className="cursor-pointer text-sm">Show digits</Label>
                      </div>
                    </div>
                  </>
                )}
              </section>
            ) : (
              <section className="rounded border p-3 space-y-2">
                <div className="text-sm font-medium">Canvas</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Label size</Label>
                    <Select value={sizeMode} onValueChange={(v: SizeMode) => setSizeMode(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="preset">Andoza</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Zoom</Label>
                    <Select value={String(zoom)} onValueChange={(v) => setZoom(Number(v))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0.5">50%</SelectItem>
                        <SelectItem value="1">100%</SelectItem>
                        <SelectItem value="1.5">150%</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {sizeMode === 'preset' ? (
                  <Select value={preset} onValueChange={(v: LabelPreset) => setPreset(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="39x20">{PRESETS['39x20'].label}</SelectItem>
                      <SelectItem value="50x30">{PRESETS['50x30'].label}</SelectItem>
                      <SelectItem value="58x40">{PRESETS['58x40'].label}</SelectItem>
                      <SelectItem value="70x35">{PRESETS['70x35'].label}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" value={customWmm} onChange={(e) => setCustomWmm(Number(e.target.value) || 0)} placeholder="W (mm)" />
                    <Input type="number" value={customHmm} onChange={(e) => setCustomHmm(Number(e.target.value) || 0)} placeholder="H (mm)" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2">
                    <Checkbox checked={showGrid} onCheckedChange={(v) => setShowGrid(Boolean(v))} id="grid" />
                    <Label htmlFor="grid" className="cursor-pointer text-sm">Grid</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox checked={snapToGrid} onCheckedChange={(v) => setSnapToGrid(Boolean(v))} id="snap" />
                    <Label htmlFor="snap" className="cursor-pointer text-sm">Snap</Label>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" value={gridSizeMm} onChange={(e) => setGridSizeMm(Number(e.target.value) || 1)} placeholder="Grid (mm)" />
                  <Input type="number" value={safePaddingMm} onChange={(e) => setSafePaddingMm(Number(e.target.value) || 0)} placeholder="Padding (mm)" />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={showSafeArea} onCheckedChange={(v) => setShowSafeArea(Boolean(v))} id="safe" />
                  <Label htmlFor="safe" className="cursor-pointer text-sm">Safe area</Label>
                </div>
              </section>
            )}

          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Print</CardTitle>
              <CardDescription>Nusxa soni va chop etish.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Label>Copies</Label>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={copies}
                  onChange={(e) => setCopies(Number(e.target.value) || 1)}
                  className="w-24"
                />
                <Button onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-2" />
                  Chop etish
                </Button>
              </div>
              {outOfBounds.length > 0 && (
                <div className="text-xs text-amber-700 mt-2">
                  Warning: {outOfBounds.join(', ')} label chegarasiga juda yaqin.
                </div>
              )}
              {minFontWarn && (
                <div className="text-xs text-amber-700">Warning: font size juda kichik.</div>
              )}
              {barcodeValidation && !barcodeValidation.ok && (
                <div className="text-xs text-destructive">Barcode noto‘g‘ri: {barcodeValidation.error}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Label Canvas</CardTitle>
              <CardDescription>Canvas = preview = print.</CardDescription>
            </CardHeader>
            <CardContent>
              <div ref={canvasRef} className="overflow-auto">
                <ProductLabelLayoutEditor
                  widthMm={labelSize.w}
                  heightMm={labelSize.h}
                  barcodeType={barcodeType}
                  barcodeValue={barcodeValue}
                  texts={texts}
                  showPrice
                  showBarcodeDigits={barcodeShowDigits}
                  barcodeRotateDeg={barcodeRotateDeg}
                  barcodeQuietZoneMm={barcodeQuietZoneMm}
                  showGrid={showGrid}
                  gridSizeMm={gridSizeMm}
                  snapToGrid={snapToGrid}
                  showSafeArea={showSafeArea}
                  safePaddingMm={safePaddingMm}
                  pxPerMm={6 * zoom}
                  value={visibleElements}
                  onChange={(next) => {
                    setElements((prev) =>
                      prev.map((el) => {
                        const updated = next.find((n) => n.id === el.id);
                        return updated ? { ...el, ...updated } : el;
                      })
                    );
                  }}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  lockedIds={lockedIds}
                />
              </div>
              {!elements.find((el) => el.id === 'barcode')?.visible && (
                <div className="text-xs text-muted-foreground mt-2">Barcode layer yashirilgan (Layers).</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Layers</CardTitle>
              <CardDescription>Ko‘rsatish, lock va tartibni boshqaring.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {elements.map((el) => (
                  <div
                    key={el.id}
                    draggable
                    onDragStart={() => setDragLayerId(el.id)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragLayerId && dragLayerId !== el.id) handleLayerDrop(dragLayerId, el.id);
                    }}
                    className={cn('flex items-center gap-2 rounded border px-2 py-1', selectedId === el.id && 'border-primary')}
                    onClick={() => setSelectedId(el.id)}
                  >
                    <Checkbox
                      checked={el.visible}
                      onCheckedChange={(v) => updateElement(el.id, { visible: Boolean(v) })}
                      id={`visible-${el.id}`}
                    />
                    <span className="text-sm flex-1">{el.id}</span>
                    <Button size="icon" variant="ghost" onClick={() => updateElement(el.id, { locked: !el.locked })}>
                      {el.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleLayerMove(el.id, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleLayerMove(el.id, 1)}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
