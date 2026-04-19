import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  createPurchaseReceipt,
  getProducts,
  getPurchaseOrderById,
  getSuppliers,
  getLatestExchangeRate,
  productUpdateEmitter,
} from '@/db/api';
import type { ProductWithCategory, PurchaseOrderWithDetails, SupplierWithBalance } from '@/types/database';
import { ArrowLeft, Package, Save, Trash2 } from 'lucide-react';
import MoneyInput from '@/components/common/MoneyInput';
import { todayYMD } from '@/lib/datetime';
import { formatUnit } from '@/utils/formatters';
import { useAuth } from '@/contexts/AuthContext';

type ReceiptItem = {
  purchase_order_item_id?: string | null;
  product_id: string;
  product_name: string;
  ordered_qty?: number;
  received_qty: number;
  unit_cost: number;
  line_total: number;
};

export default function PurchaseReceiptForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useAuth();
  const fromPoId = id || null;

  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [po, setPo] = useState<PurchaseOrderWithDetails | null>(null);

  const [supplierId, setSupplierId] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'UZS'>('USD');
  const [receivedAt, setReceivedAt] = useState(todayYMD());
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadInitial();
  }, [fromPoId]);

  useEffect(() => {
    if (!supplierId) return;
    const supplier = suppliers.find((s) => s.id === supplierId) as any;
    const nextCurrency = String(supplier?.settlement_currency || 'USD').toUpperCase() === 'UZS' ? 'UZS' : 'USD';
    setCurrency(nextCurrency);
    if (nextCurrency === 'UZS') {
      setFxRate(null);
      return;
    }
    if (Number(fxRate || 0) > 0) return;
    (async () => {
      try {
        const row = await getLatestExchangeRate({
          base_currency: 'USD',
          quote_currency: 'UZS',
          on_date: receivedAt,
        });
        const r = row?.rate != null ? Number(row.rate) : NaN;
        if (Number.isFinite(r) && r > 0) {
          setFxRate(r);
        }
      } catch {
        // ignore, user can enter manually
      }
    })();
  }, [supplierId, suppliers, receivedAt, fxRate]);

  const loadInitial = async () => {
    try {
      setLoading(true);
      const [suppliersData, productsData] = await Promise.all([
        getSuppliers(),
        getProducts(true, { status: 'all', stockStatus: 'all', limit: 5000, offset: 0 } as any),
      ]);
      setSuppliers(suppliersData);
      setProducts(productsData);

      if (fromPoId) {
        const poData = await getPurchaseOrderById(fromPoId);
        setPo(poData);
        setSupplierId(poData.supplier_id || '');
        const poCurrency = String((poData as any)?.currency || 'USD').toUpperCase() === 'UZS' ? 'UZS' : 'USD';
        setCurrency(poCurrency);
        if (poCurrency === 'USD') {
          const rate = Number((poData as any).fx_rate ?? 0);
          if (Number.isFinite(rate) && rate > 0) {
            setFxRate(rate);
          } else {
            try {
              const row = await getLatestExchangeRate({
                base_currency: 'USD',
                quote_currency: 'UZS',
                on_date: receivedAt,
              });
              const r = row?.rate != null ? Number(row.rate) : NaN;
              if (Number.isFinite(r) && r > 0) {
                setFxRate(r);
              }
            } catch {
              // ignore, manual entry
            }
          }
        } else {
          setFxRate(null);
        }
        const rate = Number((poData as any).fx_rate ?? 0);
        const mapped = (poData.items || []).map((it) => {
          const qtyToReceive = Math.max(0, Number(it.ordered_qty) - Number(it.received_qty || 0));
          const baseCost =
            poCurrency === 'USD'
              ? Number((it as any).unit_cost_usd ?? it.unit_cost ?? 0)
              : Number(it.unit_cost ?? 0);
          const landedCostUzs = Number((it as any).landed_unit_cost ?? 0) || 0;
          const landedCost =
            poCurrency === 'USD'
              ? rate > 0 && landedCostUzs > 0
                ? landedCostUzs / rate
                : baseCost
              : landedCostUzs || baseCost;
          return {
            purchase_order_item_id: it.id,
            product_id: it.product_id,
            product_name: it.product_name,
            ordered_qty: it.ordered_qty,
            received_qty: qtyToReceive,
            unit_cost: landedCost,
            line_total: qtyToReceive * landedCost,
          };
        });
        setItems(mapped.filter((m) => m.received_qty > 0));
      }
    } catch (error: any) {
      toast({
        title: 'Xatolik',
        description: error.message || 'Maʼlumotlarni yuklab bo‘lmadi',
        variant: 'destructive',
      });
      navigate('/purchase-orders');
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    const term = searchTerm.toLowerCase();
    if (!term) return false;
    return (
      p.name.toLowerCase().includes(term) ||
      p.sku.toLowerCase().includes(term) ||
      (p.barcode && p.barcode.toLowerCase().includes(term))
    );
  });

  const addProduct = (product: ProductWithCategory) => {
    const existing = items.find((i) => i.product_id === product.id);
    if (existing) {
      toast({
        title: 'Xatolik',
        description: 'Mahsulot allaqachon qo‘shilgan',
        variant: 'destructive',
      });
      return;
    }
    const rate = Number(fxRate || 0);
    const unitCost =
      currency === 'USD'
        ? (Number.isFinite(rate) && rate > 0 ? Number(product.purchase_price || 0) / rate : 0)
        : Number(product.purchase_price || 0);
    const next: ReceiptItem = {
      product_id: product.id,
      product_name: product.name,
      received_qty: 1,
      unit_cost: unitCost,
      line_total: unitCost,
    };
    setItems((prev) => [...prev, next]);
    setSearchTerm('');
  };

  const updateItem = (index: number, field: 'received_qty' | 'unit_cost', value: number) => {
    const next = [...items];
    (next[index] as any)[field] = value;
    const qty = Number(next[index].received_qty || 0);
    const cost = Number(next[index].unit_cost || 0);
    next[index].line_total = qty * cost;
    setItems(next);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const validateForm = () => {
    if (!supplierId) {
      toast({
        title: 'Xatolik',
        description: 'Yetkazib beruvchini tanlang',
        variant: 'destructive',
      });
      return false;
    }
    if (items.length === 0) {
      toast({
        title: 'Xatolik',
        description: 'Kamida bitta mahsulot qo‘shing',
        variant: 'destructive',
      });
      return false;
    }
    for (const item of items) {
      if (Number(item.received_qty || 0) <= 0) {
        toast({
          title: 'Xatolik',
          description: 'Miqdor 0 dan katta bo‘lishi kerak',
          variant: 'destructive',
        });
        return false;
      }
    }
    if (currency === 'USD') {
      const rate = Number(fxRate || 0);
      if (!Number.isFinite(rate) || rate <= 0) {
        toast({
          title: 'Xatolik',
          description: 'Kursni kiriting',
          variant: 'destructive',
        });
        return false;
      }
    }
    return true;
  };

  const handleSave = async (status: 'draft' | 'received') => {
    if (!validateForm()) return;
    try {
      setLoading(true);
      const rate = Number(fxRate || 0);
      await createPurchaseReceipt({
        purchase_order_id: fromPoId,
        supplier_id: supplierId,
        currency,
        exchange_rate: currency === 'USD' ? rate : null,
        status,
        invoice_number: invoiceNumber.trim() || null,
        received_at: receivedAt || null,
        notes: notes.trim() || null,
        created_by: profile?.id || null,
        items: items.map((it) => ({
          purchase_order_item_id: it.purchase_order_item_id || null,
          product_id: it.product_id,
          product_name: it.product_name,
          received_qty: Number(it.received_qty || 0),
          unit_cost_usd: currency === 'USD' ? Number(it.unit_cost || 0) : null,
          line_total_usd: currency === 'USD' ? Number(it.line_total || 0) : null,
          unit_cost: currency === 'USD' ? null : Number(it.unit_cost || 0),
          line_total: currency === 'USD' ? null : Number(it.line_total || 0),
        })),
      });
      productUpdateEmitter.emit();
      toast({
        title: 'Muvaffaqiyatli',
        description: status === 'received' ? 'Qabul qilindi' : 'Qoralama saqlandi',
      });
      navigate(fromPoId ? `/purchase-orders/${fromPoId}` : '/purchase-orders');
    } catch (error: any) {
      toast({
        title: 'Xatolik',
        description: error.message || 'Qabul qilishni saqlab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading && !suppliers.length) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Qabul qilish</h1>
          <p className="text-muted-foreground">Tovarni omborga kirim qilish</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Umumiy maʼlumotlar</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Yetkazib beruvchi</Label>
            {fromPoId ? (
              <Input value={suppliers.find((s) => s.id === supplierId)?.name || ''} readOnly />
            ) : (
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue placeholder="Yetkazib beruvchini tanlang" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label>Qabul sanasi</Label>
            <Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Valyuta</Label>
            <Input value={currency} readOnly />
          </div>
          {currency === 'USD' && (
            <div className="space-y-2">
              <Label>Kurs (1 USD = UZS)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={fxRate ?? ''}
                onChange={(e) => setFxRate(Number(e.target.value || 0))}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Faktura raqami</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Izoh</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {!fromPoId && (
        <Card>
          <CardHeader>
            <CardTitle>Mahsulot qo‘shish</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="Mahsulot qidirish..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <div className="mt-2 border rounded-md max-h-56 overflow-y-auto">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between p-2 hover:bg-muted cursor-pointer"
                    onClick={() => addProduct(product)}
                  >
                    <div>
                      <div className="font-medium">{product.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {product.sku} • {formatUnit(product.unit)}
                      </div>
                    </div>
                    <div className="text-sm">+ qo‘shish</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Mahsulotlar</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mahsulot</TableHead>
                <TableHead className="text-right">Miqdor</TableHead>
                <TableHead className="text-right">Narx ({currency})</TableHead>
                {currency === 'USD' && <TableHead className="text-right">Tannarx (UZS)</TableHead>}
                <TableHead className="text-right">Jami ({currency})</TableHead>
                {currency === 'USD' && <TableHead className="text-right">Jami (UZS)</TableHead>}
                <TableHead className="text-right">Amallar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={`${item.product_id}-${index}`}>
                  <TableCell>{item.product_name}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={item.received_qty}
                      onChange={(e) => updateItem(index, 'received_qty', Number(e.target.value))}
                      className="w-24 text-right"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyInput
                      id={`unit-cost-${index}`}
                      value={item.unit_cost}
                      onValueChange={(val) => updateItem(index, 'unit_cost', Number(val ?? 0))}
                      placeholder="0"
                      allowDecimals
                      allowZero
                      min={0}
                      containerClassName="space-y-0"
                      className="w-28 text-right"
                    />
                  </TableCell>
                  {currency === 'USD' && (
                    <TableCell className="text-right">
                      {Number(fxRate || 0) > 0
                        ? Math.round(item.unit_cost * Number(fxRate || 0)).toLocaleString('uz-UZ')
                        : '—'}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    {item.line_total.toFixed(2)} {currency}
                  </TableCell>
                  {currency === 'USD' && (
                    <TableCell className="text-right">
                      {Number(fxRate || 0) > 0
                        ? Math.round(item.line_total * Number(fxRate || 0)).toLocaleString('uz-UZ')
                        : '—'}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => removeItem(index)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => handleSave('draft')} disabled={loading}>
          <Save className="h-4 w-4 mr-2" />
          Qoralama saqlash
        </Button>
        <Button onClick={() => handleSave('received')} disabled={loading}>
          <Package className="h-4 w-4 mr-2" />
          Qabul qilish
        </Button>
      </div>
    </div>
  );
}
