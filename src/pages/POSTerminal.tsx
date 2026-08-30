import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useShiftStore } from '@/store/shiftStore';
import { useInventoryStore } from '@/store/inventoryStore';
import { convertAtRate, formatMoney, getCustomerBalances } from '@/lib/currency';
import { formatCustomerBalance, formatMoneyUZS } from '@/lib/format';
import { loadRetailUsdPricesForProducts, resolveUsdRetailDisplay, isPlausibleUsdRetail } from '@/lib/productPricing';
import { clearTierPriceCache } from '@/lib/tierPriceCache';
import { orderCurrencyFields, toShiftUzsAmount, type PosSaleCurrency } from '@/lib/posSaleCurrency';
import { fetchUzsPerUsdRate } from '@/lib/fxRate';
import { productMatchesCategoryFilter } from '@/lib/categoryTree';
import { productShowInMarketplace } from '@/lib/productMarketplace';
import { applyPercentUZS, roundUZS } from '@/lib/money';
import { formatUnit } from '@/utils/formatters';
import {
  clampQuantityForUnit,
  clampSignedQuantityForUnit,
  formatQuantity,
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
  getProductById,
  getQuoteById,
  getCustomerById,
  getCustomers,
  createCustomer,
  createOrder,
  createCreditOrder,
  cancelOrder,
  getOrderById,
  saveHeldOrder,
  getHeldOrders,
  generateHeldNumber,
  deleteHeldOrder,
  getCategories,
  updateHeldOrderName,
  isRemoteImportHeldOrder,
  getProducts,
  getProductsScanIndex,
  resolveProductScan,
  getSettingsByCategory,
  getPriceTiers,
  getProductTierPrice,
  applyPromotionsToCart,
  getPromotions,
} from '@/db/api';
import { parseScaleEan13 } from '@/lib/barcode';
import ShiftControl from '@/components/pos/ShiftControl';
import NetworkBadge from '@/components/common/NetworkBadge';
import PosDeviceBar from '@/components/pos/PosDeviceBar';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { usePosTerminalSettings } from '@/hooks/usePosTerminalSettings';
import { usePaymentSettings, resolvePaymentLabel } from '@/hooks/usePaymentSettings';
import { applyReceiptSettingsToTemplate, useReceiptSettings } from '@/hooks/useReceiptSettings';
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
  OrderWithDetails,
} from '@/types/database';
import { POS_EXCHANGE_PAYOUT_METHOD, POS_EXCHANGE_BALANCE_METHOD, type PosCheckoutPaymentKind } from '@/constants/posExchange';
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
  Loader2,
  Gift,
  ArrowLeftRight,
  ClipboardList,
  Keyboard,
  Store,
  FolderTree,
  Star,
  Users,
  CalendarClock,
} from 'lucide-react';
import WaitingOrdersDialog from '@/components/pos/WaitingOrdersDialog';
import Numpad from '@/components/pos/Numpad';
import QuickCustomerCreate from '@/components/pos/QuickCustomerCreate';
import PosProductGrid from '@/components/pos/PosProductGrid';
import PosCustomerReferrerPanel from '@/components/pos/PosCustomerReferrerPanel';
import ReceivePaymentModal from '@/components/customers/ReceivePaymentModal';
import CreditDebtsSheet from '@/components/pos/CreditDebtsSheet';
import Receipt from '@/components/Receipt';
import ReceiptPrintView from '@/components/print/ReceiptPrintView';
import MoneyInput from '@/components/common/MoneyInput';
import NumberInput from '@/components/common/NumberInput';
import { openPrintWindow } from '@/lib/print';
import { renderReceiptTemplate } from '@/lib/receipts/renderReceiptTemplate';
import { getActiveReceiptTemplate, resolveReceiptTemplateStore } from '@/lib/receipts/templateStore';
import { formatOrderDateTime } from '@/lib/datetime';
import { shouldAutoPrintReceipt } from '@/lib/receipts/normalizeReceiptSettings';
import { printPosCustomerReceiptEscpos } from '@/lib/receipts/printPosCustomerReceipt';
import { getPrintAgentHealth } from '@/lib/receipts/printAgent';
import { isElectron, getElectronAPI, handleIpcResponse } from '@/utils/electron';
import { getProductImageDisplayUrl } from '@/lib/productImageUrl';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDebounce } from '@/hooks/use-debounce';
import Fuse from 'fuse.js';
import QRCode from 'qrcode';
import { highlightMatch } from '@/utils/searchHighlight';
import { getRecentSearches, addRecentSearch, removeRecentSearch } from '@/utils/recentSearches';
import {
  findInsufficientStockLines,
  isOutOfStockForSale,
  productTracksStock,
  shouldShowZeroSettlePaymentUi,
  isZeroTotalSaleAllowed,
  isProductPriceNotSet,
  isProductFreeSaleAllowed,
  isProductSalePriceSellable,
} from '@/lib/posHardening';
import { posSearchCache } from '@/lib/posSearchCache';

import {
  POS_QUICK_PRODUCT_IDS_KEY,
  MAX_POS_QUICK_PRODUCTS,
  POS_PROMO_APPLY_DEBOUNCE_MS,
  registerProductScanIndexes,
  normalizeSearchTerm,
  normalizeSku,
  classifyQuery,
  filterPosProductsBySearchTerm,
  formatPosProductCodeMeta,
  getSaleUnitConfig,
  getBaseUnit,
  toBaseQty,
  getMaxSaleQty,
  getMaxSaleQtyForCartLine,
  getProbeSaleQtyForUnitPrice,
  recalcCartLineForSaleUnitChange,
  readPosReplacesOrderId,
  persistPosReplacesOrderId,
  resolveReplacesOrderIdForCheckout,
  computeOrderOutstandingForAmend,
  netPriorDebtForAmendCheckout,
  computeCheckoutGrandTotal,
  resolveLoyaltyRedeemOnOrderImport,
  isPosAmendCheckoutError,
  cartOrderDiscountBase,
  computeHeldOrderTotal,
  readPosNavCartDraft,
  persistPosNavCartDraft,
  clearPosNavCartDraft,
  newCheckoutIdempotencyKey,
  buildCheckoutIdempotencySignature,
  getCartLineQuantitySign,
  canQuickAddWithoutNumpad,
  getQuickAddSaleQty,
  type PosNavCartDraft,
} from './posTerminalHelpers';
import {
  buildProductScanIndex,
  lookupProductByScanCode,
  collectScanLookupKeys,
  type ProductScanIndex,
} from '@/lib/pos/productBarcodeIndex';

