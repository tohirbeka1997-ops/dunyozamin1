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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { createSupplierReturn, getProducts } from '@/db/api';
import type { ProductWithCategory, SupplierWithBalance } from '@/types/database';
import MoneyInput from '@/components/common/MoneyInput';
import { Plus, Trash2, RotateCcw } from 'lucide-react';
import { formatMoneyUZS } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';

type ReturnItemRow = {
  temp_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
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

  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState<number | null>(1);
  const [unitCost, setUnitCost] = useState<number | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ReturnItemRow[]>([]);

  useEffect(() => {
    if (!open) return;
    // Load products for picker (active only)
    (async () => {
      try {
        const rows = await getProducts(true);
        setProducts(Array.isArray(rows) ? rows : []);
      } catch (e) {
        console.error('Failed to load products for supplier return:', e);
        setProducts([]);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setProductSearch('');
      setSelectedProductId('');
      setQty(1);
      setUnitCost(null);
      setReturnReason('');
      setNotes('');
      setItems([]);
    }
  }, [open]);

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    const list = products.slice(0, 5000);
    if (!term) return list.slice(0, 50);
    return list
      .filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term))
      .slice(0, 50);
  }, [products, productSearch]);

  const totalAmount = useMemo(() => {
    return items.reduce((sum, it) => sum + (Number(it.quantity || 0) * Number(it.unit_cost || 0)), 0);
  }, [items]);

  const handleAddItem = () => {
    const productId = selectedProductId;
    const q = Number(qty ?? 0);
    const c = Number(unitCost ?? 0);
    if (!productId) {
      toast({ title: 'Xatolik', description: 'Mahsulotni tanlang', variant: 'destructive' });
      return;
    }
    if (!Number.isFinite(q) || q <= 0) {
      toast({ title: 'Xatolik', description: 'Miqdor 0 dan katta bo‘lishi kerak', variant: 'destructive' });
      return;
    }
    if (!Number.isFinite(c) || c < 0) {
      toast({ title: 'Xatolik', description: 'Tannarx manfiy bo‘lishi mumkin emas', variant: 'destructive' });
      return;
    }

    const product = products.find((p) => p.id === productId);
    const name = product?.name || productId;
    const defaultCost = product?.purchase_price ?? 0;

    const safeCost = unitCost === null ? Number(defaultCost || 0) : c;

    setItems((prev) => [
      {
        temp_id: `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        product_id: productId,
        product_name: name,
        quantity: q,
        unit_cost: safeCost,
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
        items: items.map((it) => ({
          product_id: it.product_id,
          quantity: it.quantity,
          unit_cost: it.unit_cost,
        })),
      });

      toast({
        title: '✅ Qaytarish saqlandi',
        description: `Jami: ${formatMoneyUZS(totalAmount)}. Qarzdorlik kamayadi, ombordagi qoldiq ham kamayadi.`,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Postavshikka qaytarish</DialogTitle>
          <DialogDescription>
            {supplier.name} yetkazib beruvchiga qaytariladigan mahsulotlarni kiriting. Bu amal ombordagi qoldiqni kamaytiradi va qarzdorlikni kamaytiradi (credit note).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 space-y-2">
              <Label>Mahsulot qidirish</Label>
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Nom yoki SKU..."
                disabled={loading}
              />
              <div className="border rounded-md max-h-48 overflow-y-auto">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`w-full text-left px-3 py-2 hover:bg-muted ${
                      selectedProductId === p.id ? 'bg-muted' : ''
                    }`}
                    onClick={() => {
                      setSelectedProductId(p.id);
                      // default unit cost preview
                      setUnitCost((prev) => (prev === null ? Number(p.purchase_price || 0) : prev));
                    }}
                  >
                    <div className="flex justify-between gap-3">
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">SKU: {p.sku}</div>
                      </div>
                      <div className="text-sm font-medium">{formatMoneyUZS(Number(p.purchase_price || 0) || 0)}</div>
                    </div>
                  </button>
                ))}
                {filteredProducts.length === 0 && (
                  <div className="px-3 py-3 text-sm text-muted-foreground">Mahsulot topilmadi</div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Miqdor</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={qty ?? ''}
                  onChange={(e) => setQty(e.target.value ? Number(e.target.value) : null)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label>Tannarx (1 dona)</Label>
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
              <span className="font-semibold">Jami: {formatMoneyUZS(totalAmount)}</span>
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
                        {it.quantity} × {formatMoneyUZS(it.unit_cost)} = {formatMoneyUZS(it.quantity * it.unit_cost)}
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
  );
}

