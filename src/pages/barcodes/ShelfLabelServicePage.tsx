import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ArrowLeft, Check, ChevronsUpDown, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProductWithCategory } from '@/types/database';
import { searchProducts } from '@/db/api';
import { formatMoneyUZS } from '@/lib/format';
import { openPrintWindowLabel } from '@/lib/print';
import ShelfLabelPrint from '@/components/print/ShelfLabelPrint';
import { useToast } from '@/hooks/use-toast';

type LabelPreset = '20x20' | '25x30' | '35x35';
type SizeMode = 'preset' | 'custom';

const PRESETS: Record<LabelPreset, { w: number; h: number; label: string }> = {
  '20x20': { w: 20, h: 20, label: '20×20' },
  '25x30': { w: 25, h: 30, label: '25×30' },
  '35x35': { w: 35, h: 35, label: '35×35' },
};

export default function ShelfLabelServicePage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchValue, setProductSearchValue] = useState('');
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductWithCategory | null>(null);

  const [labelName, setLabelName] = useState('');
  const [labelSku, setLabelSku] = useState('');
  const [labelPriceText, setLabelPriceText] = useState('');
  const [labelFieldsTouched, setLabelFieldsTouched] = useState(false);

  const [copies, setCopies] = useState(1);
  const [preset, setPreset] = useState<LabelPreset>('20x20');
  const [sizeMode, setSizeMode] = useState<SizeMode>('preset');
  const [customWmm, setCustomWmm] = useState<number>(20);
  const [customHmm, setCustomHmm] = useState<number>(20);

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
    if (!labelFieldsTouched) {
      setLabelName(selectedProduct.name || '');
      setLabelSku(selectedProduct.sku ? String(selectedProduct.sku) : '');
      setLabelPriceText(formatMoneyUZS(Number(selectedProduct.sale_price)).replace(' so‘m', ' uzs'));
    }
  }, [selectedProduct, labelFieldsTouched]);

  const presetSize = PRESETS[preset];
  const effectiveWmm = sizeMode === 'custom' ? customWmm : presetSize.w;
  const effectiveHmm = sizeMode === 'custom' ? customHmm : presetSize.h;

  const productOptionLabel = (p: ProductWithCategory) => {
    const sku = p.sku ? ` (${p.sku})` : '';
    return `${p.name}${sku}`;
  };

  const resolvedTexts = useMemo(() => {
    return {
      name: labelName || '',
      sku: labelSku || '',
      price: labelPriceText || '',
    };
  }, [labelName, labelSku, labelPriceText]);

  const doPrint = () => {
    try {
      const html = renderToStaticMarkup(
        <ShelfLabelPrint
          name={resolvedTexts.name}
          sku={resolvedTexts.sku}
          priceText={resolvedTexts.price}
          copies={copies}
          labelWidthMm={effectiveWmm}
          labelHeightMm={effectiveHmm}
        />
      );
      openPrintWindowLabel(html, {
        widthMm: effectiveWmm,
        heightMm: effectiveHmm,
      });
    } catch (e: any) {
      toast({
        title: 'Chop etish xatoligi',
        description: e?.message || 'Chop etib bo‘lmadi',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Shelf Label Service</h1>
          <p className="text-muted-foreground mt-2">
            Stelaj uchun nom + SKU + narx yorlig‘i (barcode yo‘q).
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/barcodes')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Orqaga
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Sozlamalar</CardTitle>
              <CardDescription>Mahsulot, o‘lcham va matnlarni tanlang.</CardDescription>
            </div>
            <Button onClick={doPrint} disabled={!labelName.trim()}>
              <Printer className="h-4 w-4 mr-2" />
              Chop etish
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Mahsulot</Label>
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
                              setLabelFieldsTouched(false);
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

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Yorliq o‘lchami</Label>
                <Select value={sizeMode} onValueChange={(v: SizeMode) => setSizeMode(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="preset">Preset</SelectItem>
                    <SelectItem value="custom">Qo‘lda (W/H)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Nusxa soni</Label>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={copies}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 1 && n <= 200) setCopies(n);
                  }}
                />
              </div>
            </div>

            {sizeMode === 'preset' ? (
              <div className="space-y-2">
                <Label>Preset</Label>
                <Select value={preset} onValueChange={(v: LabelPreset) => setPreset(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="20x20">{PRESETS['20x20'].label}</SelectItem>
                    <SelectItem value="25x30">{PRESETS['25x30'].label}</SelectItem>
                    <SelectItem value="35x35">{PRESETS['35x35'].label}</SelectItem>
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

            <div className="grid grid-cols-1 gap-3">
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
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
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

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (!selectedProduct) return;
                  setLabelName(selectedProduct.name || '');
                  setLabelSku(selectedProduct.sku ? String(selectedProduct.sku) : '');
                  setLabelPriceText(formatMoneyUZS(Number(selectedProduct.sale_price)).replace(' so‘m', ' uzs'));
                  setLabelFieldsTouched(false);
                }}
                disabled={!selectedProduct}
              >
                Mahsulotdan qayta qo‘yish
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>Chop etishda aynan shu ko‘rinish chiqadi.</CardDescription>
          </CardHeader>
          <CardContent>
            <ShelfLabelPrint
              name={resolvedTexts.name}
              sku={resolvedTexts.sku}
              priceText={resolvedTexts.price}
              copies={Math.min(copies, 6)}
              labelWidthMm={effectiveWmm}
              labelHeightMm={effectiveHmm}
            />
            <div className="mt-3 text-xs text-muted-foreground">
              Hozirgi o‘lcham: {effectiveWmm}×{effectiveHmm} mm
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
