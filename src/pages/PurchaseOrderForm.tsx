import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
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
import { useDebounce } from '@/hooks/use-debounce';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useFormListReturn } from '@/hooks/useFormListReturn';
import { useAuth } from '@/contexts/AuthContext';
import { formatUnit } from '@/utils/formatters';
import { formatMoneyUZS } from '@/lib/format';
import { formatMoney, normalizeCurrency } from '@/lib/currency';
import { invalidateDashboardQueries } from '@/utils/dashboard';
import MoneyInput from '@/components/common/MoneyInput';
import {
  getSuppliers,
  getPurchaseOrderById,
  searchProducts,
  getProductByBarcode,
  getProductBySku,
  getProductsScanIndex,
  resolveProductScan,
  getCategories,
  createPurchaseOrder,
  updatePurchaseOrder,
  generatePONumber,
  createSupplier,
  searchSuppliers,
  getSupplierPurchaseSummary,
  productUpdateEmitter,
  addPurchaseOrderExpense,
  deletePurchaseOrderExpense,
  getLatestExchangeRate,
  createPurchaseReceipt,
  approvePurchaseOrder,
  receiveGoods,
  createSupplierPayment,
} from '@/db/api';
import CreateProductModal from '@/components/products/CreateProductModal';
import PurchaseOrderFormView from '@/components/purchase/PurchaseOrderFormView';
import PurchaseOrderBulkAddModal from '@/components/purchase/PurchaseOrderBulkAddModal';
import {
  createPurchaseScanIndex,
  filterPurchaseCatalog,
  filterPurchaseCatalogWithTotal,
  getScanLookupKeys,
  lookupPurchaseScan,
  PO_PRODUCT_SEARCH_LIMIT,
  registerPurchaseScanProduct,
  type ProductScanIndex,
  type ProductScanIndexEntry,
} from '@/lib/purchase/purchaseScanSearch';
import { getSaleUnitConfig } from '@/pages/posTerminalHelpers';
import type {
  SupplierWithBalance,
  ProductWithCategory,
  Category,
  PurchaseOrderWithDetails,
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseOrderExpense,
} from '@/types/database';
import { Plus, Trash2, Search, ArrowLeft, Save, Package, UserPlus, Barcode, CheckCircle, AlertTriangle, ChevronDown, ChevronRight, Wallet } from 'lucide-react';
import { todayYMD } from '@/lib/datetime';
import {
  buildSupplierPaymentPayload,
  convertFromSettlementCurrency,
  convertToSettlementCurrency,
  type LedgerCurrency,
} from '@/lib/supplierPaymentPayload';
import {
  computeSchemeSummary,
  normalizePaymentScheme,
  normalizeDueDate,
  validateInstallmentScheduleSum,
  type PoPaymentScheme,
  type PoScheduleRow,
} from '@/lib/purchasePaymentScheme';
import {
  findPoOrderQtyViolations,
  violationsToMap,
} from '@/lib/purchase/purchaseOrderQtyValidation';
import {
  findZeroCostPoLineNames,
  salePriceForPoLineSave,
} from '@/lib/purchase/purchaseOrderLinePricing';
import { isElectron } from '@/utils/electron';

