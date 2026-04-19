import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { formatUnit } from '@/utils/formatters';
import { formatMoneyUZS } from '@/lib/format';
import { invalidateDashboardQueries } from '@/utils/dashboard';
import MoneyInput from '@/components/common/MoneyInput';
import {
  getSuppliers,
  getProducts,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrder,
  generatePONumber,
  createSupplier,
  searchSuppliers,
  productUpdateEmitter,
  addPurchaseOrderExpense,
  deletePurchaseOrderExpense,
  getLatestExchangeRate,
  createPurchaseReceipt,
  approvePurchaseOrder,
  receiveGoods,
} from '@/db/api';
import CreateProductModal from '@/components/products/CreateProductModal';
import type {
  SupplierWithBalance,
  ProductWithCategory,
  PurchaseOrderWithDetails,
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseOrderExpense,
} from '@/types/database';
import { Plus, Trash2, Search, ArrowLeft, Save, Package, UserPlus, Barcode, CheckCircle } from 'lucide-react';
import { todayYMD } from '@/lib/datetime';

interface OrderItem {
  product_id: string;
  product_name: string;
  product_sku?: string;
  ordered_qty: number;
  base_unit_cost?: number;
  unit_cost: number;
  line_total: number;
  base_unit_cost_usd?: number | null;
  unit_cost_usd?: number | null;
  line_total_usd?: number | null;
  discount_percent?: number;
  discount_amount?: number;
  discount_mode?: 'percent' | 'amount';
  sale_price?: number | null;
}

type POExpenseRow = {
  id?: string; // present after persisted
  temp_id: string; // stable key for UI list
  title: string;
  amount: number;
  allocation_method: 'by_value' | 'by_qty';
  notes?: string | null;
  created_at?: string;
};

