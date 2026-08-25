import { useCallback, useEffect, useMemo, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Grid3x3,
  Eye,
  Minus,
  Plus,
  Printer,
  Redo2,
  Save,
  Undo2,
  LayoutGrid,
  PenLine,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { cn } from '@/lib/utils';
import ProductLabelLayoutEditor from '@/components/barcodes/ProductLabelLayoutEditor';
import { LabelSheetPrint } from '@/components/barcodes/ProductLabelLayoutPrint';
import BarcodeStudioGallery from '@/components/barcodes/studio/BarcodeStudioGallery';
import {
  PALETTE_ITEMS,
  addPaletteElement,
  defaultSheetLayout,
  duplicateTemplate,
  labelsPerSheet,
  loadTemplateIntoState,
  quickTemplatesForSize,
  useUndoRedo,
  type StudioView,
} from '@/components/barcodes/studio/barcodeStudioHelpers';
import type { BarcodeFormat, LabelElement, LabelPreviewData, LabelSheetLayout, LabelTemplate } from '@/lib/barcodes/labelModel';
import { LABEL_SIZE_PRESETS, newElementId, sortByZ } from '@/lib/barcodes/labelModel';
import { BUILTIN_LABEL_TEMPLATES } from '@/lib/barcodes/builtinTemplates';
import { upsertUserTemplate, loadUserLabelTemplates } from '@/lib/barcodes/labelTemplateStore';
import { previewDataFromProduct } from '@/lib/barcodes/labelDataResolver';
import { openPrintWindowLabel, openPrintWindowLabelSheet } from '@/lib/print';
import { useToast } from '@/hooks/use-toast';
import { searchProducts } from '@/db/api';
import type { ProductWithCategory } from '@/types/database';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronsUpDown } from 'lucide-react';

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.4, 1.75, 2, 2.5, 3];

