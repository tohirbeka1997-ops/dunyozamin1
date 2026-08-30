import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
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
import SearchableCustomerCombobox from '@/components/common/SearchableCustomerCombobox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getOrders, getOrderForReturn, createSalesReturn, getProducts, getCustomers, getProductTierPrice, getSalesReturnById, getSettingsByCategory, getShiftSummary } from '@/db/api';
import type { Customer, OrderWithDetails, Product, CompanySettings } from '@/types/database';
import { Search, ArrowLeft, Package, AlertCircle, Paperclip } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
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
import { useInventoryStore } from '@/store/inventoryStore';
import { readLocalImageFile, uploadProductImage } from '@/lib/uploadProductImage';
import { getElectronAPI, handleIpcResponse } from '@/utils/electron';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoneyUZS, formatOrderMoney } from '@/lib/format';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardQueries } from '@/utils/dashboard';
import { formatDate } from '@/lib/datetime';
import { formatQuantity } from '@/utils/quantity';
import { formatUnit } from '@/utils/formatters';
import { printReturnReceipt } from '@/lib/receipts/printReturnReceipt';
import { useReceiptSettings } from '@/hooks/useReceiptSettings';
import { createBackNavigationState } from '@/lib/pageState';
import { useFormListReturn } from '@/hooks/useFormListReturn';
import { availableToReturnQty } from '@/lib/posHardening';
import { useShiftStore } from '@/store/shiftStore';

interface ReturnItem {
  product_id: string;
  product_name: string;
  sku: string;
  sold_quantity: number; // Original quantity from order
  returned_quantity?: number; // Already returned quantity (from DB)
  available_quantity: number; // sold_quantity - returned_quantity
  return_quantity: number; // User input: quantity to return
  unit_price: number;
  line_total: number;
  sale_unit?: string;
  qty_sale?: number;
  qty_base?: number;
  base_price?: number;
  usta_price?: number | null;
  price_source?: 'base' | 'usta' | 'promo' | null;
  discount_type?: 'none' | 'percent' | 'fixed' | 'mixed' | null;
  discount_value?: number;
  final_unit_price?: number;
  sold_unit_price?: number;
  discount_per_unit?: number;
  order_item_id?: string; // CRITICAL: order_items.id (NOT product_id)
  pricing_tier?: 'retail' | 'master';
  is_manual?: boolean;
  product?: Product;
}

function buildReturnItems(orderData: any): ReturnItem[] {
  const itemsRaw = orderData.items || [];
  const orderDiscount = Number(orderData.discount_amount || orderData.discountAmount || 0) || 0;
  const preDiscountTotal = itemsRaw.reduce((sum: number, item: any) => {
    const soldQty =
      Number(item.qty_sale ?? item.sold_quantity ?? item.quantity ?? item.qty) || 0;
    const unitPrice = Number(item.unit_price || item.price) || 0;
    return sum + unitPrice * soldQty;
  }, 0);

  return itemsRaw.map((item: any) => {
    // Prefer sale qty; never treat remaining=0 as missing (backend used to coalesce 0→sold).
    const soldQty =
      Number(item.qty_sale ?? item.sold_quantity ?? item.quantity ?? item.qty) || 0;
    const returnedQty = Number(item.returned_quantity ?? 0) || 0;
    const computedAvailable = availableToReturnQty(soldQty, returnedQty);
    const backendRemaining =
      item.remaining_quantity != null && item.remaining_quantity !== ''
        ? Number(item.remaining_quantity)
        : computedAvailable;
    // Clamp: never show returnable > sold−returned even if a field is stale/wrong.
    const availableQty = Math.max(
      0,
      Math.min(
        computedAvailable,
        Number.isFinite(backendRemaining) ? backendRemaining : computedAvailable,
      ),
    );
    const remainingQty = availableQty;
    const unitPrice = Number(item.unit_price || item.price) || 0;
    const basePrice = Number(item.base_price ?? item.basePrice ?? unitPrice);
    const ustaPrice = item.usta_price ?? item.ustaPrice ?? null;
    const priceSource = item.price_source ?? item.priceSource ?? null;
    const discountType = item.discount_type ?? item.discountType ?? null;
    const discountValue = Number(item.discount_value ?? item.discountValue ?? 0);
    const finalUnitPrice = Number(item.final_unit_price ?? item.finalUnitPrice ?? 0);
    const saleUnit = item.sale_unit || item.unit || item.product?.unit;
    const qtyBase = Number(item.qty_base || soldQty);
    const itemLineTotal =
      Number(item.line_total || item.lineTotal || 0) ||
      (unitPrice * soldQty - Number(item.discount_amount || 0));
    const preDiscountLine = unitPrice * soldQty;
    const orderDiscountShare =
      orderDiscount > 0 && preDiscountTotal > 0 ? (preDiscountLine / preDiscountTotal) * orderDiscount : 0;
    const netLineTotal = Math.max(0, itemLineTotal - orderDiscountShare);
    const fallbackNetUnitPrice = soldQty > 0 ? netLineTotal / soldQty : unitPrice;
    const netUnitPrice = finalUnitPrice > 0 ? finalUnitPrice : fallbackNetUnitPrice;
    const soldUnitPrice =
      priceSource === 'usta' && ustaPrice ? Number(ustaPrice) : Number(basePrice || unitPrice);
    const perUnitDiscount =
      discountValue > 0 ? discountValue : Math.max(0, soldUnitPrice - netUnitPrice);

    console.log('[RETURN] Item quantities from backend:', {
      product_name: item.product_name || item.name,
      sold_quantity: soldQty,
      returned_quantity: returnedQty,
      remaining_quantity: remainingQty,
      available_quantity: availableQty,
    });

    return {
      product_id: item.product_id || item.productId,
      product_name: item.product_name || item.product?.name || item.name || 'Noma\'lum mahsulot',
      sku: item.product_sku || item.product?.sku || '',
      sold_quantity: soldQty,
      returned_quantity: returnedQty,
      available_quantity: availableQty,
      return_quantity: 0,
      unit_price: netUnitPrice,
      line_total: 0,
      sale_unit: saleUnit,
      qty_base: qtyBase,
      base_price: basePrice,
      usta_price: ustaPrice,
      price_source: priceSource,
      discount_type: discountType,
      discount_value: discountValue,
      final_unit_price: netUnitPrice,
      sold_unit_price: soldUnitPrice,
      discount_per_unit: perUnitDiscount,
      // CRITICAL: Store orderItemId (order_items.id) for return creation
      order_item_id: item.orderItemId || item.id,
    };
  });
}

/**
 * Normalize order object to extract id and orderNumber from various possible field names
 * This handles different API response formats and ensures consistent access
 */
function normalizeOrder(row: any): { id: string | null; orderNumber: string | null; raw: any } {
  const id =
    row?.id ??
    row?.order_id ??
    row?.sale_id ??
    row?.uuid ??
    null;

  const orderNumber =
    row?.order_number ??
    row?.orderNumber ??
    row?.number ??
    row?.code ??
    row?.doc_number ??
    row?.order_code ??
    null;

  return { id, orderNumber, raw: row };
}