interface OrderItem {
  id?: string;
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
  sale_unit?: string;
  product_barcode?: string | null;
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

type AuditFilterKey = 'all' | 'zeroCost' | 'negativeMargin' | 'discountAnomaly' | 'heavyExpenseItems';

type PoPaymentMethod = 'cash' | 'card' | 'transfer' | 'click' | 'payme' | 'uzum';

type PoLineForReceipt = {
  id: string;
  product_id: string;
  product_name?: string | null;
  ordered_qty: number;
  received_qty?: number | null;
  unit_cost?: number;
  unit_cost_usd?: number | null;
  landed_unit_cost?: number | null;
};

/** Build receipt lines from saved PO rows + current form (Saqlash va qabul). */
function buildReceiptItemsForReceive(
  poItems: PoLineForReceipt[],
  formItems: OrderItem[],
  options: {
    poCurrency: 'UZS' | 'USD';
    fxRate: number | null;
    allocationsByProductId: Map<string, { landedUnitCost: number }>;
  },
) {
  const { poCurrency, fxRate, allocationsByProductId } = options;
  const receiptFxRate = poCurrency === 'USD' ? fxRate : null;

  return poItems
    .map((poItem) => {
      const formItem = formItems.find(
        (fi) => (poItem.id && fi.id === poItem.id) || fi.product_id === poItem.product_id,
      );
      const ordered = Number(formItem?.ordered_qty ?? poItem.ordered_qty ?? 0);
      const alreadyReceived = Number(poItem.received_qty ?? 0);
      const qty = Math.max(0, ordered - alreadyReceived);
      if (!Number.isFinite(qty) || qty <= 0) return null;

      const unitCost =
        Number(
          poItem.landed_unit_cost ??
            allocationsByProductId.get(poItem.product_id)?.landedUnitCost ??
            formItem?.unit_cost ??
            poItem.unit_cost ??
            0,
        ) || 0;
      const unitCostUsd =
        poCurrency === 'USD'
          ? Number(
              (receiptFxRate && receiptFxRate > 0 ? unitCost / receiptFxRate : null) ??
                formItem?.unit_cost_usd ??
                poItem.unit_cost_usd ??
                0,
            ) || 0
          : null;
      const lineTotalUsd =
        poCurrency === 'USD' && unitCostUsd != null ? qty * unitCostUsd : null;

      return {
        purchase_order_item_id: poItem.id,
        product_id: poItem.product_id,
        product_name: poItem.product_name ?? formItem?.product_name ?? '',
        received_qty: qty,
        unit_cost: unitCost,
        line_total: qty * unitCost,
        unit_cost_usd: unitCostUsd,
        line_total_usd: lineTotalUsd,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
}

export default function PurchaseOrderForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { goToList, leaveToList } = useFormListReturn({ fallbackListPath: '/purchase-orders' });
  const { profile: user } = useAuth();
  const queryClient = useQueryClient();
  const isEditMode = !!id;

  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [existingPO, setExistingPO] = useState<PurchaseOrderWithDetails | null>(null);

  // Form fields
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState(todayYMD());
  const [expectedDate, setExpectedDate] = useState('');
  const [purchaseName, setPurchaseName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [status, setStatus] = useState<PurchaseOrderStatus>('draft');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<OrderItem[]>([]);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [orderDiscountPercent, setOrderDiscountPercent] = useState(0);
  const [orderDiscountAmount, setOrderDiscountAmount] = useState(0);
  const [orderDiscountMode, setOrderDiscountMode] = useState<'percent' | 'amount'>('percent');
  const [orderTaxPercent, setOrderTaxPercent] = useState(0);
  const [summaryExpense, setSummaryExpense] = useState(0);
  const [updateSalePriceOnReceive, setUpdateSalePriceOnReceive] = useState(true);

  // Expenses (landed cost): can be edited for any non-cancelled PO
  const [expenses, setExpenses] = useState<POExpenseRow[]>([]);
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState<number | null>(null);
  const [expenseAllocation, setExpenseAllocation] = useState<'by_value' | 'by_qty'>('by_value');
  const [expenseNotes, setExpenseNotes] = useState('');
  const [expenseSaving, setExpenseSaving] = useState(false);

  // Supplier payment (optional at save time)
  const [paymentAmount, setPaymentAmount] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PoPaymentMethod>('cash');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentScheme, setPaymentScheme] = useState<PoPaymentScheme>('full');
  const [paymentDueDate, setPaymentDueDate] = useState('');
  const [installmentSchedule, setInstallmentSchedule] = useState<PoScheduleRow[]>([
    { seq: 1, due_date: '', amount: 0 },
  ]);

  // Product scan / search
  const [scanInput, setScanInput] = useState('');
  const debouncedScanInput = useDebounce(scanInput.trim(), 200);
  const [scanIndex, setScanIndex] = useState<ProductScanIndex | null>(null);
  const [scanCatalog, setScanCatalog] = useState<ProductScanIndexEntry[]>([]);
  const [scanCandidates, setScanCandidates] = useState<ProductScanIndexEntry[]>([]);
  const [scanMatchTotal, setScanMatchTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [quickAddQty, setQuickAddQty] = useState(1);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showMoreMeta, setShowMoreMeta] = useState(false);
  /** sale_price / base_unit_cost ratio per line — preserved across bulk tannarx increases */
  const saleMarkupRef = useRef<Map<string, number>>(new Map());
  const [bulkTannarxConfirm, setBulkTannarxConfirm] = useState<number | null>(null);
  const BULK_TANNARX_CONFIRM_MIN_ITEMS = 5;
  const [itemsSearchTerm, setItemsSearchTerm] = useState('');
  const [supplierPurchasedProducts, setSupplierPurchasedProducts] = useState<ProductScanIndexEntry[]>([]);
  const [showCreateProductModal, setShowCreateProductModal] = useState(false);
  const [showExpensesPanel, setShowExpensesPanel] = useState(false);
  const [auditFilter, setAuditFilter] = useState<AuditFilterKey>('all');
  const [qtyViolations, setQtyViolations] = useState<
    Map<string, { receivedQty: number; orderedQty: number }>
  >(new Map());
  const baselineSnapshotRef = useRef<string | null>(null);
  const [formBaselineReady, setFormBaselineReady] = useState(false);

  const poFormSnapshot = useMemo(
    () =>
      JSON.stringify({
        supplierId,
        orderDate,
        expectedDate,
        purchaseName,
        invoiceNumber,
        notes,
        status,
        orderDiscountPercent,
        paymentAmount,
        items: items.map((i) => ({
          product_id: i.product_id,
          ordered_qty: i.ordered_qty,
          unit_cost: i.unit_cost,
          discount_amount: i.discount_amount,
        })),
      }),
    [
      supplierId,
      orderDate,
      expectedDate,
      purchaseName,
      invoiceNumber,
      notes,
      status,
      orderDiscountPercent,
      paymentAmount,
      items,
    ],
  );

  const isPoDirty =
    baselineSnapshotRef.current !== null && poFormSnapshot !== baselineSnapshotRef.current;

  useEffect(() => {
    baselineSnapshotRef.current = null;
    setFormBaselineReady(false);
  }, [id]);

  useEffect(() => {
    if (!formBaselineReady || loading) return;
    if (baselineSnapshotRef.current !== null) return;
    baselineSnapshotRef.current = poFormSnapshot;
  }, [formBaselineReady, loading, poFormSnapshot]);

  const handleProductCreated = (product: ProductWithCategory) => {
    registerScanProduct(product);
    addProduct(product, quickAddQty);
    clearScanField();
  };

  // Supplier modal
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [newSupplierEmail, setNewSupplierEmail] = useState('');
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  const selectedSupplier = suppliers.find((s) => s.id === supplierId) || null;
  const supplierSettlementCurrency = normalizeCurrency(
    (selectedSupplier as any)?.settlement_currency,
    'UZS'
  ) as LedgerCurrency;

  /** PO invoice currency follows supplier settlement (read-only). */
  const poCurrency = useMemo((): 'UZS' | 'USD' => {
    if (supplierId && selectedSupplier) {
      return supplierSettlementCurrency;
    }
    if (isEditMode && existingPO && existingPO.supplier_id === supplierId) {
      return normalizeCurrency((existingPO as any)?.currency, 'UZS');
    }
    return 'UZS';
  }, [supplierId, selectedSupplier, supplierSettlementCurrency, isEditMode, existingPO]);

  const formatPoMoney = useCallback(
    (value: number) => formatMoney(value, poCurrency),
    [poCurrency]
  );

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

  const roundUzsPrice = (value: number) => Math.round(value);
  const roundUsdPrice = (value: number) => Math.round(value * 100) / 100;

  const getCostUzsForItem = (item: OrderItem) => {
    const rate = getFxRateSafe();
    if (poCurrency === 'USD') {
      const baseUsd = Number(item.base_unit_cost_usd ?? item.unit_cost_usd ?? 0) || 0;
      if (baseUsd > 0 && rate) return baseUsd * rate;
      return Number(item.unit_cost ?? item.base_unit_cost ?? 0) || 0;
    }
    return Number(item.base_unit_cost ?? item.unit_cost ?? 0) || 0;
  };

  const rememberSaleMarkupRatios = (list: OrderItem[]) => {
    for (const item of list) {
      const base = getCostUzsForItem(item);
      const sale = Number(item.sale_price ?? 0) || 0;
      if (base > 0 && sale > 0) {
        saleMarkupRef.current.set(item.product_id, sale / base);
      }
    }
  };

  const computeItemTotals = (item: OrderItem): OrderItem => {
    const qty = Number(item.ordered_qty || 0) || 0;
    const rate = getFxRateSafe();
    let baseUzs: number;
    let resolvedBaseUsd = 0;
    if (poCurrency === 'USD') {
      let baseUsd = Number(item.base_unit_cost_usd ?? NaN);
      if (!Number.isFinite(baseUsd) || baseUsd < 0) baseUsd = 0;
      if (baseUsd === 0 && rate) {
        const legacyUzs = Number(item.base_unit_cost ?? item.unit_cost ?? 0);
        if (legacyUzs > 0) baseUsd = legacyUzs / rate;
      }
      resolvedBaseUsd = baseUsd;
      baseUzs = rate && baseUsd > 0 ? baseUsd * rate : Number(item.base_unit_cost ?? 0) || 0;
    } else {
      baseUzs = Number(item.base_unit_cost ?? item.unit_cost ?? 0);
    }

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
    if (poCurrency === 'USD') {
      const discountUsd = rate && rate > 0 ? discountAmountUzs / rate : 0;
      netUnitUsd = Math.max(0, resolvedBaseUsd - discountUsd);
      netLineUsd = netUnitUsd * qty;
    }

    return {
      ...item,
      base_unit_cost: baseUzs,
      base_unit_cost_usd: poCurrency === 'USD' ? resolvedBaseUsd : null,
      discount_percent: discountPercent,
      discount_amount: discountAmountUzs,
      unit_cost: netUnitUzs,
      line_total: netLineUzs,
      unit_cost_usd: poCurrency === 'USD' ? netUnitUsd : null,
      line_total_usd: poCurrency === 'USD' ? netLineUsd : null,
    };
  };

  const getOrderDiscountAmount = (subtotal: number) => {
    const percent = clampPercent(Number(orderDiscountPercent || 0));
    return (subtotal * percent) / 100;
  };

  const buildOrderTotals = (subtotal: number) => {
    const orderDiscount = getOrderDiscountAmount(subtotal);
    const afterDiscount = Math.max(0, subtotal - orderDiscount);
    const tax = (afterDiscount * clampPercent(orderTaxPercent)) / 100;
    const totalAmount = afterDiscount + Number(summaryExpense || 0) + tax;
    return { orderDiscount, tax, totalAmount };
  };

  const flashHighlight = (productId: string) => {
    setHighlightIds((prev) => new Set(prev).add(productId));
    window.setTimeout(() => {
      setHighlightIds((prev) => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
    }, 1200);
  };

  const registerScanProduct = (product: ProductWithCategory | ProductScanIndexEntry) => {
    const entry = {
      ...product,
      cost_price:
        Number((product as ProductScanIndexEntry).cost_price ?? product.purchase_price ?? 0) || 0,
    } as ProductScanIndexEntry;
    setScanCatalog((prev) => {
      if (prev.some((p) => p.id === entry.id)) return prev;
      return [entry, ...prev];
    });
    setScanIndex((prev) => {
      const base = prev ?? createPurchaseScanIndex([]);
      registerPurchaseScanProduct(entry, base);
      return { barcode: new Map(base.barcode), sku: new Map(base.sku) };
    });
  };

  const clearScanField = () => {
    setScanInput('');
    setScanCandidates([]);
    setScanMatchTotal(0);
    setShowCreateProductModal(false);
    scanInputRef.current?.focus();
  };

  // Auto-load USD/UZS rate when PO currency is USD
  useEffect(() => {
    const run = async () => {
      if (!supplierId) return;
      const entry: LedgerCurrency = poCurrency === 'USD' ? 'USD' : 'UZS';
      if (entry !== 'USD') return;
      if (getFxRateSafe()) return;
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
      } catch {
        // ignore; user can enter manually
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, supplierSettlementCurrency, poCurrency, orderDate]);

  // Recompute costs when poCurrency or fxRate changes
  useEffect(() => {
    setItems((prev) =>
      prev.map((it) => {
        if (poCurrency === 'USD') {
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
  }, [poCurrency, fxRate]);

  useEffect(() => {
    loadInitialData();
  }, [id]);

  useEffect(() => {
    let active = true;
    const loadScanCatalog = async () => {
      try {
        const PAGE = 5000;
        let offset = 0;
        const all: ProductScanIndexEntry[] = [];
        while (active) {
          const batch = await getProductsScanIndex({ limit: PAGE, offset, status: 'all' });
          if (!batch.length) break;
          all.push(...batch);
          if (batch.length < PAGE) break;
          offset += PAGE;
        }
        if (!active) return;
        setScanCatalog(all);
        setScanIndex(createPurchaseScanIndex(all));
        const cats = await getCategories();
        if (active) setCategories(Array.isArray(cats) ? cats : []);
      } catch {
        // catalog optional — resolveProductScan still works
      }
    };
    void loadScanCatalog();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      scanInputRef.current?.focus();
    }
  }, [loading]);

  useEffect(() => {
    let active = true;
    const loadSupplierPurchased = async () => {
      if (!supplierId) {
        if (active) setSupplierPurchasedProducts([]);
        return;
      }
      try {
        const rows = await getSupplierPurchaseSummary(supplierId);
        if (!active) return;
        const mapped: ProductScanIndexEntry[] = (Array.isArray(rows) ? rows : [])
          .map((row: any) => {
            const pid = String(row.product_id || '');
            if (!pid) return null;
            const fromCatalog = scanCatalog.find((p) => p.id === pid);
            const receivedQty = Number(row.total_received_qty ?? 0) || 0;
            const totalCost = Number(row.total_cost ?? 0) || 0;
            const avgCost = receivedQty > 0 ? totalCost / receivedQty : 0;
            return {
              id: pid,
              name: String(row.product_name || fromCatalog?.name || pid),
              sku: String(row.product_sku || fromCatalog?.sku || ''),
              barcode: fromCatalog?.barcode ?? null,
              article: fromCatalog?.article ?? null,
              brand: fromCatalog?.brand ?? null,
              category_id: fromCatalog?.category_id ?? null,
              cost_price: Number(fromCatalog?.cost_price ?? avgCost) || avgCost,
              purchase_price: Number(fromCatalog?.purchase_price ?? avgCost) || avgCost,
              unit: fromCatalog?.unit ?? 'pcs',
              is_active: fromCatalog?.is_active ?? true,
            } as ProductScanIndexEntry;
          })
          .filter((p): p is ProductScanIndexEntry => p != null);
        setSupplierPurchasedProducts(mapped);
      } catch {
        if (active) setSupplierPurchasedProducts([]);
      }
    };
    void loadSupplierPurchased();
    return () => {
      active = false;
    };
  }, [supplierId, scanCatalog]);

  useEffect(() => {
    const term = debouncedScanInput;
    if (!term || term.length < 2) {
      setScanCandidates([]);
      setScanMatchTotal(0);
      return;
    }
    if (scanIndex && lookupPurchaseScan(term, scanIndex)) {
      setScanCandidates([]);
      setScanMatchTotal(0);
      return;
    }
    const catalogHits = filterPurchaseCatalog(
      scanCatalog,
      term,
      Number.MAX_SAFE_INTEGER,
      scanIndex ?? undefined,
    );
    const supplierHits =
      supplierId && supplierPurchasedProducts.length
        ? filterPurchaseCatalog(supplierPurchasedProducts, term, Number.MAX_SAFE_INTEGER)
        : [];
    const seen = new Set<string>();
    const merged: ProductScanIndexEntry[] = [];
    for (const hit of [...supplierHits, ...catalogHits]) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      merged.push(hit);
    }
    setScanMatchTotal(merged.length);
    setScanCandidates(merged.slice(0, PO_PRODUCT_SEARCH_LIMIT));
  }, [debouncedScanInput, scanCatalog, scanIndex, supplierId, supplierPurchasedProducts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        scanInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const suppliersData = await getSuppliers();

      setSuppliers(Array.isArray(suppliersData) ? suppliersData : []);

      if (id) {
        const poData = await getPurchaseOrderById(id);
        if (poData) {
          setExistingPO(poData);
          setSupplierId(poData.supplier_id || '');
          setOrderDate(poData.order_date);
          setExpectedDate(poData.expected_date || '');
          setPurchaseName(String((poData as any).reference || ''));
          setInvoiceNumber(String((poData as any).invoice_number || ''));
          setStatus((poData.status as PurchaseOrderStatus) || 'draft');
          setNotes(poData.notes || '');
          const orderDiscount = Number(poData.discount || 0);
          const orderSubtotal = Number(poData.subtotal || 0);
          setOrderDiscountAmount(orderDiscount);
          setOrderDiscountPercent(orderSubtotal > 0 ? (orderDiscount / orderSubtotal) * 100 : 0);
          setOrderTaxPercent(Number((poData as any).tax ?? 0) > 0 && orderSubtotal > 0
            ? (Number((poData as any).tax) / Math.max(1, orderSubtotal - orderDiscount)) * 100
            : 0);
          setOrderDiscountMode('percent');
          const loadedPoCurrency = normalizeCurrency((poData as any).currency, 'UZS');
          const poFxRate = typeof (poData as any).fx_rate === 'number' ? Number((poData as any).fx_rate) : null;
          setFxRate(poFxRate);
          setPaymentScheme(normalizePaymentScheme((poData as any).payment_scheme));
          setPaymentDueDate(String((poData as any).payment_due_date || '').slice(0, 10));
          const loadedSchedule = (poData as any).payment_schedule as PoScheduleRow[] | undefined;
          if (Array.isArray(loadedSchedule) && loadedSchedule.length > 0) {
            setInstallmentSchedule(
              loadedSchedule.map((row, idx) => ({
                seq: Number(row.seq ?? idx + 1),
                due_date: String(row.due_date || '').slice(0, 10),
                amount: Number(row.amount ?? 0),
                amount_usd: row.amount_usd != null ? Number(row.amount_usd) : null,
              }))
            );
          }

          if (poData.items) {
            const rate = Number.isFinite(Number(poFxRate || 0)) && Number(poFxRate) > 0 ? Number(poFxRate) : null;
            const loadedItems = poData.items.map((item) => {
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
                  loadedPoCurrency === 'USD'
                    ? (Number.isFinite(unitUsd) && unitUsd > 0 ? unitUsd : rate && unitUzs > 0 ? unitUzs / rate : 0) +
                      (rate ? discountAmount / rate : 0)
                    : null;
                return computeItemTotals({
                  id: item.id,
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
              });
            rememberSaleMarkupRatios(loadedItems);
            setItems(loadedItems);
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
      setFormBaselineReady(true);
    }
  };

  const appendProductToItems = (
    currentItems: OrderItem[],
    product: ProductWithCategory | ProductScanIndexEntry,
    qtyToAdd = 1,
  ): OrderItem[] => {
    const safeQty = Number.isFinite(qtyToAdd) && qtyToAdd > 0 ? qtyToAdd : 1;
    const { saleUnit, sale_price: unitSalePrice } = getSaleUnitConfig(product as ProductWithCategory);
    const existingIndex = currentItems.findIndex(
      (item) => item.product_id === product.id && (item.sale_unit || saleUnit) === saleUnit,
    );
    if (existingIndex >= 0) {
      const updated = [...currentItems];
      const existing = { ...updated[existingIndex] };
      existing.ordered_qty = Number(existing.ordered_qty || 0) + safeQty;
      updated[existingIndex] = computeItemTotals(existing);
      return updated;
    }

    const rate = getFxRateSafe();
    const purchaseUzs =
      Number((product as ProductScanIndexEntry).cost_price ?? product.purchase_price ?? 0) || 0;
    let baseUsd: number | null = null;
    let baseUzs = purchaseUzs;
    if (poCurrency === 'USD') {
      if (rate && purchaseUzs > 0) {
        baseUsd = purchaseUzs / rate;
        baseUzs = baseUsd * rate;
      } else {
        baseUsd = 0;
        baseUzs = 0;
      }
    }

    const newItem: OrderItem = computeItemTotals({
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku,
      product_barcode: String((product as { barcode?: string | null }).barcode || '').trim() || null,
      ordered_qty: safeQty,
      base_unit_cost: baseUzs,
      base_unit_cost_usd: poCurrency === 'USD' ? baseUsd : null,
      unit_cost: baseUzs,
      line_total: baseUzs * safeQty,
      unit_cost_usd: poCurrency === 'USD' ? baseUsd : null,
      line_total_usd: poCurrency === 'USD' ? (baseUsd ?? 0) * safeQty : null,
      discount_percent: 0,
      discount_amount: 0,
      discount_mode: 'amount',
      sale_unit: saleUnit,
      sale_price: Number(unitSalePrice) > 0 ? Number(unitSalePrice) : null,
    });

    if (getCostUzsForItem(newItem) > 0 && Number(newItem.sale_price ?? 0) > 0) {
      saleMarkupRef.current.set(
        newItem.product_id,
        Number(newItem.sale_price) / getCostUzsForItem(newItem)
      );
    }

    return [newItem, ...currentItems];
  };

  const addProduct = (product: ProductWithCategory | ProductScanIndexEntry, qtyToAdd = 1) => {
    setItems((prev) => appendProductToItems(prev, product, qtyToAdd));
    flashHighlight(product.id);
  };

  const resolveAndAddProduct = useCallback(
    async (raw: string, qty = quickAddQty) => {
      const term = String(raw || '').trim();
      if (!term) return;

      let product: ProductWithCategory | ProductScanIndexEntry | null = null;
      if (scanIndex) {
        product = lookupPurchaseScan(term, scanIndex);
      }
      if (!product) {
        const resolved = await resolveProductScan(getScanLookupKeys(term)).catch(() => null);
        if (resolved?.product) {
          product = resolved.product;
          registerScanProduct(resolved.product);
        }
      }
      if (!product) {
        const { items: candidates, total } = filterPurchaseCatalogWithTotal(
          scanCatalog,
          term,
          PO_PRODUCT_SEARCH_LIMIT,
        );
        if (candidates.length === 1 && total === 1) {
          product = candidates[0];
        } else if (total > 1) {
          setScanCandidates(candidates);
          setScanMatchTotal(total);
          return;
        }
      }
      if (product) {
        addProduct(product, qty);
        clearScanField();
        return;
      }
      setShowCreateProductModal(true);
      setScanCandidates([]);
      setScanMatchTotal(0);
    },
    [quickAddQty, scanIndex, scanCatalog, items, poCurrency, fxRate],
  );

  const handleScanSubmit = () => {
    void resolveAndAddProduct(scanInput, quickAddQty);
  };

  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleScanSubmit();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setQuickAddQty((q) => q + 1);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setQuickAddQty((q) => Math.max(1, q - 1));
    }
    if (e.key === 'Escape') {
      clearScanField();
    }
  };

  const handlePickCandidate = (product: ProductScanIndexEntry) => {
    addProduct(product, quickAddQty);
    clearScanField();
  };

  const handleBulkAddMany = (rows: { product: ProductScanIndexEntry; qty: number }[]) => {
    if (!rows.length) return;
    setItems((prev) => {
      let next = prev;
      for (const row of rows) {
        next = appendProductToItems(next, row.product, row.qty);
      }
      return next;
    });
    for (const row of rows) {
      flashHighlight(row.product.id);
    }
    clearScanField();
  };

  const updateItem = (
    index: number,
    field: 'ordered_qty' | 'base_unit_cost' | 'base_unit_cost_usd' | 'discount_percent' | 'discount_amount' | 'sale_price' | 'sale_unit',
    value: number | string
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

    if (field === 'base_unit_cost_usd' && poCurrency === 'USD') {
      const rate = getFxRateSafe();
      if (rate) {
        item.base_unit_cost = Number(value || 0) * rate;
      }
    }
    if (field === 'base_unit_cost' && poCurrency === 'USD') {
      const rate = getFxRateSafe();
      const usd = rate && Number(value || 0) > 0 ? Number(value || 0) / rate : 0;
      item.base_unit_cost_usd = usd;
    }

    updatedItems[index] = computeItemTotals(item);
    if (field === 'ordered_qty') {
      setQtyViolations(new Map());
    }
    if (field === 'sale_price' || field === 'base_unit_cost' || field === 'base_unit_cost_usd') {
      const base = getCostUzsForItem(updatedItems[index]);
      const sale = Number(updatedItems[index].sale_price ?? 0) || 0;
      if (base > 0 && sale > 0) {
        saleMarkupRef.current.set(updatedItems[index].product_id, sale / base);
      }
    }
    setItems(updatedItems);
  };

  const bumpItemQty = (index: number, delta: number) => {
    const item = items[index];
    if (!item) return;
    updateItem(index, 'ordered_qty', Math.max(0.01, Number(item.ordered_qty || 0) + delta));
  };

  const getExistingReceivedQtyForItem = (item: OrderItem | undefined): number => {
    if (!item) return 0;
    const existingItems = existingPO?.items || [];
    if (item.id) {
      const byId = existingItems.find((it: { id?: string }) => it.id === item.id);
      if (byId) return Number((byId as { received_qty?: number }).received_qty || 0);
    }
    return (existingItems as { product_id?: string; received_qty?: number }[])
      .filter((it) => it.product_id === item.product_id)
      .reduce((sum, it) => sum + Number(it.received_qty || 0), 0);
  };

  const removeItem = (index: number) => {
    const item = items[index];
    if (!item) return;
    const receivedQty = getExistingReceivedQtyForItem(item);
    if (receivedQty > 0) {
      toast({
        title: 'O‘chirib bo‘lmaydi',
        description:
          'Qabul qilingan mahsulotni buyurtmadan o‘chirib bo‘lmaydi — omborga kirgan. Qaytarish uchun alohida qaytarish amalidan foydalaning.',
        variant: 'destructive',
      });
      return;
    }
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
    const nextAmount = (subtotal * clampPercent(orderDiscountPercent)) / 100;
    if (Math.abs(nextAmount - orderDiscountAmount) > 0.01) {
      setOrderDiscountAmount(nextAmount);
    }
  }, [items, orderDiscountPercent]);

  const isReadOnly = existingPO && existingPO.status === 'cancelled';

  useBarcodeScanner({
    enabled: !isReadOnly,
    whenInputFocused: 'auto',
    onScan: (code) => {
      void resolveAndAddProduct(code, quickAddQty);
    },
  });

  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount || 0) || 0), 0);
  const hasLandedCosts = totalExpenses > 0;

  const allocationsByProductId = useMemo(() => {
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
  }, [items, expenses]);

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

    if (expectedDate && orderDate && expectedDate < orderDate) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Kutilayotgan sana buyurtma sanasidan oldin bo‘lishi mumkin emas',
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

    if (supplierSettlementCurrency === 'USD' && poCurrency !== 'USD') {
      toast({
        title: 'Validatsiya xatosi',
        description: 'USD hisobli yetkazib beruvchi uchun buyurtma USD valyutasida bo‘lishi kerak',
        variant: 'destructive',
      });
      return false;
    }

    if (poCurrency === 'USD') {
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

      if (poCurrency === 'USD') {
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
        poCurrency === 'USD' ? Number(item.base_unit_cost_usd || 0) * Number(rate || 0) : Number(item.base_unit_cost || 0);
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

    if (paymentScheme === 'partial') {
      const sub = calculateSubtotal();
      const totals = buildOrderTotals(sub);
      let orderTotal = totals.totalAmount;
      if (poCurrency === 'USD') {
        const orderDiscountUsd = toUsd(totals.orderDiscount);
        orderTotal = Math.max(
          0,
          calculateSubtotalUSD() -
            Number(orderDiscountUsd || 0) +
            toUsd(summaryExpense) +
            toUsd(totals.tax)
        );
      }
      const paid = Math.max(0, Number(paymentAmount || 0));
      const tol = poCurrency === 'USD' ? 0.02 : 1;
      if (orderTotal - paid > tol && !normalizeDueDate(paymentDueDate)) {
        toast({
          title: 'Validatsiya xatosi',
          description: 'Qisman to\'lov uchun qarz muddatini kiriting',
          variant: 'destructive',
        });
        return false;
      }
    }

    if (paymentScheme === 'installment') {
      const sub = calculateSubtotal();
      const { totalAmount: grandForValidate } = buildOrderTotals(sub);
      const totalValidate =
        poCurrency === 'USD'
          ? Math.max(
              0,
              calculateSubtotalUSD() -
                Number(poCurrency === 'USD' ? toUsd(buildOrderTotals(sub).orderDiscount) : 0) +
                toUsd(summaryExpense) +
                toUsd(buildOrderTotals(sub).tax)
            )
          : grandForValidate;
      const scheduleCheck = validateInstallmentScheduleSum(
        installmentSchedule,
        totalValidate,
        poCurrency
      );
      if (!scheduleCheck.ok) {
        toast({
          title: 'Validatsiya xatosi',
          description: scheduleCheck.error || 'Bo\'lib to\'lash jadvali noto\'g\'ri',
          variant: 'destructive',
        });
        return false;
      }
    }

    return true;
  };

  /** Validate ordered >= received per product — only before confirm/receive. */
  const validateForReceive = (): boolean => {
    if (!existingPO?.items?.some((it: any) => Number(it.received_qty || 0) > 0)) {
      setQtyViolations(new Map());
      return true;
    }

    const violations = findPoOrderQtyViolations(items, existingPO.items);
    if (violations.length === 0) {
      setQtyViolations(new Map());
      return true;
    }

    setQtyViolations(violationsToMap(violations));
    const names = violations.map((v) => {
      const row = items.find((i) => i.product_id === v.productId);
      return row?.product_name || v.productId;
    });
    toast({
      title: 'Validatsiya xatosi',
      description: `${names.join(', ')}: buyurtma miqdori qabul qilingandan kam (qatorlarni tekshiring)`,
      variant: 'destructive',
    });
    return false;
  };

  /** Receive/confirm requires positive line tannarx; draft save allows 0/empty. */
  const validateReceiveLineCosts = (): boolean => {
    const zeroNames = findZeroCostPoLineNames(items, poCurrency);
    if (zeroNames.length === 0) return true;
    const shown = zeroNames.slice(0, 5).join(', ');
    const more = zeroNames.length > 5 ? ` (+${zeroNames.length - 5})` : '';
    toast({
      title: 'Validatsiya xatosi',
      description: `Qabul qilish uchun tannarx kerak: ${shown}${more}. Qoralama saqlashda tannarx bo‘sh qolishi mumkin.`,
      variant: 'destructive',
    });
    return false;
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

  const buildPaymentSchemeForSave = () => {
    const fx = getFxRateSafe();
    const schedule =
      paymentScheme === 'installment'
        ? installmentSchedule.map((row, idx) => {
            const seq = row.seq ?? idx + 1;
            if (poCurrency === 'USD') {
              const usd = Number(row.amount_usd ?? row.amount ?? 0);
              return {
                seq,
                due_date: normalizeDueDate(row.due_date),
                amount_usd: usd,
                amount: fx ? usd * fx : 0,
              };
            }
            return {
              seq,
              due_date: normalizeDueDate(row.due_date),
              amount: Number(row.amount ?? 0),
              amount_usd: null,
            };
          })
        : undefined;
    return {
      payment_scheme: paymentScheme,
      payment_due_date: paymentScheme === 'partial' ? normalizeDueDate(paymentDueDate) : null,
      payment_schedule: schedule,
    };
  };

  const buildInitialPaymentForSave = (): Record<string, unknown> | null => {
    const paid = Number(paymentAmount || 0);
    if (!supplierId || paid <= 0) return null;

    const entryCurrency: LedgerCurrency = poCurrency === 'USD' ? 'USD' : 'UZS';
    const ledger = buildSupplierPaymentPayload({
      paid,
      entryCurrency,
      settlementCurrency: supplierSettlementCurrency,
      fxRate: getFxRateSafe(),
    });

    return {
      amount: ledger.amount,
      amount_usd: ledger.amount_usd,
      currency: ledger.currency,
      payment_method: paymentMethod,
      paid_at: orderDate ? `${orderDate}T12:00:00` : undefined,
      note: paymentNote.trim() || "Xarid buyurtmasi to'lovi",
      created_by: user?.id || null,
    };
  };

  const paymentSuccessToast = (paid: number, entryCurrency: LedgerCurrency, newBalance?: number) => {
    const paidLabel =
      entryCurrency === 'USD' ? `${paid.toFixed(2)} USD` : formatMoneyUZS(paid);
    const balanceLabel =
      supplierSettlementCurrency === 'USD'
        ? `${Number(newBalance ?? 0).toFixed(2)} USD`
        : formatMoneyUZS(Number(newBalance ?? 0));
    toast({
      title: "To'lov qayd etildi",
      description: `${paidLabel} · Yangi balans: ${balanceLabel}`,
    });
  };

  const recordPurchaseOrderPayment = async (poId: string): Promise<void> => {
    const paid = Number(paymentAmount || 0);
    if (!supplierId || paid <= 0) return;

    const entryCurrency: LedgerCurrency = poCurrency === 'USD' ? 'USD' : 'UZS';
    const initialPayment = buildInitialPaymentForSave();
    if (!initialPayment) return;

    const result = await createSupplierPayment({
      supplier_id: supplierId,
      purchase_order_id: poId,
      amount: Number(initialPayment.amount ?? 0),
      amount_usd: (initialPayment.amount_usd as number | null) ?? null,
      currency: initialPayment.currency as 'UZS' | 'USD',
      payment_method: paymentMethod,
      paid_at: orderDate ? `${orderDate}T12:00:00` : undefined,
      note: paymentNote.trim() || "Xarid buyurtmasi to'lovi",
      created_by: user?.id || null,
    });

    if (!result.success) {
      throw new Error(result.error || "To'lovni saqlab bo'lmadi");
    }

    paymentSuccessToast(paid, entryCurrency, Number(result.new_balance ?? 0));
  };

  const finalizeSaveWithOptionalPayment = async (
    poId: string,
    opts?: { paymentIncludedInSave?: boolean }
  ) => {
    const paid = Number(paymentAmount || 0);
    if (opts?.paymentIncludedInSave) {
      if (paid > 0) {
        const entryCurrency: LedgerCurrency = poCurrency === 'USD' ? 'USD' : 'UZS';
        paymentSuccessToast(paid, entryCurrency);
      }
      invalidateDashboardQueries(queryClient);
      goToList();
      return;
    }
    if (paid <= 0) {
      goToList();
      return;
    }
    const entryCur: LedgerCurrency = poCurrency === 'USD' ? 'USD' : 'UZS';
    const missingFx =
      paid > 0 && entryCur !== supplierSettlementCurrency && !getFxRateSafe();
    if (missingFx) {
      toast({
        title: 'Kurs kerak',
        description: "To'lovni saqlash uchun USD/UZS kursini kiriting.",
        variant: 'destructive',
      });
      try {
        const refreshedPo = await getPurchaseOrderById(poId);
        setExistingPO(refreshedPo);
        if (!isEditMode) navigate(`/purchase-orders/${poId}/edit`, { replace: true });
      } catch {
        // ignore
      }
      return;
    }
    try {
      await recordPurchaseOrderPayment(poId);
      invalidateDashboardQueries(queryClient);
      goToList();
    } catch (paymentError: unknown) {
      const msg =
        paymentError instanceof Error ? paymentError.message : "To'lovni saqlab bo'lmadi";
      toast({
        title: "Buyurtma saqlandi, to'lov qilinmadi",
        description: `${msg}. Qayta urinish uchun shu sahifada to'lovni qayta kiriting va saqlang.`,
        variant: 'destructive',
      });
      try {
        const refreshedSuppliers = await getSuppliers();
        setSuppliers(refreshedSuppliers);
        const refreshedPo = await getPurchaseOrderById(poId);
        setExistingPO(refreshedPo);
        if (!isEditMode) {
          navigate(`/purchase-orders/${poId}/edit`, { replace: true });
        }
      } catch {
        // ignore refresh errors
      }
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
    if (!validateForReceive()) return;
    if (!validateReceiveLineCosts()) return;

    const totalReceived = (existingPO.items || []).reduce(
      (s, it: any) => s + Number(it.received_qty || 0),
      0
    );

    try {
      setLoading(true);

      if (totalReceived === 0) {
        const subtotal = calculateSubtotal();
        const { orderDiscount, tax, totalAmount } = buildOrderTotals(subtotal);
        const orderDiscountUsd = poCurrency === 'USD' ? toUsd(orderDiscount) : null;
        const totalUsd =
          poCurrency === 'USD' ? Math.max(0, calculateSubtotalUSD() - Number(orderDiscountUsd || 0)) : null;

        const existingItems = existingPO?.items || [];
        // `received` is already handled by the early return above, so it cannot
        // occur here; only draft / partially_received / fallthrough remain.
        const persistStatus =
          existingPO.status === 'draft'
            ? 'draft'
            : existingPO.status === 'partially_received'
              ? 'partially_received'
              : (status as PurchaseOrderStatus);

        const purchaseOrderData: Partial<PurchaseOrder> = {
          supplier_id: supplierId,
          supplier_name: null,
          order_date: orderDate,
          expected_date: expectedDate || null,
          reference: purchaseName.trim() || null,
          subtotal,
          discount: orderDiscount,
          tax,
          total_amount: totalAmount,
          currency: poCurrency,
          fx_rate: poCurrency === 'USD' ? fxRate : null,
          total_usd: totalUsd,
          status: persistStatus,
          invoice_number: invoiceNumber.trim() || null,
          notes,
          ...buildPaymentSchemeForSave(),
        };

        const itemsData = buildItemsPayloadForSave();

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
        await receiveGoods(id, receiveItems, undefined, {
          update_product_sale_prices: updateSalePriceOnReceive,
        });
        productUpdateEmitter.emit();
      }

      const finalPo = await getPurchaseOrderById(id);
      setExistingPO(finalPo);
      setStatus((finalPo.status as PurchaseOrderStatus) || 'draft');

      invalidateDashboardQueries(queryClient);
      setQtyViolations(new Map());
      toast({
        title: 'Muvaffaqiyatli',
        description:
          receiveItems.length > 0
            ? 'Buyurtma tasdiqlandi va omborga qabul qilindi'
            : 'Buyurtma tasdiqlandi (qabul qilinadigan qoldiq yo‘q)',
      });

      const receivedNow =
        receiveItems.length > 0 ||
        finalPo.status === 'received' ||
        finalPo.status === 'partially_received';
      await finalizeSaveWithOptionalPayment(id);
      return;
    } catch (error: unknown) {
      console.error('Confirm purchase order error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Tasdiqlash yoki qabul qilishda xatolik yuz berdi';
      toast({ title: 'Xatolik', description: errorMessage, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const buildItemsPayloadForSave = () => {
    const existingItems = existingPO?.items || [];
    // Payload is exactly the form lines. Omitted unreceived lines are deleted on save.
    // Omitted received lines are rejected by the backend (stock already posted).
    return items.map((item) => {
      const existingMatch = existingItems.find((it: { id?: string; product_id: string }) =>
        item.id ? it.id === item.id : it.product_id === item.product_id,
      );
      const resolvedId = item.id || existingMatch?.id;
      return {
        ...(resolvedId ? { id: resolvedId } : {}),
        received_qty: Number(existingMatch?.received_qty ?? 0),
        product_id: item.product_id,
        product_name: item.product_name,
        product_sku: item.product_sku || '',
        ordered_qty: item.ordered_qty,
        unit_cost: item.unit_cost,
        line_total: item.line_total,
        unit_cost_usd: poCurrency === 'USD' ? (item.unit_cost_usd ?? 0) : null,
        line_total_usd:
          poCurrency === 'USD'
            ? (item.line_total_usd ?? Number(item.ordered_qty) * Number(item.unit_cost_usd || 0))
            : null,
        discount_amount: Number(item.discount_amount || 0) || 0,
        discount_percent: Number(item.discount_percent || 0) || 0,
        // Line sotuv narxi always persisted when set; catalog sync is gated on receive.
        sale_price: salePriceForPoLineSave(item.sale_price),
      };
    });
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
    // Draft save never blocks on ordered < received — only confirm/receive does.
    // Receive requires positive tannarx (catalog sale/purchase prices stay optional).
    if (markAsReceived && !validateReceiveLineCosts()) return;

    try {
      setLoading(true);

      // Calculate subtotal safely
      const subtotal = calculateSubtotal();
      const { orderDiscount, tax, totalAmount } = buildOrderTotals(subtotal);
      const orderDiscountUsd = poCurrency === 'USD' ? toUsd(orderDiscount) : null;
      const totalUsd =
        poCurrency === 'USD' ? Math.max(0, calculateSubtotalUSD() - Number(orderDiscountUsd || 0)) : null;

      let initialPayment: Record<string, unknown> | null = null;
      let paymentIncludedInSave = false;
      const paidOnSave = Number(paymentAmount || 0);
      if (paidOnSave > 0) {
        const entryCur: LedgerCurrency = poCurrency === 'USD' ? 'USD' : 'UZS';
        const missingFx = entryCur !== supplierSettlementCurrency && !getFxRateSafe();
        if (missingFx) {
          toast({
            title: 'Kurs kerak',
            description: "To'lovni saqlash uchun USD/UZS kursini kiriting.",
            variant: 'destructive',
          });
          return;
        }
        try {
          initialPayment = buildInitialPaymentForSave();
          paymentIncludedInSave = isElectron() && !!initialPayment;
        } catch (paymentBuildError: unknown) {
          toast({
            title: 'Xatolik',
            description:
              paymentBuildError instanceof Error
                ? paymentBuildError.message
                : "To'lov ma'lumotlari noto'g'ri",
            variant: 'destructive',
          });
          return;
        }
      }

      let poId: string;
      let savedPO: PurchaseOrderWithDetails | null = null;

      if (isEditMode && id) {
        // Update existing PO
        const existingItems = existingPO?.items || [];
        // IMPORTANT:
        // Even when user clicks "Saqlash va qabul qilingan deb belgilash",
        // do NOT force PO status to 'received' before actual receipt creation.
        // Receipt flow below is the source of truth for received/partially_received transitions.
        const nextStatus: PurchaseOrderStatus =
          existingPO?.status === 'partially_received'
            ? 'partially_received'
            : existingPO?.status === 'received'
              ? 'received'
              : markAsReceived
                ? 'approved'
                : (status as PurchaseOrderStatus);
        const purchaseOrderData: Partial<PurchaseOrder> = {
          supplier_id: supplierId,
          supplier_name: null,
          order_date: orderDate,
          expected_date: expectedDate || null,
          reference: purchaseName.trim() || null,
          subtotal,
          discount: orderDiscount,
          tax,
          total_amount: totalAmount,
          currency: poCurrency,
          fx_rate: poCurrency === 'USD' ? fxRate : null,
          total_usd: totalUsd,
          status: nextStatus,
          invoice_number: invoiceNumber.trim() || null,
          received_by: markAsReceived ? (user?.id || null) : undefined,
          notes,
          ...buildPaymentSchemeForSave(),
          ...(paymentIncludedInSave && initialPayment
            ? { initial_payment: initialPayment as any }
            : {}),
        };

        const itemsData = buildItemsPayloadForSave();

        savedPO = await updatePurchaseOrder(id, purchaseOrderData, itemsData);
        poId = id;
        setExistingPO(savedPO);
        setQtyViolations(new Map());
        
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
          reference: purchaseName.trim() || null,
          subtotal,
          discount: orderDiscount,
          tax,
          total_amount: totalAmount,
          currency: poCurrency,
          fx_rate: poCurrency === 'USD' ? fxRate : null,
          total_usd: totalUsd,
          // For NEW PO: if markAsReceived, create as 'approved' so receipt can process it
          // If NOT markAsReceived, use the selected status (usually 'draft')
          status: (markAsReceived ? 'approved' : status) as PurchaseOrderStatus,
          invoice_number: invoiceNumber.trim() || null,
          received_by: null, // Will be set by receipt if markAsReceived
          approved_by: null,
          approved_at: null,
          notes,
          created_by: user?.id || null,
          ...buildPaymentSchemeForSave(),
          ...(paymentIncludedInSave && initialPayment
            ? { initial_payment: initialPayment as any }
            : {}),
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
          unit_cost_usd: poCurrency === 'USD' ? (item.unit_cost_usd ?? 0) : null,
          line_total_usd:
            poCurrency === 'USD'
              ? (item.line_total_usd ?? Number(item.ordered_qty) * Number(item.unit_cost_usd || 0))
              : null,
          discount_amount: Number(item.discount_amount || 0) || 0,
          discount_percent: Number(item.discount_percent || 0) || 0,
          sale_price: salePriceForPoLineSave(item.sale_price),
        }));

        const newPO = await createPurchaseOrder(
          purchaseOrderData as Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'>,
          itemsData
        );
        savedPO = newPO;
        poId = newPO.id;
        
        // Invalidate dashboard queries
        invalidateDashboardQueries(queryClient);
        
        toast({
          title: 'Muvaffaqiyatli',
          description: 'Xarid buyurtmasi muvaffaqiyatli yaratildi',
        });
      }

      // Persist any local draft expenses (for new PO or unsaved local entries)
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
        let poLines: PoLineForReceipt[] = (savedPO?.items as PoLineForReceipt[] | undefined) || [];
        if (!poLines.length) {
          const refreshed = await getPurchaseOrderById(poId);
          poLines = (refreshed?.items as PoLineForReceipt[] | undefined) || [];
        }

        const receiptItems = buildReceiptItemsForReceive(poLines, items, {
          poCurrency,
          fxRate: getFxRateSafe(),
          allocationsByProductId,
        });

        if (receiptItems.length === 0) {
          const allReceived =
            poLines.length > 0 &&
            poLines.every(
              (it) => Number(it.received_qty ?? 0) >= Number(it.ordered_qty ?? 0),
            );
          if (allReceived) {
            toast({
              title: 'Muvaffaqiyatli',
              description: 'Buyurtma allaqachon to\'liq qabul qilingan',
            });
          } else {
            throw new Error(
              'Qabul qilish uchun buyurtma qatorlari topilmadi. Mahsulot bog\'lanishini tekshiring.',
            );
          }
        } else {
          const receiptCurrency = poCurrency;
          const receiptFxRate = receiptCurrency === 'USD' ? getFxRateSafe() : null;

          await createPurchaseReceipt({
            purchase_order_id: poId,
            supplier_id: supplierId || null,
            currency: receiptCurrency,
            exchange_rate: receiptFxRate,
            status: 'received',
            received_at: orderDate,
            invoice_number: invoiceNumber.trim() || null,
            created_by: user?.id || null,
            update_product_sale_prices: updateSalePriceOnReceive,
            items: receiptItems,
          });

          // Invalidate dashboard queries
          invalidateDashboardQueries(queryClient);

          // Emit product update event to refresh inventory pages
          productUpdateEmitter.emit();

          toast({
            title: 'Muvaffaqiyatli',
            description: 'Ombor muvaffaqiyatli yangilandi',
          });
        }
      }

      await finalizeSaveWithOptionalPayment(poId, { paymentIncludedInSave });
      return;
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

  const isZeroCostItem = (item: OrderItem) => {
    const baseUnitCost = Number(item.unit_cost || 0) || 0;
    const landedUnitCost = getEffectiveUnitCost(item);
    return baseUnitCost <= 0 || landedUnitCost <= 0;
  };

  const isNegativeMarginItem = (item: OrderItem) => {
    const marginPercent = getMarginPercent(item);
    return marginPercent != null && marginPercent < 0;
  };

  const isDiscountAnomalyItem = (item: OrderItem) => {
    const qty = Number(item.ordered_qty || 0) || 0;
    const baseUnitCost = Number(item.unit_cost || 0) || 0;
    const baseLine = Number(item.line_total || 0) || qty * baseUnitCost;
    const discountAmount = Number(item.discount_amount || 0) || 0;
    const discountPercent = Number(item.discount_percent || 0) || 0;
    return discountPercent > 40 || (baseLine > 0 && discountAmount > baseLine * 0.4);
  };

  const isHeavyExpenseItem = (item: OrderItem) => {
    const qty = Number(item.ordered_qty || 0) || 0;
    const baseUnitCost = Number(item.unit_cost || 0) || 0;
    const baseLine = Number(item.line_total || 0) || qty * baseUnitCost;
    const landedUnitCost = getEffectiveUnitCost(item);
    const landedLine = qty > 0 ? landedUnitCost * qty : 0;
    return baseLine > 0 && landedLine > baseLine * 1.35;
  };

  const matchesAuditFilter = (item: OrderItem, filter: AuditFilterKey) => {
    if (filter === 'all') return true;
    if (filter === 'zeroCost') return isZeroCostItem(item);
    if (filter === 'negativeMargin') return isNegativeMarginItem(item);
    if (filter === 'discountAnomaly') return isDiscountAnomalyItem(item);
    return isHeavyExpenseItem(item);
  };

  const getEffectiveUnitCost = (item: OrderItem) => {
    const landedUnitCost = allocationsByProductId.get(item.product_id)?.landedUnitCost;
    return Number(landedUnitCost ?? item.unit_cost ?? 0) || 0;
  };

  const getMarginPercent = (item: OrderItem) => {
    const salePrice = Number(item.sale_price ?? 0) || 0;
    const cost = getCostUzsForItem(item);
    if (salePrice <= 0 || cost <= 0) return null;
    return ((salePrice - cost) / salePrice) * 100;
  };

  const getSaleMarkupRatio = (item: OrderItem) => {
    const stored = saleMarkupRef.current.get(item.product_id);
    if (stored != null && Number.isFinite(stored) && stored > 0) return stored;
    const base = getCostUzsForItem(item);
    const sale = Number(item.sale_price ?? 0) || 0;
    if (base <= 0 || sale <= 0) return null;
    const ratio = sale / base;
    saleMarkupRef.current.set(item.product_id, ratio);
    return ratio;
  };

  const requestBulkTannarxIncrease = (percent: number) => {
    if (items.length === 0) return;
    if (items.length >= BULK_TANNARX_CONFIRM_MIN_ITEMS) {
      setBulkTannarxConfirm(percent);
      return;
    }
    applyBulkTannarxIncrease(percent);
  };

  const applyBulkTannarxIncrease = (percent: number) => {
    const factor = 1 + percent / 100;
    setItems((prev) => {
      rememberSaleMarkupRatios(prev);
      return prev.map((item) => {
        const next = { ...item };
        if (poCurrency === 'USD') {
          const usd = Number(item.base_unit_cost_usd ?? 0) || 0;
          if (usd > 0) {
            next.base_unit_cost_usd = roundUsdPrice(usd * factor);
          }
        } else {
          const base = Number(item.base_unit_cost ?? 0) || 0;
          if (base > 0) {
            next.base_unit_cost = roundUzsPrice(base * factor);
          }
        }
        return computeItemTotals(next);
      });
    });
    toast({
      title: `Tannarx +${percent}% qo'llandi`,
      description: `${items.length} ta qator yangilandi`,
    });
  };

  const recalculateSalePricesByMargin = () => {
    let updatedCount = 0;
    setItems((prev) =>
      prev.map((item) => {
        const ratio = getSaleMarkupRatio(item);
        if (ratio == null) return item;
        const cost = getEffectiveUnitCost(item);
        if (cost <= 0) return item;
        const newSale = roundUzsPrice(cost * ratio);
        if (newSale <= 0) return { ...item, sale_price: null };
        const oldSale = Number(item.sale_price ?? 0) || 0;
        if (oldSale !== newSale) updatedCount += 1;
        return { ...item, sale_price: newSale };
      })
    );
    toast({
      title: 'Sotuv narxlari qayta hisoblandi',
      description:
        updatedCount > 0
          ? `${updatedCount} ta qator yangilandi (tannarx/sotuv nisbati saqlab)`
          : 'O\'zgarish talab qilinmadi',
    });
  };

  const auditWarnings = useMemo(() => {
    const zeroCost: string[] = [];
    const negativeMargin: string[] = [];
    const discountAnomaly: string[] = [];
    const heavyExpenseItems: string[] = [];

    for (const item of items) {
      const name = String(item.product_name || 'Nomsiz mahsulot');
      if (isZeroCostItem(item)) zeroCost.push(name);
      if (isNegativeMarginItem(item)) negativeMargin.push(name);
      if (isDiscountAnomalyItem(item)) discountAnomaly.push(name);
      if (isHeavyExpenseItem(item)) heavyExpenseItems.push(name);
    }

    return { zeroCost, negativeMargin, discountAnomaly, heavyExpenseItems };
  }, [items, allocationsByProductId]);

  const filteredOrderItems = useMemo(() => {
    const term = itemsSearchTerm.trim().toLowerCase();
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const name = String(item.product_name || '').toLowerCase();
        const sku = String(item.product_sku || '').toLowerCase();
        const barcode = String(item.product_barcode || '').toLowerCase();
        const searchMatch =
          !term || name.includes(term) || sku.includes(term) || barcode.includes(term);
        if (!searchMatch) return false;
        return matchesAuditFilter(item, auditFilter);
      });
  }, [items, itemsSearchTerm, auditFilter, allocationsByProductId]);

  const supplierPurchasedIdSet = useMemo(
    () => new Set(supplierPurchasedProducts.map((p) => p.id)),
    [supplierPurchasedProducts],
  );

  const subtotal = calculateSubtotal();
  const subtotalUsd = calculateSubtotalUSD();
  const {
    orderDiscount: orderDiscountApplied,
    tax: orderTaxApplied,
    totalAmount,
  } = buildOrderTotals(subtotal);
  const totalQty = items.reduce((s, it) => s + Number(it.ordered_qty || 0), 0);
  const orderDiscountUsd = poCurrency === 'USD' ? toUsd(orderDiscountApplied) : null;
  const totalUsdForSave =
    poCurrency === 'USD' ? Math.max(0, subtotalUsd - Number(orderDiscountUsd || 0)) : null;
  const displayGrandTotal =
    poCurrency === 'USD'
      ? Math.max(
          0,
          subtotalUsd - Number(orderDiscountUsd || 0) + toUsd(summaryExpense) + toUsd(orderTaxApplied)
        )
      : totalAmount;
  const displaySubtotal = poCurrency === 'USD' ? subtotalUsd : subtotal;
  const displayOrderDiscount =
    poCurrency === 'USD' ? Number(orderDiscountUsd || 0) : orderDiscountApplied;
  const displayTax = poCurrency === 'USD' ? toUsd(orderTaxApplied) : orderTaxApplied;
  const displayExpense = poCurrency === 'USD' ? toUsd(summaryExpense) : summaryExpense;
  const warehouseTotalUzs = poCurrency === 'USD' ? totalAmount : null;

  const entryCurrency: LedgerCurrency = poCurrency === 'USD' ? 'USD' : 'UZS';
  const paymentFx = getFxRateSafe();
  const payableForPayment = poCurrency === 'USD' ? displayGrandTotal : totalAmount;
  const paymentEntered = Math.max(0, Number(paymentAmount || 0));
  const existingPaidOnPo =
    poCurrency === 'USD'
      ? Number((existingPO as any)?.paid_amount_usd ?? existingPO?.paid_amount ?? 0)
      : Number(existingPO?.paid_amount ?? 0);
  const payableSettlement = convertToSettlementCurrency(
    payableForPayment,
    entryCurrency,
    supplierSettlementCurrency,
    paymentFx
  );
  const existingPaidSettlement = convertToSettlementCurrency(
    existingPaidOnPo,
    entryCurrency,
    supplierSettlementCurrency,
    paymentFx
  );
  const paymentSettlement = convertToSettlementCurrency(
    paymentEntered,
    entryCurrency,
    supplierSettlementCurrency,
    paymentFx
  );
  const poRemainingBeforePay = Math.max(0, payableSettlement - existingPaidSettlement);
  const poRemainingAfterPay = payableSettlement - existingPaidSettlement - paymentSettlement;
  const needsFxForPayment =
    paymentEntered > 0 &&
    entryCurrency !== supplierSettlementCurrency &&
    !paymentFx;
  const formatSettlement = (value: number) => formatPoMoney(value);
  const supplierBalanceNow = Number(selectedSupplier?.balance ?? 0);
  const poAlreadyReceived =
    existingPO?.status === 'received' || existingPO?.status === 'partially_received';
  const projectedIfReceived =
    selectedSupplier && paymentEntered > 0 && !needsFxForPayment
      ? poAlreadyReceived
        ? supplierBalanceNow - paymentSettlement
        : supplierBalanceNow + payableSettlement - existingPaidSettlement - paymentSettlement
      : null;
  const projectedIfDraftOnly =
    selectedSupplier && paymentEntered > 0 && !poAlreadyReceived && !needsFxForPayment
      ? supplierBalanceNow - paymentSettlement
      : null;

  const schemeSummary = computeSchemeSummary({
    scheme: paymentScheme,
    total: payableForPayment,
    payNow: paymentEntered,
    dueDate:
      paymentScheme === 'partial'
        ? paymentDueDate
        : paymentScheme === 'installment'
          ? installmentSchedule.map((r) => r.due_date).filter(Boolean).sort()[0] || null
          : null,
    currency: poCurrency,
  });
  const installmentSumError =
    paymentScheme === 'installment'
      ? validateInstallmentScheduleSum(installmentSchedule, displayGrandTotal, poCurrency).error || null
      : null;
  const schemeDueLabel =
    paymentScheme === 'partial' && paymentDueDate
      ? paymentDueDate
      : paymentScheme === 'installment'
        ? (() => {
            const dates = installmentSchedule.map((r) => r.due_date).filter(Boolean).sort();
            if (!dates.length) return null;
            if (dates.length === 1) return dates[0];
            return `${dates[0]} — ${dates[dates.length - 1]}`;
          })()
        : null;

  const receivedQtyByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of existingPO?.items || []) {
      const pid = String((it as { product_id?: string }).product_id || '');
      if (!pid) continue;
      map.set(pid, (map.get(pid) || 0) + Number((it as { received_qty?: number }).received_qty || 0));
    }
    return map;
  }, [existingPO?.items]);

  if (loading && !suppliers.length) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <>
      <PurchaseOrderFormView
        isEditMode={isEditMode}
        isReadOnly={!!isReadOnly}
        status={status}
        currency={poCurrency}
        loading={loading}
        suppliers={suppliers}
        supplierId={supplierId}
        onSupplierChange={setSupplierId}
        onNewSupplier={() => setShowSupplierModal(true)}
        orderDate={orderDate}
        onOrderDateChange={setOrderDate}
        invoiceNumber={invoiceNumber}
        onInvoiceNumberChange={setInvoiceNumber}
        showMoreMeta={showMoreMeta}
        onToggleMoreMeta={() => setShowMoreMeta((v) => !v)}
        expectedDate={expectedDate}
        onExpectedDateChange={setExpectedDate}
        purchaseName={purchaseName}
        onPurchaseNameChange={setPurchaseName}
        notes={notes}
        onNotesChange={setNotes}
        scanInput={scanInput}
        onScanInputChange={setScanInput}
        scanInputRef={scanInputRef}
        quickAddQty={quickAddQty}
        onQuickAddQtyChange={setQuickAddQty}
        onScanSubmit={handleScanSubmit}
        onScanKeyDown={handleScanKeyDown}
        scanCandidates={scanCandidates}
        scanMatchTotal={scanMatchTotal}
        onPickCandidate={handlePickCandidate}
        onOpenBulkAdd={() => setShowBulkAdd(true)}
        onOpenCreateProduct={() => {
          setScanCandidates([]);
          setScanMatchTotal(0);
          setShowCreateProductModal(true);
        }}
        supplierPurchasedIdSet={supplierPurchasedIdSet}
        orderItemRows={filteredOrderItems}
        itemsSearchTerm={itemsSearchTerm}
        onItemsSearchTermChange={setItemsSearchTerm}
        items={items}
        highlightIds={highlightIds}
        qtyViolations={qtyViolations}
        receivedQtyByProductId={receivedQtyByProductId}
        onUpdateQty={(index, qty) => updateItem(index, 'ordered_qty', qty)}
        onBumpQty={bumpItemQty}
        onUpdateCost={(index, cost) =>
          updateItem(
            index,
            poCurrency === 'USD' ? 'base_unit_cost_usd' : 'base_unit_cost',
            cost
          )
        }
        onUpdateSalePrice={(index, price) => updateItem(index, 'sale_price', price)}
        onUpdateUnit={(index, unit) => updateItem(index, 'sale_unit', unit)}
        onRemoveItem={removeItem}
        getMarginPercent={getMarginPercent}
        subtotal={displaySubtotal}
        orderDiscountPercent={orderDiscountPercent}
        onOrderDiscountPercentChange={setOrderDiscountPercent}
        summaryExpense={displayExpense}
        onSummaryExpenseChange={(v) =>
          setSummaryExpense(poCurrency === 'USD' ? Math.round(v * (getFxRateSafe() || 1)) : v)
        }
        orderTaxPercent={orderTaxPercent}
        onOrderTaxPercentChange={setOrderTaxPercent}
        grandTotal={displayGrandTotal}
        orderTaxApplied={displayTax}
        orderDiscountApplied={displayOrderDiscount}
        warehouseTotalUzs={warehouseTotalUzs}
        formatPoMoney={formatPoMoney}
        fxRate={fxRate}
        onFxRateChange={setFxRate}
        showFxRate={poCurrency === 'USD'}
        supplierSettlementCurrency={supplierSettlementCurrency}
        supplierBalanceNow={supplierBalanceNow}
        existingPaidOnPo={existingPaidOnPo}
        paymentAmount={paymentAmount}
        onPaymentAmountChange={setPaymentAmount}
        paymentMethod={paymentMethod}
        onPaymentMethodChange={setPaymentMethod}
        paymentNote={paymentNote}
        onPaymentNoteChange={setPaymentNote}
        entryCurrency={entryCurrency}
        paymentFx={paymentFx}
        payableForPayment={payableForPayment}
        poRemainingBeforePay={poRemainingBeforePay}
        needsFxForPayment={needsFxForPayment}
        paymentEntered={paymentEntered}
        paymentSettlement={paymentSettlement}
        poRemainingAfterPay={poRemainingAfterPay}
        projectedIfReceived={projectedIfReceived}
        projectedIfDraftOnly={projectedIfDraftOnly}
        poAlreadyReceived={poAlreadyReceived}
        onFillFullPayment={() =>
          setPaymentAmount(
            convertFromSettlementCurrency(
              poRemainingBeforePay,
              supplierSettlementCurrency,
              entryCurrency,
              paymentFx
            )
          )
        }
        formatSettlement={formatSettlement}
        paymentScheme={paymentScheme}
        onPaymentSchemeChange={setPaymentScheme}
        paymentDueDate={paymentDueDate}
        onPaymentDueDateChange={setPaymentDueDate}
        installmentSchedule={installmentSchedule}
        onInstallmentScheduleChange={setInstallmentSchedule}
        schemePayNow={schemeSummary.payNow}
        schemeDebt={schemeSummary.debt}
        schemeDueLabel={schemeDueLabel}
        installmentSumError={installmentSumError}
        totalQty={totalQty}
        updateSalePriceOnReceive={updateSalePriceOnReceive}
        onUpdateSalePriceOnReceiveChange={setUpdateSalePriceOnReceive}
        onSaveDraft={() => void handleSave(false)}
        onSaveReceive={() => void handleSave(true)}
        onConfirmReceive={showConfirmReceiveButton ? () => void handleConfirmAndReceive() : undefined}
        showConfirmReceiveButton={!!showConfirmReceiveButton}
        confirmReceiveLabel={confirmReceiveLabel}
        onBack={() => void leaveToList(isPoDirty)}
      />

      <PurchaseOrderBulkAddModal
        open={showBulkAdd}
        onOpenChange={setShowBulkAdd}
        catalog={scanCatalog}
        categories={categories}
        onAddMany={handleBulkAddMany}
      />
      <Dialog
        open={bulkTannarxConfirm != null}
        onOpenChange={(open) => {
          if (!open) setBulkTannarxConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tannarxni ommaviy oshirish</DialogTitle>
            <DialogDescription>
              Barcha {items.length} ta qatorga tannarx +{bulkTannarxConfirm}% qo'llansinmi? Sotuv narxi
              o'zgarmaydi — kerak bo'lsa keyin marja bo'yicha qayta hisoblang.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkTannarxConfirm(null)}>
              Bekor
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (bulkTannarxConfirm != null) {
                  applyBulkTannarxIncrease(bulkTannarxConfirm);
                }
                setBulkTannarxConfirm(null);
              }}
            >
              Qo'llash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        initialName={scanInput.trim()}
        purchaseCostCurrency={poCurrency}
        fxRate={fxRate}
      />
    </>
  );
}
