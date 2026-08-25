import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import NumberInput from '@/components/common/NumberInput';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { filterPurchaseCatalog, type ProductScanIndexEntry } from '@/lib/purchase/purchaseScanSearch';
import { formatMoneyUZS } from '@/lib/format';
import { formatUnit } from '@/utils/formatters';
import type { Category } from '@/types/database';
import { Search } from 'lucide-react';

const ROW_HEIGHT = 52;

type RowState = { checked: boolean; qty: number };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: ProductScanIndexEntry[];
  categories: Category[];
  onAddMany: (items: { product: ProductScanIndexEntry; qty: number }[]) => void;
};

export default function PurchaseOrderBulkAddModal({
  open,
  onOpenChange,
  catalog,
  categories,
  onAddMany,
}: Props) {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setCategoryId('all');
      setRows({});
    }
  }, [open]);

  const filtered = useMemo(() => {
    let list = catalog;
    if (categoryId !== 'all') {
      list = list.filter((p) => String(p.category_id || '') === categoryId);
    }
    const term = search.trim();
    if (!term) return list.slice(0, 500);
    return filterPurchaseCatalog(list, term, 500);
  }, [catalog, categoryId, search]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const selectedCount = filtered.filter((p) => rows[p.id]?.checked).length;

  const toggleAll = (checked: boolean) => {
    const next: Record<string, RowState> = { ...rows };
    for (const p of filtered) {
      next[p.id] = { checked, qty: next[p.id]?.qty ?? 1 };
    }
    setRows(next);
  };

  const handleAdd = () => {
    const payload = filtered
      .filter((p) => rows[p.id]?.checked)
      .map((p) => ({ product: p, qty: Math.max(1, Number(rows[p.id]?.qty) || 1) }));
    if (!payload.length) return;
    onAddMany(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Ko‘p mahsulot qo‘shish</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Qidirish…"
              className="pl-8 h-9"
            />
          </div>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue placeholder="Kategoriya" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => toggleAll(true)}>
            Hammasini tanlash
          </Button>
        </div>

        <div ref={parentRef} className="flex-1 min-h-[280px] max-h-[50vh] overflow-y-auto border rounded-md">
          <div className="sticky top-0 z-10 grid grid-cols-[28px_1fr_72px_88px] gap-2 items-center px-2 py-1.5 bg-muted/60 text-xs font-medium border-b">
            <Checkbox
              checked={filtered.length > 0 && filtered.every((p) => rows[p.id]?.checked)}
              onCheckedChange={(v) => toggleAll(!!v)}
            />
            <span>Mahsulot</span>
            <span className="text-center">Miqdor</span>
            <span className="text-right">Tannarx</span>
          </div>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const p = filtered[vi.index];
              const st = rows[p.id] || { checked: false, qty: 1 };
              return (
                <div
                  key={p.id}
                  className="grid grid-cols-[28px_1fr_72px_88px] gap-2 items-center px-2 border-b text-sm absolute w-full"
                  style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
                >
                  <Checkbox
                    checked={st.checked}
                    onCheckedChange={(v) =>
                      setRows((prev) => ({
                        ...prev,
                        [p.id]: { ...st, checked: !!v },
                      }))
                    }
                  />
                  <div className="min-w-0 py-1">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">
                      {p.sku}
                      {(p as { barcode?: string }).barcode
                        ? ` · ${(p as { barcode?: string }).barcode}`
                        : ''}
                    </div>
                  </div>
                  <NumberInput
                    value={st.qty}
                    onValueChange={(v) =>
                      setRows((prev) => ({
                        ...prev,
                        [p.id]: { ...st, qty: Math.max(1, Math.floor(v ?? 1)) },
                      }))
                    }
                    min={1}
                    allowZero
                    disabled={!st.checked}
                    containerClassName="space-y-0"
                    className="h-8 text-center"
                  />
                  <div className="text-right text-xs tabular-nums">
                    {formatMoneyUZS(
                      Number(
                        (p as { cost_price?: number }).cost_price ??
                          (p as { purchase_price?: number }).purchase_price ??
                          0,
                      ) || 0,
                    )}
                    <div className="text-[10px] text-muted-foreground">{formatUnit(p.unit)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">Mahsulot topilmadi</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Bekor
          </Button>
          <Button type="button" onClick={handleAdd} disabled={selectedCount === 0}>
            {selectedCount > 0 ? `${selectedCount} ta qo‘shish` : 'Tanlang'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
