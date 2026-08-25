import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  createSupplierReturn,
  listSupplierReturnableProducts,
  type SupplierReturnableProduct,
} from '@/db/api';
import type { SupplierWithBalance } from '@/types/database';
import MoneyInput from '@/components/common/MoneyInput';
import { Plus, Trash2, RotateCcw, PackageCheck } from 'lucide-react';
import { formatMoney, normalizeCurrency, type AppCurrency } from '@/lib/currency';
import { useAuth } from '@/contexts/AuthContext';

type ReturnItemRow = {
  temp_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  cost_currency: AppCurrency;
  unit_cost_usd?: number | null;
  fx_rate?: number | null;
};

interface SupplierReturnDialogProps {
  supplier: SupplierWithBalance;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function SupplierReturnDialog({ supplier, open, onOpenChange, onSuccess }: SupplierReturnDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();

  const settlementCurrency = normalizeCurrency(
    (supplier as { settlement_currency?: string | null })?.settlement_currency,
    'UZS'
  );

  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [products, setProducts] = useState<SupplierReturnableProduct[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState<number | null>(1);
  const [unitCost, setUnitCost] = useState<number | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ReturnItemRow[]>([]);
  const [confirmReturnAllOpen, setConfirmReturnAllOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setLoadingProducts(true);
        const rows = await listSupplierReturnableProducts({
          supplier_id: supplier.id,
          search: productSearch.trim() || undefined,
          limit: 200,
        });
        setProducts(Array.isArray(rows) ? rows : []);
      } catch (e) {
        console.error('Failed to load returnable products for supplier return:', e);
        setProducts([]);
        toast({
          title: 'Xatolik',
          description: 'Qaytariladigan mahsulotlar ro‘yxatini yuklab bo‘lmadi',
          variant: 'destructive',
        });
      } finally {
        setLoadingProducts(false);
      }
    })();
    // Reload when dialog opens; search is filtered client-side below for snappiness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier.id]);

  useEffect(() => {
    if (!open) {
      setProductSearch('');
      setSelectedProductId('');
      setQty(1);
      setUnitCost(null);
      setReturnReason('');
      setNotes('');
      setItems([]);
      setConfirmReturnAllOpen(false);
    }
  }, [open]);

