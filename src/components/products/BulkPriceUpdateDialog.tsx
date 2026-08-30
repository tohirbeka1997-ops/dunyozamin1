import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { formatMoneyUZS } from '@/lib/format';
import { getProducts } from '@/db/api';
import {
  bulkAdjustPrices,
  getLastBulkPriceBatch,
  undoBulkPriceUpdate,
  type BulkPriceField,
  type BulkPriceMode,
  type LastBulkPriceBatch,
} from '@/db/products.api';
import type { Category, ProductWithCategory } from '@/types/database';
import { Search, RotateCcw, Loader2 } from 'lucide-react';
import { filterProductsBySearchTerm } from '@/lib/productSearchMatch';
import {
  computeBulkNewPrice,
  isBulkPercentDecreaseBlocked,
} from '@/lib/posHardening';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  defaultCategoryId?: string;
  onApplied?: () => void;
};

const FIELD_LABELS: Record<BulkPriceField, string> = {
  sale: 'Sotuv narxi',
  purchase: 'Tannarx',
  master: 'Yirik optom narxi',
};

function priceOf(product: ProductWithCategory, field: BulkPriceField): number {
  if (field === 'purchase') return Number(product.purchase_price ?? 0) || 0;
  if (field === 'master') return Number((product as any).master_price ?? 0) || 0;
  return Number(product.sale_price ?? 0) || 0;
}