export default function POSTerminal() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const { currentShift, addSale, addRefund } = useShiftStore();
  const posWarehouseId = useMemo(
    () => ((currentShift as any)?.warehouse_id ? String((currentShift as any).warehouse_id) : undefined),
    [currentShift]
  );
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
  const cartWithPromosRef = useRef<CartItem[]>([]);
  cartWithPromosRef.current = cartWithPromos;
  const promoApplyTimerRef = useRef<number | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [recentCustomerIds, setRecentCustomerIds] = useState<string[]>([]);
  const [customerComboboxOpen, setCustomerComboboxOpen] = useState(false);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  /** Optional usta — bonus routing only (not payment/debt). */
  const [selectedBonusReferrer, setSelectedBonusReferrer] = useState<Customer | null>(null);
  const [bonusReferrerComboboxOpen, setBonusReferrerComboboxOpen] = useState(false);
  const [bonusReferrerSearchTerm, setBonusReferrerSearchTerm] = useState('');
  const [customerPaymentOpen, setCustomerPaymentOpen] = useState(false);
  const [cartReviewOpen, setCartReviewOpen] = useState(false);
  const [hotkeyGuideOpen, setHotkeyGuideOpen] = useState(false);
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
  const [saleCurrency, setSaleCurrency] = useState<PosSaleCurrency>('UZS');
  const [saleFxRate, setSaleFxRate] = useState<number | null>(null);
  const [saleFxLoading, setSaleFxLoading] = useState(false);
  const [usdRetailByProductId, setUsdRetailByProductId] = useState<Record<string, number>>({});
  const [priceTiers, setPriceTiers] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  /** Mijozning oldingi qarzini shu safar savat bilan birga yopish (default: o‘chiq — faqat savat) */
  const [includePriorDebtInPayment, setIncludePriorDebtInPayment] = useState(false);
  const [payments, setPayments] = useState<{ method: PaymentMethod; amount: number }[]>([]);
  const [cashReceived, setCashReceived] = useState<number | null>(null);
  const [editingQuantity, setEditingQuantity] = useState<{ [key: string]: string }>({});
  const [manualPricePopoverProductId, setManualPricePopoverProductId] = useState<string | null>(null);
  const [manualPriceDraft, setManualPriceDraft] = useState<number | null>(null);
  const [creditAmount, setCreditAmount] = useState<number | null>(null);
  /** Nasiya / qisman to‘lovda qarz qaytarish sanasi (YYYY-MM-DD) */
  const [creditDueDate, setCreditDueDate] = useState('');
  /** Ichki eslatma izohi (kassir/admin uchun) */
  const [creditReminderNote, setCreditReminderNote] = useState('');
  const [creditDebtsOpen, setCreditDebtsOpen] = useState(false);
  /** Loyalty points to redeem on current sale (POS); clamped server-side */
  const [loyaltyRedeemPoints, setLoyaltyRedeemPoints] = useState(0);
  const selectedCustomerRef = useRef<Customer | null>(null);
  const discountRef = useRef(discount);
  const promoCodeRef = useRef('');
  const saleCurrencyRef = useRef<PosSaleCurrency>('UZS');
  const tierCodeRef = useRef<'retail' | 'master' | 'wholesale' | 'marketplace'>('retail');
  const navCartDraftRestoredRef = useRef(false);
  selectedCustomerRef.current = selectedCustomer;
  const selectedBonusReferrerRef = useRef<Customer | null>(null);
  selectedBonusReferrerRef.current = selectedBonusReferrer;
  discountRef.current = discount;
  promoCodeRef.current = promoCodeInput;
  saleCurrencyRef.current = saleCurrency;
  tierCodeRef.current = currentTierCode;

  const buildNavCartDraft = useCallback((): PosNavCartDraft | null => {
    const items = cartRef.current;
    if (!items.length) return null;
    return {
      lines: items.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        qty_sale: item.qty_sale,
        sale_unit: item.sale_unit,
        ratio_to_base: item.ratio_to_base,
        amend_original_qty_sale: item.amend_original_qty_sale,
        unit_price: item.unit_price,
        price_tier: item.price_tier,
        price_source: item.price_source,
        is_price_overridden: item.is_price_overridden,
        discount_amount: item.discount_amount,
        subtotal: item.subtotal,
        total: item.total,
      })),
      customerId: selectedCustomerRef.current?.id ?? null,
      bonusReferrerCustomerId: selectedBonusReferrerRef.current?.id ?? null,
      discount: discountRef.current,
      promoCode: promoCodeRef.current || undefined,
      saleCurrency: saleCurrencyRef.current,
      tierCode: tierCodeRef.current,
      replacesOrderId: importedOrderIdForEditRef.current ?? readPosReplacesOrderId(),
      importedOrderOutstanding: importedOrderOutstandingDebtRef.current || undefined,
      replacesOrderNumber: importedOrderNumberForEditRef.current ?? undefined,
      importedHoldOrderId: importedHoldOrderIdRef.current ?? undefined,
      importedHoldOrderNumber: importedHoldOrderNumberRef.current ?? undefined,
      loyaltyRedeemPoints:
        loyaltyRedeemPointsRef.current > 0 ? loyaltyRedeemPointsRef.current : undefined,
    };
  }, []);

  /** Intentional cart clear — also drops nav draft so restore effect cannot rehydrate. */
  const clearCartAndNavDraft = useCallback(() => {
    clearPosNavCartDraft();
    navCartDraftRestoredRef.current = true;
    setCart([]);
    setExchangeReturnMode(false);
  }, []);

  const resetCustomerSelection = useCallback(() => {
    const selectedTier = (selectedCustomer as any)?.pricing_tier;

    setSelectedCustomer(null);
    setSelectedBonusReferrer(null);
    setCustomerSearchTerm('');
    setBonusReferrerSearchTerm('');
    setCustomerComboboxOpen(false);
    setBonusReferrerComboboxOpen(false);

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
  const [importedWebOrderId, setImportedWebOrderId] = useState<number | null>(null);
  /** Completed POS order loaded for edit (OrderDetail → POS); reversed on checkout via replaces_order_id */
  const [importedOrderIdForEdit, setImportedOrderIdForEdit] = useState<string | null>(null);
  /** Unpaid portion of the order being amended — excluded from "Oldingi qarz" at checkout */
  const [importedOrderOutstandingDebt, setImportedOrderOutstandingDebt] = useState(0);
  /** Mobile/DB hold order imported into cart — void after checkout (not amend) */
  const [importedHoldOrderId, setImportedHoldOrderId] = useState<string | null>(null);
  /** Order number labels for amend/hold import banners */
  const [importedOrderNumberForEdit, setImportedOrderNumberForEdit] = useState<string | null>(null);
  const [importedHoldOrderNumber, setImportedHoldOrderNumber] = useState<string | null>(null);
  const importedOrderIdForEditRef = useRef<string | null>(null);
  const importedOrderOutstandingDebtRef = useRef(0);
  const importedHoldOrderIdRef = useRef<string | null>(null);
  const importedOrderNumberForEditRef = useRef<string | null>(null);
  const importedHoldOrderNumberRef = useRef<string | null>(null);
  const loyaltyRedeemPointsRef = useRef(0);
  importedOrderIdForEditRef.current = importedOrderIdForEdit;
  importedOrderOutstandingDebtRef.current = importedOrderOutstandingDebt;
  importedHoldOrderIdRef.current = importedHoldOrderId;
  importedOrderNumberForEditRef.current = importedOrderNumberForEdit;
  importedHoldOrderNumberRef.current = importedHoldOrderNumber;
  loyaltyRedeemPointsRef.current = loyaltyRedeemPoints;
  const clearPosSaleImportContext = useCallback(() => {
    setImportedWebOrderId(null);
    setImportedOrderIdForEdit(null);
    setImportedOrderOutstandingDebt(0);
    setImportedHoldOrderId(null);
    setImportedOrderNumberForEdit(null);
    setImportedHoldOrderNumber(null);
    persistPosReplacesOrderId(null);
  }, []);
  const [importQuoteDialogOpen, setImportQuoteDialogOpen] = useState(false);
  const [pendingQuoteImportId, setPendingQuoteImportId] = useState<string | null>(null);
  const [importOrderDialogOpen, setImportOrderDialogOpen] = useState(false);
  const [pendingOrderImportId, setPendingOrderImportId] = useState<string | null>(null);
  const webOrderImportProcessedRef = useRef<string | null>(null);
  const quoteImportProcessedRef = useRef<string | null>(null);
  const orderImportProcessedRef = useRef<string | null>(null);

  // New state for premium features
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [categorySheetMode, setCategorySheetMode] = useState<'quick' | 'categories'>('categories');
  const [quickProductSearch, setQuickProductSearch] = useState('');
  const [favoriteProducts, setFavoriteProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [catalogLoadError, setCatalogLoadError] = useState<string | null>(null);
  const [scanIndexLoading, setScanIndexLoading] = useState(true);
  const scanIndexReadyRef = useRef(false);
  const pendingScansRef = useRef<Array<{ rawInput: string; opts?: { clearSearch?: boolean } }>>([]);
  const handleBarcodeSearchRef = useRef<
    (barcode: string, opts?: { clearSearch?: boolean }) => void | Promise<void>
  >(() => {});
  const addToCartRef = useRef<
    (product: Product, quantity?: number, saleUnit?: string) => Promise<void>
  >(async () => {});
  const [quickProductIds, setQuickProductIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(POS_QUICK_PRODUCT_IDS_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });
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

  useEffect(() => {
    if (cart.length === 0 && exchangeReturnMode) {
      setExchangeReturnMode(false);
    }
  }, [cart.length, exchangeReturnMode]);
  const [selectedCartIndex, setSelectedCartIndex] = useState<number>(-1);
  const [showCostPrice, setShowCostPrice] = useState(false);
  const [posUiMode, setPosUiMode] = useState<'beginner' | 'fast'>(() => {
    try {
      const saved = localStorage.getItem('pos:uiMode');
      return saved === 'beginner' ? 'beginner' : 'fast';
    } catch {
      return 'fast';
    }
  });
  const [undoCartSnapshot, setUndoCartSnapshot] = useState<CartItem[] | null>(null);
  const [undoMessage, setUndoMessage] = useState('');
  const undoTimerRef = useRef<number | null>(null);
  
  // Receipt printing state
  const receiptRef = useRef<HTMLDivElement>(null);
  const barcodeCacheRef = useRef<Map<string, Product>>(new Map());
  const scanIndexRef = useRef<ProductScanIndex>(buildProductScanIndex([]));
  const barcodeIndexRef = useRef<Map<string, Product>>(scanIndexRef.current.barcode);
  const skuIndexRef = useRef<Map<string, Product>>(scanIndexRef.current.sku);
  const barcodeCacheOrderRef = useRef<string[]>([]);
  const priceCacheRef = useRef<Map<string, number>>(new Map());
  /** Dedupe identical scan within ~80ms (double-beep); never block different items. */
  const lastScanDedupeRef = useRef<{ raw: string; at: number }>({ raw: '', at: 0 });
  const searchDebounceRef = useRef<number | null>(null);
  const searchSeqRef = useRef(0);
  const catalogLoadGenRef = useRef(0);
  const perfEnabled = (import.meta as any)?.env?.VITE_POS_PERF === 'true';
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const receiptSettings = useReceiptSettings();
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
    loyaltyCardCode?: string;
    loyaltyQrDataUrl?: string;
    loyaltyQrPayload?: string;
    currency?: import('@/lib/currency').AppCurrency;
  } | null>(null);
  const [lastReceiptData, setLastReceiptData] = useState<typeof receiptData>(null);
  const [isPrintingReceipt, setIsPrintingReceipt] = useState(false);
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

  const { data: creditSettingsRaw } = useQuery({
    queryKey: ['settings', 'credit', 'pos-due-date'],
    queryFn: () => getSettingsByCategory('credit'),
    staleTime: 60_000,
  });

  const creditDefaultDays = useMemo(() => {
    const v = Number((creditSettingsRaw || {})['credit.due.default_days']);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 30;
  }, [creditSettingsRaw]);

  const defaultCreditDueDate = useCallback(() => {
    const d = new Date();
    d.setDate(d.getDate() + creditDefaultDays);
    return d.toISOString().slice(0, 10);
  }, [creditDefaultDays]);

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
    // Qarz to‘lovi alohida (mijoz kartasi / Qarz to‘lovi). Sotuv checkout — faqat savat.
    setIncludePriorDebtInPayment(false);
  }, [selectedCustomer?.id]);

  useEffect(() => {
    if (paymentDialogOpen) {
      setCreditDueDate(defaultCreditDueDate());
      setCreditReminderNote('');
    }
  }, [paymentDialogOpen, defaultCreditDueDate]);

  useEffect(() => {
    if (saleCurrency === 'USD') {
      setIncludePriorDebtInPayment(false);
      setLoyaltyRedeemPoints(0);
    }
  }, [saleCurrency]);

  useEffect(() => {
    if (saleCurrency !== 'USD') {
      setSaleFxRate(null);
      return;
    }
    let cancelled = false;
    setSaleFxLoading(true);
    void fetchUzsPerUsdRate()
      .then((rate) => {
        if (cancelled) return;
        if (rate != null && rate > 0) {
          setSaleFxRate(rate);
        } else {
          setSaleFxRate(null);
          toast({
            title: 'Valyuta kursi topilmadi',
            description: 'Sozlamalar → Valyuta bo‘limida UZS/USD kursini kiriting.',
            variant: 'destructive',
          });
          setSaleCurrency('UZS');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSaleFxRate(null);
        toast({
          title: 'Valyuta kursi yuklanmadi',
          variant: 'destructive',
        });
        setSaleCurrency('UZS');
      })
      .finally(() => {
        if (!cancelled) setSaleFxLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [saleCurrency, toast]);

  useEffect(() => {
    priceCacheRef.current.clear();
    clearTierPriceCache();
  }, [saleCurrency]);

  useEffect(
    () => () => {
      if (undoTimerRef.current) {
        window.clearTimeout(undoTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    try {
      localStorage.setItem('pos:uiMode', posUiMode);
    } catch {
      // ignore storage errors
    }
  }, [posUiMode]);

  useEffect(() => {
    if (!paymentDialogOpen && !customerPaymentOpen && !cartReviewOpen && !waitingOrdersDialogOpen) {
      const id = window.setTimeout(() => {
        const input = searchInputRef.current;
        if (!input) return;
        input.focus();
        const len = input.value.length;
        if (typeof input.setSelectionRange === 'function') {
          input.setSelectionRange(len, len);
        }
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [paymentDialogOpen, customerPaymentOpen, cartReviewOpen, waitingOrdersDialogOpen]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pos:recentCustomerIds') || '[]');
      if (Array.isArray(saved)) {
        setRecentCustomerIds(saved.filter((id): id is string => typeof id === 'string'));
      }
    } catch {
      // ignore
    }
  }, []);

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

  const getCustomerDebtInCurrency = useCallback(
    (customer: Customer | null | undefined, currency: PosSaleCurrency) => {
      if (!customer) return 0;
      const b = getCustomerBalances(customer);
      const bal = currency === 'USD' ? b.usd : b.uzs;
      return Math.max(0, -bal);
    },
    []
  );

  const getCustomerCreditInCurrency = useCallback(
    (customer: Customer | null | undefined, currency: PosSaleCurrency) => {
      if (!customer) return 0;
      const b = getCustomerBalances(customer);
      const bal = currency === 'USD' ? b.usd : b.uzs;
      return Math.max(0, bal);
    },
    []
  );

  const getActiveBucketBalance = useCallback(
    (customer: Customer | null | undefined, currency: PosSaleCurrency) => {
      if (!customer) return 0;
      const b = getCustomerBalances(customer);
      return currency === 'USD' ? b.usd : b.uzs;
    },
    []
  );

  const queueCartUndo = useCallback((snapshot: CartItem[], message: string) => {
    if (!snapshot || snapshot.length === 0) return;
    setUndoCartSnapshot(snapshot);
    setUndoMessage(message);
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = window.setTimeout(() => {
      setUndoCartSnapshot(null);
      setUndoMessage('');
    }, 5000);
  }, []);

  const restoreUndoCart = useCallback(() => {
    if (!undoCartSnapshot) return;
    setCart(undoCartSnapshot);
    setUndoCartSnapshot(null);
    setUndoMessage('');
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    focusSearchInput();
  }, [undoCartSnapshot, focusSearchInput]);

  const rememberRecentCustomer = useCallback((customerId: string) => {
    if (!customerId || customerId === 'none' || customerId === 'default-customer-001') return;
    setRecentCustomerIds((prev) => {
      const next = [customerId, ...prev.filter((id) => id !== customerId)].slice(0, 6);
      try {
        localStorage.setItem('pos:recentCustomerIds', JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const applySelectedCustomer = useCallback(
    (customer: Customer | null) => {
      setSelectedCustomer(customer);
      setCustomerComboboxOpen(false);
      setCustomerSearchTerm('');
      if (customer?.id) {
        rememberRecentCustomer(customer.id);
      }
      if (customer?.id && selectedBonusReferrer?.id === customer.id) {
        setSelectedBonusReferrer(null);
        setBonusReferrerSearchTerm('');
      }
    },
    [rememberRecentCustomer, selectedBonusReferrer?.id]
  );

  const applySelectedBonusReferrer = useCallback((customer: Customer | null) => {
    setSelectedBonusReferrer(customer);
    setBonusReferrerComboboxOpen(false);
    setBonusReferrerSearchTerm('');
  }, []);

  const printReceipt = useCallback(
    async (data: NonNullable<typeof receiptData>, opts?: { silent?: boolean }) => {
      if (isPrintingReceipt) return;
      setIsPrintingReceipt(true);
      try {
        const agentHealth = await getPrintAgentHealth(1500);
        if (!agentHealth && !opts?.silent) {
          toast({
            variant: 'destructive',
            title: t('pos.device_bar.print_agent_down', { defaultValue: 'Printer offline' }),
            description: t('pos.device_status.print_offline_before_receipt', {
              defaultValue: 'Chop etish agenti ulanmagan. Chek brauzer orqali ochilishi mumkin.',
            }),
          });
        }
        try {
          await printPosCustomerReceiptEscpos(data, companySettings, receiptSettings);
          if (!opts?.silent) {
            toast({
              title: 'Chek',
              description: 'Mijoz cheki printerga yuborildi',
            });
          }
          return;
        } catch (escposError) {
          console.warn('[Print] ESC/POS failed, falling back to HTML print', escposError);
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
          loyalty_card_code: data.loyaltyCardCode || null,
          loyalty_qr_data_url: data.loyaltyQrDataUrl || null,
          loyalty_qr_payload: data.loyaltyQrPayload || null,
          customer: data.customer
            ? {
                name: data.customer.name,
                phone: (data.customer as any).phone,
                balance: Number((data.customer as any).balance || 0),
              }
            : null,
          items: (data.items || []).map((it: any, idx: number) => {
            const qty = Number(it.qty_sale ?? it.quantity ?? 0);
            const lineTotal = Number(it.subtotal ?? 0) - Number(it.discount_amount ?? 0);
            return {
              id: `${idx}`,
              product_name: it.product?.name,
              unit_price: Number(it.unit_price ?? it.product?.sale_price ?? 0),
              quantity: qty,
              qty_sale: qty,
              line_total: lineTotal,
              subtotal: Number(it.subtotal ?? 0),
              discount_amount: Number(it.discount_amount ?? 0),
              sale_unit: it.sale_unit || it.product?.unit,
              product: { sku: it.product?.sku },
            };
          }),
          payments: [{ payment_method: String(data.paymentMethod || '').toLowerCase(), amount: Number(data.paidAmount || 0) }],
        };

        const activeTemplate = getActiveReceiptTemplate(receiptTemplateStore);
        if (activeTemplate) {
          const mergedTemplate = receiptSettings
            ? applyReceiptSettingsToTemplate(activeTemplate, receiptSettings)
            : activeTemplate;
          const htmlContent = renderReceiptTemplate(mergedTemplate, order as any, companySettings || undefined, undefined, {
            middleText: receiptSettings?.middle_text?.trim() || undefined,
          });
          openPrintWindow(htmlContent, `${mergedTemplate.paperWidth}mm` as '58mm' | '78mm' | '80mm');
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
        if (!opts?.silent) {
          toast({
            title: 'Chek',
            description: 'Chek chop etish oynasi ochildi (printer ulanmagan bo‘lishi mumkin)',
          });
        }
      } catch (e: any) {
        toast({
          title: 'Print xatoligi',
          description: e?.message || 'Chekni chop etib bo‘lmadi',
          variant: 'destructive',
        });
      } finally {
        setIsPrintingReceipt(false);
      }
    },
    [companySettings, receiptSettings, receiptTemplateStore, toast, isPrintingReceipt, t]
  );

  const handlePrintLastReceipt = useCallback(() => {
    if (!lastReceiptData || isPrintingReceipt) return;
    void printReceipt(lastReceiptData as NonNullable<typeof receiptData>);
  }, [lastReceiptData, isPrintingReceipt, printReceipt]);

  const buildLoyaltyReceiptMeta = useCallback(async (customer: Customer | null) => {
    if (!customer?.id) return { loyaltyCardCode: undefined, loyaltyQrDataUrl: undefined, loyaltyQrPayload: undefined };
    try {
      const api = getElectronAPI();
      if (!api?.customers?.getLoyaltyCard) return { loyaltyCardCode: undefined, loyaltyQrDataUrl: undefined, loyaltyQrPayload: undefined };
      const card = await handleIpcResponse<any | null>(api.customers.getLoyaltyCard(customer.id));
      const loyaltyCardCode = String(card?.loyalty_card_code || '').trim();
      const qrPayload = String(card?.qr_payload || '').trim();
      if (!loyaltyCardCode || !qrPayload) {
        return { loyaltyCardCode: undefined, loyaltyQrDataUrl: undefined, loyaltyQrPayload: undefined };
      }
      const loyaltyQrDataUrl = await QRCode.toDataURL(qrPayload, { width: 180, margin: 1 });
      return { loyaltyCardCode, loyaltyQrDataUrl, loyaltyQrPayload: qrPayload };
    } catch {
      return { loyaltyCardCode: undefined, loyaltyQrDataUrl: undefined, loyaltyQrPayload: undefined };
    }
  }, []);

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

  const mergePromoAppliedCart = useCallback((baseCart: CartItem[], promoApplied: unknown[]) => {
    const applied = Array.isArray(promoApplied) ? promoApplied : [];
    let j = 0;
    const merged = baseCart.map((orig: any) => {
      if (orig?.is_price_overridden || orig?.price_source === 'manual') return orig;
      const appliedLine = applied[j++];
      if (!appliedLine || typeof appliedLine !== 'object') return orig;
      const pl = appliedLine as Record<string, unknown>;
      const { product: _ignoredProduct, ...rest } = pl as { product?: unknown };
      return { ...orig, ...rest, product: orig.product };
    });
    const promoEligibleCount = baseCart.filter(
      (it: any) => !(it?.is_price_overridden || it?.price_source === 'manual')
    ).length;
    if (applied.length !== promoEligibleCount) {
      console.warn('[POS] promotions apply length mismatch', {
        applied: applied.length,
        eligible: promoEligibleCount,
      });
    }
    return merged;
  }, []);

  /** Flush debounced promo IPC before checkout so F9/F10 cannot skip pending promotions. */
  const resolveCheckoutCart = useCallback(async (): Promise<CartItem[]> => {
    if (promoApplyTimerRef.current != null) {
      window.clearTimeout(promoApplyTimerRef.current);
      promoApplyTimerRef.current = null;
    }
    const currentCart = cartRef.current;
    if (currentCart.length === 0) return [];
    if (currentCart.some((it) => (Number(it.qty_sale ?? it.quantity ?? 0) || 0) < 0)) {
      return currentCart;
    }
    const code = promoCodeInput.trim() || null;
    const promoEligibleCart = currentCart.filter(
      (it: any) => !(it?.is_price_overridden || it?.price_source === 'manual')
    );
    try {
      const promoApplied = await applyPromotionsToCart(
        promoEligibleCart,
        selectedCustomer?.id ?? null,
        code
      );
      const merged = mergePromoAppliedCart(currentCart, promoApplied);
      setCartWithPromos(merged);
      return merged;
    } catch {
      const cached = cartWithPromosRef.current;
      return cached.length === currentCart.length ? cached : currentCart;
    }
  }, [mergePromoAppliedCart, promoCodeInput, selectedCustomer?.id]);

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
    const promoEligibleCart = cart.filter(
      (it: any) => !(it?.is_price_overridden || it?.price_source === 'manual')
    );
    const timer = window.setTimeout(() => {
      applyPromotionsToCart(promoEligibleCart, selectedCustomer?.id ?? null, code)
        .then((promoApplied) => {
          setCartWithPromos(mergePromoAppliedCart(cart, promoApplied));
        })
        .catch(() => setCartWithPromos(cart));
    }, POS_PROMO_APPLY_DEBOUNCE_MS);
    promoApplyTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (promoApplyTimerRef.current === timer) promoApplyTimerRef.current = null;
    };
  }, [cart, selectedCustomer?.id, debouncedPromoCode, mergePromoAppliedCart]);

  // If we came back from CustomerForm (?from=pos), auto-select the newly created customer.
  useEffect(() => {
    try {
      const lastCreatedId = localStorage.getItem('pos:lastCreatedCustomerId');
      if (!lastCreatedId) return;
      if (!customers || customers.length === 0) return;

      const found = customers.find((c) => c.id === lastCreatedId);
      if (found) {
        applySelectedCustomer(found);
        localStorage.removeItem('pos:lastCreatedCustomerId');
      }
    } catch {
      // ignore
    }
  }, [customers, applySelectedCustomer]);

  const recentCustomers = useMemo(
    () =>
      recentCustomerIds
        .map((id) => customers.find((c) => c.id === id))
        .filter((c): c is Customer => Boolean(c))
        .slice(0, 4),
    [recentCustomerIds, customers]
  );

  const bonusReferrerCandidates = useMemo(() => {
    const buyerId = selectedCustomer?.id ?? null;
    return customers
      .filter((customer) => !isWalkInCustomer(customer))
      .filter((customer) => customer.id !== buyerId)
      .filter((customer) => {
        if (!bonusReferrerSearchTerm) return true;
        const searchLower = bonusReferrerSearchTerm.toLowerCase();
        return (
          customer.name.toLowerCase().includes(searchLower) ||
          (customer.phone && customer.phone.toLowerCase().includes(searchLower)) ||
          customer.id.toLowerCase().includes(searchLower)
        );
      })
      .sort((a, b) => {
        if (!bonusReferrerSearchTerm) {
          const aMaster = String((a as { pricing_tier?: string }).pricing_tier || '') === 'master' ? 1 : 0;
          const bMaster = String((b as { pricing_tier?: string }).pricing_tier || '') === 'master' ? 1 : 0;
          if (aMaster !== bMaster) return bMaster - aMaster;
        }
        return a.name.localeCompare(b.name);
      });
  }, [customers, selectedCustomer?.id, bonusReferrerSearchTerm, isWalkInCustomer]);

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
      setSelectedBonusReferrer((prev) => {
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
        warehouse_id: posWarehouseId,
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
  }, [posWarehouseId]);

  const loadScanIndex = useCallback(async () => {
    try {
      setScanIndexLoading(true);
      scanIndexReadyRef.current = false;
      const PAGE_SIZE = 10000;
      const results: Product[] = [];
      let offset = 0;
      for (;;) {
        const batch = await getProductsScanIndex({
          warehouse_id: posWarehouseId,
          limit: PAGE_SIZE,
          offset,
          status: 'active',
        });
        results.push(...(batch as Product[]));
        if (batch.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      const nextIndex = buildProductScanIndex(results);
      scanIndexRef.current = nextIndex;
      barcodeIndexRef.current = nextIndex.barcode;
      skuIndexRef.current = nextIndex.sku;
      scanIndexReadyRef.current = true;
      setScanIndexLoading(false);
      const queued = pendingScansRef.current.splice(0);
      for (const item of queued) {
        void handleBarcodeSearchRef.current(item.rawInput, item.opts);
      }
    } catch (error) {
      console.error('Error loading scan index:', error);
      setScanIndexLoading(false);
    }
  }, [posWarehouseId]);

  const loadAllProducts = useCallback(async () => {
    const gen = ++catalogLoadGenRef.current;
    try {
      // Full catalog for grid/search display (heavy joins); scan index loads separately via loadScanIndex.
      const PAGE_SIZE = 5000;
      const results: Product[] = [];
      let offset = 0;
      for (;;) {
        const batch = await getProducts(false, {
          warehouse_id: posWarehouseId,
          limit: PAGE_SIZE,
          offset,
          sortBy: 'name',
          sortOrder: 'asc',
          stockStatus: 'all',
        });
        results.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      if (gen !== catalogLoadGenRef.current) return;
      setAllProducts(results);
      setCatalogLoadError(null);
    } catch (error) {
      if (gen !== catalogLoadGenRef.current) return;
      console.error('Error loading all products:', error);
      // Never clear existing catalog on 502/timeout — cashiers must not see "0 products".
      setCatalogLoadError(
        t('pos.catalog_load_failed', {
          defaultValue: "Ma'lumot yuklanmadi. Server vaqtincha javob bermayapti.",
        })
      );
      try {
        const { extractHttpStatus, reportApiFailure } = await import('@/lib/apiFailureTelemetry');
        reportApiFailure({
          page: 'POSTerminal',
          apiUrl: 'pos:products:list',
          httpCode: extractHttpStatus(error),
          userRole: profile?.role || null,
          message: error instanceof Error ? error.message : String(error),
        });
      } catch {
        /* telemetry best-effort */
      }
    }
  }, [posWarehouseId, t, profile?.role]);

  const refreshCatalog = useCallback(async () => {
    await loadScanIndex();
    void loadAllProducts();
  }, [loadScanIndex, loadAllProducts]);

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
    void loadScanIndex();
    void loadAllProducts();
    loadHeldOrders();
    loadPriceTiers();
  }, [loadCustomers, loadCategories, loadFavoriteProducts, loadScanIndex, loadAllProducts, loadHeldOrders, loadPriceTiers]);

  useEffect(() => {
    return () => {
      persistPosNavCartDraft(buildNavCartDraft());
    };
  }, [buildNavCartDraft]);

  useEffect(() => {
    if (navCartDraftRestoredRef.current) return;
    if (allProducts.length === 0) return;
    if (cartRef.current.length > 0) return;
    try {
      if (
        sessionStorage.getItem('pos_import_order_id') ||
        sessionStorage.getItem('pos_import_quote_id')
      ) {
        return;
      }
    } catch {
      /* ignore */
    }
    const draft = readPosNavCartDraft();
    if (!draft?.lines?.length) return;

    const byId = new Map(allProducts.map((product) => [product.id, product]));
    const restored: CartItem[] = [];
    for (const line of draft.lines) {
      const product = byId.get(line.productId);
      if (!product) continue;
      restored.push({
        product,
        quantity: line.quantity,
        qty_sale: line.qty_sale ?? line.quantity,
        sale_unit: line.sale_unit,
        ratio_to_base: line.ratio_to_base,
        amend_original_qty_sale: line.amend_original_qty_sale,
        unit_price: line.unit_price,
        price_tier: line.price_tier,
        price_source: line.price_source as CartItem['price_source'],
        is_price_overridden: line.is_price_overridden,
        discount_amount: line.discount_amount,
        subtotal: line.subtotal,
        total: line.total,
      });
    }
    if (!restored.length) {
      clearPosNavCartDraft();
      return;
    }

    navCartDraftRestoredRef.current = true;
    setCart(restored);
    if (draft.customerId) {
      const customer = customers.find((entry) => entry.id === draft.customerId);
      if (customer) setSelectedCustomer(customer);
    }
    if (draft.bonusReferrerCustomerId) {
      const referrer = customers.find((entry) => entry.id === draft.bonusReferrerCustomerId);
      if (referrer) setSelectedBonusReferrer(referrer);
    }
    if (draft.discount) setDiscount(draft.discount);
    if (draft.promoCode) setPromoCodeInput(draft.promoCode);
    if (draft.saleCurrency) setSaleCurrency(draft.saleCurrency as PosSaleCurrency);
    if (draft.tierCode) {
      setCurrentTierCode(draft.tierCode as 'retail' | 'master' | 'wholesale' | 'marketplace');
    }
    const draftReplaces = draft.replacesOrderId ?? readPosReplacesOrderId();
    if (draftReplaces) {
      setImportedOrderIdForEdit(draftReplaces);
      persistPosReplacesOrderId(draftReplaces);
      setImportedOrderOutstandingDebt(
        Math.max(0, Number(draft.importedOrderOutstanding) || 0),
      );
      setImportedOrderNumberForEdit(
        typeof draft.replacesOrderNumber === 'string' && draft.replacesOrderNumber.length > 0
          ? draft.replacesOrderNumber
          : null,
      );
      setImportedHoldOrderId(null);
      setImportedHoldOrderNumber(null);
    } else if (draft.importedHoldOrderId) {
      setImportedHoldOrderId(draft.importedHoldOrderId);
      setImportedHoldOrderNumber(
        typeof draft.importedHoldOrderNumber === 'string' && draft.importedHoldOrderNumber.length > 0
          ? draft.importedHoldOrderNumber
          : null,
      );
      setImportedOrderIdForEdit(null);
      setImportedOrderOutstandingDebt(0);
      setImportedOrderNumberForEdit(null);
      persistPosReplacesOrderId(null);
    }
    if (Number(draft.loyaltyRedeemPoints) > 0) {
      setLoyaltyRedeemPoints(Math.floor(Number(draft.loyaltyRedeemPoints)));
    }
    toast({
      title: t('pos.cart_restored_title', 'Savat tiklandi'),
      description: t(
        'pos.cart_restored_desc',
        'Boshqa sahifaga o‘tib qaytganingizda savat saqlanib qoldi.',
      ),
    });
  }, [allProducts, customers, t, toast]);

  useEffect(() => {
    if (cart.length === 0) {
      if (navCartDraftRestoredRef.current || !readPosNavCartDraft()) {
        clearPosNavCartDraft();
      }
      return;
    }
    persistPosNavCartDraft(buildNavCartDraft());
  }, [
    cart,
    buildNavCartDraft,
    selectedCustomer,
    selectedBonusReferrer,
    discount,
    promoCodeInput,
    saleCurrency,
    currentTierCode,
    importedOrderIdForEdit,
    importedOrderOutstandingDebt,
    importedHoldOrderId,
    importedOrderNumberForEdit,
    importedHoldOrderNumber,
    loyaltyRedeemPoints,
  ]);

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
        const [company, receiptTemplates] = await Promise.all([
          getSettingsByCategory('company'),
          getSettingsByCategory('receipt_templates'),
        ]);
        if (cancelled) return;
        setCompanySettings(company as unknown as CompanySettings);
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

  const posTerminalSettings = usePosTerminalSettings();
  const paymentSettings = usePaymentSettings();
  const isPaymentEnabled = useCallback(
    (m: 'cash' | 'card' | 'qr' | 'credit' | 'terminal') => paymentSettings.methods.includes(m),
    [paymentSettings.methods],
  );
  const labelFor = useCallback(
    (m: 'cash' | 'card' | 'qr' | 'credit' | 'terminal', fallback: string) =>
      resolvePaymentLabel(paymentSettings, m, fallback),
    [paymentSettings],
  );

  const quickProducts = useMemo(() => {
    const byId = new Map(allProducts.map((product) => [product.id, product]));
    const limit = posTerminalSettings.quick_access_limit;
    return quickProductIds
      .slice(0, limit)
      .map((id) => byId.get(id))
      .filter(Boolean) as Product[];
  }, [allProducts, quickProductIds, posTerminalSettings.quick_access_limit]);

  useEffect(() => {
    try {
      localStorage.setItem(POS_QUICK_PRODUCT_IDS_KEY, JSON.stringify(quickProductIds));
    } catch {
      // Local shortcut preferences are optional.
    }
  }, [quickProductIds]);

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

  // normalizeSearchTerm / normalizeSku / normalizeText / classifyQuery —
  // ./posTerminalHelpers dan import qilinadi.

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

  // --- Qidiruvni tezlashtirish ---
  // Har mahsulotning normalizatsiyalangan qidiruv maydonlarini BIR MARTA hisoblaymiz
  // (mahsulotlar ro'yxati o'zgarganda), har tugma bosilganda emas.
  type PosSearchEntry = {
    product: Product;
    skuNormalized: string;
    barcode: string;
    nameLower: string;
    normArticle: string;
    brandLower: string;
  };
  const searchIndex = useMemo<PosSearchEntry[]>(
    () =>
      allProducts.map((product) => ({
        product,
        skuNormalized: normalizeSku(String(product.sku || '')),
        barcode: String((product as any).barcode || '').trim(),
        nameLower: String(product.name || '').toLowerCase(),
        normArticle: String(product.article ?? '')
          .toLowerCase()
          .replace(/[\s\-_]/g, ''),
        brandLower: String(product.brand ?? '').trim().toLowerCase(),
      })),
    [allProducts],
  );
  // Fuzzy (xato yozuvga chidamli) qidiruv uchun Fuse indeksini ham bir marta quramiz.
  const productsFuse = useMemo(
    () =>
      new Fuse(allProducts, {
        keys: ['name', 'sku', 'article', 'brand'],
        threshold: 0.4,
        includeScore: true,
        minMatchCharLength: 2,
      }),
    [allProducts],
  );

  const getRankedSearchResults = (term: string, categoryId: string | null) => {
    const query = classifyQuery(term);
    if (!query.raw) return [];
    const tokens = query.lower.split(/\s+/).filter(Boolean);

    const scored = searchIndex
      .filter((e) => productMatchesCategoryFilter(e.product.category_id, categoryId, categories))
      .map(({ product, skuNormalized, barcode, nameLower, normArticle, brandLower }) => {
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

        if (brandLower) {
          if (brandLower === query.lower) {
            score += 600;
            matched = true;
          } else if (brandLower.startsWith(query.lower)) {
            score += 350;
            matched = true;
          } else if (brandLower.includes(query.lower) || tokens.some((token) => brandLower.includes(token))) {
            score += 180;
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

    // Exact SKU / barcode / article: do not mix in fuzzy/partial noise
    const exactHits = directResults.filter((p) => {
      const skuN = normalizeSku(String(p.sku || ''));
      const bc = String((p as { barcode?: string | null }).barcode || '').trim().toLowerCase();
      const art = normalizeArticle(String((p as { article?: string | null }).article || ''));
      return (
        (skuN && skuN === query.normalizedSku) ||
        (bc && bc === query.raw.toLowerCase()) ||
        (art && art === query.normalizedSku)
      );
    });
    if (exactHits.length > 0) {
      return exactHits;
    }

    // Fuzzy fallback via keshlangan Fuse.js (xato yozuvlarni ushlaydi).
    // Indeks bir marta qurilgan; kategoriya filtri natijaga qo'llanadi.
    if (directResults.length < 3 && query.lower.length >= 2) {
      const fuzzyHits = productsFuse.search(query.lower, { limit: 40 });
      const directIds = new Set(directResults.map((p) => p.id));
      const fuzzyExtra = fuzzyHits
        .map((r) => r.item)
        .filter((p) => !directIds.has(p.id))
        .filter((p) =>
          categoryId ? productMatchesCategoryFilter(p.category_id, categoryId, categories) : true,
        );
      return [...directResults, ...fuzzyExtra].slice(0, 20);
    }

    return directResults;
  };

  const runSearch = async (term: string, categoryId: string | null) => {
    const currentSeq = ++searchSeqRef.current;
    const cacheKey = posSearchCache.buildKey(term, categoryId, posWarehouseId);
    const cached = posSearchCache.get<Product>(cacheKey);
    if (cached) {
      if (searchSeqRef.current === currentSeq) {
        setSearchResults(cached);
      }
      return;
    }
    const start = perfEnabled ? performance.now() : 0;
    try {
      const normalizedQuery = normalizeSearchTerm(term);
      let results = getRankedSearchResults(normalizedQuery, categoryId);
      if (results.length === 0 && term.trim().length >= 2) {
        const fallback = await searchProductsScreen(term, { warehouse_id: posWarehouseId });
        if (searchSeqRef.current !== currentSeq) return;
        results = categoryId
          ? fallback.filter((p) => productMatchesCategoryFilter(p.category_id, categoryId, categories))
          : fallback;
      }
      // Exact SKU/barcode wins over fuzzy/contains noise from any source
      results = filterPosProductsBySearchTerm(results, term);
      if (searchSeqRef.current === currentSeq) {
        posSearchCache.set(cacheKey, results);
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
    const SEARCH_DEBOUNCE_MS = 300;
    setSearchTerm(term);
    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (term.length < MIN_SEARCH_LENGTH) {
      setSearchResults([]);
      return;
    }
    // Scanner wedge in search box: skip fuzzy search for barcode-shaped input (Enter / global hook handles add).
    const q = classifyQuery(term);
    if (q.isBarcodeLike || (q.numericOnly && term.length >= 8)) {
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

  const cacheBarcodeLookup = useCallback((product: Product, matchKind: 'barcode' | 'sku', matchedKey: string) => {
    registerProductScanIndexes(product, barcodeIndexRef.current, skuIndexRef.current);
    const cache = barcodeCacheRef.current;
    const cacheKey = matchKind === 'barcode' ? `barcode:${matchedKey}` : `sku:${matchedKey}`;
    cache.set(cacheKey, product);
    barcodeCacheOrderRef.current.push(cacheKey);
    if (barcodeCacheOrderRef.current.length > 500) {
      const drop = barcodeCacheOrderRef.current.splice(0, 200);
      for (const dropKey of drop) cache.delete(dropKey);
    }
  }, []);

  const showScanAddFeedback = useCallback((product: Product, saleUnit?: string) => {
    const { saleUnit: unit } = getSaleUnitConfig(product, saleUnit);
    const barcode = String((product as { barcode?: string | null }).barcode || product.sku || '').trim();
    const cost =
      Number(
        (product as { cost_price?: number }).cost_price ??
          (product as { purchase_price?: number }).purchase_price ??
          0,
      ) || 0;
    const parts = [
      barcode || null,
      cost > 0 ? `tannarx ${formatMoneyUZS(cost)}` : null,
      formatUnit(unit) || unit,
    ].filter(Boolean);
    toast({
      title: `✓ ${product.name}`,
      description: parts.join(' · '),
      duration: 1800,
      className: 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
    });
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.value = 0.04;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.07);
        void ctx.close?.();
      }
    } catch {
      /* audio optional */
    }
    focusSearchInput();
  }, [toast, focusSearchInput]);

  const tryLocalScanLookup = useCallback((rawInput: string): Product | null => {
    const indexHit = lookupProductByScanCode(rawInput, scanIndexRef.current);
    if (indexHit) return indexHit.product;
    const cache = barcodeCacheRef.current;
    for (const key of collectScanLookupKeys(rawInput)) {
      const cached = cache.get(`barcode:${key}`) || cache.get(`sku:${key}`);
      if (cached) return cached;
    }
    return null;
  }, []);

  const handleBarcodeSearch = async (barcode: string, opts?: { clearSearch?: boolean }) => {
    let perfStart = 0;
    let perfNote = 'lookup';
    const rawInput = String(barcode || '').trim();
    if (!rawInput) return;

    if (!scanIndexReadyRef.current) {
      pendingScansRef.current.push({ rawInput, opts });
      return;
    }

    const now = Date.now();
    if (rawInput === lastScanDedupeRef.current.raw && now - lastScanDedupeRef.current.at < 80) {
      if (perfEnabled) console.debug('[POS PERF] scan deduped');
      return;
    }
    lastScanDedupeRef.current = { raw: rawInput, at: now };

    const lookupKeys = collectScanLookupKeys(rawInput);
    const digitsOnly = rawInput.replace(/[^\d]/g, '');
    const clearSearch = opts?.clearSearch ?? true;
    const resetSearch = () => {
      if (!clearSearch) return;
      setSearchTerm('');
      setSearchResults([]);
    };

    try {
      perfStart = perfEnabled ? performance.now() : 0;
      const scanUpper = rawInput.toUpperCase();
      const looksLikeLoyaltyPayload =
        scanUpper.startsWith('LOYALTY:') || scanUpper.startsWith('LC-');
      if (looksLikeLoyaltyPayload) {
        perfNote = 'loyalty';
        const api = getElectronAPI();
        if (api?.customers?.getByLoyaltyQr) {
          const found = await handleIpcResponse<Customer | null>(
            api.customers.getByLoyaltyQr(rawInput),
          );
          if (found) {
            applySelectedCustomer(found);
            toast({
              title: "Mijoz tanlandi",
              description: `${found.name}${found.phone ? ` (${found.phone})` : ''}`,
            });
            resetSearch();
            return;
          }
        }
        toast({
          title: "Loyalty karta topilmadi",
          description: `Kod: ${rawInput}`,
          variant: 'destructive',
        });
        resetSearch();
        return;
      }

      const localProduct = tryLocalScanLookup(rawInput);
      if (localProduct) {
        perfNote = 'index';
        showScanAddFeedback(localProduct);
        void addToCart(localProduct, 1);
        resetSearch();
        return;
      }

      // Scale EAN-13 (variable weight): PP + PLU(5) + WEIGHT(5) + check
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

        let byPlu: Product | null = null;
        for (const candidate of pluCandidates) {
          byPlu = tryLocalScanLookup(candidate);
          if (byPlu) break;
        }
        if (!byPlu) {
          const pluHit = await resolveProductScan(pluCandidates, { warehouse_id: posWarehouseId }).catch(
            () => null,
          );
          if (pluHit?.product) {
            byPlu = pluHit.product as Product;
            cacheBarcodeLookup(byPlu, pluHit.matchKind, pluHit.matchedKey);
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
          showScanAddFeedback(byPlu as Product, String(matchedUnit));
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

      // 2) Normal barcode lookup — single batched IPC fallback on index miss
      const resolved = await resolveProductScan(lookupKeys, { warehouse_id: posWarehouseId }).catch(
        () => null,
      );
      if (resolved?.product) {
        perfNote = 'rpc';
        cacheBarcodeLookup(resolved.product, resolved.matchKind, resolved.matchedKey);
        showScanAddFeedback(resolved.product);
        void addToCart(resolved.product, 1);
        resetSearch();
        return;
      }

      // Not found -> show feedback and clear (scanner flow); do not pollute Recent
      perfNote = 'miss';
      toast({
        title: t('pos.product_not_found', { defaultValue: 'Mahsulot topilmadi' }),
        description: `Kod: ${rawInput}`,
        variant: 'destructive',
      });
      resetSearch();
      focusSearchInput();
    } catch (error) {
      console.error('Error searching by barcode:', error);
    } finally {
      if (perfEnabled && perfStart) {
        const ms = Math.round(performance.now() - perfStart);
        console.debug(`[POS PERF] scan ${perfNote} → ${ms}ms`);
      }
    }
  };

  handleBarcodeSearchRef.current = handleBarcodeSearch;

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
    maxIntervalMs: 40,
    idleTimeoutMs: 60,
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
      const key = `${product.id}::${tierCode}::${unit}::${saleCurrency}`;
      const cached = priceCacheRef.current.get(key);
      if (cached != null) return cached;
      const price = await getProductTierPrice({
        product_id: product.id,
        tier_code: tierCode,
        currency: saleCurrency,
        unit,
      });
      if (price != null) {
        const n = Number(price || 0) || 0;
        priceCacheRef.current.set(key, n);
        priceCacheRef.current.set(`${product.id}::${tierCode}::${unit}`, n);
      }
      return price;
    },
    [saleCurrency]
  );

  const effectiveCart = cartWithPromos.length === cart.length ? cartWithPromos : cart;

  const cartDisplay = useMemo(() => {
    const start = perfEnabled ? performance.now() : 0;
    const items = effectiveCart.map((item, index) => {
      // purchase_price is always stored in UZS; convert when cart is in USD
      const costPriceUzs = Number(item.product.purchase_price || 0);
      const costPrice =
        saleCurrency === 'USD'
          ? convertAtRate(costPriceUzs, 'UZS', 'USD', saleFxRate)
          : costPriceUzs;
      const qtyForCost = Number(item.qty_sale ?? item.quantity ?? 0) || 0;
      const finalPricePerUnit =
        qtyForCost !== 0 ? item.total / qtyForCost : Number(item.unit_price || 0);
      const isBelowCost = qtyForCost > 0 && finalPricePerUnit < costPrice;
      const unit = item.sale_unit || item.product.unit;
      const baseUnit = getBaseUnit(item.product) || (item.product as any)?.base_unit || item.product.unit;
      const quantityStep = getQuantityStep(unit);
      const quantityMin = getQuantityMin(unit);
      const inputMode: 'decimal' | 'numeric' = isFractionalUnit(unit) ? 'decimal' : 'numeric';
      const displayQuantity =
        editingQuantity[item.product.id] !== undefined
          ? editingQuantity[item.product.id]
          : formatQuantity((item.qty_sale ?? item.quantity) || quantityMin, unit);
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
  }, [effectiveCart, editingQuantity, selectedCartIndex, perfEnabled, saleCurrency, saleFxRate]);

  // Recalculate cart prices when customer/tier/sale currency changes
  useEffect(() => {
    if (saleCurrency === 'USD' && (!saleFxRate || saleFxRate <= 0)) return;
    let cancelled = false;
    void (async () => {
      const items = cartRef.current;
      if (items.length === 0) return;
      const mapped = await Promise.all(
        items.map(async (item) => {
          const qtySale = Number(item.qty_sale ?? item.quantity ?? 0) || 0;
          const qtyBase = Number(item.qty_base ?? 0) || 0;
          const ratioToBase = Number(item.ratio_to_base ?? 1) || 1;
          const saleUnit = item.sale_unit || item.product.unit;
          const effectiveTier = String(
            (selectedCustomer as any)?.pricing_tier || currentTierCode || 'retail'
          );
          if (item.is_price_overridden || item.price_source === 'manual') {
            const unitPrice = Number(item.unit_price || 0) || 0;
            const subtotal = unitPrice * qtySale;
            const lineDiscount = qtySale < 0 ? 0 : Math.min(item.discount_amount || 0, subtotal);
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
          if (
            saleCurrency === 'USD' &&
            effectiveTier !== 'retail' &&
            effectiveTier !== 'master'
          ) {
            void fetchTierPrice(item.product, effectiveTier, saleUnit);
          }
          const { sale_price: uzsUnitPriceRaw } = getSaleUnitConfig(item.product, saleUnit);
          let baseUnitPrice =
            Number(uzsUnitPriceRaw ?? (item.product as any)?.sale_price ?? item.unit_price ?? 0) ||
            0;
          if (saleCurrency === 'USD') {
            const fx = Number(saleFxRate || 0);
            if (effectiveTier === 'master') {
              const masterPriceRaw = (item.product as any)?.master_price;
              const masterPrice =
                masterPriceRaw === null || masterPriceRaw === undefined
                  ? null
                  : Number(masterPriceRaw);
              if (masterPrice !== null && Number.isFinite(masterPrice) && fx > 0) {
                baseUnitPrice = (masterPrice * ratioToBase) / fx;
              } else if (fx > 0) {
                baseUnitPrice = baseUnitPrice / fx;
              }
            } else if (effectiveTier === 'retail') {
              const uzsForCompare =
                Number(uzsUnitPriceRaw ?? (item.product as any)?.sale_price ?? 0) || 0;
              const storedUsd =
                usdRetailByProductId[item.product.id] ??
                priceCacheRef.current.get(`${item.product.id}::retail::${saleUnit}::USD`) ??
                null;
              const resolved = resolveUsdRetailDisplay(baseUnitPrice, storedUsd, fx);
              if (resolved != null && resolved > 0) {
                baseUnitPrice = resolved;
              } else if (fx > 0) {
                baseUnitPrice = baseUnitPrice / fx;
              }
              if (!isPlausibleUsdRetail(storedUsd, uzsForCompare)) {
                void getProductTierPrice({
                  product_id: item.product.id,
                  tier_code: 'retail',
                  currency: 'USD',
                  unit: saleUnit,
                }).then((fetched) => {
                  const exact = fetched != null ? Number(fetched) : 0;
                  if (isPlausibleUsdRetail(exact, uzsForCompare)) {
                    priceCacheRef.current.set(`${item.product.id}::retail::${saleUnit}::USD`, exact);
                    setUsdRetailByProductId((prev) =>
                      prev[item.product.id] === exact ? prev : { ...prev, [item.product.id]: exact }
                    );
                  }
                });
              }
            } else {
              const tierKey = `${item.product.id}::${effectiveTier}::${saleUnit}::${saleCurrency}`;
              const tierCached = priceCacheRef.current.get(tierKey);
              baseUnitPrice =
                tierCached != null && tierCached > 0
                  ? tierCached
                  : fx > 0
                    ? baseUnitPrice / fx
                    : baseUnitPrice;
            }
          }
          const { unitPrice, priceTier } = getLinePricing(
            item.product,
            qtyBase || qtySale,
            selectedCustomer,
            baseUnitPrice,
            ratioToBase,
            saleUnit
          );
          const subtotal = unitPrice * qtySale;
          const lineDiscount = qtySale < 0 ? 0 : Math.min(item.discount_amount || 0, subtotal);
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
      if (cancelled) return;
      // Preserve erkin narx if cashier applied it while this async recalc was in flight.
      setCart((liveCart) => {
        if (liveCart.length === 0) return liveCart;
        const liveByKey = new Map(
          liveCart.map((it) => {
            const unit = it.sale_unit || it.product.unit || '';
            return [`${it.product.id}::${unit}`, it] as const;
          })
        );
        return mapped.map((m) => {
          const unit = m.sale_unit || m.product.unit || '';
          const live = liveByKey.get(`${m.product.id}::${unit}`);
          if (live && (live.is_price_overridden || live.price_source === 'manual')) {
            return live;
          }
          return m;
        });
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    selectedCustomer,
    currentTierCode,
    saleCurrency,
    saleFxRate,
    getLinePricing,
    fetchTierPrice,
    usdRetailByProductId,
  ]);

  // getProductUnits — ./posTerminalHelpers dan import qilinadi.

  const getTierLabel = useCallback(
    (code?: string | null) => {
      if (!code) return 'Retail';
      const found = priceTiers.find((t) => t.code === code);
      return found?.name || String(code);
    },
    [priceTiers]
  );

  const renderPromotionBadges = (item: any) => {
    if (!(item?.price_source === 'promo' || item?.promotion_name)) return null;
    const names = String(item?.promotion_name || 'Aksiya')
      .split('+')
      .map((x) => x.trim())
      .filter(Boolean);
    const uniqueNames = [...new Set(names)];
    return uniqueNames.map((name, idx) => (
      <span key={`${name}-${idx}`} className="text-[9px] text-emerald-600 dark:text-emerald-400">
        {name}
      </span>
    ));
  };

  // getSaleUnitConfig / toBaseQty / getMaxSaleQty / getProbeSaleQtyForUnitPrice —
  // ./posTerminalHelpers dan import qilinadi.

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

  const requestAddToCart = useCallback(async (product: Product) => {
    const resolvedProduct = await resolveProductForCart(product);
    if (!exchangeReturnMode && isOutOfStockForSale(resolvedProduct)) {
      toast({
        title: t('pos.stock_insufficient_title', { defaultValue: 'Yetarli qoldiq yo‘q' }),
        description: t('pos.stock_zero_blocked', {
          defaultValue: '{{name}}: omborda qoldiq 0',
          name: resolvedProduct.name,
        }),
        variant: 'destructive',
      });
      return;
    }
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
  }, [selectedCustomer, getLinePricing, exchangeReturnMode, toast, t]);

  const quickAddOneToCart = useCallback(async (product: Product) => {
    const resolvedProduct = await resolveProductForCart(product);
    if (!exchangeReturnMode && isOutOfStockForSale(resolvedProduct)) {
      toast({
        title: t('pos.stock_insufficient_title', { defaultValue: 'Yetarli qoldiq yo‘q' }),
        description: t('pos.stock_zero_blocked', {
          defaultValue: '{{name}}: omborda qoldiq 0',
          name: resolvedProduct.name,
        }),
        variant: 'destructive',
      });
      focusSearchInput();
      return;
    }
    if (canQuickAddWithoutNumpad(resolvedProduct)) {
      void addToCartRef.current(resolvedProduct, getQuickAddSaleQty(resolvedProduct));
    } else {
      await requestAddToCart(resolvedProduct);
    }
    focusSearchInput();
  }, [focusSearchInput, requestAddToCart, exchangeReturnMode, toast, t]);

  const addToCart = async (product: Product, quantity: number = 1, saleUnit?: string) => {
    const perfStart = perfEnabled ? performance.now() : 0;
    // Fresh manual sale: drop stale amend/hold context left in sessionStorage.
    if (
      cartRef.current.length === 0 &&
      !importedOrderIdForEditRef.current &&
      !importedHoldOrderIdRef.current
    ) {
      persistPosReplacesOrderId(null);
    }
    const qtySaleRaw = Number(quantity || 0) || 0;
    const { saleUnit: resolvedUnit, ratio_to_base, sale_price } = getSaleUnitConfig(product, saleUnit);
    if (qtySaleRaw <= 0) return;
    if ((product as any)?.is_active === false) {
      toast({
        title: "Mahsulot faol emas",
        description: "Arxivlangan mahsulotni savatchaga qo'shib bo'lmaydi.",
        variant: 'destructive',
      });
      return;
    }
    if (isProductPriceNotSet(product as any)) {
      toast({
        title: t('products.price_not_set', { defaultValue: 'Price not set' }),
        description: t('products.price_not_set_hint', {
          defaultValue: 'Set a sale price or enable free sale before selling.',
        }),
        variant: 'destructive',
      });
      return;
    }
    if (!productTracksStock(product) && posTerminalSettings.show_low_stock_warning) {
      toast({
        title: t('products.stock_not_tracked', { defaultValue: 'Stock not tracked' }),
        description: t('products.stock_not_tracked_hint', {
          defaultValue: 'This product does not track inventory.',
        }),
      });
    }
    const sign = getCartLineQuantitySign(exchangeReturnMode);
    const unit = resolvedUnit;
    const existingItem = cartRef.current.find(
      (item) =>
        item.product.id === product.id &&
        (item.sale_unit || item.product.unit) === unit
    );
    let validQuantity = clampQuantityForUnit(qtySaleRaw, unit) * sign;
    let stockLimitToast: { title: string; description: string } | null = null;
    let lowStockToast: { title: string; description: string } | null = null;
    if (validQuantity > 0 && productTracksStock(product)) {
      const maxAllowed = getMaxSaleQty(product, ratio_to_base, unit);
      const existingSaleQty = existingItem
        ? Math.max(0, Number(existingItem.qty_sale ?? existingItem.quantity ?? 0) || 0)
        : 0;
      const room = maxAllowed - existingSaleQty;
      if (maxAllowed <= 0 || room <= 0) {
        toast({
          title: t('pos.stock_insufficient_title', { defaultValue: 'Yetarli qoldiq yo‘q' }),
          description: t('pos.stock_insufficient_desc', {
            defaultValue: '{{name}}: so‘ralgan {{requested}}, mavjud {{available}}',
            name: product.name,
            requested: formatQuantity(validQuantity + existingSaleQty, unit),
            available: formatQuantity(Math.max(0, maxAllowed), unit),
          }),
          variant: 'destructive',
        });
        return;
      }
      if (validQuantity > room) {
        toast({
          title: t('pos.stock_insufficient_title', { defaultValue: 'Yetarli qoldiq yo‘q' }),
          description: t('pos.stock_insufficient_desc', {
            defaultValue: '{{name}}: so‘ralgan {{requested}}, mavjud {{available}}',
            name: product.name,
            requested: formatQuantity(validQuantity + existingSaleQty, unit),
            available: formatQuantity(maxAllowed, unit),
          }),
          variant: 'destructive',
        });
        return;
      }
      if (
        posTerminalSettings.show_low_stock_warning &&
        (product as any)?.track_stock !== false
      ) {
        const remainingBase =
          (Number(product.current_stock || 0) || 0) -
          toBaseQty(validQuantity + existingSaleQty, ratio_to_base);
        const minStock = Number((product as any)?.min_stock_level || 0) || 0;
        const threshold = minStock > 0 ? minStock : 10;
        if (remainingBase >= 0 && remainingBase <= threshold) {
          lowStockToast = {
            title: 'Kam zaxira',
            description: `${product.name}: qoldiq ${formatQuantity(remainingBase, unit)} (minimal ${formatQuantity(threshold, unit)})`,
          };
        }
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
      queueMicrotask(() => {
        if (stockLimitToast) toast({ ...stockLimitToast, variant: 'destructive' });
        if (lowStockToast) toast(lowStockToast);
      });
      return;
    }
    const qtyBase = toBaseQty(validQuantity, ratio_to_base);
    let unitSalePrice = sale_price;
    const effectiveTier = ((selectedCustomer as any)?.pricing_tier || currentTierCode || 'retail') as string;
    if (effectiveTier !== 'retail' && effectiveTier !== 'master' && saleCurrency !== 'USD') {
      const tierKey = `${product.id}::${effectiveTier}::${resolvedUnit}::${saleCurrency}`;
      const tierCached = priceCacheRef.current.get(tierKey);
      if (tierCached != null && tierCached > 0) {
        unitSalePrice = tierCached;
      } else {
        // Fast path: use unit sale price immediately; refine tier price in background (don't block scans).
        void fetchTierPrice(product, effectiveTier, resolvedUnit).then((fetched) => {
          const exact = fetched != null ? Number(fetched) : 0;
          if (exact <= 0) return;
          priceCacheRef.current.set(tierKey, exact);
          setCart((prev) => {
            const idx = prev.findIndex(
              (item) =>
                item.product.id === product.id &&
                (item.sale_unit || item.product.unit) === unit &&
                !item.is_price_overridden &&
                item.price_source !== 'manual',
            );
            if (idx < 0) return prev;
            const item = prev[idx];
            const qtySale = Number(item.qty_sale ?? item.quantity ?? 0) || 0;
            const qtyBase = Number(item.qty_base ?? 0) || toBaseQty(qtySale, ratio_to_base);
            const { unitPrice, priceTier } = getLinePricing(
              product,
              qtyBase,
              selectedCustomer,
              exact,
              ratio_to_base,
              resolvedUnit,
            );
            const subtotal = unitPrice * qtySale;
            const lineDiscount = qtySale < 0 ? 0 : item.discount_amount;
            const next = [...prev];
            next[idx] = {
              ...item,
              unit_price: unitPrice,
              price_tier: priceTier,
              subtotal,
              total: subtotal - lineDiscount,
            };
            return next;
          });
        });
      }
    } else if (
      effectiveTier !== 'retail' &&
      effectiveTier !== 'master' &&
      saleCurrency === 'USD'
    ) {
      void fetchTierPrice(product, effectiveTier, resolvedUnit);
    }
    if (saleCurrency === 'USD') {
      const fx = Number(saleFxRate || 0);
      if (!Number.isFinite(fx) || fx <= 0) {
        toast({
          title: 'Valyuta kursi yo‘q',
          description: 'USD sotuv uchun kurs yuklanmaguncha kuting yoki UZS rejimiga qayting.',
          variant: 'destructive',
        });
        return;
      }
      if (effectiveTier === 'master') {
        const masterPriceRaw = (product as any)?.master_price;
        const masterPrice =
          masterPriceRaw === null || masterPriceRaw === undefined ? null : Number(masterPriceRaw);
        if (masterPrice !== null && Number.isFinite(masterPrice)) {
          unitSalePrice = (masterPrice * ratio_to_base) / fx;
        } else {
          unitSalePrice = sale_price / fx;
        }
      } else if (effectiveTier === 'retail') {
        const usdCacheKey = `${product.id}::retail::${resolvedUnit}::USD`;
        const storedUsd =
          usdRetailByProductId[product.id] ?? priceCacheRef.current.get(usdCacheKey) ?? null;
        const resolved = resolveUsdRetailDisplay(sale_price, storedUsd, fx);
        unitSalePrice = resolved != null && resolved > 0 ? resolved : sale_price / fx;
        if (!isPlausibleUsdRetail(storedUsd, sale_price)) {
          void getProductTierPrice({
            product_id: product.id,
            tier_code: 'retail',
            currency: 'USD',
            unit: resolvedUnit,
          }).then((fetched) => {
            const exact = fetched != null ? Number(fetched) : 0;
            if (isPlausibleUsdRetail(exact, sale_price)) {
              priceCacheRef.current.set(usdCacheKey, exact);
              setUsdRetailByProductId((prev) =>
                prev[product.id] === exact ? prev : { ...prev, [product.id]: exact }
              );
            }
          });
        }
      } else {
        const tierKey = `${product.id}::${effectiveTier}::${resolvedUnit}::${saleCurrency}`;
        const tierCached = priceCacheRef.current.get(tierKey);
        if (tierCached != null && tierCached > 0) {
          unitSalePrice = tierCached;
        } else {
          unitSalePrice = sale_price / fx;
          void fetchTierPrice(product, effectiveTier, resolvedUnit);
        }
      }
    }
    const { unitPrice, priceTier } = getLinePricing(
      product,
      qtyBase,
      selectedCustomer,
      unitSalePrice,
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
    queueMicrotask(() => {
      if (stockLimitToast) toast({ ...stockLimitToast, variant: 'destructive' });
      if (lowStockToast) toast(lowStockToast);
    });
  };
  addToCartRef.current = addToCart;

  const sanitizeWebOrderNamePart = useCallback((value: unknown): string => {
    const raw = String(value || '').trim();
    if (!raw || /^(nomalum|noma'lum|unknown|неизвестно|номаълум)$/i.test(raw)) return '';
    const map: Record<string, string> = {
      а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
      к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
      ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e',
      ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h',
    };
    return raw
      .split('')
      .map((ch) => {
        const lower = ch.toLowerCase();
        const out = map[lower];
        if (out == null) return ch;
        return ch === lower ? out : out.charAt(0).toUpperCase() + out.slice(1);
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }, []);

  const resolveWebOrderCustomerForPos = useCallback(async (order: Record<string, unknown>): Promise<Customer | null> => {
    const posCustomerId = String(order.pos_customer_id || '').trim();
    if (posCustomerId) {
      try {
        const linked = await getCustomerById(posCustomerId);
        if (linked) return linked;
      } catch {
        /* binding stale — fall through to phone/name match */
      }
    }

    const name = [order.first_name, order.last_name].map(sanitizeWebOrderNamePart).filter(Boolean).join(' ');
    const phone = String(order.phone || '').trim();
    const address = String(order.delivery_address || '').trim();
    const normalizedPhone = phone.replace(/\D/g, '');
    if (!name && !normalizedPhone) return null;

    try {
      const currentCustomers = await getCustomers();
      const found = currentCustomers.find((customer) => {
        const customerPhone = String(customer.phone || '').replace(/\D/g, '');
        if (normalizedPhone && customerPhone && customerPhone === normalizedPhone) return true;
        return !!name && customer.name.trim().toLowerCase() === name.toLowerCase();
      });
      if (found) {
        setCustomers(currentCustomers);
        return found;
      }

      const created = await createCustomer({
        name: name || `Onlayn mijoz ${phone}`,
        phone: phone || null,
        address: address || null,
        type: 'individual',
        pricing_tier: 'retail',
        allow_debt: false,
        status: 'active',
        notes: `Onlayn buyurtmadan yaratildi: #${String(order.id || '')}`,
      });
      setCustomers((prev) => {
        const exists = prev.some((customer) => customer.id === created.id);
        return exists ? prev : [created, ...prev];
      });
      return created;
    } catch (error) {
      console.warn('Failed to resolve web order customer for POS:', error);
      return null;
    }
  }, [sanitizeWebOrderNamePart]);

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

        const posCustomer = await resolveWebOrderCustomerForPos(order);
        if (posCustomer) {
          applySelectedCustomer(posCustomer);
        } else {
          resetCustomerSelection();
        }

        setCart(built);
        setDiscount({ type: 'amount', value: '' });
        setPromoCodeInput('');
        setLoyaltyRedeemPoints(0);
        setSelectedCartIndex(0);
        setImportedWebOrderId(webOrderId);

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
      resolveWebOrderCustomerForPos,
      applySelectedCustomer,
      resetCustomerSelection,
    ],
  );

  const importQuoteIntoCart = useCallback(
    async (quoteId: string) => {
      if (exchangeReturnMode) {
        toast({
          variant: 'destructive',
          title: t('common.error'),
          description: t('quotes.import_blocked_exchange_mode'),
        });
        return;
      }

      try {
        const quote = await getQuoteById(quoteId);
        if (!quote) {
          toast({
            variant: 'destructive',
            title: t('common.error'),
            description: t('quotes.not_found'),
          });
          return;
        }
        if (String(quote.status) === 'converted') {
          toast({
            variant: 'destructive',
            title: t('common.error'),
            description: t('quotes.import_blocked_converted'),
          });
          return;
        }

        const lines = Array.isArray((quote as { items?: unknown }).items)
          ? ((quote as { items: unknown[] }).items as Array<Record<string, unknown>>)
          : [];
        if (lines.length === 0) {
          toast({
            variant: 'destructive',
            title: t('common.error'),
            description: t('quotes.error_min_items'),
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
          const quoteUnit =
            typeof line.unit === 'string'
              ? line.unit
              : typeof (product as any).unit === 'string'
                ? (product as any).unit
                : undefined;
          const { saleUnit: resolvedUnit, ratio_to_base } = getSaleUnitConfig(product, quoteUnit);

          const qtyRaw = Number(line.quantity || 0) || 0;
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

          const unitPrice = Number(line.unit_price ?? 0) || 0;
          const gross = unitPrice * validQty;
          const discAmt = Number(line.discount_amount ?? 0) || 0;
          const pct = Number(line.discount_percent ?? 0) || 0;
          const discFromPct = pct > 0 ? (gross * pct) / 100 : 0;
          const lineDiscRaw = discAmt > 0 ? discAmt : discFromPct;
          const lineDiscount =
            validQty < 0 ? 0 : Math.min(Math.max(0, lineDiscRaw), gross);

          const tierRaw = String(line.price_type_used ?? '');
          const priceTier: CartItem['price_tier'] = tierRaw === 'usta' ? 'master' : 'retail';

          built.push({
            product,
            quantity: validQty,
            sale_unit: resolvedUnit,
            qty_sale: validQty,
            qty_base: toBaseQty(validQty, ratio_to_base),
            ratio_to_base,
            unit_price: unitPrice,
            price_tier: priceTier,
            price_source: 'manual',
            is_price_overridden: true,
            discount_amount: lineDiscount,
            subtotal: gross,
            total: gross - lineDiscount,
          });
        }

        if (built.length === 0) {
          toast({
            variant: 'destructive',
            title: t('common.error'),
            description: t('quotes.import_no_products'),
          });
          return;
        }

        resetCustomerSelection();
        if ((quote as { customer_id?: string }).customer_id) {
          try {
            const cust = await getCustomerById((quote as { customer_id: string }).customer_id);
            if (cust) setSelectedCustomer(cust);
          } catch {
            /* mijozni yuklab bo‘lmasa ham savat import qilinadi */
          }
        }

        setCurrentTierCode(
          String((quote as { price_type?: string }).price_type ?? '') === 'usta' ? 'master' : 'retail'
        );

        const dp = Number((quote as { discount_percent?: number }).discount_percent ?? 0) || 0;
        const da = Number((quote as { discount_amount?: number }).discount_amount ?? 0) || 0;
        if (dp > 0) {
          setDiscount({ type: 'percent', value: String(dp) });
        } else if (da > 0) {
          setDiscount({ type: 'amount', value: String(da) });
        } else {
          setDiscount({ type: 'amount', value: '' });
        }

        setCart(built);
        setImportedWebOrderId(null);
        setPromoCodeInput('');
        setLoyaltyRedeemPoints(0);
        setSelectedCartIndex(0);

        toast({
          title: t('quotes.import_cart_success_title'),
          description: t('quotes.import_cart_success_desc', {
            n: built.length,
            num: String((quote as { quote_number?: string }).quote_number ?? ''),
          }),
          className: 'bg-green-50 border-green-200',
        });
        if (skipped.length > 0) {
          toast({
            variant: 'destructive',
            title: t('quotes.import_partial_title'),
            description: t('quotes.import_partial_desc', {
              ids: skipped.slice(0, 8).join(', '),
            }),
          });
        }
        if (stockClamped > 0) {
          toast({
            title: t('web_orders.import_stock_clamped_title'),
            description: t('web_orders.import_stock_clamped_desc', { n: stockClamped }),
          });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast({
          variant: 'destructive',
          title: t('quotes.import_cart_failed_title'),
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
      clampQuantityForUnit,
      getMaxSaleQty,
      toBaseQty,
      getProductById,
      resetCustomerSelection,
      setDiscount,
      setCart,
      setPromoCodeInput,
      setLoyaltyRedeemPoints,
      setSelectedCartIndex,
      setCurrentTierCode,
      setSelectedCustomer,
    ],
  );

  const importOrderIntoCart = useCallback(
    async (orderId: string) => {
      if (exchangeReturnMode) {
        toast({
          variant: 'destructive',
          title: t('common.error'),
          description: t('orders.import_order_blocked_exchange'),
        });
        return;
      }

      try {
        const order = (await getOrderById(orderId)) as OrderWithDetails | null;
        if (!order) {
          toast({
            variant: 'destructive',
            title: t('common.error'),
            description: t('orders.import_order_not_found'),
          });
          return;
        }

        const st = String(order.status || '').toLowerCase();
        if (st === 'voided' || st === 'refunded' || st === 'returned' || st === 'amended') {
          toast({
            variant: 'destructive',
            title: t('common.error'),
            description: t('orders.import_order_blocked_status'),
          });
          return;
        }

        const lines = Array.isArray(order.items)
          ? (order.items as OrderItem[])
          : [];
        if (lines.length === 0) {
          toast({
            variant: 'destructive',
            title: t('common.error'),
            description: t('orders.import_order_no_lines'),
          });
          return;
        }

        const built: CartItem[] = [];
        const skipped: string[] = [];
        let stockClamped = 0;

        for (const line of lines) {
          const pid = String(line.product_id ?? '');
          if (!pid) continue;

          const qtySale = Number(line.qty_sale ?? line.quantity ?? 0) || 0;
          if (qtySale <= 0) continue;

          const rawProduct = await getProductById(pid);
          if (!rawProduct) {
            skipped.push(pid);
            continue;
          }
          const product = await resolveProductForCart(rawProduct as Product);
          const saleUnitHint =
            typeof line.sale_unit === 'string' && line.sale_unit.length > 0
              ? line.sale_unit
              : typeof (product as any).unit === 'string'
                ? (product as any).unit
                : undefined;
          const { saleUnit: resolvedUnit, ratio_to_base } = getSaleUnitConfig(product, saleUnitHint);

          let validQty = clampQuantityForUnit(qtySale, resolvedUnit);
          const isAmendImport = st === 'completed';
          if (!isAmendImport) {
            const maxAllowed = getMaxSaleQty(product, ratio_to_base, resolvedUnit);
            if (maxAllowed > 0 && validQty > maxAllowed) {
              validQty = maxAllowed;
              stockClamped += 1;
            }
          }
          if (validQty <= 0) {
            skipped.push(pid);
            continue;
          }

          const unitPrice = Number(line.unit_price ?? 0) || 0;
          const gross = unitPrice * validQty;
          const lineDiscount = Math.min(
            Math.max(0, Number(line.discount_amount ?? 0) || 0),
            gross
          );

          const pt = line.price_tier;
          const priceTier: CartItem['price_tier'] =
            pt === 'master'
              ? 'master'
              : pt === 'wholesale'
                ? 'wholesale'
                : pt === 'marketplace'
                  ? 'marketplace'
                  : 'retail';

          built.push({
            product,
            quantity: validQty,
            sale_unit: resolvedUnit,
            qty_sale: validQty,
            qty_base: toBaseQty(validQty, ratio_to_base),
            ratio_to_base,
            ...(isAmendImport ? { amend_original_qty_sale: validQty } : {}),
            unit_price: unitPrice,
            price_tier: priceTier,
            price_source: 'manual',
            is_price_overridden: true,
            discount_amount: lineDiscount,
            subtotal: gross,
            total: gross - lineDiscount,
          });
        }

        if (built.length === 0) {
          toast({
            variant: 'destructive',
            title: t('common.error'),
            description: t('orders.import_order_no_products'),
          });
          return;
        }

        resetCustomerSelection();
        if (order.customer_id) {
          try {
            const cust = await getCustomerById(order.customer_id);
            if (cust) setSelectedCustomer(cust);
          } catch {
            /* ignore */
          }
        }

        const bonusReferrerId = String(
          (order as OrderWithDetails & { bonus_referrer_customer_id?: string | null })
            .bonus_referrer_customer_id ?? '',
        ).trim();
        if (bonusReferrerId) {
          try {
            const referrer = await getCustomerById(bonusReferrerId);
            if (referrer) setSelectedBonusReferrer(referrer);
          } catch {
            /* ignore */
          }
        } else {
          setSelectedBonusReferrer(null);
        }

        const tierCode = String((order as OrderWithDetails & { price_tier_code?: string }).price_tier_code ?? '').toLowerCase();
        setCurrentTierCode(tierCode === 'master' || tierCode === 'usta' ? 'master' : 'retail');

        const dp = Number(order.discount_percent ?? 0) || 0;
        const da = Number(order.discount_amount ?? 0) || 0;
        if (dp > 0) {
          setDiscount({ type: 'percent', value: String(dp) });
        } else if (da > 0) {
          setDiscount({ type: 'amount', value: String(da) });
        } else {
          setDiscount({ type: 'amount', value: '' });
        }

        setCart(built);
        setImportedWebOrderId(null);
        const orderNum = String(order.order_number ?? '').trim();
        if (st === 'completed') {
          setImportedOrderIdForEdit(order.id);
          setImportedOrderNumberForEdit(orderNum || null);
          setImportedOrderOutstandingDebt(computeOrderOutstandingForAmend(order));
          persistPosReplacesOrderId(order.id);
          setImportedHoldOrderId(null);
          setImportedHoldOrderNumber(null);
        } else if (st === 'hold' || st === 'pending' || st === 'on_hold' || st === 'draft') {
          setImportedOrderIdForEdit(null);
          setImportedOrderNumberForEdit(null);
          setImportedOrderOutstandingDebt(0);
          persistPosReplacesOrderId(null);
          setImportedHoldOrderId(order.id);
          setImportedHoldOrderNumber(orderNum || null);
        } else {
          setImportedOrderIdForEdit(null);
          setImportedOrderNumberForEdit(null);
          setImportedOrderOutstandingDebt(0);
          setImportedHoldOrderId(null);
          setImportedHoldOrderNumber(null);
          persistPosReplacesOrderId(null);
        }
        setPromoCodeInput('');
        setLoyaltyRedeemPoints(resolveLoyaltyRedeemOnOrderImport(order, st === 'completed'));
        setSelectedCartIndex(0);

        const importDescKey =
          st === 'completed'
            ? 'orders.import_order_success_desc_amend'
            : st === 'hold' || st === 'pending' || st === 'on_hold' || st === 'draft'
              ? 'orders.import_order_success_desc_hold'
              : 'orders.import_order_success_desc';
        toast({
          title: t('orders.import_order_success_title'),
          description: t(importDescKey, {
            n: built.length,
            num: orderNum,
          }),
          className: 'bg-green-50 border-green-200',
        });
        if (skipped.length > 0) {
          toast({
            variant: 'destructive',
            title: t('quotes.import_partial_title'),
            description: t('quotes.import_partial_desc', {
              ids: skipped.slice(0, 8).join(', '),
            }),
          });
        }
        if (stockClamped > 0) {
          toast({
            title: t('web_orders.import_stock_clamped_title'),
            description: t('web_orders.import_stock_clamped_desc', { n: stockClamped }),
          });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast({
          variant: 'destructive',
          title: t('orders.import_order_failed_title'),
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
      clampQuantityForUnit,
      getMaxSaleQty,
      toBaseQty,
      getProductById,
      getOrderById,
      resetCustomerSelection,
      setDiscount,
      setCart,
      setPromoCodeInput,
      setLoyaltyRedeemPoints,
      setSelectedCartIndex,
      setCurrentTierCode,
      setSelectedCustomer,
      setSelectedBonusReferrer,
    ],
  );

  const restoreRemoteHeldOrder = useCallback(
    async (order: HeldOrder) => {
      try {
        const webId = order.web_order_id;
        if (webId != null && Number.isFinite(Number(webId))) {
          await importWebOrderIntoCart(Number(webId));
        } else {
          await importOrderIntoCart(order.id);
        }
        setWaitingOrdersDialogOpen(false);
        setRestoreConfirmOpen(false);
        setOrderToRestore(null);
      } catch (error) {
        console.error('Error restoring remote held order:', error);
        const msg = error instanceof Error ? error.message : String(error);
        toast({
          title: 'Xatolik',
          description: msg || 'Buyurtmani qayta tiklashda xatolik yuz berdi',
          variant: 'destructive',
        });
      }
    },
    [importWebOrderIntoCart, importOrderIntoCart, toast],
  );

  const restoreLocalHeldOrder = useCallback(
    async (order: HeldOrder) => {
      try {
        const restoredCustomer = order.customer_id
          ? (customers.find((c) => c.id === order.customer_id) || null)
          : null;

        const normalizedItems = await Promise.all(
          (order.items || []).map(async (item) => {
            const qty = Number(item.quantity || 0) || 0;
            const savedUnitPrice = Number(item.unit_price);
            const hasSavedUnitPrice = Number.isFinite(savedUnitPrice) && savedUnitPrice > 0;

            const pid = item.product?.id;
            const fromCatalog = pid ? allProducts.find((p) => p.id === pid) : undefined;
            let product = fromCatalog ?? null;
            if (!product && pid) {
              const rawProduct = await getProductById(pid);
              if (rawProduct) product = await resolveProductForCart(rawProduct as Product);
            }
            if (!product) {
              product = await resolveProductForCart(item.product);
            }

            const { saleUnit, ratio_to_base, sale_price } = getSaleUnitConfig(
              product,
              item.sale_unit || product.unit,
            );
            const qtyBase = toBaseQty(qty, ratio_to_base);

            const computed = getLinePricing(
              product,
              qtyBase,
              restoredCustomer,
              hasSavedUnitPrice ? savedUnitPrice : sale_price,
              ratio_to_base,
              item.sale_unit || saleUnit,
            );
            const unitPrice = hasSavedUnitPrice ? savedUnitPrice : computed.unitPrice;
            const priceTier =
              typeof item.price_tier === 'string' ? item.price_tier : computed.priceTier;
            const wasManual =
              item.is_price_overridden === true ||
              item.price_source === 'manual' ||
              (hasSavedUnitPrice &&
                Math.abs(savedUnitPrice - Number(computed.unitPrice || 0)) > 0.009);

            const subtotal = unitPrice * qty;
            const lineDiscount = Math.min(Number(item.discount_amount || 0) || 0, subtotal);

            return {
              ...item,
              product,
              quantity: qty,
              sale_unit: item.sale_unit || saleUnit,
              qty_sale: qty,
              qty_base: qtyBase,
              ratio_to_base,
              unit_price: unitPrice,
              price_tier: priceTier,
              price_source: wasManual ? 'manual' : item.price_source || 'tier',
              is_price_overridden: wasManual,
              subtotal,
              discount_amount: lineDiscount,
              total: subtotal - lineDiscount,
            };
          }),
        );

        setCart(normalizedItems);

        clearPosSaleImportContext();

        if (order.discount && Number(order.discount.value) > 0) {
          setDiscount({
            type: order.discount.type === 'percent' ? 'percent' : 'amount',
            value: String(order.discount.value),
          });
        } else {
          setDiscount({ type: 'amount', value: '' });
        }

        if (order.customer_id) {
          setSelectedCustomer(restoredCustomer || null);
        }

        if (order.bonus_referrer_customer_id) {
          const restoredReferrer =
            customers.find((c) => c.id === order.bonus_referrer_customer_id) || null;
          setSelectedBonusReferrer(restoredReferrer);
        } else {
          setSelectedBonusReferrer(null);
        }

        await deleteHeldOrder(order.id);
        loadHeldOrders();

        setWaitingOrdersDialogOpen(false);
        setRestoreConfirmOpen(false);
        setOrderToRestore(null);

        toast({
          title: '✅ Buyurtma qayta tiklandi',
          description: `${order.items.length} ta mahsulot savatga qaytarildi`,
          className: 'bg-green-50 border-green-200',
        });
      } catch (error) {
        console.error('Error restoring order:', error);
        const msg = error instanceof Error ? error.message : String(error);
        toast({
          title: 'Xatolik',
          description: msg || 'Buyurtmani qayta tiklashda xatolik yuz berdi',
          variant: 'destructive',
        });
      }
    },
    [
      customers,
      allProducts,
      getProductById,
      resolveProductForCart,
      getSaleUnitConfig,
      getLinePricing,
      toBaseQty,
      loadHeldOrders,
      toast,
      clearPosSaleImportContext,
    ],
  );

  const handleRestoreOrder = useCallback(
    (order: HeldOrder) => {
      const restore = isRemoteImportHeldOrder(order)
        ? restoreRemoteHeldOrder
        : restoreLocalHeldOrder;

      if (cart.length > 0) {
        setOrderToRestore(order);
        setRestoreConfirmOpen(true);
      } else {
        void restore(order);
      }
    },
    [cart.length, restoreRemoteHeldOrder, restoreLocalHeldOrder],
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

  useLayoutEffect(() => {
    const SS_QUOTE_KEY = 'pos_import_quote_id';
    const stateId = (location.state as { importQuoteId?: string } | null)?.importQuoteId;
    let ssId: string | null = null;
    try {
      ssId = sessionStorage.getItem(SS_QUOTE_KEY);
    } catch {
      ssId = null;
    }
    const raw =
      typeof stateId === 'string' && stateId.length > 0
        ? stateId
        : typeof ssId === 'string' && ssId.length > 0
          ? ssId
          : null;
    if (!raw) return;
    try {
      sessionStorage.removeItem(SS_QUOTE_KEY);
    } catch {
      /* ignore */
    }
    const token = `${location.key}:${raw}`;
    if (quoteImportProcessedRef.current === token) return;
    quoteImportProcessedRef.current = token;
    navigate('/pos', { replace: true, state: {} });
    if (cartRef.current.length > 0) {
      setPendingQuoteImportId(raw);
      setImportQuoteDialogOpen(true);
    } else {
      void importQuoteIntoCart(raw);
    }
  }, [location.state, location.key, navigate, importQuoteIntoCart]);

  useLayoutEffect(() => {
    const SS_ORDER_KEY = 'pos_import_order_id';
    const stateId = (location.state as { importOrderId?: string } | null)?.importOrderId;
    let ssId: string | null = null;
    try {
      ssId = sessionStorage.getItem(SS_ORDER_KEY);
    } catch {
      ssId = null;
    }
    const raw =
      typeof stateId === 'string' && stateId.length > 0
        ? stateId
        : typeof ssId === 'string' && ssId.length > 0
          ? ssId
          : null;
    if (!raw) return;
    try {
      sessionStorage.removeItem(SS_ORDER_KEY);
    } catch {
      /* ignore */
    }
    const token = `${location.key}:${raw}`;
    if (orderImportProcessedRef.current === token) return;
    orderImportProcessedRef.current = token;
    navigate('/pos', { replace: true, state: {} });
    if (cartRef.current.length > 0) {
      setPendingOrderImportId(raw);
      setImportOrderDialogOpen(true);
    } else {
      void importOrderIntoCart(raw);
    }
  }, [location.state, location.key, navigate, importOrderIntoCart]);

  // Validate stale sessionStorage pos_replaces_order_id on load (survives refresh during edit only).
  useEffect(() => {
    const staleId = readPosReplacesOrderId();
    if (!staleId) return;
    let cancelled = false;
    void (async () => {
      try {
        const order = (await getOrderById(staleId)) as OrderWithDetails | null;
        const st = String(order?.status || '').toLowerCase();
        if (cancelled) return;
        if (st === 'completed') {
          setImportedOrderIdForEdit(staleId);
          setImportedOrderNumberForEdit(String(order?.order_number ?? '').trim() || null);
          setImportedOrderOutstandingDebt(computeOrderOutstandingForAmend(order));
        } else {
          persistPosReplacesOrderId(null);
        }
      } catch {
        if (!cancelled) persistPosReplacesOrderId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConfirmWebOrderImport = () => {
    const id = pendingWebOrderImportId;
    if (id == null) return;
    clearCartAndNavDraft();
    setImportedWebOrderId(null);
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

  const handleConfirmQuoteImport = () => {
    const id = pendingQuoteImportId;
    if (!id) return;
    clearCartAndNavDraft();
    setImportedWebOrderId(null);
    setDiscount({ type: 'amount', value: '' });
    resetCustomerSelection();
    setPromoCodeInput('');
    setLoyaltyRedeemPoints(0);
    setImportQuoteDialogOpen(false);
    setPendingQuoteImportId(null);
    void importQuoteIntoCart(id);
  };

  const handleCancelQuoteImport = () => {
    setPendingQuoteImportId(null);
    setImportQuoteDialogOpen(false);
  };

  const handleConfirmOrderImport = () => {
    const id = pendingOrderImportId;
    if (!id) return;
    clearCartAndNavDraft();
    clearPosSaleImportContext();
    setDiscount({ type: 'amount', value: '' });
    resetCustomerSelection();
    setPromoCodeInput('');
    setLoyaltyRedeemPoints(0);
    setImportOrderDialogOpen(false);
    setPendingOrderImportId(null);
    void importOrderIntoCart(id);
  };

  const handleCancelOrderImport = () => {
    setPendingOrderImportId(null);
    setImportOrderDialogOpen(false);
  };

  const markImportedWebOrderSold = useCallback(async (webOrderId: number) => {
    const api = getElectronAPI();
    const webOrder = api?.webOrders?.get
      ? await handleIpcResponse<Record<string, unknown> | null>(api.webOrders.get(webOrderId))
      : null;
    const status = String(webOrder?.status || '').toLowerCase();
    const method = String(webOrder?.delivery_method || '').toLowerCase() === 'pickup' ? 'pickup' : 'courier';
    const transitions =
      status === 'new' || status === 'paid'
        ? method === 'pickup'
          ? ['processing', 'ready', 'delivered']
          : ['processing', 'ready', 'out_for_delivery', 'delivered']
        : status === 'processing'
          ? method === 'pickup'
            ? ['ready', 'delivered']
            : ['ready', 'out_for_delivery', 'delivered']
          : status === 'ready'
            ? method === 'pickup'
              ? ['delivered']
              : ['out_for_delivery', 'delivered']
            : status === 'out_for_delivery'
              ? ['delivered']
              : [];

    if (api?.webOrders?.updateStatus) {
      for (const nextStatus of transitions) {
        // eslint-disable-next-line no-await-in-loop
        await handleIpcResponse(api.webOrders.updateStatus(webOrderId, nextStatus));
      }
    }
  }, []);

  const voidImportedHoldOrderAfterSale = useCallback(
    async (holdOrderId: string | null) => {
      if (!holdOrderId) return;
      try {
        await cancelOrder(holdOrderId);
        void loadHeldOrders();
      } catch (e) {
        toast({
          title: 'Kutilayotgan buyurtma',
          description: `Sotuv yakunlandi, lekin hold buyurtmani yopishda xatolik: ${e instanceof Error ? e.message : String(e)}`,
          variant: 'destructive',
        });
      }
    },
    [loadHeldOrders, toast],
  );

  const updateQuantity = (
    productId: string,
    quantity: number,
    opts?: { moveToTop?: boolean; highlight?: boolean }
  ) => {
    if (quantity === 0) {
      removeFromCart(productId);
      return;
    }

    const cartItem = cartRef.current.find((item) => item.product.id === productId);
    if (!cartItem) return;

    const saleUnit = cartItem.sale_unit || cartItem.product.unit;
    const ratioToBase = Number(cartItem.ratio_to_base ?? 1) || 1;
    let validQuantity = clampSignedQuantityForUnit(quantity, saleUnit);

    if (validQuantity > 0 && productTracksStock(cartItem.product)) {
      const maxAllowed = getMaxSaleQtyForCartLine(
        cartItem.product,
        ratioToBase,
        saleUnit,
        cartItem.amend_original_qty_sale,
      );
      if (maxAllowed <= 0 || validQuantity > maxAllowed) {
        toast({
          title: t('pos.stock_insufficient_title', { defaultValue: 'Yetarli qoldiq yo‘q' }),
          description: t('pos.stock_insufficient_desc', {
            defaultValue: '{{name}}: so‘ralgan {{requested}}, mavjud {{available}}',
            name: cartItem.product.name,
            requested: formatQuantity(validQuantity, saleUnit),
            available: formatQuantity(Math.max(0, maxAllowed), saleUnit),
          }),
          variant: 'destructive',
        });
        return;
      }
    }
    
    if (opts?.highlight) {
      markRecentCartItem(productId);
    }
    if (opts?.moveToTop) {
      setSelectedCartIndex(0);
    }

    setCart((prev) => {
      const idx = prev.findIndex((item) => item.product.id === productId);
      if (idx < 0) return prev;

      const item = prev[idx];
      const qtyBase = toBaseQty(validQuantity, ratioToBase);
      let updated: CartItem;

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

        updated = {
          ...item,
          quantity: validQuantity,
          qty_sale: validQuantity,
          qty_base: qtyBase,
          unit_price: unitPrice,
          subtotal,
          discount_amount: lineDiscount,
          total: subtotal - lineDiscount,
        };
      } else {
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

        updated = {
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

      const next = [...prev];
      next[idx] = updated;

      if (opts?.moveToTop && idx > 0) {
        const [moved] = next.splice(idx, 1);
        return [moved, ...next];
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
      if (okSigned && curQ !== numValue) {
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
        ? getMaxSaleQtyForCartLine(
            cartItem?.product as any,
            ratioToBase,
            unit,
            cartItem?.amend_original_qty_sale,
          )
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
    const prevQtySale = Number(cartItem.qty_sale ?? cartItem.quantity ?? 0) || 0;
    const prevRatio = Number(cartItem.ratio_to_base ?? 1) || 1;
    const prevQtyBaseRaw = Number(cartItem.qty_base);
    const effectiveTier = ((selectedCustomer as any)?.pricing_tier || currentTierCode || 'retail') as string;
    if (effectiveTier !== 'retail' && effectiveTier !== 'master' && saleCurrency !== 'USD') {
      const fetched = await fetchTierPrice(cartItem.product, effectiveTier, nextUnit);
      if (fetched == null) {
        toast({
          title: 'Narx topilmadi',
          description: `Tier: ${effectiveTier} (${nextUnit})`,
          variant: 'destructive',
        });
        return;
      }
    } else if (effectiveTier !== 'retail' && effectiveTier !== 'master') {
      void fetchTierPrice(cartItem.product, effectiveTier, nextUnit);
    }
    // Probe pricing with preserved stock qty (same as recalcCartLineForSaleUnitChange).
    const prevQtyBase =
      Number.isFinite(prevQtyBaseRaw) && prevQtyBaseRaw !== 0
        ? prevQtyBaseRaw
        : toBaseQty(prevQtySale, prevRatio);
    const nextRatio = Number(nextConfig.ratio_to_base ?? 1) || 1;
    const probeSale =
      nextRatio > 0 ? prevQtyBase / nextRatio : prevQtySale;
    const probeQtyBase = toBaseQty(
      clampSignedQuantityForUnit(probeSale, nextConfig.saleUnit),
      nextRatio,
    );
    const { unitPrice, priceTier } = getLinePricing(
      cartItem.product,
      probeQtyBase,
      selectedCustomer,
      nextConfig.sale_price,
      nextConfig.ratio_to_base,
      nextUnit
    );
    const linePatch = recalcCartLineForSaleUnitChange({
      prevQtySale,
      prevQtyBase: prevQtyBaseRaw,
      prevRatioToBase: prevRatio,
      nextSaleUnit: nextConfig.saleUnit,
      nextRatioToBase: nextConfig.ratio_to_base,
      nextUnitPrice: unitPrice,
      discountAmount: cartItem.discount_amount,
    });
    setCart(
      cart.map((item) =>
        item.product.id === productId
          ? {
              ...item,
              ...linePatch,
              price_tier: priceTier,
              price_source: 'tier',
              is_price_overridden: false,
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
    if (effectiveTier !== 'retail' && effectiveTier !== 'master' && saleCurrency !== 'USD') {
      const fetched = await fetchTierPrice(cartItem.product, effectiveTier, saleUnit);
      if (fetched == null) {
        toast({
          title: 'Narx topilmadi',
          description: `Tier: ${effectiveTier} (${saleUnit})`,
          variant: 'destructive',
        });
        return;
      }
    } else if (effectiveTier !== 'retail' && effectiveTier !== 'master') {
      void fetchTierPrice(cartItem.product, effectiveTier, saleUnit);
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
    setCart((prev) => {
      const idx = prev.findIndex((item) => item.product.id === productId);
      if (idx < 0) return prev;
      const next = prev.filter((_, i) => i !== idx);
      queueCartUndo(prev, "Savatdan mahsulot o'chirildi");
      return next;
    });
  };

  const formatCurrency = useCallback(
    (value: number): string => formatMoney(value, saleCurrency),
    [saleCurrency]
  );

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

  const orderDiscountBase = useMemo(
    () => cartOrderDiscountBase(effectiveCart),
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
  const stockRiskLines = useMemo(
    () => findInsufficientStockLines(effectiveCart),
    [effectiveCart]
  );
  const stockRiskCount = stockRiskLines.length;
  const stockBlockedReason =
    stockRiskCount > 0
      ? t('pos.cart_stock_blocked', {
          defaultValue: '{{count}} qatorda yetarli qoldiq yo‘q — to‘lov ochilmaydi',
          count: stockRiskCount,
        })
      : '';
  const nextHeldPreview = useMemo(() => {
    if (heldOrders.length === 0) return null;
    const first = heldOrders[0] as any;
    return {
      number: String(first?.held_number || first?.heldNumber || first?.id || '—'),
      customer: String(first?.customer_name || first?.customerName || 'Mijozsiz'),
      itemsCount: Array.isArray(first?.items) ? first.items.length : 0,
    };
  }, [heldOrders]);

  const parsedDiscountValue = useMemo(() => {
    if (discount.value.trim() === '') return null;
    const parsed = Number(discount.value);
    return Number.isFinite(parsed) ? parsed : null;
  }, [discount.value]);

  const maxDiscountAmount = orderDiscountBase.maxOrderDiscount;

  const discountError = useMemo(() => {
    if (
      !orderDiscountBase.hasSaleLine &&
      discount.type !== 'promo' &&
      discount.value.trim() !== ''
    ) {
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
  }, [t, discount.value, parsedDiscountValue, discount.type, maxDiscountAmount, orderDiscountBase.hasSaleLine]);

  const isDiscountActionDisabled =
    discount.type !== 'promo' && discount.value !== '' && discountError !== '';
  const discountActionDisabledReason = isDiscountActionDisabled ? discountError : '';
  const shiftRequiredReason = !currentShift ? 'Avval smena oching' : '';
  const paymentDisabledReason =
    shiftRequiredReason || discountActionDisabledReason || stockBlockedReason;
  const discountValueNumber =
    discount.type === 'promo'
      ? 0
      : !discountError && parsedDiscountValue !== null
        ? parsedDiscountValue
        : 0;

  const handleHoldOrder = useCallback(async () => {
    if (!posTerminalSettings.enable_hold_order) {
      toast({
        title: 'Hold disabled',
        description: 'Buyurtmani saqlash funksiyasi sozlamalarda o\'chirilgan.',
        variant: 'destructive',
      });
      return;
    }
    if (!profile || !currentShift) {
      toast({
        title: 'Error',
        description: 'Please open a shift first',
        variant: 'destructive',
      });
      return;
    }

    if (effectiveCart.length === 0) {
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
      const holdDiscount =
        discount.type !== 'promo' && discountValueNumber > 0
          ? { type: discount.type as 'amount' | 'percent', value: discountValueNumber }
          : null;
      const holdTotal = computeHeldOrderTotal(effectiveCart, holdDiscount);

      await saveHeldOrder({
        held_number: heldNumber,
        cashier_id: profile.id,
        shift_id: currentShift?.id || null,
        customer_id: selectedCustomer?.id || null,
        customer_name: displayName,
        bonus_referrer_customer_id: selectedBonusReferrer?.id || null,
        items: effectiveCart,
        discount: holdDiscount,
        total_amount: holdTotal,
        note: null,
      });

      toast({
        title: '✅ Buyurtma saqlandi!',
        description: `${heldNumber} — kutish ro'yxatiga qo'shildi`,
        className: 'bg-green-50 border-green-200',
      });

      clearCartAndNavDraft();
      clearPosSaleImportContext();
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
    effectiveCart,
    selectedCustomer,
    selectedBonusReferrer,
    discount.type,
    discountValueNumber,
    loadHeldOrders,
    resetCustomerSelection,
    clearCartAndNavDraft,
    toast,
    t,
    posTerminalSettings.enable_hold_order,
  ]);
  handleHoldOrderShortcutRef.current = handleHoldOrder;

  // Memoize totals calculation to prevent recalculation on every render
  const totals = useMemo(() => {
    let globalDiscountAmount = 0;
    if (orderDiscountBase.hasSaleLine) {
      if (discount.type === 'promo') {
        globalDiscountAmount = 0;
      } else if (discount.type === 'amount') {
        globalDiscountAmount = roundUZS(discountValueNumber);
      } else {
        // Order discount base is sale lines only (exchange returns excluded).
        const subtotalAfterLineDiscounts = orderDiscountBase.maxOrderDiscount;
        // Use the shared UZS helper so the percent application rounds the
        // same way everywhere (receipts, totals, accounting). Floating
        // `(x * pct) / 100` could leave 0.5 UZS dust that desyncs the
        // receipt subtotal from `total - vat - discounts`.
        globalDiscountAmount = applyPercentUZS(subtotalAfterLineDiscounts, discountValueNumber);
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
    orderDiscountBase,
  ]);

  const computeTotalsForCart = useCallback(
    (items: CartItem[]) => {
      const cartSubtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
      const cartLineDiscounts = items.reduce((sum, item) => sum + item.discount_amount, 0);
      const checkoutDiscountBase = cartOrderDiscountBase(items);

      let globalDiscountAmount = 0;
      if (checkoutDiscountBase.hasSaleLine) {
        if (discount.type === 'promo') {
          globalDiscountAmount = 0;
        } else if (discount.type === 'amount') {
          globalDiscountAmount = roundUZS(discountValueNumber);
        } else {
          globalDiscountAmount = applyPercentUZS(
            checkoutDiscountBase.maxOrderDiscount,
            discountValueNumber
          );
        }
      }

      const totalDiscountAmount = cartLineDiscounts + globalDiscountAmount;
      const baseAfterStandardDiscounts = cartSubtotal - totalDiscountAmount;

      const { redeemEnabled, redeemUzsPerPt, maxPct, minRedeemPts } = loyaltyCfg;
      let loyaltyRedeemPointsApplied = 0;
      let loyaltyDiscountUzs = 0;

      const cartHasReturnLine = items.some(
        (it) => (Number(it.qty_sale ?? it.quantity ?? 0) || 0) < 0
      );

      if (
        !cartHasReturnLine &&
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
        subtotal: cartSubtotal,
        lineDiscountsTotal: cartLineDiscounts,
        globalDiscountAmount,
        preLoyaltyDiscountAmount: totalDiscountAmount,
        loyaltyRedeemPointsApplied,
        loyaltyDiscountUzs,
        discountAmount: totalDiscountAmount + loyaltyDiscountUzs,
        total,
      };
    },
    [
      discount.type,
      discountValueNumber,
      loyaltyCfg,
      loyaltyRedeemPoints,
      selectedCustomer,
      isWalkInCustomer,
    ]
  );

  const priorDebtInSaleCurrency = useMemo(() => {
    if (!selectedCustomer || isWalkInCustomer(selectedCustomer)) return 0;
    return getCustomerDebtInCurrency(selectedCustomer, saleCurrency);
  }, [selectedCustomer, saleCurrency, getCustomerDebtInCurrency, isWalkInCustomer]);

  const priorDebtForCheckout = useMemo(() => {
    return netPriorDebtForAmendCheckout(
      priorDebtInSaleCurrency,
      importedOrderOutstandingDebt,
      Boolean(importedOrderIdForEdit),
    );
  }, [priorDebtInSaleCurrency, importedOrderOutstandingDebt, importedOrderIdForEdit]);

  const priorCreditInSaleCurrency = useMemo(() => {
    if (!selectedCustomer || isWalkInCustomer(selectedCustomer)) return 0;
    return getCustomerCreditInCurrency(selectedCustomer, saleCurrency);
  }, [selectedCustomer, saleCurrency, getCustomerCreditInCurrency, isWalkInCustomer]);

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
        const isManual =
          item.is_price_overridden === true || item.price_source === 'manual';
        const priceSource = isManual
          ? 'manual'
          : item.price_source ||
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
          discount_type: (perUnitDiscount > 0 ? 'fixed' : 'none') as 'fixed' | 'none',
          discount_value: perUnitDiscount,
          final_unit_price: finalUnitPrice,
          final_total: finalLineTotal,
          price_source: priceSource as any,
          is_price_overridden: isManual,
          manual_price: isManual,
          subtotal: item.subtotal,
          discount_amount: totalDiscountLine,
          total: finalLineTotal,
          promotion_id: item.promotion_id ?? null,
        };
      });
    },
    [getSaleUnitConfig]
  );

  // --- Checkout idempotency guard (duplicate orders / double stock deduction) ---
  // One key is bound to THE CURRENT basket. It is reused across retries (slow
  // response / 429) so the backend dedups via `order_uuid`, and reset to null
  // after a completed sale or whenever the basket changes (new checkout).
  const checkoutIdempotencyKeyRef = useRef<string | null>(null);
  const checkoutIdempotencySignature = useMemo(
    () =>
      buildCheckoutIdempotencySignature({
        lines: cart.map((item) => ({
          productId: item.product.id,
          qtyBase: item.qty_base ?? item.quantity,
          unitPrice: Number(item.unit_price || 0),
          discountAmount: Number(item.discount_amount || 0),
        })),
        customerId: selectedCustomer?.id ?? null,
        bonusReferrerCustomerId: selectedBonusReferrer?.id ?? null,
        discountType: discount.type,
        discountValue: discount.value,
        saleCurrency,
        loyaltyRedeemPoints,
      }),
    [cart, selectedCustomer, selectedBonusReferrer, discount, saleCurrency, loyaltyRedeemPoints],
  );
  useEffect(() => {
    // Basket changed → next submit starts a fresh checkout session so a new
    // basket can never be bound to a previous order's idempotency key.
    checkoutIdempotencyKeyRef.current = null;
  }, [checkoutIdempotencySignature]);

  /** Get the current checkout idempotency key, creating one on first submit. */
  const getOrCreateCheckoutIdempotencyKey = (): string => {
    if (!checkoutIdempotencyKeyRef.current) {
      checkoutIdempotencyKeyRef.current = newCheckoutIdempotencyKey();
    }
    return checkoutIdempotencyKeyRef.current;
  };

  const handleCompletePayment = async (
    paymentMethod: PosCheckoutPaymentKind,
    options?: { cashAmountOverride?: number }
  ) => {
    if (isProcessingPayment) return;
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

    if (saleCurrency === 'USD' && (!saleFxRate || saleFxRate <= 0)) {
      toast({
        title: 'Valyuta kursi yo‘q',
        description: 'USD sotuv uchun kurs kerak (Sozlamalar → Valyuta).',
        variant: 'destructive',
      });
      return;
    }

    const rawLoyaltyPts = Math.floor(Number(loyaltyRedeemPoints) || 0);
    if (loyaltyCfg.redeemEnabled && rawLoyaltyPts > 0 && saleCurrency === 'USD') {
      toast({
        title: 'Ball ishlatish',
        description: 'USD sotuvda bonus ball ishlatish mumkin emas.',
        variant: 'destructive',
      });
      return;
    }

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

    // 1. Stock: faqat sotilayotgan (musbat) qatorlar — final FE gate before modal/API
    const shortage = findInsufficientStockLines(cart);
    if (shortage.length > 0) {
      const first = shortage[0];
      toast({
        title: t('pos.stock_insufficient_title', { defaultValue: 'Yetarli qoldiq yo‘q' }),
        description: t('pos.stock_insufficient_desc', {
          defaultValue: '{{name}}: so‘ralgan {{requested}}, mavjud {{available}}',
          name: first.productName,
          requested: first.requested,
          available: first.available,
        }),
        variant: 'destructive',
      });
      return;
    }

    const checkoutCart = await resolveCheckoutCart();
    const {
      subtotal,
      discountAmount,
      total,
      loyaltyRedeemPointsApplied,
      globalDiscountAmount,
      loyaltyDiscountUzs,
    } = computeTotalsForCart(checkoutCart);

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

    if (saleCurrency === 'USD' && creditAmountValue > 0) {
      toast({
        title: 'USD sotuv',
        description: 'Nasiyaga qoldirish faqat UZS valyutada.',
        variant: 'destructive',
      });
      return;
    }

    if (creditAmountValue > 0) {
      if (!selectedCustomer || isWalkInCustomer(selectedCustomer)) {
        toast({
          title: 'Mijoz kerak',
          description: 'Nasiya yoki qisman to‘lov uchun ro‘yxatdan o‘tgan mijoz tanlanishi kerak.',
          variant: 'destructive',
        });
        return;
      }
      if (!creditDueDate) {
        toast({
          title: 'Qarz qaytarish sanasi',
          description: 'Nasiya uchun muddat sanasini tanlang.',
          variant: 'destructive',
        });
        return;
      }
    }

    const extraDebtDue =
      total > 0 && includePriorDebtInPayment && priorDebtForCheckout > 0
        ? priorDebtForCheckout
        : 0;
    const merchandiseCashDue = Math.max(0, total - creditAmountValue);
    const amountDueWithDebt = merchandiseCashDue + extraDebtDue;

    if (total < 0) {
      if (
        paymentMethod !== POS_EXCHANGE_PAYOUT_METHOD &&
        paymentMethod !== POS_EXCHANGE_BALANCE_METHOD
      ) {
        toast({
          title: t('pos.process_payment'),
          description: t('pos.exchange.payment_need_refund'),
          variant: 'destructive',
        });
        return;
      }
      if (paymentMethod === POS_EXCHANGE_BALANCE_METHOD && isWalkInCustomer(selectedCustomer)) {
        toast({
          title: t('pos.process_payment'),
          description: t('pos.exchange.refund_balance_need_customer'),
          variant: 'destructive',
        });
        return;
      }
      const payout = Math.abs(total);
      orderPayments = [{ method: paymentMethod as PaymentMethod, amount: payout }];
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
      if (
        !isZeroTotalSaleAllowed({
          subtotal,
          discountAmount,
          loyaltyDiscountAmount: loyaltyDiscountUzs,
          hasPromo: discount.type === 'promo' || Boolean(promoCodeInput.trim()),
          loyaltyRedeemPoints: loyaltyRedeemPointsApplied,
          userRole: profile?.role,
        })
      ) {
        toast({
          title: t('pos.process_payment'),
          description: t('pos.exchange.zero_settle_not_allowed', {
            defaultValue:
              'Nol jami faqat 100% chegirma, promo, bonus yoki ruxsatli foydalanuvchi uchun.',
          }),
          variant: 'destructive',
        });
        return;
      }
      orderPayments = [];
      paidAmount = 0;
      changeAmount = 0;
      creditAmountValue = 0;
    } else if (paymentMethod === 'cash') {
      const cashAmount = options?.cashAmountOverride ?? cashReceived ?? 0;
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
      if (!isPaymentEnabled('card')) {
        toast({
          title: 'Karta o\'chirilgan',
          description: 'Karta to\'lovi sozlamalarda o\'chirilgan.',
          variant: 'destructive',
        });
        return;
      }
      const requiredAmount = amountDueWithDebt;
      orderPayments = [{ method: 'card', amount: requiredAmount }];
      paidAmount = requiredAmount;
      changeAmount = 0;
    } else if (paymentMethod === 'qr') {
      if (!isPaymentEnabled('qr')) {
        toast({
          title: 'QR o\'chirilgan',
          description: 'QR to\'lov sozlamalarda o\'chirilgan.',
          variant: 'destructive',
        });
        return;
      }
      const requiredAmount = amountDueWithDebt;
      orderPayments = [{ method: 'qr', amount: requiredAmount }];
      paidAmount = requiredAmount;
      changeAmount = 0;
    } else if (paymentMethod === 'mixed') {
      if (!posTerminalSettings.enable_mixed_payment) {
        toast({
          title: 'Mixed payment disabled',
          description: 'Aralash to\'lov sozlamalarda o\'chirilgan.',
          variant: 'destructive',
        });
        return;
      }
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

    setIsProcessingPayment(true);
    try {
      const checkoutStart = perfEnabled ? performance.now() : 0;
      const importedWebOrderIdForSale = importedWebOrderId;
      const importedHoldOrderIdForSale = importedHoldOrderId;
      const replacesOrderIdForSale = resolveReplacesOrderIdForCheckout(
        importedOrderIdForEditRef.current,
        importedHoldOrderIdRef.current,
      );
      // Stable per-checkout idempotency key — reused on retry so a slow/429
      // re-submit cannot create a second order or deduct stock twice.
      const checkoutIdempotencyKey = getOrCreateCheckoutIdempotencyKey();

      const freeSaleLines = checkoutCart.filter((line) => {
        const unitPrice = Number(line.unit_price ?? 0) || 0;
        return unitPrice <= 0 && isProductFreeSaleAllowed(line.product as any);
      });
      let freeSaleReason: string | null = null;
      if (freeSaleLines.length > 0) {
        const prompted = window.prompt(
          t('pos.free_sale_reason_prompt', {
            defaultValue: 'Free sale reason (required):',
          }),
        );
        freeSaleReason = String(prompted || '').trim();
        if (!freeSaleReason) {
          toast({
            title: t('pos.free_sale_reason_required', {
              defaultValue: 'Free sale reason required',
            }),
            variant: 'destructive',
          });
          setIsProcessingPayment(false);
          return;
        }
      }

      const blockedZero = checkoutCart.some((line) => {
        const unitPrice = Number(line.unit_price ?? 0) || 0;
        if (!(unitPrice <= 0)) return false;
        return !isProductSalePriceSellable(line.product as any);
      });
      if (blockedZero) {
        toast({
          title: t('products.price_not_set', { defaultValue: 'Price not set' }),
          description: t('products.price_not_set_hint', {
            defaultValue: 'Remove zero-price items or set a price.',
          }),
          variant: 'destructive',
        });
        setIsProcessingPayment(false);
        return;
      }

      const order = {
        order_number: '',
        order_uuid: checkoutIdempotencyKey,
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
        notes: freeSaleReason ? `[FREE_SALE] ${freeSaleReason}` : null,
        ...(freeSaleReason ? { free_sale_reason: freeSaleReason } : {}),
        ...(creditAmountValue > 0 && creditDueDate ? { due_date: creditDueDate } : {}),
        ...(creditAmountValue > 0 && creditReminderNote.trim()
          ? { credit_reminder_note: creditReminderNote.trim() }
          : {}),
        ...(loyaltyRedeemPointsApplied > 0 ? { loyalty_redeem_points: loyaltyRedeemPointsApplied } : {}),
        ...(selectedBonusReferrer?.id ? { bonus_referrer_customer_id: selectedBonusReferrer.id } : {}),
        ...orderCurrencyFields(saleCurrency, saleFxRate),
        ...(replacesOrderIdForSale ? { replaces_order_id: replacesOrderIdForSale } : {}),
      };

      const orderItems = buildOrderItemsSnapshot(checkoutCart, globalDiscountAmount + loyaltyDiscountUzs);

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
        offline_queued?: boolean;
      } | null;
      if (perfEnabled) {
        const ms = Math.round(performance.now() - checkoutStart);
        console.debug(`[POS PERF] checkout → ${ms}ms`);
      }
      const orderNumber = created?.order_number || order.order_number || 'ORD';

      // Close payment dialog FIRST (sync) so an emptied cart never flashes
      // "Yakunlash (nol jami)" while follow-up async work (receipt/loyalty) runs.
      checkoutIdempotencyKeyRef.current = null;
      flushSync(() => {
        setPaymentDialogOpen(false);
        setCashReceived(null);
        setCreditAmount(null);
        setPayments([]);
      });
      clearCartAndNavDraft();

      if (created?.offline_queued) {
        toast({
          title: 'Offline saqlandi',
          description: `${orderNumber} — internet qaytganida serverga yuboriladi.`,
          className: 'bg-amber-50 border-amber-200',
        });
        clearPosSaleImportContext();
        setExchangeReturnMode(false);
        setDiscount({ type: 'amount', value: '' });
        setPromoCodeInput('');
        setLoyaltyRedeemPoints(0);
        resetCustomerSelection();
        setIsProcessingPayment(false);
        void voidImportedHoldOrderAfterSale(importedHoldOrderIdForSale);
        return;
      }

      if (importedWebOrderIdForSale) {
        try {
          await markImportedWebOrderSold(importedWebOrderIdForSale);
        } catch (e) {
          toast({
            title: 'Onlayn buyurtma holati',
            description: `Sotuv yakunlandi, lekin web buyurtma statusini "sotildi" qilishda xatolik: ${e instanceof Error ? e.message : String(e)}`,
            variant: 'destructive',
          });
        }
      }

      await voidImportedHoldOrderAfterSale(importedHoldOrderIdForSale);

      // Invalidate dashboard queries
      invalidateDashboardQueries(queryClient);

      // Update shift totals (local): kirim / chiqim
      if (currentShift) {
        if (total > 0) addSale(toShiftUzsAmount(total, saleCurrency, saleFxRate));
        else if (total < 0 && paymentMethod === POS_EXCHANGE_PAYOUT_METHOD) {
          addRefund({ amount: toShiftUzsAmount(Math.abs(total), saleCurrency, saleFxRate) });
        }
      }

      const movNow = new Date().toISOString();
      checkoutCart.forEach((item) => {
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
        successMessage =
          paymentMethod === POS_EXCHANGE_BALANCE_METHOD
            ? t('pos.exchange.success_refund_balance', {
                order: orderNumber,
                amount: formatMoneyUZS(Math.abs(total)),
              })
            : t('pos.exchange.success_refund', {
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
                  : paymentMethod === POS_EXCHANGE_BALANCE_METHOD
                    ? t('pos.exchange.receipt_payment_refund_balance')
                    : paymentMethod === 'zero_settle'
                    ? t('pos.exchange.receipt_payment_zero')
                    : paymentMethod === 'credit'
                      ? t('pos.credit')
                      : '—';
      
      const loyaltyReceiptMeta = await buildLoyaltyReceiptMeta(selectedCustomer);
      // Prepare receipt data (flushSync so the hidden Receipt renders immediately before printing)
      const nextReceipt = {
        orderNumber,
        items: checkoutCart,
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
          ? Math.max(
              0,
              -(
                created?.new_balance !== undefined
                  ? Number(created.new_balance)
                  : getActiveBucketBalance(selectedCustomer, saleCurrency) - creditAmountValue
              )
            )
          : 0,
        loyaltyCardCode: loyaltyReceiptMeta.loyaltyCardCode,
        loyaltyQrDataUrl: loyaltyReceiptMeta.loyaltyQrDataUrl,
        loyaltyQrPayload: loyaltyReceiptMeta.loyaltyQrPayload,
        currency: saleCurrency,
      };
      setLastReceiptData(nextReceipt);
      if (shouldAutoPrintReceipt(receiptSettings)) {
        setTimeout(() => {
          void printReceipt(nextReceipt as NonNullable<typeof receiptData>, { silent: true });
        }, 80);
      }

      // 3. Record Sale (Log to console)
      const saleRecord = {
        timestamp: new Date().toISOString(),
        orderNumber,
        totalAmount: total,
        itemsSold: checkoutCart.map(item => ({
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
      // 4. Update local product stock — tahrir (amend) backendda avval qaytaradi,
      // shuning uchun optimistik kamaytirish ikki marta hisoblanmasin.
      if (replacesOrderIdForSale) {
        void refreshCatalog();
      } else {
        const cartItemsForStockUpdate = [...checkoutCart];
        const updateProductsWithStockDeduction = (products: Product[]) =>
          products.map((product) => {
            const cartItem = cartItemsForStockUpdate.find((item) => item.product.id === product.id);
            if (cartItem) {
              const newStock = product.current_stock - (cartItem.qty_base ?? cartItem.quantity);
              return { ...product, current_stock: Math.max(0, newStock) };
            }
            return product;
          });

        setAllProducts((prev) => updateProductsWithStockDeduction(prev));
        setFavoriteProducts((prev) => updateProductsWithStockDeduction(prev));
        setSearchResults((prev) => updateProductsWithStockDeduction(prev));
      }

      toast({
        title: '✅ Sotuv amalga oshirildi!',
        description: successMessage,
        className: 'bg-green-50 border-green-200',
      });

      // Sale committed — dialog already closed; finish remaining UI reset.
      clearPosSaleImportContext();
      setExchangeReturnMode(false);
      setDiscount({ type: 'amount', value: '' });
      setPromoCodeInput('');
      setLoyaltyRedeemPoints(0);
      resetCustomerSelection();
      setSelectedCartIndex(-1);

      // Har doim yangilash: qarz yopilganda ham balans eski qolmasin (credit/bonus shart emas)
      void loadCustomers();

      if (!replacesOrderIdForSale) {
        setTimeout(() => {
          void refreshCatalog();
        }, 500);
      }

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
      if (isPosAmendCheckoutError(errorMessage)) {
        clearPosSaleImportContext();
      }
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handleCreditSale = async () => {
    if (isProcessingPayment) return;
    if (saleCurrency === 'USD') {
      toast({
        title: 'USD sotuv',
        description: 'Nasiya sotuv faqat UZS valyutada.',
        variant: 'destructive',
      });
      return;
    }
    if (!isPaymentEnabled('credit')) {
      toast({
        title: 'Qarzga sotuv o\'chirilgan',
        description: 'Qarzga to\'lov sozlamalarda o\'chirilgan.',
        variant: 'destructive',
      });
      return;
    }
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

    // Nasiya: net savat jami musbat bo‘lsa ruxsat (qaytarish qatorlari bo‘lsa ham).
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

    const checkoutCart = await resolveCheckoutCart();
    const {
      subtotal,
      discountAmount,
      total,
      loyaltyRedeemPointsApplied,
      globalDiscountAmount,
      loyaltyDiscountUzs,
    } = computeTotalsForCart(checkoutCart);

    if (total <= 0) {
      toast({
        title: 'Invalid Order Total',
        description: 'Order total must be greater than zero',
        variant: 'destructive',
      });
      return;
    }

    // Boshlang'ich naqd P: istalgan miqdor (savat + qarzdan oshiq bo‘lsa — mijoz oldindan to‘lovga o‘tadi)
    const initialPayment = creditAmount ?? 0;
    if (!Number.isFinite(initialPayment) || initialPayment < 0) {
      toast({
        title: t('common.error'),
        description: t('pos.error_negative_payment'),
        variant: 'destructive',
      });
      return;
    }

    const priorAmt = includePriorDebtInPayment ? priorDebtForCheckout : 0;
    const toPriorRaw = priorAmt > 0 ? Math.min(initialPayment, priorAmt) : 0;
    const toPrior = Number.isFinite(toPriorRaw) ? Math.max(0, toPriorRaw) : 0;
    const safePriorPaymentAmount = Math.round(toPrior);
    const orderCash = Math.max(0, initialPayment - toPrior);
    const merchCredit = Math.max(0, total - orderCash);
    const activeBalBefore = getActiveBucketBalance(selectedCustomer, saleCurrency);
    const projectedBalance = activeBalBefore + initialPayment - total;

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

    if (merchCredit > 0.01 && !creditDueDate) {
      toast({
        title: 'Qarz qaytarish sanasi',
        description: 'Nasiya uchun muddat sanasini tanlang.',
        variant: 'destructive',
      });
      return;
    }

    // Process credit sale (full or partial)
    setIsProcessingPayment(true);
    try {
      const importedHoldOrderIdForSale = importedHoldOrderId;
      const replacesOrderIdForSale = resolveReplacesOrderIdForCheckout(
        importedOrderIdForEditRef.current,
        importedHoldOrderIdRef.current,
      );
      // Stable per-checkout idempotency key (reused on retry) — same guard as
      // the cash/card path so a slow/429 re-submit cannot create a duplicate.
      const checkoutIdempotencyKey = getOrCreateCheckoutIdempotencyKey();
      const orderItems = buildOrderItemsSnapshot(checkoutCart, globalDiscountAmount + loyaltyDiscountUzs);

      let result: {
        success: boolean;
        order_number?: string;
        order_id?: string;
        new_balance?: number;
        error?: string;
      };

      if (orderCash > 0 || safePriorPaymentAmount > 0 || merchCredit > 0.01) {
        const applyPrepaid = orderCash > total + 0.01;
        const order: Record<string, unknown> = {
          order_number: '',
          order_uuid: checkoutIdempotencyKey,
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
          payment_status: (merchCredit > 0.01 ? 'partially_paid' : 'paid') as 'partially_paid' | 'paid',
          notes: null,
          apply_overpay_as_prepaid: applyPrepaid,
          ...(safePriorPaymentAmount > 0 ? { prior_debt_payment: safePriorPaymentAmount } : {}),
          ...(merchCredit > 0.01 && creditDueDate ? { due_date: creditDueDate } : {}),
          ...(merchCredit > 0.01 && creditReminderNote.trim()
            ? { credit_reminder_note: creditReminderNote.trim() }
            : {}),
          ...(loyaltyRedeemPointsApplied > 0 ? { loyalty_redeem_points: loyaltyRedeemPointsApplied } : {}),
          ...(selectedBonusReferrer?.id ? { bonus_referrer_customer_id: selectedBonusReferrer.id } : {}),
          ...orderCurrencyFields(saleCurrency, saleFxRate),
          ...(replacesOrderIdForSale ? { replaces_order_id: replacesOrderIdForSale } : {}),
        };

        const orderPaymentsData =
          orderCash > 0
            ? [
                {
                  payment_number: '',
                  payment_method: 'cash' as PaymentMethod,
                  amount: orderCash,
                  reference_number: null,
                  notes: null,
                },
              ]
            : [];

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
          order_uuid: checkoutIdempotencyKey,
          ...(creditDueDate ? { due_date: creditDueDate } : {}),
          ...(creditReminderNote.trim() ? { credit_reminder_note: creditReminderNote.trim() } : {}),
          ...(loyaltyRedeemPointsApplied > 0 ? { loyalty_redeem_points: loyaltyRedeemPointsApplied } : {}),
          ...(selectedBonusReferrer?.id ? { bonus_referrer_customer_id: selectedBonusReferrer.id } : {}),
          ...orderCurrencyFields(saleCurrency, saleFxRate),
          ...(replacesOrderIdForSale ? { replaces_order_id: replacesOrderIdForSale } : {}),
        });
        
        // Invalidate dashboard queries
        invalidateDashboardQueries(queryClient);
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to create credit order');
      }

      checkoutIdempotencyKeyRef.current = null;
      flushSync(() => {
        setPaymentDialogOpen(false);
        setCashReceived(null);
        setCreditAmount(null);
        setPayments([]);
      });
      clearCartAndNavDraft();

      if (replacesOrderIdForSale) {
        void refreshCatalog();
      }

      if (importedWebOrderId) {
        try {
          await markImportedWebOrderSold(importedWebOrderId);
        } catch (e) {
          toast({
            title: 'Onlayn buyurtma holati',
            description: `Nasiya sotuv yakunlandi, lekin web buyurtma statusini "sotildi" qilishda xatolik: ${e instanceof Error ? e.message : String(e)}`,
            variant: 'destructive',
          });
        }
      }

      await voidImportedHoldOrderAfterSale(importedHoldOrderIdForSale);

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

      const loyaltyReceiptMeta = await buildLoyaltyReceiptMeta(selectedCustomer);
      // Prepare receipt data for credit sale (flushSync so it renders before printing)
      // Credit sale is UZS-only (guarded above), so balance comes from new_balance.
      const finalBal = Number(result.new_balance ?? projectedBalance);
      const nextReceipt = {
        orderNumber: orderNumber || 'N/A',
        items: checkoutCart,
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
        customerTotalDebt: Math.max(0, -finalBal),
        loyaltyCardCode: loyaltyReceiptMeta.loyaltyCardCode,
        loyaltyQrDataUrl: loyaltyReceiptMeta.loyaltyQrDataUrl,
        loyaltyQrPayload: loyaltyReceiptMeta.loyaltyQrPayload,
        currency: saleCurrency,
      };
      setLastReceiptData(nextReceipt);
      if (shouldAutoPrintReceipt(receiptSettings)) {
        setTimeout(() => {
          void printReceipt(nextReceipt as NonNullable<typeof receiptData>, { silent: true });
        }, 80);
      }

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
        const updatedCustomer = {
          ...selectedCustomer,
          balance: Number(result.new_balance ?? projectedBalance),
          balance_usd: (selectedCustomer as Customer).balance_usd,
        };

        // Keep the customer list in sync, but don't carry the selection into the next sale.
        setCustomers(prevCustomers =>
          prevCustomers.map(c =>
            c.id === selectedCustomer.id ? updatedCustomer : c
          )
        );
      }

      clearPosSaleImportContext();
      setDiscount({ type: 'amount', value: '' });
      setPromoCodeInput('');
      setLoyaltyRedeemPoints(0);
      resetCustomerSelection();
      setSelectedCartIndex(-1);

      // Refresh customer data to ensure sync
      void loadCustomers();
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', creditCustomerId] });

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
      if (isPosAmendCheckoutError(errorMessage)) {
        clearPosSaleImportContext();
      }
    } finally {
      setIsProcessingPayment(false);
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
    return computeCheckoutGrandTotal(total, priorDebtForCheckout, includePriorDebtInPayment);
  }, [total, includePriorDebtInPayment, priorDebtForCheckout]);

  // Memoize paid amount calculation
  const paidAmount = useMemo(() => {
    return payments.reduce((sum, p) => sum + p.amount, 0);
  }, [payments]);

  const remainingAmount = useMemo(() => {
    if (checkoutGrandTotal <= 0) return 0;
    return checkoutGrandTotal - paidAmount;
  }, [checkoutGrandTotal, paidAmount]);

  // Keyboard shortcuts (after checkoutGrandTotal / handleCompletePayment to avoid TDZ)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === 'F10') {
        e.preventDefault();
        handlePrintLastReceipt();
        return;
      }

      if (e.key === 'F9') {
        e.preventDefault();
        if (cart.length > 0 && !paymentDialogOpen && !isProcessingPayment) {
          if (stockRiskCount > 0) {
            toast({
              title: t('pos.stock_insufficient_title', { defaultValue: 'Yetarli qoldiq yo‘q' }),
              description: stockBlockedReason,
              variant: 'destructive',
            });
            return;
          }
          const canFastCash =
            currentShift &&
            !waitingOrdersDialogOpen &&
            !isDiscountActionDisabled &&
            !hasReturnLine &&
            checkoutGrandTotal > 0;
          if (canFastCash) {
            void handleCompletePayment('cash', { cashAmountOverride: checkoutGrandTotal });
          } else {
            setPaymentDialogOpen(true);
          }
        }
        return;
      }

      if (e.key === 'F8') {
        e.preventDefault();
        if (paymentDialogOpen || waitingOrdersDialogOpen) return;
        setExchangeReturnMode((v) => {
          if (!v) {
            const ok = window.confirm(
              t('pos.exchange.return_mode_confirm', {
                defaultValue:
                  'Qaytarish rejimiga o‘tasizmi? Keyingi mahsulotlar manfiy (qaytarish) qator sifatida qo‘shiladi.',
              }),
            );
            if (!ok) return v;
          }
          return !v;
        });
        return;
      }

      if (e.key === 'F3') {
        e.preventDefault();
        if (cart.length > 0) {
          void handleHoldOrderShortcutRef.current();
        }
        return;
      }

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

      if (e.key === 'Enter' && target === searchInputRef.current && searchResults.length > 0) {
        e.preventDefault();
        requestAddToCart(searchResults[0]);
        focusSearchInput();
        return;
      }

      if (e.altKey && selectedCartIndex >= 0 && cart[selectedCartIndex]) {
        const item = cart[selectedCartIndex];
        const step = getQuantityStep(item.sale_unit || item.product.unit);
        if (e.key === '1') {
          e.preventDefault();
          updateQuantity(item.product.id, (item.qty_sale ?? item.quantity) + step);
          return;
        }
        if (e.key === '5') {
          e.preventDefault();
          updateQuantity(item.product.id, (item.qty_sale ?? item.quantity) + step * 5);
          return;
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          updateQuantity(item.product.id, (item.qty_sale ?? item.quantity) - step);
          return;
        }
      }

      if (e.altKey && e.key >= '1' && e.key <= '8') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (quickProducts[index]) {
          requestAddToCart(quickProducts[index]);
        }
        return;
      }

      if (target === searchInputRef.current) return;
      if (isInput) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCartIndex((prev) => Math.max(0, prev - 1));
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCartIndex((prev) => Math.min(cart.length - 1, prev + 1));
        return;
      }

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
    quickProducts,
    isProcessingPayment,
    currentShift,
    handlePrintLastReceipt,
    checkoutGrandTotal,
    isDiscountActionDisabled,
    hasReturnLine,
    handleCompletePayment,
    stockRiskCount,
    stockBlockedReason,
    t,
    toast,
  ]);

  // Get products to display (search results or all products filtered by category)
  const displayProducts = useMemo(() => {
    if (searchResults.length > 0) return searchResults;
    if (selectedCategory) {
      return allProducts.filter((p) =>
        productMatchesCategoryFilter(p.category_id, selectedCategory, categories)
      );
    }
    return allProducts;
  }, [searchResults, allProducts, selectedCategory, categories]);

  const MAX_DISPLAY = displayProducts.length;
  const isTruncated = false;
  const visibleProducts = displayProducts;
  const categoryNameById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  useEffect(() => {
    let cancelled = false;
    void loadRetailUsdPricesForProducts(visibleProducts).then((map) => {
      if (!cancelled) setUsdRetailByProductId(map);
    });
    return () => {
      cancelled = true;
    };
  }, [visibleProducts]);

  const quickProductCandidates = useMemo(() => {
    const term = quickProductSearch.trim();
    const source = term ? allProducts : favoriteProducts;
    return filterPosProductsBySearchTerm(source, term).slice(0, 30);
  }, [allProducts, favoriteProducts, quickProductSearch]);

  const toggleQuickProduct = useCallback((productId: string) => {
    setQuickProductIds((prev) => {
      if (prev.includes(productId)) return prev.filter((id) => id !== productId);
      return [productId, ...prev].slice(0, MAX_POS_QUICK_PRODUCTS);
    });
  }, []);

  // Show "No open shift" state if shift is not open
  if (!currentShift) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted">
            <Lock className="h-10 w-10 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">{t('pos.shift_closed_title')}</h2>
            <p className="text-muted-foreground">
              {t('pos.shift_closed_hint')}
            </p>
          </div>
          <ShiftControl />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => navigate('/customers')}
          >
            <Users className="h-3.5 w-3.5" />
            {t('navigation.customers')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Split View: flex-1 + min-h-0 — mahsulot va savat viewport bo‘yicha cho‘ziladi */}
      {/* Chap/yuqori/pastki: layout paddingini yutish; o‘ng tomonda padding yo‘q (main !pr-0) — rail chekkaga */}
      <div className="-mb-4 -ml-4 -mt-4 flex h-full min-h-0 w-full min-w-0 max-w-none flex-1 flex-col self-stretch overflow-x-hidden xl:-mb-6 xl:-ml-6 xl:-mt-6">
        {/* xl: mahsulot | savat+rail — savat kengligi barqaror, rail o‘ng chetga */}
        <div className="flex min-h-0 min-w-0 w-full max-w-none flex-1 flex-col gap-2 pl-2 pt-2 pb-0 pr-0 sm:gap-3 md:gap-4 md:pl-3 md:pt-3 md:pb-0 md:pr-0 xl:flex-row xl:flex-nowrap xl:items-stretch xl:gap-0 xl:pl-3 xl:pt-3 xl:pb-0 xl:pr-0">
          {/* Left Column - Product Catalog */}
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-white xl:min-w-0 xl:flex-1 xl:pr-3">
            {/* Compact toolbar + search — single header block */}
            <div className="flex-shrink-0 border-b bg-white px-2 py-1.5 dark:bg-gray-900">
              {scanIndexLoading && (
                <p className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" aria-hidden />
                  Katalog yuklanmoqda…
                </p>
              )}
              {catalogLoadError && (
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950">
                  <span className="min-w-0 flex-1">{catalogLoadError}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => void loadAllProducts()}
                  >
                    {t('common.retry', { defaultValue: 'Qayta urinish' })}
                  </Button>
                </div>
              )}
              <TooltipProvider delayDuration={300}>
                <div className="flex min-w-0 items-center gap-1">
                  <ShiftControl compact />
                  <div className="mx-0.5 hidden h-4 w-px shrink-0 bg-border sm:block" aria-hidden />
                  <NetworkBadge compact />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => navigate('/customers')}
                        aria-label={t('navigation.customers')}
                      >
                        <Users className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('navigation.customers')}</TooltipContent>
                  </Tooltip>
                  {isPaymentEnabled('credit') && saleCurrency !== 'USD' && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => setCreditDebtsOpen(true)}
                          aria-label="Qarzlar (nasiya)"
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Qarzlar (nasiya)</TooltipContent>
                    </Tooltip>
                  )}
                  <div className="relative min-w-[6rem] flex-1">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={searchInputRef}
                      placeholder={t('pos.search_placeholder')}
                      value={searchTerm}
                      onChange={(e) => handleSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (searchResults.length > 0) {
                            requestAddToCart(searchResults[0]);
                            focusSearchInput();
                            return;
                          }
                          const raw = (e.currentTarget as HTMLInputElement)?.value || '';
                          if (raw) handleBarcodeSearch(raw, { clearSearch: true });
                        }
                      }}
                      className={cn(
                        'h-8 pl-7 text-xs font-medium',
                        searchTerm ? 'pr-7' : 'pr-2',
                      )}
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
                        className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label="Qidiruvni tozalash"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-0.5 rounded-md border p-0.5"
                    title={
                      saleCurrency === 'USD' && saleFxRate != null && saleFxRate > 0
                        ? `1 USD = ${formatMoney(saleFxRate, 'UZS')}`
                        : undefined
                    }
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant={saleCurrency === 'UZS' ? 'default' : 'ghost'}
                      className="h-6 px-2 text-[10px]"
                      disabled={saleFxLoading}
                      onClick={() => setSaleCurrency('UZS')}
                    >
                      UZS
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={saleCurrency === 'USD' ? 'default' : 'ghost'}
                      className="h-6 px-2 text-[10px]"
                      disabled={saleFxLoading}
                      onClick={() => setSaleCurrency('USD')}
                    >
                      USD
                    </Button>
                  </div>
                  <PosDeviceBar
                    className="shrink-0"
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
              </TooltipProvider>

              {!searchTerm && recentPosSearches.length > 0 && (
                <div className="mt-1 flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <span className="shrink-0 text-[10px] text-muted-foreground">Oxirgi:</span>
                  {recentPosSearches.slice(0, 8).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        handleSearch(s);
                        if (searchInputRef.current) searchInputRef.current.value = s;
                      }}
                      className="group flex max-w-[8rem] shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                      title={s}
                    >
                      <Clock className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{s}</span>
                      <span
                        className="hidden h-3 w-3 shrink-0 items-center justify-center rounded-full group-hover:inline-flex hover:bg-destructive/20 hover:text-destructive"
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
            </div>

            {/* Product List - virtualized grid (cart updates do not re-render rows when props stable) */}
            <div className="flex min-h-0 flex-1 flex-col">
              <PosProductGrid
                products={visibleProducts}
                totalCount={displayProducts.length}
                isTruncated={isTruncated}
                maxDisplay={MAX_DISPLAY}
                searchTerm={searchTerm}
                saleCurrency={saleCurrency}
                saleFxRate={saleFxRate}
                usdRetailByProductId={usdRetailByProductId}
                formatCurrency={formatCurrency}
                formatMoney={formatMoney}
                hasPromoForProduct={hasPromoForProduct}
                onRequestAddToCart={requestAddToCart}
                onQuickAddOneToCart={quickAddOneToCart}
                onFocusSearch={focusSearchInput}
                renderSkuWithHighlight={renderSkuWithHighlight}
                categoryNameById={categoryNameById}
                allowOutOfStockAdd={exchangeReturnMode}
                loadError={catalogLoadError}
                onRetryLoad={() => void loadAllProducts()}
                t={t}
              />
            </div>
          </div>

          {/* Savat + rail: xl da qat’iy kenglik — savat tarkibidan qat’iy nazar o‘zgarmaydi */}
          <div className="flex min-h-[min(280px,min(48vh,52dvh))] min-h-0 w-full min-w-0 flex-1 flex-row overflow-hidden rounded-xl border border-border bg-white xl:h-full xl:max-h-full xl:min-h-0 xl:w-[calc(470px+3.5rem)] xl:min-w-[calc(470px+3.5rem)] xl:max-w-[calc(470px+3.5rem)] xl:flex-none xl:flex-row xl:items-stretch xl:overflow-hidden xl:rounded-none xl:border-0 xl:bg-transparent">
            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-white xl:w-[470px] xl:min-w-[470px] xl:max-w-[470px] xl:flex-none xl:rounded-xl xl:rounded-r-none xl:border xl:border-r-0 xl:border-border">
            <PosCustomerReferrerPanel
              t={t}
              customers={customers}
              recentCustomers={recentCustomers}
              selectedCustomer={selectedCustomer}
              selectedBonusReferrer={selectedBonusReferrer}
              customerComboboxOpen={customerComboboxOpen}
              setCustomerComboboxOpen={setCustomerComboboxOpen}
              customerSearchTerm={customerSearchTerm}
              setCustomerSearchTerm={setCustomerSearchTerm}
              bonusReferrerComboboxOpen={bonusReferrerComboboxOpen}
              setBonusReferrerComboboxOpen={setBonusReferrerComboboxOpen}
              bonusReferrerSearchTerm={bonusReferrerSearchTerm}
              setBonusReferrerSearchTerm={setBonusReferrerSearchTerm}
              bonusReferrerCandidates={bonusReferrerCandidates}
              applySelectedCustomer={applySelectedCustomer}
              applySelectedBonusReferrer={applySelectedBonusReferrer}
              isWalkInCustomer={isWalkInCustomer}
              saleCurrency={saleCurrency}
              currentTierCode={currentTierCode}
              getCustomerDebtInCurrency={getCustomerDebtInCurrency}
              getCustomerCreditInCurrency={getCustomerCreditInCurrency}
              formatCurrency={formatCurrency}
              priorDebtInSaleCurrency={priorDebtInSaleCurrency}
              priorCreditInSaleCurrency={priorCreditInSaleCurrency}
              onPayCustomerDebt={() => setCustomerPaymentOpen(true)}
            />

            {/* Savat ro‘yxati (tezkor bar alohida grid ustuni) */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div className="z-10 flex shrink-0 flex-col gap-0.5 border-b px-2 py-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {t('pos.exchange.cart_count', { count: cart.length })}
                    </span>
                  </div>
                  {undoCartSnapshot && (
                    <div className="flex items-center justify-between rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-200">
                      <span>{undoMessage || "Oxirgi amalni bekor qilish mumkin"}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] text-blue-900 hover:bg-blue-100 dark:text-blue-100 dark:hover:bg-blue-900/50"
                        onClick={restoreUndoCart}
                      >
                        Bekor qilish
                      </Button>
                    </div>
                  )}
                  {!currentShift && (
                    <div className="flex items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                      <span>To'lov va hold uchun avval smena oching.</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 border-amber-300 bg-amber-100 px-2 text-[10px] text-amber-900 hover:bg-amber-200"
                        onClick={() => {
                          const trigger = document.getElementById('open-shift-trigger');
                          if (trigger instanceof HTMLButtonElement) {
                            trigger.click();
                          } else {
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }
                        }}
                      >
                        Smenani ochish
                      </Button>
                    </div>
                  )}
                  {isDiscountActionDisabled && (
                    <p className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
                      Chegirma holatini to'g'rilang: {discountActionDisabledReason}
                    </p>
                  )}
                  {stockRiskCount > 0 && (
                    <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] font-medium text-destructive">
                      {stockBlockedReason}
                      {stockRiskLines.slice(0, 2).map((line) => (
                        <span key={line.productId} className="mt-0.5 block font-normal opacity-90">
                          {line.productName}: {line.requested} &gt; {line.available}
                        </span>
                      ))}
                    </p>
                  )}
                  {exchangeReturnMode && (
                    <p className="rounded border-2 border-amber-600 bg-amber-100 px-2 py-2 text-xs font-semibold text-amber-950 dark:border-amber-400 dark:bg-amber-950/60 dark:text-amber-100">
                      {t('pos.exchange.return_mode_banner')}
                    </p>
                  )}
                  {importedOrderIdForEdit && importedOrderNumberForEdit && (
                    <div className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100">
                      <p className="font-semibold">
                        {t('pos.order_import.amend_banner', { num: importedOrderNumberForEdit })}
                      </p>
                      <p className="mt-0.5 opacity-90">{t('pos.order_import.amend_banner_hint')}</p>
                    </div>
                  )}
                  {importedHoldOrderId && importedHoldOrderNumber && !importedOrderIdForEdit && (
                    <div className="rounded border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
                      <p className="font-semibold">
                        {t('pos.order_import.hold_banner', { num: importedHoldOrderNumber })}
                      </p>
                      <p className="mt-0.5 opacity-90">{t('pos.order_import.hold_banner_hint')}</p>
                    </div>
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => searchInputRef.current?.focus()}
                    >
                      Mahsulot tanlash
                    </Button>
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
                  const codeMeta = formatPosProductCodeMeta(item.product);
                  return (
                    <div key={`${item.product.id}-${index}`} className="group relative">
                      {/* Main Row */}
                      <div
                        className={`flex items-center justify-between bg-white dark:bg-gray-800 transition-colors ${
                          posUiMode === 'beginner' ? 'p-2' : 'p-1.5'
                        } ${
                          isSelected ? 'bg-primary/10 ring-1 ring-inset ring-primary/20' : ''
                        } ${isRecent ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${
                          isBelowCost && showCostPrice ? 'bg-red-50 dark:bg-red-900/10' : ''
                        }`}
                        onClick={() => setSelectedCartIndex(index)}
                      >
                        {/* Left Side - Product Info */}
                        <div className="flex flex-col flex-1 min-w-0 mr-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="min-w-0 truncate text-[11px] font-medium leading-tight md:text-xs">{item.product.name}</p>
                            {(item.qty_sale ?? item.quantity) < 0 && (
                              <span className="shrink-0 text-[9px] text-destructive">
                                {t('pos.exchange.line_badge_return')}
                              </span>
                            )}
                            {isBelowCost && showCostPrice && (
                              <span title="Narx tannarxdan past!" className="inline-flex">
                                <AlertTriangle className="h-3 w-3 text-destructive flex-shrink-0" />
                              </span>
                            )}
                          </div>
                          {codeMeta ? (
                            <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground" title={codeMeta}>
                              {codeMeta}
                            </p>
                          ) : null}
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            {(item.promotion_name || item.price_source === 'promo') ? (
                              <p className="text-[10px] text-muted-foreground">
                                {formatCurrency(Number(item.unit_price || 0))}
                                <span className="text-muted-foreground/80">
                                  {' '}
                                  / {formatUnit(unit) || unit}
                                </span>
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
                                    className="text-left text-[10px] text-muted-foreground hover:text-primary underline-offset-2 hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {formatCurrency(Number(item.unit_price || 0))}
                                    <span className="text-muted-foreground/80">
                                      {' '}
                                      / {formatUnit(unit) || unit}
                                    </span>
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
                              <span className="text-[9px] text-muted-foreground">
                                {getTierLabel(item.price_tier)}
                              </span>
                            )}
                            {item.price_source === 'manual' && (
                              <span className="text-[9px] text-amber-700 dark:text-amber-300">
                                {t('pos.manual_price_badge')}
                              </span>
                            )}
                            {renderPromotionBadges(item)}
                            {item.discount_amount > 0 && !item.promotion_name && (
                              <span className="text-[9px] text-muted-foreground">−</span>
                            )}
                            {showCostPrice && (
                              <p className="text-[9px] text-muted-foreground">
                                {formatCurrency(costPrice)}
                              </p>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <div className="w-20">
                              <Select
                                value={unit}
                                onValueChange={(value) => void updateSaleUnit(item.product.id, value)}
                              >
                                <SelectTrigger className="h-6 text-[10px]">
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
                            <div className={cn(
                              'flex items-center gap-1 transition-opacity',
                              posUiMode === 'fast'
                                ? (isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
                                : 'opacity-100'
                            )}>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 min-h-0 min-w-7 touch-manipulation px-1 text-[10px] md:h-5 md:min-w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Labeled ±1 / +5 always step by whole sale units (not 0.001 for m/kg).
                                  updateQuantity(item.product.id, (item.qty_sale ?? item.quantity) - 1);
                                }}
                              >
                                -1
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 min-h-0 min-w-7 touch-manipulation px-1 text-[10px] md:h-5 md:min-w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateQuantity(item.product.id, (item.qty_sale ?? item.quantity) + 1);
                                }}
                              >
                                +1
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 min-h-0 min-w-8 touch-manipulation px-1 text-[10px] md:h-5 md:min-w-7"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateQuantity(
                                    item.product.id,
                                    (item.qty_sale ?? item.quantity) + 5
                                  );
                                }}
                              >
                                +5
                              </Button>
                            </div>
                            {(item.product as any)?.product_units?.length > 1 && (
                              <p className="hidden text-[9px] text-muted-foreground md:block">
                                {formatQuantity(item.qty_sale ?? item.quantity, unit)} {formatUnit(unit)} =
                                {` `}
                                {formatQuantity(
                                  Number(item.qty_base) ||
                                    toBaseQty(
                                      Number(item.qty_sale ?? item.quantity ?? 0) || 0,
                                      Number(item.ratio_to_base ?? 1) || 1,
                                    ),
                                  baseUnit,
                                )}{' '}
                                {formatUnit(baseUnit)}
                              </p>
                            )}
                          </div>
                        </div>
                        
                        {/* Right Side - Controls */}
                        <div className="flex shrink-0 items-center gap-1.5">
                          {/* Quantity Group */}
                          <div className="flex shrink-0 items-center">
                            <button
                              type="button"
                              className="flex h-9 w-7 shrink-0 touch-manipulation items-center justify-center rounded bg-muted/60 hover:bg-muted md:h-6 md:w-6 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateQuantity(
                                  item.product.id,
                                  (item.qty_sale ?? item.quantity) - quantityStep,
                                );
                              }}
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <Input
                              type="text"
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
                                openQuantityNumpad(
                                  item.product.id,
                                  item.qty_sale ?? item.quantity,
                                  item.product.current_stock,
                                );
                              }}
                              className="h-9 w-12 min-w-[2.75rem] shrink-0 touch-manipulation rounded-none border-y border-border bg-background px-0.5 text-center text-[11px] focus:outline-none md:h-6 md:w-12 md:text-[10px]"
                            />
                            <button
                              type="button"
                              className="flex h-9 w-7 shrink-0 touch-manipulation items-center justify-center rounded bg-muted/60 hover:bg-muted md:h-6 md:w-6 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateQuantity(
                                  item.product.id,
                                  (item.qty_sale ?? item.quantity) + quantityStep,
                                );
                              }}
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                          
                          {/* Total Price */}
                          <div className="min-w-[3.5rem] text-right">
                            <p className="text-[11px] font-semibold md:text-xs">
                              {formatCurrency(item.total)}
                            </p>
                          </div>
                          
                          {/* Delete Button */}
                          <button
                            type="button"
                            className="flex min-h-9 min-w-7 touch-manipulation items-center justify-center rounded text-destructive/80 hover:bg-destructive/10 md:min-h-0 md:min-w-0 md:p-1 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFromCart(item.product.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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
                                  <div
                                    className="cursor-pointer"
                                    onClick={() =>
                                      openDiscountNumpad(item.product.id, item.discount_amount, item.subtotal)
                                    }
                                  >
                                    <MoneyInput
                                      value={item.discount_amount > 0 ? item.discount_amount : null}
                                      onValueChange={(v) =>
                                        updateLineDiscount(item.product.id, v ?? 0)
                                      }
                                      max={item.subtotal}
                                      allowZero
                                      readOnly
                                      placeholder="0"
                                      containerClassName="space-y-0"
                                      className="h-8"
                                    />
                                  </div>
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

            {/* Pastki qism: jami + faqat To‘lash — mobil pastki xavfsiz zona (home indicator) */}
            <div className="shrink-0 border-t bg-white dark:bg-gray-900 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {/* Totals */}
              <div className="space-y-1 pt-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">{t('pos.subtotal')}</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                {ustaSavings > 0 && (
                  <div className="flex justify-between text-[10px] text-emerald-700 dark:text-emerald-300">
                    <span>{getTierLabel(currentTierCode)} narx farqi:</span>
                    <span>-{formatCurrency(ustaSavings)}</span>
                  </div>
                )}
                {lineDiscountsTotal > 0 && (
                  <div className="flex justify-between text-[10px] text-destructive">
                    <span>{t('pos.line_discounts')}:</span>
                    <span>-{formatCurrency(lineDiscountsTotal)}</span>
                  </div>
                )}
                {globalDiscountAmount > 0 && (
                  <div className="flex justify-between text-[10px] text-destructive">
                    <span>{t('pos.order_discount_label')}:</span>
                    <span>-{formatCurrency(globalDiscountAmount)}</span>
                  </div>
                )}
                {loyaltyCfg.redeemEnabled &&
                  saleCurrency !== 'USD' &&
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
                      <NumberInput
                        value={loyaltyRedeemPoints > 0 ? loyaltyRedeemPoints : null}
                        onValueChange={(v) => setLoyaltyRedeemPoints(Math.max(0, Math.floor(v ?? 0)))}
                        allowZero
                        min={0}
                        placeholder="Ishlatiladigan ball"
                        disabled={cart.length === 0}
                        containerClassName="space-y-0"
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
                  <div className="flex justify-between text-[11px] text-destructive">
                    <span>{t('pos.total_discount')}</span>
                    <span>-{formatCurrency(discountAmount)}</span>
                  </div>
                )}
                {priorDebtForCheckout > 0 && total > 0 && (
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>Oldingi qarz</span>
                    <span className="font-mono">
                      {formatCurrency(priorDebtForCheckout)}
                      {!includePriorDebtInPayment ? ' (alohida)' : ''}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-1.5 text-base font-bold">
                  <span>{t('pos.total')}</span>
                  <span className="text-primary">{formatCurrency(checkoutGrandTotal)}</span>
                </div>
                
                {/* Cost Price and Profit Summary */}
                {showCostPrice && cart.length > 0 && (() => {
                  // purchase_price is UZS; convert to sale currency so profit uses one unit
                  const totalCostUzs = cart.reduce((sum, item) => {
                    const costPriceUzs = Number(item.product.purchase_price || 0);
                    return sum + costPriceUzs * (item.qty_base ?? item.quantity);
                  }, 0);
                  const totalCost =
                    saleCurrency === 'USD'
                      ? convertAtRate(totalCostUzs, 'UZS', 'USD', saleFxRate)
                      : totalCostUzs;
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

              <div className="space-y-1.5 border-t pt-2">
                <Label className="text-[11px] font-normal text-muted-foreground">{t('pos.order_discount')}</Label>
                <div className="flex items-center gap-1.5">
                  <Select
                    value={discount.type}
                    onValueChange={(value) =>
                      setDiscount({ ...discount, type: value as 'amount' | 'percent' | 'promo' })
                    }
                  >
                    <SelectTrigger
                      className="h-8 w-[3.75rem] shrink-0 text-xs"
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
                        className="h-8 min-w-0 flex-1 font-mono text-xs uppercase"
                        disabled={cart.length === 0}
                      />
                      {promoCodeInput ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          title={t('pos.clear')}
                          onClick={() => setPromoCodeInput('')}
                          disabled={cart.length === 0}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </>
                  ) : discount.type === 'amount' ? (
                    <MoneyInput
                      value={parsedDiscountValue}
                      onValueChange={(v) =>
                        setDiscount({
                          ...discount,
                          value: v == null ? '' : String(v),
                        })
                      }
                      max={maxDiscountAmount > 0 ? maxDiscountAmount : undefined}
                      allowZero
                      placeholder="0"
                      disabled={cart.length === 0}
                      containerClassName="min-w-0 flex-1 space-y-0"
                      className={cn('h-8 text-xs', discountError !== '' && 'border-destructive')}
                    />
                  ) : (
                    <NumberInput
                      value={parsedDiscountValue}
                      onValueChange={(v) =>
                        setDiscount({
                          ...discount,
                          value: v == null ? '' : String(v),
                        })
                      }
                      max={100}
                      allowZero
                      placeholder="0"
                      disabled={cart.length === 0}
                      containerClassName="min-w-0 flex-1 space-y-0"
                      className={cn('h-8 text-xs', discountError !== '' && 'border-destructive')}
                    />
                  )}
                </div>
                {discountError !== '' && (
                  <p className="text-xs text-destructive">{discountError}</p>
                )}
              </div>

              <div className="pt-2">
                <Button
                  className="h-11 w-full touch-manipulation bg-green-600 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  size="lg"
                  disabled={
                    cart.length === 0 ||
                    isDiscountActionDisabled ||
                    !currentShift ||
                    isProcessingPayment ||
                    stockRiskCount > 0
                  }
                  title={paymentDisabledReason || undefined}
                  onClick={() => {
                    if (stockRiskCount > 0) {
                      toast({
                        title: t('pos.stock_insufficient_title', {
                          defaultValue: 'Yetarli qoldiq yo‘q',
                        }),
                        description: stockBlockedReason,
                        variant: 'destructive',
                      });
                      return;
                    }
                    setPaymentDialogOpen(true);
                  }}
                >
                  <DollarSign className="mr-1.5 h-4 w-4" />
                  {t('pos.pay_checkout')}
                </Button>
              </div>
            </div>
            </div>
          <aside
            className="flex w-14 shrink-0 grow-0 basis-14 flex-col items-stretch border-l border-border bg-muted/30 py-2 xl:h-full xl:min-h-0 xl:w-14 xl:flex-none xl:self-stretch xl:rounded-none xl:border-y-0 xl:border-r-0 xl:bg-muted/40 xl:py-0"
            aria-label="Savat tezkor tugmalari"
          >
            <div className="flex flex-row flex-wrap items-end justify-start gap-2.5 px-1 py-0.5 shrink-0 xl:flex-col xl:items-stretch xl:gap-2 xl:px-0 xl:py-2">
            <Button
              type="button"
              variant={selectedCategory ? 'default' : 'outline'}
              size="icon"
              className="h-12 w-12 shrink-0"
              title={`Kategoriyalar${selectedCategory ? `: ${categories.find((c) => c.id === selectedCategory)?.name || ''}` : ''}`}
              aria-label="Kategoriyalar"
              onClick={() => {
                setCategorySheetMode('categories');
                setCategorySheetOpen(true);
              }}
            >
              <FolderTree className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              variant={quickProducts.length > 0 ? 'default' : 'outline'}
              size="icon"
              className="relative h-12 w-12 shrink-0"
              title="Tezkor mahsulot tanlash"
              aria-label="Tezkor mahsulot tanlash"
              onClick={() => {
                setCategorySheetMode('quick');
                setCategorySheetOpen(true);
              }}
            >
              <Star className="h-5 w-5" />
              {quickProducts.length > 0 && (
                <Badge
                  variant="secondary"
                  className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full p-0 px-1 text-[10px]"
                >
                  {quickProducts.length}
                </Badge>
              )}
            </Button>
            <Button
              type="button"
              variant={exchangeReturnMode ? 'default' : 'outline'}
              size="icon"
              className={cn(
                'h-12 w-12 shrink-0',
                exchangeReturnMode && 'text-primary-foreground [&_svg]:text-primary-foreground'
              )}
              title={`${t('pos.exchange.return_mode_short')} (F8)`}
              aria-label={`${t('pos.exchange.return_mode_short')} (F8)`}
              aria-pressed={exchangeReturnMode}
              onClick={() =>
                setExchangeReturnMode((v) => {
                  if (!v) {
                    const ok = window.confirm(
                      t('pos.exchange.return_mode_confirm', {
                        defaultValue:
                          'Qaytarish rejimiga o‘tasizmi? Keyingi mahsulotlar manfiy (qaytarish) qator sifatida qo‘shiladi.',
                      }),
                    );
                    if (!ok) return v;
                  }
                  return !v;
                })
              }
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
              aria-label={showCostPrice ? "Tannarx yashirish" : "Tannarx ko'rish"}
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
              aria-label="Savatni tekshirish"
              onClick={() => setCartReviewOpen(true)}
            >
              <ClipboardList className="h-5 w-5" />
            </Button>

            {posTerminalSettings.enable_hold_order && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-12 w-12 shrink-0 border-yellow-600 bg-yellow-500 text-white hover:bg-yellow-600 hover:text-white"
                title={!currentShift ? shiftRequiredReason : t('pos.hold_order')}
                aria-label={t('pos.hold_order')}
                disabled={!currentShift}
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
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="relative h-12 w-12 shrink-0"
              title="Kutilayotgan buyurtmalar"
              aria-label="Kutilayotgan buyurtmalar"
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
              disabled={!lastReceiptData || isPrintingReceipt}
              title="Chek (F10) — mijoz cheki"
              aria-label="Chekni chop etish"
              onClick={handlePrintLastReceipt}
            >
              {isPrintingReceipt ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Printer className="h-5 w-5" />
              )}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="h-12 w-12 shrink-0"
              disabled={cart.length === 0}
              title="Tozalash"
              aria-label="Savatni tozalash"
              onClick={() => {
                if (cart.length === 0) {
                  toast({
                    title: t('pos.cart_empty'),
                    variant: 'destructive',
                  });
                  return;
                }
                queueCartUndo(cart, 'Savat tozalandi');
                clearCartAndNavDraft();
                clearPosSaleImportContext();
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
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-12 w-12 shrink-0"
              title="Hotkey qo'llanma"
              aria-label="Hotkey qo'llanma"
              onClick={() => setHotkeyGuideOpen(true)}
            >
              <Keyboard className="h-5 w-5" />
            </Button>
            </div>

            <div className="mx-1 mb-1 mt-0 hidden min-h-0 flex-1 rounded-md bg-gradient-to-b from-muted/0 via-muted/20 to-muted/35 px-1 py-2 dark:via-muted/10 dark:to-muted/25 xl:mx-0 xl:flex xl:flex-col xl:items-center xl:gap-2 xl:px-0">
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
                <SelectTrigger className="h-12 w-12 self-center justify-center px-1 text-[9px] [&>span]:truncate [&>svg]:ml-0">
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
              <div className="flex w-full justify-center">
                <QuickCustomerCreate
                  className="h-12 w-12 self-center px-0"
                  onCreated={(customer) => {
                    setCustomers((prev) => {
                      const exists = prev.some((c) => c.id === customer.id);
                      return exists ? prev : [customer, ...prev];
                    });
                    applySelectedCustomer(customer);
                  }}
                />
              </div>
            </div>

          </aside>
          </div>
        </div>
      </div>

      <Dialog open={cartReviewOpen} onOpenChange={setCartReviewOpen}>
        <DialogContent className="flex max-h-[min(100dvh,720px)] min-h-0 w-[min(96vw,56rem)] max-w-[min(96vw,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,56rem)]">
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
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate">{item.product.name}</span>
                            {(() => {
                              const article = String(item.product.article ?? '').trim();
                              const brand = String(item.product.brand ?? '').trim();
                              const sub = [article, brand].filter(Boolean).join(' · ');
                              return sub ? (
                                <span className="truncate text-[11px] font-normal text-muted-foreground" title={sub}>
                                  {sub}
                                </span>
                              ) : null;
                            })()}
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
                              {renderPromotionBadges(item)}
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

      <Dialog
        open={paymentDialogOpen}
        onOpenChange={(open) => {
          if (open && stockRiskCount > 0) {
            toast({
              title: t('pos.stock_insufficient_title', { defaultValue: 'Yetarli qoldiq yo‘q' }),
              description: stockBlockedReason,
              variant: 'destructive',
            });
            return;
          }
          setPaymentDialogOpen(open);
        }}
      >
        <DialogContent className="flex max-h-[min(92dvh,840px)] w-[min(calc(100vw-1rem),42rem)] max-w-[min(calc(100vw-1rem),42rem)] flex-col gap-4 overflow-y-auto overflow-x-hidden pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('pos.process_payment')}</DialogTitle>
            <DialogDescription>
              {total > 0 && priorDebtForCheckout > 0 ? (
                <span className="block space-y-1 text-foreground">
                  <span className="block text-sm">
                    Savat: <span className="font-semibold tabular-nums">{formatCurrency(total)}</span>
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    Oldingi qarz:{' '}
                    <span className="font-semibold tabular-nums text-destructive">
                      {formatCurrency(priorDebtForCheckout)}
                    </span>
                    {!includePriorDebtInPayment ? ' (shu to‘lovga kirmaydi)' : ''}
                  </span>
                  <span className="block text-sm border-t mt-2 pt-2">
                    {includePriorDebtInPayment ? 'Jami to‘lash:' : 'To‘lash (savat):'}{' '}
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
                disabled={isDiscountActionDisabled || isProcessingPayment}
                onClick={() => handleCompletePayment(POS_EXCHANGE_PAYOUT_METHOD)}
              >
                {isProcessingPayment
                  ? 'Jarayonda...'
                  : t('pos.exchange.refund_confirm_with_amount', {
                      amount: formatCurrency(Math.abs(total)),
                    })}
              </Button>
              {selectedCustomer && !isWalkInCustomer(selectedCustomer) ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t('pos.exchange.refund_balance_hint')}
                  </p>
                  <Button
                    className="w-full"
                    variant="secondary"
                    disabled={isDiscountActionDisabled || isProcessingPayment}
                    onClick={() => handleCompletePayment(POS_EXCHANGE_BALANCE_METHOD)}
                  >
                    {isProcessingPayment
                      ? 'Jarayonda...'
                      : t('pos.exchange.refund_balance_with_amount', {
                          amount: formatCurrency(Math.abs(total)),
                        })}
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t('pos.exchange.refund_balance_need_customer_hint')}
                </p>
              )}
            </div>
          ) : shouldShowZeroSettlePaymentUi({ cartLength: cart.length, total }) ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('pos.exchange.zero_settle_intro')}</p>
              <Button
                className="w-full"
                disabled={
                  isDiscountActionDisabled ||
                  isProcessingPayment ||
                  !isZeroTotalSaleAllowed({
                    subtotal: totals.subtotal,
                    discountAmount: totals.discountAmount,
                    loyaltyDiscountAmount: totals.loyaltyDiscountUzs,
                    hasPromo: discount.type === 'promo' || Boolean(promoCodeInput.trim()),
                    loyaltyRedeemPoints: totals.loyaltyRedeemPointsApplied,
                    userRole: profile?.role,
                  })
                }
                onClick={() => handleCompletePayment('zero_settle')}
              >
                {isProcessingPayment ? 'Jarayonda...' : t('pos.exchange.zero_settle_button')}
              </Button>
            </div>
          ) : cart.length === 0 ? (
            <div className="space-y-2 py-4 text-center text-sm text-muted-foreground">
              <p>{t('pos.empty_cart', { defaultValue: 'Savat bo‘sh' })}</p>
            </div>
          ) : (
          <Tabs defaultValue={isPaymentEnabled('cash') ? 'cash' : (isPaymentEnabled('card') ? 'card' : (isPaymentEnabled('qr') ? 'qr' : 'cash'))} className="w-full">
            <TabsList
              className={`grid w-full ${(() => {
                const n =
                  (isPaymentEnabled('cash') ? 1 : 0) +
                  (isPaymentEnabled('card') ? 1 : 0) +
                  (isPaymentEnabled('qr') ? 1 : 0) +
                  (posTerminalSettings.enable_mixed_payment ? 1 : 0) +
                  (isPaymentEnabled('credit') ? 1 : 0);
                return n <= 1 ? 'grid-cols-1' : n === 2 ? 'grid-cols-2' : n === 3 ? 'grid-cols-3' : n === 4 ? 'grid-cols-4' : 'grid-cols-5';
              })()}`}
            >
              {isPaymentEnabled('cash') && (
                <TabsTrigger value="cash">{labelFor('cash', t('pos.cash'))}</TabsTrigger>
              )}
              {isPaymentEnabled('card') && (
                <TabsTrigger value="card">{labelFor('card', t('pos.card'))}</TabsTrigger>
              )}
              {isPaymentEnabled('qr') && (
                <TabsTrigger value="qr">{labelFor('qr', t('pos.qr_pay'))}</TabsTrigger>
              )}
              {posTerminalSettings.enable_mixed_payment && (
                <TabsTrigger value="mixed">{t('pos.mixed')}</TabsTrigger>
              )}
              {isPaymentEnabled('credit') && saleCurrency !== 'USD' && (
                <TabsTrigger
                  value="credit"
                  disabled={!selectedCustomer || selectedCustomer.id === 'none'}
                >
                  {labelFor('credit', t('pos.credit'))}
                </TabsTrigger>
              )}
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
                disabled={!cashReceived || cashReceived < checkoutGrandTotal || isDiscountActionDisabled || isProcessingPayment}
                title={isDiscountActionDisabled ? discountActionDisabledReason : undefined}
              >
                {isProcessingPayment ? 'Jarayonda...' : t('pos.complete_payment')}
              </Button>
            </TabsContent>
            <TabsContent value="card" className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <p className="text-sm text-muted-foreground">Amount to charge:</p>
                <p className="text-2xl font-bold">{formatCurrency(checkoutGrandTotal)}</p>
              </div>
              <Button
                className="w-full"
                onClick={() => handleCompletePayment('card')}
                disabled={isDiscountActionDisabled || isProcessingPayment}
                title={isDiscountActionDisabled ? discountActionDisabledReason : undefined}
              >
                <CreditCard className="h-5 w-5 mr-2" />
                {isProcessingPayment ? 'Jarayonda...' : t('pos.process_card_payment')}
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
                disabled={isDiscountActionDisabled || isProcessingPayment}
                title={isDiscountActionDisabled ? discountActionDisabledReason : undefined}
              >
                <Smartphone className="h-5 w-5 mr-2" />
                {isProcessingPayment ? 'Jarayonda...' : t('pos.process_qr_payment')}
              </Button>
            </TabsContent>
            {posTerminalSettings.enable_mixed_payment && (
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
                  disabled={remainingAmount > 0 || isDiscountActionDisabled || isProcessingPayment}
                  title={isDiscountActionDisabled ? discountActionDisabledReason : undefined}
                >
                  {isProcessingPayment ? 'Jarayonda...' : t('pos.complete_payment')}
                </Button>
              </TabsContent>
            )}
            <TabsContent value="credit" className="space-y-4">
              {!selectedCustomer || selectedCustomer.id === 'none' ? (
                <div className="p-8 bg-muted rounded-lg text-center">
                  <p className="text-base font-semibold text-destructive">
                    {t('pos.select_customer_first')}
                  </p>
                </div>
              ) : (() => {
                const initialPaymentUi = creditAmount ?? 0;
                const payInvalid = creditAmount != null && creditAmount < 0;
                const priorAmt = includePriorDebtInPayment ? priorDebtForCheckout : 0;
                const toPrior = priorAmt > 0 ? Math.min(initialPaymentUi, priorAmt) : 0;
                const orderCash = Math.max(0, initialPaymentUi - toPrior);
                const merchCredit = Math.max(0, total - orderCash);
                const prepaidExtra = Math.max(0, orderCash - total);
                const currentBalance = getActiveBucketBalance(selectedCustomer, saleCurrency);
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
                    <div className="space-y-2">
                      <Label htmlFor="credit-due-date">{t('pos.credit_due_date')}</Label>
                      <Input
                        id="credit-due-date"
                        type="date"
                        value={creditDueDate}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setCreditDueDate(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('pos.credit_due_date_default', { days: creditDefaultDays })}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="credit-reminder-note">{t('pos.credit_reminder_note')}</Label>
                      <Textarea
                        id="credit-reminder-note"
                        value={creditReminderNote}
                        onChange={(e) => setCreditReminderNote(e.target.value)}
                        placeholder={t('pos.credit_reminder_note_placeholder')}
                        rows={2}
                        maxLength={500}
                        className="resize-none"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('pos.credit_reminder_note_hint')}
                      </p>
                    </div>

                    {/* Initial Payment Input */}
                    <div className="space-y-2">
                      <Label htmlFor="initial-payment">{t('pos.initial_payment')}</Label>
                      <MoneyInput
                        id="initial-payment"
                        value={creditAmount}
                        onValueChange={setCreditAmount}
                        placeholder="0"
                        allowZero
                        min={0}
                        autoFocus
                        disabled={creditLimitExceeded}
                        containerClassName="space-y-0"
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
                      isProcessingPayment ||
                      selectedCustomer.status !== 'active' ||
                      creditLimitExceeded ||
                      payInvalid ||
                      isDiscountActionDisabled
                    }
                    title={isDiscountActionDisabled ? discountActionDisabledReason : undefined}
                  >
                    <Tag className="h-5 w-5 mr-2" />
                    {isProcessingPayment ? 'Jarayonda...' : t('pos.write_credit_and_close')}
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

      <Sheet open={hotkeyGuideOpen} onOpenChange={setHotkeyGuideOpen}>
        <SheetContent
          side="right"
          className="flex h-dvh w-[min(100vw,34rem)] max-w-[min(100vw,34rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[34rem]"
        >
          <SheetHeader className="shrink-0 border-b px-5 pb-4 pr-12 pt-5">
            <SheetTitle>POS Hotkey Qo'llanma</SheetTitle>
            <SheetDescription>
              Kassada tez ishlash uchun klaviatura qisqartmalari.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-14 justify-between"
                onClick={() => {
                  setHotkeyGuideOpen(false);
                  window.setTimeout(() => searchInputRef.current?.focus(), 0);
                }}
              >
                <span>Qidiruv</span>
                <kbd className="rounded bg-muted px-2 py-1 font-mono text-xs">F2</kbd>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-14 justify-between"
                onClick={() => {
                  setHotkeyGuideOpen(false);
                  if (cart.length > 0) void handleHoldOrder();
                  else setWaitingOrdersDialogOpen(true);
                }}
              >
                <span>Hold</span>
                <kbd className="rounded bg-muted px-2 py-1 font-mono text-xs">F3</kbd>
              </Button>
              <Button
                type="button"
                variant={exchangeReturnMode ? 'default' : 'outline'}
                className="h-14 justify-between"
                onClick={() => {
                  setExchangeReturnMode((v) => {
                    if (!v) {
                      const ok = window.confirm(
                        t('pos.exchange.return_mode_confirm', {
                          defaultValue:
                            'Qaytarish rejimiga o‘tasizmi? Keyingi mahsulotlar manfiy (qaytarish) qator sifatida qo‘shiladi.',
                        }),
                      );
                      if (!ok) return v;
                    }
                    return !v;
                  });
                  setHotkeyGuideOpen(false);
                }}
              >
                <span>Qaytim</span>
                <kbd className="rounded bg-muted px-2 py-1 font-mono text-xs">F8</kbd>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-14 justify-between"
                disabled={cart.length === 0 || stockRiskCount > 0}
                onClick={() => {
                  setHotkeyGuideOpen(false);
                  if (stockRiskCount > 0) return;
                  setPaymentDialogOpen(true);
                }}
              >
                <span>To'lov</span>
                <kbd className="rounded bg-muted px-2 py-1 font-mono text-xs">F9</kbd>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-14 justify-between"
                disabled={!lastReceiptData || isPrintingReceipt}
                onClick={() => {
                  setHotkeyGuideOpen(false);
                  handlePrintLastReceipt();
                }}
              >
                <span>Mijoz cheki</span>
                <kbd className="rounded bg-muted px-2 py-1 font-mono text-xs">F10</kbd>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-14 justify-between"
                onClick={() => {
                  setHotkeyGuideOpen(false);
                  setCategorySheetMode('categories');
                  setCategorySheetOpen(true);
                }}
              >
                <span>Kategoriyalar</span>
                <FolderTree className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-14 justify-between"
                onClick={() => {
                  setHotkeyGuideOpen(false);
                  setWaitingOrdersDialogOpen(true);
                }}
              >
                <span>Navbat</span>
                <Clock className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-4 rounded-md border bg-muted/20 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Savat qatori</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Arrow Up/Down', 'Qator tanlash'],
                  ['+', 'Miqdor +'],
                  ['-', 'Miqdor -'],
                  ['Alt+1', '+1 qator'],
                  ['Alt+5', '+5 qator'],
                  ['Alt+-', '-1 qator'],
                  ['Alt+1..8', 'Tez mahsulot'],
                  ['Enter', "1-mahsulot qo'shish"],
                ].map(([keyName, label]) => (
                  <div key={`${keyName}-${label}`} className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2">
                    <span className="text-muted-foreground">{label}</span>
                    <kbd className="rounded bg-muted px-2 py-1 font-mono text-xs font-semibold">{keyName}</kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={categorySheetOpen} onOpenChange={setCategorySheetOpen}>
        <SheetContent
          side="right"
          className="flex h-dvh w-[min(100vw,28rem)] max-w-[min(100vw,28rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[28rem]"
        >
          <SheetHeader className="shrink-0 border-b px-5 pb-4 pr-12 pt-5">
            <SheetTitle>{categorySheetMode === 'quick' ? 'Tezkor mahsulotlar' : 'Kategoriyalar'}</SheetTitle>
            <SheetDescription>
              {categorySheetMode === 'quick'
                ? "Yuqorida chiqadigan tezkor mahsulotlarni belgilang."
                : 'Mahsulot ro\'yxatini kategoriya bo\'yicha saralang.'}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="h-full min-h-0 space-y-6">
              {categorySheetMode === 'quick' && (
              <section className="flex h-full min-h-0 flex-col space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Star className="h-4 w-4 text-amber-500" />
                  Tezkor mahsulotlar
                </div>
                <p className="text-xs text-muted-foreground">
                  Belgilangan mahsulotlar yuqorida button bo'lib chiqadi. Maksimum {MAX_POS_QUICK_PRODUCTS} ta.
                </p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={quickProductSearch}
                    onChange={(event) => setQuickProductSearch(event.target.value)}
                    placeholder="Mahsulot nomi, SKU yoki shtrix-kod..."
                    className="h-10 pl-9"
                  />
                </div>
                {quickProducts.length > 0 && (
                  <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/30 p-2">
                    {quickProducts.map((product) => (
                      <Button
                        key={product.id}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 max-w-full gap-1"
                        onClick={() => toggleQuickProduct(product.id)}
                        title="Tezkor ro'yxatdan olib tashlash"
                      >
                        <span className="truncate">{product.name}</span>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    ))}
                  </div>
                )}
                {quickProductCandidates.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Mahsulot topilmadi.
                  </div>
                ) : (
                  <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto pb-4 pr-1">
                    {quickProductCandidates.map((product, index) => {
                      const codeMeta = formatPosProductCodeMeta(product);
                      return (
                      <button
                        key={product.id}
                        type="button"
                        className={cn(
                          'rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted',
                          quickProductIds.includes(product.id) && 'border-primary bg-primary/5'
                        )}
                        onClick={() => toggleQuickProduct(product.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{product.name}</p>
                            <p className="mt-1 truncate text-xs text-muted-foreground" title={codeMeta || undefined}>
                              {codeMeta || '—'}
                              {index < 8 ? ` · Alt+${index + 1}` : ''}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="block text-sm font-semibold text-primary">
                              {formatMoneyUZS(Number(product.sale_price || 0))}
                            </span>
                            <Badge variant={quickProductIds.includes(product.id) ? 'default' : 'outline'} className="mt-1">
                              {quickProductIds.includes(product.id) ? 'Tanlangan' : 'Belgilash'}
                            </Badge>
                          </div>
                        </div>
                      </button>
                      );
                    })}
                  </div>
                )}
              </section>
              )}

              {categorySheetMode === 'categories' && (
              <section className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FolderTree className="h-4 w-4 text-primary" />
                  Kategoriyalar
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <Button
                    type="button"
                    variant={selectedCategory === null ? 'default' : 'outline'}
                    className="justify-start"
                    onClick={() => {
                      handleCategoryChange(null);
                      setCategorySheetOpen(false);
                    }}
                  >
                    {t('pos.all_categories')}
                  </Button>
                  {categories.map((category) => (
                    <Button
                      key={category.id}
                      type="button"
                      variant={selectedCategory === category.id ? 'default' : 'outline'}
                      className="justify-start truncate"
                      onClick={() => {
                        handleCategoryChange(category.id);
                        setCategorySheetOpen(false);
                      }}
                    >
                      <span className="truncate">{category.name}</span>
                    </Button>
                  ))}
                </div>
              </section>
              )}

            </div>
          </div>
        </SheetContent>
      </Sheet>

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
            <AlertDialogAction
              onClick={() => {
                if (!orderToRestore) return;
                if (isRemoteImportHeldOrder(orderToRestore)) {
                  void restoreRemoteHeldOrder(orderToRestore);
                } else {
                  void restoreLocalHeldOrder(orderToRestore);
                }
              }}
            >
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

      <AlertDialog
        open={importQuoteDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCancelQuoteImport();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('quotes.import_replace_cart_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('quotes.import_replace_cart_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelQuoteImport}>{t('pos.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmQuoteImport}>{t('pos.replace')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={importOrderDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCancelOrderImport();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('orders.import_replace_cart_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('orders.import_replace_cart_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelOrderImport}>{t('pos.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmOrderImport}>{t('pos.replace')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReceivePaymentModal
        open={customerPaymentOpen}
        onOpenChange={setCustomerPaymentOpen}
        customer={selectedCustomer}
        source="pos"
        defaultCurrency={saleCurrency}
        onSuccess={refreshCustomersAfterCustomerPayment}
      />

      <CreditDebtsSheet
        open={creditDebtsOpen}
        onOpenChange={setCreditDebtsOpen}
        customerId={selectedCustomer?.id}
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
            currency={receiptData.currency ?? saleCurrency}
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
