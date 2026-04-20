import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useShiftStore } from '@/store/shiftStore';
import { useInventoryStore } from '@/store/inventoryStore';
import { formatMoneyUZS } from '@/lib/format';
import { formatUnit } from '@/utils/formatters';
import {
  clampQuantityForUnit,
  clampSignedQuantityForUnit,
  formatQuantity,
  getMaxQuantityForUnit,
  getQuantityMin,
  getQuantityStep,
  isFractionalUnit,
  isValidQuantityInput,
  normalizeQuantityInput,
} from '@/utils/quantity';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardQueries } from '@/utils/dashboard';
import {
  searchProductsScreen,
  getProductByBarcode,
  getProductBySku,
  getProductById,
  getCustomers,
  createOrder,
  createCreditOrder,
  receiveCustomerPayment,
  getOrderById,
  saveHeldOrder,
  getHeldOrders,
  generateHeldNumber,
  deleteHeldOrder,
  getCategories,
  updateHeldOrderName,
  getProducts,
  getSettingsByCategory,
  getPriceTiers,
  getProductTierPrice,
  applyPromotionsToCart,
  getPromotions,
} from '@/db/api';
import { parseScaleEan13 } from '@/lib/barcode';
import ShiftControl from '@/components/pos/ShiftControl';
import PosDeviceBar from '@/components/pos/PosDeviceBar';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import type {
  Product,
  Customer,
  CartItem,
  PaymentMethod,
  HeldOrder,
  Category,
  CompanySettings,
  ReceiptSettings,
  ReceiptTemplateStore,
  OrderItem,
} from '@/types/database';
import { POS_EXCHANGE_PAYOUT_METHOD, type PosCheckoutPaymentKind } from '@/constants/posExchange';
import {
  Search,
  Trash2,
  Plus,
  Minus,
  DollarSign,
  CreditCard,
  Smartphone,
  Banknote,
  Tag,
  Clock,
  Pause,
  Package,
  X,
  Check,
  ChevronsUpDown,
  Lock,
  Eye,
  EyeOff,
  AlertTriangle,
  Printer,
  Gift,
  ArrowLeftRight,
  ClipboardList,
} from 'lucide-react';
import WaitingOrdersDialog from '@/components/pos/WaitingOrdersDialog';
import Numpad from '@/components/pos/Numpad';
import QuickCustomerCreate from '@/components/pos/QuickCustomerCreate';
import CustomerInfoBadge from '@/components/pos/CustomerInfoBadge';
import ReceivePaymentModal from '@/components/customers/ReceivePaymentModal';
import Receipt from '@/components/Receipt';
import ReceiptPrintView from '@/components/print/ReceiptPrintView';
import MoneyInput from '@/components/common/MoneyInput';
import { openPrintWindow } from '@/lib/print';
import { renderReceiptTemplate } from '@/lib/receipts/renderReceiptTemplate';
import { getActiveReceiptTemplate, resolveReceiptTemplateStore } from '@/lib/receipts/templateStore';
import { buildReceiptInputFromPos } from '@/lib/receipts/receiptModel';
import { formatOrderDateTime } from '@/lib/datetime';
import { buildReceiptLines, DEFAULT_CHARS_PER_LINE, DEFAULT_CHARS_PER_LINE_58 } from '@/lib/receipts/receiptTextBuilder';
import { printEscposReceipt } from '@/lib/receipts/escposPrint';
import { isElectron, getElectronAPI, handleIpcResponse } from '@/utils/electron';
import { getProductImageDisplayUrl } from '@/lib/productImageUrl';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDebounce } from '@/hooks/use-debounce';
import Fuse from 'fuse.js';
import { highlightMatch } from '@/utils/searchHighlight';
import { getRecentSearches, addRecentSearch, removeRecentSearch } from '@/utils/recentSearches';