export default function BulkPriceUpdateDialog({
  open,
  onOpenChange,
  categories,
  defaultCategoryId,
  onApplied,
}: Props) {
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>(defaultCategoryId || 'all');

  const [field, setField] = useState<BulkPriceField>('sale');
  const [mode, setMode] = useState<BulkPriceMode>('percent');
  const [percent, setPercent] = useState('10');
  const [amount, setAmount] = useState('1000');
  const [exact, setExact] = useState('0');
  const [roundTo, setRoundTo] = useState('1000');
  const [reason, setReason] = useState('');

  const [applying, setApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastBatch, setLastBatch] = useState<LastBulkPriceBatch>(null);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getProducts(false, {
      status: 'active',
      categoryId: categoryId !== 'all' ? categoryId : undefined,
      sortBy: 'name',
      sortOrder: 'asc',
      limit: 100000,
      offset: 0,
    })
      .then((rows) => {
        if (cancelled) return;
        setProducts(Array.isArray(rows) ? rows : []);
        setSelectedIds(new Set());
      })
      .catch((err) => {
        if (cancelled) return;
        toast({
          title: 'Mahsulotlarni yuklab bo\'lmadi',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
        setProducts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, categoryId, toast]);

  useEffect(() => {
    if (!open) return;
    setCategoryId(defaultCategoryId || 'all');
    setSearch('');
    setReason('');
    void refreshLastBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const refreshLastBatch = async () => {
    try {
      setLastBatch(await getLastBulkPriceBatch());
    } catch {
      setLastBatch(null);
    }
  };

  const visibleProducts = useMemo(
    () => filterProductsBySearchTerm(products, search),
    [products, search],
  );

  const params = useMemo(
    () => ({
      percent: Number(percent.replace(',', '.')) || 0,
      amount: Number(amount.replace(/\s/g, '').replace(',', '.')) || 0,
      exact: Number(exact.replace(/\s/g, '').replace(',', '.')) || 0,
      roundTo: Number(roundTo.replace(/\s/g, '')) || 0,
    }),
    [percent, amount, exact, roundTo]
  );

  const percentBlocked =
    field === 'sale' && mode === 'percent' && isBulkPercentDecreaseBlocked(params.percent);

  type PreviewRow = {
    id: string;
    name: string;
    sku: string;
    oldPrice: number;
    newPrice: number;
    invalid: boolean;
    belowCost: boolean;
  };

  const preview = useMemo(() => {
    const out: PreviewRow[] = [];
    for (const p of products) {
      if (!selectedIds.has(p.id)) continue;
      const oldPrice = priceOf(p, field);
      if (field === 'master' && mode !== 'set' && oldPrice <= 0) continue;
      const newPrice = computeBulkNewPrice(oldPrice, {
        mode,
        percent: params.percent,
        amount: params.amount,
        exact: params.exact,
        roundTo: params.roundTo,
      });
      if (!Number.isFinite(newPrice) || newPrice === oldPrice) {
        if (field === 'sale' && Number.isFinite(newPrice) && !(newPrice > 0) && newPrice !== oldPrice) {
          out.push({
            id: p.id,
            name: p.name,
            sku: p.sku,
            oldPrice,
            newPrice,
            invalid: true,
            belowCost: false,
          });
        }
        continue;
      }
      const invalid = field === 'sale' && !(newPrice > 0);
      const cost = Number(p.purchase_price ?? 0) || 0;
      const belowCost = field === 'sale' && !invalid && cost > 0 && newPrice < cost;
      out.push({
        id: p.id,
        name: p.name,
        sku: p.sku,
        oldPrice,
        newPrice,
        invalid,
        belowCost,
      });
    }
    return out;
  }, [products, selectedIds, field, mode, params]);

  const invalidRows = useMemo(() => preview.filter((r) => r.invalid), [preview]);
  const validPreview = useMemo(() => preview.filter((r) => !r.invalid), [preview]);
  const belowCostCount = useMemo(
    () => validPreview.filter((r) => r.belowCost).length,
    [validPreview],
  );
  const confirmDisabled =
    applying ||
    validPreview.length === 0 ||
    invalidRows.length > 0 ||
    percentBlocked ||
    (field === 'sale' && !String(reason).trim());

  const impactSummary = useMemo(() => {
    let up = 0;
    let down = 0;
    let delta = 0;
    for (const row of validPreview) {
      const d = row.newPrice - row.oldPrice;
      delta += d;
      if (d > 0) up += 1;
      else if (d < 0) down += 1;
    }
    return { up, down, delta, count: validPreview.length };
  }, [validPreview]);

  const allVisibleSelected =
    visibleProducts.length > 0 && visibleProducts.every((p) => selectedIds.has(p.id));

  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of visibleProducts) {
        if (checked) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const buildPayload = () => {
    const base: any = {
      product_ids: validPreview.map((p) => p.id),
      field,
      mode,
      reason: String(reason).trim() || undefined,
    };
    if (mode === 'percent') base.percent = params.percent;
    if (mode === 'amount') base.amount = params.amount;
    if (mode === 'set') base.exact_price = params.exact;
    if (mode === 'round') base.round_to = params.roundTo > 0 ? params.roundTo : 1000;
    return base;
  };

  const requestApply = () => {
    if (percentBlocked) {
      toast({
        title: 'Noto\'g\'ri foiz',
        description: '-100% va undan past kamaytirish taqiqlangan (narx 0 bo\'ladi).',
        variant: 'destructive',
      });
      return;
    }
    if (invalidRows.length > 0) {
      toast({
        title: 'Noto\'g\'ri narx',
        description: `${invalidRows.length} ta mahsulotda yangi sotuv narxi 0 yoki manfiy. Qo'llash bloklangan.`,
        variant: 'destructive',
      });
      return;
    }
    if (validPreview.length === 0) {
      toast({
        title: 'O\'zgarish yo\'q',
        description: 'Tanlangan mahsulotlarda narx o\'zgarmaydi.',
      });
      return;
    }
    if (field === 'sale' && !String(reason).trim()) {
      toast({
        title: 'Sabab majburiy',
        description: 'Ommaviy sotuv narxi uchun sabab kiriting.',
        variant: 'destructive',
      });
      return;
    }
    setConfirmOpen(true);
  };

  const applyNow = async () => {
    setConfirmOpen(false);
    setApplying(true);
    try {
      const payload = buildPayload();
      const result = await bulkAdjustPrices(payload);
      toast({
        title: 'Narxlar yangilandi',
        description: `${result.count} ta mahsulot yangilandi (${FIELD_LABELS[field]}).`,
      });
      onApplied?.();
      await refreshLastBatch();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Xatolik',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setApplying(false);
    }
  };

  const handleUndo = async () => {
    setUndoing(true);
    try {
      const result = await undoBulkPriceUpdate(lastBatch?.batch_id ?? null);
      const skipped = Number(result.skipped ?? 0) || 0;
      toast({
        title: 'Orqaga qaytarildi',
        description:
          skipped > 0
            ? `${result.reverted} ta o\'zgarish bekor qilindi. ${skipped} ta mahsulot ommaviy amaldan keyin qo\'lda tahrirlangani uchun o\'tkazib yuborildi.`
            : `${result.reverted} ta o\'zgarish bekor qilindi.`,
      });
      onApplied?.();
      await refreshLastBatch();
      setCategoryId((c) => c);
      const rows = await getProducts(false, {
        status: 'active',
        categoryId: categoryId !== 'all' ? categoryId : undefined,
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 100000,
        offset: 0,
      });
      setProducts(Array.isArray(rows) ? rows : []);
    } catch (err) {
      toast({
        title: 'Orqaga qaytarib bo\'lmadi',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setUndoing(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[1100px] max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Ommaviy narx yangilash</DialogTitle>
            <DialogDescription>
              Mahsulotlarni tanlang, narx o'zgarish turini belgilang va tasdiqlashdan oldin
              "eski narx → yangi narx" jadvalini ko'ring. Sotuv narxi 0 yoki manfiy bo'lishi mumkin emas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto md:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-h-0 flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="relative h-9 flex-1">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Qidirish (nomi / SKU / barcode)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 pl-8"
                    aria-label="Mahsulot qidirish"
                  />
                </div>
                <div className="w-44">
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Kategoriya" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Barcha kategoriyalar</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Tanlangan: <span className="font-medium text-foreground">{selectedIds.size}</span> /{' '}
                  {visibleProducts.length}
                </span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Tanlovni tozalash
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead className="w-[44px]">
                        <Checkbox
                          checked={allVisibleSelected}
                          onCheckedChange={(c) => toggleAllVisible(Boolean(c))}
                          aria-label="Hammasini tanlash"
                        />
                      </TableHead>
                      <TableHead>Mahsulot</TableHead>
                      <TableHead className="text-right">{FIELD_LABELS[field]}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                        </TableCell>
                      </TableRow>
                    ) : visibleProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                          Mahsulot topilmadi
                        </TableCell>
                      </TableRow>
                    ) : (
                      visibleProducts.map((p) => (
                        <TableRow
                          key={p.id}
                          className="cursor-pointer"
                          onClick={() => toggleOne(p.id, !selectedIds.has(p.id))}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(p.id)}
                              onCheckedChange={(c) => toggleOne(p.id, Boolean(c))}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{p.name}</div>
                            <div className="font-mono text-xs text-muted-foreground">{p.sku}</div>
                          </TableCell>
                          <TableCell className="text-right">{formatMoneyUZS(priceOf(p, field))}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label>Qaysi narx</Label>
                <Select value={field} onValueChange={(v) => setField(v as BulkPriceField)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sale">{FIELD_LABELS.sale}</SelectItem>
                    <SelectItem value="purchase">{FIELD_LABELS.purchase}</SelectItem>
                    <SelectItem value="master">{FIELD_LABELS.master}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>O'zgarish turi</Label>
                <RadioGroup
                  value={mode}
                  onValueChange={(v) => setMode(v as BulkPriceMode)}
                  className="gap-2"
                >
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="percent" /> Foiz (%) oshirish / kamaytirish
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="amount" /> Belgilangan summa qo'shish / ayirish
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="set" /> Aniq narx o'rnatish
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="round" /> Yaxlitlash (yaxlitlash qadami)
                  </label>
                </RadioGroup>
              </div>

              <div className="space-y-2">
                {mode === 'percent' && (
                  <div className="space-y-1">
                    <Label htmlFor="bulk-percent">Foiz (manfiy = kamaytirish)</Label>
                    <Input
                      id="bulk-percent"
                      value={percent}
                      onChange={(e) => setPercent(e.target.value)}
                      inputMode="decimal"
                      placeholder="masalan: 10 yoki -5"
                    />
                    {percentBlocked ? (
                      <p className="text-xs text-destructive">
                        -100% va undan past taqiqlangan (yakuniy narx ≤ 0).
                      </p>
                    ) : null}
                  </div>
                )}
                {mode === 'amount' && (
                  <div className="space-y-1">
                    <Label htmlFor="bulk-amount">Summa (so'm, manfiy = ayirish)</Label>
                    <Input
                      id="bulk-amount"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="numeric"
                      placeholder="masalan: 1000 yoki -500"
                    />
                  </div>
                )}
                {mode === 'set' && (
                  <div className="space-y-1">
                    <Label htmlFor="bulk-exact">Yangi narx (so'm)</Label>
                    <Input
                      id="bulk-exact"
                      value={exact}
                      onChange={(e) => setExact(e.target.value)}
                      inputMode="numeric"
                      placeholder="0"
                    />
                  </div>
                )}
                {mode === 'round' && (
                  <div className="space-y-1">
                    <Label htmlFor="bulk-round">Yaxlitlash qadami (so'm)</Label>
                    <Select value={roundTo} onValueChange={setRoundTo}>
                      <SelectTrigger id="bulk-round" className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="100">100 so'm</SelectItem>
                        <SelectItem value="500">500 so'm</SelectItem>
                        <SelectItem value="1000">1.000 so'm</SelectItem>
                        <SelectItem value="5000">5.000 so'm</SelectItem>
                        <SelectItem value="10000">10.000 so'm</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {field === 'sale' ? (
                <div className="space-y-1">
                  <Label htmlFor="bulk-reason">Sabab (majburiy)</Label>
                  <Input
                    id="bulk-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Masalan: mavsumiy chegirma"
                  />
                </div>
              ) : null}

              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">O'zgaradigan</span>
                  <Badge variant="secondary">{validPreview.length}</Badge>
                </div>
                {invalidRows.length > 0 ? (
                  <div className="flex items-center justify-between text-destructive">
                    <span>Xato (≤0)</span>
                    <Badge variant="destructive">{invalidRows.length}</Badge>
                  </div>
                ) : null}
                {belowCostCount > 0 ? (
                  <div className="text-xs text-amber-700">
                    {belowCostCount} ta mahsulot tannarxdan past — manager + sabab talab qilinadi.
                  </div>
                ) : null}
              </div>

              {lastBatch && lastBatch.count > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleUndo()}
                  disabled={undoing}
                  className="justify-start"
                >
                  {undoing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" />
                  )}
                  Oxirgi amalni orqaga qaytarish ({lastBatch.count})
                </Button>
              )}
            </div>
          </div>

          {preview.length > 0 && (
            <div className="mt-2 max-h-48 shrink-0 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>Mahsulot</TableHead>
                    <TableHead className="text-right">Eski narx</TableHead>
                    <TableHead className="text-right">Yangi narx</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">{row.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{row.sku}</div>
                        {row.invalid ? (
                          <div className="text-xs text-destructive">Yakuniy narx ≤ 0</div>
                        ) : row.belowCost ? (
                          <div className="text-xs text-amber-700">Tannarxdan past</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground line-through">
                        {formatMoneyUZS(row.oldPrice)}
                      </TableCell>
                      <TableCell
                        className={
                          row.invalid
                            ? 'text-right font-semibold text-destructive'
                            : 'text-right font-semibold text-emerald-600'
                        }
                      >
                        {formatMoneyUZS(row.newPrice)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter className="shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Bekor
            </Button>
            <Button type="button" onClick={requestApply} disabled={confirmDisabled}>
              {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Tasdiqlash ({validPreview.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ommaviy narx yangilashni tasdiqlang</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <strong className="text-foreground">{impactSummary.count}</strong> ta mahsulotning{' '}
                  {FIELD_LABELS[field].toLowerCase()} o'zgartiriladi.
                </p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Oshadi: {impactSummary.up}</li>
                  <li>Kamayadi: {impactSummary.down}</li>
                  <li>Jami farq: {formatMoneyUZS(impactSummary.delta)}</li>
                  {belowCostCount > 0 ? (
                    <li className="text-amber-700">Tannarxdan past: {belowCostCount}</li>
                  ) : null}
                </ul>
                <p>Bu amalni keyin &quot;Orqaga qaytarish&quot; tugmasi bilan bekor qilishingiz mumkin.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor</AlertDialogCancel>
            <AlertDialogAction onClick={() => void applyNow()}>Qo'llash</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