  const reservedByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) {
      map.set(it.product_id, (map.get(it.product_id) || 0) + Number(it.quantity || 0));
    }
    return map;
  }, [items]);

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    const list = products.filter((p) => {
      const reserved = reservedByProduct.get(p.product_id) || 0;
      return Number(p.returnable_qty || 0) - reserved > 1e-9;
    });
    if (!term) return list.slice(0, 50);
    return list
      .filter(
        (p) =>
          p.product_name.toLowerCase().includes(term) ||
          String(p.product_sku || '')
            .toLowerCase()
            .includes(term)
      )
      .slice(0, 50);
  }, [products, productSearch, reservedByProduct]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.product_id === selectedProductId) || null,
    [products, selectedProductId]
  );

  const selectedRemaining = useMemo(() => {
    if (!selectedProduct) return 0;
    const reserved = reservedByProduct.get(selectedProduct.product_id) || 0;
    return Math.max(0, Number(selectedProduct.returnable_qty || 0) - reserved);
  }, [selectedProduct, reservedByProduct]);

  const totalAmount = useMemo(() => {
    return items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unit_cost || 0), 0);
  }, [items]);

  const returnableCount = useMemo(
    () => products.filter((p) => Number(p.returnable_qty || 0) > 1e-9).length,
    [products]
  );

  const lineCostCurrency = (p: SupplierReturnableProduct): AppCurrency =>
    normalizeCurrency(p.cost_currency || p.settlement_currency || settlementCurrency, settlementCurrency);

  const handleAddItem = () => {
    const productId = selectedProductId;
    const q = Number(qty ?? 0);
    const c = Number(unitCost ?? 0);
    if (!productId) {
      toast({ title: 'Xatolik', description: 'Mahsulotni tanlang', variant: 'destructive' });
      return;
    }
    if (!selectedProduct) {
      toast({
        title: 'Xatolik',
        description: 'Bu mahsulot ushbu yetkazib beruvchidan qabul qilinmagan yoki qaytarish uchun qoldiq yo‘q',
        variant: 'destructive',
      });
      return;
    }
    if (!Number.isFinite(q) || q <= 0) {
      toast({ title: 'Xatolik', description: 'Miqdor 0 dan katta bo‘lishi kerak', variant: 'destructive' });
      return;
    }
    if (q > selectedRemaining + 1e-9) {
      toast({
        title: 'Xatolik',
        description: `Qaytarish miqdori yetkazib beruvchidan kelgan qoldiqdan oshib ketdi. Mavjud: ${selectedRemaining}`,
        variant: 'destructive',
      });
      return;
    }
    if (!Number.isFinite(c) || c < 0) {
      toast({ title: 'Xatolik', description: 'Tannarx manfiy bo‘lishi mumkin emas', variant: 'destructive' });
      return;
    }

    const cur = lineCostCurrency(selectedProduct);
    const safeCost = unitCost === null ? Number(selectedProduct.unit_cost || 0) : c;

    setItems((prev) => [
      {
        temp_id: `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        product_id: productId,
        product_name: selectedProduct.product_name || productId,
        quantity: q,
        unit_cost: safeCost,
        cost_currency: cur,
        unit_cost_usd:
          cur === 'USD'
            ? safeCost
            : selectedProduct.unit_cost_usd != null
              ? Number(selectedProduct.unit_cost_usd)
              : null,
        fx_rate: selectedProduct.fx_rate != null ? Number(selectedProduct.fx_rate) : null,
      },
      ...prev,
    ]);

    setSelectedProductId('');
    setQty(1);
    setUnitCost(null);
  };

  const handleRemoveItem = (tempId: string) => {
    setItems((prev) => prev.filter((x) => x.temp_id !== tempId));
  };

  const fillAllReturnable = () => {
    const next: ReturnItemRow[] = [];
    for (const p of products) {
      const maxQty = Number(p.returnable_qty || 0);
      if (!(maxQty > 0)) continue;
      const cur = lineCostCurrency(p);
      const cost = Number(p.unit_cost || 0) || 0;
      next.push({
        temp_id: `tmp-all-${p.product_id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        product_id: p.product_id,
        product_name: p.product_name || p.product_id,
        quantity: maxQty,
        unit_cost: cost,
        cost_currency: cur,
        unit_cost_usd:
          cur === 'USD' ? cost : p.unit_cost_usd != null ? Number(p.unit_cost_usd) : null,
        fx_rate: p.fx_rate != null ? Number(p.fx_rate) : null,
      });
    }
    setItems(next);
    setSelectedProductId('');
    setQty(1);
    setUnitCost(null);
    toast({
      title: 'To‘ldirildi',
      description: `${next.length} ta mahsulot maksimal miqdorda qo‘shildi. Saqlashdan oldin tahrirlashingiz mumkin.`,
    });
  };

  const handleSubmit = async () => {
    if (items.length === 0) {
      toast({ title: 'Xatolik', description: 'Kamida bitta mahsulot qo‘shing', variant: 'destructive' });
      return;
    }
    try {
      setLoading(true);
      await createSupplierReturn({
        supplier_id: supplier.id,
        status: 'completed',
        return_reason: returnReason.trim() || null,
        notes: notes.trim() || null,
        created_by: profile?.id || null,
        cost_currency: settlementCurrency,
        items: items.map((it) => ({
          product_id: it.product_id,
          quantity: it.quantity,
          unit_cost: it.unit_cost,
          unit_cost_usd: it.cost_currency === 'USD' ? it.unit_cost : it.unit_cost_usd ?? undefined,
          cost_currency: it.cost_currency,
          fx_rate: it.fx_rate ?? undefined,
        })),
      });

      toast({
        title: '✅ Qaytarish saqlandi',
        description: `Jami: ${formatMoney(totalAmount, settlementCurrency)}. Qarzdorlik kamayadi, ombordagi qoldiq ham kamayadi.`,
        className: 'bg-green-50 border-green-200',
      });

      onOpenChange(false);
      onSuccess();
    } catch (e: any) {
      console.error('Supplier return error:', e);
      toast({
        title: 'Xatolik',
        description: e?.message || 'Qaytarishni saqlab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[720px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Postavshikka qaytarish</DialogTitle>
            <DialogDescription>
              Faqat {supplier.name} yetkazib beruvchidan kelgan mahsulotlarni qaytarish mumkin. Ombor qoldig‘i va
              qarzdorlik (credit note) kamayadi. Hisob: {settlementCurrency}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmReturnAllOpen(true)}
                disabled={loading || loadingProducts || returnableCount === 0}
              >
                <PackageCheck className="h-4 w-4 mr-2" />
                Hammasini qaytarish
              </Button>
              <span className="text-xs text-muted-foreground self-center">
                Barcha qaytariladigan mahsulotlarni maksimal miqdorda to‘ldiradi (saqlashdan oldin tahrirlash mumkin)
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-2">
                <Label>Mahsulot qidirish (faqat shu yetkazib beruvchidan)</Label>
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Nom yoki SKU..."
                  disabled={loading || loadingProducts}
                />
                <div className="border rounded-md max-h-48 overflow-y-auto">
                  {loadingProducts ? (
                    <div className="px-3 py-3 text-sm text-muted-foreground">Yuklanmoqda...</div>
                  ) : (
                    filteredProducts.map((p) => {
                      const reserved = reservedByProduct.get(p.product_id) || 0;
                      const remaining = Math.max(0, Number(p.returnable_qty || 0) - reserved);
                      const cur = lineCostCurrency(p);
                      return (
                        <button
                          key={p.product_id}
                          type="button"
                          className={`w-full text-left px-3 py-2 hover:bg-muted ${
                            selectedProductId === p.product_id ? 'bg-muted' : ''
                          }`}
                          onClick={() => {
                            setSelectedProductId(p.product_id);
                            setUnitCost((prev) => (prev === null ? Number(p.unit_cost || 0) : prev));
                            setQty((prev) => {
                              const curQty = Number(prev ?? 1);
                              if (!Number.isFinite(curQty) || curQty <= 0) return Math.min(1, remaining);
                              return Math.min(curQty, remaining);
                            });
                          }}
                        >
                          <div className="flex justify-between gap-3">
                            <div>
                              <div className="font-medium">{p.product_name}</div>
                              <div className="text-xs text-muted-foreground">
                                SKU: {p.product_sku || '—'} · Qaytarish mumkin: {remaining}
                              </div>
                            </div>
                            <div className="text-sm font-medium">
                              {formatMoney(Number(p.unit_cost || 0) || 0, cur)}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                  {!loadingProducts && filteredProducts.length === 0 && (
                    <div className="px-3 py-3 text-sm text-muted-foreground">
                      Bu yetkazib beruvchidan qaytariladigan mahsulot topilmadi
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Miqdor {selectedProduct ? `(max ${selectedRemaining})` : ''}</Label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={selectedRemaining || undefined}
                    value={qty ?? ''}
                    onChange={(e) => setQty(e.target.value ? Number(e.target.value) : null)}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    Tannarx (1 dona)
                    {selectedProduct
                      ? ` · ${lineCostCurrency(selectedProduct)}`
                      : ` · ${settlementCurrency}`}
                  </Label>
                  <MoneyInput
                    id="supplier-return-unit-cost"
                    value={unitCost}
                    onValueChange={(v) => setUnitCost(v)}
                    placeholder="0"
                    allowDecimals
                    allowZero
                    min={0}
                    containerClassName="space-y-0"
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={handleAddItem} disabled={loading}>
                    <Plus className="h-4 w-4 mr-2" />
                    Qo‘shish
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setSelectedProductId('');
                      setQty(1);
                      setUnitCost(null);
                    }}
                    disabled={loading}
                    title="Tozalash"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Qaytarish sababi</Label>
              <Input
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Masalan: defekt, ortiqcha, almashtirish..."
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label>Izoh</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={loading} />
            </div>

            <div className="border rounded-md">
              <div className="flex justify-between px-3 py-2 text-sm">
                <span className="text-muted-foreground">Qaytariladigan mahsulotlar</span>
                <span className="font-semibold">Jami: {formatMoney(totalAmount, settlementCurrency)}</span>
              </div>
              <div className="divide-y">
                {items.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">Hozircha item yo‘q</div>
                ) : (
                  items.map((it) => (
                    <div key={it.temp_id} className="px-3 py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{it.product_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {it.quantity} × {formatMoney(it.unit_cost, it.cost_currency)} ={' '}
                          {formatMoney(it.quantity * it.unit_cost, it.cost_currency)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveItem(it.temp_id)}
                        disabled={loading}
                        title="O‘chirish"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Bekor qilish
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? 'Saqlanmoqda...' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmReturnAllOpen} onOpenChange={setConfirmReturnAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hammasini qaytarish?</AlertDialogTitle>
            <AlertDialogDescription>
              {supplier.name} uchun barcha qaytariladigan mahsulotlar ({returnableCount} ta) maksimal miqdorda
              ro‘yxatga qo‘shiladi. Saqlashdan oldin miqdor yoki qatorlarni o‘zgartirish mumkin. Bu hali ombor va
              credit note yozmaydi — faqat forma to‘ldiriladi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                fillAllReturnable();
                setConfirmReturnAllOpen(false);
              }}
            >
              To‘ldirish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