export default function PurchaseOrderForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile: user } = useAuth();
  const queryClient = useQueryClient();
  const isEditMode = !!id;

  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [existingPO, setExistingPO] = useState<PurchaseOrderWithDetails | null>(null);

  // Form fields
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState(todayYMD());
  const [expectedDate, setExpectedDate] = useState('');
  const [status, setStatus] = useState<PurchaseOrderStatus>('draft');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<OrderItem[]>([]);
  const [currency, setCurrency] = useState<'UZS' | 'USD'>('UZS');
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [orderDiscountPercent, setOrderDiscountPercent] = useState(0);
  const [orderDiscountAmount, setOrderDiscountAmount] = useState(0);
  const [orderDiscountMode, setOrderDiscountMode] = useState<'percent' | 'amount'>('amount');

  // Expenses (landed cost): should be added before receiving goods
  const [expenses, setExpenses] = useState<POExpenseRow[]>([]);
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState<number | null>(null);
  const [expenseAllocation, setExpenseAllocation] = useState<'by_value' | 'by_qty'>('by_value');
  const [expenseNotes, setExpenseNotes] = useState('');
  const [expenseSaving, setExpenseSaving] = useState(false);

  // Product search
  const [searchTerm, setSearchTerm] = useState('');
  const [itemsSearchTerm, setItemsSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  // Keep search open by default in NEW purchase order flow (faster product entry)
  const [showProductSearch, setShowProductSearch] = useState(true);

  const handleBarcodeAdd = () => {
    const raw = String(barcodeInput || '').trim();
    if (!raw) return;
    const byBarcode = products.find(
      (p) => p.barcode && String(p.barcode).trim().toLowerCase() === raw.toLowerCase()
    );
    const bySku = products.find(
      (p) => p.sku && String(p.sku).trim().toLowerCase() === raw.toLowerCase()
    );
    const product = byBarcode || bySku;
    if (product) {
      addProduct(product);
      setBarcodeInput('');
      barcodeInputRef.current?.focus();
    } else {
      toast({
        title: 'Mahsulot topilmadi',
        description: `"${raw}" shtrix kod yoki SKU bo'yicha mahsulot topilmadi`,
        variant: 'destructive',
      });
    }
  };

  const openProductSearch = () => {
    setShowProductSearch(true);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  const [showCreateProductModal, setShowCreateProductModal] = useState(false);

  const handleProductCreated = (product: ProductWithCategory) => {
    addProduct(product);
    getProducts(true, { status: 'all', stockStatus: 'all', limit: 5000, offset: 0 } as any).then(
      (data) => setProducts(Array.isArray(data) ? data : []),
      () => {}
    );
  };

  // Supplier modal
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [newSupplierEmail, setNewSupplierEmail] = useState('');
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  const selectedSupplier = suppliers.find((s) => s.id === supplierId) || null;
  const supplierSettlementCurrency = (selectedSupplier as any)?.settlement_currency || 'USD';

  const clampPercent = (value: number) => Math.max(0, Math.min(100, value));
  const getFxRateSafe = () => {
    const rate = Number(fxRate || 0);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  };
  const toUzs = (amountUsd: number) => {
    const rate = getFxRateSafe();
    if (!rate) return 0;
    return amountUsd * rate;
  };
  const toUsd = (amountUzs: number) => {
    const rate = getFxRateSafe();
    if (!rate) return 0;
    return amountUzs / rate;
  };

  const computeItemTotals = (item: OrderItem): OrderItem => {
    if (currency === 'USD' && !getFxRateSafe()) {
      return item;
    }

    const qty = Number(item.ordered_qty || 0) || 0;
    const baseUzs =
      currency === 'USD'
        ? Number(item.base_unit_cost_usd || 0) * Number(getFxRateSafe() || 0)
        : Number(item.base_unit_cost || 0);

    const mode = item.discount_mode || (Number(item.discount_percent || 0) > 0 ? 'percent' : 'amount');
    let discountPercent = clampPercent(Number(item.discount_percent || 0));
    let discountAmountUzs = Number(item.discount_amount || 0);

    if (mode === 'percent') {
      discountAmountUzs = (baseUzs * discountPercent) / 100;
    } else {
      discountPercent = baseUzs > 0 ? (discountAmountUzs / baseUzs) * 100 : 0;
    }

    discountPercent = clampPercent(discountPercent);
    discountAmountUzs = Math.max(0, Math.min(discountAmountUzs, Math.max(0, baseUzs)));

    const netUnitUzs = Math.max(0, baseUzs - discountAmountUzs);
    const netLineUzs = netUnitUzs * qty;

    let netUnitUsd: number | null = null;
    let netLineUsd: number | null = null;
    if (currency === 'USD') {
      const rate = Number(getFxRateSafe() || 0);
      const baseUsd = Number(item.base_unit_cost_usd || 0);
      const discountUsd = rate > 0 ? discountAmountUzs / rate : 0;
      netUnitUsd = Math.max(0, baseUsd - discountUsd);
      netLineUsd = netUnitUsd * qty;
    }

    return {
      ...item,
      discount_percent: discountPercent,
      discount_amount: discountAmountUzs,
      unit_cost: netUnitUzs,
      line_total: netLineUzs,
      unit_cost_usd: currency === 'USD' ? netUnitUsd : null,
      line_total_usd: currency === 'USD' ? netLineUsd : null,
    };
  };

  const getOrderDiscountAmount = (subtotal: number) => {
    const amount = Number(orderDiscountAmount || 0);
    const percent = clampPercent(Number(orderDiscountPercent || 0));
    if (orderDiscountMode === 'percent') {
      return (subtotal * percent) / 100;
    }
    return Math.min(amount, subtotal);
  };

  // Auto currency from supplier + auto-load latest FX rate for USD
  useEffect(() => {
    const run = async () => {
      if (!supplierId) return;
      const nextCurrency = String(supplierSettlementCurrency || 'UZS').toUpperCase() === 'USD' ? 'USD' : 'UZS';
      setCurrency(nextCurrency as 'UZS' | 'USD');
      if (nextCurrency !== 'USD') {
        setFxRate(null);
        return;
      }
      try {
        const row = await getLatestExchangeRate({
          base_currency: 'USD',
          quote_currency: 'UZS',
          on_date: orderDate,
        });
        const r = row?.rate != null ? Number(row.rate) : NaN;
        if (Number.isFinite(r) && r > 0) {
          setFxRate(r);
        }
      } catch (_e) {
        // ignore; user can enter manually
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, supplierSettlementCurrency, orderDate]);

  // Recompute costs when currency or fxRate changes
  useEffect(() => {
    setItems((prev) =>
      prev.map((it) => {
        if (currency === 'USD') {
          const rate = getFxRateSafe();
          if (!rate) return it;
          const baseUzs = Number(it.base_unit_cost ?? it.unit_cost ?? 0);
          let baseUsd = Number(it.base_unit_cost_usd ?? NaN);
          // DB / older rows may have unit_cost_usd = 0 while unit_cost (UZS) is correct — don't treat 0 as authoritative
          if ((!Number.isFinite(baseUsd) || baseUsd === 0) && baseUzs > 0) {
            baseUsd = baseUzs / rate;
          }
          const next = {
            ...it,
            base_unit_cost_usd: Number.isFinite(baseUsd) ? baseUsd : 0,
          };
          return computeItemTotals(next);
        }
        const baseUzs = Number(it.base_unit_cost ?? it.unit_cost ?? 0);
        return computeItemTotals({ ...it, base_unit_cost: baseUzs, base_unit_cost_usd: null });
      })
    );
  }, [currency, fxRate]);

  useEffect(() => {
    loadInitialData();
  }, [id]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [suppliersData, productsData] = await Promise.all([
        getSuppliers(),
        // Purchase order needs broad product visibility; default getProducts() limit (50) is too small
        // and makes imported products "not found" here.
        getProducts(true, {
          status: 'all',
          stockStatus: 'all',
          sortBy: 'name',
          sortOrder: 'asc',
          limit: 5000,
          offset: 0,
        } as any),
      ]);

      setSuppliers(suppliersData);
      setProducts(productsData);

      if (id) {
        const poData = await getPurchaseOrderById(id);
        if (poData) {
          setExistingPO(poData);
          setSupplierId(poData.supplier_id || '');
          setOrderDate(poData.order_date);
          setExpectedDate(poData.expected_date || '');
          setStatus((poData.status as PurchaseOrderStatus) || 'draft');
          setNotes(poData.notes || '');
          const orderDiscount = Number(poData.discount || 0);
          const orderSubtotal = Number(poData.subtotal || 0);
          setOrderDiscountAmount(orderDiscount);
          setOrderDiscountPercent(orderSubtotal > 0 ? (orderDiscount / orderSubtotal) * 100 : 0);
          setOrderDiscountMode('amount');
          const poCurrency = (((poData as any).currency || 'UZS') as 'UZS' | 'USD');
          const poFxRate = typeof (poData as any).fx_rate === 'number' ? Number((poData as any).fx_rate) : null;
          setCurrency(poCurrency);
          setFxRate(poFxRate);

          if (poData.items) {
            const rate = Number.isFinite(Number(poFxRate || 0)) && Number(poFxRate) > 0 ? Number(poFxRate) : null;
            setItems(
              poData.items.map((item) => {
                const discountAmount = Number((item as any).discount_amount ?? 0) || 0;
                const discountPercent = Number((item as any).discount_percent ?? 0) || 0;
                const unitUzs = Number(item.unit_cost || 0);
                let unitUsd = Number((item as any).unit_cost_usd ?? NaN);
                // Stored unit_cost_usd is often 0 for legacy rows; prefer deriving from UZS when line has cost in so'm
                if ((!Number.isFinite(unitUsd) || unitUsd === 0) && unitUzs > 0 && rate) {
                  unitUsd = unitUzs / rate;
                }
                const baseUnitUzs = unitUzs + discountAmount;
                const baseUnitUsd =
                  poCurrency === 'USD'
                    ? (Number.isFinite(unitUsd) && unitUsd > 0 ? unitUsd : rate && unitUzs > 0 ? unitUzs / rate : 0) +
                      (rate ? discountAmount / rate : 0)
                    : null;
                return computeItemTotals({
                  product_id: item.product_id,
                  product_name: item.product_name,
                  product_sku: (item as any).product_sku || '',
                  ordered_qty: item.ordered_qty,
                  base_unit_cost: baseUnitUzs,
                  base_unit_cost_usd: baseUnitUsd,
                  unit_cost: unitUzs,
                  line_total: item.line_total,
                  unit_cost_usd: (item as any).unit_cost_usd ?? null,
                  line_total_usd: (item as any).line_total_usd ?? null,
                  discount_amount: discountAmount,
                  discount_percent: discountPercent,
                  discount_mode: discountPercent > 0 ? 'percent' : 'amount',
                  sale_price: Number((item as any).sale_price) > 0 ? Number((item as any).sale_price) : null,
                });
              })
            );
          }

          if (poData.expenses) {
            setExpenses(
              (poData.expenses as PurchaseOrderExpense[]).map((e) => ({
                id: e.id,
                temp_id: e.id,
                title: e.title,
                amount: Number(e.amount || 0) || 0,
                allocation_method: e.allocation_method === 'by_qty' ? 'by_qty' : 'by_value',
                notes: e.notes || null,
                created_at: e.created_at,
              }))
            );
          }
        }
      }
    } catch (error: unknown) {
      console.error('Load initial data error:', error);
      
      toast({
        title: 'Xatolik',
        description: 'Ma\'lumotlarni yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const addProduct = (product: ProductWithCategory) => {
    const existingItem = items.find((item) => item.product_id === product.id);
    if (existingItem) {
      toast({
        title: 'Mahsulot allaqachon qo\'shilgan',
        description: 'Bu mahsulot allaqachon buyurtmada mavjud',
        variant: 'destructive',
      });
      return;
    }

    const rate = getFxRateSafe();
    const baseUsd =
      currency === 'USD' && rate ? Number(product.purchase_price) / Number(rate) : null;
    const baseUzs =
      currency === 'USD' && rate ? Number(baseUsd || 0) * Number(rate) : product.purchase_price;

    const newItem: OrderItem = computeItemTotals({
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku,
      ordered_qty: 1,
      base_unit_cost: baseUzs,
      base_unit_cost_usd: currency === 'USD' ? baseUsd : null,
      unit_cost: baseUzs,
      line_total: baseUzs,
      unit_cost_usd: currency === 'USD' ? baseUsd : null,
      line_total_usd: currency === 'USD' ? (baseUsd ?? 0) : null,
      discount_percent: 0,
      discount_amount: 0,
      discount_mode: 'amount',
      sale_price: Number(product.sale_price) > 0 ? Number(product.sale_price) : null,
    });

    setItems([newItem, ...items]);
    setSearchTerm('');
  };

  const updateItem = (
    index: number,
    field: 'ordered_qty' | 'base_unit_cost' | 'base_unit_cost_usd' | 'discount_percent' | 'discount_amount' | 'sale_price',
    value: number
  ) => {
    const updatedItems = [...items];
    const item = { ...updatedItems[index] };
    (item as any)[field] = value;

    if (field === 'discount_percent') {
      item.discount_mode = 'percent';
    }
    if (field === 'discount_amount') {
      item.discount_mode = 'amount';
    }

    if (field === 'base_unit_cost_usd' && currency === 'USD') {
      const rate = getFxRateSafe();
      if (rate) {
        item.base_unit_cost = Number(value || 0) * rate;
      }
    }

    updatedItems[index] = computeItemTotals(item);
    setItems(updatedItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const calculateSubtotal = () => {
    return items.reduce((sum, item) => sum + item.line_total, 0);
  };

  const calculateSubtotalUSD = () => {
    return items.reduce((sum, item) => sum + Number(item.line_total_usd || 0), 0);
  };

  useEffect(() => {
    const subtotal = calculateSubtotal();
    if (orderDiscountMode === 'percent') {
      const nextAmount = (subtotal * clampPercent(orderDiscountPercent)) / 100;
      if (Math.abs(nextAmount - orderDiscountAmount) > 0.01) {
        setOrderDiscountAmount(nextAmount);
      }
    } else {
      const nextPercent = subtotal > 0 ? (Number(orderDiscountAmount || 0) / subtotal) * 100 : 0;
      if (Math.abs(nextPercent - orderDiscountPercent) > 0.01) {
        setOrderDiscountPercent(nextPercent);
      }
    }
  }, [items, orderDiscountMode, orderDiscountPercent, orderDiscountAmount]);

  const isReadOnly = existingPO && existingPO.status === 'cancelled';

  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount || 0) || 0), 0);

  const allocationsByProductId = (() => {
    // Preview allocation (same logic as backend PurchaseService.get)
    const baseValueTotal = items.reduce((sum, it) => sum + (Number(it.line_total || 0) || 0), 0);
    const baseQtyTotal = items.reduce((sum, it) => sum + (Number(it.ordered_qty || 0) || 0), 0);

    const map = new Map<string, { allocated: number; landedUnitCost: number }>();
    for (const it of items) {
      const orderedQty = Number(it.ordered_qty || 0) || 0;
      const baseLineValue = Number(it.line_total || 0) || 0;

      let allocated = 0;
      for (const exp of expenses) {
        const amt = Number(exp.amount || 0) || 0;
        const method = exp.allocation_method === 'by_qty' ? 'by_qty' : 'by_value';
        if (amt <= 0) continue;
        if (method === 'by_qty') {
          allocated += baseQtyTotal > 0 ? (orderedQty / baseQtyTotal) * amt : 0;
        } else {
          allocated += baseValueTotal > 0 ? (baseLineValue / baseValueTotal) * amt : 0;
        }
      }
      const perUnitExtra = orderedQty > 0 ? allocated / orderedQty : 0;
      const landedUnitCost = (Number(it.unit_cost || 0) || 0) + perUnitExtra;
      map.set(it.product_id, { allocated, landedUnitCost });
    }
    return map;
  })();

  const validateForm = () => {
    if (!supplierId) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Iltimos, ro\'yxatdan yetkazib beruvchini tanlang',
        variant: 'destructive',
      });
      return false;
    }

    if (!orderDate) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Iltimos, buyurtma sanasini tanlang',
        variant: 'destructive',
      });
      return false;
    }

    if (items.length === 0) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Iltimos, kamida bitta mahsulot qo\'shing',
        variant: 'destructive',
      });
      return false;
    }

    if (currency === 'USD') {
      if (!fxRate || !Number.isFinite(Number(fxRate)) || Number(fxRate) <= 0) {
        toast({
          title: 'Validatsiya xatosi',
          description: 'USD xarid uchun kurs (fx_rate) majburiy',
          variant: 'destructive',
        });
        return false;
      }
    }

    for (const item of items) {
      if (item.ordered_qty <= 0) {
        toast({
          title: 'Validatsiya xatosi',
          description: 'Miqdor 0 dan katta bo\'lishi kerak',
          variant: 'destructive',
        });
        return false;
      }

      if (currency === 'USD') {
        if (Number(item.base_unit_cost_usd || 0) < 0) {
          toast({
            title: 'Validatsiya xatosi',
            description: 'USD birlik narxi manfiy bo‘lishi mumkin emas',
            variant: 'destructive',
          });
          return false;
        }
      }

      if (Number(item.base_unit_cost || 0) < 0) {
        toast({
          title: 'Validatsiya xatosi',
          description: 'Birlik narxi manfiy bo\'lishi mumkin emas',
          variant: 'destructive',
        });
        return false;
      }

      const rate = getFxRateSafe();
      const baseUzs =
        currency === 'USD' ? Number(item.base_unit_cost_usd || 0) * Number(rate || 0) : Number(item.base_unit_cost || 0);
      if (Number(item.discount_amount || 0) < 0 || Number(item.discount_percent || 0) < 0) {
        toast({
          title: 'Validatsiya xatosi',
          description: 'Chegirma manfiy bo\'lishi mumkin emas',
          variant: 'destructive',
        });
        return false;
      }
      if (baseUzs > 0 && Number(item.discount_amount || 0) > baseUzs) {
        toast({
          title: 'Validatsiya xatosi',
          description: 'Chegirma birlik narxidan katta bo\'lishi mumkin emas',
          variant: 'destructive',
        });
        return false;
      }
    }

    if (existingPO && (existingPO.items || []).some((it: any) => Number(it.received_qty || 0) > 0)) {
      const receivedByPid = new Map<string, number>();
      for (const it of existingPO.items || []) {
        const pid = String((it as any).product_id || '');
        if (!pid) continue;
        receivedByPid.set(pid, (receivedByPid.get(pid) || 0) + Number((it as any).received_qty || 0));
      }
      const orderedByPid = new Map<string, number>();
      for (const item of items) {
        const pid = String(item.product_id || '');
        if (!pid) continue;
        orderedByPid.set(pid, (orderedByPid.get(pid) || 0) + Number(item.ordered_qty || 0));
      }
      for (const [pid, rec] of receivedByPid) {
        if (rec <= 0) continue;
        const ord = orderedByPid.get(pid) || 0;
        if (ord < rec - 1e-9) {
          toast({
            title: 'Validatsiya xatosi',
            description:
              'Har bir mahsulot bo‘yicha jami buyurtma miqdori qabul qilingan miqdordan kam bo‘lmasligi kerak',
            variant: 'destructive',
          });
          return false;
        }
      }
    }

    return true;
  };

  const canEditExpenses = !isReadOnly;

  const handleAddExpense = async () => {
    const title = expenseTitle.trim();
    const amount = Number(expenseAmount ?? 0);
    if (!title) {
      toast({ title: 'Xatolik', description: 'Xarajat nomi majburiy', variant: 'destructive' });
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      toast({ title: 'Xatolik', description: 'Xarajat summasi 0 dan katta yoki teng bo‘lishi kerak', variant: 'destructive' });
      return;
    }
    if (!canEditExpenses) {
      toast({ title: 'Xatolik', description: 'Xarajatlarni qabul qilish boshlanganidan keyin o‘zgartirib bo‘lmaydi', variant: 'destructive' });
      return;
    }

    // If PO already exists, persist immediately
    if (isEditMode && id) {
      try {
        setExpenseSaving(true);
        const list = await addPurchaseOrderExpense(id, {
          title,
          amount,
          allocation_method: expenseAllocation,
          notes: expenseNotes.trim() || null,
          created_by: user?.id || null,
        });
        setExpenses(
          (list || []).map((e: any) => ({
            id: e.id,
            temp_id: e.id,
            title: e.title,
            amount: Number(e.amount || 0) || 0,
            allocation_method: e.allocation_method === 'by_qty' ? 'by_qty' : 'by_value',
            notes: e.notes || null,
            created_at: e.created_at,
          }))
        );
        setExpenseTitle('');
        setExpenseAmount(null);
        setExpenseAllocation('by_value');
        setExpenseNotes('');
      } catch (err: any) {
        toast({ title: 'Xatolik', description: err?.message || 'Xarajatni saqlab bo‘lmadi', variant: 'destructive' });
      } finally {
        setExpenseSaving(false);
      }
      return;
    }

    // Otherwise store locally and persist after PO is created
    setExpenses((prev) => [
      {
        temp_id: `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title,
        amount,
        allocation_method: expenseAllocation,
        notes: expenseNotes.trim() || null,
      },
      ...prev,
    ]);
    setExpenseTitle('');
    setExpenseAmount(null);
    setExpenseAllocation('by_value');
    setExpenseNotes('');
  };

  const handleDeleteExpense = async (row: POExpenseRow) => {
    if (!canEditExpenses) return;
    // persisted
    if (row.id && isEditMode && id) {
      try {
        setExpenseSaving(true);
        const list = await deletePurchaseOrderExpense(id, row.id);
        setExpenses(
          (list || []).map((e: any) => ({
            id: e.id,
            temp_id: e.id,
            title: e.title,
            amount: Number(e.amount || 0) || 0,
            allocation_method: e.allocation_method === 'by_qty' ? 'by_qty' : 'by_value',
            notes: e.notes || null,
            created_at: e.created_at,
          }))
        );
      } catch (err: any) {
        toast({ title: 'Xatolik', description: err?.message || 'Xarajatni o‘chirib bo‘lmadi', variant: 'destructive' });
      } finally {
        setExpenseSaving(false);
      }
      return;
    }

    // local draft
    setExpenses((prev) => prev.filter((e) => e.temp_id !== row.temp_id));
  };

  const handleCreateSupplier = async () => {
    if (!newSupplierName.trim()) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Yetkazib beruvchi nomi majburiy',
        variant: 'destructive',
      });
      return;
    }

    if (newSupplierEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newSupplierEmail)) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Email formati noto\'g\'ri',
        variant: 'destructive',
      });
      return;
    }

    try {
      setCreatingSupplier(true);
      const newSupplier = await createSupplier({
        name: newSupplierName.trim(),
        phone: newSupplierPhone.trim() || null,
        email: newSupplierEmail.trim() || null,
        contact_person: null,
        address: null,
        note: null,
        status: 'active',
      });

      toast({
        title: 'Muvaffaqiyatli',
        description: 'Yetkazib beruvchi muvaffaqiyatli yaratildi',
      });

      // Reload suppliers and select the new one
      const updatedSuppliers = await getSuppliers();
      setSuppliers(updatedSuppliers);
      setSupplierId(newSupplier.id);

      // Reset modal
      setShowSupplierModal(false);
      setNewSupplierName('');
      setNewSupplierPhone('');
      setNewSupplierEmail('');
    } catch (error: unknown) {
      console.error('Create supplier error:', error);
      
      const errorMessage = error instanceof Error
        ? error.message
        : 'Yetkazib beruvchini yaratishda xatolik yuz berdi';
      
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setCreatingSupplier(false);
    }
  };

  /**
   * Ro‘yxatdagi "Tasdiqlash" bilan bir xil: saqlash → tasdiqlash → qoldiqni qabul qilish (createReceipt orqali).
   * Qisman qabul qilingan buyurtmada faqat qolgan miqdor yuboriladi.
   */
  const handleConfirmAndReceive = async () => {
    if (!isEditMode || !id || isReadOnly || !existingPO) return;
    if (existingPO.status === 'cancelled') {
      toast({ title: 'Xatolik', description: 'Bekor qilingan buyurtmani tasdiqlab bo‘lmaydi', variant: 'destructive' });
      return;
    }
    if (existingPO.status === 'received') return;
    if (!validateForm()) return;

    const totalReceived = (existingPO.items || []).reduce(
      (s, it: any) => s + Number(it.received_qty || 0),
      0
    );

    try {
      setLoading(true);

      if (totalReceived === 0) {
        const subtotal = calculateSubtotal();
        const orderDiscount = getOrderDiscountAmount(subtotal);
        const totalAmount = Math.max(0, subtotal - orderDiscount);
        const orderDiscountUsd = currency === 'USD' ? toUsd(orderDiscount) : null;
        const totalUsd =
          currency === 'USD' ? Math.max(0, calculateSubtotalUSD() - Number(orderDiscountUsd || 0)) : null;

        const existingItems = existingPO?.items || [];
        const persistStatus =
          existingPO.status === 'draft'
            ? 'draft'
            : existingPO.status === 'partially_received'
              ? 'partially_received'
              : existingPO.status === 'received'
                ? 'received'
                : (status as PurchaseOrderStatus);

        const purchaseOrderData: Partial<PurchaseOrder> = {
          supplier_id: supplierId,
          supplier_name: null,
          order_date: orderDate,
          expected_date: expectedDate || null,
          subtotal,
          discount: orderDiscount,
          tax: 0,
          total_amount: totalAmount,
          currency,
          fx_rate: currency === 'USD' ? fxRate : null,
          total_usd: totalUsd,
          status: persistStatus,
          notes,
        };

        const itemsData = items.map((item) => ({
          received_qty: Number(
            existingItems.find((it: any) => it.product_id === item.product_id)?.received_qty || 0
          ),
          product_id: item.product_id,
          product_name: item.product_name,
          ordered_qty: item.ordered_qty,
          unit_cost: item.unit_cost,
          line_total: item.line_total,
          unit_cost_usd: currency === 'USD' ? (item.unit_cost_usd ?? 0) : null,
          line_total_usd:
            currency === 'USD'
              ? (item.line_total_usd ?? Number(item.ordered_qty) * Number(item.unit_cost_usd || 0))
              : null,
          discount_amount: Number(item.discount_amount || 0) || 0,
          discount_percent: Number(item.discount_percent || 0) || 0,
          sale_price: Number(item.sale_price ?? 0) > 0 ? Number(item.sale_price) : null,
        }));

        await updatePurchaseOrder(id, purchaseOrderData, itemsData);
        invalidateDashboardQueries(queryClient);

        const pendingExpenses = expenses.filter(
          (e) => !e.id && (Number(e.amount || 0) || 0) >= 0 && String(e.title || '').trim()
        );
        if (pendingExpenses.length > 0) {
          try {
            setExpenseSaving(true);
            await Promise.all(
              pendingExpenses.map((e) =>
                addPurchaseOrderExpense(id, {
                  title: e.title,
                  amount: Number(e.amount || 0) || 0,
                  allocation_method: e.allocation_method,
                  notes: e.notes || null,
                  created_by: user?.id || null,
                })
              )
            );
            const refreshedExp = await getPurchaseOrderById(id);
            if (refreshedExp?.expenses) {
              setExpenses(
                (refreshedExp.expenses as PurchaseOrderExpense[]).map((ex) => ({
                  id: ex.id,
                  temp_id: ex.id,
                  title: ex.title,
                  amount: Number(ex.amount || 0) || 0,
                  allocation_method: ex.allocation_method === 'by_qty' ? 'by_qty' : 'by_value',
                  notes: ex.notes || null,
                  created_at: ex.created_at,
                }))
              );
            }
          } catch (err: any) {
            toast({
              title: 'Xatolik',
              description: err?.message || 'Xarajatlarni saqlab bo‘lmadi',
              variant: 'destructive',
            });
            return;
          } finally {
            setExpenseSaving(false);
          }
        }
      }

      let refreshed = await getPurchaseOrderById(id);
      if (refreshed.status === 'draft') {
        await approvePurchaseOrder(id, user?.id || 'default-admin-001');
        refreshed = await getPurchaseOrderById(id);
      }

      const receiveItems = (refreshed.items || [])
        .map((item: any) => ({
          item_id: item.id,
          received_qty: Number(item.ordered_qty) - Number(item.received_qty || 0),
        }))
        .filter((it: any) => Number(it.received_qty) > 0);

      if (receiveItems.length > 0) {
        await receiveGoods(id, receiveItems);
        productUpdateEmitter.emit();
      }

      const finalPo = await getPurchaseOrderById(id);
      setExistingPO(finalPo);
      setStatus((finalPo.status as PurchaseOrderStatus) || 'draft');

      invalidateDashboardQueries(queryClient);
      toast({
        title: 'Muvaffaqiyatli',
        description:
          receiveItems.length > 0
            ? 'Buyurtma tasdiqlandi va omborga qabul qilindi'
            : 'Buyurtma tasdiqlandi (qabul qilinadigan qoldiq yo‘q)',
      });
      navigate('/purchase-orders');
    } catch (error: unknown) {
      console.error('Confirm purchase order error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Tasdiqlash yoki qabul qilishda xatolik yuz berdi';
      toast({ title: 'Xatolik', description: errorMessage, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const showConfirmReceiveButton =
    isEditMode &&
    !isReadOnly &&
    existingPO &&
    !['received', 'cancelled'].includes(String(existingPO.status || ''));

  const confirmReceiveLabel =
    (existingPO?.items || []).some((it: any) => Number(it.received_qty || 0) > 0)
      ? 'Qolganini omborga qabul qilish'
      : 'Tasdiqlash va omborga qabul qilish';

  const handleSave = async (markAsReceived = false): Promise<void> => {
    if (!validateForm()) return;

    try {
      setLoading(true);

      // Calculate subtotal safely
      const subtotal = calculateSubtotal();
      const orderDiscount = getOrderDiscountAmount(subtotal);
      const totalAmount = Math.max(0, subtotal - orderDiscount);
      const orderDiscountUsd = currency === 'USD' ? toUsd(orderDiscount) : null;
      const totalUsd =
        currency === 'USD' ? Math.max(0, calculateSubtotalUSD() - Number(orderDiscountUsd || 0)) : null;
      
      let poId: string;

      if (isEditMode && id) {
        // Update existing PO
        const existingItems = existingPO?.items || [];
        const purchaseOrderData: Partial<PurchaseOrder> = {
          supplier_id: supplierId,
          supplier_name: null,
          order_date: orderDate,
          expected_date: expectedDate || null,
          subtotal,
          discount: orderDiscount,
          tax: 0,
          total_amount: totalAmount,
          currency,
          fx_rate: currency === 'USD' ? fxRate : null,
          total_usd: totalUsd,
          status: (markAsReceived
            ? 'received'
            : existingPO?.status === 'partially_received'
              ? 'partially_received'
              : existingPO?.status === 'received'
                ? 'received'
                : status) as PurchaseOrderStatus,
          received_by: markAsReceived ? (user?.id || null) : undefined,
          notes,
        };

        const itemsData = items.map((item) => ({
          // Preserve existing received_qty to avoid wiping partial receipts
          received_qty: Number(
            existingItems.find((it: any) => it.product_id === item.product_id)?.received_qty || 0
          ),
          product_id: item.product_id,
          product_name: item.product_name,
          ordered_qty: item.ordered_qty,
          unit_cost: item.unit_cost,
          line_total: item.line_total,
          unit_cost_usd: currency === 'USD' ? (item.unit_cost_usd ?? 0) : null,
          line_total_usd:
            currency === 'USD'
              ? (item.line_total_usd ?? Number(item.ordered_qty) * Number(item.unit_cost_usd || 0))
              : null,
          discount_amount: Number(item.discount_amount || 0) || 0,
          discount_percent: Number(item.discount_percent || 0) || 0,
          sale_price: Number(item.sale_price ?? 0) > 0 ? Number(item.sale_price) : null,
        }));

        await updatePurchaseOrder(id, purchaseOrderData, itemsData);
        poId = id;
        
        // Invalidate dashboard queries
        invalidateDashboardQueries(queryClient);
        
        toast({
          title: 'Muvaffaqiyatli',
          description: isEditMode 
            ? 'Xarid buyurtmasi muvaffaqiyatli yangilandi'
            : 'Xarid buyurtmasi muvaffaqiyatli yaratildi',
        });
      } else {
        // IMPORTANT: When creating a NEW PO with markAsReceived=true:
        // - Create with status='approved' (NOT 'received') so receipt creation can process it
        // - Set received_qty=0 initially, let receipt creation handle the receiving
        const purchaseOrderData: Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'> = {
          // In Electron/SQLite mode, backend generates the final po_number.
          // We still keep a placeholder for typings; backend will ignore it.
          po_number: `PO-${Date.now()}`,
          supplier_id: supplierId,
          supplier_name: null,
          order_date: orderDate,
          expected_date: expectedDate || null,
          reference: null,
          subtotal,
          discount: orderDiscount,
          tax: 0,
          total_amount: totalAmount,
          currency,
          fx_rate: currency === 'USD' ? fxRate : null,
          total_usd: totalUsd,
          // For NEW PO: if markAsReceived, create as 'approved' so receipt can process it
          // If NOT markAsReceived, use the selected status (usually 'draft')
          status: (markAsReceived ? 'approved' : status) as PurchaseOrderStatus,
          invoice_number: null,
          received_by: null, // Will be set by receipt if markAsReceived
          approved_by: null,
          approved_at: null,
          notes,
          created_by: user?.id || null,
        };

        // IMPORTANT: Always set received_qty=0 when creating NEW PO
        // Receipt will update it when receiving
        const itemsData = items.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          ordered_qty: item.ordered_qty,
          received_qty: 0, // Always 0 for new PO - receipt will update it
          unit_cost: item.unit_cost,
          line_total: item.line_total,
          unit_cost_usd: currency === 'USD' ? (item.unit_cost_usd ?? 0) : null,
          line_total_usd:
            currency === 'USD'
              ? (item.line_total_usd ?? Number(item.ordered_qty) * Number(item.unit_cost_usd || 0))
              : null,
          discount_amount: Number(item.discount_amount || 0) || 0,
          discount_percent: Number(item.discount_percent || 0) || 0,
          sale_price: Number(item.sale_price ?? 0) > 0 ? Number(item.sale_price) : null,
        }));

        const newPO = await createPurchaseOrder(purchaseOrderData, itemsData);
        poId = newPO.id;
        
        // Invalidate dashboard queries
        invalidateDashboardQueries(queryClient);
        
        toast({
          title: 'Muvaffaqiyatli',
          description: 'Xarid buyurtmasi muvaffaqiyatli yaratildi',
        });
      }

      // Persist expenses BEFORE receiving goods (backend disallows changes after receiving starts)
      const pendingExpenses = expenses.filter((e) => !e.id && (Number(e.amount || 0) || 0) >= 0 && String(e.title || '').trim());
      if (pendingExpenses.length > 0) {
        try {
          setExpenseSaving(true);
          await Promise.all(
            pendingExpenses.map((e) =>
              addPurchaseOrderExpense(poId, {
                title: e.title,
                amount: Number(e.amount || 0) || 0,
                allocation_method: e.allocation_method,
                notes: e.notes || null,
                created_by: user?.id || null,
              })
            )
          );
          // Reload PO to get computed landed costs/expenses list
          const refreshed = await getPurchaseOrderById(poId);
          if (refreshed?.expenses) {
            setExpenses(
              (refreshed.expenses as PurchaseOrderExpense[]).map((ex) => ({
                id: ex.id,
                temp_id: ex.id,
                title: ex.title,
                amount: Number(ex.amount || 0) || 0,
                allocation_method: ex.allocation_method === 'by_qty' ? 'by_qty' : 'by_value',
                notes: ex.notes || null,
                created_at: ex.created_at,
              }))
            );
          }
        } catch (err: any) {
          toast({
            title: 'Xatolik',
            description: err?.message || 'Xarajatlarni saqlab bo‘lmadi',
            variant: 'destructive',
          });
        } finally {
          setExpenseSaving(false);
        }
      }

      // If marking as received, create receipt to update stock and status
      // This works for both NEW and EXISTING POs
      if (markAsReceived) {
        // Fetch the created/updated PO to get the actual item IDs
        const createdPO = await getPurchaseOrderById(poId);
        const receiptCurrency = currency;
        const receiptFxRate = receiptCurrency === 'USD' ? getFxRateSafe() : null;

        const receiptItems = (createdPO.items || []).map((poItem: any) => {
          const formItem = items.find((fi) => fi.product_id === poItem.product_id);
          const qty = poItem.ordered_qty - poItem.received_qty;
          const unitCost = Number(formItem?.unit_cost ?? poItem.unit_cost ?? 0) || 0;
          const unitCostUsd = receiptCurrency === 'USD'
            ? Number(formItem?.unit_cost_usd ?? poItem.unit_cost_usd ?? 0) || 0
            : null;
          const lineTotalUsd = receiptCurrency === 'USD' && unitCostUsd != null
            ? qty * unitCostUsd
            : null;
          return {
            purchase_order_item_id: poItem.id,
            product_id: poItem.product_id,
            product_name: poItem.product_name,
            received_qty: qty,
            unit_cost: unitCost,
            line_total: qty * unitCost,
            unit_cost_usd: unitCostUsd,
            line_total_usd: lineTotalUsd,
          };
        }).filter((it: any) => Number(it.received_qty || 0) > 0);

        await createPurchaseReceipt({
          purchase_order_id: poId,
          supplier_id: supplierId || null,
          currency: receiptCurrency,
          exchange_rate: receiptFxRate,
          status: 'received',
          received_at: orderDate,
          created_by: user?.id || null,
          items: receiptItems,
        });

        // Invalidate dashboard queries
        invalidateDashboardQueries(queryClient);

        // Emit product update event to refresh inventory pages
        // This ensures inventory quantities update immediately across all open pages
        productUpdateEmitter.emit();

        toast({
          title: 'Muvaffaqiyatli',
          description: 'Ombor muvaffaqiyatli yangilandi',
        });
      }

      navigate('/purchase-orders');
    } catch (error: unknown) {
      console.error('Purchase order save error:', error);
      
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Xarid buyurtmasini saqlashda xatolik yuz berdi';
      
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(
    (product) =>
      searchTerm &&
      (product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (product.barcode && product.barcode.toLowerCase().includes(searchTerm.toLowerCase())))
  );

  const filteredOrderItems = useMemo(() => {
    const term = itemsSearchTerm.trim().toLowerCase();
    if (!term) return items;

    return items.filter((item) => {
      const name = String(item.product_name || '').toLowerCase();
      const sku = String(item.product_sku || '').toLowerCase();
      return name.includes(term) || sku.includes(term);
    });
  }, [items, itemsSearchTerm]);

  const getEffectiveUnitCost = (item: OrderItem) => {
    const landedUnitCost = allocationsByProductId.get(item.product_id)?.landedUnitCost;
    return Number(landedUnitCost ?? item.unit_cost ?? 0) || 0;
  };

  const getMarginPercent = (item: OrderItem) => {
    const salePrice = Number(item.sale_price ?? 0) || 0;
    const cost = getEffectiveUnitCost(item);
    if (salePrice <= 0 || cost <= 0) return null;
    return ((salePrice - cost) / cost) * 100;
  };

  const subtotal = calculateSubtotal();
  const orderDiscountApplied = getOrderDiscountAmount(subtotal);
  const totalAmount = Math.max(0, subtotal - orderDiscountApplied);
  const orderDiscountUsd = currency === 'USD' ? toUsd(orderDiscountApplied) : null;
  const totalUsd = currency === 'USD' ? Math.max(0, calculateSubtotalUSD() - Number(orderDiscountUsd || 0)) : null;

  if (loading && !suppliers.length) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/purchase-orders')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">
              {isEditMode ? 'Xarid buyurtmasini tahrirlash' : 'Yangi xarid buyurtmasi'}
            </h1>
            <p className="text-muted-foreground">
              {isReadOnly
                ? 'Bu xarid buyurtmasi qabul qilingan va tahrirlash mumkin emas'
                : 'Xarid buyurtmasini yaratish yoki tahrirlash uchun quyidagi maʼlumotlarni toʻldiring'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Asosiy maʼlumotlar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="supplier">
                    Yetkazib beruvchi <span className="text-destructive">*</span>
                  </Label>
                  <div className="flex gap-2">
                    <Select value={supplierId} onValueChange={setSupplierId} disabled={isReadOnly}>
                      <SelectTrigger id="supplier" className="flex-1">
                        <SelectValue placeholder="Yetkazib beruvchini tanlang" />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!isReadOnly && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setShowSupplierModal(true)}
                        title="Yangi yetkazib beruvchi qo'shish"
                      >
                        <UserPlus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="order-date">
                    Buyurtma sanasi <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="order-date"
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    disabled={isReadOnly}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expected-date">Kutilayotgan sana</Label>
                  <Input
                    id="expected-date"
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    disabled={isReadOnly}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Holati</Label>
                  <Select
                    value={status}
                    onValueChange={(value) => setStatus(value as PurchaseOrderStatus)}
                    disabled={isReadOnly || status === 'partially_received' || status === 'received'}
                  >
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Qoralama</SelectItem>
                      <SelectItem value="approved">Tasdiqlangan</SelectItem>
                      {status === 'partially_received' && (
                        <SelectItem value="partially_received" disabled>
                          Qisman qabul qilingan
                        </SelectItem>
                      )}
                      {status === 'received' && (
                        <SelectItem value="received" disabled>
                          Qabul qilingan
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {(status === 'approved' || status === 'partially_received' || status === 'received') &&
                    !isReadOnly && (
                    <p className="text-xs text-muted-foreground">
                      {status === 'approved'
                        ? 'Tasdiqlangan buyurtmani hali omborga kiritilmaguncha tahrirlashingiz mumkin.'
                        : status === 'partially_received'
                          ? 'Qabul qilingan qatorlar va miqdorlar saqlanadi; faqat buyurtma miqdori qabuldan kam bo‘lmasligi kerak.'
                          : 'Qabul qilingan buyurtmada narxlarni, izohni va xarajatlarni tuzatishingiz mumkin. Ombordagi fizik qoldiq o‘zgarmaydi — faqat hujjatdagi miqdorlarni kamaytirsangiz, avval ombor bo‘yicha moslashtirish kerak bo‘lishi mumkin.'}
                    </p>
                  )}
                </div>

                {currency === 'USD' && (
                  <div className="space-y-2">
                    <Label htmlFor="fx-rate">Kurs (1 USD = ? UZS)</Label>
                    <MoneyInput
                      id="fx-rate"
                      value={typeof fxRate === 'number' ? fxRate : null}
                      onValueChange={(val) => setFxRate(Number(val ?? 0))}
                      placeholder="0"
                      allowDecimals
                      allowZero={false}
                      min={0}
                      containerClassName="space-y-0"
                      className="text-right"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Izohlar</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Qo'shimcha izoh kiriting..."
                  rows={3}
                  disabled={isReadOnly}
                />
              </div>
            </CardContent>
          </Card>

          {/* Products */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle>Mahsulotlar</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    ({items.length} xil)
                  </span>
                </div>
                {!isReadOnly && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={openProductSearch}>
                      <Plus className="h-4 w-4 mr-2" />
                      Mahsulot qo'shish
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCreateProductModal(true)}
                    >
                      <Package className="h-4 w-4 mr-2" />
                      Yangi mahsulot yaratish
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowProductSearch(!showProductSearch)}
                    >
                      <Search className="h-4 w-4 mr-2" />
                    {showProductSearch ? 'Qidiruvni yashirish' : 'Qidiruvni ko‘rsatish'}
                  </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isReadOnly && showProductSearch && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        ref={searchInputRef}
                        placeholder="Mahsulotni nom, SKU yoki shtrix kod bo'yicha qidirish..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <div className="relative flex-1 flex gap-2 min-w-0">
                      <div className="relative flex-1 min-w-0">
                        <Barcode className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          ref={barcodeInputRef}
                          placeholder="Shtrix kod skanerlash yoki kiriting..."
                          value={barcodeInput}
                          onChange={(e) => setBarcodeInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleBarcodeAdd();
                            }
                          }}
                          className="pl-9"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleBarcodeAdd}
                        disabled={!barcodeInput.trim()}
                      >
                        Qo'shish
                      </Button>
                    </div>
                  </div>
                  {(searchTerm ? filteredProducts : products.slice(0, 50)).length > 0 && (
                    <Card>
                      <CardContent className="p-2 max-h-60 overflow-y-auto">
                        {(searchTerm ? filteredProducts : products.slice(0, 50)).map((product) => (
                          <div
                            key={product.id}
                            className="flex items-center justify-between p-2 hover:bg-muted rounded cursor-pointer"
                            onClick={() => addProduct(product)}
                          >
                            <div>
                              <p className="font-medium">{product.name}</p>
                              <p className="text-sm text-muted-foreground">
                                SKU: {product.sku} | Stock: {product.current_stock} {formatUnit(product.unit)}
                              </p>
                            </div>
                            <p className="text-sm font-medium">
                              {formatMoneyUZS(product.purchase_price)}
                            </p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground space-y-4">
                  <p>Hozircha mahsulot qo'shilmagan</p>
                  {!isReadOnly && (
                    <>
                      <p className="text-sm">Mavjud mahsulotni qo'shing yoki yangi mahsulot yarating</p>
                      <div className="flex gap-3 justify-center flex-wrap">
                        <Button size="lg" onClick={openProductSearch}>
                          <Plus className="h-5 w-5 mr-2" />
                          Mahsulot qo'shish
                        </Button>
                        <Button size="lg" variant="outline" onClick={() => setShowCreateProductModal(true)}>
                          <Package className="h-5 w-5 mr-2" />
                          Yangi mahsulot yaratish
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buyurtmadagi mahsulotlarni nom yoki SKU bo'yicha qidirish..."
                      value={itemsSearchTerm}
                      onChange={(e) => setItemsSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mahsulot</TableHead>
                      <TableHead className="text-right">Miqdor</TableHead>
                      <TableHead className="text-right">
                        {currency === 'USD' ? 'Birlik narxi (USD)' : 'Birlik narxi'}
                      </TableHead>
                      <TableHead className="text-right">Sotish narxi</TableHead>
                      <TableHead className="text-right">Marja (%)</TableHead>
                      <TableHead className="text-right">Chegirma (%)</TableHead>
                      <TableHead className="text-right">
                        {currency === 'USD' ? 'Chegirma (USD)' : 'Chegirma'}
                      </TableHead>
                      {currency === 'USD' && <TableHead className="text-right">Tannarx (UZS)</TableHead>}
                      {totalExpenses > 0 && <TableHead className="text-right">Xarajat</TableHead>}
                      {totalExpenses > 0 && <TableHead className="text-right">Landed tannarx</TableHead>}
                      <TableHead className="text-right">Jami</TableHead>
                      {!isReadOnly && <TableHead className="text-right">Amallar</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrderItems.map((item) => {
                      const index = items.findIndex((it) => it.product_id === item.product_id);
                      const marginPercent = getMarginPercent(item);
                      return (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{item.product_name}</TableCell>
                        <TableCell className="text-right">
                          {isReadOnly ? (
                            item.ordered_qty
                          ) : (
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={item.ordered_qty}
                              onChange={(e) =>
                                updateItem(index, 'ordered_qty', Number(e.target.value))
                              }
                              className="w-24 text-right"
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {currency === 'USD' ? (
                            isReadOnly ? (
                              <span className="font-mono">{Number(item.base_unit_cost_usd || 0).toFixed(2)}</span>
                            ) : (
                              <MoneyInput
                                id={`unit-cost-usd-${index}`}
                                value={
                                  typeof item.base_unit_cost_usd === 'number'
                                    ? item.base_unit_cost_usd
                                    : null
                                }
                                onValueChange={(val) =>
                                  updateItem(index, 'base_unit_cost_usd', Number(val ?? 0))
                                }
                                placeholder="0"
                                allowDecimals
                                allowZero
                                min={0}
                                containerClassName="space-y-0"
                                className="w-32 text-right"
                              />
                            )
                          ) : isReadOnly ? (
                            formatMoneyUZS(Number(item.base_unit_cost || 0))
                          ) : (
                            <MoneyInput
                              id={`unit-cost-${index}`}
                              value={typeof item.base_unit_cost === 'number' ? item.base_unit_cost : null}
                              onValueChange={(val) => updateItem(index, 'base_unit_cost', Number(val ?? 0))}
                              placeholder="0"
                              allowDecimals
                              allowZero
                              min={0}
                              containerClassName="space-y-0"
                              className="w-32 text-right"
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isReadOnly ? (
                            Number(item.sale_price ?? 0) > 0 ? formatMoneyUZS(item.sale_price!) : '-'
                          ) : (
                            <MoneyInput
                              id={`sale-price-${index}`}
                              value={typeof item.sale_price === 'number' && item.sale_price > 0 ? item.sale_price : null}
                              onValueChange={(val) => updateItem(index, 'sale_price', Number(val ?? 0))}
                              placeholder="0"
                              allowDecimals
                              allowZero
                              min={0}
                              containerClassName="space-y-0"
                              className="w-32 text-right"
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {marginPercent == null ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            <span
                              className={
                                marginPercent >= 20
                                  ? 'text-success font-medium'
                                  : marginPercent >= 10
                                    ? 'text-warning font-medium'
                                    : 'text-destructive font-medium'
                              }
                            >
                              {marginPercent.toFixed(1)}%
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isReadOnly ? (
                            <span>{Number(item.discount_percent || 0).toFixed(2)}%</span>
                          ) : (
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={Number(item.discount_percent || 0)}
                              onChange={(e) => updateItem(index, 'discount_percent', Number(e.target.value))}
                              className="w-24 text-right"
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isReadOnly ? (
                            currency === 'USD' ? (
                              <span className="font-mono">{toUsd(Number(item.discount_amount || 0)).toFixed(2)}</span>
                            ) : (
                              formatMoneyUZS(Number(item.discount_amount || 0))
                            )
                          ) : currency === 'USD' ? (
                            <MoneyInput
                              id={`discount-amount-usd-${index}`}
                              value={toUsd(Number(item.discount_amount || 0))}
                              onValueChange={(val) =>
                                updateItem(index, 'discount_amount', toUzs(Number(val ?? 0)))
                              }
                              placeholder="0"
                              allowDecimals
                              allowZero
                              min={0}
                              containerClassName="space-y-0"
                              className="w-32 text-right"
                            />
                          ) : (
                            <MoneyInput
                              id={`discount-amount-${index}`}
                              value={typeof item.discount_amount === 'number' ? item.discount_amount : null}
                              onValueChange={(val) => updateItem(index, 'discount_amount', Number(val ?? 0))}
                              placeholder="0"
                              allowDecimals
                              allowZero
                              min={0}
                              containerClassName="space-y-0"
                              className="w-32 text-right"
                            />
                          )}
                        </TableCell>
                        {currency === 'USD' && (
                          <TableCell className="text-right">
                            {formatMoneyUZS(item.unit_cost)}
                          </TableCell>
                        )}
                        {totalExpenses > 0 && (
                          <TableCell className="text-right">
                            {formatMoneyUZS(allocationsByProductId.get(item.product_id)?.allocated || 0)}
                          </TableCell>
                        )}
                        {totalExpenses > 0 && (
                          <TableCell className="text-right">
                            {formatMoneyUZS(allocationsByProductId.get(item.product_id)?.landedUnitCost || item.unit_cost)}
                          </TableCell>
                        )}
                        <TableCell className="text-right font-medium">
                          {formatMoneyUZS(item.line_total)}
                        </TableCell>
                        {!isReadOnly && (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeItem(index)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    )})}
                  </TableBody>
                </Table>
                </>
              )}
            </CardContent>
          </Card>

        </div>

        {/* Summary */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Buyurtma yig'indisi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Oraliq summa</span>
                  <span className="font-medium">{formatMoneyUZS(subtotal)}</span>
                </div>
                {currency === 'USD' && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Oraliq summa (USD)</span>
                    <span className="font-medium">{calculateSubtotalUSD().toFixed(2)} USD</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Xarajatlar</span>
                  <span className="font-medium">{formatMoneyUZS(totalExpenses)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Chegirma (%)</span>
                  {isReadOnly ? (
                    <span className="font-medium">{Number(orderDiscountPercent || 0).toFixed(2)}%</span>
                  ) : (
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={Number(orderDiscountPercent || 0)}
                      onChange={(e) => {
                        setOrderDiscountMode('percent');
                        setOrderDiscountPercent(Number(e.target.value));
                      }}
                      className="w-28 text-right"
                    />
                  )}
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {currency === 'USD' ? 'Chegirma (USD)' : 'Chegirma'}
                  </span>
                  {isReadOnly ? (
                    currency === 'USD' ? (
                      <span className="font-medium">{Number(orderDiscountUsd || 0).toFixed(2)} USD</span>
                    ) : (
                      <span className="font-medium">{formatMoneyUZS(orderDiscountApplied)}</span>
                    )
                  ) : currency === 'USD' ? (
                    <MoneyInput
                      id="order-discount-usd"
                      value={typeof orderDiscountUsd === 'number' ? orderDiscountUsd : null}
                      onValueChange={(val) => {
                        setOrderDiscountMode('amount');
                        setOrderDiscountAmount(toUzs(Number(val ?? 0)));
                      }}
                      placeholder="0"
                      allowDecimals
                      allowZero
                      min={0}
                      containerClassName="space-y-0"
                      className="w-28 text-right"
                    />
                  ) : (
                    <MoneyInput
                      id="order-discount-amount"
                      value={typeof orderDiscountAmount === 'number' ? orderDiscountAmount : null}
                      onValueChange={(val) => {
                        setOrderDiscountMode('amount');
                        setOrderDiscountAmount(Number(val ?? 0));
                      }}
                      placeholder="0"
                      allowDecimals
                      allowZero
                      min={0}
                      containerClassName="space-y-0"
                      className="w-28 text-right"
                    />
                  )}
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Soliq</span>
                  <span className="font-medium">{formatMoneyUZS(0)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between">
                  <span className="font-semibold">Jami</span>
                  <span className="font-bold text-lg">{formatMoneyUZS(totalAmount)}</span>
                </div>
                {currency === 'USD' && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Jami (USD)</span>
                    <span className="font-medium">{Number(totalUsd || 0).toFixed(2)} USD</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Jami + xarajat</span>
                  <span className="font-semibold">
                    {formatMoneyUZS(totalAmount + totalExpenses)}
                  </span>
                </div>
              </div>

              {!isReadOnly && (
                <div className="space-y-2">
                  <Button
                    className="w-full"
                    onClick={() => handleSave(false)}
                    disabled={loading || items.length === 0}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {isEditMode ? 'Xarid buyurtmasini yangilash' : 'Qoralama sifatida saqlash'}
                  </Button>

                  {!isEditMode && (
                    <Button
                      className="w-full"
                      variant="default"
                      onClick={() => handleSave(true)}
                      disabled={loading || items.length === 0}
                    >
                      <Package className="h-4 w-4 mr-2" />
                      Saqlash va qabul qilingan deb belgilash
                    </Button>
                  )}

                  {showConfirmReceiveButton && (
                    <Button
                      className="w-full"
                      variant="default"
                      onClick={() => void handleConfirmAndReceive()}
                      disabled={loading || items.length === 0}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      {confirmReceiveLabel}
                    </Button>
                  )}
                </div>
              )}

              <div className="text-xs text-muted-foreground space-y-1">
                <p>• Qoralama: Ombor miqdoriga ta'sir qilmaydi</p>
                <p>• Qabul qilingan deb belgilash: Ombor qoldig'i darhol yangilanadi</p>
                {showConfirmReceiveButton && (
                  <p>• Tasdiqlash: avval saqlaydi, keyin tasdiqlaydi va qoldiqni omborga yozadi</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Expenses (landed cost) */}
          <Card>
            <CardHeader>
              <CardTitle>Xarajatlar (tannarxga uriladi)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canEditExpenses && (
                <p className="text-sm text-muted-foreground">Bekor qilingan buyurtmada xarajatlarni o‘zgartirib bo‘lmaydi.</p>
              )}
              {canEditExpenses && existingPO?.status === 'received' && (
                <p className="text-sm text-muted-foreground">
                  Qabul qilingan buyurtmada ham xarajat qo‘shish, o‘zgartirish va o‘chirish mumkin.
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2 space-y-2">
                  <Label>Xarajat nomi *</Label>
                  <Input
                    value={expenseTitle}
                    onChange={(e) => setExpenseTitle(e.target.value)}
                    placeholder="Masalan: Transport, Yuklash, Customs..."
                    disabled={!canEditExpenses || expenseSaving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Summa *</Label>
                  <MoneyInput
                    id="po-expense-amount"
                    value={expenseAmount}
                    onValueChange={(val) => setExpenseAmount(val)}
                    placeholder="0"
                    allowDecimals
                    allowZero
                    min={0}
                    containerClassName="space-y-0"
                    className="text-right"
                    disabled={!canEditExpenses || expenseSaving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Taqsimlash</Label>
                  <Select
                    value={expenseAllocation}
                    onValueChange={(v) => setExpenseAllocation(v as 'by_value' | 'by_qty')}
                    disabled={!canEditExpenses || expenseSaving}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="by_value">Qiymat bo‘yicha</SelectItem>
                      <SelectItem value="by_qty">Miqdor bo‘yicha</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-3 space-y-2">
                  <Label>Izoh</Label>
                  <Input
                    value={expenseNotes}
                    onChange={(e) => setExpenseNotes(e.target.value)}
                    placeholder="Ixtiyoriy izoh..."
                    disabled={!canEditExpenses || expenseSaving}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={handleAddExpense}
                    disabled={!canEditExpenses || expenseSaving}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Qo‘shish
                  </Button>
                </div>
              </div>

              <div className="flex justify-between text-sm pt-1">
                <span className="text-muted-foreground">Jami xarajat:</span>
                <span className="font-semibold">{formatMoneyUZS(totalExpenses)}</span>
              </div>

              {expenses.length === 0 ? (
                <p className="text-sm text-muted-foreground">Hozircha xarajat kiritilmagan</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nomi</TableHead>
                      <TableHead>Taqsimlash</TableHead>
                      <TableHead className="text-right">Summa</TableHead>
                      {canEditExpenses && <TableHead className="text-right">Amallar</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((e) => (
                      <TableRow key={e.temp_id}>
                        <TableCell className="font-medium">{e.title}</TableCell>
                        <TableCell>{e.allocation_method === 'by_qty' ? 'Miqdor bo‘yicha' : 'Qiymat bo‘yicha'}</TableCell>
                        <TableCell className="text-right">{formatMoneyUZS(Number(e.amount || 0) || 0)}</TableCell>
                        {canEditExpenses && (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={expenseSaving}
                              onClick={() => handleDeleteExpense(e)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add New Supplier Modal */}
      <Dialog open={showSupplierModal} onOpenChange={setShowSupplierModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yangi yetkazib beruvchi qo'shish</DialogTitle>
            <DialogDescription>
              Xarid buyurtmangizga yangi yetkazib beruvchi qo'shing
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-supplier-name">
                Yetkazib beruvchi nomi <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new-supplier-name"
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder="Yetkazib beruvchi nomini kiriting"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-supplier-phone">Telefon</Label>
              <Input
                id="new-supplier-phone"
                value={newSupplierPhone}
                onChange={(e) => setNewSupplierPhone(e.target.value)}
                placeholder="Telefon raqamini kiriting"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-supplier-email">Email</Label>
              <Input
                id="new-supplier-email"
                type="email"
                value={newSupplierEmail}
                onChange={(e) => setNewSupplierEmail(e.target.value)}
                placeholder="Email manzilini kiriting"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowSupplierModal(false);
                setNewSupplierName('');
                setNewSupplierPhone('');
                setNewSupplierEmail('');
              }}
            >
              Bekor qilish
            </Button>
            <Button onClick={handleCreateSupplier} disabled={creatingSupplier}>
              {creatingSupplier ? 'Yaratilmoqda...' : 'Yetkazib beruvchi yaratish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateProductModal
        open={showCreateProductModal}
        onOpenChange={setShowCreateProductModal}
        onCreated={handleProductCreated}
      />
    </div>
  );
}
