import { useState, useEffect, useCallback, useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Button } from '@/components/ui/button';
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
import {
  searchProducts,
  getProductByBarcode,
  getCustomers,
  createOrder,
  createCreditOrder,
  generateOrderNumber,
  generatePaymentNumber,
  getActiveShift,
  createShift,
  generateShiftNumber,
  saveHeldOrder,
  getHeldOrders,
  generateHeldNumber,
  updateHeldOrderStatus,
  deleteHeldOrder,
  getCategories,
  updateHeldOrderName,
} from '@/db/api';
import type { Product, Customer, CartItem, PaymentMethod, HeldOrder, Category } from '@/types/database';
import { Search, Trash2, Plus, Minus, DollarSign, CreditCard, Smartphone, Banknote, Tag, Clock, Pause, Package, X, Check, ChevronsUpDown } from 'lucide-react';
import HoldOrderDialog from '@/components/pos/HoldOrderDialog';
import WaitingOrdersDialog from '@/components/pos/WaitingOrdersDialog';
import Numpad from '@/components/pos/Numpad';
import QuickCustomerCreate from '@/components/pos/QuickCustomerCreate';
import CustomerInfoBadge from '@/components/pos/CustomerInfoBadge';
import Receipt from '@/components/Receipt';

export default function POSTerminal() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { profile } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerComboboxOpen, setCustomerComboboxOpen] = useState(false);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [discount, setDiscount] = useState({ type: 'amount', value: 0 });
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [payments, setPayments] = useState<{ method: PaymentMethod; amount: number }[]>([]);
  const [cashReceived, setCashReceived] = useState('');
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const [editingQuantity, setEditingQuantity] = useState<{ [key: string]: string }>({});
  const [creditAmount, setCreditAmount] = useState<string>('');
  
  // Held orders state
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([]);
  const [holdOrderDialogOpen, setHoldOrderDialogOpen] = useState(false);
  const [waitingOrdersDialogOpen, setWaitingOrdersDialogOpen] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [orderToRestore, setOrderToRestore] = useState<HeldOrder | null>(null);

  // New state for premium features
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [favoriteProducts, setFavoriteProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [numpadOpen, setNumpadOpen] = useState(false);
  const [numpadConfig, setNumpadConfig] = useState<{
    type: 'quantity' | 'discount';
    productId?: string;
    initialValue: number;
    max?: number;
  } | null>(null);
  const [selectedCartIndex, setSelectedCartIndex] = useState<number>(-1);
  
  // Receipt printing state
  const receiptRef = useRef<HTMLDivElement>(null);
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
  } | null>(null);

  const handlePrint = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: `Receipt-${receiptData?.orderNumber || 'Order'}`,
  });

  // Load functions - defined before useEffect
  const loadCustomers = useCallback(async () => {
    try {
      const data = await getCustomers();
      setCustomers(data);
    } catch (error) {
      console.error('Error loading customers:', error);
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
      const results = await searchProducts('');
      setFavoriteProducts(results.slice(0, 8));
    } catch (error) {
      console.error('Error loading favorite products:', error);
    }
  }, []);

  const loadAllProducts = useCallback(async () => {
    try {
      const results = await searchProducts('');
      setAllProducts(results);
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

  const checkShift = useCallback(async () => {
    if (!profile) return;
    try {
      const shift = await getActiveShift(profile.id);
      setCurrentShift(shift);
      if (!shift) {
        setShiftDialogOpen(true);
      }
    } catch (error) {
      console.error('Error checking shift:', error);
    }
  }, [profile]);

  useEffect(() => {
    loadCustomers();
    loadCategories();
    loadFavoriteProducts();
    loadAllProducts();
    checkShift();
    loadHeldOrders();
  }, [loadCustomers, loadCategories, loadFavoriteProducts, loadAllProducts, checkShift, loadHeldOrders]);

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
      
      // F3: Hold order
      if (e.key === 'F3') {
        e.preventDefault();
        if (cart.length > 0 && !holdOrderDialogOpen) {
          setHoldOrderDialogOpen(true);
        }
        return;
      }
      
      // ESC: Close modals or clear search
      if (e.key === 'Escape') {
        if (paymentDialogOpen) {
          setPaymentDialogOpen(false);
        } else if (holdOrderDialogOpen) {
          setHoldOrderDialogOpen(false);
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
        addToCart(searchResults[0]);
        setSearchTerm('');
        setSearchResults([]);
        return;
      }
      
      // ALT+1 to ALT+8: Add favorite products
      if (e.altKey && e.key >= '1' && e.key <= '8') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (favoriteProducts[index]) {
          addToCart(favoriteProducts[index]);
        }
        return;
      }
      
      // Don't process other shortcuts if in input field
      if (isInput && target !== searchInputRef.current) return;
      
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
        updateQuantity(item.product.id, item.quantity + 1);
        return;
      }
      
      if ((e.key === '-' || e.key === '_') && selectedCartIndex >= 0 && cart[selectedCartIndex]) {
        e.preventDefault();
        const item = cart[selectedCartIndex];
        updateQuantity(item.product.id, Math.max(1, item.quantity - 1));
        return;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, searchResults, searchTerm, paymentDialogOpen, holdOrderDialogOpen, waitingOrdersDialogOpen, selectedCartIndex, favoriteProducts]);

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

  const handleOpenShift = async () => {
    if (!profile || !openingCash) return;
    try {
      const shiftNumber = await generateShiftNumber();
      const shift = await createShift({
        shift_number: shiftNumber,
        cashier_id: profile.id,
        opened_at: new Date().toISOString(),
        opening_cash: Number(openingCash),
        status: 'open',
        notes: null,
      });
      setCurrentShift(shift);
      setShiftDialogOpen(false);
      toast({ title: t('common.success'), description: t('pos.shift_opened') });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('pos.shift_open_failed'),
        variant: 'destructive',
      });
    }
  };

  const handleHoldOrder = async (customerName: string, note: string) => {
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
      
      await saveHeldOrder({
        held_number: heldNumber,
        cashier_id: profile.id,
        shift_id: currentShift.id,
        customer_id: selectedCustomer?.id || null,
        customer_name: customerName || null,
        items: cart,
        discount: discount.value > 0 ? discount : null,
        note: note || null,
      });

      toast({
        title: '✅ Buyurtma saqlandi!',
        description: 'Buyurtma kutish ro\'yxatiga ko\'chirildi',
        className: 'bg-green-50 border-green-200',
      });

      // Clear cart and reset state
      setCart([]);
      setDiscount({ type: 'amount', value: 0 });
      setSelectedCustomer(null);
      setHoldOrderDialogOpen(false);
      
      // Reload held orders
      loadHeldOrders();
    } catch (error) {
      console.error('Error holding order:', error);
      toast({
        title: t('common.error'),
        description: t('pos.hold_order_failed'),
        variant: 'destructive',
      });
    }
  };

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
      // Trust the saved data - restore items directly without validation
      // Simply take the order.items array and set it directly to cart
      setCart([...order.items]);
      
      // Restore discount
      setDiscount(order.discount || { type: 'amount', value: 0 });
      
      // Restore customer if exists
      if (order.customer_id) {
        const customer = customers.find(c => c.id === order.customer_id);
        setSelectedCustomer(customer || null);
      }

      // Mark order as restored
      await updateHeldOrderStatus(order.id, 'RESTORED');

      // Remove from heldOrders by reloading
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

  const handleSearch = async (term: string) => {
    setSearchTerm(term);
    if (term.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      let results = await searchProducts(term);
      
      // Filter by category if selected
      if (selectedCategory) {
        results = results.filter(p => p.category_id === selectedCategory);
      }
      
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching products:', error);
    }
  };

  const handleCategoryChange = async (categoryId: string | null) => {
    setSelectedCategory(categoryId);
    
    // Re-run search with new category filter
    if (searchTerm.length >= 2) {
      try {
        let results = await searchProducts(searchTerm);
        
        if (categoryId) {
          results = results.filter(p => p.category_id === categoryId);
        }
        
        setSearchResults(results);
      } catch (error) {
        console.error('Error filtering products:', error);
      }
    }
  };

  const handleBarcodeSearch = async (barcode: string) => {
    try {
      const product = await getProductByBarcode(barcode);
      if (product) {
        addToCart(product);
        setSearchTerm('');
        setSearchResults([]);
      }
    } catch (error) {
      console.error('Error searching by barcode:', error);
    }
  };

  const addToCart = (product: Product) => {
    const existingItem = cart.find((item) => item.product.id === product.id);
    if (existingItem) {
      updateQuantity(product.id, existingItem.quantity + 1);
    } else {
      const newItem: CartItem = {
        product,
        quantity: 1,
        discount_amount: 0,
        subtotal: Number(product.sale_price),
        total: Number(product.sale_price),
      };
      setCart([...cart, newItem]);
    }
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    
    // Find the product to check stock
    const cartItem = cart.find(item => item.product.id === productId);
    if (!cartItem) return;
    
    const maxStock = cartItem.product.current_stock;
    let validQuantity = quantity;
    
    // Validate against stock
    if (maxStock > 0 && quantity > maxStock) {
      validQuantity = maxStock;
      toast({
        title: 'Stock Limit Reached',
        description: `Maximum available quantity is ${maxStock}`,
        variant: 'destructive',
      });
    }
    
    setCart(
      cart.map((item) => {
        if (item.product.id === productId) {
          const subtotal = Number(item.product.sale_price) * validQuantity;
          let lineDiscount = item.discount_amount;
          
          // If new subtotal is less than current discount, adjust discount down
          if (lineDiscount > subtotal) {
            lineDiscount = subtotal;
            toast({
              title: 'Discount Adjusted',
              description: `Line discount reduced to ${lineDiscount.toFixed(2)} UZS (cannot exceed line subtotal)`,
            });
          }
          
          return {
            ...item,
            quantity: validQuantity,
            subtotal,
            discount_amount: lineDiscount,
            total: subtotal - lineDiscount,
          };
        }
        return item;
      })
    );
  };

  const handleQuantityInputChange = (productId: string, value: string) => {
    // Get the value as a string
    const stringValue = value || '';
    
    // Store the value in editing state (allow empty string while typing)
    setEditingQuantity({ ...editingQuantity, [productId]: stringValue });
    
    // If valid number, update cart quantity for real-time total calculation
    if (stringValue !== '') {
      const numValue = Number(stringValue);
      if (!isNaN(numValue) && numValue >= 1) {
        const cartItem = cart.find(item => item.product.id === productId);
        if (cartItem && cartItem.quantity !== numValue) {
          // Only update if different to avoid unnecessary re-renders
          updateQuantity(productId, numValue);
        }
      }
    }
  };

  const handleQuantityInputBlur = (productId: string) => {
    const value = editingQuantity[productId];
    const cartItem = cart.find(item => item.product.id === productId);
    
    if (!cartItem) return;
    
    // If field is left empty or 0, reset it to 1 automatically
    if (!value || value.trim() === '' || value === '0') {
      updateQuantity(productId, 1);
      const newEditingQuantity = { ...editingQuantity };
      delete newEditingQuantity[productId];
      setEditingQuantity(newEditingQuantity);
      return;
    }
    
    // Parse the input value
    const parsedValue = parseInt(value, 10);
    
    // Validate: must be a valid integer >= 1
    if (isNaN(parsedValue) || parsedValue < 1) {
      // Reset to 1 if invalid
      updateQuantity(productId, 1);
      const newEditingQuantity = { ...editingQuantity };
      delete newEditingQuantity[productId];
      setEditingQuantity(newEditingQuantity);
      return;
    }
    
    // Update quantity (will handle stock validation)
    updateQuantity(productId, parsedValue);
    
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
    setNumpadConfig({
      type: 'quantity',
      productId,
      initialValue: currentQuantity,
      max: maxStock > 0 ? maxStock : undefined,
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
      // Refactor validation: Ensure validation logic checks the converted number
      // Only adjust if the converted number is actually less than 1
      const validQuantity = Math.max(1, Math.floor(numValue));
      
      // Fix the error: Remove error if the converted input is actually valid
      // Only show adjustment message if value was actually changed
      if (validQuantity !== Math.floor(numValue) && numValue < 1) {
        toast({
          title: 'Quantity Adjusted',
          description: `Quantity must be at least 1. Set to ${validQuantity}`,
        });
      }
      // No error if value is valid (e.g., 8 is valid, so no error shown)
      updateQuantity(numpadConfig.productId, validQuantity);
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
          if (validDiscount > item.subtotal) {
            validDiscount = item.subtotal;
            toast({
              title: 'Discount Adjusted',
              description: `Maximum discount is ${item.subtotal.toFixed(2)} UZS (line subtotal)`,
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

  const removeFromCart = (productId: string) => {
    setCart(cart.filter((item) => item.product.id !== productId));
  };

  const calculateTotals = () => {
    const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
    const lineDiscountsTotal = cart.reduce((sum, item) => sum + item.discount_amount, 0);
    
    let globalDiscountAmount = 0;
    if (discount.type === 'amount') {
      globalDiscountAmount = discount.value;
    } else {
      // Apply percentage to subtotal after line discounts
      const subtotalAfterLineDiscounts = subtotal - lineDiscountsTotal;
      globalDiscountAmount = (subtotalAfterLineDiscounts * discount.value) / 100;
    }
    
    const totalDiscountAmount = lineDiscountsTotal + globalDiscountAmount;
    const total = subtotal - totalDiscountAmount;
    
    return { 
      subtotal, 
      lineDiscountsTotal,
      globalDiscountAmount,
      discountAmount: totalDiscountAmount, 
      total 
    };
  };

  const handleCustomerCreated = (customer: Customer) => {
    setCustomers([...customers, customer]);
    setSelectedCustomer(customer);
    setCustomerComboboxOpen(false);
    setCustomerSearchTerm('');
    toast({
      title: 'Customer Added',
      description: `${customer.name} has been added and selected`,
    });
  };

  const handleCompletePayment = async (paymentMethod: 'cash' | 'card' | 'qr' | 'mixed') => {
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

    // 1. Stock Validation (Before Sale)
    for (const cartItem of cart) {
      if (cartItem.quantity > cartItem.product.current_stock) {
        toast({
          title: 'Error',
          description: `Error: Not enough stock for ${cartItem.product.name}`,
          variant: 'destructive',
        });
        return;
      }
    }

    const { subtotal, discountAmount, total } = calculateTotals();

    if (total <= 0) {
      toast({
        title: 'Invalid Order Total',
        description: 'Order total must be greater than zero',
        variant: 'destructive',
      });
      return;
    }

    // Prepare payment data based on method
    let orderPayments: { method: PaymentMethod; amount: number }[] = [];
    let paidAmount = 0;
    let changeAmount = 0;
    let creditAmountValue = 0;

    // Check if there's a credit payment in the payments array (from partial credit flow)
    const creditPayment = payments.find(p => p.method === 'credit');
    if (creditPayment) {
      creditAmountValue = creditPayment.amount;
      // Remove credit from orderPayments as it's handled separately
      orderPayments = payments.filter(p => p.method !== 'credit');
    }

    if (paymentMethod === 'cash') {
      const cashAmount = Number(cashReceived);
      const requiredAmount = total - creditAmountValue;
      
      if (!cashAmount || cashAmount < requiredAmount) {
        toast({
          title: 'Insufficient Cash',
          description: `Cash received (${cashAmount.toFixed(2)} UZS) must be greater than or equal to required amount (${requiredAmount.toFixed(2)} UZS)`,
          variant: 'destructive',
        });
        return;
      }
      orderPayments = [{ method: 'cash', amount: cashAmount }];
      paidAmount = cashAmount;
      changeAmount = cashAmount - requiredAmount;
    } else if (paymentMethod === 'card') {
      const requiredAmount = total - creditAmountValue;
      orderPayments = [{ method: 'card', amount: requiredAmount }];
      paidAmount = requiredAmount;
      changeAmount = 0;
    } else if (paymentMethod === 'qr') {
      const requiredAmount = total - creditAmountValue;
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
      const requiredAmount = total - creditAmountValue;
      
      if (Math.abs(totalPaid - requiredAmount) > 0.01) {
        toast({
          title: 'Payment Mismatch',
          description: `Payment amounts do not match required amount. Paid: ${totalPaid.toFixed(2)} UZS, Required: ${requiredAmount.toFixed(2)} UZS`,
          variant: 'destructive',
        });
        return;
      }
      paidAmount = totalPaid;
      changeAmount = totalPaid - requiredAmount;
    }

    try {
      const orderNumber = await generateOrderNumber();

      const order = {
        order_number: orderNumber,
        customer_id: selectedCustomer?.id || null,
        cashier_id: profile.id,
        shift_id: currentShift.id,
        subtotal,
        discount_amount: discountAmount,
        discount_percent: discount.type === 'percent' ? discount.value : 0,
        tax_amount: 0,
        total_amount: total,
        paid_amount: paidAmount,
        credit_amount: creditAmountValue,
        change_amount: changeAmount,
        status: 'completed' as const,
        payment_status: creditAmountValue === total ? 'on_credit' as const : 
                       creditAmountValue === 0 ? 'paid' as const : 
                       'partially_paid' as const,
        notes: null,
      };

      const orderItems = cart.map((item) => ({
        product_id: item.product.id,
        product_name: item.product.name,
        quantity: item.quantity,
        unit_price: Number(item.product.sale_price),
        subtotal: item.subtotal,
        discount_amount: item.discount_amount,
        total: item.total,
      }));

      const orderPaymentsData = await Promise.all(
        orderPayments.map(async (payment) => ({
          payment_number: await generatePaymentNumber(),
          payment_method: payment.method,
          amount: payment.amount,
          reference_number: null,
          notes: null,
        }))
      );

      // Call the atomic RPC function
      await createOrder(order, orderItems, orderPaymentsData);

      // Success message based on payment type
      let successMessage = '';
      if (creditAmountValue > 0 && creditAmountValue < total) {
        successMessage = `Order ${orderNumber} completed. ${creditAmountValue.toFixed(2)} UZS on credit, ${paidAmount.toFixed(2)} UZS paid.`;
        if (changeAmount > 0) {
          successMessage += ` Change: ${changeAmount.toFixed(2)} UZS`;
        }
      } else if (creditAmountValue === total) {
        successMessage = `Order ${orderNumber} completed ON CREDIT.`;
      } else {
        successMessage = changeAmount > 0 
          ? `Order ${orderNumber} completed. Change: ${changeAmount.toFixed(2)} UZS`
          : `Order ${orderNumber} completed successfully`;
      }

      // Prepare receipt data
      const paymentMethodLabel = paymentMethod === 'cash' ? 'Cash' :
                                paymentMethod === 'card' ? 'Card' :
                                paymentMethod === 'qr' ? 'QR Pay' :
                                paymentMethod === 'mixed' ? 'Mixed' :
                                paymentMethod === 'credit' ? 'Credit' : 'Unknown';
      
      setReceiptData({
        orderNumber,
        items: cart,
        customer: selectedCustomer,
        subtotal,
        discountAmount,
        total,
        paidAmount,
        changeAmount,
        paymentMethod: paymentMethodLabel,
        dateTime: new Date().toLocaleString('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        cashierName: profile?.full_name || profile?.username,
      });

      // 3. Record Sale (Log to console)
      const saleRecord = {
        timestamp: new Date().toISOString(),
        orderNumber,
        totalAmount: total,
        itemsSold: cart.map(item => ({
          productName: item.product.name,
          quantity: item.quantity,
          unitPrice: Number(item.product.sale_price),
          total: item.total,
        })),
        paymentMethod,
        cashier: profile?.full_name || profile?.username,
      };
      console.log('Sale Record:', saleRecord);

      // 4. Update Local Product State (Stock Deduction) - BEFORE clearing cart
      // Store cart items for stock update (before cart is cleared)
      const cartItemsForStockUpdate = [...cart];
      
      // Clone the products arrays and update stock
      const updateProductsWithStockDeduction = (products: Product[]) => {
        const updatedProducts = products.map(product => {
          const cartItem = cartItemsForStockUpdate.find(item => item.product.id === product.id);
          if (cartItem) {
            const newStock = product.current_stock - cartItem.quantity;
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
      setPayments([]);
      setDiscount({ type: 'amount', value: 0 });
      setSelectedCustomer(null);
      setPaymentDialogOpen(false);
      setCashReceived('');
      setCreditAmount('');
      setSelectedCartIndex(-1);

      // Refresh customer data if credit was used
      if (creditAmountValue > 0) {
        loadCustomers();
      }

      // Reload products from database after a delay to ensure sync (but don't overwrite immediate updates)
      setTimeout(() => {
        loadAllProducts();
      }, 500);

      // Trigger print after a short delay to ensure receipt data is set
      setTimeout(() => {
        if (receiptRef.current) {
          handlePrint();
        }
      }, 100);

      // Trigger print after a short delay to ensure receipt data is set
      setTimeout(() => {
        if (receiptRef.current) {
          handlePrint();
        }
      }, 100);
    } catch (error) {
      console.error('Order completion error:', error);
      
      // Check for specific error types
      let errorMessage = 'Failed to complete order. Please try again.';
      if (error instanceof Error) {
        if (error.message.includes('stock')) {
          errorMessage = `Insufficient stock: ${error.message}`;
        } else {
          errorMessage = error.message;
        }
      }
      
      toast({
        title: '❌ Order Failed',
        description: errorMessage,
        variant: 'destructive',
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

    const { subtotal, discountAmount, total } = calculateTotals();

    if (total <= 0) {
      toast({
        title: 'Invalid Order Total',
        description: 'Order total must be greater than zero',
        variant: 'destructive',
      });
      return;
    }

    // Calculate initial payment and debt amount
    const initialPayment = creditAmount ? Number(creditAmount) : 0;
    const debtAmount = total - initialPayment;
    
    // Validate initial payment
    if (initialPayment < 0) {
      toast({
        title: t('common.error'),
        description: t('pos.error_negative_payment'),
        variant: 'destructive',
      });
      return;
    }

    if (initialPayment > total) {
      toast({
        title: t('common.error'),
        description: t('pos.error_payment_exceeds_total'),
        variant: 'destructive',
      });
      return;
    }

    // Check credit limit if set
    if (selectedCustomer.credit_limit > 0) {
      const currentBalance = selectedCustomer.balance || 0;
      const newBalance = currentBalance + debtAmount;
      if (newBalance > selectedCustomer.credit_limit) {
        toast({
          title: t('pos.credit_limit_exceeded_title'),
          description: `${t('pos.credit_limit_exceeded_desc')} ${formatCurrency(selectedCustomer.credit_limit)}. ${t('pos.new_debt_label')} ${formatCurrency(newBalance)}`,
          variant: 'destructive',
        });
        return;
      }
    }

    // Process credit sale (full or partial)
    try {
      const orderItems = cart.map((item) => ({
        product_id: item.product.id,
        product_name: item.product.name,
        quantity: item.quantity,
        unit_price: Number(item.product.sale_price),
        subtotal: item.subtotal,
        discount_amount: item.discount_amount,
        total: item.total,
      }));

      let result;
      
      // If partial payment (initialPayment > 0), use createOrder with mixed payments
      if (initialPayment > 0) {
        const orderNumber = await generateOrderNumber();
        
        const order = {
          order_number: orderNumber,
          customer_id: selectedCustomer.id,
          cashier_id: profile.id,
          shift_id: currentShift.id,
          subtotal,
          discount_amount: discountAmount,
          discount_percent: discount.type === 'percent' ? discount.value : 0,
          tax_amount: 0,
          total_amount: total,
          paid_amount: initialPayment,
          credit_amount: debtAmount,
          change_amount: 0,
          status: 'completed' as const,
          payment_status: 'partially_paid' as const,
          notes: null,
        };

        const orderPaymentsData = await Promise.all([
          {
            payment_number: await generatePaymentNumber(),
            payment_method: 'cash' as PaymentMethod,
            amount: initialPayment,
            reference_number: null,
            notes: null,
          },
          {
            payment_number: await generatePaymentNumber(),
            payment_method: 'credit' as PaymentMethod,
            amount: debtAmount,
            reference_number: null,
            notes: null,
          }
        ]);

        await createOrder(order, orderItems, orderPaymentsData);
        
        result = {
          success: true,
          order_number: orderNumber,
          new_balance: (selectedCustomer.balance || 0) + debtAmount,
        };
      } else {
        // Full credit sale - use createCreditOrder
        result = await createCreditOrder({
          customer_id: selectedCustomer.id,
          cashier_id: profile.id,
          shift_id: currentShift.id,
          items: orderItems,
          subtotal,
          discount_amount: discountAmount,
          discount_percent: discount.type === 'percent' ? discount.value : 0,
          tax_amount: 0,
          total_amount: total,
          notes: undefined,
        });
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to create credit order');
      }

      // Prepare receipt data for credit sale
      setReceiptData({
        orderNumber: result.order_number || 'N/A',
        items: cart,
        customer: selectedCustomer,
        subtotal,
        discountAmount,
        total,
        paidAmount: initialPayment,
        changeAmount: 0,
        paymentMethod: initialPayment > 0 ? 'Mixed (Cash + Credit)' : 'Credit',
        dateTime: new Date().toLocaleString('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        cashierName: profile?.full_name || profile?.username,
      });

      // Success!
      const successMessage = initialPayment > 0
        ? t('pos.order_created_partial', { number: result.order_number }) + ` ${formatCurrency(initialPayment)}, ${t('pos.credit_amount_label')} ${formatCurrency(debtAmount)}. ${t('pos.new_debt_label')} ${formatCurrency(result.new_balance || (selectedCustomer.balance || 0) + debtAmount)}`
        : t('pos.order_created_credit', { number: result.order_number }) + ` ${formatCurrency(result.new_balance || (selectedCustomer.balance || 0) + debtAmount)}`;
      
      toast({
        title: `✅ ${t('pos.credit_written')}`,
        description: successMessage,
        className: 'bg-green-50 border-green-200',
      });

      // Update customer balance in state immediately
      if (selectedCustomer) {
        const newBalance = result.new_balance || (selectedCustomer.balance || 0) + debtAmount;
        const updatedCustomer = {
          ...selectedCustomer,
          balance: newBalance,
        };
        setSelectedCustomer(updatedCustomer);
        
        // Also update in customers list
        setCustomers(prevCustomers =>
          prevCustomers.map(c =>
            c.id === selectedCustomer.id ? updatedCustomer : c
          )
        );
      }

      // Clear cart and reset state (but keep customer selected to show updated balance)
      setCart([]);
      setPayments([]);
      setDiscount({ type: 'amount', value: 0 });
      setPaymentDialogOpen(false);
      setCashReceived('');
      setCreditAmount('');
      setSelectedCartIndex(-1);

      // Refresh customer data to ensure sync
      loadCustomers();

      // Trigger print after a short delay
      setTimeout(() => {
        if (receiptRef.current) {
          handlePrint();
        }
      }, 100);
    } catch (error) {
      console.error('Credit sale error:', error);
      
      let errorMessage = 'Failed to complete credit sale. Please try again.';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      toast({
        title: '❌ Credit Sale Failed',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };


  const { subtotal, lineDiscountsTotal, globalDiscountAmount, discountAmount, total } = calculateTotals();
  const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingAmount = total - paidAmount;

  // Currency formatting helper for Uzbekistan market
  const formatCurrency = (value: number): string => {
    // Check if whole number
    const isWholeNumber = Math.abs(value % 1) < 0.01;
    
    // Format number with 2 decimal places
    const numStr = isWholeNumber 
      ? Math.round(value).toString() 
      : value.toFixed(2);
    
    // Split into integer and decimal parts
    const parts = numStr.split('.');
    const integerPart = parts[0];
    const decimalPart = parts[1];
    
    // Add space as thousand separator
    const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    
    // Combine parts
    const formatted = isWholeNumber 
      ? formattedInteger 
      : `${formattedInteger}.${decimalPart}`;
    
    return `${formatted} so'm`;
  };

  // Get products to display (search results or all products filtered by category)
  const displayProducts = searchResults.length > 0 
    ? searchResults 
    : (selectedCategory 
        ? allProducts.filter(p => p.category_id === selectedCategory)
        : allProducts);

  return (
    <>
      <Dialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pos.open_shift')}</DialogTitle>
            <DialogDescription>{t('pos.opening_cash')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="opening-cash">{t('pos.opening_cash')}</Label>
              <Input
                id="opening-cash"
                type="number"
                step="0.01"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleOpenShift} disabled={!openingCash}>
              {t('pos.open_shift')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Split View Layout - Full Screen - Fixed Height Container */}
      {/* Negative margins to counteract MainLayout padding */}
      <div className="flex flex-col flex-1 min-h-0 -m-4 xl:-m-6">
        {/* Main Content Area - Flex Container */}
        <div className="flex flex-row min-h-0 overflow-hidden gap-3 p-3 flex-1">
          {/* Left Column - Product Catalog (58%) */}
          <div className="w-[58%] flex flex-col min-h-0 border-r bg-background rounded-lg overflow-hidden">
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
                    if (e.key === 'Enter' && searchTerm) {
                      handleBarcodeSearch(searchTerm);
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
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              
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
              {displayProducts.length > 0 ? (
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
                  </div>
                  
                  {/* Product Rows */}
                  <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {displayProducts.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => {
                          addToCart(product);
                          setSearchTerm('');
                          setSearchResults([]);
                        }}
                        className="w-full grid grid-cols-12 items-center gap-4 p-3 border-b border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer transition-colors bg-white dark:bg-gray-800"
                      >
                        {/* Column 1: Product Name (Span 6) */}
                        <div className="col-span-6">
                          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm truncate text-left">
                            {product.name}
                          </h3>
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

          {/* Right Column - Cart & Checkout (42%) */}
          <div className="w-[42%] h-[calc(100vh-80px)] flex flex-col relative overflow-hidden bg-gray-50 dark:bg-gray-950 rounded-lg">
            {/* Top Section - Customer & Hold Order - Fixed Height */}
            <div className="flex-shrink-0 p-3 border-b bg-white dark:bg-gray-900 space-y-2">
              <div className="space-y-2">
              <Label className="text-sm font-semibold">{t('pos.customer')}</Label>
              <div className="flex gap-2">
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
                      className="flex-1 justify-between"
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
                <QuickCustomerCreate onCustomerCreated={handleCustomerCreated} />
              </div>
              {selectedCustomer && (
                <div className="pt-1">
                  <CustomerInfoBadge customer={selectedCustomer} />
                </div>
              )}
              </div>
              
              <div className="flex gap-2">
                <Button
                variant="outline"
                className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white border-yellow-600"
                onClick={() => {
                  // If there are held orders, open the waiting orders dialog
                  if (heldOrders.length > 0) {
                    setWaitingOrdersDialogOpen(true);
                    return;
                  }
                  
                  // If cart is empty, show error
                  if (cart.length === 0) {
                    toast({
                      title: 'Xatolik',
                      description: 'Savatcha bo\'sh. Buyurtmani saqlash uchun mahsulot qo\'shing',
                      variant: 'destructive',
                    });
                    return;
                  }
                  
                  // If cart has items, open hold order dialog
                  setHoldOrderDialogOpen(true);
                }}
              >
                <Pause className="h-4 w-4 mr-2" />
                {heldOrders.length > 0 
                  ? `${t('pos.hold_order')} (${heldOrders.length})`
                  : t('pos.hold_order')}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setWaitingOrdersDialogOpen(true)}
                className="relative"
              >
                <Clock className="h-4 w-4" />
                {heldOrders.length > 0 && (
                  <Badge
                    variant="destructive"
                    className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center rounded-full text-xs"
                  >
                    {heldOrders.length}
                  </Badge>
                )}
                </Button>
              </div>
            </div>

            {/* Middle Section - Cart Items List (Scrollable) - Takes Remaining Space */}
            <div className="flex-1 overflow-y-auto">
              {cart.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <div className="text-center">
                    <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">{t('pos.cart_empty')}</p>
                    <p className="text-xs mt-1">{t('pos.add_products')}</p>
                  </div>
                </div>
              ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {cart.map((item, index) => {
                  const isSelected = index === selectedCartIndex;
                  
                  return (
                    <div key={item.product.id} className="relative">
                      {/* Main Row */}
                      <div
                        className={`flex items-center justify-between p-3 border-b border-gray-100 bg-white dark:bg-gray-800 last:border-0 transition-colors ${
                          isSelected ? 'bg-primary/5 border-primary' : ''
                        }`}
                        onClick={() => setSelectedCartIndex(index)}
                      >
                        {/* Left Side - Product Info */}
                        <div className="flex flex-col flex-1 min-w-0 mr-3">
                          <p className="font-medium text-sm truncate">{item.product.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {formatCurrency(Number(item.product.sale_price))}
                          </p>
                        </div>
                        
                        {/* Right Side - Controls */}
                        <div className="flex items-center gap-2">
                          {/* Quantity Group */}
                          <div className="flex items-center">
                            <button
                              type="button"
                              className="h-8 w-8 flex items-center justify-center rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateQuantity(item.product.id, item.quantity - 1);
                              }}
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <Input
                              type="number"
                              min="1"
                              value={editingQuantity[item.product.id] !== undefined 
                                ? editingQuantity[item.product.id] 
                                : (item.quantity || 1).toString()}
                              onChange={(e) => handleQuantityInputChange(item.product.id, e.target.value)}
                              onBlur={() => handleQuantityInputBlur(item.product.id)}
                              onKeyDown={(e) => handleQuantityInputKeyDown(item.product.id, e)}
                              onClick={(e) => {
                                e.stopPropagation();
                                openQuantityNumpad(item.product.id, item.quantity, item.product.current_stock);
                              }}
                              className="h-8 w-16 text-center border-y border-gray-200 dark:border-gray-600 text-sm focus:outline-none rounded-none bg-white dark:bg-gray-800"
                            />
                            <button
                              type="button"
                              className="h-8 w-8 flex items-center justify-center rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateQuantity(item.product.id, item.quantity + 1);
                              }}
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                          
                          {/* Total Price */}
                          <div className="min-w-[80px] text-right mr-2">
                            <p className="font-bold text-sm">
                              {formatCurrency(item.total)}
                            </p>
                          </div>
                          
                          {/* Delete Button */}
                          <button
                            type="button"
                            className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 rounded transition-colors"
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

            {/* Bottom Section - Totals & Actions (Fixed at Bottom - Always Visible) */}
            <div className="flex-shrink-0 w-full bg-white dark:bg-gray-900 border-t p-4 z-10 space-y-4">
              {/* Discount Input */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">{t('pos.order_discount')}</Label>
                <div className="flex gap-2">
                  <Select
                    value={discount.type}
                    onValueChange={(value) => setDiscount({ ...discount, type: value as 'amount' | 'percent' })}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="amount">$</SelectItem>
                      <SelectItem value="percent">%</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    step="0.01"
                    value={discount.value}
                    onChange={(e) => setDiscount({ ...discount, value: Number(e.target.value) })}
                    placeholder="0.00"
                    className="flex-1"
                  />
                </div>
              </div>

              {/* Totals */}
              <div className="space-y-2 pt-2 border-t">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('pos.subtotal')}:</span>
                  <span className="font-medium">{formatCurrency(subtotal)}</span>
                </div>
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
                {discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-destructive font-medium">
                    <span>{t('pos.total_discount')}:</span>
                    <span>-{formatCurrency(discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-2xl font-bold pt-2 border-t">
                  <span>{t('pos.total')}:</span>
                  <span className="text-primary">{formatCurrency(total)}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-1">
                <Button
                  className="w-full h-14 bg-green-600 hover:bg-green-700 text-white text-lg font-bold"
                  size="lg"
                  disabled={cart.length === 0}
                  onClick={() => setPaymentDialogOpen(true)}
                >
                  <DollarSign className="h-6 w-6 mr-2" />
                  {t('pos.pay_checkout')}
                </Button>
                <Button
                  variant="destructive"
                  className="w-full h-12 text-base font-semibold"
                  size="lg"
                  disabled={cart.length === 0}
                  onClick={() => {
                    if (cart.length === 0) {
                      toast({
                        title: t('pos.cart_empty'),
                        variant: 'destructive',
                      });
                      return;
                    }
                    setCart([]);
                    setDiscount({ type: 'amount', value: 0 });
                    setSelectedCustomer(null);
                    toast({
                      title: 'Cart cleared',
                      description: 'All items removed from cart',
                    });
                  }}
                >
                  <X className="h-5 w-5 mr-2" />
                  {t('pos.clear_cart')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('pos.process_payment')}</DialogTitle>
            <DialogDescription>{t('pos.total_amount')}: {formatCurrency(total)}</DialogDescription>
          </DialogHeader>
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
              <div className="space-y-2">
                <Label>{t('pos.cash_received')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              {Number(cashReceived) > 0 && (() => {
                const changeAmount = Number(cashReceived) - total;
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
                disabled={!cashReceived || Number(cashReceived) < total}
              >
                Complete Payment
              </Button>
            </TabsContent>
            <TabsContent value="card" className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <p className="text-sm text-muted-foreground">Amount to charge:</p>
                <p className="text-2xl font-bold">{total.toFixed(2)} UZS</p>
              </div>
              <Button
                className="w-full"
                onClick={() => handleCompletePayment('card')}
              >
                <CreditCard className="h-5 w-5 mr-2" />
                {t('pos.process_card_payment')}
              </Button>
            </TabsContent>
            <TabsContent value="qr" className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <p className="text-sm text-muted-foreground">Amount to charge:</p>
                <p className="text-2xl font-bold">{formatCurrency(total)}</p>
              </div>
              <Button
                className="w-full"
                onClick={() => handleCompletePayment('qr')}
              >
                <Smartphone className="h-5 w-5 mr-2" />
                {t('pos.process_qr_payment')}
              </Button>
            </TabsContent>
            <TabsContent value="mixed" className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('pos.order_total')}:</span>
                  <span className="font-bold">{formatCurrency(total)}</span>
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
                    const amount = Math.min(remainingAmount, total / 2);
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
                disabled={remainingAmount > 0}
              >
                Complete Payment
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
                // Calculate values
                const initialPayment = creditAmount ? Number(creditAmount) : 0;
                const debtAmount = total - initialPayment;
                const currentBalance = selectedCustomer.balance || 0;
                const newBalance = currentBalance + debtAmount;
                const creditLimitExceeded = selectedCustomer.credit_limit > 0 && newBalance > selectedCustomer.credit_limit;
                
                return (
                  <>
                    {/* Initial Payment Input */}
                    <div className="space-y-2">
                      <Label htmlFor="initial-payment">{t('pos.initial_payment')}</Label>
                      <Input
                        id="initial-payment"
                        type="number"
                        step="0.01"
                        min="0"
                        max={total}
                        value={creditAmount}
                        onChange={(e) => {
                          const value = e.target.value;
                          const numValue = Number(value);
                          if (value === '' || (numValue >= 0 && numValue <= total)) {
                            setCreditAmount(value);
                          }
                        }}
                        placeholder="0.00"
                        autoFocus
                        disabled={creditLimitExceeded}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('pos.initial_payment_desc')}
                      </p>
                    </div>

                    {/* Visual Summary Card */}
                    <div className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600 dark:text-gray-400">{t('pos.old_debt')}:</span>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {formatCurrency(currentBalance)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-orange-600 dark:text-orange-400">+ {t('pos.current_debt')}:</span>
                        <span className="text-sm font-medium text-orange-600 dark:text-orange-400">
                          {formatCurrency(debtAmount)}
                        </span>
                      </div>
                      <div className="border-t border-gray-200 dark:border-gray-700 pt-2 flex justify-between items-center">
                        <span className="text-base font-bold text-red-600 dark:text-red-400">= {t('pos.total_debt')}:</span>
                        <span className="text-base font-bold text-red-600 dark:text-red-400">
                          {formatCurrency(newBalance)}
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
                      (creditAmount ? Number(creditAmount) < 0 || Number(creditAmount) > total : false)
                    }
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
        </DialogContent>
      </Dialog>

      <HoldOrderDialog
        open={holdOrderDialogOpen}
        onOpenChange={setHoldOrderDialogOpen}
        onConfirm={handleHoldOrder}
      />

      <WaitingOrdersDialog
        open={waitingOrdersDialogOpen}
        onOpenChange={setWaitingOrdersDialogOpen}
        heldOrders={heldOrders}
        onRestore={handleRestoreOrder}
        onCancel={handleCancelHeldOrder}
        onRename={handleRenameHeldOrder}
      />

      <Numpad
        open={numpadOpen}
        onOpenChange={setNumpadOpen}
        title={numpadConfig?.type === 'quantity' ? 'Enter Quantity' : 'Enter Discount Amount'}
        description={numpadConfig?.max ? `Maximum: ${numpadConfig.max}` : undefined}
        initialValue={numpadConfig?.initialValue || 0}
        onApply={handleNumpadApply}
        max={numpadConfig?.max}
        min={numpadConfig?.type === 'quantity' ? 1 : 0}
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
          />
        </div>
      )}
    </>
  );
}
