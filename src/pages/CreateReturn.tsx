import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getOrders,
  getOrderForReturn,
  createSalesReturn,
  getSalesReturnByOrderId,
  getProducts,
  getCustomers,
  getProductTierPrice,
} from '@/db/api';
import type { Customer, OrderWithDetails, Product } from '@/types/database';
import { Search, ArrowLeft, Package, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useInventoryStore } from '@/store/inventoryStore';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoneyUZS } from '@/lib/format';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDashboardQueries } from '@/utils/dashboard';
import { formatDate } from '@/lib/datetime';
import { formatQuantity } from '@/utils/quantity';
import { formatUnit } from '@/utils/formatters';

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
    const soldQty = Number(item.qty_sale || item.sold_quantity || item.quantity || item.qty) || 0;
    const unitPrice = Number(item.unit_price || item.price) || 0;
    return sum + unitPrice * soldQty;
  }, 0);

  return itemsRaw.map((item: any) => {
    const soldQty = Number(item.qty_sale || item.sold_quantity || item.quantity || item.qty) || 0;
    const returnedQty = Number(item.returned_quantity || 0);
    const remainingQty = Number(item.remaining_quantity || (soldQty - returnedQty));
    const availableQty = remainingQty;
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
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();
  const { addMovement } = useInventoryStore();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [returnMode, setReturnMode] = useState<'order' | 'manual'>(
    searchParams.get('mode') === 'manual' ? 'manual' : 'order'
  );
  
  // Step 1: Order Selection
  const [orders, setOrders] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<OrderWithDetails | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('none');
  
  // Step 2: Return Items
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  
  // Step 3: Additional Info
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'card' | 'customer_account' | ''>('');

  useEffect(() => {
    loadOrders();
    loadManualData();
    
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
    setSearchTerm('');
    setProductSearchTerm('');
    setSelectedCustomerId('none');
    setRefundMethod('');
    setReason('');
    setNotes('');
  }, [returnMode]);

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
      
      // Filter for completed orders only
      const completedOrders = data.filter((order: any) => order.status === 'completed');
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
      
      // First, check if a return already exists for this order
      const existingReturn = await getSalesReturnByOrderId(orderId);
      if (existingReturn) {
        toast({
          title: 'Qaytarish mavjud',
          description: `Bu buyurtma bo'yicha qaytarish allaqachon yaratilgan: ${existingReturn.return_number}. Qaytarish tafsilotlariga o'tilmoqda...`,
          variant: 'default',
        });
        navigate(`/returns/${existingReturn.id}`);
        return;
      }
      
      // Load order details and prefill the form
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

  const handleSubmit = async () => {
    if (returnMode === 'order' && !selectedOrder) {
      toast({
        title: t('common.error'),
        description: t('sales_returns.create.no_order_selected'),
        variant: 'destructive',
      });
      return;
    }
    
    // Validate at least one item is being returned
    const itemsToReturn = returnItems.filter(item => item.return_quantity > 0);
    if (itemsToReturn.length === 0) {
      toast({
        title: t('sales_returns.create.no_items_selected_title'),
        description: t('sales_returns.create.no_items_selected'),
        variant: 'destructive',
      });
      return;
    }
    
    // Validate reason
    if (!reason || reason.trim() === '') {
      toast({
        title: t('sales_returns.create.reason_required_title'),
        description: t('sales_returns.create.reason_required'),
        variant: 'destructive',
      });
      return;
    }
    
    // Validate refund method
    if (!refundMethod) {
      toast({
        title: t('sales_returns.create.refund_method_required_title'),
        description: t('sales_returns.create.refund_method_required'),
        variant: 'destructive',
      });
      return;
    }
    
    // Validate store credit requires a registered customer
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
    
    // Validate refund amount
    const { totalRefund } = calculateTotals();
    if (totalRefund <= 0) {
      toast({
        title: t('sales_returns.create.invalid_amount_title'),
        description: t('sales_returns.create.invalid_amount'),
        variant: 'destructive',
      });
      return;
    }
    
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
      const createdReturn = await createSalesReturn({
        mode: returnMode,
        order_id: returnMode === 'order' ? selectedOrder!.id : null,
        customer_id:
          returnMode === 'order'
            ? selectedOrder!.customer_id
            : selectedCustomer?.id || null,
        cashier_id: profile.id,
        total_amount: totalRefund,
        refund_method: refundMethod as 'cash' | 'card' | 'customer_account',
        reason: reason.trim(),
        notes: notes.trim() || null,
        items: itemsToReturn.map(item => ({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.return_quantity,
          unit_price: item.unit_price,
          line_total: item.line_total,
          order_item_id: item.order_item_id || null,
          sale_unit: item.sale_unit,
          qty_sale: item.return_quantity,
          qty_base: item.qty_base ? (item.qty_base / Math.max(item.sold_quantity || 1, 1)) * item.return_quantity : item.return_quantity,
          base_price: item.base_price ?? item.product?.sale_price ?? item.unit_price,
          usta_price: item.usta_price ?? item.product?.master_price ?? null,
          discount_type: item.discount_type ?? 'none',
          discount_value: item.discount_value ?? 0,
          final_unit_price: item.final_unit_price ?? item.unit_price,
          final_total: item.line_total,
          price_source: item.price_source ?? (item.pricing_tier === 'master' ? 'usta' : 'base'),
        })),
      });

      // Invalidate dashboard queries
      invalidateDashboardQueries(queryClient);
      
      // CRITICAL: Invalidate returns list query so new return appears immediately
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['sales-returns'] });
      queryClient.invalidateQueries({ queryKey: ['salesReturns'] });
      
      // CRITICAL: Refetch order details to update returned_quantity in UI
      // This ensures the table shows updated returned/remaining quantities immediately
      if (returnMode === 'order' && selectedOrder?.id) {
        console.log('[RETURN] Refetching order details to update returned quantities');
        try {
          const updatedOrderData = await getOrderForReturn(selectedOrder.id);
          if (updatedOrderData) {
            setSelectedOrder(updatedOrderData);
            
            // Update returnItems with new returned_quantity values
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
          // Non-critical: UI will update on next page load
        }
      }
      
      console.log('[RETURN] Invalidated returns list queries');

      // Record inventory movements for returned items
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
            quantity: qtyBase, // return = IN (positive)
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
      
      toast({
        title: t('common.success'),
        description: t('sales_returns.create.success'),
      });
      
      navigate('/returns');
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/sales-returns')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{t('sales_returns.create.title')}</h1>
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
            onClick={() => setReturnMode('manual')}
          >
            Ordersiz qaytarish
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
                      <TableCell className="text-right">{formatMoneyUZS(order.total_amount)}</TableCell>
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
                    <p className="font-medium">{formatMoneyUZS(selectedOrder.total_amount)}</p>
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
                      <TableCell className="text-right">{formatMoneyUZS(item.sold_unit_price || 0)}</TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(item.discount_per_unit || 0)}</TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(item.unit_price)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoneyUZS(item.line_total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-6 space-y-2 border-t pt-4">
                <div className="flex justify-between text-sm">
                  <span>{t('sales_returns.create.subtotal')}:</span>
                  <span className="font-medium">{formatMoneyUZS(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>{t('sales_returns.create.tax')}:</span>
                  <span className="font-medium">{formatMoneyUZS(taxAmount)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>{t('sales_returns.create.total_refund')}:</span>
                  <span>{formatMoneyUZS(totalRefund)}</span>
                </div>
              </div>

              <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={() => setStep(1)}>
                  {t('common.back')}
                </Button>
                <Button onClick={() => setStep(3)}>
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
                    <SelectItem value="customer_account">Mijoz hisobiga</SelectItem>
                  </SelectContent>
                </Select>
                {!refundMethod && (
                  <p className="text-sm text-destructive">{t('sales_returns.create.select_refund_method_error')}</p>
                )}
              </div>

              {(returnMode === 'manual' || refundMethod === 'customer_account') && (
                <div className="space-y-2">
                  <Label htmlFor="return-customer">
                    Mijoz {refundMethod === 'customer_account' ? <span className="text-destructive">*</span> : null}
                  </Label>
                  {returnMode === 'order' ? (
                    <div className={`rounded-md border px-3 py-2 text-sm ${refundMethod === 'customer_account' && !selectedOrder?.customer_id ? 'border-destructive' : 'border-input'}`}>
                      {selectedOrder?.customer?.name || 'Mijoz tanlanmagan'}
                    </div>
                  ) : (
                    <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                      <SelectTrigger id="return-customer" className={refundMethod === 'customer_account' && selectedCustomerId === 'none' ? 'border-destructive' : ''}>
                        <SelectValue placeholder="Mijozni tanlang" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Mijoz tanlanmagan</SelectItem>
                        {customers.map((customer) => (
                          <SelectItem key={customer.id} value={customer.id}>
                            {customer.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="notes">{t('sales_returns.create.notes_optional')}</Label>
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
                      {t('sales_returns.create.summary.total_refund')}: {formatMoneyUZS(totalRefund)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setStep(2)}>
                  {t('common.back')}
                </Button>
                <Button 
                  onClick={handleSubmit} 
                  disabled={loading || !reason || !refundMethod || totalRefund <= 0}
                >
                  {loading ? t('sales_returns.create.creating') : t('sales_returns.create.submit_return')}
                </Button>
              </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