export default function BarcodeStudioPage() {
  const { toast } = useToast();
  const [view, setView] = useState<StudioView>('designer');

  const [widthMm, setWidthMm] = useState(40);
  const [heightMm, setHeightMm] = useState(30);
  const [background, setBackground] = useState<string | undefined>();
  const [templateId, setTemplateId] = useState('40x30-klassik');
  const [templateName, setTemplateName] = useState('Klassik');
  const [isBuiltin, setIsBuiltin] = useState(true);

  const elementsUndo = useUndoRedo<LabelElement[]>(BUILTIN_LABEL_TEMPLATES[5].elements);
  const elements = elementsUndo.present;
  const setElements = elementsUndo.set;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [defaultBarcodeType, setDefaultBarcodeType] = useState<BarcodeFormat>('EAN13');
  const [zoomIdx, setZoomIdx] = useState(4);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showSafeArea, setShowSafeArea] = useState(true);
  const [sheet, setSheet] = useState<LabelSheetLayout>(defaultSheetLayout);
  const [previewData, setPreviewData] = useState<LabelPreviewData>(() =>
    previewDataFromProduct({ name: 'Hi-Tech Plafon', sale_price: 195000, sku: 'DH1-006', barcode: '3008475700156' })
  );
  const [savedTemplates, setSavedTemplates] = useState<LabelTemplate[]>([]);

  const [productOpen, setProductOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<ProductWithCategory[]>([]);

  const zoom = ZOOM_STEPS[zoomIdx] ?? 1.4;
  const pxPerMm = 6 * zoom;
  const selectedEl = useMemo(() => elements.find((e) => e.id === selectedId) ?? null, [elements, selectedId]);

  useEffect(() => {
    loadUserLabelTemplates().then(setSavedTemplates).catch(() => {});
  }, []);

  useEffect(() => {
    const term = productSearch.trim();
    if (term.length < 2) {
      setProducts([]);
      return;
    }
    const t = setTimeout(() => searchProducts(term).then(setProducts).catch(() => setProducts([])), 250);
    return () => clearTimeout(t);
  }, [productSearch]);

  const applyTemplate = useCallback(
    (tpl: LabelTemplate) => {
      const s = loadTemplateIntoState(tpl);
      setWidthMm(s.widthMm);
      setHeightMm(s.heightMm);
      setBackground(s.background);
      setTemplateId(s.templateId);
      setTemplateName(s.templateName);
      setIsBuiltin(s.isBuiltin);
      setElements(s.elements);
      setSelectedId(null);
      setView('designer');
    },
    [setElements]
  );

  const updateElement = (id: string, patch: Partial<LabelElement>) => {
    setElements(elements.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const handleSaveTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      toast({ title: 'Nom kerak', variant: 'destructive' });
      return;
    }
    const tpl: LabelTemplate = {
      id: isBuiltin ? newElementId() : templateId,
      name,
      widthMm,
      heightMm,
      elements: sortByZ(elements),
      background,
      builtin: false,
      updatedAt: new Date().toISOString(),
    };
    try {
      const saved = await upsertUserTemplate(tpl);
      setTemplateId(saved.id);
      setIsBuiltin(false);
      setSavedTemplates(await loadUserLabelTemplates());
      toast({ title: 'Shablon saqlandi', description: name });
    } catch (e: any) {
      toast({ title: 'Xatolik', description: e?.message || 'Saqlash amalga oshmadi', variant: 'destructive' });
    }
  };

  const handleDuplicate = () => {
    const src: LabelTemplate = {
      id: templateId,
      name: templateName,
      widthMm,
      heightMm,
      elements,
      background,
    };
    const copy = duplicateTemplate(src);
    applyTemplate(copy);
    toast({ title: 'Nusxa yaratildi', description: copy.name });
  };

  const handlePrint = () => {
    const template: LabelTemplate = {
      id: templateId,
      name: templateName,
      widthMm,
      heightMm,
      elements,
      background,
    };
    const html = renderToStaticMarkup(
      <LabelSheetPrint template={template} previewDataList={[previewData]} sheet={sheet} copiesPerLabel={1} />
    );
    if (sheet.paper === 'Roll') {
      openPrintWindowLabel(html, { widthMm, heightMm });
    } else {
      openPrintWindowLabelSheet(html, { paper: sheet.paper });
    }
  };

  const perPage = labelsPerSheet(widthMm, heightMm, sheet);

  const handleKeyUndo = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        elementsUndo.undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        elementsUndo.redo();
      }
    },
    [elementsUndo]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyUndo);
    return () => window.removeEventListener('keydown', handleKeyUndo);
  }, [handleKeyUndo]);

  const quickTpl = quickTemplatesForSize(widthMm, heightMm);

  if (view === 'gallery') {
    return (
      <div className="container mx-auto max-w-[1340px] space-y-6 p-4 md:p-6">
        <StudioHeader view={view} onViewChange={setView} />
        <BarcodeStudioGallery onSelect={applyTemplate} />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-[1340px] space-y-4 p-4 md:p-6">
      <StudioHeader view={view} onViewChange={setView} />

      <div className="overflow-hidden rounded-2xl border bg-card shadow-lg">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-gradient-to-b from-card to-muted/20 px-3 py-2.5">
          <div className="flex items-center gap-2 font-bold text-sm">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <LayoutGrid className="h-4 w-4" />
            </div>
            Barcode Studio
          </div>
          <div className="hidden h-6 w-px bg-border sm:block" />
          <Select
            value={`${widthMm}x${heightMm}`}
            onValueChange={(v) => {
              const p = LABEL_SIZE_PRESETS.find((x) => x.key === v);
              if (p) {
                setWidthMm(p.w);
                setHeightMm(p.h);
                const first = quickTemplatesForSize(p.w, p.h)[0];
                if (first) applyTemplate(first);
              }
            }}
          >
            <SelectTrigger className="h-9 w-[140px] text-xs font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LABEL_SIZE_PRESETS.map((p) => (
                <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={defaultBarcodeType} onValueChange={(v: BarcodeFormat) => setDefaultBarcodeType(v)}>
            <SelectTrigger className="h-9 w-[110px] text-xs font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EAN13">EAN-13</SelectItem>
              <SelectItem value="CODE128">CODE128</SelectItem>
              <SelectItem value="QR">QR</SelectItem>
            </SelectContent>
          </Select>
          <div className="hidden h-6 w-px bg-border sm:block" />
          <Button size="icon" variant="outline" className="h-8 w-8" disabled={!elementsUndo.canUndo} onClick={elementsUndo.undo}>
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="outline" className="h-8 w-8" disabled={!elementsUndo.canRedo} onClick={elementsUndo.redo}>
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant={snapToGrid ? 'default' : 'outline'}
            className="h-8 w-8"
            onClick={() => setSnapToGrid((s) => !s)}
            title="Snap to grid"
          >
            <Grid3x3 className="h-4 w-4" />
          </Button>
          <div className="flex items-center rounded-lg border bg-background">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}>
              <Minus className="h-3 w-3" />
            </Button>
            <span className="w-12 text-center text-xs font-bold">{Math.round(zoom * 100)}%</span>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex-1" />
          <Popover open={productOpen} onOpenChange={setProductOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs">
                <ChevronsUpDown className="mr-1 h-3 w-3" />
                Mahsulot
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="end">
              <Command>
                <CommandInput placeholder="Qidirish..." value={productSearch} onValueChange={setProductSearch} />
                <CommandList>
                  <CommandEmpty>Topilmadi</CommandEmpty>
                  <CommandGroup>
                    {products.slice(0, 15).map((p) => (
                      <CommandItem
                        key={p.id}
                        onSelect={() => {
                          setPreviewData(previewDataFromProduct(p));
                          setProductOpen(false);
                        }}
                      >
                        <Check className="mr-2 h-4 w-4 opacity-0" />
                        {p.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="sm" className="text-xs" onClick={handleDuplicate}>
            Shablondan nusxa
          </Button>
          <Button variant="outline" size="sm" className="text-xs" onClick={handleSaveTemplate}>
            <Save className="mr-1 h-3.5 w-3.5" />
            Saqlash
          </Button>
          <Button size="sm" className="text-xs" onClick={handlePrint}>
            <Printer className="mr-1 h-3.5 w-3.5" />
            Chop etish
          </Button>
        </div>

        <div className="grid min-h-[560px] grid-cols-1 lg:grid-cols-[232px_1fr_268px]">
          {/* Left palette */}
          <div className="border-b lg:border-b-0 lg:border-r bg-muted/20 overflow-auto">
            <div className="border-b p-3">
              <h4 className="mb-2 text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                Elementlar
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {PALETTE_ITEMS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="rounded-xl border bg-card p-2 text-center text-[10px] font-bold text-muted-foreground transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm motion-reduce:transition-none"
                    onClick={() => setElements(addPaletteElement(elements, item, widthMm, heightMm))}
                  >
                    <div className="mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <PenLine className="h-3.5 w-3.5" />
                    </div>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                  Tezkor shablonlar
                </h4>
                <button type="button" className="text-[10px] font-bold text-primary" onClick={() => setView('gallery')}>
                  Hammasi →
                </button>
              </div>
              {quickTpl.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className={cn(
                    'mb-2 flex w-full items-center gap-2 rounded-lg border bg-card p-2 text-left transition hover:border-primary/30',
                    templateId === tpl.id && 'border-primary bg-primary/5'
                  )}
                  onClick={() => applyTemplate(tpl)}
                >
                  <div className="h-7 w-10 shrink-0 rounded border bg-muted" />
                  <div>
                    <div className="text-xs font-bold">{tpl.name}</div>
                    <div className="text-[10px] text-muted-foreground">{tpl.widthMm}×{tpl.heightMm}</div>
                  </div>
                </button>
              ))}
              {savedTemplates.length > 0 && (
                <>
                  <h4 className="mb-2 mt-3 text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    Saqlangan
                  </h4>
                  {savedTemplates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="mb-2 flex w-full items-center gap-2 rounded-lg border bg-card p-2 text-left text-xs font-semibold hover:border-primary/30"
                      onClick={() => applyTemplate(t)}
                    >
                      {t.name}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Canvas */}
          <div
            className="relative flex items-center justify-center overflow-auto p-6"
            style={{
              background: `
                linear-gradient(#f4f6f3,#eef1ee),
                repeating-linear-gradient(0deg,#e5e9e4 0 1px,transparent 1px 22px),
                repeating-linear-gradient(90deg,#e5e9e4 0 1px,transparent 1px 22px)`,
            }}
          >
            <ProductLabelLayoutEditor
              widthMm={widthMm}
              heightMm={heightMm}
              previewData={previewData}
              background={background}
              showGrid={snapToGrid}
              gridSizeMm={0.5}
              snapToGrid={snapToGrid}
              showSafeArea={showSafeArea}
              safePaddingMm={1}
              pxPerMm={pxPerMm}
              showRulers
              value={elements}
              onChange={setElements}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>

          {/* Properties */}
          <div className="border-t lg:border-t-0 lg:border-l bg-muted/20 overflow-auto p-3 space-y-3">
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Shablon nomi</Label>
              <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="h-9 mt-1" />
            </div>
            {selectedEl ? (
              <PropertiesPanel
                el={selectedEl}
                defaultBarcodeType={defaultBarcodeType}
                onChange={(patch) => updateElement(selectedEl.id, patch)}
                onDelete={() => {
                  setElements(elements.filter((e) => e.id !== selectedEl.id));
                  setSelectedId(null);
                }}
                onLayer={(dir) => {
                  const sorted = sortByZ(elements);
                  const idx = sorted.findIndex((e) => e.id === selectedEl.id);
                  const next = [...sorted];
                  const swap = idx + dir;
                  if (swap < 0 || swap >= next.length) return;
                  const zA = next[idx].z ?? idx;
                  const zB = next[swap].z ?? swap;
                  next[idx] = { ...next[idx], z: zB };
                  next[swap] = { ...next[swap], z: zA };
                  setElements(next);
                }}
              />
            ) : (
              <p className="text-xs text-muted-foreground">Elementni tanlang yoki palette dan qo&apos;shing.</p>
            )}
            <div className="space-y-2 rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Xavfsiz zona</Label>
                <Switch checked={showSafeArea} onCheckedChange={setShowSafeArea} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Fon rangi</Label>
                <Input
                  type="color"
                  className="h-8 w-14 p-1"
                  value={background || '#ffffff'}
                  onChange={(e) => setBackground(e.target.value === '#ffffff' ? undefined : e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Sheet bar */}
        <div className="flex flex-wrap items-center gap-4 border-t bg-gradient-to-b from-muted/20 to-card px-4 py-2.5">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
            Varaq joylashuvi
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Qog&apos;oz</span>
            <Select
              value={sheet.paper}
              onValueChange={(v: LabelSheetLayout['paper']) => setSheet((s) => ({ ...s, paper: v }))}
            >
              <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="A4">A4</SelectItem>
                <SelectItem value="A5">A5</SelectItem>
                <SelectItem value="Roll">Roll</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(['cols', 'rows', 'gapMm'] as const).map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                {key === 'cols' ? 'Ustun' : key === 'rows' ? 'Qator' : 'Oraliq'}
              </span>
              <div className="flex items-center rounded-lg border bg-background">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() =>
                    setSheet((s) => ({
                      ...s,
                      [key]: Math.max(key === 'gapMm' ? 0 : 1, (s[key] as number) - (key === 'gapMm' ? 0.5 : 1)),
                    }))
                  }
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-10 text-center text-xs font-bold">
                  {key === 'gapMm' ? `${sheet.gapMm}mm` : sheet[key]}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() =>
                    setSheet((s) => ({
                      ...s,
                      [key]: (s[key] as number) + (key === 'gapMm' ? 0.5 : 1),
                    }))
                  }
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
          <span className="text-xs text-muted-foreground">
            Bir varaqda: <b className="text-primary">{perPage} ta</b> etiketka
          </span>
          <SheetMiniPreview cols={sheet.cols} rows={sheet.rows} />
        </div>
      </div>
    </div>
  );
}

function StudioHeader({ view, onViewChange }: { view: StudioView; onViewChange: (v: StudioView) => void }) {
  return (
    <div className="space-y-4 text-center">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-primary">DunyoZamin POS · Etiketka</div>
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Barcode Studio</h1>
        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
          Dizayner va tayyor shablonlar bitta joyda. Galereyadan tanlang, moslang, chop eting.
        </p>
      </div>
      <div className="flex justify-center">
        <div className="inline-flex rounded-full border bg-card p-1 shadow-sm">
          <Button
            size="sm"
            variant={view === 'designer' ? 'default' : 'ghost'}
            className="rounded-full px-5"
            onClick={() => onViewChange('designer')}
          >
            <PenLine className="mr-2 h-4 w-4" />
            Dizayner
          </Button>
          <Button
            size="sm"
            variant={view === 'gallery' ? 'default' : 'ghost'}
            className="rounded-full px-5"
            onClick={() => onViewChange('gallery')}
          >
            <Eye className="mr-2 h-4 w-4" />
            Shablonlar
            <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold">25</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function SheetMiniPreview({ cols, rows }: { cols: number; rows: number }) {
  const cells = Math.min(cols * rows, 12);
  return (
    <div
      className="ml-auto grid gap-0.5 rounded border bg-card p-1"
      style={{
        width: 84,
        height: 54,
        gridTemplateColumns: `repeat(${Math.min(cols, 4)}, 1fr)`,
      }}
    >
      {Array.from({ length: cells }, (_, i) => (
        <div key={i} className="rounded-sm border border-primary/20 bg-primary/10" />
      ))}
    </div>
  );
}

function PropertiesPanel({
  el,
  defaultBarcodeType,
  onChange,
  onDelete,
  onLayer,
}: {
  el: LabelElement;
  defaultBarcodeType: BarcodeFormat;
  onChange: (patch: Partial<LabelElement>) => void;
  onDelete: () => void;
  onLayer: (dir: -1 | 1) => void;
}) {
  const isCode = el.kind === 'barcode' || el.kind === 'qr';
  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="text-xs font-bold capitalize">{el.kind} · {el.data || el.text || '—'}</div>

      {el.kind === 'text' && (
        <>
          <div>
            <Label className="text-[10px]">Ma&apos;lumot</Label>
            <Select value={el.data || 'static_text'} onValueChange={(v) => onChange({ data: v as any })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="product_name">Mahsulot nomi</SelectItem>
                <SelectItem value="price">Narx</SelectItem>
                <SelectItem value="old_price">Eski narx</SelectItem>
                <SelectItem value="discount_pct">Chegirma %</SelectItem>
                <SelectItem value="sku">SKU</SelectItem>
                <SelectItem value="unit">Birlik</SelectItem>
                <SelectItem value="date">Sana</SelectItem>
                <SelectItem value="store_name">Do&apos;kon</SelectItem>
                <SelectItem value="static_text">Statik matn</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {el.data === 'static_text' && (
            <Input value={el.text || ''} onChange={(e) => onChange({ text: e.target.value })} className="h-8 text-xs" />
          )}
          {(el.data === 'price' || el.data === 'old_price') && (
            <>
              <div>
                <Label className="text-[10px]">Format</Label>
                <Select value={el.priceFormat || 'dot_som'} onValueChange={(v) => onChange({ priceFormat: v as any })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dot_som">1.234.567 (nuqta bilan)</SelectItem>
                    <SelectItem value="dot">1.234.567 (so&apos;msiz)</SelectItem>
                    <SelectItem value="plain">Oddiy raqam</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(el.priceFormat || 'dot_som') === 'dot_som' && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="show-currency"
                    checked={el.showCurrency !== false}
                    onCheckedChange={(v) => onChange({ showCurrency: Boolean(v) })}
                  />
                  <Label htmlFor="show-currency" className="cursor-pointer text-[10px]">
                    So&apos;m ko&apos;rsatish
                  </Label>
                </div>
              )}
            </>
          )}
          {el.data === 'sku' && (
            <>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-sku"
                  checked={el.visible !== false}
                  onCheckedChange={(v) => onChange({ visible: Boolean(v) })}
                />
                <Label htmlFor="show-sku" className="cursor-pointer text-[10px]">
                  SKU ko&apos;rsatish
                </Label>
              </div>
              {el.visible !== false && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="show-sku-prefix"
                    checked={el.showSkuPrefix !== false}
                    onCheckedChange={(v) => onChange({ showSkuPrefix: Boolean(v) })}
                  />
                  <Label htmlFor="show-sku-prefix" className="cursor-pointer text-[10px]">
                    SKU: prefiksi
                  </Label>
                </div>
              )}
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Shrift o&apos;lchami</Label>
              <Input type="number" className="h-8 text-xs" value={el.fontSizePt ?? 10} onChange={(e) => onChange({ fontSizePt: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-[10px]">Qalinlik</Label>
              <Input type="number" className="h-8 text-xs" value={el.fontWeight ?? 600} onChange={(e) => onChange({ fontWeight: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            <Label className="text-[10px]">Hizalash</Label>
            <Select value={el.align || 'left'} onValueChange={(v) => onChange({ align: v as any })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Chap</SelectItem>
                <SelectItem value="center">Markaz</SelectItem>
                <SelectItem value="right">O&apos;ng</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">Rang</Label>
            <Input type="color" className="h-8 w-full" value={el.color || '#16201b'} onChange={(e) => onChange({ color: e.target.value })} />
          </div>
        </>
      )}

      {isCode && (
        <>
          <div>
            <Label className="text-[10px]">Barkod turi</Label>
            <Select
              value={el.barcodeType || defaultBarcodeType}
              onValueChange={(v) => onChange({ barcodeType: v as BarcodeFormat, kind: v === 'QR' ? 'qr' : 'barcode' })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="EAN13">EAN-13</SelectItem>
                <SelectItem value="CODE128">CODE128</SelectItem>
                <SelectItem value="QR">QR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Raqam ko&apos;rsatish</Label>
            <Switch checked={Boolean(el.showValue)} onCheckedChange={(v) => onChange({ showValue: v })} />
          </div>
          <div>
            <Label className="text-[10px]">Modul kengligi</Label>
            <Input type="number" min={1} max={4} className="h-8 text-xs" value={el.moduleWidth ?? 2} onChange={(e) => onChange({ moduleWidth: Number(e.target.value) })} />
          </div>
        </>
      )}

      <div>
        <Label className="text-[10px] mb-1 block">Joylashuv (mm)</Label>
        <div className="grid grid-cols-4 gap-1">
          {(['x', 'y', 'w', 'h'] as const).map((k) => (
            <Input
              key={k}
              type="number"
              step={0.5}
              className="h-8 text-xs text-center uppercase"
              value={el[k]}
              onChange={(e) => onChange({ [k]: Number(e.target.value) })}
            />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={String(el.rotation ?? 0)} onValueChange={(v) => onChange({ rotation: Number(v) as any })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Burchak" /></SelectTrigger>
          <SelectContent>
            {[0, 90, 180, 270].map((d) => (
              <SelectItem key={d} value={String(d)}>{d}°</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => onLayer(-1)}>Orqa</Button>
          <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => onLayer(1)}>Old</Button>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Ko&apos;rinadi</Label>
          <Switch checked={el.visible !== false} onCheckedChange={(v) => onChange({ visible: v })} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Qulflangan</Label>
          <Switch checked={Boolean(el.locked)} onCheckedChange={(v) => onChange({ locked: v })} />
        </div>
      </div>
      <Button size="sm" variant="destructive" className="w-full" onClick={onDelete}>
        O&apos;chirish (Del)
      </Button>
    </div>
  );
}