export default function POSTerminal() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const { currentShift, addSale, addRefund } = useShiftStore();
  const { addMovement } = useInventoryStore();
  const queryClient = useQueryClient();
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** F3 shortcut — `handleHoldOrder` keyinroq e'lon qilinadi */
  const handleHoldOrderShortcutRef = useRef<() => Promise<void>>(async () => {});
  
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [recentPosSearches, setRecentPosSearches] = useState<string[]>(() =>
    getRecentSearches('pos')
  );
  const [cart, setCart] = useState<CartItem[]>([]);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const [cartWithPromos, setCartWithPromos] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerComboboxOpen, setCustomerComboboxOpen] = useState(false);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [customerPaymentOpen, setCustomerPaymentOpen] = useState(false);
  const [cartReviewOpen, setCartReviewOpen] = useState(false);
  const [discount, setDiscount] = useState<{
    type: 'amount' | 'percent' | 'promo';
    value: string;
  }>({
    type: 'amount',
    value: '',
  });
  /** POS promokod (aksiya shartida promo_code bo‘lsa, backend tekshiradi) */
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const debouncedPromoCode = useDebounce(promoCodeInput.trim(), 350);
  // POS pricing override (quick toggle): force current cart to use master pricing rules
  const [currentTierCode, setCurrentTierCode] = useState<'retail' | 'master' | 'wholesale' | 'marketplace'>('retail');
  const [priceTiers, setPriceTiers] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  /** Mijozning oldingi qarzini shu safar savat bilan birga yopish (default: yoqilgan) */
  const [includePriorDebtInPayment, setIncludePriorDebtInPayment] = useState(true);
  const [payments, setPayments] = useState<{ method: PaymentMethod; amount: number }[]>([]);
  const [cashReceived, setCashReceived] = useState<number | null>(null);
  const [editingQuantity, setEditingQuantity] = useState<{ [key: string]: string }>({});
  const [manualPricePopoverProductId, setManualPricePopoverProductId] = useState<string | null>(null);
  const [manualPriceDraft, setManualPriceDraft] = useState<number | null>(null);
  const [creditAmount, setCreditAmount] = useState<string>('');
  /** Loyalty points to redeem on current sale (POS); clamped server-side */
  const [loyaltyRedeemPoints, setLoyaltyRedeemPoints] = useState(0);

  const resetCustomerSelection = useCallback(() => {
    const selectedTier = (selectedCustomer as any)?.pricing_tier;

    setSelectedCustomer(null);
    setCustomerSearchTerm('');
    setCustomerComboboxOpen(false);

    // Prevent a customer-specific pricing tier from leaking into the next walk-in sale.
    if (selectedTier && currentTierCode === selectedTier) {
      setCurrentTierCode('retail');
    }
  }, [currentTierCode, selectedCustomer]);
  
  // Held orders state
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([]);
  const [waitingOrdersDialogOpen, setWaitingOrdersDialogOpen] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [orderToRestore, setOrderToRestore] = useState<HeldOrder | null>(null);
  const [importWebOrderDialogOpen, setImportWebOrderDialogOpen] = useState(false);
  const [pendingWebOrderImportId, setPendingWebOrderImportId] = useState<number | null>(null);
  const webOrderImportProcessedRef = useRef<string | null>(null);

  // New state for premium features
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [favoriteProducts, setFavoriteProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [numpadOpen, setNumpadOpen] = useState(false);
  const [numpadConfig, setNumpadConfig] = useState<{
    type: 'quantity' | 'discount' | 'add_quantity';
    productId?: string;
    product?: Product;
    initialValue?: number;
    max?: number;
    unit?: string;
    sale_unit?: string;
    ratio_to_base?: number;
    /** Price per sale unit (for weighted add → sum mode). */
    refUnitPrice?: number;
  } | null>(null);
  /** POS: o‘lchovli mahsulotni savatga — birlik yoki so‘m summasi bo‘yicha */
  const [weightedCartAddMode, setWeightedCartAddMode] = useState<'sale_qty' | 'amount_uzs'>('sale_qty');
  const [exchangeReturnMode, setExchangeReturnMode] = useState(false);
  const [selectedCartIndex, setSelectedCartIndex] = useState<number>(-1);
  const [showCostPrice, setShowCostPrice] = useState(false);
  
  // Receipt printing state
  const receiptRef = useRef<HTMLDivElement>(null);
  const barcodeCacheRef = useRef<Map<string, Product>>(new Map());
  const barcodeIndexRef = useRef<Map<string, Product>>(new Map());
  const skuIndexRef = useRef<Map<string, Product>>(new Map());
  const barcodeCacheOrderRef = useRef<string[]>([]);
  const priceCacheRef = useRef<Map<string, number>>(new Map());
  const barcodeInFlightRef = useRef(false);
  const lastScanRef = useRef<{ raw: string; at: number }>({ raw: '', at: 0 });
  const searchDebounceRef = useRef<number | null>(null);
  const searchSeqRef = useRef(0);
  const perfEnabled = (import.meta as any)?.env?.VITE_POS_PERF === 'true';
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings | null>(null);
  const [receiptData, setReceiptData] = useState<{
    orderNumber: string;
    items: CartItem[];
    customer: Customer | null;
    subtotal: number;
    discountAmount: number;
    total: number;
    paidAmount: number;
    changeAmount: number;
    paymentMethod: string;
    dateTime: string;
    cashierName?: string;
    priceTierCode?: string | null;
    customerTotalDebt?: number;
  } | null>(null);
  const [lastReceiptData, setLastReceiptData] = useState<typeof receiptData>(null);
  const [printOrder, setPrintOrder] = useState<any | null>(null);
  const [receiptTemplateStore, setReceiptTemplateStore] = useState<ReceiptTemplateStore | null>(null);
  const [recentCartItemId, setRecentCartItemId] = useState<string | null>(null);
  const recentCartTimerRef = useRef<number | null>(null);

  const { data: activePromotions = [] } = useQuery({
    queryKey: ['promotions', 'active'],
    queryFn: () => getPromotions({ status: 'active' }),
    enabled: isElectron(),
    staleTime: 60_000,
  });

  const { data: salesSettingsLoyalty } = useQuery({
    queryKey: ['settings', 'sales', 'loyalty-pos'],
    queryFn: () => getSettingsByCategory('sales'),
    staleTime: 60_000,
  });

  const loyaltyCfg = useMemo(() => {
    const r = (salesSettingsLoyalty || {}) as Record<string, unknown>;
    const truthy = (v: unknown) => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
    const redeemUzsPerPt = Math.max(1, Number(r['loyalty.redeem.points_per_uzs']) || 100);
    const maxPct = Math.min(100, Math.max(1, Number(r['loyalty.redeem.max_percent_of_order']) || 50));
    const minRedeemPts = Math.max(0, Math.floor(Number(r['loyalty.redeem.min_points']) || 1));
    return {
      redeemEnabled: truthy(r['loyalty.redeem.enabled']),
      redeemUzsPerPt,
      maxPct,
      minRedeemPts,
    };
  }, [salesSettingsLoyalty]);

  const isWalkInCustomer = useCallback((c: Customer | null) => {
    return !c || c.id === 'default-customer-001' || c.id === 'none';
  }, []);

  useEffect(() => {
    setLoyaltyRedeemPoints(0);
  }, [selectedCustomer?.id]);

  useEffect(() => {
    setIncludePriorDebtInPayment(true);
  }, [selectedCustomer?.id]);

  const hasPromoForProduct = useCallback(
    (product: Product) => {
      const now = new Date().toISOString();
      for (const p of activePromotions) {
        if (p.status !== 'active' || p.start_at > now || p.end_at < now) continue;
        const scope = (p as any).scope;
        if (!scope || scope.scope_type === 'all') return true;
        if (scope.scope_type === 'products') {
          try {
            const ids = JSON.parse(scope.scope_ids || '[]');
            if (Array.isArray(ids) && ids.includes(product.id)) return true;
          } catch {}
        }
        if (scope.scope_type === 'categories' && product.category_id) {
          try {
            const ids = JSON.parse(scope.scope_ids || '[]');
            if (Array.isArray(ids) && ids.includes(product.category_id)) return true;
          } catch {}
        }
      }
      return false;
    },
    [activePromotions]
  );

  const markRecentCartItem = useCallback((productId: string) => {
    setRecentCartItemId(productId);
    if (recentCartTimerRef.current) {
      window.clearTimeout(recentCartTimerRef.current);
    }
    recentCartTimerRef.current = window.setTimeout(() => {
      setRecentCartItemId(null);
    }, 1800);
  }, []);

  const focusSearchInput = useCallback(() => {
    const input = searchInputRef.current;
    if (!input) return;
    input.focus();
    const len = input.value.length;
    if (typeof input.setSelectionRange === 'function') {
      input.setSelectionRange(len, len);
    }
  }, []);

  const getCustomerDebtAmount = useCallback((balance?: number | null) => {
    return Math.max(0, -Number(balance || 0));
  }, []);

  const printReceipt = useCallback(
    async (data: NonNullable<typeof receiptData>) => {
      try {
        const canEscpos = isElectron() && (window as any)?.posApi?.print?.receipt;
        if (canEscpos) {
          try {
            const receiptInput = buildReceiptInputFromPos(data, companySettings, receiptSettings);
            const charsPerLine =
              receiptSettings?.paper_size === '58mm' ? DEFAULT_CHARS_PER_LINE_58 : DEFAULT_CHARS_PER_LINE;
            const lines = buildReceiptLines(receiptInput, { charsPerLine });
            await printEscposReceipt(lines, {
              charsPerLine,
              feedLines: 3,
              cut: true,
            });
            return;
          } catch (escposError) {
            console.warn('[Print] ESC/POS failed, falling back to HTML print', escposError);
          }
        }

        // Build a lightweight order object compatible with ReceiptPrintView (same as Orders printing flow)
        const order = {
          order_number: data.orderNumber,
          created_at: new Date().toISOString(),
          subtotal: data.subtotal,
          discount_amount: data.discountAmount,
          tax_amount: 0,
          total_amount: data.total,
          change_amount: data.changeAmount,
          credit_amount: 0,
          cashier: { username: data.cashierName || '-', full_name: data.cashierName || '-' },
          customer_total_debt: Number(data.customerTotalDebt || 0),
          customer: data.customer
            ? {
                name: data.customer.name,
                phone: (data.customer as any).phone,
                balance: Number((data.customer as any).balance || 0),
              }
            : null,
          items: (data.items || []).map((it: any, idx: number) => ({
            id: `${idx}`,
            product_name: it.product?.name,
            unit_price: Number(it.unit_price ?? it.product?.sale_price ?? 0),
            quantity: Number(it.quantity ?? 0),
            discount_amount: Number(it.discount_amount ?? 0),
            product: { sku: it.product?.sku },
          })),
          payments: [{ payment_method: String(data.paymentMethod || '').toLowerCase(), amount: Number(data.paidAmount || 0) }],
        };

        const activeTemplate = getActiveReceiptTemplate(receiptTemplateStore);
        if (activeTemplate) {
          const htmlContent = renderReceiptTemplate(activeTemplate, order as any, companySettings || undefined, undefined, {
            middleText: receiptSettings?.middle_text?.trim() || undefined,
          });
          openPrintWindow(htmlContent, `${activeTemplate.paperWidth}mm` as '58mm' | '78mm' | '80mm');
          return;
        }

        flushSync(() => {
          setPrintOrder(order);
        });

        const el = document.getElementById('pos-receipt-print-content');
        if (!el) {
          toast({
            title: 'Print xatoligi',
            description: 'Chek content topilmadi (pos-receipt-print-content).',
            variant: 'destructive',
          });
          return;
        }

        const htmlContent = el.innerHTML;
        openPrintWindow(htmlContent, receiptSettings?.paper_size || '78mm');
      } catch (e: any) {
        toast({
          title: 'Print xatoligi',
          description: e?.message || 'Chekni chop etib bo‘lmadi',
          variant: 'destructive',
        });
      }
    },
    [companySettings, receiptSettings, receiptTemplateStore, toast]
  );

  // Load functions - defined before useEffect
  const loadCustomers = useCallback(async () => {
    try {
      const data = await getCustomers();
      setCustomers(data);
    } catch (error) {
      console.error('Error loading customers:', error);
    }
  }, []);

  const loadPriceTiers = useCallback(async () => {
    try {
      const tiers = await getPriceTiers();
      const normalized = Array.isArray(tiers) ? tiers : [];
      setPriceTiers(normalized);
    } catch (error) {
      console.error('Error loading price tiers:', error);
    }
  }, []);

  // Apply promotions to cart when cart, customer, or promokod changes
  useEffect(() => {
    if (cart.length === 0) {
      setCartWithPromos([]);
      setPromoCodeInput('');
      return;
    }
    if (cart.some((it) => (Number(it.qty_sale ?? it.quantity ?? 0) || 0) < 0)) {
      setCartWithPromos(cart);
      return;
    }
    const code = debouncedPromoCode ? debouncedPromoCode : null;
    applyPromotionsToCart(cart, selectedCustomer?.id ?? null, code)
      .then(setCartWithPromos)
      .catch(() => setCartWithPromos(cart));
  }, [cart, selectedCustomer?.id, debouncedPromoCode]);

  // If we came back from CustomerForm (?from=pos), auto-select the newly created customer.
  useEffect(() => {
    try {
      const lastCreatedId = localStorage.getItem('pos:lastCreatedCustomerId');
      if (!lastCreatedId) return;
      if (!customers || customers.length === 0) return;

      const found = customers.find((c) => c.id === lastCreatedId);
      if (found) {
        setSelectedCustomer(found);
        setCustomerComboboxOpen(false);
        setCustomerSearchTerm('');
        localStorage.removeItem('pos:lastCreatedCustomerId');
      }
    } catch {
      // ignore
    }
  }, [customers]);

  useEffect(() => {
    const tier = (selectedCustomer as any)?.pricing_tier;
    if (tier && tier !== currentTierCode) {
      setCurrentTierCode(tier);
    }
  }, [selectedCustomer, currentTierCode]);

  const refreshCustomersAfterCustomerPayment = useCallback(async () => {
    try {
      const data = await getCustomers();
      setCustomers(data);
      setSelectedCustomer((prev) => {
        if (!prev) return prev;
        return data.find((c) => c.id === prev.id) || prev;
      });
    } catch (error) {
      console.error('Error refreshing customers after payment:', error);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const data = await getCategories();
      setCategories(data);
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  }, []);

  const loadFavoriteProducts = useCallback(async () => {
    try {
      // Load top 8 products by sales or mark specific products as favorites
      // For now, we'll just load the first 8 active products
      const results = await getProducts(false, {
        limit: 8,
        offset: 0,
        sortBy: 'name',
        sortOrder: 'asc',
        stockStatus: 'all',
      });
      setFavoriteProducts(results);
    } catch (error) {
      console.error('Error loading favorite products:', error);
    }
  }, []);

  const loadAllProducts = useCallback(async () => {
    try {
      // IMPORTANT: Load from real DB via IPC in Electron.
      // `searchProducts('')` is intentionally limited (fast search), but POS needs the full catalog.
      const results = await getProducts(false, {
        limit: 5000,
        offset: 0,
        sortBy: 'name',
        sortOrder: 'asc',
        stockStatus: 'all',
      });
      setAllProducts(results);
      // Build fast lookup indexes for barcode/SKU to speed up scans.
      const nextBarcodeIndex = new Map<string, Product>();
      const nextSkuIndex = new Map<string, Product>();
      for (const p of results) {
        const sku = String(p.sku || '').trim();
        if (sku) nextSkuIndex.set(sku, p);
        const barcode = String((p as any).barcode || '').trim();
        if (barcode) nextBarcodeIndex.set(barcode, p);
      }
      barcodeIndexRef.current = nextBarcodeIndex;
      skuIndexRef.current = nextSkuIndex;
    } catch (error) {
      console.error('Error loading all products:', error);
    }
  }, []);

  const loadHeldOrders = useCallback(async () => {
    try {
      const data = await getHeldOrders();
      setHeldOrders(data as HeldOrder[]);
    } catch (error) {
      console.error('Error loading held orders:', error);
    }
  }, []);

  useEffect(() => {
    loadCustomers();
    loadCategories();
    loadFavoriteProducts();
    loadAllProducts();
    loadHeldOrders();
    loadPriceTiers();
  }, [loadCustomers, loadCategories, loadFavoriteProducts, loadAllProducts, loadHeldOrders, loadPriceTiers]);

  useEffect(() => {
    return () => {
      if (recentCartTimerRef.current) {
        window.clearTimeout(recentCartTimerRef.current);
      }
    };
  }, []);

  // Load receipt/company settings (used for printing)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [company, receipt, receiptTemplates] = await Promise.all([
          getSettingsByCategory('company'),
          getSettingsByCategory('receipt'),
          getSettingsByCategory('receipt_templates'),
        ]);
        if (cancelled) return;
        setCompanySettings(company as unknown as CompanySettings);
        setReceiptSettings(receipt as unknown as ReceiptSettings);
        setReceiptTemplateStore(resolveReceiptTemplateStore(receiptTemplates));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Failed to load receipt/company settings:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input field (except search)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      
      // F2: Focus search input
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      
      // F9: Open payment modal
      if (e.key === 'F9') {
        e.preventDefault();
        if (cart.length > 0 && !paymentDialogOpen) {
          setPaymentDialogOpen(true);
        }
        return;
      }

      // F8: Qaytarish rejimi (bir chekda almashuv / manfiy qator)
      if (e.key === 'F8') {
        e.preventDefault();
        if (paymentDialogOpen || waitingOrdersDialogOpen) return;
        setExchangeReturnMode((v) => !v);
        return;
      }
      
      // F3: Hold order (darhol saqlash, navbat raqami avtomatik)
      if (e.key === 'F3') {
        e.preventDefault();
        if (cart.length > 0) {
          void handleHoldOrderShortcutRef.current();
        }
        return;
      }
      
      // ESC: Close modals or clear search
      if (e.key === 'Escape') {
        if (paymentDialogOpen) {
          setPaymentDialogOpen(false);
        } else if (waitingOrdersDialogOpen) {
          setWaitingOrdersDialogOpen(false);
        } else if (searchTerm) {
          setSearchTerm('');
          setSearchResults([]);
        }
        return;
      }
      
      // ENTER: Add first search result to cart
      if (e.key === 'Enter' && target === searchInputRef.current && searchResults.length > 0) {
        e.preventDefault();
        requestAddToCart(searchResults[0]);
        focusSearchInput();
        return;
      }
      
      // ALT+1 to ALT+8: Add favorite products
      if (e.altKey && e.key >= '1' && e.key <= '8') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (favoriteProducts[index]) {
          requestAddToCart(favoriteProducts[index]);
        }
        return;
      }
      
      // Mahsulot qidiruvida "-", "/", harflar yoziladi — ularni savat miqdori (+/-) yoki strelkalar bilan aralashtirmaslik
      if (target === searchInputRef.current) return;

      // Boshqa maydonlarda ham matn yozilayotganda savat klaviatura qisqartmalarini ishga tushirmaslik
      if (isInput) return;

      // UP/DOWN: Navigate cart rows
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCartIndex(prev => Math.max(0, prev - 1));
        return;
      }
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCartIndex(prev => Math.min(cart.length - 1, prev + 1));
        return;
      }
      
      // +/-: Adjust quantity for selected row
      if ((e.key === '+' || e.key === '=') && selectedCartIndex >= 0 && cart[selectedCartIndex]) {
        e.preventDefault();
        const item = cart[selectedCartIndex];
        const step = getQuantityStep(item.sale_unit || item.product.unit);
        updateQuantity(item.product.id, item.quantity + step);
        return;
      }
      
      if ((e.key === '-' || e.key === '_') && selectedCartIndex >= 0 && cart[selectedCartIndex]) {
        e.preventDefault();
        const item = cart[selectedCartIndex];
        const step = getQuantityStep(item.sale_unit || item.product.unit);
        updateQuantity(item.product.id, item.quantity - step);
        return;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    cart,
    searchResults,
    searchTerm,
    paymentDialogOpen,
    waitingOrdersDialogOpen,
    selectedCartIndex,
    favoriteProducts,
  ]);

  // Auto-select first cart item when cart changes
  useEffect(() => {
    if (cart.length > 0 && selectedCartIndex === -1) {
      setSelectedCartIndex(0);
    } else if (cart.length === 0) {
      setSelectedCartIndex(-1);
    } else if (selectedCartIndex >= cart.length) {
      setSelectedCartIndex(cart.length - 1);
    }
  }, [cart.length]);


  const handleRestoreOrder = (order: HeldOrder) => {
    if (cart.length > 0) {
      // Show confirmation if cart is not empty
      setOrderToRestore(order);
      setRestoreConfirmOpen(true);
    } else {
      // Restore directly if cart is empty
      restoreOrder(order);
    }
  };

  const restoreOrder = async (order: HeldOrder) => {
    try {
      const restoredCustomer = order.customer_id
        ? (customers.find((c) => c.id === order.customer_id) || null)
        : null;

      // Backward-compatible restore:
      // - Old held orders might not have unit_price / price_tier
      // - New held orders should preserve saved unit_price / price_tier
      const normalizedItems = (order.items || []).map((item) => {
        const qty = Number(item.quantity || 0) || 0;
        const savedUnitPrice = Number((item as any).unit_price);
        const hasSavedUnitPrice = Number.isFinite(savedUnitPrice);

        const computed = getLinePricing(item.product, qty, restoredCustomer, undefined, 1, item.sale_unit);
        const unitPrice = hasSavedUnitPrice ? savedUnitPrice : computed.unitPrice;
        const priceTier = typeof (item as any).price_tier === 'string'
          ? (item as any).price_tier
          : computed.priceTier;

        const subtotal = unitPrice * qty;
        const lineDiscount = Math.min(Number((item as any).discount_amount || 0) || 0, subtotal);

        return {
          ...item,
          unit_price: unitPrice,
          price_tier: priceTier,
          subtotal,
          discount_amount: lineDiscount,
          total: subtotal - lineDiscount,
        };
      });

      setCart(normalizedItems);
      
      // Restore discount
      if (order.discount && Number(order.discount.value) > 0) {
        setDiscount({
          type: order.discount.type === 'percent' ? 'percent' : 'amount',
          value: String(order.discount.value),
        });
      } else {
        setDiscount({ type: 'amount', value: '' });
      }
      
      // Restore customer if exists
      if (order.customer_id) {
        setSelectedCustomer(restoredCustomer || null);
      }

      // Delete the held order (since we're restoring it, we don't want it in the list anymore)
      await deleteHeldOrder(order.id);

      // Reload held orders list to remove the restored order
      loadHeldOrders();

      // Close dialogs
      setWaitingOrdersDialogOpen(false);
      setRestoreConfirmOpen(false);
      setOrderToRestore(null);

      // Show success toast
      toast({
        title: '✅ Buyurtma qayta tiklandi',
        description: `${order.items.length} ta mahsulot savatga qaytarildi`,
        className: 'bg-green-50 border-green-200',
      });
    } catch (error) {
      console.error('Error restoring order:', error);
      toast({
        title: 'Xatolik',
        description: 'Buyurtmani qayta tiklashda xatolik yuz berdi',
        variant: 'destructive',
      });
    }
  };

  const handleCancelHeldOrder = async (orderId: string) => {
    try {
      await deleteHeldOrder(orderId);
      
      toast({
        title: 'Order Deleted',
        description: 'Waiting order deleted',
      });

      loadHeldOrders();
    } catch (error) {
      console.error('Error cancelling held order:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete order',
        variant: 'destructive',
      });
    }
  };

  const handleRenameHeldOrder = async (orderId: string, newName: string) => {
    try {
      await updateHeldOrderName(orderId, newName);
      toast({
        title: 'Order Renamed',
        description: 'Waiting order name updated successfully',
      });
      loadHeldOrders();
    } catch (error) {
      console.error('Error renaming held order:', error);
      toast({
        title: 'Error',
        description: 'Failed to rename order',
        variant: 'destructive',
      });
    }
  };

  const normalizeSearchTerm = (value: string) => String(value || '').trim();

  const normalizeSku = (value: string) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[\s\-_]/g, '');

  const normalizeText = (value: string) =>
    String(value || '').trim().toLowerCase();

  const classifyQuery = (value: string) => {
    const raw = normalizeSearchTerm(value);
    const trimmed = raw.trim();
    const lower = normalizeText(trimmed);
    const numericOnly = /^[0-9]+$/.test(trimmed);
    const normalizedSku = normalizeSku(trimmed);
    const isBarcodeLike = numericOnly && [8, 12, 13, 14].includes(trimmed.length);
    const isSkuLike =
      !isBarcodeLike &&
      normalizedSku.length > 0 &&
      normalizedSku.length <= 12 &&
      /^[a-z0-9]+$/i.test(normalizedSku);
    return {
      raw: trimmed,
      lower,
      normalizedSku,
      numericOnly,
      isBarcodeLike,
      isSkuLike,
    };
  };

  const renderSkuWithHighlight = (sku: string, term: string) => {
    const query = normalizeSearchTerm(term).toLowerCase();
    if (!query) return sku;
    const rawSku = String(sku || '');
    const lowerSku = rawSku.toLowerCase();
    const index = lowerSku.indexOf(query);
    if (index < 0) return rawSku;
    const before = rawSku.slice(0, index);
    const match = rawSku.slice(index, index + query.length);
    const after = rawSku.slice(index + query.length);
    return (
      <>
        {before}
        <span className="bg-yellow-200/70 text-gray-900 px-0.5 rounded">{match}</span>
        {after}
      </>
    );
  };

  const getRankedSearchResults = (term: string, categoryId: string | null) => {
    const query = classifyQuery(term);
    if (!query.raw) return [];
    const tokens = query.lower.split(/\s+/).filter(Boolean);

    const scored = allProducts
      .filter((p) => (categoryId ? p.category_id === categoryId : true))
      .map((product) => {
        const sku = String(product.sku || '');
        const skuNormalized = normalizeSku(sku);
        const barcode = String((product as any).barcode || '').trim();
        const name = String(product.name || '');
        const nameLower = name.toLowerCase();
        const normArticle = String(product.article ?? '').toLowerCase().replace(/[\s\-_]/g, '');
        const normTerm = query.lower.replace(/[\s\-_]/g, '');

        let score = 0;
        let matched = false;

        // Exact barcode match (numeric EAN / QR payload with letters, etc.)
        if (barcode && barcode === query.raw) {
          score += 1000;
          matched = true;
        }

        if (skuNormalized) {
          if (skuNormalized === query.normalizedSku) {
            score += 900;
            matched = true;
          } else if (skuNormalized.startsWith(query.normalizedSku)) {
            score += 700;
            matched = true;
          } else if (skuNormalized.includes(query.normalizedSku)) {
            score += 500;
            matched = true;
          }
        }

        if (normArticle && normTerm) {
          if (normArticle === normTerm) {
            score += 850;
            matched = true;
          } else if (normArticle.startsWith(normTerm)) {
            score += 400;
            matched = true;
          } else if (normArticle.includes(normTerm)) {
            score += 200;
            matched = true;
          }
        }

        if (nameLower) {
          if (nameLower.startsWith(query.lower)) {
            score += 400;
            matched = true;
          } else if (tokens.some((token) => nameLower.includes(token))) {
            score += 250;
            matched = true;
          } else if (nameLower.includes(query.lower)) {
            score += 150;
            matched = true;
          }
        }

        if (!matched) return null;

        if (product.current_stock > 0) score += 50;
        if (product.current_stock === 0) score -= 100;

        return { product, score };
      })
      .filter((entry): entry is { product: Product; score: number } => Boolean(entry));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.product.name || '').localeCompare(String(b.product.name || ''));
    });

    const directResults = scored.slice(0, 20).map((entry) => entry.product);

    // Fuzzy fallback via Fuse.js when direct matching yields few results (handles typos)
    if (directResults.length < 3 && query.lower.length >= 2) {
      const pool = categoryId ? allProducts.filter((p) => p.category_id === categoryId) : allProducts;
      const fuse = new Fuse(pool, {
        keys: ['name', 'sku', 'article'],
        threshold: 0.4,
        includeScore: true,
        minMatchCharLength: 2,
      });
      const fuzzyHits = fuse.search(query.lower, { limit: 20 });
      const directIds = new Set(directResults.map((p) => p.id));
      const fuzzyExtra = fuzzyHits
        .filter((r) => !directIds.has(r.item.id))
        .map((r) => r.item);
      return [...directResults, ...fuzzyExtra].slice(0, 20);
    }

    return directResults;
  };

  const runSearch = async (term: string, categoryId: string | null) => {
    const currentSeq = ++searchSeqRef.current;
    const start = perfEnabled ? performance.now() : 0;
    try {
      const normalizedQuery = normalizeSearchTerm(term);
      let results = getRankedSearchResults(normalizedQuery, categoryId);
      if (results.length === 0 && term.trim().length >= 2) {
        const fallback = await searchProductsScreen(term);
        results = categoryId ? fallback.filter((p) => p.category_id === categoryId) : fallback;
      }
      if (searchSeqRef.current === currentSeq) {
        setSearchResults(results);
        // Save to recent searches when there are results
        if (results.length > 0 && term.trim().length >= 2) {
          addRecentSearch('pos', term.trim());
          setRecentPosSearches(getRecentSearches('pos'));
        }
      }
    } catch (error) {
      console.error('Error searching products:', error);
    } finally {
      if (perfEnabled) {
        const ms = Math.round(performance.now() - start);
        console.debug(`[POS PERF] search ${term.length} chars → ${ms}ms`);
      }
    }
  };

  const handleSearch = (term: string) => {
    const MIN_SEARCH_LENGTH = 2;
    const SEARCH_DEBOUNCE_MS = 120;
    setSearchTerm(term);
    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (term.length < MIN_SEARCH_LENGTH) {
      setSearchResults([]);
      return;
    }
    searchDebounceRef.current = window.setTimeout(() => {
      runSearch(term, selectedCategory);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleCategoryChange = async (categoryId: string | null) => {
    setSelectedCategory(categoryId);
    
    // Re-run search with new category filter
    if (searchTerm.length >= 2) {
      runSearch(searchTerm, categoryId);
    }
  };

  const handleBarcodeSearch = async (barcode: string, opts?: { clearSearch?: boolean }) => {
    let perfStart = 0;
    let perfNote = 'lookup';
    try {
      const rawInput = String(barcode || '').trim();
      if (!rawInput) return;
      // QR / CODE128 / custom codes may contain letters and symbols — lookup full string first.
      // Scales still use digit-only payload (13 digits); try that as a second key when it differs.
      const digitsOnly = rawInput.replace(/[^\d]/g, '');
      const lookupKeys = Array.from(
        new Set([rawInput, ...(digitsOnly && digitsOnly !== rawInput ? [digitsOnly] : [])])
      );
      perfStart = perfEnabled ? performance.now() : 0;
      const now = Date.now();
      if (
        barcodeInFlightRef.current &&
        rawInput === lastScanRef.current.raw &&
        now - lastScanRef.current.at < 250
      ) {
        if (perfEnabled) console.debug('[POS PERF] scan skipped (in-flight)');
        return;
      }
      barcodeInFlightRef.current = true;
      lastScanRef.current = { raw: rawInput, at: now };
      const cache = barcodeCacheRef.current;
      const indexBarcode = barcodeIndexRef.current;
      const indexSku = skuIndexRef.current;
      const clearSearch = opts?.clearSearch ?? true;
      const resetSearch = () => {
        if (!clearSearch) return;
        setSearchTerm('');
        setSearchResults([]);
      };

      for (const key of lookupKeys) {
        const indexedBarcode = indexBarcode.get(key);
        if (indexedBarcode) {
          void addToCart(indexedBarcode as any, 1);
          resetSearch();
          return;
        }
        const indexedSku = indexSku.get(key);
        if (indexedSku) {
          void addToCart(indexedSku as any, 1);
          resetSearch();
          return;
        }
        const cachedBarcode = cache.get(`barcode:${key}`);
        if (cachedBarcode) {
          perfNote = 'cache:barcode';
          void addToCart(cachedBarcode as any, 1);
          resetSearch();
          return;
        }
        const cachedSku = cache.get(`sku:${key}`);
        if (cachedSku) {
          perfNote = 'cache:sku';
          void addToCart(cachedSku as any, 1);
          resetSearch();
          return;
        }
      }

      // 1) Scale EAN-13 (variable weight): PP + PLU(5) + WEIGHT(5) + check
      // Prefer scale parsing first for 20-29 prefixed 13-digit codes to avoid noisy NOT_FOUND logs
      // and to ensure scale barcodes are treated as scale even if they are not stored in products.barcode.
      const scaleStrict = digitsOnly.length === 13 ? parseScaleEan13(digitsOnly) : null;
      // Some scales produce 13-digit codes that don't pass standard EAN-13 checksum validation.
      // We support a lenient fallback parse, but ONLY accept it if it matches a real KG product by PLU.
      const scale =
        scaleStrict ||
        (() => {
          const digits = digitsOnly;
          if (digits.length !== 13) return null;
          const prefix2 = digits.slice(0, 2);
          const allowed = ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'];
          if (!allowed.includes(prefix2)) return null;
          const m = digits.match(/^(\d{2})(\d{5})(\d{5})\d$/);
          if (!m) return null;
          const plu = m[2];
          const weightRaw = Number.parseInt(m[3], 10);
          if (!Number.isFinite(weightRaw) || weightRaw <= 0) return null;
          const weightKg = weightRaw / 1000;
          if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
          return { barcode: digits, prefix: prefix2, plu, weightKg };
        })();

      if (scale) {
        perfNote = 'scale';
        // Many scales encode PLU as 5 digits (e.g. "00009"), while our SKU may be stored without leading zeros ("9").
        const pluRaw = String(scale.plu || '').trim();
        const pluTrimmed = pluRaw.replace(/^0+/, '') || '0';
        const pluPadded4 = pluTrimmed.padStart(4, '0');
        const pluPadded3 = pluTrimmed.padStart(3, '0');
        const pluCandidates = Array.from(new Set([pluRaw, pluTrimmed, pluPadded4, pluPadded3].filter(Boolean)));

        let byPlu: any = null;
        for (const candidate of pluCandidates) {
          const cached = cache.get(`sku:${candidate}`);
          if (cached) {
            byPlu = cached as any;
            break;
          }
          const indexed = skuIndexRef.current.get(candidate);
          if (indexed) {
            byPlu = indexed as any;
            break;
          }
          // eslint-disable-next-line no-await-in-loop
          byPlu = await getProductBySku(candidate);
          if (byPlu) {
            cache.set(`sku:${candidate}`, byPlu as any);
            break;
          }
        }

        const normalizeUnit = (value: unknown) => String(value ?? '').trim().toLowerCase();
        const isKgToken = (token: string) => {
          // Support common variants across DBs / locales
          if (token === 'kg' || token === 'кг') return true;
          if (token.startsWith('kg')) return true; // e.g. "kg.", "kg "
          if (token.includes('kilogram')) return true;
          if (token.includes('килограмм')) return true;
          return false;
        };
        const productUnits = Array.isArray((byPlu as any)?.product_units)
          ? (byPlu as any).product_units
          : [];
        const unitTokens = [
          (byPlu as any)?.unit,
          (byPlu as any)?.base_unit,
          (byPlu as any)?.unit_code,
          (byPlu as any)?.unit_symbol,
          (byPlu as any)?.unit_name,
          ...productUnits.map((u: any) => u?.unit),
        ]
          .map((v) => normalizeUnit(v))
          .filter(Boolean);

        const isKg = unitTokens.some((t) => isKgToken(t));
        const matchedUnit =
          productUnits.find((u: any) => isKgToken(normalizeUnit(u?.unit)))?.unit ||
          (isKgToken(normalizeUnit((byPlu as any)?.unit)) ? (byPlu as any)?.unit : null) ||
          (isKgToken(normalizeUnit((byPlu as any)?.base_unit)) ? (byPlu as any)?.base_unit : null) ||
          (isKgToken(normalizeUnit((byPlu as any)?.unit_code)) ? (byPlu as any)?.unit_code : null) ||
          (isKgToken(normalizeUnit((byPlu as any)?.unit_symbol)) ? (byPlu as any)?.unit_symbol : null) ||
          (isKgToken(normalizeUnit((byPlu as any)?.unit_name)) ? (byPlu as any)?.unit_name : null) ||
          'kg';
        if (byPlu && isKg) {
          void addToCart(byPlu as any, scale.weightKg, String(matchedUnit));
          resetSearch();
          return;
        }

        // If it *looks* like a scale barcode but we can't map it to a KG product, show a helpful hint.
        const reason = !byPlu
          ? `PLU: ${String(scale.plu)} (SKU ${pluCandidates.join('/')}) topilmadi`
          : `Mahsulot "${(byPlu as any)?.name}" birlik: "${(byPlu as any)?.unit || (byPlu as any)?.base_unit || '?'}" — kg emas`;
        toast({
          title: 'Tarozi kodi mos kelmadi',
          description: reason,
          variant: 'destructive',
          duration: 8000,
        });
        resetSearch();
        return;
      }

      // 2) Normal barcode lookup (exact match: full scan, then digits-only if different)
      let product: any = null;
      let matchedKey = '';
      let hitBarcodeField = false;
      for (const key of lookupKeys) {
        const looksLikeBarcode = key.length >= 8;
        let byBarcode: any = null;
        let bySku: any = null;
        if (looksLikeBarcode) {
          // eslint-disable-next-line no-await-in-loop
          byBarcode = await getProductByBarcode(key).catch(() => null);
          if (!byBarcode && key.length <= 8) {
            // eslint-disable-next-line no-await-in-loop
            bySku = await getProductBySku(key).catch(() => null);
          }
        } else {
          // eslint-disable-next-line no-await-in-loop
          bySku = await getProductBySku(key).catch(() => null);
          if (!bySku) {
            // eslint-disable-next-line no-await-in-loop
            byBarcode = await getProductByBarcode(key).catch(() => null);
          }
        }
        const p = byBarcode || bySku;
        if (p) {
          product = p;
          matchedKey = key;
          hitBarcodeField = !!byBarcode;
          break;
        }
      }

      if (product) {
        perfNote = 'hit';
        if (hitBarcodeField) {
          cache.set(`barcode:${matchedKey}`, product);
          barcodeCacheOrderRef.current.push(`barcode:${matchedKey}`);
          barcodeIndexRef.current.set(matchedKey, product);
        } else {
          cache.set(`sku:${matchedKey}`, product);
          barcodeCacheOrderRef.current.push(`sku:${matchedKey}`);
          skuIndexRef.current.set(matchedKey, product);
        }
        if (barcodeCacheOrderRef.current.length > 500) {
          const drop = barcodeCacheOrderRef.current.splice(0, 200);
          for (const dropKey of drop) {
            cache.delete(dropKey);
          }
        }
        void addToCart(product, 1);
        resetSearch();
        return;
      }

      // Not found -> show feedback and clear (scanner flow)
      perfNote = 'miss';
      toast({
        title: 'Mahsulot topilmadi',
        description: `Kod: ${rawInput}`,
        variant: 'destructive',
      });
      resetSearch();
    } catch (error) {
      console.error('Error searching by barcode:', error);
    } finally {
      if (perfEnabled && perfStart) {
        const ms = Math.round(performance.now() - perfStart);
        console.debug(`[POS PERF] scan ${perfNote} → ${ms}ms`);
      }
      barcodeInFlightRef.current = false;
    }
  };

  // ---------------------------------------------------------------------
  // Global HID barcode scanner listener.
  // Scanners typed in keyboard-wedge mode hit the `onKeyDown` on the search
  // input when it's focused, but cashiers often focus other fields (qty,
  // customer picker, etc.). This hook catches the scan globally and routes
  // it to the same `handleBarcodeSearch` handler. Slow human typing is
  // never hijacked (see `whenInputFocused: 'auto'`).
  // ---------------------------------------------------------------------
  useBarcodeScanner({
    enabled: true,
    minLength: 4,
    onScan: (code) => {
      if (!code) return;
      void handleBarcodeSearch(code, { clearSearch: true });
    },
    whenInputFocused: 'auto',
  });

  const getLinePricing = useCallback(
    (
      product: Product,
      qtyBase: number,
      customer: Customer | null,
      unitSalePrice?: number,
      ratioToBase: number = 1,
      unitCode?: string
    ) => {
      const retailPrice = Number(unitSalePrice ?? (product as any)?.sale_price ?? 0) || 0;
      const customerTier = (customer as any)?.pricing_tier || null;
      const effectiveTier =
        (customerTier as any) ||
        currentTierCode ||
        'retail';

      if (effectiveTier !== 'master' && effectiveTier !== 'wholesale' && effectiveTier !== 'marketplace') {
        return { unitPrice: retailPrice, priceTier: 'retail' as const };
      }

      if (effectiveTier === 'master') {
        const masterPriceRaw = (product as any)?.master_price;
        const masterPrice =
          masterPriceRaw === null || masterPriceRaw === undefined ? null : Number(masterPriceRaw);
        if (masterPrice === null || !Number.isFinite(masterPrice)) {
          return { unitPrice: retailPrice, priceTier: 'retail' as const };
        }

        const minQtyRaw = (product as any)?.master_min_qty;
        const minQty = minQtyRaw === null || minQtyRaw === undefined ? null : Number(minQtyRaw);
        if (minQty !== null && Number.isFinite(minQty) && minQty > 0 && Math.abs(qtyBase) < minQty) {
          return { unitPrice: retailPrice, priceTier: 'retail' as const };
        }

        const masterUnitPrice = Number(masterPrice || 0) * (Number(ratioToBase || 0) || 1);
        return { unitPrice: masterUnitPrice || retailPrice, priceTier: 'master' as const };
      }

      const unitKey = `${product.id}::${effectiveTier}::${unitCode || product.unit || product.base_unit || 'pcs'}`;
      const cached = priceCacheRef.current.get(unitKey);
      if (cached != null) {
        return { unitPrice: Number(cached || 0) || 0, priceTier: effectiveTier as any };
      }

      return { unitPrice: retailPrice, priceTier: effectiveTier as any };
    },
    [currentTierCode]
  );

  const fetchTierPrice = useCallback(
    async (product: Product, tierCode: string, unit: string) => {
      if (tierCode === 'retail' || tierCode === 'master') return null;
      const key = `${product.id}::${tierCode}::${unit}`;
      const cached = priceCacheRef.current.get(key);
      if (cached != null) return cached;
      const price = await getProductTierPrice({
        product_id: product.id,
        tier_code: tierCode,
        currency: 'UZS',
        unit,
      });
      if (price != null) {
        priceCacheRef.current.set(key, Number(price || 0) || 0);
      }
      return price;
    },
    []
  );

  const effectiveCart = cartWithPromos.length === cart.length ? cartWithPromos : cart;

  const cartDisplay = useMemo(() => {
    const start = perfEnabled ? performance.now() : 0;
    const items = effectiveCart.map((item, index) => {
      const costPrice = Number(item.product.purchase_price || 0);
      const qtyForCost = Number(item.qty_sale ?? item.quantity ?? 0) || 0;
      const finalPricePerUnit =
        qtyForCost !== 0 ? item.total / qtyForCost : Number(item.unit_price || 0);
      const isBelowCost = qtyForCost > 0 && finalPricePerUnit < costPrice;
      const unit = item.sale_unit || item.product.unit;
      const baseUnit = (item.product as any)?.base_unit || item.product.unit;
      const quantityStep = getQuantityStep(unit);
      const quantityMin = getQuantityMin(unit);
      const inputMode = isFractionalUnit(unit) ? 'decimal' : 'numeric';
      const displayQuantity =
        editingQuantity[item.product.id] !== undefined
          ? editingQuantity[item.product.id]
          : formatQuantity(item.quantity || quantityMin, unit);
      return {
        item,
        index,
        costPrice,
        finalPricePerUnit,
        isBelowCost,
        unit,
        baseUnit,
        quantityStep,
        quantityMin,
        inputMode,
        displayQuantity,
        isSelected: index === selectedCartIndex,
      };
    });
    if (perfEnabled) {
      const ms = Math.round(performance.now() - start);
      console.debug(`[POS PERF] cart compute ${items.length} items → ${ms}ms`);
    }
    return items;
  }, [effectiveCart, editingQuantity, selectedCartIndex, perfEnabled]);

  // Recalculate cart prices when customer/tier changes
  useEffect(() => {
    setCart((prev) =>
      prev.map((item) => {
        const qtySale = Number(item.qty_sale ?? item.quantity ?? 0) || 0;
        const qtyBase = Number(item.qty_base ?? 0) || 0;
        const ratioToBase = Number(item.ratio_to_base ?? 1) || 1;
        const { sale_price: baseUnitPriceRaw } = getSaleUnitConfig(item.product, item.sale_unit);
        const baseUnitPrice =
          Number(baseUnitPriceRaw ?? (item.product as any)?.sale_price ?? item.unit_price ?? 0) || 0;
        if (item.is_price_overridden || item.price_source === 'manual') {
          const unitPrice = Number(item.unit_price || 0) || 0;
          const subtotal = unitPrice * qtySale;
          const lineDiscount =
            qtySale < 0 ? 0 : Math.min(item.discount_amount || 0, subtotal);
          return {
            ...item,
            qty_sale: qtySale,
            qty_base: qtyBase || toBaseQty(qtySale, ratioToBase),
            unit_price: unitPrice,
            subtotal,
            discount_amount: lineDiscount,
            total: subtotal - lineDiscount,
          };
        }
        const { unitPrice, priceTier } = getLinePricing(
          item.product,
          qtyBase || qtySale,
          selectedCustomer,
          baseUnitPrice,
          ratioToBase,
          item.sale_unit
        );
        const subtotal = unitPrice * qtySale;
        const lineDiscount =
          qtySale < 0 ? 0 : Math.min(item.discount_amount || 0, subtotal);
        return {
          ...item,
          qty_sale: qtySale,
          qty_base: qtyBase || toBaseQty(qtySale, ratioToBase),
          unit_price: unitPrice,
          price_tier: priceTier,
          subtotal,
          discount_amount: lineDiscount,
          total: subtotal - lineDiscount,
        };
      })
    );
  }, [selectedCustomer, currentTierCode, getLinePricing]);

  const getProductUnits = (product: Product) => {
    const baseUnit = (product as any)?.base_unit || product.unit || 'pcs';
    const units = Array.isArray((product as any)?.product_units)
      ? (product as any).product_units
      : [
          {
            unit: baseUnit,
            ratio_to_base: 1,
            sale_price: Number((product as any)?.sale_price ?? 0) || 0,
            is_default: true,
          },
        ];
    return { baseUnit, units };
  };

  const getTierLabel = useCallback(
    (code?: string | null) => {
      if (!code) return 'Retail';
      const found = priceTiers.find((t) => t.code === code);
      return found?.name || String(code);
    },
    [priceTiers]
  );

  const getSaleUnitConfig = (product: Product, saleUnit?: string) => {
    const { baseUnit, units } = getProductUnits(product);
    const normalizeUnit = (value: unknown) => String(value ?? '').trim().toLowerCase();
    const targetUnit = normalizeUnit(saleUnit);
    const picked =
      units.find((u: any) => normalizeUnit(u.unit) === targetUnit) ||
      units.find((u: any) => u.is_default) ||
      units[0];
    if (targetUnit && picked && normalizeUnit(picked.unit) !== targetUnit) {
      const productUnitTokens = [
        (product as any)?.unit,
        (product as any)?.unit_code,
        (product as any)?.unit_symbol,
        (product as any)?.unit_name,
      ]
        .map((v) => normalizeUnit(v))
        .filter(Boolean);
      if (productUnitTokens.includes(targetUnit)) {
        const fallbackPrice = Number((product as any)?.sale_price ?? 0) || 0;
        return { baseUnit, saleUnit: saleUnit as string, ratio_to_base: 1, sale_price: fallbackPrice };
      }
    }
    const ratio = Number(picked?.ratio_to_base ?? 1) || 1;
    const price = Number(picked?.sale_price ?? (product as any)?.sale_price ?? 0) || 0;
    return { baseUnit, saleUnit: picked?.unit || baseUnit, ratio_to_base: ratio, sale_price: price };
  };

  const toBaseQty = (qtySale: number, ratioToBase: number) => {
    const qty = Number(qtySale || 0) || 0;
    const ratio = Number(ratioToBase || 0) || 1;
    return Number((qty * ratio).toFixed(6));
  };

  const getMaxSaleQty = (product: Product, ratioToBase: number, saleUnit?: string) => {
    const baseAvailable = Number(product.current_stock || 0) || 0;
    if (!Number.isFinite(ratioToBase) || ratioToBase <= 0) return 0;
    const rawMax = baseAvailable / ratioToBase;
    return getMaxQuantityForUnit(rawMax, saleUnit);
  };

  /** Master minimal bazaviy miqdor uchun to‘g‘ri birlik narxi olish (proba miqdor). */
  const getProbeSaleQtyForUnitPrice = (product: Product, saleUnit: string, ratioToBase: number) => {
    const minSale = getQuantityMin(saleUnit);
    const masterMinBase = Number((product as any)?.master_min_qty);
    let probe = minSale;
    if (Number.isFinite(masterMinBase) && masterMinBase > 0) {
      const ratio = Number(ratioToBase || 1) || 1;
      const needSale = masterMinBase / ratio;
      probe = Math.max(probe, needSale);
    }
    return clampQuantityForUnit(probe, saleUnit);
  };

  const resolveProductForCart = async (product: Product) => {
    const fromAll = allProducts.find((p) => p.id === product.id);
    if (fromAll) return fromAll;
    const needsHydrate =
      (product as any).purchase_price === undefined ||
      (product as any).master_price === undefined ||
      (product as any).master_min_qty === undefined ||
      !Array.isArray((product as any).product_units);
    if (!needsHydrate) return product;
    const full = await getProductById(product.id).catch(() => null);
    return full || product;
  };

  const requestAddToCart = async (product: Product) => {
    const resolvedProduct = await resolveProductForCart(product);
    const { saleUnit, ratio_to_base, sale_price } = getSaleUnitConfig(resolvedProduct);
    const maxAllowed = getMaxSaleQty(resolvedProduct, ratio_to_base, saleUnit);
    let refUnitPrice: number | undefined;
    if (isFractionalUnit(saleUnit)) {
      const probeSale = getProbeSaleQtyForUnitPrice(resolvedProduct, saleUnit, ratio_to_base);
      const qtyBaseProbe = toBaseQty(probeSale, ratio_to_base);
      const { unitPrice } = getLinePricing(
        resolvedProduct,
        qtyBaseProbe,
        selectedCustomer,
        sale_price,
        ratio_to_base,
        saleUnit
      );
      if (Number.isFinite(unitPrice) && unitPrice > 0) {
        refUnitPrice = unitPrice;
      }
    }
    setWeightedCartAddMode('sale_qty');
    setNumpadConfig({
      type: 'add_quantity',
      product: resolvedProduct,
      initialValue: undefined,
      max: maxAllowed > 0 ? maxAllowed : undefined,
      unit: saleUnit,
      sale_unit: saleUnit,
      ratio_to_base,
      refUnitPrice,
    });
    setNumpadOpen(true);
  };

  const addToCart = async (product: Product, quantity: number = 1, saleUnit?: string) => {
    const perfStart = perfEnabled ? performance.now() : 0;
    const qtySaleRaw = Number(quantity || 0) || 0;
    const { saleUnit: resolvedUnit, ratio_to_base, sale_price } = getSaleUnitConfig(product, saleUnit);
    if (qtySaleRaw <= 0) return;
    const sign = exchangeReturnMode ? -1 : 1;
    const existingItem = cart.find((item) => item.product.id === product.id);
    const unit = resolvedUnit;
    let validQuantity = clampQuantityForUnit(qtySaleRaw, unit) * sign;
    if (validQuantity > 0) {
      const maxAllowed = getMaxSaleQty(product, ratio_to_base, unit);
      if (maxAllowed > 0 && validQuantity > maxAllowed) {
        validQuantity = maxAllowed;
        toast({
          title: 'Stock Limit Reached',
          description: `Maximum available quantity is ${formatQuantity(maxAllowed, unit)}`,
          variant: 'destructive',
        });
      }
    } else {
      validQuantity = clampSignedQuantityForUnit(validQuantity, unit);
    }
    if (existingItem) {
      const cur = Number(existingItem.qty_sale ?? existingItem.quantity ?? 0) || 0;
      const merged = cur + validQuantity;
      if (merged === 0) {
        removeFromCart(product.id);
        if (perfEnabled) {
          console.debug(`[POS PERF] add_to_cart merge→0 ${product.id} → ${Math.round(performance.now() - perfStart)}ms`);
        }
        return;
      }
      updateQuantity(product.id, merged, { moveToTop: true, highlight: true });
      setSelectedCartIndex(0);
      if (perfEnabled) {
        console.debug(`[POS PERF] add_to_cart merge ${product.id} → ${Math.round(performance.now() - perfStart)}ms`);
      }
      return;
    }
    const qtyBase = toBaseQty(validQuantity, ratio_to_base);
    const effectiveTier = ((selectedCustomer as any)?.pricing_tier || currentTierCode || 'retail') as string;
    if (effectiveTier !== 'retail' && effectiveTier !== 'master') {
      const fetched = await fetchTierPrice(product, effectiveTier, resolvedUnit);
      if (fetched == null) {
        toast({
          title: 'Narx topilmadi',
          description: `Tier: ${effectiveTier} (${resolvedUnit})`,
          variant: 'destructive',
        });
        return;
      }
    }
    const { unitPrice, priceTier } = getLinePricing(
      product,
      qtyBase,
      selectedCustomer,
      sale_price,
      ratio_to_base,
      resolvedUnit
    );
    const newItem: CartItem = {
      product,
      quantity: validQuantity,
      sale_unit: unit,
      qty_sale: validQuantity,
      qty_base: qtyBase,
      ratio_to_base,
      unit_price: unitPrice,
      price_tier: priceTier,
      price_source: priceTier === 'retail' || priceTier === 'master' ? 'tier' : 'tier',
      is_price_overridden: false,
      discount_amount: 0,
      subtotal: unitPrice * validQuantity,
      total: unitPrice * validQuantity,
    };
    setCart((prev) => [newItem, ...prev]);
    setSelectedCartIndex(0);
    markRecentCartItem(product.id);
    if (perfEnabled) {
      const ms = Math.round(performance.now() - perfStart);
      console.debug(`[POS PERF] add_to_cart ${product.id} → ${ms}ms`);
    }
  };

  const importWebOrderIntoCart = useCallback(
    async (webOrderId: number) => {
      if (exchangeReturnMode) {
        toast({
          variant: 'destructive',
          title: t('common.error'),
          description: t('web_orders.import_exchange_mode'),
        });
        return;
      }
      const api = getElectronAPI();
      if (!api?.webOrders?.get) {
        toast({
          variant: 'destructive',
          title: t('common.error'),
          description: t('web_orders.import_failed'),
        });
        return;
      }
      try {
        const order = await handleIpcResponse<Record<string, unknown> & { items?: Array<Record<string, unknown>> } | null>(
          api.webOrders.get(webOrderId),
        );
        if (!order) {
          toast({
            variant: 'destructive',
            title: t('common.error'),
            description: t('web_orders.import_failed'),
          });
          return;
        }
        const st = String(order.status || '');
        if (st === 'cancelled' || st === 'delivered') {
          toast({
            variant: 'destructive',
            title: t('common.error'),
            description: t('web_orders.import_blocked_status'),
          });
          return;
        }
        const lines = Array.isArray(order.items) ? order.items : [];
        if (lines.length === 0) {
          toast({
            variant: 'destructive',
            title: t('common.error'),
            description: t('web_orders.import_empty_lines'),
          });
          return;
        }

        const built: CartItem[] = [];
        const skipped: string[] = [];
        let stockClamped = 0;

        for (const line of lines) {
          const pid = String(line.product_id ?? '');
          if (!pid) continue;
          const rawProduct = await getProductById(pid);
          if (!rawProduct) {
            skipped.push(pid);
            continue;
          }
          const product = await resolveProductForCart(rawProduct as Product);
          const qtyRaw = Number(line.quantity || 0) || 0;
          const { saleUnit: resolvedUnit, ratio_to_base, sale_price } = getSaleUnitConfig(product);
          let validQty = clampQuantityForUnit(qtyRaw, resolvedUnit);
          const maxAllowed = getMaxSaleQty(product, ratio_to_base, resolvedUnit);
          if (maxAllowed > 0 && validQty > maxAllowed) {
            validQty = maxAllowed;
            stockClamped += 1;
          }
          if (validQty <= 0) {
            skipped.push(pid);
            continue;
          }

          const locked = Number(line.price_at_order ?? 0) || 0;
          const qtyBase = toBaseQty(validQty, ratio_to_base);
          let unitPrice = locked;
          let priceTier: CartItem['price_tier'] = 'retail';
          let priceSource: CartItem['price_source'] = 'manual';
          let overridden = locked > 0;

          if (!overridden) {
            const priced = getLinePricing(product, qtyBase, selectedCustomer, sale_price, ratio_to_base, resolvedUnit);
            unitPrice = priced.unitPrice;
            priceTier = priced.priceTier as CartItem['price_tier'];
            priceSource = 'tier';
          }

          const subtotal = unitPrice * validQty;
          built.push({
            product,
            quantity: validQty,
            sale_unit: resolvedUnit,
            qty_sale: validQty,
            qty_base: qtyBase,
            ratio_to_base,
            unit_price: unitPrice,
            price_tier: priceTier,
            price_source: priceSource,
            is_price_overridden: overridden,
            discount_amount: 0,
            subtotal,
            total: subtotal,
          });
        }

        if (built.length === 0) {
          toast({
            variant: 'destructive',
            title: t('common.error'),
            description: t('web_orders.import_no_products'),
          });
          return;
        }

        setCart(built);
        setDiscount({ type: 'amount', value: '' });
        setPromoCodeInput('');
        setLoyaltyRedeemPoints(0);
        setSelectedCartIndex(0);

        toast({
          title: t('web_orders.import_success'),
          description: t('web_orders.import_lines_loaded', { n: built.length }),
          className: 'bg-green-50 border-green-200',
        });
        if (skipped.length > 0) {
          toast({
            variant: 'destructive',
            title: t('web_orders.import_partial'),
            description: t('web_orders.import_skipped_ids', { ids: skipped.slice(0, 8).join(', ') }),
          });
        }
        if (stockClamped > 0) {
          toast({
            title: t('web_orders.import_stock_clamped_title'),
            description: t('web_orders.import_stock_clamped_desc', { n: stockClamped }),
          });
        }

        if (api.webOrders?.updateStatus && (st === 'new' || st === 'paid')) {
          try {
            await handleIpcResponse(api.webOrders.updateStatus(webOrderId, 'processing'));
          } catch {
            /* Holatni yangilab bo‘lmasa ham savat importi muvaffaqiyatli */
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast({
          variant: 'destructive',
          title: t('web_orders.import_failed'),
          description: msg,
        });
      }
    },
    [
      exchangeReturnMode,
      toast,
      t,
      getSaleUnitConfig,
      resolveProductForCart,
      selectedCustomer,
      getLinePricing,
      clampQuantityForUnit,
      getMaxSaleQty,
      toBaseQty,
      getProductById,
    ],
  );

  useLayoutEffect(() => {
    const raw = (location.state as { importWebOrderId?: number } | null)?.importWebOrderId;
    if (raw == null || raw === undefined) return;
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) return;
    const token = `${location.key}:${id}`;
    if (webOrderImportProcessedRef.current === token) return;
    webOrderImportProcessedRef.current = token;
    navigate('/pos', { replace: true, state: {} });
    if (cartRef.current.length > 0) {
      setPendingWebOrderImportId(id);
      setImportWebOrderDialogOpen(true);
    } else {
      void importWebOrderIntoCart(id);
    }
  }, [location.state, location.key, navigate, importWebOrderIntoCart]);

  const handleConfirmWebOrderImport = () => {
    const id = pendingWebOrderImportId;
    if (id == null) return;
    setCart([]);
    setDiscount({ type: 'amount', value: '' });
    resetCustomerSelection();
    setPromoCodeInput('');
    setLoyaltyRedeemPoints(0);
    setImportWebOrderDialogOpen(false);
    setPendingWebOrderImportId(null);
    void importWebOrderIntoCart(id);
  };

  const handleCancelWebOrderImport = () => {
    setPendingWebOrderImportId(null);
    setImportWebOrderDialogOpen(false);
  };

  const updateQuantity = (
    productId: string,
    quantity: number,
    opts?: { moveToTop?: boolean; highlight?: boolean }
  ) => {
    if (quantity === 0) {
      removeFromCart(productId);
      return;
    }

    const cartItem = cart.find((item) => item.product.id === productId);
    if (!cartItem) return;

    const saleUnit = cartItem.sale_unit || cartItem.product.unit;
    const ratioToBase = Number(cartItem.ratio_to_base ?? 1) || 1;
    let validQuantity = clampSignedQuantityForUnit(quantity, saleUnit);

    if (validQuantity > 0) {
      const maxAllowed = getMaxSaleQty(cartItem.product, ratioToBase, saleUnit);
      if (maxAllowed > 0 && validQuantity > maxAllowed) {
        validQuantity = maxAllowed;
        toast({
          title: 'Stock Limit Reached',
          description: `Maximum available quantity is ${formatQuantity(maxAllowed, saleUnit)}`,
          variant: 'destructive',
        });
      }
    }
    
    if (opts?.highlight) {
      markRecentCartItem(productId);
    }
    if (opts?.moveToTop) {
      setSelectedCartIndex(0);
    }

    setCart((prev) => {
      const next = prev.map((item) => {
        if (item.product.id === productId) {
          const qtyBase = toBaseQty(validQuantity, ratioToBase);
          if (item.is_price_overridden || item.price_source === 'manual') {
            const unitPrice = Number(item.unit_price || 0) || 0;
            const subtotal = unitPrice * validQuantity;
            let lineDiscount = validQuantity < 0 ? 0 : item.discount_amount;

            if (validQuantity > 0 && lineDiscount > subtotal) {
              lineDiscount = subtotal;
              toast({
                title: 'Discount Adjusted',
                description: `Line discount reduced to ${formatMoneyUZS(lineDiscount)} (cannot exceed line subtotal)`,
              });
            }

            return {
              ...item,
              quantity: validQuantity,
              qty_sale: validQuantity,
              qty_base: qtyBase,
              unit_price: unitPrice,
              subtotal,
              discount_amount: lineDiscount,
              total: subtotal - lineDiscount,
            };
          }
          const { sale_price: baseUnitPriceRaw } = getSaleUnitConfig(item.product, item.sale_unit);
          const baseUnitPrice =
            Number(baseUnitPriceRaw ?? (item.product as any)?.sale_price ?? item.unit_price ?? 0) || 0;
          const { unitPrice, priceTier } = getLinePricing(
            item.product,
            qtyBase,
            selectedCustomer,
            baseUnitPrice,
            ratioToBase,
            item.sale_unit
          );
          const subtotal = unitPrice * validQuantity;
          let lineDiscount = validQuantity < 0 ? 0 : item.discount_amount;

          if (validQuantity > 0 && lineDiscount > subtotal) {
            lineDiscount = subtotal;
            toast({
              title: 'Discount Adjusted',
              description: `Line discount reduced to ${formatMoneyUZS(lineDiscount)} (cannot exceed line subtotal)`,
            });
          }
          
          return {
            ...item,
            quantity: validQuantity,
            qty_sale: validQuantity,
            qty_base: qtyBase,
            unit_price: unitPrice,
            price_tier: priceTier,
            subtotal,
            discount_amount: lineDiscount,
            total: subtotal - lineDiscount,
          };
        }
        return item;
      });

      if (opts?.moveToTop) {
        const idx = next.findIndex((item) => item.product.id === productId);
        if (idx > 0) {
          const [moved] = next.splice(idx, 1);
          return [moved, ...next];
        }
      }
      return next;
    });
  };

  const handleQuantityInputChange = (productId: string, value: string) => {
    const cartItem = cart.find(item => item.product.id === productId);
    const unit = cartItem?.sale_unit || cartItem?.product.unit;
    const stringValue = normalizeQuantityInput(value || '');
    
    if (!isValidQuantityInput(stringValue, unit)) {
      return;
    }
    
    // Store the value in editing state (allow empty string while typing)
    setEditingQuantity({ ...editingQuantity, [productId]: stringValue });
    
    if (stringValue !== '' && cartItem) {
      const numValue = Number(stringValue);
      const min = getQuantityMin(unit);
      const curQ = Number(cartItem.qty_sale ?? cartItem.quantity ?? 0) || 0;
      const okSigned =
        !isNaN(numValue) &&
        ((curQ >= 0 && numValue >= min) || (curQ < 0 && numValue <= -min));
      if (okSigned && cartItem.quantity !== numValue) {
        updateQuantity(productId, numValue);
      }
    }
  };

  const handleQuantityInputBlur = (productId: string) => {
    const value = normalizeQuantityInput(editingQuantity[productId] || '');
    const cartItem = cart.find(item => item.product.id === productId);
    
    if (!cartItem) return;
    
    const unit = cartItem.sale_unit || cartItem.product.unit;
    const min = getQuantityMin(unit);
    const curQty = Number(cartItem.qty_sale ?? cartItem.quantity ?? 0) || 0;
    const fallbackQty = curQty < 0 ? -min : min;

    if (!value || value.trim() === '' || Number(value) === 0) {
      updateQuantity(productId, fallbackQty);
      const newEditingQuantity = { ...editingQuantity };
      delete newEditingQuantity[productId];
      setEditingQuantity(newEditingQuantity);
      return;
    }

    const parsedValue = Number(value);

    if (
      isNaN(parsedValue) ||
      (curQty >= 0 && parsedValue < min) ||
      (curQty < 0 && parsedValue > -min)
    ) {
      updateQuantity(productId, fallbackQty);
      const newEditingQuantity = { ...editingQuantity };
      delete newEditingQuantity[productId];
      setEditingQuantity(newEditingQuantity);
      return;
    }

    updateQuantity(productId, clampSignedQuantityForUnit(parsedValue, unit));
    
    // Clear editing state
    const newEditingQuantity = { ...editingQuantity };
    delete newEditingQuantity[productId];
    setEditingQuantity(newEditingQuantity);
  };

  const handleQuantityInputKeyDown = (_productId: string, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const openQuantityNumpad = (productId: string, currentQuantity: number, maxStock: number) => {
    const cartItem = cart.find(item => item.product.id === productId);
    const unit = cartItem?.sale_unit || cartItem?.product.unit;
    const ratioToBase = Number(cartItem?.ratio_to_base ?? 1) || 1;
    const maxAllowed =
      currentQuantity > 0 && maxStock > 0
        ? getMaxSaleQty(cartItem?.product as any, ratioToBase, unit)
        : undefined;
    setNumpadConfig({
      type: 'quantity',
      productId,
      initialValue: currentQuantity,
      max: maxAllowed,
      unit,
      sale_unit: unit,
      ratio_to_base: ratioToBase,
    });
    setNumpadOpen(true);
  };

  const openDiscountNumpad = (productId: string, currentDiscount: number, maxDiscount: number) => {
    setNumpadConfig({
      type: 'discount',
      productId,
      initialValue: currentDiscount,
      max: maxDiscount,
    });
    setNumpadOpen(true);
  };

  const handleNumpadApply = (value: number) => {
    if (!numpadConfig) return;
    
    // Force type conversion: explicitly convert to number using Number()
    const numValue = Number(value);
    
    // Validate: Only show error if value is actually invalid
    if (isNaN(numValue) || !isFinite(numValue)) {
      toast({
        title: 'Invalid Value',
        description: 'Please enter a valid number',
        variant: 'destructive',
      });
      setNumpadConfig(null);
      return;
    }
    
    if (numpadConfig.type === 'quantity' && numpadConfig.productId) {
      const unit = numpadConfig.unit;
      const min = getQuantityMin(unit);
      const validQuantity = clampSignedQuantityForUnit(numValue, unit);

      if (validQuantity > 0 && validQuantity !== numValue && numValue < min) {
        toast({
          title: 'Miqdor tuzatildi',
          description: `Miqdor kamida ${formatQuantity(min, unit)} bo'lishi kerak. ${formatQuantity(validQuantity, unit)} ga o'rnatildi`,
        });
      }
      updateQuantity(numpadConfig.productId, validQuantity);
    } else if (numpadConfig.type === 'add_quantity' && numpadConfig.product) {
      const unit = numpadConfig.unit;
      const ratio = Number(numpadConfig.ratio_to_base ?? 1) || 1;
      const refP = Number(numpadConfig.refUnitPrice) || 0;
      const byAmount =
        weightedCartAddMode === 'amount_uzs' && unit && isFractionalUnit(unit) && refP > 0;

      if (byAmount) {
        const uzs = Math.floor(numValue);
        if (!Number.isFinite(uzs) || uzs <= 0) {
          toast({
            title: 'Noto‘g‘ri summa',
            description: '0 dan katta butun so‘m kiriting',
            variant: 'destructive',
          });
          setNumpadConfig(null);
          return;
        }
        const rawQty = uzs / refP;
        let validQuantity = clampQuantityForUnit(rawQty, unit);
        const maxAllowed = getMaxSaleQty(numpadConfig.product, ratio, unit);
        if (maxAllowed > 0 && validQuantity > maxAllowed) {
          validQuantity = maxAllowed;
          toast({
            title: 'Ombor',
            description: `Maksimal ${formatQuantity(maxAllowed, unit)} ${unit}`,
            variant: 'destructive',
          });
        }
        const qMin = getQuantityMin(unit);
        if (validQuantity < qMin) {
          toast({
            title: 'Juda kichik summa',
            description: `Kamida ~${formatMoneyUZS(Math.ceil(qMin * refP))} so‘m kerak`,
            variant: 'destructive',
          });
          setNumpadConfig(null);
          return;
        }
        void addToCart(numpadConfig.product, validQuantity, numpadConfig.sale_unit);
      } else {
        const min = getQuantityMin(unit);
        const validQuantity = clampQuantityForUnit(numValue, unit);
        if (validQuantity !== numValue && numValue < min) {
          toast({
            title: 'Miqdor tuzatildi',
            description: `Miqdor kamida ${formatQuantity(min, unit)} bo'lishi kerak. ${formatQuantity(validQuantity, unit)} ga o'rnatildi`,
          });
        }
        void addToCart(numpadConfig.product, validQuantity, numpadConfig.sale_unit);
      }
    } else if (numpadConfig.type === 'discount' && numpadConfig.productId) {
      // Ensure discount is not negative
      const validDiscount = Math.max(0, numValue);
      // Only show message if discount was adjusted
      if (validDiscount !== numValue && numValue < 0) {
        toast({
          title: 'Discount Adjusted',
          description: 'Discount cannot be negative. Set to 0',
        });
      }
      updateLineDiscount(numpadConfig.productId, validDiscount);
    }
    
    setNumpadConfig(null);
  };

  const updateLineDiscount = (productId: string, discountAmount: number) => {
    setCart(
      cart.map((item) => {
        if (item.product.id === productId) {
          let validDiscount = discountAmount;

          if (item.subtotal < 0) {
            validDiscount = 0;
          }

          // Validate: cannot be negative
          if (validDiscount < 0) {
            validDiscount = 0;
            toast({
              title: 'Invalid Discount',
              description: 'Discount cannot be negative',
              variant: 'destructive',
            });
          }

          // Validate: cannot exceed line subtotal
          if (item.subtotal >= 0 && validDiscount > item.subtotal) {
            validDiscount = item.subtotal;
            toast({
              title: 'Discount Adjusted',
              description: `Maximum discount is ${formatMoneyUZS(item.subtotal)} (line subtotal)`,
            });
          }
          
          return {
            ...item,
            discount_amount: validDiscount,
            total: item.subtotal - validDiscount,
          };
        }
        return item;
      })
    );
  };

  const updateSaleUnit = async (productId: string, nextUnit: string) => {
    const cartItem = cart.find((item) => item.product.id === productId);
    if (!cartItem) return;
    const nextConfig = getSaleUnitConfig(cartItem.product, nextUnit);
    const qtySale = Number(cartItem.qty_sale ?? cartItem.quantity ?? 0) || 0;
    const qtyBase = toBaseQty(qtySale, nextConfig.ratio_to_base);
    const effectiveTier = ((selectedCustomer as any)?.pricing_tier || currentTierCode || 'retail') as string;
    if (effectiveTier !== 'retail' && effectiveTier !== 'master') {
      const fetched = await fetchTierPrice(cartItem.product, effectiveTier, nextUnit);
      if (fetched == null) {
        toast({
          title: 'Narx topilmadi',
          description: `Tier: ${effectiveTier} (${nextUnit})`,
          variant: 'destructive',
        });
        return;
      }
    }
    const { unitPrice, priceTier } = getLinePricing(
      cartItem.product,
      qtyBase,
      selectedCustomer,
      nextConfig.sale_price,
      nextConfig.ratio_to_base,
      nextUnit
    );
    const subtotal = unitPrice * qtySale;
    const lineDiscount = qtySale < 0 ? 0 : Math.min(cartItem.discount_amount || 0, subtotal);
    setCart(
      cart.map((item) =>
        item.product.id === productId
          ? {
              ...item,
              sale_unit: nextConfig.saleUnit,
              ratio_to_base: nextConfig.ratio_to_base,
              qty_sale: qtySale,
              qty_base: qtyBase,
              unit_price: unitPrice,
              price_tier: priceTier,
              price_source: 'tier',
              is_price_overridden: false,
              subtotal,
              discount_amount: lineDiscount,
              total: subtotal - lineDiscount,
            }
          : item
      )
    );
  };

  const applyManualLinePrice = (productId: string, priceUzs: number | null) => {
    if (priceUzs === null || !Number.isFinite(priceUzs) || priceUzs < 0) {
      toast({
        title: t('common.error'),
        description: t('pos.manual_price_invalid'),
        variant: 'destructive',
      });
      return;
    }
    setCart((prev) =>
      prev.map((item) => {
        if (item.product.id !== productId) return item;
        const qtySale = Number(item.qty_sale ?? item.quantity ?? 0) || 0;
        const subtotal = priceUzs * qtySale;
        const lineDiscount =
          qtySale < 0 ? 0 : Math.min(item.discount_amount || 0, Math.max(0, subtotal));
        return {
          ...item,
          unit_price: priceUzs,
          is_price_overridden: true,
          price_source: 'manual',
          price_tier: 'retail',
          subtotal,
          discount_amount: lineDiscount,
          total: subtotal - lineDiscount,
        };
      })
    );
    setManualPricePopoverProductId(null);
  };

  const resetLineToAutoPrice = async (productId: string) => {
    const cartItem = cart.find((item) => item.product.id === productId);
    if (!cartItem) return;
    const qtySale = Number(cartItem.qty_sale ?? cartItem.quantity ?? 0) || 0;
    const ratioToBase = Number(cartItem.ratio_to_base ?? 1) || 1;
    const qtyBase = Number(cartItem.qty_base ?? 0) || toBaseQty(qtySale, ratioToBase);
    const saleUnit = cartItem.sale_unit || cartItem.product.unit;
    const { sale_price } = getSaleUnitConfig(cartItem.product, saleUnit);
    const effectiveTier = ((selectedCustomer as any)?.pricing_tier || currentTierCode || 'retail') as string;
    if (effectiveTier !== 'retail' && effectiveTier !== 'master') {
      const fetched = await fetchTierPrice(cartItem.product, effectiveTier, saleUnit);
      if (fetched == null) {
        toast({
          title: 'Narx topilmadi',
          description: `Tier: ${effectiveTier} (${saleUnit})`,
          variant: 'destructive',
        });
        return;
      }
    }
    const { unitPrice, priceTier } = getLinePricing(
      cartItem.product,
      qtyBase,
      selectedCustomer,
      sale_price,
      ratioToBase,
      saleUnit
    );
    const subtotal = unitPrice * qtySale;
    const lineDiscount = qtySale < 0 ? 0 : Math.min(cartItem.discount_amount || 0, subtotal);
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId
          ? {
              ...item,
              unit_price: unitPrice,
              price_tier: priceTier,
              price_source: 'tier',
              is_price_overridden: false,
              subtotal,
              discount_amount: lineDiscount,
              total: subtotal - lineDiscount,
            }
          : item
      )
    );
    setManualPricePopoverProductId(null);
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter((item) => item.product.id !== productId));
  };

  // Use unified money formatter
  const formatCurrency = (value: number): string => formatMoneyUZS(value);

  const sanitizeDiscountInput = (raw: string) => {
    const normalized = raw.replace(/,/g, '.').replace(/[^\d.]/g, '');
    if (normalized === '') return '';
    const [integerPart, ...decimalParts] = normalized.split('.');
    const decimalPart = decimalParts.join('');
    const merged = decimalParts.length > 0 ? `${integerPart}.${decimalPart}` : integerPart;
    if (merged.startsWith('.')) return `0${merged}`;
    return merged;
  };

  const hasReturnLine = useMemo(
    () =>
      effectiveCart.some((it) => (Number(it.qty_sale ?? it.quantity ?? 0) || 0) < 0),
    [effectiveCart]
  );

  const cartTotals = useMemo(() => {
    const subtotal = effectiveCart.reduce((sum, item) => sum + item.subtotal, 0);
    const lineDiscountsTotal = effectiveCart.reduce((sum, item) => sum + item.discount_amount, 0);
    const ustaSavings = effectiveCart.reduce((sum, item) => {
      if (!item.price_tier || item.price_tier === 'retail') return sum;
      const qty = Number(item.qty_sale ?? item.quantity ?? 0) || 0;
      if (qty <= 0) return sum;
      const { sale_price: baseUnitPriceRaw } = getSaleUnitConfig(item.product, item.sale_unit);
      const baseUnitPrice =
        Number(baseUnitPriceRaw ?? (item.product as any)?.sale_price ?? item.unit_price ?? 0) || 0;
      const diff = baseUnitPrice - Number(item.unit_price || 0);
      if (diff <= 0) return sum;
      return sum + diff * qty;
    }, 0);
    return { subtotal, lineDiscountsTotal, ustaSavings };
  }, [effectiveCart]);

  const { subtotal, lineDiscountsTotal, ustaSavings } = cartTotals;

  const parsedDiscountValue = useMemo(() => {
    if (discount.value.trim() === '') return null;
    const parsed = Number(discount.value);
    return Number.isFinite(parsed) ? parsed : null;
  }, [discount.value]);

  const maxDiscountAmount = hasReturnLine ? 0 : Math.max(0, subtotal - lineDiscountsTotal);

  const discountError = useMemo(() => {
    if (hasReturnLine && discount.type !== 'promo' && discount.value.trim() !== '') {
      return t('pos.exchange.discount_blocked');
    }
    if (discount.type === 'promo') return '';
    if (discount.value === '') return '';
    if (parsedDiscountValue === null) return 'Chegirma faqat raqam bo‘lishi kerak';
    if (parsedDiscountValue <= 0) return 'Chegirma 0 dan katta bo‘lishi kerak';
    if (discount.type === 'percent' && parsedDiscountValue > 100) {
      return 'Chegirma 100% dan oshmasligi kerak';
    }
    if (discount.type === 'amount' && parsedDiscountValue > maxDiscountAmount) {
      return `Chegirma ${formatCurrency(maxDiscountAmount)} dan oshmasligi kerak`;
    }
    return '';
  }, [t, discount.value, parsedDiscountValue, discount.type, maxDiscountAmount, hasReturnLine]);

  const isDiscountActionDisabled =
    discount.type !== 'promo' && discount.value !== '' && discountError !== '';
  const discountActionDisabledReason = isDiscountActionDisabled ? discountError : '';
  const discountValueNumber =
    discount.type === 'promo'
      ? 0
      : !discountError && parsedDiscountValue !== null
        ? parsedDiscountValue
        : 0;

  const handleHoldOrder = useCallback(async () => {
    if (!profile || !currentShift) {
      toast({
        title: 'Error',
        description: 'Please open a shift first',
        variant: 'destructive',
      });
      return;
    }

    if (cart.length === 0) {
      toast({
        title: 'Xatolik',
        description: 'Savatcha bo\'sh. Buyurtmani saqlash uchun mahsulot qo\'shing',
        variant: 'destructive',
      });
      return;
    }

    try {
      const heldNumber = await generateHeldNumber();
      const displayName = selectedCustomer?.name?.trim() || null;

      await saveHeldOrder({
        held_number: heldNumber,
        cashier_id: profile.id,
        shift_id: currentShift?.id || null,
        customer_id: selectedCustomer?.id || null,
        customer_name: displayName,
        items: cart,
        discount:
          discount.type !== 'promo' && discountValueNumber > 0
            ? { type: discount.type as 'amount' | 'percent', value: discountValueNumber }
            : null,
        note: null,
      });

      toast({
        title: '✅ Buyurtma saqlandi!',
        description: `${heldNumber} — kutish ro'yxatiga qo'shildi`,
        className: 'bg-green-50 border-green-200',
      });

      setCart([]);
      setDiscount({ type: 'amount', value: '' });
      setPromoCodeInput('');
      resetCustomerSelection();
      loadHeldOrders();
    } catch (error) {
      console.error('Error holding order:', error);
      toast({
        title: t('common.error'),
        description: t('pos.hold_order_failed'),
        variant: 'destructive',
      });
    }
  }, [
    profile,
    currentShift,
    cart,
    selectedCustomer,
    discount.type,
    discountValueNumber,
    loadHeldOrders,
    resetCustomerSelection,
    toast,
    t,
  ]);
  handleHoldOrderShortcutRef.current = handleHoldOrder;

  // Memoize totals calculation to prevent recalculation on every render
  const totals = useMemo(() => {
    let globalDiscountAmount = 0;
    if (!hasReturnLine) {
      if (discount.type === 'promo') {
        globalDiscountAmount = 0;
      } else if (discount.type === 'amount') {
        globalDiscountAmount = discountValueNumber;
      } else {
        const subtotalAfterLineDiscounts = Math.max(0, subtotal - lineDiscountsTotal);
        globalDiscountAmount = (subtotalAfterLineDiscounts * discountValueNumber) / 100;
      }
    }

    const totalDiscountAmount = lineDiscountsTotal + globalDiscountAmount;
    const baseAfterStandardDiscounts = subtotal - totalDiscountAmount;

    const { redeemEnabled, redeemUzsPerPt, maxPct, minRedeemPts } = loyaltyCfg;
    let loyaltyRedeemPointsApplied = 0;
    let loyaltyDiscountUzs = 0;

    if (
      !hasReturnLine &&
      baseAfterStandardDiscounts > 0 &&
      redeemEnabled &&
      selectedCustomer &&
      !isWalkInCustomer(selectedCustomer) &&
      isElectron()
    ) {
      const raw = Math.floor(Number(loyaltyRedeemPoints) || 0);
      const custPts = Math.floor(Number(selectedCustomer.bonus_points) || 0);
      const maxUzsFromPct = baseAfterStandardDiscounts * (maxPct / 100);
      const maxPtsFromPct = redeemUzsPerPt > 0 ? Math.floor(maxUzsFromPct / redeemUzsPerPt) : 0;
      const maxRedeem = Math.min(custPts, maxPtsFromPct);
      if (raw > 0 && raw >= minRedeemPts) {
        loyaltyRedeemPointsApplied = Math.min(raw, maxRedeem);
        loyaltyDiscountUzs = loyaltyRedeemPointsApplied * redeemUzsPerPt;
      }
    }

    const total = baseAfterStandardDiscounts - loyaltyDiscountUzs;

    return {
      subtotal,
      lineDiscountsTotal,
      globalDiscountAmount,
      preLoyaltyDiscountAmount: totalDiscountAmount,
      loyaltyRedeemPointsApplied,
      loyaltyDiscountUzs,
      discountAmount: totalDiscountAmount + loyaltyDiscountUzs,
      total,
    };
  }, [
    discount.type,
    discountValueNumber,
    subtotal,
    lineDiscountsTotal,
    loyaltyCfg,
    loyaltyRedeemPoints,
    selectedCustomer,
    isWalkInCustomer,
    hasReturnLine,
  ]);

  const priorDebtUzs = useMemo(() => {
    if (!selectedCustomer || isWalkInCustomer(selectedCustomer)) return 0;
    return getCustomerDebtAmount(selectedCustomer.balance);
  }, [selectedCustomer, getCustomerDebtAmount, isWalkInCustomer]);

  const buildOrderItemsSnapshot = useCallback(
    (items: CartItem[], globalDiscountAmount: number): Omit<OrderItem, 'id' | 'order_id'>[] => {
      const lineNetTotals = items.map(
        (item) => Number(item.subtotal || 0) - Number(item.discount_amount || 0)
      );
      const positiveSum = lineNetTotals.reduce((sum, v) => sum + Math.max(0, v), 0);

      return items.map((item, index) => {
        const qtySale = Number(item.qty_sale ?? item.quantity ?? 0) || 0;
        const ratioToBase = Number(item.ratio_to_base ?? 1) || 1;
        const { sale_price: baseUnitPriceRaw } = getSaleUnitConfig(item.product, item.sale_unit);
        const baseUnitPrice = Number(baseUnitPriceRaw ?? (item.product as any)?.sale_price ?? item.unit_price ?? 0) || 0;
        const masterBasePrice = Number((item.product as any)?.master_price ?? 0) || 0;
        const ustaUnitPrice = masterBasePrice > 0 ? masterBasePrice * ratioToBase : null;
        const priceSource =
          item.price_source ||
          (item.price_tier === 'master' ? 'usta' : item.price_tier === 'retail' ? 'base' : 'tier');
        const lineNet = lineNetTotals[index] || 0;
        const orderShare =
          positiveSum > 0 && lineNet > 0 ? (lineNet / positiveSum) * globalDiscountAmount : 0;
        const finalLineTotal = lineNet - orderShare;
        const finalUnitPrice = qtySale !== 0 ? finalLineTotal / qtySale : Number(item.unit_price || 0);
        const totalDiscountLine = Number(item.discount_amount || 0) + orderShare;
        const perUnitDiscount = qtySale !== 0 ? totalDiscountLine / Math.abs(qtySale) : 0;

        return {
          product_id: item.product.id,
          product_name: item.product.name,
          quantity: item.qty_sale ?? item.quantity,
          sale_unit: item.sale_unit || item.product.unit,
          qty_sale: item.qty_sale ?? item.quantity,
          qty_base: item.qty_base ?? item.quantity,
          unit_price: Number(item.unit_price || 0),
          price_tier: item.price_tier || 'retail',
          base_price: baseUnitPrice,
          usta_price: priceSource === 'usta' ? ustaUnitPrice : null,
          discount_type: (perUnitDiscount > 0 ? 'fixed' : 'none') as const,
          discount_value: perUnitDiscount,
          final_unit_price: finalUnitPrice,
          final_total: finalLineTotal,
          price_source: priceSource as any,
          subtotal: item.subtotal,
          discount_amount: item.discount_amount,
          total: item.total,
          promotion_id: item.promotion_id ?? null,
        };
      });
    },
    [getSaleUnitConfig]
  );

  const handleCompletePayment = async (paymentMethod: PosCheckoutPaymentKind) => {
    // Validation
    if (!profile || !currentShift) {
      toast({
        title: 'Error',
        description: 'Please open a shift first',
        variant: 'destructive',
      });
      return;
    }

    if (cart.length === 0) {
      toast({
        title: 'Cannot Process Empty Cart',
        description: 'Please add items to the cart before completing the order.',
        variant: 'destructive',
      });
      return;
    }

    if (isDiscountActionDisabled) {
      toast({
        title: 'Chegirma noto‘g‘ri',
        description: discountActionDisabledReason || 'Chegirma qiymatini tekshiring',
        variant: 'destructive',
      });
      return;
    }

    const rawLoyaltyPts = Math.floor(Number(loyaltyRedeemPoints) || 0);
    if (loyaltyCfg.redeemEnabled && rawLoyaltyPts > 0) {
      if (isWalkInCustomer(selectedCustomer)) {
        toast({
          title: 'Ball ishlatish',
          description: 'Mehmon sotuvda ball ishlatish mumkin emas — mijozni tanlang.',
          variant: 'destructive',
        });
        return;
      }
      if (rawLoyaltyPts < loyaltyCfg.minRedeemPts) {
        toast({
          title: 'Ball ishlatish',
          description: `Minimal ${loyaltyCfg.minRedeemPts} ball ishlatish kerak.`,
          variant: 'destructive',
        });
        return;
      }
      if (rawLoyaltyPts > totals.loyaltyRedeemPointsApplied) {
        toast({
          title: 'Ball limiti',
          description: `Bu buyurtmada maksimal ${totals.loyaltyRedeemPointsApplied} ball ishlatish mumkin.`,
          variant: 'destructive',
        });
        return;
      }
    }

    // 1. Stock: faqat sotilayotgan (musbat) qatorlar
    for (const cartItem of cart) {
      const qtyBase = cartItem.qty_base ?? cartItem.quantity;
      if (qtyBase > 0 && qtyBase > cartItem.product.current_stock) {
        toast({
          title: 'Error',
          description: `Error: Not enough stock for ${cartItem.product.name}`,
          variant: 'destructive',
        });
        return;
      }
    }

    const {
      subtotal,
      discountAmount,
      total,
      loyaltyRedeemPointsApplied,
      globalDiscountAmount,
      loyaltyDiscountUzs,
    } = totals;

    // Prepare payment data based on method
    let orderPayments: { method: PaymentMethod; amount: number }[] = [];
    let paidAmount = 0;
    let changeAmount = 0;
    let creditAmountValue = 0;

    // Check if there's a credit payment in the payments array (from partial credit flow)
    const creditPayment = payments.find((p) => p.method === 'credit');
    if (creditPayment) {
      creditAmountValue = creditPayment.amount;
      orderPayments = payments.filter((p) => p.method !== 'credit');
    }

    const extraDebtDue =
      total > 0 && includePriorDebtInPayment && priorDebtUzs > 0 ? priorDebtUzs : 0;
    const merchandiseCashDue = Math.max(0, total - creditAmountValue);
    const amountDueWithDebt = merchandiseCashDue + extraDebtDue;

    if (total < 0) {
      if (paymentMethod !== POS_EXCHANGE_PAYOUT_METHOD) {
        toast({
          title: t('pos.process_payment'),
          description: t('pos.exchange.payment_need_refund'),
          variant: 'destructive',
        });
        return;
      }
      const payout = Math.abs(total);
      orderPayments = [{ method: POS_EXCHANGE_PAYOUT_METHOD as PaymentMethod, amount: payout }];
      paidAmount = 0;
      changeAmount = 0;
      creditAmountValue = 0;
    } else if (total === 0) {
      if (paymentMethod !== 'zero_settle') {
        toast({
          title: t('pos.process_payment'),
          description: t('pos.exchange.payment_need_zero'),
          variant: 'destructive',
        });
        return;
      }
      orderPayments = [];
      paidAmount = 0;
      changeAmount = 0;
      creditAmountValue = 0;
    } else if (paymentMethod === 'cash') {
      const cashAmount = cashReceived || 0;
      const requiredAmount = amountDueWithDebt;
      
      if (!cashAmount || cashAmount < requiredAmount) {
        toast({
          title: 'Insufficient Cash',
          description: `Cash received (${formatMoneyUZS(cashAmount)}) must be greater than or equal to required amount (${formatMoneyUZS(requiredAmount)})`,
          variant: 'destructive',
        });
        return;
      }
      orderPayments = [{ method: 'cash', amount: cashAmount }];
      paidAmount = cashAmount;
      changeAmount = cashAmount - requiredAmount;
    } else if (paymentMethod === 'card') {
      const requiredAmount = amountDueWithDebt;
      orderPayments = [{ method: 'card', amount: requiredAmount }];
      paidAmount = requiredAmount;
      changeAmount = 0;
    } else if (paymentMethod === 'qr') {
      const requiredAmount = amountDueWithDebt;
      orderPayments = [{ method: 'qr', amount: requiredAmount }];
      paidAmount = requiredAmount;
      changeAmount = 0;
    } else if (paymentMethod === 'mixed') {
      if (orderPayments.length === 0) {
        toast({
          title: 'No Payment Methods',
          description: 'Please add at least one payment method for mixed payment',
          variant: 'destructive',
        });
        return;
      }
      const totalPaid = orderPayments.reduce((sum, p) => sum + p.amount, 0);
      const requiredAmount = amountDueWithDebt;
      
      if (Math.abs(totalPaid - requiredAmount) > 0.01) {
        toast({
          title: 'Payment Mismatch',
          description: `Payment amounts do not match required amount. Paid: ${formatMoneyUZS(totalPaid)}, Required: ${formatMoneyUZS(requiredAmount)}`,
          variant: 'destructive',
        });
        return;
      }
      paidAmount = totalPaid;
      changeAmount = totalPaid - requiredAmount;
    } else {
      toast({
        title: t('pos.process_payment'),
        description: t('pos.exchange.payment_invalid_method'),
        variant: 'destructive',
      });
      return;
    }

    try {
      const checkoutStart = perfEnabled ? performance.now() : 0;
      const order = {
        order_number: '',
        customer_id: selectedCustomer?.id || null,
        cashier_id: profile.id,
        shift_id: currentShift?.id || null,
        price_tier_code: currentTierCode,
        subtotal,
        discount_amount: discountAmount,
        discount_percent: discount.type === 'percent' ? discountValueNumber : 0,
        tax_amount: 0,
        total_amount: total,
        paid_amount: paidAmount,
        credit_amount: creditAmountValue,
        change_amount: changeAmount,
        status: 'completed' as const,
        payment_status:
          total <= 0
            ? ('paid' as const)
            : creditAmountValue === total
              ? ('on_credit' as const)
              : creditAmountValue === 0
                ? ('paid' as const)
                : ('partially_paid' as const),
        notes: null,
        ...(loyaltyRedeemPointsApplied > 0 ? { loyalty_redeem_points: loyaltyRedeemPointsApplied } : {}),
      };

      const orderItems = buildOrderItemsSnapshot(effectiveCart, globalDiscountAmount + loyaltyDiscountUzs);

      const orderPaymentsData = orderPayments.map((payment) => ({
        payment_number: '',
        payment_method: payment.method,
        amount: payment.amount,
        reference_number: null,
        notes: null,
      }));

      // Call the atomic RPC function
      const created = (await createOrder(order, orderItems, orderPaymentsData)) as {
        order_number?: string;
        new_balance?: number;
      } | null;
      if (perfEnabled) {
        const ms = Math.round(performance.now() - checkoutStart);
        console.debug(`[POS PERF] checkout → ${ms}ms`);
      }
      const orderNumber = created?.order_number || order.order_number || 'ORD';

      // Invalidate dashboard queries
      invalidateDashboardQueries(queryClient);

      // Update shift totals (local): kirim / chiqim
      if (currentShift) {
        if (total > 0) addSale(total);
        else if (total < 0) addRefund({ amount: Math.abs(total) });
      }

      const movNow = new Date().toISOString();
      effectiveCart.forEach((item) => {
        const qb = item.qty_base ?? item.quantity;
        addMovement({
          id: `local-${Date.now()}-${item.product.id}-${Math.random().toString(36).slice(2, 9)}`,
          movement_number: `POS-MOV-${Date.now()}`,
          product_id: item.product.id,
          movement_type: qb < 0 ? 'return' : 'sale',
          quantity: -qb,
          before_quantity: 0,
          after_quantity: 0,
          reference_type: 'order',
          reference_id: null,
          reason:
            qb < 0
              ? `POS almashuv qaytarish - ${orderNumber}`
              : `POS sale - Order ${orderNumber}`,
          notes: null,
          created_by: profile?.id || null,
          created_at: movNow,
        });
      });

      // Success message based on payment type
      let successMessage = '';
      if (total < 0) {
        successMessage = t('pos.exchange.success_refund', {
          order: orderNumber,
          amount: formatMoneyUZS(Math.abs(total)),
        });
      } else if (total === 0) {
        successMessage = t('pos.exchange.success_zero', { order: orderNumber });
      } else if (creditAmountValue > 0 && creditAmountValue < total) {
        successMessage = `Order ${orderNumber} completed. ${formatMoneyUZS(creditAmountValue)} on credit, ${formatMoneyUZS(paidAmount)} paid.`;
        if (changeAmount > 0) {
          successMessage += ` Change: ${formatMoneyUZS(changeAmount)}`;
        }
      } else if (creditAmountValue === total) {
        successMessage = `Order ${orderNumber} completed ON CREDIT.`;
      } else {
        successMessage = changeAmount > 0 
          ? `Order ${orderNumber} completed. Change: ${formatMoneyUZS(changeAmount)}`
          : `Order ${orderNumber} completed successfully`;
      }

      const paymentMethodLabel =
        paymentMethod === 'cash'
          ? t('pos.cash')
          : paymentMethod === 'card'
            ? t('pos.card')
            : paymentMethod === 'qr'
              ? t('pos.qr_pay')
              : paymentMethod === 'mixed'
                ? t('pos.mixed')
                : paymentMethod === POS_EXCHANGE_PAYOUT_METHOD
                  ? t('pos.exchange.receipt_payment_refund')
                  : paymentMethod === 'zero_settle'
                    ? t('pos.exchange.receipt_payment_zero')
                    : paymentMethod === 'credit'
                      ? t('pos.credit')
                      : '—';
      
      // Prepare receipt data (flushSync so the hidden Receipt renders immediately before printing)
      const nextReceipt = {
        orderNumber,
        items: effectiveCart,
        customer: selectedCustomer,
        subtotal,
        discountAmount,
        total,
        paidAmount,
        changeAmount,
        paymentMethod: paymentMethodLabel,
        priceTierCode: currentTierCode,
        dateTime: formatOrderDateTime(new Date()),
        cashierName: profile?.full_name || profile?.username,
        customerTotalDebt: selectedCustomer
          ? getCustomerDebtAmount(
              created?.new_balance !== undefined
                ? created.new_balance
                : (selectedCustomer.balance || 0) - creditAmountValue
            )
          : 0,
      };
      setLastReceiptData(nextReceipt);

      // 3. Record Sale (Log to console)
      const saleRecord = {
        timestamp: new Date().toISOString(),
        orderNumber,
        totalAmount: total,
        itemsSold: effectiveCart.map(item => ({
          productName: item.product.name,
          quantity: item.qty_sale ?? item.quantity,
          sale_unit: item.sale_unit || item.product.unit,
          qty_base: item.qty_base ?? item.quantity,
          unitPrice: Number(item.unit_price || 0),
          total: item.total,
        })),
        paymentMethod,
        cashier: profile?.full_name || profile?.username,
      };
      console.log('Sale Record:', saleRecord);

      // 4. Update Local Product State (Stock Deduction) - BEFORE clearing cart
      // Store cart items for stock update (before cart is cleared)
      const cartItemsForStockUpdate = [...effectiveCart];
      
      // Clone the products arrays and update stock
      const updateProductsWithStockDeduction = (products: Product[]) => {
        const updatedProducts = products.map(product => {
          const cartItem = cartItemsForStockUpdate.find(item => item.product.id === product.id);
          if (cartItem) {
            const newStock = product.current_stock - (cartItem.qty_base ?? cartItem.quantity);
            return {
              ...product,
              current_stock: Math.max(0, newStock), // Ensure stock doesn't go negative
            };
          }
          return product;
        });
        return updatedProducts;
      };

      // Update allProducts state to reflect stock changes immediately
      setAllProducts(prevProducts => {
        const updated = updateProductsWithStockDeduction(prevProducts);
        return updated;
      });

      // Also update favoriteProducts if needed
      setFavoriteProducts(prevFavorites => updateProductsWithStockDeduction(prevFavorites));

      // Update searchResults if user is searching
      setSearchResults(prevResults => updateProductsWithStockDeduction(prevResults));

      toast({
        title: '✅ Sotuv amalga oshirildi!',
        description: successMessage,
        className: 'bg-green-50 border-green-200',
      });

      // 5. Cleanup - Clear cart and reset state (AFTER stock update)
      setCart([]);
      setExchangeReturnMode(false);
      setPayments([]);
      setDiscount({ type: 'amount', value: '' });
      setPromoCodeInput('');
      setLoyaltyRedeemPoints(0);
      resetCustomerSelection();
      setPaymentDialogOpen(false);
      setCashReceived(null);
      setCreditAmount('');
      setSelectedCartIndex(-1);

      // Har doim yangilash: qarz yopilganda ham balans eski qolmasin (credit/bonus shart emas)
      void loadCustomers();

      // Reload products from database after a delay to ensure sync (but don't overwrite immediate updates)
      setTimeout(() => {
        loadAllProducts();
      }, 500);

      // Receipt is printed manually from the "Chek" button after the sale is completed.
    } catch (error) {
      console.error('Order completion error:', error);
      
      let errorMessage = 'Buyurtmani yakunlashda xatolik. Qayta urinib ko\'ring.';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null) {
        errorMessage = (error as any).message || (error as any).error || JSON.stringify(error);
      }
      
      toast({
        title: '❌ Sotuv amalga oshmadi!',
        description: errorMessage,
        variant: 'destructive',
        duration: 10000,
      });
    }
  };

  const handleCreditSale = async () => {
    // Validation
    if (!profile || !currentShift) {
      toast({
        title: 'Error',
        description: 'Please open a shift first',
        variant: 'destructive',
      });
      return;
    }

    if (cart.length === 0) {
      toast({
        title: 'Cannot Process Empty Cart',
        description: 'Please add items to the cart before completing the order.',
        variant: 'destructive',
      });
      return;
    }

    if (hasReturnLine) {
      toast({
        title: t('pos.credit'),
        description: t('pos.exchange.credit_blocked_returns'),
        variant: 'destructive',
      });
      return;
    }

    if (totals.total <= 0) {
      toast({
        title: t('pos.credit'),
        description: t('pos.exchange.credit_blocked_total'),
        variant: 'destructive',
      });
      return;
    }

    // Check if customer is selected and not walk-in
    if (!selectedCustomer || selectedCustomer.id === 'none') {
      toast({
        title: 'Customer Required',
        description: 'Credit sales are only available for registered customers. Please select a customer.',
        variant: 'destructive',
      });
      return;
    }

    // Check if customer is active
    if (selectedCustomer.status !== 'active') {
      toast({
        title: 'Inactive Customer',
        description: 'Cannot sell on credit to inactive customers.',
        variant: 'destructive',
      });
      return;
    }

    if (isDiscountActionDisabled) {
      toast({
        title: 'Chegirma noto‘g‘ri',
        description: discountActionDisabledReason || 'Chegirma qiymatini tekshiring',
        variant: 'destructive',
      });
      return;
    }

    const rawLoyaltyPtsCr = Math.floor(Number(loyaltyRedeemPoints) || 0);
    if (loyaltyCfg.redeemEnabled && rawLoyaltyPtsCr > 0) {
      if (isWalkInCustomer(selectedCustomer)) {
        toast({
          title: 'Ball ishlatish',
          description: 'Mijoz tanlang.',
          variant: 'destructive',
        });
        return;
      }
      if (rawLoyaltyPtsCr < loyaltyCfg.minRedeemPts) {
        toast({
          title: 'Ball ishlatish',
          description: `Minimal ${loyaltyCfg.minRedeemPts} ball.`,
          variant: 'destructive',
        });
        return;
      }
      if (rawLoyaltyPtsCr > totals.loyaltyRedeemPointsApplied) {
        toast({
          title: 'Ball limiti',
          description: `Maksimal ${totals.loyaltyRedeemPointsApplied} ball.`,
          variant: 'destructive',
        });
        return;
      }
    }

    const {
      subtotal,
      discountAmount,
      total,
      loyaltyRedeemPointsApplied,
      globalDiscountAmount,
      loyaltyDiscountUzs,
    } = totals;

    if (total <= 0) {
      toast({
        title: 'Invalid Order Total',
        description: 'Order total must be greater than zero',
        variant: 'destructive',
      });
      return;
    }

    // Boshlang'ich naqd P: istalgan miqdor (savat + qarzdan oshiq bo‘lsa — mijoz oldindan to‘lovga o‘tadi)
    const initialPayment = creditAmount.trim() === '' ? 0 : Number(creditAmount);
    if (!Number.isFinite(initialPayment) || initialPayment < 0) {
      toast({
        title: t('common.error'),
        description: t('pos.error_negative_payment'),
        variant: 'destructive',
      });
      return;
    }

    const priorAmt = includePriorDebtInPayment ? priorDebtUzs : 0;
    const toPrior = priorAmt > 0 ? Math.min(initialPayment, priorAmt) : 0;
    const orderCash = Math.max(0, initialPayment - toPrior);
    const merchCredit = Math.max(0, total - orderCash);
    const projectedBalance = (selectedCustomer.balance || 0) + initialPayment - total;

    if (selectedCustomer.credit_limit > 0 && projectedBalance < 0) {
      if (Math.abs(projectedBalance) > selectedCustomer.credit_limit) {
        toast({
          title: t('pos.credit_limit_exceeded_title'),
          description: `${t('pos.credit_limit_exceeded_desc')} ${formatCurrency(selectedCustomer.credit_limit)}. ${t('pos.new_debt_label')} ${formatCurrency(Math.abs(projectedBalance))}`,
          variant: 'destructive',
        });
        return;
      }
    }

    // Process credit sale (full or partial)
    try {
      const orderItems = buildOrderItemsSnapshot(effectiveCart, globalDiscountAmount + loyaltyDiscountUzs);

      let result: {
        success: boolean;
        order_number?: string;
        order_id?: string;
        new_balance?: number;
        error?: string;
      };

      if (toPrior > 0) {
        const rp = await receiveCustomerPayment({
          customer_id: selectedCustomer.id,
          amount: toPrior,
          operation: 'payment_in',
          payment_method: 'cash',
          notes: 'POS nasiya: oldingi qarzdan',
          received_by: profile.id,
          source: 'pos',
        });
        if (!rp.success) {
          throw new Error(rp.error || 'Oldingi qarzdan yechib bo‘lmadi');
        }
      }

      if (orderCash > 0) {
        const applyPrepaid = orderCash > total + 0.01;
        const order: Record<string, unknown> = {
          order_number: '',
          customer_id: selectedCustomer.id,
          cashier_id: profile.id,
          shift_id: currentShift?.id || null,
          price_tier_code: currentTierCode,
          subtotal,
          discount_amount: discountAmount,
          discount_percent: discount.type === 'percent' ? discountValueNumber : 0,
          tax_amount: 0,
          total_amount: total,
          paid_amount: orderCash,
          credit_amount: merchCredit,
          change_amount: 0,
          status: 'completed' as const,
          payment_status: (merchCredit > 0.01 ? 'partially_paid' : 'paid') as const,
          notes: null,
          apply_overpay_as_prepaid: applyPrepaid,
          ...(loyaltyRedeemPointsApplied > 0 ? { loyalty_redeem_points: loyaltyRedeemPointsApplied } : {}),
        };

        const orderPaymentsData = [
          {
            payment_number: '',
            payment_method: 'cash' as PaymentMethod,
            amount: orderCash,
            reference_number: null,
            notes: null,
          },
        ];

        const created = (await createOrder(order as any, orderItems, orderPaymentsData)) as {
          order_number?: string;
          new_balance?: number;
        } | null;

        invalidateDashboardQueries(queryClient);

        result = {
          success: true,
          order_number: created?.order_number || (order.order_number as string) || 'ORD',
          new_balance: created?.new_balance ?? projectedBalance,
        };
      } else {
        // Full credit sale - use createCreditOrder
        result = await createCreditOrder({
          customer_id: selectedCustomer.id,
          cashier_id: profile.id,
          shift_id: currentShift?.id || null,
          price_tier_code: currentTierCode,
          items: orderItems,
          subtotal,
          discount_amount: discountAmount,
          discount_percent: discount.type === 'percent' ? discountValueNumber : 0,
          tax_amount: 0,
          total_amount: total,
          notes: undefined,
          ...(loyaltyRedeemPointsApplied > 0 ? { loyalty_redeem_points: loyaltyRedeemPointsApplied } : {}),
        });
        
        // Invalidate dashboard queries
        invalidateDashboardQueries(queryClient);
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to create credit order');
      }

      // CRITICAL: Ensure we have order_number for receipt (backend may not return it in some edge cases)
      let orderNumber = result.order_number;
      if ((!orderNumber || orderNumber === '') && result.order_id) {
        try {
          const fullOrder = await getOrderById(result.order_id);
          orderNumber = fullOrder?.order_number ?? `ORD-${Date.now()}`;
        } catch {
          orderNumber = `ORD-${Date.now()}`;
        }
      }

      // Prepare receipt data for credit sale (flushSync so it renders before printing)
      const finalBal = result.new_balance ?? projectedBalance;
      const nextReceipt = {
        orderNumber: orderNumber || 'N/A',
        items: cart,
        customer: selectedCustomer,
        subtotal,
        discountAmount,
        total,
        paidAmount: initialPayment,
        changeAmount: 0,
        paymentMethod: initialPayment > 0 ? 'Mixed (Cash + Credit)' : 'Credit',
        priceTierCode: currentTierCode,
        dateTime: formatOrderDateTime(new Date()),
        cashierName: profile?.full_name || profile?.username,
        customerTotalDebt: getCustomerDebtAmount(finalBal),
      };
      setLastReceiptData(nextReceipt);

      const successMessage =
        initialPayment > 0
          ? t('pos.order_created_partial', { number: orderNumber }) +
            ` ${formatCurrency(initialPayment)}` +
            (merchCredit > 0.01
              ? `, ${t('pos.credit_amount_label')} ${formatCurrency(merchCredit)}. `
              : '. ') +
            `${t('pos.new_debt_label')} ` +
            (finalBal < 0
              ? `${formatCurrency(Math.abs(finalBal))} (qarz)`
              : finalBal > 0
                ? `${formatCurrency(finalBal)} (oldindan)`
                : `0`)
          : t('pos.order_created_credit', { number: orderNumber }) +
            ` ${
              finalBal < 0
                ? `${formatCurrency(Math.abs(finalBal))} (qarz)`
                : finalBal > 0
                  ? `${formatCurrency(finalBal)} (oldindan)`
                  : `0`
            }`;
      
      toast({
        title: `✅ ${t('pos.credit_written')}`,
        description: successMessage,
        className: 'bg-green-50 border-green-200',
      });

      const creditCustomerId = selectedCustomer.id;

      // Update customer balance in state immediately
      if (selectedCustomer) {
        const newBalance = result.new_balance ?? projectedBalance;
        const updatedCustomer = {
          ...selectedCustomer,
          balance: newBalance,
        };

        // Keep the customer list in sync, but don't carry the selection into the next sale.
        setCustomers(prevCustomers =>
          prevCustomers.map(c =>
            c.id === selectedCustomer.id ? updatedCustomer : c
          )
        );
      }

      // Clear cart and reset state so the next sale starts clean.
      setCart([]);
      setPayments([]);
      setDiscount({ type: 'amount', value: '' });
      setPromoCodeInput('');
      setLoyaltyRedeemPoints(0);
      resetCustomerSelection();
      setPaymentDialogOpen(false);
      setCashReceived(null);
      setCreditAmount('');
      setSelectedCartIndex(-1);

      // Refresh customer data to ensure sync
      void loadCustomers();
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', creditCustomerId] });

      // Receipt is printed manually from the "Chek" button after the credit sale is completed.
    } catch (error) {
      console.error('Credit sale error:', error);
      
      let errorMessage = 'Nasiyaga sotuvda xatolik. Qayta urinib ko\'ring.';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null) {
        errorMessage = (error as any).message || (error as any).error || JSON.stringify(error);
      }
      
      toast({
        title: '❌ Nasiyaga sotuv amalga oshmadi!',
        description: errorMessage,
        variant: 'destructive',
        duration: 10000,
      });
    }
  };


  // Use memoized totals
  const {
    globalDiscountAmount,
    discountAmount,
    total,
    loyaltyDiscountUzs,
    loyaltyRedeemPointsApplied,
  } = totals;

  const checkoutGrandTotal = useMemo(() => {
    if (total <= 0) return total;
    const extra =
      includePriorDebtInPayment && priorDebtUzs > 0 ? priorDebtUzs : 0;
    return total + extra;
  }, [total, includePriorDebtInPayment, priorDebtUzs]);

  // Memoize paid amount calculation
  const paidAmount = useMemo(() => {
    return payments.reduce((sum, p) => sum + p.amount, 0);
  }, [payments]);

  const remainingAmount = useMemo(() => {
    if (checkoutGrandTotal <= 0) return 0;
    return checkoutGrandTotal - paidAmount;
  }, [checkoutGrandTotal, paidAmount]);

  // Get products to display (search results or all products filtered by category)
  const displayProducts = useMemo(() => {
    if (searchResults.length > 0) return searchResults;
    if (selectedCategory) {
      return allProducts.filter((p) => p.category_id === selectedCategory);
    }
    return allProducts;
  }, [searchResults, allProducts, selectedCategory]);

  const MAX_DISPLAY = 300;
  const isTruncated = displayProducts.length > MAX_DISPLAY;
  const visibleProducts = isTruncated ? displayProducts.slice(0, MAX_DISPLAY) : displayProducts;

  // Show "No open shift" state if shift is not open
  if (!currentShift) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted">
            <Lock className="h-10 w-10 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">Kassa yopiq</h2>
            <p className="text-muted-foreground">
              To start selling, please open a new shift.
            </p>
          </div>
          <ShiftControl />
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Split View: flex-1 + min-h-0 — mahsulot va savat viewport bo‘yicha cho‘ziladi */}
      {/* Chap/yuqori/pastki: layout paddingini yutish; o‘ng tomonda padding yo‘q */}
      <div className="-mb-4 -ml-4 -mt-4 flex min-h-0 w-full min-w-0 max-w-none flex-1 flex-col self-stretch overflow-x-hidden xl:-mb-6 xl:-ml-6 xl:-mt-6">
        {/* xl: mahsulot | savat+rail — to‘liq kenglik */}
        <div className="flex min-h-0 min-w-0 w-full max-w-none flex-1 flex-col gap-2 pl-2 pt-2 pb-0 pr-0 sm:gap-3 md:gap-4 md:pl-3 md:pt-3 md:pb-0 md:pr-0 xl:flex-row xl:flex-nowrap xl:items-stretch xl:gap-0 xl:pl-3 xl:pt-3 xl:pb-0 xl:!pr-0">
          {/* Left Column - Product Catalog */}
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-white xl:w-0 xl:min-w-0 xl:shrink xl:grow-[1.45] xl:basis-0 xl:pr-3">
            {/* Shift Control - Left column only */}
            <div className="flex-shrink-0 border-b bg-white dark:bg-gray-900 p-2 md:p-3">
              <div className="flex items-center justify-between gap-2">
                <ShiftControl />
                <PosDeviceBar
                  onWeigh={(weightKg, unit) => {
                    const normalize = (v: unknown) => String(v ?? '').trim().toLowerCase();
                    const isKg = (tok: string) =>
                      tok === 'kg' || tok === 'кг' || tok.startsWith('kg') || tok.includes('kilogram') || tok.includes('килограмм');
                    const selected =
                      selectedCartIndex >= 0 && selectedCartIndex < cart.length
                        ? cart[selectedCartIndex]
                        : null;
                    if (!selected) return true;
                    const saleUnit = normalize(selected.sale_unit || selected.product.unit || selected.product.base_unit || '');
                    if (!isKg(saleUnit) && !isKg(normalize(unit))) return true;
                    const sign = Number(selected.qty_sale ?? selected.quantity ?? 1) < 0 ? -1 : 1;
                    updateQuantity(selected.product.id, sign * weightKg);
                    toast({
                      title: t('pos.device_bar.applied_title'),
                      description: `${selected.product.name}: ${weightKg.toFixed(3)} ${unit}`,
                    });
                    return false;
                  }}
                />
              </div>
            </div>
            {/* Search Header - Fixed Height */}
            <div className="flex-shrink-0 p-3 border-b bg-white dark:bg-gray-900">
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  placeholder={t('pos.search_placeholder')}
                  value={searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      // Prefer manual search add; fallback to barcode flow
                      if (searchResults.length > 0) {
                        requestAddToCart(searchResults[0]);
                        focusSearchInput();
                        return;
                      }
                      // Use the actual input value to avoid React state lag with fast scanners
                      const raw = (e.currentTarget as HTMLInputElement)?.value || '';
                      if (raw) handleBarcodeSearch(raw, { clearSearch: true });
                    }
                  }}
                  className={`pl-10 ${searchTerm ? 'pr-10' : ''} h-12 text-base font-medium`}
                  autoFocus
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm('');
                      setSearchResults([]);
                      setRecentPosSearches(getRecentSearches('pos'));
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              
              {/* Recent Searches - shown when input is empty */}
              {!searchTerm && recentPosSearches.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  <span className="text-xs text-muted-foreground shrink-0">Oxirgi:</span>
                  {recentPosSearches.slice(0, 6).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        handleSearch(s);
                        if (searchInputRef.current) searchInputRef.current.value = s;
                      }}
                      className="group flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted hover:bg-primary/10 text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                      <Clock className="h-3 w-3 shrink-0" />
                      {s}
                      <span
                        className="hidden group-hover:inline-flex items-center justify-center h-3 w-3 rounded-full hover:bg-destructive/20 hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRecentSearch('pos', s);
                          setRecentPosSearches(getRecentSearches('pos'));
                        }}
                      >
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Category Tabs - Horizontal Scrollable - Fixed Height */}
              {categories.length > 0 && (
                <div className="overflow-x-auto">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCategoryChange(null)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                        selectedCategory === null
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted hover:bg-muted/80'
                      }`}
                    >
                      {t('pos.all_categories')}
                    </button>
                    {categories.map((category) => (
                      <button
                        key={category.id}
                        onClick={() => handleCategoryChange(category.id)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                          selectedCategory === category.id
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted hover:bg-muted/80'
                        }`}
                      >
                        {category.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Product List - Scrollable - Takes Remaining Space */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {visibleProducts.length > 0 ? (
                <div className="w-full">
                  {/* Header Row */}
                  <div className="grid grid-cols-12 items-center gap-4 px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
                    <div className="col-span-6">
                      <span className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase">Mahsulot Nomi</span>
                    </div>
                    <div className="col-span-3 text-right">
                      <span className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase">Narxi</span>
                    </div>
                    <div className="col-span-3 text-right">
                      <span className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase">Ombor</span>
                    </div>
                    {isTruncated && (
                      <div className="col-span-12 text-[11px] text-muted-foreground pt-1">
                        {`Ko‘rsatilmoqda: ${MAX_DISPLAY} / ${displayProducts.length}. Qidiruvni toraytiring.`}
                      </div>
                    )}
                  </div>
                  
                  {/* Product Rows */}
                  <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {visibleProducts.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => {
                          requestAddToCart(product);
                          focusSearchInput();
                        }}
                        className="w-full grid grid-cols-12 items-center gap-4 p-3 border-b border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer transition-colors bg-white dark:bg-gray-800"
                      >
                        {/* Column 1: Product Name (Span 6) */}
                        <div className="col-span-6 text-left">
                          <div className="flex items-center gap-2">
                            <div className="h-10 w-10 rounded-lg bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
                              {product.image_url ? (
                                <img
                                  src={getProductImageDisplayUrl(product.image_url) || product.image_url}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <Package className="h-5 w-5 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm truncate">
                                  {searchTerm ? highlightMatch(product.name, searchTerm) : product.name}
                                </h3>
                                {hasPromoForProduct(product) && (
                                  <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-600 text-white">
                                    Aksiya
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-muted-foreground">
                                  SKU: {renderSkuWithHighlight(product.sku, searchTerm)}
                                </span>
                                <span className="text-xs text-muted-foreground">•</span>
                                <span className="text-xs text-muted-foreground">
                                  Birlik: {formatUnit(product.unit) || 'Dona'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        {/* Column 2: Price (Span 3) */}
                        <div className="col-span-3 text-right">
                          <p className="font-bold text-blue-600 dark:text-blue-400 text-sm">
                            {formatCurrency(Number(product.sale_price))}
                          </p>
                        </div>
                        
                        {/* Column 3: Stock (Span 3) */}
                        <div className="col-span-3 text-right">
                          <span className={`text-xs px-2 py-1 rounded ${
                            product.current_stock === 0
                              ? 'text-red-600 font-bold bg-red-50 dark:bg-red-900/30 dark:text-red-400'
                              : product.current_stock < 10
                              ? 'text-orange-500 font-medium'
                              : 'text-green-600'
                          }`}>
                            {product.current_stock}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground p-3">
                  <div className="text-center">
                    <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-base font-medium">{t('pos.no_products')}</p>
                    <p className="text-xs mt-1">{t('pos.try_searching')}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Savat + rail: kichik ekranda bitta karta; xl da ikki bolali wrapper (contents emas) — o‘ng chetga cho‘zilish barqaror */}
          <div className="flex min-h-[min(380px,42vh)] min-h-0 w-full min-w-0 flex-1 flex-row overflow-hidden rounded-xl border border-border bg-white xl:w-0 xl:min-h-0 xl:min-w-0 xl:shrink xl:grow xl:basis-0 xl:flex-row xl:items-stretch xl:overflow-visible xl:rounded-none xl:border-0 xl:bg-transparent">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-white xl:h-full xl:min-w-0 xl:shrink xl:grow xl:basis-0 xl:rounded-xl xl:rounded-r-none xl:border xl:border-r-0 xl:border-border">
            {/* Top Section - Header: Customer Selection/Search (Fixed) */}
            <div className="flex-shrink-0 border-b bg-white dark:bg-gray-900 p-2 space-y-1 md:p-3 md:space-y-2">
              <div className="space-y-1 md:space-y-2">
              <Label className="text-sm font-semibold">{t('pos.customer')}</Label>
              <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-2">
                <div className="min-w-0 flex-1">
                <Popover 
                  open={customerComboboxOpen} 
                  onOpenChange={(open) => {
                    setCustomerComboboxOpen(open);
                    if (!open) {
                      // Reset search when closing
                      setCustomerSearchTerm('');
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={customerComboboxOpen}
                      className="h-9 w-full min-w-0 justify-between"
                    >
                      {selectedCustomer 
                        ? `${selectedCustomer.name}${selectedCustomer.phone ? ` - ${selectedCustomer.phone}` : ''}`
                        : t('pos.select_customer')}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command 
                      shouldFilter={false} 
                      className="[&_[data-slot=command-input-wrapper]]:border-b [&_[data-slot=command-input-wrapper]]:border-border/40 [&_[data-slot=command-input-wrapper]]:bg-transparent [&_[data-slot=command-input-wrapper]_svg]:text-gray-400 [&_[data-slot=command-input-wrapper]_svg]:opacity-60"
                    >
                      <CommandInput 
                        placeholder={t('pos.search_customer')} 
                        value={customerSearchTerm}
                        onValueChange={setCustomerSearchTerm}
                        className="border-0 focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none bg-transparent shadow-none ring-0"
                      />
                      <CommandList>
                        <CommandEmpty>{t('pos.no_customer_found')}</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="walk-in"
                            onSelect={() => {
                              setSelectedCustomer(null);
                              setCustomerComboboxOpen(false);
                              setCustomerSearchTerm('');
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                !selectedCustomer ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {t('pos.walk_in_customer')}
                          </CommandItem>
                          {customers
                            .filter((customer) => {
                              if (!customerSearchTerm) return true;
                              const searchLower = customerSearchTerm.toLowerCase();
                              return (
                                customer.name.toLowerCase().includes(searchLower) ||
                                (customer.phone && customer.phone.toLowerCase().includes(searchLower)) ||
                                customer.id.toLowerCase().includes(searchLower)
                              );
                            })
                            .map((customer) => (
                              <CommandItem
                                key={customer.id}
                                value={`${customer.id}-${customer.name}-${customer.phone || ''}`}
                                onSelect={() => {
                                  setSelectedCustomer(customer);
                                  setCustomerComboboxOpen(false);
                                  setCustomerSearchTerm('');
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    selectedCustomer?.id === customer.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <span className="flex-1">
                                  <span className="font-medium">{customer.name}</span>
                                  {customer.phone && (
                                    <span className="text-muted-foreground"> - {customer.phone}</span>
                                  )}
                                  {customer.id && (
                                    <span className="text-xs text-muted-foreground ml-1">
                                      ({customer.id.slice(0, 8)})
                                    </span>
                                  )}
                                </span>
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                </div>
                <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                <Select
                  value={currentTierCode}
                  onValueChange={(value) => {
                    setCurrentTierCode(value as any);
                    toast({
                      title: 'Narx rejimi',
                      description: `Tanlangan tier: ${value}`,
                    });
                  }}
                >
                  <SelectTrigger className="h-9 w-full min-w-[9rem] sm:w-[9.5rem]">
                    <SelectValue placeholder="Narx turi" />
                  </SelectTrigger>
                  <SelectContent>
                    {(priceTiers.length > 0
                      ? priceTiers
                      : [
                          { code: 'retail', name: 'Retail' },
                          { code: 'master', name: 'Master/Usta' },
                          { code: 'wholesale', name: 'Wholesale' },
                          { code: 'marketplace', name: 'Marketplace' },
                        ]
                    ).map((tier) => (
                      <SelectItem key={tier.code} value={tier.code}>
                        {tier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <QuickCustomerCreate />
                </div>
              </div>
              {selectedCustomer && (
                <div className="pt-1">
                  <CustomerInfoBadge customer={selectedCustomer} />
                </div>
              )}
              {selectedCustomer &&
                priorDebtUzs > 0 &&
                !isWalkInCustomer(selectedCustomer) && (
                  <div className="flex items-start gap-2 pt-1.5">
                    <Checkbox
                      id="pos-include-prior-debt"
                      checked={includePriorDebtInPayment}
                      onCheckedChange={(v) => setIncludePriorDebtInPayment(v === true)}
                      className="mt-0.5"
                    />
                    <label
                      htmlFor="pos-include-prior-debt"
                      className="text-xs leading-snug cursor-pointer text-muted-foreground"
                    >
                      Oldingi qarzni ham ushbu to‘lovda yopish ({formatCurrency(priorDebtUzs)})
                    </label>
                  </div>
                )}
              {selectedCustomer && (selectedCustomer.balance || 0) < 0 && (
                <div className="pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setCustomerPaymentOpen(true)}
                    disabled={selectedCustomer.status !== 'active'}
                  >
                    <DollarSign className="h-4 w-4 mr-2" />
                    Qarz so'ndirish
                  </Button>
                </div>
              )}
              </div>
              
            </div>

            {/* Savat ro‘yxati (tezkor bar alohida grid ustuni) */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div className="z-10 flex shrink-0 flex-col gap-2 border-b bg-muted/30 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t('pos.exchange.cart_count', { count: cart.length })}
                    </span>
                  </div>
                  {exchangeReturnMode && (
                    <p className="rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      {t('pos.exchange.return_mode_banner')}
                    </p>
                  )}
                  {hasReturnLine && !exchangeReturnMode && (
                    <p className="text-[10px] text-muted-foreground">{t('pos.exchange.cart_hint_returns')}</p>
                  )}
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {cart.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center py-8 px-3 text-muted-foreground">
                  <div className="text-center max-w-[220px]">
                    <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">{t('pos.cart_empty')}</p>
                    <p className="text-xs mt-1">{t('pos.add_products')}</p>
                    {exchangeReturnMode && (
                      <p className="text-xs mt-3 text-amber-800 dark:text-amber-200 font-medium">
                        {t('pos.exchange.empty_cart_return_hint')}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-700 flex-1 min-h-0">
                {cartDisplay.map(({ item, index, isSelected, costPrice, isBelowCost, unit, baseUnit, quantityStep, quantityMin, inputMode, displayQuantity }) => {
                  const isRecent = item.product.id === recentCartItemId;
                  return (
                    <div key={item.product.id} className="relative">
                      {/* Main Row */}
                      <div
                        className={`flex items-center justify-between p-2 md:p-3 border-b border-gray-100 bg-white dark:bg-gray-800 last:border-0 transition-colors ${
                          isSelected ? 'bg-primary/5 border-primary' : ''
                        } ${isRecent ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${
                          isBelowCost && showCostPrice ? 'bg-red-50 dark:bg-red-900/10' : ''
                        }`}
                        onClick={() => setSelectedCartIndex(index)}
                      >
                        {/* Left Side - Product Info */}
                        <div className="flex flex-col flex-1 min-w-0 mr-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-xs md:text-sm truncate">{item.product.name}</p>
                            {(item.qty_sale ?? item.quantity) < 0 && (
                              <Badge variant="destructive" className="h-5 text-[10px] px-1.5 shrink-0">
                                {t('pos.exchange.line_badge_return')}
                              </Badge>
                            )}
                            {isBelowCost && showCostPrice && (
                              <AlertTriangle className="h-3 w-3 text-destructive flex-shrink-0" title="Narx tannarxdan past!" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {(item.promotion_name || item.price_source === 'promo') ? (
                              <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400">
                                {formatCurrency(Number(item.unit_price || 0))}
                              </p>
                            ) : (
                              <Popover
                                open={manualPricePopoverProductId === item.product.id}
                                onOpenChange={(open) => {
                                  if (open) {
                                    setManualPricePopoverProductId(item.product.id);
                                    setManualPriceDraft(
                                      Math.max(0, Math.round(Number(item.unit_price || 0)))
                                    );
                                  } else {
                                    setManualPricePopoverProductId(null);
                                  }
                                }}
                              >
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400 hover:text-primary underline-offset-2 hover:underline text-left"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {formatCurrency(Number(item.unit_price || 0))}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent
                                  className="w-72"
                                  align="start"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="space-y-3">
                                    <div>
                                      <Label className="text-xs">{t('pos.manual_unit_price')}</Label>
                                      <p className="text-[10px] text-muted-foreground mt-0.5">
                                        {t('pos.manual_price_hint')}
                                      </p>
                                    </div>
                                    <MoneyInput
                                      value={manualPriceDraft}
                                      onValueChange={setManualPriceDraft}
                                      min={0}
                                      allowZero
                                      placeholder="0"
                                      syncWhileFocused
                                    />
                                    <div className="flex flex-col gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        className="w-full"
                                        onClick={() =>
                                          applyManualLinePrice(item.product.id, manualPriceDraft)
                                        }
                                      >
                                        {t('pos.manual_price_apply')}
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="w-full"
                                        onClick={() => void resetLineToAutoPrice(item.product.id)}
                                      >
                                        {t('pos.manual_price_reset')}
                                      </Button>
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )}
                            {item.price_tier && item.price_source !== 'manual' && (
                              <Badge variant="secondary" className="h-5 text-[10px] px-1.5">
                                {getTierLabel(item.price_tier)}
                              </Badge>
                            )}
                            {item.price_source === 'manual' && (
                              <Badge variant="outline" className="h-5 text-[10px] px-1.5 border-amber-600 text-amber-800 dark:text-amber-200">
                                {t('pos.manual_price_badge')}
                              </Badge>
                            )}
                            {(item.price_source === 'promo' || item.promotion_name) && (
                              <Badge variant="default" className="h-5 text-[10px] px-1.5 bg-green-600">
                                {item.promotion_name || 'Aksiya'}
                              </Badge>
                            )}
                            {item.discount_amount > 0 && !item.promotion_name && (
                              <Badge variant="outline" className="h-5 text-[10px] px-1.5">
                                Discount
                              </Badge>
                            )}
                            {showCostPrice && (
                              <p className="text-[10px] md:text-xs text-muted-foreground">
                                (Tannarx: {formatCurrency(costPrice)})
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="w-24 md:w-28">
                              <Select
                                value={unit}
                                onValueChange={(value) => void updateSaleUnit(item.product.id, value)}
                              >
                                <SelectTrigger className="h-6 text-[10px] md:h-7 md:text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {(item.product as any)?.product_units?.length
                                    ? (item.product as any).product_units.map((u: any) => (
                                        <SelectItem key={u.unit} value={u.unit}>
                                          {formatUnit(u.unit) || u.unit}
                                        </SelectItem>
                                      ))
                                    : (
                                      <SelectItem value={unit}>
                                        {formatUnit(unit) || unit}
                                      </SelectItem>
                                    )}
                                </SelectContent>
                              </Select>
                            </div>
                            {(item.product as any)?.product_units?.length > 1 && (
                              <p className="text-[10px] text-muted-foreground hidden md:block">
                                {formatQuantity(item.qty_sale ?? item.quantity, unit)} {formatUnit(unit)} =
                                {` `}
                                {formatQuantity(item.qty_base ?? item.quantity, baseUnit)} {formatUnit(baseUnit)}
                              </p>
                            )}
                          </div>
                        </div>
                        
                        {/* Right Side - Controls */}
                        <div className="flex items-center gap-2">
                          {/* Quantity Group */}
                          <div className="flex items-center">
                            <button
                              type="button"
                              className="h-7 w-7 md:h-8 md:w-8 flex items-center justify-center rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateQuantity(item.product.id, item.quantity - quantityStep);
                              }}
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <Input
                              type="number"
                              min={quantityMin.toString()}
                              step={quantityStep.toString()}
                              inputMode={inputMode}
                              value={displayQuantity}
                              onChange={(e) => handleQuantityInputChange(item.product.id, e.target.value)}
                              onBlur={() => handleQuantityInputBlur(item.product.id)}
                              onKeyDown={(e) => handleQuantityInputKeyDown(item.product.id, e)}
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                openQuantityNumpad(item.product.id, item.quantity, item.product.current_stock);
                              }}
                              className="h-7 w-12 md:h-8 md:w-16 text-center border-y border-gray-200 dark:border-gray-600 text-xs md:text-sm focus:outline-none rounded-none bg-white dark:bg-gray-800"
                            />
                            <button
                              type="button"
                              className="h-7 w-7 md:h-8 md:w-8 flex items-center justify-center rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateQuantity(item.product.id, item.quantity + quantityStep);
                              }}
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                          
                          {/* Total Price */}
                          <div className="min-w-[72px] text-right mr-2">
                            <p className="font-bold text-xs md:text-sm">
                              {formatCurrency(item.total)}
                            </p>
                          </div>
                          
                          {/* Delete Button */}
                          <button
                            type="button"
                            className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-1.5 md:p-2 rounded transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFromCart(item.product.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      
                      {/* Line Discount (if any) - Show as separate row below */}
                      {item.discount_amount > 0 && (
                        <div className="px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border-t border-yellow-200 dark:border-yellow-800 flex items-center justify-between">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-7 text-xs"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Tag className="h-3 w-3 mr-1" />
                                Discount: {formatCurrency(item.discount_amount)}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64" align="start">
                              <div className="space-y-3">
                                <div className="space-y-1">
                                  <Label className="text-xs">{t('pos.line_discount')}</Label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max={item.subtotal}
                                    value={item.discount_amount}
                                    onChange={(e) => {
                                      const value = e.target.value === '' ? 0 : Number(e.target.value);
                                      updateLineDiscount(item.product.id, value);
                                    }}
                                    onClick={() => openDiscountNumpad(item.product.id, item.discount_amount, item.subtotal)}
                                    placeholder="0.00"
                                    className="h-8 cursor-pointer"
                                    readOnly
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    {t('pos.max')}: {formatCurrency(item.subtotal)}
                                  </p>
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => updateLineDiscount(item.product.id, item.subtotal * 0.05)}
                                  >
                                    {t('pos.discount_5')}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => updateLineDiscount(item.product.id, item.subtotal * 0.10)}
                                  >
                                    {t('pos.discount_10')}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => updateLineDiscount(item.product.id, item.subtotal * 0.15)}
                                  >
                                    {t('pos.discount_15')}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => updateLineDiscount(item.product.id, 0)}
                                  >
                                    {t('pos.clear')}
                                  </Button>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                          <p className="text-xs text-destructive line-through">
                            {formatCurrency(item.subtotal)}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
              )}
                </div>
              </div>

            {/* Pastki qism: jami + faqat To‘lash */}
            <div className="shrink-0 border-t bg-white dark:bg-gray-900 p-4 shadow-sm">
              {/* Totals */}
              <div className="space-y-2 pt-2 border-t">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('pos.subtotal')}:</span>
                  <span className="font-medium">{formatCurrency(subtotal)}</span>
                </div>
                {ustaSavings > 0 && (
                  <div className="flex justify-between text-xs text-emerald-700 dark:text-emerald-300">
                    <span>{getTierLabel(currentTierCode)} narx farqi:</span>
                    <span>-{formatCurrency(ustaSavings)}</span>
                  </div>
                )}
                {lineDiscountsTotal > 0 && (
                  <div className="flex justify-between text-xs text-destructive">
                    <span>{t('pos.line_discounts')}:</span>
                    <span>-{formatCurrency(lineDiscountsTotal)}</span>
                  </div>
                )}
                {globalDiscountAmount > 0 && (
                  <div className="flex justify-between text-xs text-destructive">
                    <span>{t('pos.order_discount_label')}:</span>
                    <span>-{formatCurrency(globalDiscountAmount)}</span>
                  </div>
                )}
                {loyaltyCfg.redeemEnabled &&
                  isElectron() &&
                  selectedCustomer &&
                  !isWalkInCustomer(selectedCustomer) &&
                  cart.length > 0 && (
                    <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/20">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Gift className="h-4 w-4 text-amber-600" />
                        Bonus ball
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Mavjud: {Math.floor(Number(selectedCustomer.bonus_points) || 0)} ball · minimal ishlatish:{' '}
                        {loyaltyCfg.minRedeemPts} ball
                      </p>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={loyaltyRedeemPoints === 0 ? '' : loyaltyRedeemPoints}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') {
                            setLoyaltyRedeemPoints(0);
                            return;
                          }
                          const v = parseInt(raw, 10);
                          setLoyaltyRedeemPoints(Number.isFinite(v) && v >= 0 ? v : 0);
                        }}
                        placeholder="Ishlatiladigan ball"
                        disabled={cart.length === 0}
                        className="h-9"
                      />
                      {loyaltyDiscountUzs > 0 && (
                        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          Bonus chegirma: −{formatCurrency(loyaltyDiscountUzs)} (≈{loyaltyRedeemPointsApplied} ball)
                        </p>
                      )}
                    </div>
                  )}
                {discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-destructive font-medium">
                    <span>{t('pos.total_discount')}:</span>
                    <span>-{formatCurrency(discountAmount)}</span>
                  </div>
                )}
                {includePriorDebtInPayment && priorDebtUzs > 0 && total > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Oldingi qarz:</span>
                    <span className="font-mono">+{formatCurrency(priorDebtUzs)}</span>
                  </div>
                )}
                <div className="flex justify-between text-2xl font-bold pt-2 border-t">
                  <span>{t('pos.total')}:</span>
                  <span className="text-primary">{formatCurrency(checkoutGrandTotal)}</span>
                </div>
                
                {/* Cost Price and Profit Summary */}
                {showCostPrice && cart.length > 0 && (() => {
                  const totalCost = cart.reduce((sum, item) => {
                    const costPrice = Number(item.product.purchase_price || 0);
                    return sum + (costPrice * (item.qty_base ?? item.quantity));
                  }, 0);
                  const profit = total - totalCost;
                  const profitMargin = total > 0 ? ((profit / total) * 100) : 0;
                  
                  return (
                    <div className="pt-2 mt-2 border-t border-dashed space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span className="font-medium">Umumiy tannarx:</span>
                        <span className="font-mono">{formatCurrency(totalCost)}</span>
                      </div>
                      <div className={`flex justify-between text-sm font-semibold ${profit >= 0 ? 'text-success' : 'text-destructive'}`}>
                        <span className="flex items-center gap-1">
                          Foyda:
                          {profit < 0 && <AlertTriangle className="h-3 w-3" />}
                        </span>
                        <span className="font-mono">
                          {formatCurrency(profit)} ({profitMargin >= 0 ? '+' : ''}{profitMargin.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-2 border-t pt-3">
                <Label className="text-sm font-semibold">{t('pos.order_discount')}</Label>
                <div className="flex items-center gap-2">
                  <Select
                    value={discount.type}
                    onValueChange={(value) =>
                      setDiscount({ ...discount, type: value as 'amount' | 'percent' | 'promo' })
                    }
                  >
                    <SelectTrigger
                      className="h-10 w-[4.5rem] shrink-0"
                      title={
                        discount.type === 'promo' ? t('pos.promo_code_select_hint') : undefined
                      }
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="amount">$</SelectItem>
                      <SelectItem value="percent">%</SelectItem>
                      <SelectItem value="promo" title={t('pos.promo_code_hint')}>
                        {t('pos.promo_code_short')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {discount.type === 'promo' ? (
                    <>
                      <Input
                        id="pos-promo-code-checkout"
                        type="text"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        value={promoCodeInput}
                        onChange={(e) => setPromoCodeInput(e.target.value)}
                        placeholder={t('pos.promo_code_placeholder')}
                        className="h-10 min-w-0 flex-1 font-mono text-sm uppercase"
                        disabled={cart.length === 0}
                      />
                      {promoCodeInput ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 shrink-0"
                          title={t('pos.clear')}
                          onClick={() => setPromoCodeInput('')}
                          disabled={cart.length === 0}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={discount.value}
                      onChange={(e) =>
                        setDiscount({
                          ...discount,
                          value: sanitizeDiscountInput(e.target.value),
                        })
                      }
                      placeholder="0"
                      className="h-10 min-w-0 flex-1"
                      aria-invalid={discountError !== ''}
                      disabled={cart.length === 0}
                    />
                  )}
                </div>
                {discountError !== '' && (
                  <p className="text-xs text-destructive">{discountError}</p>
                )}
              </div>

              <div className="pt-3">
                <Button
                  className="h-14 w-full bg-green-600 text-lg font-bold text-white hover:bg-green-700"
                  size="lg"
                  disabled={cart.length === 0 || isDiscountActionDisabled}
                  title={isDiscountActionDisabled ? discountActionDisabledReason : undefined}
                  onClick={() => setPaymentDialogOpen(true)}
                >
                  <DollarSign className="mr-2 h-6 w-6" />
                  {t('pos.pay_checkout')}
                </Button>
              </div>
            </div>
            </div>
          <aside
            className="flex w-[4.75rem] shrink-0 grow-0 basis-[4.75rem] flex-col items-stretch border-l border-border bg-muted/30 py-2 xl:h-full xl:min-h-0 xl:grow-0 xl:shrink-0 xl:basis-[4.75rem] xl:w-[4.75rem] xl:self-stretch xl:border-y-0 xl:border-r-0 xl:bg-muted/40 xl:py-0"
            aria-label="Savat tezkor tugmalari"
          >
            <div className="flex flex-col items-center gap-2 px-1 py-2 shrink-0 xl:py-3">
            <Button
              type="button"
              variant={exchangeReturnMode ? 'default' : 'outline'}
              size="icon"
              className={cn(
                'h-12 w-12 shrink-0',
                exchangeReturnMode && 'text-primary-foreground [&_svg]:text-primary-foreground'
              )}
              title={`${t('pos.exchange.return_mode_short')} (F8)`}
              aria-pressed={exchangeReturnMode}
              onClick={() => setExchangeReturnMode((v) => !v)}
            >
              <ArrowLeftRight className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              variant={showCostPrice ? 'default' : 'outline'}
              size="icon"
              className="h-12 w-12 shrink-0"
              onClick={() => setShowCostPrice(!showCostPrice)}
              title={showCostPrice ? "Tannarx yashirish" : "Tannarx ko'rish"}
            >
              {showCostPrice ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-12 w-12 shrink-0"
              disabled={cart.length === 0}
              title="Tekshirish"
              onClick={() => setCartReviewOpen(true)}
            >
              <ClipboardList className="h-5 w-5" />
            </Button>

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-12 w-12 shrink-0 border-yellow-600 bg-yellow-500 text-white hover:bg-yellow-600 hover:text-white"
              title={t('pos.hold_order')}
              onClick={() => {
                if (cart.length > 0) {
                  void handleHoldOrder();
                  return;
                }
                if (heldOrders.length > 0) {
                  setWaitingOrdersDialogOpen(true);
                  return;
                }
                toast({
                  title: 'Xatolik',
                  description:
                    "Savatcha bo'sh. Buyurtmani saqlash uchun mahsulot qo'shing",
                  variant: 'destructive',
                });
              }}
            >
              <Pause className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="relative h-12 w-12 shrink-0"
              title="Kutilayotgan buyurtmalar"
              onClick={() => setWaitingOrdersDialogOpen(true)}
            >
              <Clock className="h-5 w-5" />
              {heldOrders.length > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full p-0 px-1 text-[10px]"
                >
                  {heldOrders.length}
                </Badge>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-12 w-12 shrink-0"
              disabled={!lastReceiptData}
              title="Chek"
              onClick={() => {
                if (!lastReceiptData) return;
                void printReceipt(lastReceiptData as any);
              }}
            >
              <Printer className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="h-12 w-12 shrink-0"
              disabled={cart.length === 0}
              title="Tozalash"
              onClick={() => {
                if (cart.length === 0) {
                  toast({
                    title: t('pos.cart_empty'),
                    variant: 'destructive',
                  });
                  return;
                }
                setCart([]);
                setExchangeReturnMode(false);
                setDiscount({ type: 'amount', value: '' });
                setPromoCodeInput('');
                resetCustomerSelection();
                toast({
                  title: 'Cart cleared',
                  description: 'All items removed from cart',
                });
              }}
            >
              <Trash2 className="h-5 w-5" />
            </Button>
            </div>

            <div
              className="mx-1 mb-1 mt-0 hidden min-h-0 flex-1 rounded-md bg-gradient-to-b from-muted/0 via-muted/20 to-muted/35 dark:via-muted/10 dark:to-muted/25 xl:block"
              aria-hidden
            />

            <div className="hidden shrink-0 border-t border-border/60 bg-muted/40 px-1 py-2 xl:block xl:pb-3">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-center text-muted-foreground">
                {t('pos.rail_hints_title')}
              </p>
              <ul className="mt-1.5 space-y-1 text-[9px] leading-tight text-muted-foreground text-center">
                <li>{t('pos.rail_hint_f2')}</li>
                <li>{t('pos.rail_hint_f3')}</li>
                <li>{t('pos.rail_hint_f8')}</li>
                <li>{t('pos.rail_hint_f9')}</li>
              </ul>
            </div>
          </aside>
          </div>
        </div>
      </div>

      <Dialog open={cartReviewOpen} onOpenChange={setCartReviewOpen}>
        <DialogContent className="flex max-h-[min(90vh,720px)] min-h-0 w-[min(96vw,56rem)] max-w-[min(96vw,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,56rem)]">
          <DialogHeader className="shrink-0 border-b px-6 pb-3 pr-14 pt-6">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <ClipboardList className="h-5 w-5 text-primary" />
              Savatni tekshirish
            </DialogTitle>
            <DialogDescription className="text-left">
              {effectiveCart.length} ta qator · mijoz:{' '}
              {selectedCustomer
                ? `${selectedCustomer.name}${selectedCustomer.phone ? ` (${selectedCustomer.phone})` : ''}`
                : t('pos.walk_in_customer')}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto px-6">
            <div className="py-3">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="py-2 pr-2 w-10">#</th>
                    <th className="py-2 pr-2">Mahsulot</th>
                    <th className="py-2 pr-2 whitespace-nowrap">SKU</th>
                    <th className="py-2 pr-2">Birlik</th>
                    <th className="py-2 pr-2 text-right whitespace-nowrap">Miqdor</th>
                    <th className="py-2 pr-2 text-right whitespace-nowrap">Narx</th>
                    <th className="py-2 pr-2 text-right whitespace-nowrap">Chegirma</th>
                    <th className="py-2 pr-2 text-right whitespace-nowrap">Jami</th>
                    <th className="py-2 text-right whitespace-nowrap">Ombor</th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveCart.map((item, idx) => {
                    const unit = item.sale_unit || item.product.unit;
                    const qtySale = Number(item.qty_sale ?? item.quantity ?? 0) || 0;
                    const qtyBase = Number(item.qty_base ?? item.quantity ?? 0) || 0;
                    const stock = Number(item.product.current_stock ?? 0) || 0;
                    const isReturn = qtySale < 0;
                    const stockShort = !isReturn && qtyBase > 0 && qtyBase > stock;
                    return (
                      <tr
                        key={`${item.product.id}-${idx}`}
                        className={cn(
                          'border-b border-border/60 align-top',
                          stockShort && 'bg-destructive/10'
                        )}
                      >
                        <td className="py-2.5 pr-2 text-muted-foreground">{idx + 1}</td>
                        <td className="py-2.5 pr-2 font-medium">
                          <div className="flex flex-col gap-0.5">
                            <span>{item.product.name}</span>
                            <div className="flex flex-wrap gap-1">
                              {qtySale < 0 && (
                                <Badge variant="destructive" className="h-5 text-[10px] px-1.5">
                                  {t('pos.exchange.line_badge_return')}
                                </Badge>
                              )}
                              {item.price_tier && (
                                <Badge variant="secondary" className="h-5 text-[10px] px-1.5">
                                  {getTierLabel(item.price_tier)}
                                </Badge>
                              )}
                              {(item.price_source === 'promo' || item.promotion_name) && (
                                <Badge variant="default" className="h-5 text-[10px] px-1.5 bg-green-600">
                                  {item.promotion_name || 'Aksiya'}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 pr-2 text-muted-foreground font-mono text-xs whitespace-nowrap">
                          {item.product.sku || '—'}
                        </td>
                        <td className="py-2.5 pr-2 text-xs">{formatUnit(unit) || unit}</td>
                        <td className="py-2.5 pr-2 text-right font-mono whitespace-nowrap">
                          {formatQuantity(item.quantity, unit)}
                        </td>
                        <td className="py-2.5 pr-2 text-right font-mono whitespace-nowrap">
                          {formatCurrency(Number(item.unit_price || 0))}
                        </td>
                        <td className="py-2.5 pr-2 text-right font-mono whitespace-nowrap text-destructive">
                          {item.discount_amount > 0 ? `−${formatCurrency(item.discount_amount)}` : '—'}
                        </td>
                        <td className="py-2.5 pr-2 text-right font-semibold font-mono whitespace-nowrap">
                          {formatCurrency(item.total)}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          <span
                            className={cn(
                              'font-mono text-xs',
                              stockShort ? 'text-destructive font-semibold' : 'text-muted-foreground'
                            )}
                          >
                            {stock}
                            {stockShort && (
                              <span className="block text-[10px] font-normal">Yetishmaydi</span>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="shrink-0 space-y-3 border-t bg-muted/40 px-6 py-4">
            <div className="grid gap-1.5 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Yig‘indi:</span>
                <span className="font-mono font-medium">{formatCurrency(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Qator chegirmalari:</span>
                <span className="font-mono text-destructive">
                  {totals.lineDiscountsTotal > 0 ? `−${formatCurrency(totals.lineDiscountsTotal)}` : '—'}
                </span>
              </div>
              {totals.globalDiscountAmount > 0 && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Buyurtma chegirmasi:</span>
                  <span className="font-mono text-destructive">
                    −{formatCurrency(totals.globalDiscountAmount)}
                  </span>
                </div>
              )}
              {totals.loyaltyDiscountUzs > 0 && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Bonus chegirma:</span>
                  <span className="font-mono text-destructive">
                    −{formatCurrency(totals.loyaltyDiscountUzs)}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-4 sm:col-span-2 pt-2 border-t text-base font-bold">
                <span>To‘lash:</span>
                <span className="font-mono text-primary">{formatCurrency(checkoutGrandTotal)}</span>
              </div>
            </div>
            <Button type="button" className="w-full sm:w-auto" onClick={() => setCartReviewOpen(false)}>
              Yopish
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('pos.process_payment')}</DialogTitle>
            <DialogDescription>
              {total > 0 && includePriorDebtInPayment && priorDebtUzs > 0 ? (
                <span className="block space-y-1 text-foreground">
                  <span className="block text-sm">
                    Savat: <span className="font-semibold tabular-nums">{formatCurrency(total)}</span>
                  </span>
                  <span className="block text-sm">
                    + Oldingi qarz:{' '}
                    <span className="font-semibold tabular-nums text-destructive">
                      {formatCurrency(priorDebtUzs)}
                    </span>
                  </span>
                  <span className="block text-sm border-t mt-2 pt-2">
                    Jami to‘lash:{' '}
                    <span className="text-primary font-bold tabular-nums">
                      {formatCurrency(checkoutGrandTotal)}
                    </span>
                  </span>
                </span>
              ) : (
                <>
                  {t('pos.total_amount')}:{' '}
                  <span className={total < 0 ? 'text-destructive font-semibold' : ''}>
                    {formatCurrency(total)}
                  </span>
                </>
              )}
              {total < 0 && (
                <span className="block text-sm mt-1 text-muted-foreground">
                  {t('pos.exchange.customer_payout_label')} {formatCurrency(Math.abs(total))}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {total < 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('pos.exchange.refund_panel_intro')}</p>
              <Button
                className="w-full"
                variant="destructive"
                disabled={isDiscountActionDisabled}
                onClick={() => handleCompletePayment(POS_EXCHANGE_PAYOUT_METHOD)}
              >
                {t('pos.exchange.refund_confirm_with_amount', {
                  amount: formatCurrency(Math.abs(total)),
                })}
              </Button>
            </div>
          ) : total === 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('pos.exchange.zero_settle_intro')}</p>
              <Button
                className="w-full"
                disabled={isDiscountActionDisabled}
                onClick={() => handleCompletePayment('zero_settle')}
              >
                {t('pos.exchange.zero_settle_button')}
              </Button>
            </div>
          ) : (
          <Tabs defaultValue="cash" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="cash">{t('pos.cash')}</TabsTrigger>
              <TabsTrigger value="card">{t('pos.card')}</TabsTrigger>
              <TabsTrigger value="qr">{t('pos.qr_pay')}</TabsTrigger>
              <TabsTrigger value="mixed">{t('pos.mixed')}</TabsTrigger>
              <TabsTrigger 
                value="credit" 
                disabled={!selectedCustomer || selectedCustomer.id === 'none'}
              >
                {t('pos.credit')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="cash" className="space-y-4">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <MoneyInput
                    label={t('pos.cash_received')}
                    value={cashReceived}
                    onValueChange={setCashReceived}
                    placeholder="0"
                    allowZero={false}
                    min={0}
                  />
                </div>
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => setCashReceived(checkoutGrandTotal)}
                  className="shrink-0"
                >
                  {t('pos.full_payment')}
                </Button>
              </div>
              {cashReceived !== null && cashReceived > 0 && (() => {
                const changeAmount = cashReceived - checkoutGrandTotal;
                const isSufficient = changeAmount >= 0;
                return (
                  <div className="p-4 bg-muted rounded-lg">
                    {isSufficient ? (
                      <div className="text-2xl text-green-600 font-bold text-center">
                        Qaytim: {formatCurrency(changeAmount)}
                      </div>
                    ) : (
                      <div className="text-lg text-red-500 font-semibold text-center">
                        Yetmayapti: {formatCurrency(Math.abs(changeAmount))}
                      </div>
                    )}
                  </div>
                );
              })()}
              <Button
                className="w-full"
                onClick={() => handleCompletePayment('cash')}
                disabled={!cashReceived || cashReceived < checkoutGrandTotal || isDiscountActionDisabled}
                title={isDiscountActionDisabled ? discountActionDisabledReason : undefined}
              >
                {t('pos.complete_payment')}
              </Button>
            </TabsContent>
            <TabsContent value="card" className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <p className="text-sm text-muted-foreground">Amount to charge:</p>
                <p className="text-2xl font-bold">{formatMoneyUZS(checkoutGrandTotal)}</p>
              </div>
              <Button
                className="w-full"
                onClick={() => handleCompletePayment('card')}
                disabled={isDiscountActionDisabled}
                title={isDiscountActionDisabled ? discountActionDisabledReason : undefined}
              >
                <CreditCard className="h-5 w-5 mr-2" />
                {t('pos.process_card_payment')}
              </Button>
            </TabsContent>
            <TabsContent value="qr" className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <p className="text-sm text-muted-foreground">Amount to charge:</p>
                <p className="text-2xl font-bold">{formatCurrency(checkoutGrandTotal)}</p>
              </div>
              <Button
                className="w-full"
                onClick={() => handleCompletePayment('qr')}
                disabled={isDiscountActionDisabled}
                title={isDiscountActionDisabled ? discountActionDisabledReason : undefined}
              >
                <Smartphone className="h-5 w-5 mr-2" />
                {t('pos.process_qr_payment')}
              </Button>
            </TabsContent>
            <TabsContent value="mixed" className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('pos.order_total')}:</span>
                  <span className="font-bold">{formatCurrency(checkoutGrandTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('pos.cash_received')}:</span>
                  <span className="font-bold">{formatCurrency(paidAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('pos.remaining_to_pay')}:</span>
                  <span className={`font-bold ${remainingAmount > 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {formatCurrency(remainingAmount)}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const half =
                      checkoutGrandTotal > 0 ? checkoutGrandTotal / 2 : 0;
                    const amount = Math.min(remainingAmount, half);
                    setPayments([...payments, { method: 'cash', amount }]);
                  }}
                  disabled={remainingAmount <= 0}
                >
                  <Banknote className="h-4 w-4 mr-2" />
                  {t('pos.add_cash')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPayments([...payments, { method: 'card', amount: remainingAmount }]);
                  }}
                  disabled={remainingAmount <= 0}
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  {t('pos.add_card')}
                </Button>
              </div>
              {payments.length > 0 && (
                <div className="space-y-2">
                  <Label>{t('pos.payment_methods')}:</Label>
                  {payments.map((payment, index) => (
                    <div key={index} className="flex justify-between items-center p-2 border rounded">
                      <span className="capitalize">{payment.method}</span>
                      <div className="flex items-center gap-2">
                        <span>{formatCurrency(payment.amount)}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setPayments(payments.filter((_, i) => i !== index));
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button
                className="w-full"
                onClick={() => handleCompletePayment('mixed')}
                disabled={remainingAmount > 0 || isDiscountActionDisabled}
                title={isDiscountActionDisabled ? discountActionDisabledReason : undefined}
              >
                {t('pos.complete_payment')}
              </Button>
            </TabsContent>
            <TabsContent value="credit" className="space-y-4">
              {!selectedCustomer || selectedCustomer.id === 'none' ? (
                <div className="p-8 bg-muted rounded-lg text-center">
                  <p className="text-base font-semibold text-destructive">
                    {t('pos.select_customer_first')}
                  </p>
                </div>
              ) : (() => {
                const pRaw = creditAmount.trim();
                const pNum = pRaw === '' ? 0 : Number(pRaw);
                const payInvalid = pRaw !== '' && (!Number.isFinite(pNum) || pNum < 0);
                const initialPaymentUi = payInvalid ? 0 : pNum;
                const priorAmt = includePriorDebtInPayment ? priorDebtUzs : 0;
                const toPrior = priorAmt > 0 ? Math.min(initialPaymentUi, priorAmt) : 0;
                const orderCash = Math.max(0, initialPaymentUi - toPrior);
                const merchCredit = Math.max(0, total - orderCash);
                const prepaidExtra = Math.max(0, orderCash - total);
                const currentBalance = selectedCustomer.balance || 0;
                const projectedBalance = currentBalance + initialPaymentUi - total;
                const creditLimitExceeded =
                  selectedCustomer.credit_limit > 0 &&
                  projectedBalance < 0 &&
                  Math.abs(projectedBalance) > selectedCustomer.credit_limit;

                const fmtBalLine = (b: number) => {
                  if (b < -0.01) return `−${formatCurrency(Math.abs(b))} (qarz)`;
                  if (b > 0.01) return `+${formatCurrency(b)} (oldindan)`;
                  return '0';
                };

                return (
                  <>
                    {/* Initial Payment Input */}
                    <div className="space-y-2">
                      <Label htmlFor="initial-payment">{t('pos.initial_payment')}</Label>
                      <Input
                        id="initial-payment"
                        type="number"
                        step="1"
                        min="0"
                        value={creditAmount}
                        onChange={(e) => setCreditAmount(e.target.value)}
                        placeholder="0"
                        autoFocus
                        disabled={creditLimitExceeded}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('pos.initial_payment_desc')} Istalgan summa: {formatCurrency(checkoutGrandTotal)} gacha/yoki
                        undan oshiq — ortiqcha mijoz balansida <span className="font-medium">oldindan to‘lov</span> bo‘ladi.
                      </p>
                      {payInvalid && (
                        <p className="text-xs text-destructive">To‘g‘ri musbat son kiriting.</p>
                      )}
                    </div>

                    {/* Visual Summary Card */}
                    <div className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg space-y-2 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Ushbu savat (nasiya qismi):</span>
                        <span className="font-medium tabular-nums">{formatCurrency(total)}</span>
                      </div>
                      {priorAmt > 0 && (
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-muted-foreground">Oldingi qarz (yopish tartibi: avval):</span>
                          <span className="font-medium text-destructive tabular-nums">{formatCurrency(priorAmt)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center text-xs border-t border-dashed pt-2">
                        <span className="text-muted-foreground">Naqd → oldingi qarzga:</span>
                        <span className="tabular-nums">{formatCurrency(toPrior)}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted-foreground">Naqd → ushbu savatga:</span>
                        <span className="tabular-nums">{formatCurrency(orderCash)}</span>
                      </div>
                      {merchCredit > 0.01 && (
                        <div className="flex justify-between items-center text-orange-600 dark:text-orange-400">
                          <span>Nasiyada qoladi (savat):</span>
                          <span className="font-semibold tabular-nums">{formatCurrency(merchCredit)}</span>
                        </div>
                      )}
                      {prepaidExtra > 0.01 && (
                        <div className="flex justify-between items-center text-emerald-700 dark:text-emerald-300">
                          <span>Savatdan ortiq (oldindan):</span>
                          <span className="font-semibold tabular-nums">{formatCurrency(prepaidExtra)}</span>
                        </div>
                      )}
                      <div className="border-t border-gray-200 dark:border-gray-700 pt-2 flex justify-between items-center">
                        <span className="text-base font-bold">Yangi balans:</span>
                        <span
                          className={`text-base font-bold tabular-nums ${
                            projectedBalance < -0.01
                              ? 'text-red-600 dark:text-red-400'
                              : projectedBalance > 0.01
                                ? 'text-emerald-600 dark:text-emerald-300'
                                : 'text-foreground'
                          }`}
                        >
                          {fmtBalLine(projectedBalance)}
                        </span>
                      </div>
                    </div>

                    {/* Credit Limit Warning */}
                    {creditLimitExceeded && (
                      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                          {t('pos.credit_limit_warning')} {formatCurrency(selectedCustomer.credit_limit)}
                        </p>
                      </div>
                    )}

                  <Button
                    className="w-full"
                    onClick={handleCreditSale}
                    disabled={
                      selectedCustomer.status !== 'active' ||
                      creditLimitExceeded ||
                      payInvalid ||
                      isDiscountActionDisabled
                    }
                    title={isDiscountActionDisabled ? discountActionDisabledReason : undefined}
                  >
                    <Tag className="h-5 w-5 mr-2" />
                    {t('pos.write_credit_and_close')}
                  </Button>
                  {selectedCustomer.status !== 'active' && (
                    <p className="text-xs text-center text-destructive">
                      {t('pos.customer_inactive')}
                    </p>
                  )}
                  </>
                );
              })()}
            </TabsContent>
          </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <WaitingOrdersDialog
        open={waitingOrdersDialogOpen}
        onOpenChange={(open) => {
          setWaitingOrdersDialogOpen(open);
          // Refresh held orders when dialog opens
          if (open) {
            loadHeldOrders();
          }
        }}
        heldOrders={heldOrders}
        onRestore={handleRestoreOrder}
        onCancel={handleCancelHeldOrder}
        onRename={handleRenameHeldOrder}
      />

      <Numpad
        key={
          (() => {
            if (!numpadConfig) return 'pos-numpad';
            if (
              numpadConfig.type === 'add_quantity' &&
              numpadConfig.unit &&
              isFractionalUnit(numpadConfig.unit) &&
              (Number(numpadConfig.refUnitPrice) || 0) > 0
            ) {
              return `pos-wadd-${numpadConfig.product?.id ?? 'x'}`;
            }
            return `pos-np-${numpadConfig.type}-${numpadConfig.productId ?? numpadConfig.product?.id ?? 'g'}`;
          })()
        }
        open={numpadOpen}
        onOpenChange={(open) => {
          setNumpadOpen(open);
          if (!open) {
            setNumpadConfig(null);
            setWeightedCartAddMode('sale_qty');
          }
        }}
        title={(() => {
          if (numpadConfig?.type === 'discount') return 'Enter Discount Amount';
          const refP = Number(numpadConfig?.refUnitPrice) || 0;
          const wa =
            numpadConfig?.type === 'add_quantity' &&
            numpadConfig.unit &&
            isFractionalUnit(numpadConfig.unit) &&
            refP > 0;
          if (wa && weightedCartAddMode === 'amount_uzs') return "Summani kiriting (so'm)";
          if (wa) return `Miqdor (${numpadConfig.unit})`;
          return 'Enter Quantity';
        })()}
        description={(() => {
          if (!numpadConfig) return undefined;
          const refP = Number(numpadConfig.refUnitPrice) || 0;
          const wa =
            numpadConfig.type === 'add_quantity' &&
            numpadConfig.unit &&
            isFractionalUnit(numpadConfig.unit) &&
            refP > 0;
          if (wa && weightedCartAddMode === 'amount_uzs') {
            return `Taxminiy: 1 ${numpadConfig.unit} ≈ ${formatMoneyUZS(refP)}`;
          }
          if (
            numpadConfig.max !== undefined &&
            (numpadConfig.type === 'quantity' || numpadConfig.type === 'add_quantity')
          ) {
            return `Maximum: ${
              numpadConfig.type === 'quantity' || numpadConfig.type === 'add_quantity'
                ? formatQuantity(numpadConfig.max, numpadConfig.unit)
                : numpadConfig.max
            }`;
          }
          return undefined;
        })()}
        headerExtra={(() => {
          if (!numpadConfig || numpadConfig.type !== 'add_quantity') return undefined;
          const refP = Number(numpadConfig.refUnitPrice) || 0;
          const unit = numpadConfig.unit;
          if (!unit || !isFractionalUnit(unit) || refP <= 0) return undefined;
          return (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={weightedCartAddMode === 'sale_qty' ? 'default' : 'outline'}
                className="flex-1 text-xs sm:text-sm"
                onClick={() => setWeightedCartAddMode('sale_qty')}
              >
                {unit} bo‘yicha
              </Button>
              <Button
                type="button"
                size="sm"
                variant={weightedCartAddMode === 'amount_uzs' ? 'default' : 'outline'}
                className="flex-1 text-xs sm:text-sm"
                onClick={() => setWeightedCartAddMode('amount_uzs')}
              >
                So‘m bo‘yicha
              </Button>
            </div>
          );
        })()}
        initialValue={numpadConfig?.initialValue}
        max={(() => {
          if (!numpadConfig) return undefined;
          const refP = Number(numpadConfig.refUnitPrice) || 0;
          const amountMode =
            numpadConfig.type === 'add_quantity' &&
            weightedCartAddMode === 'amount_uzs' &&
            numpadConfig.unit &&
            isFractionalUnit(numpadConfig.unit) &&
            refP > 0;
          if (amountMode && numpadConfig.max !== undefined) {
            return Math.floor(numpadConfig.max * refP);
          }
          return numpadConfig.max;
        })()}
        min={(() => {
          if (!numpadConfig) return 0;
          if (numpadConfig.type === 'discount') return 0;
          const refP = Number(numpadConfig.refUnitPrice) || 0;
          const amountMode =
            numpadConfig.type === 'add_quantity' &&
            weightedCartAddMode === 'amount_uzs' &&
            numpadConfig.unit &&
            isFractionalUnit(numpadConfig.unit) &&
            refP > 0;
          if (amountMode && numpadConfig.unit) {
            return Math.max(1, Math.ceil(getQuantityMin(numpadConfig.unit) * refP));
          }
          if (numpadConfig.type === 'quantity' || numpadConfig.type === 'add_quantity') {
            return getQuantityMin(numpadConfig.unit);
          }
          return 0;
        })()}
        maxHint={(() => {
          if (!numpadConfig || numpadConfig.type !== 'add_quantity' || weightedCartAddMode !== 'amount_uzs') {
            return undefined;
          }
          const refP = Number(numpadConfig.refUnitPrice) || 0;
          if (!numpadConfig.unit || !isFractionalUnit(numpadConfig.unit) || refP <= 0) return undefined;
          if (numpadConfig.max === undefined) return undefined;
          return `Maks: ${formatMoneyUZS(Math.floor(numpadConfig.max * refP))}`;
        })()}
        inputMode={(() => {
          const refP = Number(numpadConfig?.refUnitPrice) || 0;
          if (
            numpadConfig?.type === 'add_quantity' &&
            weightedCartAddMode === 'amount_uzs' &&
            numpadConfig.unit &&
            isFractionalUnit(numpadConfig.unit) &&
            refP > 0
          ) {
            return 'numeric' as const;
          }
          return undefined;
        })()}
        allowDecimal={
          numpadConfig?.type === 'discount'
            ? true
            : numpadConfig?.type === 'quantity' || numpadConfig?.type === 'add_quantity'
              ? !(
                  numpadConfig.type === 'add_quantity' &&
                  weightedCartAddMode === 'amount_uzs' &&
                  numpadConfig.unit &&
                  isFractionalUnit(numpadConfig.unit) &&
                  (Number(numpadConfig.refUnitPrice) || 0) > 0
                ) && isFractionalUnit(numpadConfig.unit)
              : true
        }
        onApply={handleNumpadApply}
      />

      <AlertDialog open={restoreConfirmOpen} onOpenChange={setRestoreConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('pos.replace_cart')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('pos.replace_cart_desc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setOrderToRestore(null)}>
              {t('pos.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => orderToRestore && restoreOrder(orderToRestore)}>
              {t('pos.replace')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={importWebOrderDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCancelWebOrderImport();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('web_orders.import_replace_cart_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('web_orders.import_replace_cart_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelWebOrderImport}>{t('pos.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmWebOrderImport}>{t('pos.replace')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReceivePaymentModal
        open={customerPaymentOpen}
        onOpenChange={setCustomerPaymentOpen}
        customer={selectedCustomer}
        source="pos"
        onSuccess={refreshCustomersAfterCustomerPayment}
      />

      {/* Hidden Receipt Component for Printing */}
      {receiptData && (
        <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
          <Receipt
            ref={receiptRef}
            orderNumber={receiptData.orderNumber}
            items={receiptData.items}
            customer={receiptData.customer}
            subtotal={receiptData.subtotal}
            discountAmount={receiptData.discountAmount}
            total={receiptData.total}
            paidAmount={receiptData.paidAmount}
            changeAmount={receiptData.changeAmount}
            paymentMethod={receiptData.paymentMethod}
            dateTime={receiptData.dateTime}
            cashierName={receiptData.cashierName}
            customerTotalDebt={receiptData.customerTotalDebt}
            companyName={(companySettings as any)?.name || (companySettings as any)?.legal_name || undefined}
            companyPhone={(companySettings as any)?.phone || undefined}
            companyAddress={
              [
                (companySettings as any)?.address_country,
                (companySettings as any)?.address_city,
                (companySettings as any)?.address_street,
              ]
                .map((v) => String(v ?? '').trim())
                .filter(Boolean)
                .join(', ') || undefined
            }
            companyTaxId={(companySettings as any)?.tax_id || undefined}
            headerText={receiptSettings?.header_text || undefined}
            middleText={receiptSettings?.middle_text || undefined}
            footerText={receiptSettings?.footer_text || undefined}
            showCashier={receiptSettings?.show_cashier ?? true}
            showCustomer={receiptSettings?.show_customer ?? true}
            showSku={receiptSettings?.show_sku ?? true}
            paperSize={receiptSettings?.paper_size || '78mm'}
          />
        </div>
      )}

      {/* Hidden ReceiptPrintView for POS printing (Orders uses the same approach) */}
      {printOrder && (
        <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
          <div id="pos-receipt-print-content">
            <ReceiptPrintView order={printOrder} variant="thermal" company={companySettings as any} settings={receiptSettings as any} />
          </div>
        </div>
      )}
    </>
  );
}