export default function CreateReturn() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { profile, role } = useAuth();
  const isManagerOrAdmin = role === 'admin' || role === 'manager';
  const isSeniorOrAbove = role === 'admin' || role === 'manager' || role === 'senior_cashier';
  const { addMovement } = useInventoryStore();
  const queryClient = useQueryClient();
  const receiptSettings = useReceiptSettings();
  const { leaveToList } = useFormListReturn({ fallbackListPath: '/returns' });
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitIntent, setSubmitIntent] = useState<'complete' | 'draft' | 'pending'>('complete');
  const [returnIdempotencyKey, setReturnIdempotencyKey] = useState<string | null>(null);
  const [returnMode, setReturnMode] = useState<'order' | 'manual'>(
    searchParams.get('mode') === 'manual' ? 'manual' : 'order'
  );
  const currentShift = useShiftStore((s) => s.currentShift);
  const LARGE_RETURN_THRESHOLD = 500_000;
  
  // Step 1: Order Selection
  const [orders, setOrders] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<OrderWithDetails | null>(null);
  const [paymentSummary, setPaymentSummary] = useState<{
    primary?: string | null;
    isMixed?: boolean;
    allocation?: Array<{ method: string; amount: number }>;
    methods?: string[];
  } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('none');
  const [isVisitor, setIsVisitor] = useState(false);
  
  // Step 2: Return Items
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  
  // Step 3: Additional Info
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [attachmentNote, setAttachmentNote] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentSourcePath, setAttachmentSourcePath] = useState<string | null>(null);
  const [approvalReason, setApprovalReason] = useState('');
  const [methodMismatchReason, setMethodMismatchReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'card' | 'customer_account' | ''>('');
  const [drawerExpectedCash, setDrawerExpectedCash] = useState<number | null>(null);

  const isDirty = useMemo(
    () =>
      step > 1 ||
      selectedOrder !== null ||
      returnItems.some((item) => item.return_quantity > 0) ||
      reason.trim() !== '' ||
      notes.trim() !== '' ||
      searchTerm.trim() !== '' ||
      productSearchTerm.trim() !== '' ||
      (returnMode === 'manual' && selectedCustomerId !== 'none'),
    [
      step,
      selectedOrder,
      returnItems,
      reason,
      notes,
      searchTerm,
      productSearchTerm,
      returnMode,
      selectedCustomerId,
    ],
  );

  useEffect(() => {
    loadOrders();
    loadManualData();
    void getSettingsByCategory('company')
      .then((raw) => setCompanySettings(raw as unknown as CompanySettings))
      .catch(() => setCompanySettings(null));
    
    // Check if orderId is provided in query string
    const orderId = searchParams.get('orderId');
    if (orderId) {
      handleOrderIdFromQuery(orderId);
    }
  }, [searchParams]);

  useEffect(() => {
    setStep(1);
    setReturnItems([]);
    setSelectedOrder(null);
    setPaymentSummary(null);
    setSearchTerm('');
    setProductSearchTerm('');
    setSelectedCustomerId('none');
    setIsVisitor(false);
    setRefundMethod('');
    setReason('');
    setNotes('');
    setAttachmentNote('');
    setApprovalReason('');
    setMethodMismatchReason('');
  }, [returnMode]);

  useEffect(() => {
    if (!currentShift?.id || refundMethod !== 'cash') {
      setDrawerExpectedCash(null);
      return;
    }
    let cancelled = false;
    void getShiftSummary(String(currentShift.id))
      .then((s: any) => {
        if (cancelled) return;
        setDrawerExpectedCash(Number(s?.expectedCash ?? s?.expected_cash ?? 0) || 0);
      })
      .catch(() => {
        if (!cancelled) setDrawerExpectedCash(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentShift?.id, refundMethod]);

  const normalizeRefundMethodKey = (m: string) => {
    const v = String(m || '').toLowerCase();
    if (v === 'credit' || v === 'customer_account' || v === 'store_credit') return 'customer_account';
    if (v === 'card' || v === 'qr' || v === 'terminal') return 'card';
    if (v === 'cash' || v === 'naqd') return 'cash';
    return v;
  };

  const methodMismatch =
    returnMode === 'order' &&
    !!refundMethod &&
    refundMethod !== 'customer_account' &&
    Array.isArray(paymentSummary?.methods) &&
    paymentSummary!.methods!.length > 0 &&
    !paymentSummary!.methods!.map(normalizeRefundMethodKey).includes(normalizeRefundMethodKey(refundMethod));

  const loadOrders = async () => {
    try {
      setLoading(true);
      const data = await getOrders();
      
      // STEP 4: Log order structure to verify fields
      if (data.length > 0) {
        const firstOrder = data[0];
        console.log('[RETURN] First order from getOrders():', firstOrder);
        console.log('[RETURN] Order keys:', Object.keys(firstOrder));
        console.log('[RETURN] Order has id:', !!firstOrder.id);
        console.log('[RETURN] Order has order_number:', !!firstOrder.order_number);
        
        // Normalize to check what fields are actually available
        const normalized = normalizeOrder(firstOrder);
        console.log('[RETURN] Normalized first order:', normalized);
      }
      
      // Completed sales only; fully returned orders are not selectable for another return.
      const completedOrders = data.filter((order: any) => {
        if (order.status !== 'completed') return false;
        const rs = String(order.return_status || '').toLowerCase();
        return rs !== 'fully_returned';
      });
      setOrders(completedOrders);
      
      console.log(`[RETURN] Loaded ${completedOrders.length} completed orders`);
    } catch (error) {
      console.error('[RETURN] Error loading orders:', error);
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.failed_to_load_orders'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadManualData = async () => {
    try {
      const PAGE_SIZE = 1000;
      let offset = 0;
      let hasMore = true;
      const allProducts: Product[] = [];

      const customerPromise = getCustomers({ status: 'active' });

      while (hasMore) {
        const batch = await getProducts(false, {
          status: 'active',
          stockStatus: 'all',
          sortBy: 'name',
          sortOrder: 'asc',
          limit: PAGE_SIZE,
          offset,
        });

        const rows = Array.isArray(batch) ? (batch as Product[]) : [];
        allProducts.push(...rows);
        hasMore = rows.length >= PAGE_SIZE;
        offset += PAGE_SIZE;
      }

      const customerRows = await customerPromise;
      setProducts(allProducts);
      setCustomers(customerRows);
    } catch (error) {
      console.error('[RETURN] Error loading manual return data:', error);
      toast({
        title: t('common.error'),
        description: 'Ordersiz qaytarish uchun mahsulot yoki mijozlar ro‘yxatini yuklab bo‘lmadi.',
        variant: 'destructive',
      });
    }
  };

  const getSelectedCustomer = () =>
    selectedCustomerId !== 'none'
      ? customers.find((customer) => customer.id === selectedCustomerId) || null
      : null;

  const addManualProduct = (product: Product) => {
    if (returnItems.some((item) => item.product_id === product.id)) {
      toast({
        title: 'Mahsulot tanlangan',
        description: `${product.name} allaqachon qaytarish ro‘yxatiga qo‘shilgan.`,
      });
      return;
    }

    const retailPrice = Number(product.sale_price || 0);
    setReturnItems((prev) => [
      ...prev,
      {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku || '',
        sold_quantity: 1,
        returned_quantity: 0,
        available_quantity: Number.POSITIVE_INFINITY,
        return_quantity: 1,
        unit_price: retailPrice,
        line_total: retailPrice,
        sale_unit: product.unit,
        qty_base: 1,
        base_price: retailPrice,
        usta_price: product.master_price ?? null,
        price_source: 'base',
        discount_type: 'none',
        discount_value: 0,
        final_unit_price: retailPrice,
        sold_unit_price: retailPrice,
        discount_per_unit: 0,
        pricing_tier: 'retail',
        is_manual: true,
        product,
      },
    ]);
  };

  const resolveManualUnitPrice = async (item: ReturnItem, tier: 'retail' | 'master') => {
    if (tier === 'retail') {
      return Number(item.base_price ?? item.product?.sale_price ?? item.unit_price ?? 0);
    }

    const localMaster = Number(item.usta_price ?? item.product?.master_price ?? 0);
    if (localMaster > 0) return localMaster;

    const tierPrice = await getProductTierPrice({
      product_id: item.product_id,
      tier_code: 'master',
      unit: item.sale_unit || item.product?.unit || 'pcs',
    });
    if (tierPrice != null && Number(tierPrice) > 0) {
      return Number(tierPrice);
    }

    throw new Error(`"${item.product_name}" uchun usta narxi topilmadi.`);
  };

  const handleOrderIdFromQuery = async (orderId: string) => {
    console.log('[RETURN] handleOrderIdFromQuery called with orderId:', orderId);
    
    try {
      setReturnMode('order');
      setLoading(true);
      
      // Load order details and prefill the form (supports multiple partial returns per order)
      console.log('[RETURN] Fetching order details for query orderId:', orderId);
      const orderData = await getOrderForReturn(orderId);
      
      if (!orderData) {
        throw new Error('Buyurtma topilmadi');
      }
      
      console.log('[RETURN] Order details loaded from query:', {
        id: orderData.id,
        order_number: orderData.order_number,
        items_count: orderData.items?.length || 0,
      });
      
      setSelectedOrder(orderData);
      setPaymentSummary((orderData as any)?.payment_summary || null);
      
      // Initialize return items from order items
      // CRITICAL: Store orderItemId (order_items.id) so we can send it as order_item_id
      // CRITICAL: Use returned_quantity and remaining_quantity from backend (calculated from return_items table)
      const items: ReturnItem[] = buildReturnItems(orderData);
      
      if (items.length === 0) {
        // Normalize orderData to get orderNumber safely
        const normalized = normalizeOrder(orderData);
        console.error('[RETURN] ⚠️ No items found for order from query:', {
          orderId: orderData.id,
          order_number: normalized.orderNumber,
          order_status: orderData.status,
          order_total: orderData.total_amount,
        });
        const orderNumberDisplay = normalized.orderNumber ?? orderData.id ?? '-';
        throw new Error(`Bu buyurtmada mahsulotlar topilmadi. Buyurtma raqami: ${orderNumberDisplay}`);
      }

      if (!items.some((item) => item.available_quantity > 0)) {
        // Still show lines (qty disabled) with localized fully-returned message.
        setReturnItems(items);
        setStep(2);
        toast({
          title: t('common.warning'),
          description: t('sales_returns.create.all_items_already_returned'),
          variant: 'destructive',
        });
        return;
      }
      
      setReturnItems(items);
      setStep(2); // Skip to step 2 (item selection) since order is already selected
    } catch (error) {
      console.error('[RETURN] Error loading order from query:', error);
      const errorMessage = error instanceof Error ? error.message : 'Buyurtmani yuklab bo\'lmadi';
      toast({
        title: t('common.error'),
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOrder = async (orderId: string, orderNumber?: string | null) => {
    console.log('[RETURN] handleSelectOrder called with orderId:', orderId);
    console.log('[RETURN] orderId type:', typeof orderId);
    console.log('[RETURN] orderNumber passed:', orderNumber);
    
    try {
      setLoading(true);
      
      // Log the order being selected - CRITICAL DEBUG
      const order = orders.find(o => {
        const normalized = normalizeOrder(o);
        return normalized.id === orderId;
      });
      
      // If not found by normalized id, try direct match
      const foundOrder = order || orders.find(o => o.id === orderId);
      
      if (foundOrder) {
        const normalized = normalizeOrder(foundOrder);
        console.log('[RETURN] selected order (FULL OBJECT):', foundOrder);
        console.log('[RETURN] normalized order:', normalized);
      } else {
        console.warn('[RETURN] Order not found in orders list, but continuing with provided orderId');
      }
      
      // CRITICAL: Validate that orderId is provided
      if (!orderId) {
        console.error('[RETURN] ❌ orderId is required');
        throw new Error('Buyurtma ID topilmadi');
      }
      
      console.log('[RETURN] fetching details with:', { 
        id: orderId, 
        orderNumber: orderNumber ?? 'not provided',
        note: 'Using UUID (id), NOT order_number'
      });
      
      // CRITICAL: Always use orderId (UUID), never order.order_number
      const orderData = await getOrderForReturn(orderId);
      
      if (!orderData) {
        throw new Error('Buyurtma tafsilotlari topilmadi');
      }
      
      console.log('[RETURN] Order details loaded successfully:', {
        id: orderData.id,
        order_number: orderData.order_number,
        items_count: orderData.items?.length || 0,
        payments_count: orderData.payments?.length || 0,
      });
      
      setSelectedOrder(orderData);
      setPaymentSummary((orderData as any)?.payment_summary || null);
      
      // Initialize return items from order items
      // CRITICAL: Store orderItemId (order_items.id) so we can send it as order_item_id
      // CRITICAL: Use returned_quantity and remaining_quantity from backend (calculated from return_items table)
      const items: ReturnItem[] = buildReturnItems(orderData);
      
      if (items.length === 0) {
        // Normalize orderData to get orderNumber safely
        const normalized = normalizeOrder(orderData);
        console.error('[RETURN] ⚠️ No items found for order:', {
          orderId: orderData.id,
          order_number: normalized.orderNumber,
          order_status: orderData.status,
          order_total: orderData.total_amount,
        });
        const orderNumberDisplay = normalized.orderNumber ?? orderData.id ?? '-';
        throw new Error(`Bu buyurtmada mahsulotlar topilmadi. Buyurtma raqami: ${orderNumberDisplay}`);
      }

      if (!items.some((item) => item.available_quantity > 0)) {
        setReturnItems(items);
        setStep(2);
        toast({
          title: t('common.warning'),
          description: t('sales_returns.create.all_items_already_returned'),
          variant: 'destructive',
        });
        return;
      }
      
      setReturnItems(items);
      setStep(2);
    } catch (error) {
      console.error('[RETURN] order details error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Buyurtma tafsilotlarini yuklashda xatolik';
      toast({
        title: t('common.error'),
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReturnQuantityChange = (index: number, value: string) => {
    const quantity = Number(value) || 0;
    const item = returnItems[index];

    const maxQuantity = item.is_manual ? Number.POSITIVE_INFINITY : item.available_quantity || 0;

    if (!item.is_manual && quantity > maxQuantity) {
      toast({
        title: t('sales_returns.create.invalid_quantity_title'),
        description: `Qaytarish miqdori ${maxQuantity} dan oshmasligi kerak (Qolgan: ${maxQuantity}, Jami: ${item.sold_quantity}, Qaytarilgan: ${item.returned_quantity || 0})`,
        variant: 'destructive',
      });
      return;
    }
    
    if (quantity < 0) {
      toast({
        title: t('sales_returns.create.invalid_quantity_title'),
        description: 'Qaytarish miqdori 0 dan kichik bo\'lishi mumkin emas',
        variant: 'destructive',
      });
      return;
    }
    
    const newItems = [...returnItems];
    newItems[index].return_quantity = quantity;
    newItems[index].line_total = quantity * item.unit_price;
    newItems[index].qty_sale = quantity;
    newItems[index].qty_base = quantity;
    setReturnItems(newItems);
  };

  const handleManualPriceTierChange = async (index: number, tier: 'retail' | 'master') => {
    const item = returnItems[index];
    if (!item) return;

    try {
      const unitPrice = await resolveManualUnitPrice(item, tier);
      setReturnItems((prev) => {
        const next = [...prev];
        const qty = Number(next[index].return_quantity || 0);
        next[index] = {
          ...next[index],
          pricing_tier: tier,
          unit_price: unitPrice,
          sold_unit_price: unitPrice,
          final_unit_price: unitPrice,
          line_total: qty * unitPrice,
          price_source: tier === 'master' ? 'usta' : 'base',
        };
        return next;
      });
    } catch (error) {
      toast({
        title: 'Usta narxi topilmadi',
        description: error instanceof Error ? error.message : 'Usta narxi mavjud emas.',
        variant: 'destructive',
      });
    }
  };

  const calculateTotals = () => {
    const subtotal = returnItems.reduce((sum, item) => sum + item.line_total, 0);
    const taxAmount = 0; // No tax on returns for now
    const totalRefund = subtotal - taxAmount;
    
    return { subtotal, taxAmount, totalRefund };
  };

  const handleSubmit = (intent: 'complete' | 'draft' | 'pending' = 'complete') => {
    setSubmitIntent(intent);
    if (returnMode === 'order' && !selectedOrder) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.no_order_selected'),
        variant: 'destructive',
      });
      return;
    }

    const itemsToReturn = returnItems.filter((item) => item.return_quantity > 0);
    if (itemsToReturn.length === 0) {
      toast({
        title: t('sales_returns.create.no_items_selected_title'),
        description: t('sales_returns.create.no_items_selected'),
        variant: 'destructive',
      });
      return;
    }

    // FE hard stop: never allow qty above available (sold − completed − pending).
    const overLine = itemsToReturn.find(
      (item) =>
        !item.is_manual &&
        Number(item.return_quantity) > Number(item.available_quantity) + 1e-9,
    );
    if (overLine) {
      toast({
        title: t('sales_returns.create.invalid_quantity_title'),
        description: t('sales_returns.create.qty_exceeds_returnable', {
          product: overLine.product_name,
          available: overLine.available_quantity,
        }),
        variant: 'destructive',
      });
      return;
    }

    if (!itemsToReturn.some((item) => item.is_manual || item.available_quantity > 0)) {
      toast({
        title: t('common.warning'),
        description: t('sales_returns.create.all_items_already_returned'),
        variant: 'destructive',
      });
      return;
    }

    if (!reason || reason.trim() === '') {
      toast({
        title: t('sales_returns.create.reason_required_title'),
        description: t('sales_returns.create.reason_required'),
        variant: 'destructive',
      });
      return;
    }

    if (reason === 'other' && !notes.trim()) {
      toast({
        title: t('sales_returns.create.reason_required_title'),
        description: t('sales_returns.create.other_reason_notes_required'),
        variant: 'destructive',
      });
      return;
    }

    if (!refundMethod) {
      toast({
        title: t('sales_returns.create.refund_method_required_title'),
        description: t('sales_returns.create.refund_method_required'),
        variant: 'destructive',
      });
      return;
    }

    const { totalRefund: refundCheck } = calculateTotals();

    if (intent === 'complete' && refundMethod === 'cash' && !currentShift?.id) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.cash_requires_open_shift'),
        variant: 'destructive',
      });
      return;
    }

    if (
      intent === 'complete' &&
      refundMethod === 'cash' &&
      drawerExpectedCash != null &&
      refundCheck > drawerExpectedCash + 0.009
    ) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.insufficient_drawer_cash', {
          need: refundCheck,
          available: drawerExpectedCash,
        }),
        variant: 'destructive',
      });
      return;
    }

    if (returnMode === 'manual' && intent === 'complete' && !isManagerOrAdmin) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.orderless_manager_only'),
        variant: 'destructive',
      });
      return;
    }

    if (returnMode === 'manual' && !notes.trim()) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.orderless_note_required'),
        variant: 'destructive',
      });
      return;
    }

    if (returnMode === 'manual' && selectedCustomerId === 'none' && !isVisitor) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.orderless_customer_or_visitor'),
        variant: 'destructive',
      });
      return;
    }

    if (
      returnMode === 'order' &&
      refundMethod === 'customer_account' &&
      (!selectedOrder?.customer_id || !selectedOrder.customer)
    ) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.store_credit_requires_customer'),
        variant: 'destructive',
      });
      return;
    }

    if (returnMode === 'manual' && refundMethod === 'customer_account' && selectedCustomerId === 'none') {
      toast({
        title: t('common.error'),
        description: 'Mijoz hisobiga yozish uchun mijozni tanlang.',
        variant: 'destructive',
      });
      return;
    }

    const isLarge = refundCheck >= LARGE_RETURN_THRESHOLD;
    if (isLarge && !notes.trim()) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.large_amount_note_required', { threshold: LARGE_RETURN_THRESHOLD }),
        variant: 'destructive',
      });
      return;
    }

    if (intent === 'complete' && isLarge && !isManagerOrAdmin) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.submit_pending_hint'),
        variant: 'destructive',
      });
      return;
    }
    if (intent === 'complete' && methodMismatch && !isSeniorOrAbove) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.submit_pending_hint'),
        variant: 'destructive',
      });
      return;
    }

    if (
      intent === 'complete' &&
      (returnMode === 'manual' || methodMismatch || isLarge) &&
      !approvalReason.trim() &&
      !methodMismatchReason.trim()
    ) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.manager_approval_reason_required'),
        variant: 'destructive',
      });
      return;
    }

    if (
      intent === 'complete' &&
      methodMismatch &&
      !methodMismatchReason.trim() &&
      !approvalReason.trim()
    ) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.method_mismatch_reason_required'),
        variant: 'destructive',
      });
      return;
    }

    if (refundCheck <= 0) {
      toast({
        title: t('sales_returns.create.invalid_amount_title'),
        description: t('sales_returns.create.invalid_amount'),
        variant: 'destructive',
      });
      return;
    }

    setConfirmOpen(true);
  };

  const confirmAndCreateReturn = async () => {
    setConfirmOpen(false);
    const itemsToReturn = returnItems.filter((item) => item.return_quantity > 0);
    const { totalRefund: refundTotal } = calculateTotals();

    try {
      setLoading(true);

      if (!profile?.id) {
        toast({
          title: t('common.error'),
          description: 'Foydalanuvchi profili topilmadi. Iltimos, qayta kiring.',
          variant: 'destructive',
        });
        return;
      }

      const selectedCustomer = getSelectedCustomer();
      const idempotencyKey =
        returnIdempotencyKey ||
        (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `ret-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      if (!returnIdempotencyKey) setReturnIdempotencyKey(idempotencyKey);

      let attachmentUrl: string | null = null;
      let attachmentName: string | null = null;
      if (attachmentFile) {
        try {
          const tempId = `ret-${idempotencyKey.slice(0, 12)}`;
          attachmentUrl = await uploadProductImage(attachmentFile, tempId, 0, attachmentSourcePath);
          attachmentName = attachmentFile.name || null;
        } catch (upErr) {
          toast({
            title: t('common.error'),
            description:
              upErr instanceof Error
                ? upErr.message
                : t('sales_returns.create.attachment_upload_failed'),
            variant: 'destructive',
          });
          return;
        }
      }

      const createdReturn = await createSalesReturn({
        mode: returnMode,
        order_id: returnMode === 'order' ? selectedOrder!.id : null,
        customer_id:
          returnMode === 'order'
            ? selectedOrder!.customer_id
            : isVisitor
              ? null
              : selectedCustomer?.id || null,
        cashier_id: profile.id,
        total_amount: refundTotal,
        refund_method: refundMethod as 'cash' | 'card' | 'customer_account',
        reason: reason.trim(),
        notes: notes.trim() || null,
        idempotency_key: idempotencyKey,
        shift_id: currentShift?.id || null,
        visitor: returnMode === 'manual' ? isVisitor : undefined,
        approval_reason: approvalReason.trim() || methodMismatchReason.trim() || null,
        method_mismatch_reason: methodMismatchReason.trim() || null,
        attachment_note: attachmentNote.trim() || null,
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
        save_as_draft: submitIntent === 'draft',
        submit_for_approval: submitIntent === 'pending',
        status: submitIntent === 'draft' ? 'draft' : submitIntent === 'pending' ? 'pending' : undefined,
        items: itemsToReturn.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.return_quantity,
          unit_price: item.unit_price,
          line_total: item.line_total,
          order_item_id: item.order_item_id || null,
          sale_unit: item.sale_unit,
          qty_sale: item.return_quantity,
          qty_base: item.qty_base
            ? (item.qty_base / Math.max(item.sold_quantity || 1, 1)) * item.return_quantity
            : item.return_quantity,
          base_price: item.base_price ?? item.product?.sale_price ?? item.unit_price,
          usta_price: item.usta_price ?? item.product?.master_price ?? null,
          discount_type: item.discount_type ?? 'none',
          discount_value: item.discount_value ?? 0,
          final_unit_price: item.final_unit_price ?? item.unit_price,
          final_total: item.line_total,
          price_source: item.price_source ?? (item.pricing_tier === 'master' ? 'usta' : 'base'),
        })),
      });

      invalidateDashboardQueries(queryClient);

      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['sales-returns'] });
      queryClient.invalidateQueries({ queryKey: ['salesReturns'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });
      if (returnMode === 'order' && selectedOrder?.id) {
        queryClient.invalidateQueries({ queryKey: ['order', selectedOrder.id] });
      }

      if (returnMode === 'order' && selectedOrder?.id) {
        console.log('[RETURN] Refetching order details to update returned quantities');
        try {
          const updatedOrderData = await getOrderForReturn(selectedOrder.id);
          if (updatedOrderData) {
            setSelectedOrder(updatedOrderData);

            const updatedItems: ReturnItem[] = buildReturnItems(updatedOrderData).map((item) => {
              const existingItem = returnItems.find((ri) => ri.order_item_id === item.order_item_id);
              return {
                ...item,
                return_quantity: existingItem?.return_quantity || 0,
              };
            });

            setReturnItems(updatedItems);
            console.log('[RETURN] Updated returnItems with new returned_quantity values');
          }
        } catch (refetchError) {
          console.warn('[RETURN] Failed to refetch order details (non-critical):', refetchError);
        }
      }

      console.log('[RETURN] Invalidated returns list queries');

      itemsToReturn.forEach((item) => {
        if (item.return_quantity > 0) {
          const now = new Date().toISOString();
          const ratioToBase =
            item.sold_quantity > 0 && item.qty_base
              ? item.qty_base / item.sold_quantity
              : 1;
          const qtyBase = item.return_quantity * ratioToBase;
          addMovement({
            id: `local-${Date.now()}-${item.product_id}`,
            movement_number: `RET-MOV-${Date.now()}`,
            product_id: item.product_id,
            movement_type: 'return',
            quantity: qtyBase,
            before_quantity: 0,
            after_quantity: 0,
            reference_type: 'return',
            reference_id: createdReturn?.id || (selectedOrder?.id ?? null),
            reason:
              returnMode === 'order' && selectedOrder
                ? `Return from order ${selectedOrder.order_number}`
                : 'Ordersiz return',
            notes: null,
            created_by: profile.id,
            created_at: now,
          });
        }
      });

      const originalOrderId =
        returnMode === 'order' ? selectedOrder?.id || null : null;
      toast({
        title: t('common.success'),
        description: createdReturn?.return_number
          ? t('sales_returns.create.success_with_number', {
              number: createdReturn.return_number,
            })
          : t('sales_returns.create.success'),
        action: originalOrderId ? (
          <ToastAction
            altText={t('sales_returns.create.view_original_order')}
            onClick={() =>
              navigate(`/orders/${originalOrderId}`, {
                state: createBackNavigationState(location),
              })
            }
          >
            {t('sales_returns.create.view_original_order')}
          </ToastAction>
        ) : undefined,
      });

      setReturnIdempotencyKey(null);

      try {
        const returnId = createdReturn?.id;
        const printable = returnId
          ? await getSalesReturnById(returnId)
          : ({
              ...createdReturn,
              items: itemsToReturn.map((item) => ({
                product_id: item.product_id,
                product_name: item.product_name,
                quantity: item.return_quantity,
                qty_sale: item.return_quantity,
                unit_price: item.unit_price,
                line_total: item.line_total,
                sale_unit: item.sale_unit,
                price_source: item.price_source,
              })),
            } as any);
        await printReturnReceipt(printable, companySettings, receiptSettings, { silent: true });
      } catch (printError) {
        console.warn('[RETURN] Auto-print failed (non-critical):', printError);
      }

      navigate('/returns', {
        state: {
          createdReturnNumber: createdReturn?.return_number || null,
          createdReturnId: createdReturn?.id || null,
          originalOrderId,
        },
      });
    } catch (error) {
      console.error('Error creating return:', error);
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('sales_returns.create.failed_to_create'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredOrders = orders.filter((order) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      order.order_number?.toLowerCase().includes(search) ||
      order.customer?.name?.toLowerCase().includes(search)
    );
  });

  const filteredProducts = products.filter((product) => {
    if (!productSearchTerm) return true;
    const search = productSearchTerm.toLowerCase();
    return (
      product.name?.toLowerCase().includes(search) ||
      product.sku?.toLowerCase().includes(search) ||
      product.barcode?.toLowerCase().includes(search)
    );
  });

  const { subtotal, taxAmount, totalRefund } = calculateTotals();
  const hasReturnableLines =
    returnMode === 'manual' || returnItems.some((item) => item.available_quantity > 0);
  const canContinueFromItems =
    returnMode === 'manual'
      ? returnItems.some((item) => item.return_quantity > 0)
      : hasReturnableLines && returnItems.some((item) => item.return_quantity > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => void leaveToList(isDirty)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">{t('sales_returns.create.title')}</h1>
            <p className="text-muted-foreground">
              {step === 1 && (returnMode === 'order' ? t('sales_returns.create.step_1') : 'Mahsulotlarni tanlang')}
              {step === 2 && t('sales_returns.create.step_2')}
              {step === 3 && t('sales_returns.create.step_3')}
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Qaytarish turi</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Button
            variant={returnMode === 'order' ? 'default' : 'outline'}
            onClick={() => setReturnMode('order')}
          >
            Buyurtma bo‘yicha qaytarish
          </Button>
          <Button
            variant={returnMode === 'manual' ? 'default' : 'outline'}
            onClick={() => {
              if (!isManagerOrAdmin) {
                toast({
                  title: t('common.error'),
                  description: t('sales_returns.create.orderless_manager_only'),
                  variant: 'destructive',
                });
                return;
              }
              setReturnMode('manual');
            }}
            disabled={!isManagerOrAdmin}
            title={!isManagerOrAdmin ? t('sales_returns.create.orderless_manager_only') : undefined}
          >
            {t('sales_returns.create.manual_return_label')}
          </Button>
        </CardContent>
      </Card>

      {/* Step 1: Order Selection */}
      {step === 1 && returnMode === 'order' && (
        <Card>
            <CardHeader>
              <CardTitle>{t('sales_returns.create.select_order')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('sales_returns.create.search_placeholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t('sales_returns.create.no_orders_found')}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('sales_returns.create.table.order_number')}</TableHead>
                    <TableHead>{t('sales_returns.create.table.customer')}</TableHead>
                    <TableHead>{t('sales_returns.create.table.date')}</TableHead>
                    <TableHead className="text-right">{t('sales_returns.create.table.total')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.order_number}</TableCell>
                      <TableCell>{order.customer?.name || t('pos.walk_in_customer')}</TableCell>
                      <TableCell>{formatDate(order.created_at)}</TableCell>
                      <TableCell className="text-right">{formatOrderMoney(order, order.total_amount)}</TableCell>
                      <TableCell className="text-right">
                        <Button 
                          size="sm" 
                          onClick={() => {
                            // STEP 2: Log the selected row object right before calling details
                            console.log('[RETURN] selected row object =', order);
                            console.log('[RETURN] row keys =', Object.keys(order || {}));
                            
                            // STEP 3: Normalize order to handle different field names
                            const sel = normalizeOrder(order);
                            console.log('[RETURN] normalized selection:', sel);
                            
                            // Validate that we have an ID
                            if (!sel.id) {
                              console.error('[RETURN] Missing order id:', sel.raw);
                              toast({
                                title: t('common.error'),
                                description: 'Buyurtma ID topilmadi (order.id).',
                                variant: 'destructive',
                              });
                              return;
                            }
                            
                            console.log('[RETURN] Using normalized order.id (UUID):', sel.id);
                            console.log('[RETURN] Using normalized orderNumber:', sel.orderNumber);
                            handleSelectOrder(sel.id, sel.orderNumber);
                          }}
                        >
                          {t('sales_returns.create.select')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {step === 1 && returnMode === 'manual' && (
        <Card>
          <CardHeader>
            <CardTitle>Mahsulot tanlang</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Mahsulot, SKU yoki barcode bo‘yicha qidiring"
                value={productSearchTerm}
                onChange={(e) => setProductSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Mos mahsulot topilmadi</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mahsulot</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Oddiy narx</TableHead>
                    <TableHead>Usta narx</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell>{product.sku || '-'}</TableCell>
                      <TableCell>{formatMoneyUZS(product.sale_price || 0)}</TableCell>
                      <TableCell>{product.master_price ? formatMoneyUZS(product.master_price) : 'Mavjud emas'}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => addManualProduct(product)}>
                          Qo‘shish
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="flex justify-between border-t pt-4">
              <div className="text-sm text-muted-foreground">
                Tanlangan mahsulotlar: {returnItems.length}
              </div>
              <Button onClick={() => setStep(2)} disabled={returnItems.length === 0}>
                Davom etish
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Return Items */}
      {step === 2 && (returnMode === 'manual' || selectedOrder) && (
        <div className="space-y-6">
          {returnMode === 'order' && selectedOrder ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('sales_returns.create.order_information')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <Label className="text-muted-foreground">{t('sales_returns.create.order_number')}</Label>
                    <p className="font-medium">{selectedOrder.order_number}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">{t('sales_returns.create.customer')}</Label>
                    <p className="font-medium">{selectedOrder.customer?.name || t('pos.walk_in_customer')}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">{t('sales_returns.create.date')}</Label>
                    <p className="font-medium">{formatDate(selectedOrder.created_at)}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">{t('sales_returns.create.total_amount')}</Label>
                    <p className="font-medium">{formatOrderMoney(selectedOrder, selectedOrder.total_amount)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Ordersiz qaytarish</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Rejim</Label>
                    <p className="font-medium">Ordersiz qaytarish</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Tanlangan mahsulotlar</Label>
                    <p className="font-medium">{returnItems.length}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Tanlangan mijoz</Label>
                    <p className="font-medium">{getSelectedCustomer()?.name || 'Tanlanmagan'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('sales_returns.create.return_items')}</CardTitle>
            </CardHeader>
            <CardContent>
              {returnMode === 'order' && !hasReturnableLines && (
                <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{t('sales_returns.create.all_items_already_returned')}</p>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('sales_returns.create.table.product')}</TableHead>
                    <TableHead>{t('sales_returns.create.table.sku')}</TableHead>
                    {returnMode === 'order' ? (
                      <>
                        <TableHead className="text-center">Sotilgan</TableHead>
                        <TableHead className="text-center">Qaytarilgan</TableHead>
                        <TableHead className="text-center">Qolgan</TableHead>
                      </>
                    ) : (
                      <TableHead className="text-center">Narx turi</TableHead>
                    )}
                    <TableHead className="text-center">{t('sales_returns.create.table.return_qty')}</TableHead>
                    <TableHead className="text-right">{returnMode === 'manual' ? 'Tanlangan narx' : 'Sotilgan narx'}</TableHead>
                    <TableHead className="text-right">Chegirma</TableHead>
                    <TableHead className="text-right">Yakuniy narx</TableHead>
                    <TableHead className="text-right">{t('sales_returns.create.table.line_total')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {returnItems.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.product_name}</TableCell>
                      <TableCell>{item.sku}</TableCell>
                      {returnMode === 'order' ? (
                        <>
                          <TableCell className="text-center">
                            {formatQuantity(item.sold_quantity, item.sale_unit)} {formatUnit(item.sale_unit)}
                          </TableCell>
                          <TableCell className="text-center text-muted-foreground">
                            {formatQuantity(item.returned_quantity || 0, item.sale_unit)} {formatUnit(item.sale_unit)}
                          </TableCell>
                          <TableCell className="text-center font-medium">
                            {formatQuantity(item.available_quantity, item.sale_unit)} {formatUnit(item.sale_unit)}
                          </TableCell>
                        </>
                      ) : (
                        <TableCell className="text-center">
                          <Select
                            value={item.pricing_tier || 'retail'}
                            onValueChange={(value) => void handleManualPriceTierChange(index, value as 'retail' | 'master')}
                          >
                            <SelectTrigger className="w-[140px] mx-auto">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="retail">Oddiy narx</SelectItem>
                              <SelectItem value="master">Usta narx</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      )}
                      <TableCell className="text-center">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          max={item.is_manual ? undefined : item.available_quantity}
                          value={item.return_quantity}
                          onChange={(e) => handleReturnQuantityChange(index, e.target.value)}
                          className="w-20 text-center"
                          disabled={!item.is_manual && item.available_quantity <= 0}
                          title={!item.is_manual && item.available_quantity <= 0 ? 'Qolgan miqdor yo\'q' : undefined}
                        />
                      </TableCell>
                      <TableCell className="text-right">{formatOrderMoney(selectedOrder ?? {}, item.sold_unit_price || 0)}</TableCell>
                      <TableCell className="text-right">{formatOrderMoney(selectedOrder ?? {}, item.discount_per_unit || 0)}</TableCell>
                      <TableCell className="text-right">{formatOrderMoney(selectedOrder ?? {}, item.unit_price)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatOrderMoney(selectedOrder ?? {}, item.line_total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-6 space-y-2 border-t pt-4">
                <div className="flex justify-between text-sm">
                  <span>{t('sales_returns.create.subtotal')}:</span>
                  <span className="font-medium">{formatOrderMoney(selectedOrder ?? {}, subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>{t('sales_returns.create.tax')}:</span>
                  <span className="font-medium">{formatOrderMoney(selectedOrder ?? {}, taxAmount)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>{t('sales_returns.create.total_refund')}:</span>
                  <span>{formatOrderMoney(selectedOrder ?? {}, totalRefund)}</span>
                </div>
              </div>

              <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={() => setStep(1)}>
                  {t('common.back')}
                </Button>
                <Button onClick={() => setStep(3)} disabled={!canContinueFromItems}>
                  {t('sales_returns.create.continue')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 3: Additional Information */}
      {step === 3 && (
        <Card>
            <CardHeader>
              <CardTitle>{t('sales_returns.create.additional_information')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reason" className="flex items-center gap-1">
                  {t('sales_returns.create.reason_for_return')} 
                  <span className="text-destructive">*</span>
                </Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger className={!reason ? 'border-destructive' : ''}>
                    <SelectValue placeholder={t('sales_returns.create.select_reason')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="damaged">{t('sales_returns.create.reasons.damaged')}</SelectItem>
                    <SelectItem value="incorrect">{t('sales_returns.create.reasons.incorrect')}</SelectItem>
                    <SelectItem value="defective">{t('sales_returns.create.reasons.defective')}</SelectItem>
                    <SelectItem value="dissatisfaction">{t('sales_returns.create.reasons.dissatisfaction')}</SelectItem>
                    <SelectItem value="expired">{t('sales_returns.create.reasons.expired')}</SelectItem>
                    <SelectItem value="other">{t('sales_returns.create.reasons.other')}</SelectItem>
                  </SelectContent>
                </Select>
                {!reason && (
                  <p className="text-sm text-destructive">{t('sales_returns.create.select_reason_error')}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="refund_method">
                  {t('sales_returns.create.refund_method')} <span className="text-destructive">*</span>
                </Label>
                <Select value={refundMethod} onValueChange={(value) => setRefundMethod(value as 'cash' | 'card' | 'customer_account')}>
                  <SelectTrigger className={!refundMethod ? 'border-destructive' : ''}>
                    <SelectValue placeholder={t('sales_returns.create.select_refund_method')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t('pos.cash')}</SelectItem>
                    <SelectItem value="card">{t('pos.card')}</SelectItem>
                    <SelectItem value="customer_account">{t('sales_returns.create.store_credit')}</SelectItem>
                  </SelectContent>
                </Select>
                {!refundMethod && (
                  <p className="text-sm text-destructive">{t('sales_returns.create.select_refund_method_error')}</p>
                )}
                {paymentSummary?.allocation && paymentSummary.allocation.length > 0 && (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm space-y-1">
                    <p className="font-medium">{t('sales_returns.create.original_payment_allocation')}</p>
                    {paymentSummary.allocation.map((row) => (
                      <div key={row.method} className="flex justify-between text-muted-foreground">
                        <span>{row.method}</span>
                        <span>{formatOrderMoney(selectedOrder ?? {}, row.amount)}</span>
                      </div>
                    ))}
                    {paymentSummary.isMixed && (
                      <p className="text-xs text-amber-700">{t('sales_returns.create.mixed_payment_hint')}</p>
                    )}
                    {methodMismatch && (
                      <p className="text-xs text-destructive">{t('sales_returns.create.method_mismatch_hint')}</p>
                    )}
                  </div>
                )}
                {refundMethod === 'cash' && drawerExpectedCash != null && (
                  <p className="text-xs text-muted-foreground">
                    {t('sales_returns.create.drawer_cash_available')}: {formatMoneyUZS(drawerExpectedCash)}
                  </p>
                )}
              </div>

              {(returnMode === 'manual' || refundMethod === 'customer_account') && (
                <div className="space-y-2">
                  <Label htmlFor="return-customer">
                    {t('sales_returns.customer')}{' '}
                    {refundMethod === 'customer_account' || returnMode === 'manual' ? (
                      <span className="text-destructive">*</span>
                    ) : null}
                  </Label>
                  {returnMode === 'order' ? (
                    <div className={`rounded-md border px-3 py-2 text-sm ${refundMethod === 'customer_account' && !selectedOrder?.customer_id ? 'border-destructive' : 'border-input'}`}>
                      {selectedOrder?.customer?.name || t('pos.walk_in_customer')}
                    </div>
                  ) : (
                    <>
                      <SearchableCustomerCombobox
                        id="return-customer"
                        value={isVisitor ? 'none' : selectedCustomerId}
                        onValueChange={(v) => {
                          setIsVisitor(false);
                          setSelectedCustomerId(v);
                        }}
                        knownCustomers={customers}
                        status="active"
                        prefixOptions={[
                          { value: 'none', label: t('combobox.none_customer', 'Mijoz tanlanmagan') },
                        ]}
                        triggerClassName={
                          !isVisitor &&
                          (refundMethod === 'customer_account' || returnMode === 'manual') &&
                          selectedCustomerId === 'none'
                            ? 'border-destructive'
                            : undefined
                        }
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={isVisitor}
                          onChange={(e) => {
                            setIsVisitor(e.target.checked);
                            if (e.target.checked) setSelectedCustomerId('none');
                          }}
                        />
                        {t('sales_returns.create.visitor_customer')}
                      </label>
                    </>
                  )}
                </div>
              )}

              {(reason === 'damaged' || reason === 'defective') && (
                <div className="space-y-2">
                  <Label htmlFor="attachment_note">{t('sales_returns.create.attachment_note_optional')}</Label>
                  <Textarea
                    id="attachment_note"
                    placeholder={t('sales_returns.create.attachment_note_placeholder')}
                    value={attachmentNote}
                    onChange={(e) => setAttachmentNote(e.target.value)}
                    rows={2}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          const api = getElectronAPI();
                          if (api?.files?.selectImageFile) {
                            const res = await handleIpcResponse<{
                              canceled?: boolean;
                              filePaths?: string[];
                            }>(api.files.selectImageFile());
                            const path = res?.filePaths?.[0];
                            if (!path || res?.canceled) return;
                            const file = await readLocalImageFile(path);
                            setAttachmentFile(file);
                            setAttachmentSourcePath(path);
                            return;
                          }
                        } catch {
                          /* fall through to input */
                        }
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.onchange = () => {
                          const f = input.files?.[0] || null;
                          setAttachmentFile(f);
                          setAttachmentSourcePath(null);
                        };
                        input.click();
                      }}
                    >
                      <Paperclip className="h-4 w-4 mr-1" />
                      {t('sales_returns.create.attach_photo')}
                    </Button>
                    {attachmentFile ? (
                      <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                        {attachmentFile.name}
                      </span>
                    ) : null}
                    {attachmentFile ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAttachmentFile(null);
                          setAttachmentSourcePath(null);
                        }}
                      >
                        {t('common.clear', { defaultValue: 'Clear' })}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}

              {(methodMismatch || returnMode === 'manual' || totalRefund >= LARGE_RETURN_THRESHOLD) && (
                <div className="space-y-2">
                  <Label htmlFor="approval_reason">
                    {t('sales_returns.create.manager_approval_reason')} <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="approval_reason"
                    value={methodMismatch ? methodMismatchReason || approvalReason : approvalReason}
                    onChange={(e) => {
                      if (methodMismatch) setMethodMismatchReason(e.target.value);
                      setApprovalReason(e.target.value);
                    }}
                    rows={2}
                    placeholder={t('sales_returns.create.manager_approval_reason_placeholder')}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="notes">
                  {reason === 'other' || returnMode === 'manual' || totalRefund >= LARGE_RETURN_THRESHOLD
                    ? t('sales_returns.create.notes_required')
                    : t('sales_returns.create.notes_optional')}
                </Label>
                <Textarea
                  id="notes"
                  placeholder={t('sales_returns.create.notes_placeholder')}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                />
              </div>

              <div className="bg-muted p-4 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-primary mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium">{t('sales_returns.create.return_summary')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('sales_returns.create.summary.order')}: {returnMode === 'order' ? selectedOrder?.order_number : 'Ordersiz qaytarish'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('sales_returns.create.summary.items_to_return')}: {returnItems.filter(i => i.return_quantity > 0).length}
                    </p>
                    {(refundMethod === 'customer_account' || (returnMode === 'manual' && selectedCustomerId !== 'none')) && (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Mijoz: {(returnMode === 'order' ? selectedOrder?.customer?.name : getSelectedCustomer()?.name) || 'Tanlanmagan'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Joriy balans: {formatMoneyUZS((returnMode === 'order' ? selectedOrder?.customer?.balance : getSelectedCustomer()?.balance) || 0)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Yangi balans: {formatMoneyUZS(((returnMode === 'order' ? selectedOrder?.customer?.balance : getSelectedCustomer()?.balance) || 0) + totalRefund)}
                        </p>
                      </>
                    )}
                    <p className="text-sm font-medium">
                      {t('sales_returns.create.summary.total_refund')}: {formatOrderMoney(selectedOrder ?? {}, totalRefund)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap justify-between gap-2 pt-4">
                <Button variant="outline" onClick={() => setStep(2)}>
                  {t('common.back')}
                </Button>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleSubmit('draft')}
                    disabled={loading || !reason || !refundMethod || totalRefund <= 0}
                  >
                    {t('sales_returns.create.save_draft')}
                  </Button>
                  {!isManagerOrAdmin && (
                    <Button
                      variant="secondary"
                      onClick={() => handleSubmit('pending')}
                      disabled={loading || !reason || !refundMethod || totalRefund <= 0}
                    >
                      {t('sales_returns.create.submit_pending')}
                    </Button>
                  )}
                  <Button
                    onClick={() => handleSubmit('complete')}
                    disabled={loading || !reason || !refundMethod || totalRefund <= 0}
                  >
                    {loading ? t('sales_returns.create.creating') : t('sales_returns.create.submit_return')}
                  </Button>
                </div>
              </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sales_returns.create.confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {t('sales_returns.create.summary.order')}:{' '}
                  {returnMode === 'order' ? selectedOrder?.order_number || '—' : t('sales_returns.create.manual_return_label')}
                </p>
                <p>
                  {t('sales_returns.create.customer')}:{' '}
                  {(returnMode === 'order'
                    ? selectedOrder?.customer?.name
                    : getSelectedCustomer()?.name) || '—'}
                </p>
                <p>
                  {t('sales_returns.create.reason_for_return')}:{' '}
                  {reason ? t(`sales_returns.create.reasons.${reason}`, { defaultValue: reason }) : '—'}
                </p>
                <p>
                  {t('sales_returns.create.refund_method')}:{' '}
                  {refundMethod === 'customer_account'
                    ? t('sales_returns.create.store_credit')
                    : refundMethod || '—'}
                </p>
                {notes.trim() ? (
                  <p>
                    {t('sales_returns.create.notes_optional')}: {notes.trim()}
                  </p>
                ) : null}
                <p>
                  {t('sales_returns.create.confirm_cashier')}: {profile?.full_name || profile?.username || '—'}
                </p>
                <p>
                  {t('sales_returns.create.confirm_shift')}:{' '}
                  {currentShift?.id ? t('sales_returns.create.confirm_shift_open') : t('sales_returns.create.confirm_shift_none')}
                </p>
                <p>{t('sales_returns.create.confirm_stock_note')}</p>
                {(refundMethod === 'customer_account' ||
                  (returnMode === 'manual' && selectedCustomerId !== 'none')) && (
                  <p>
                    {t('sales_returns.create.confirm_balance_note', {
                      amount: formatMoneyUZS(totalRefund),
                    })}
                  </p>
                )}
                <div className="rounded-md border p-2 space-y-1">
                  <p className="font-medium text-foreground">
                    {t('sales_returns.create.summary.items_to_return')}
                  </p>
                  {returnItems
                    .filter((i) => i.return_quantity > 0)
                    .map((item) => (
                      <p key={item.order_item_id || item.product_id}>
                        {item.product_name}: {formatQuantity(item.return_quantity, item.sale_unit)}{' '}
                        {formatUnit(item.sale_unit)} × {formatMoneyUZS(item.unit_price)} ={' '}
                        {formatMoneyUZS(item.line_total)}
                      </p>
                    ))}
                </div>
                <p className="font-medium text-foreground">
                  {t('sales_returns.create.summary.total_refund')}:{' '}
                  {formatOrderMoney(selectedOrder ?? {}, totalRefund)}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading}
              onClick={(e) => {
                e.preventDefault();
                void confirmAndCreateReturn();
              }}
            >
              {loading ? t('sales_returns.create.creating') : t('sales_returns.create.confirm_submit')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
