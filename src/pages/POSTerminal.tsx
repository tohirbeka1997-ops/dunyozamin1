import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Search, Trash2, Plus, Minus, DollarSign, CreditCard, Smartphone, Banknote, Tag, Clock, Pause } from 'lucide-react';
import HoldOrderDialog from '@/components/pos/HoldOrderDialog';
import WaitingOrdersDialog from '@/components/pos/WaitingOrdersDialog';
import CategoryTabs from '@/components/pos/CategoryTabs';
import FavoriteProducts from '@/components/pos/FavoriteProducts';
import Numpad from '@/components/pos/Numpad';
import QuickCustomerCreate from '@/components/pos/QuickCustomerCreate';
import CustomerInfoBadge from '@/components/pos/CustomerInfoBadge';

export default function POSTerminal() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
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
  const [numpadOpen, setNumpadOpen] = useState(false);
  const [numpadConfig, setNumpadConfig] = useState<{
    type: 'quantity' | 'discount';
    productId?: string;
    initialValue: number;
    max?: number;
  } | null>(null);
  const [selectedCartIndex, setSelectedCartIndex] = useState<number>(-1);

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
    checkShift();
    loadHeldOrders();
  }, [loadCustomers, loadCategories, loadFavoriteProducts, checkShift, loadHeldOrders]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input field (except search)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      
      // F2: Open payment modal
      if (e.key === 'F2') {
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
      toast({ title: 'Success', description: 'Shift opened successfully' });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to open shift',
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
        title: 'Cannot Hold Empty Cart',
        description: 'Please add items to the cart before holding the order',
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
        title: 'Order Held',
        description: 'Order moved to waiting list',
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
        title: 'Error',
        description: 'Failed to hold order',
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
      // Validate product availability
      const unavailableProducts: string[] = [];
      const adjustedItems: CartItem[] = [];

      for (const item of order.items) {
        const currentProduct = await getProductByBarcode(item.product.barcode || '');
        
        if (!currentProduct) {
          unavailableProducts.push(item.product.name);
          continue;
        }

        // Check stock and adjust quantity if needed
        let quantity = item.quantity;
        if (currentProduct.current_stock > 0 && quantity > currentProduct.current_stock) {
          quantity = currentProduct.current_stock;
          toast({
            title: 'Quantity Adjusted',
            description: `${item.product.name}: reduced to ${quantity} (available stock)`,
          });
        }

        adjustedItems.push({
          ...item,
          product: currentProduct,
          quantity,
        });
      }

      if (unavailableProducts.length > 0) {
        toast({
          title: 'Some Products Unavailable',
          description: `Skipped: ${unavailableProducts.join(', ')}`,
          variant: 'destructive',
        });
      }

      if (adjustedItems.length === 0) {
        toast({
          title: 'Cannot Restore Order',
          description: 'No products available from this order',
          variant: 'destructive',
        });
        return;
      }

      // Restore cart state
      setCart(adjustedItems);
      setDiscount(order.discount || { type: 'amount', value: 0 });
      
      // Restore customer if exists
      if (order.customer_id) {
        const customer = customers.find(c => c.id === order.customer_id);
        setSelectedCustomer(customer || null);
      }

      // Mark order as restored
      await updateHeldOrderStatus(order.id, 'RESTORED');

      toast({
        title: 'Order Restored',
        description: 'Waiting order restored to cart',
      });

      // Close dialogs and reload
      setWaitingOrdersDialogOpen(false);
      setRestoreConfirmOpen(false);
      setOrderToRestore(null);
      loadHeldOrders();
    } catch (error) {
      console.error('Error restoring order:', error);
      toast({
        title: 'Error',
        description: 'Failed to restore order',
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
    // Allow empty string while typing
    setEditingQuantity({ ...editingQuantity, [productId]: value });
  };

  const handleQuantityInputBlur = (productId: string) => {
    const value = editingQuantity[productId];
    const cartItem = cart.find(item => item.product.id === productId);
    
    if (!cartItem) return;
    
    // Parse the input value
    const parsedValue = parseInt(value, 10);
    
    // Validate: must be a valid integer >= 1
    if (isNaN(parsedValue) || parsedValue < 1 || value.trim() === '') {
      // Restore previous valid value
      setEditingQuantity({ ...editingQuantity, [productId]: cartItem.quantity.toString() });
      toast({
        title: 'Invalid Quantity',
        description: 'Quantity must be at least 1',
        variant: 'destructive',
      });
      return;
    }
    
    // Update quantity (will handle stock validation)
    updateQuantity(productId, parsedValue);
    
    // Clear editing state
    const newEditingQuantity = { ...editingQuantity };
    delete newEditingQuantity[productId];
    setEditingQuantity(newEditingQuantity);
  };

  const handleQuantityInputKeyDown = (productId: string, e: React.KeyboardEvent<HTMLInputElement>) => {
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
    
    if (numpadConfig.type === 'quantity' && numpadConfig.productId) {
      updateQuantity(numpadConfig.productId, value);
    } else if (numpadConfig.type === 'discount' && numpadConfig.productId) {
      updateLineDiscount(numpadConfig.productId, value);
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
      const result = await createOrder(order, orderItems, orderPaymentsData);

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

      toast({
        title: '✅ Order Completed Successfully',
        description: successMessage,
        className: 'bg-green-50 border-green-200',
      });

      // Clear cart and reset state
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

    // Determine credit amount (default to full total if not specified)
    const creditAmountValue = creditAmount ? Number(creditAmount) : total;
    
    // Validate credit amount
    if (creditAmountValue < 0) {
      toast({
        title: 'Invalid Credit Amount',
        description: 'Credit amount cannot be negative',
        variant: 'destructive',
      });
      return;
    }

    if (creditAmountValue > total) {
      toast({
        title: 'Invalid Credit Amount',
        description: 'Credit amount cannot exceed order total',
        variant: 'destructive',
      });
      return;
    }

    // Check credit limit if set
    if (selectedCustomer.credit_limit > 0) {
      const newBalance = (selectedCustomer.balance || 0) + creditAmountValue;
      if (newBalance > selectedCustomer.credit_limit) {
        toast({
          title: 'Credit Limit Exceeded',
          description: `Customer's credit limit is ${selectedCustomer.credit_limit.toFixed(2)} UZS. New balance would be ${newBalance.toFixed(2)} UZS.`,
          variant: 'destructive',
        });
        return;
      }
    }

    // If partial credit, need to collect remaining amount
    if (creditAmountValue < total) {
      const remainingAmount = total - creditAmountValue;
      
      toast({
        title: 'Partial Credit Confirmed',
        description: `${creditAmountValue.toFixed(2)} UZS on credit. Please collect remaining ${remainingAmount.toFixed(2)} UZS.`,
        className: 'bg-blue-50 border-blue-200',
      });

      // Close payment dialog and switch to mixed payment tab
      // Store credit amount in payments array for later processing
      setPayments([{ method: 'credit' as PaymentMethod, amount: creditAmountValue }]);
      
      // Keep dialog open but switch to mixed tab to collect remaining payment
      // User will need to add remaining payment methods
      return;
    }

    // Full credit sale - process immediately
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

      // Call the credit order RPC function (legacy - for full credit only)
      const result = await createCreditOrder({
        customer_id: selectedCustomer.id,
        cashier_id: profile.id,
        shift_id: currentShift.id,
        items: orderItems,
        subtotal,
        discount_amount: discountAmount,
        discount_percent: discount.type === 'percent' ? discount.value : 0,
        tax_amount: 0,
        total_amount: total,
        notes: null,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create credit order');
      }

      // Success!
      toast({
        title: '✅ Credit Sale Completed',
        description: `Order ${result.order_number} created ON CREDIT. Customer balance: ${result.new_balance?.toFixed(2)} UZS`,
        className: 'bg-green-50 border-green-200',
      });

      // Clear cart and reset state
      setCart([]);
      setPayments([]);
      setDiscount({ type: 'amount', value: 0 });
      setPaymentDialogOpen(false);
      setCashReceived('');
      setCreditAmount('');
      setSelectedCartIndex(-1);

      // Refresh customer data to show updated balance
      loadCustomers();
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

  const handlePayment = async () => {
    // This is the old function - keeping for backward compatibility
    // but it should not be called anymore
    console.warn('handlePayment called - this should use handleCompletePayment instead');
  };

  const { subtotal, lineDiscountsTotal, globalDiscountAmount, discountAmount, total } = calculateTotals();
  const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingAmount = total - paidAmount;

  return (
    <>
      <Dialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open Shift</DialogTitle>
            <DialogDescription>Enter the opening cash amount to start your shift</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="opening-cash">Opening Cash Amount</Label>
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
              Open Shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 h-[calc(100vh-8rem)]">
        <div className="xl:col-span-2 space-y-4 overflow-y-auto">
          <FavoriteProducts products={favoriteProducts} onAddToCart={addToCart} />
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle>Product Search</CardTitle>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-2">
                    <span className="text-xs">⌨️ Shortcuts</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="end">
                  <div className="space-y-3">
                    <h4 className="font-semibold text-sm">Keyboard Shortcuts</h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Add first result</span>
                        <kbd className="px-2 py-1 bg-muted rounded">ENTER</kbd>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Process payment</span>
                        <kbd className="px-2 py-1 bg-muted rounded">F2</kbd>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Hold order</span>
                        <kbd className="px-2 py-1 bg-muted rounded">F3</kbd>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Close / Clear</span>
                        <kbd className="px-2 py-1 bg-muted rounded">ESC</kbd>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Navigate cart</span>
                        <kbd className="px-2 py-1 bg-muted rounded">↑ ↓</kbd>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Adjust quantity</span>
                        <kbd className="px-2 py-1 bg-muted rounded">+ -</kbd>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Add favorites</span>
                        <kbd className="px-2 py-1 bg-muted rounded">ALT+1-8</kbd>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={searchInputRef}
                    placeholder="Search products by name, SKU, or barcode... (Press ENTER to add first result)"
                    value={searchTerm}
                    onChange={(e) => handleSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchTerm) {
                        handleBarcodeSearch(searchTerm);
                      }
                    }}
                    className="pl-9"
                  />
                </div>
              </div>
              
              {categories.length > 0 && (
                <CategoryTabs
                  categories={categories}
                  selectedCategory={selectedCategory}
                  onSelectCategory={handleCategoryChange}
                />
              )}
              
              {searchResults.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                  {searchResults.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="h-auto py-3 px-4 flex flex-col items-start gap-1 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition-colors border border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                      onClick={() => {
                        addToCart(product);
                        setSearchTerm('');
                        setSearchResults([]);
                      }}
                    >
                      <span className="font-semibold text-sm text-white leading-tight">{product.name}</span>
                      <span className="text-xs text-slate-100 font-medium">{Number(product.sale_price).toFixed(2)} UZS</span>
                      <span className="text-xs text-slate-200">Stock: {product.current_stock}</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Shopping Cart</CardTitle>
            </CardHeader>
            <CardContent>
              {cart.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">Cart is empty</div>
              ) : (
                <div className="space-y-2">
                  {cart.map((item, index) => {
                    const isSelected = index === selectedCartIndex;
                    const discountPercent = item.subtotal > 0 ? (item.discount_amount / item.subtotal) * 100 : 0;
                    
                    return (
                      <div 
                        key={item.product.id} 
                        className={`flex flex-col gap-2 p-3 border-2 rounded-lg transition-colors ${
                          isSelected ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20' : 'border-border'
                        }`}
                        onClick={() => setSelectedCartIndex(index)}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1">
                            <p className="font-medium">{item.product.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {Number(item.product.sale_price).toFixed(2)} UZS × {item.quantity} = {item.subtotal.toFixed(2)} UZS
                            </p>
                            {item.discount_amount > 0 && (
                              <p className="text-xs text-destructive mt-1">
                                Discount: {item.discount_amount.toFixed(2)} UZS ({discountPercent.toFixed(1)}%)
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateQuantity(item.product.id, item.quantity - 1);
                              }}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <Input
                              type="number"
                              min="1"
                              value={editingQuantity[item.product.id] !== undefined 
                                ? editingQuantity[item.product.id] 
                                : item.quantity}
                              onChange={(e) => handleQuantityInputChange(item.product.id, e.target.value)}
                              onBlur={() => handleQuantityInputBlur(item.product.id)}
                              onKeyDown={(e) => handleQuantityInputKeyDown(item.product.id, e)}
                              onClick={(e) => {
                                e.stopPropagation();
                                openQuantityNumpad(item.product.id, item.quantity, item.product.current_stock);
                              }}
                              className="w-16 h-8 text-center p-1 cursor-pointer"
                              readOnly
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateQuantity(item.product.id, item.quantity + 1);
                              }}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromCart(item.product.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between pt-2 border-t">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-8 gap-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Tag className="h-3 w-3" />
                              <span className="text-xs">
                                Discount: {item.discount_amount > 0 ? `${item.discount_amount.toFixed(2)} UZS` : '0'}
                              </span>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64" align="start">
                            <div className="space-y-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Line Discount (UZS)</Label>
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
                                  Max: {item.subtotal.toFixed(2)} UZS
                                </p>
                              </div>
                              <div className="grid grid-cols-4 gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => updateLineDiscount(item.product.id, item.subtotal * 0.05)}
                                >
                                  5%
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => updateLineDiscount(item.product.id, item.subtotal * 0.10)}
                                >
                                  10%
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => updateLineDiscount(item.product.id, item.subtotal * 0.15)}
                                >
                                  15%
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => updateLineDiscount(item.product.id, 0)}
                                >
                                  Clear
                                </Button>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                        
                        <div className="text-right">
                          {item.discount_amount > 0 && (
                            <p className="text-xs text-destructive line-through">
                              {item.subtotal.toFixed(2)} UZS
                            </p>
                          )}
                          <p className="font-bold text-lg">
                            {item.total.toFixed(2)} UZS
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle>Order Summary</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWaitingOrdersDialogOpen(true)}
                className="relative"
              >
                <Clock className="h-4 w-4 mr-2" />
                Waiting Orders
                {heldOrders.length > 0 && (
                  <Badge
                    variant="destructive"
                    className="ml-2 h-5 w-5 p-0 flex items-center justify-center rounded-full"
                  >
                    {heldOrders.length}
                  </Badge>
                )}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Customer (Optional)</Label>
                <div className="flex gap-2 items-start">
                  <Select
                    value={selectedCustomer?.id || 'none'}
                    onValueChange={(value) => {
                      const customer = customers.find((c) => c.id === value);
                      setSelectedCustomer(customer || null);
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Walk-in Customer</SelectItem>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <QuickCustomerCreate onCustomerCreated={handleCustomerCreated} />
                </div>
                {selectedCustomer && (
                  <div className="pt-1 space-y-2">
                    <CustomerInfoBadge customer={selectedCustomer} />
                    {selectedCustomer.id !== 'none' && (selectedCustomer.balance || 0) > 0 && (
                      <div className="p-2 bg-destructive/10 border border-destructive/20 rounded-md">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-destructive font-medium">Current Debt:</span>
                          <span className="text-destructive font-bold">{(selectedCustomer.balance || 0).toFixed(2)} UZS</span>
                        </div>
                        {selectedCustomer.credit_limit > 0 && (
                          <div className="flex justify-between items-center text-xs text-muted-foreground mt-1">
                            <span>Credit Limit:</span>
                            <span>{selectedCustomer.credit_limit.toFixed(2)} UZS</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Discount</Label>
                <div className="flex gap-2">
                  <Select
                    value={discount.type}
                    onValueChange={(value) => setDiscount({ ...discount, type: value as 'amount' | 'percent' })}
                  >
                    <SelectTrigger className="w-24">
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
                  />
                </div>
              </div>

              <div className="space-y-2 pt-4 border-t">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span className="font-medium">{subtotal.toFixed(2)} UZS</span>
                </div>
                {lineDiscountsTotal > 0 && (
                  <div className="flex justify-between text-destructive text-sm">
                    <span>Line Discounts:</span>
                    <span className="font-medium">-{lineDiscountsTotal.toFixed(2)} UZS</span>
                  </div>
                )}
                {globalDiscountAmount > 0 && (
                  <div className="flex justify-between text-destructive text-sm">
                    <span>Order Discount:</span>
                    <span className="font-medium">-{globalDiscountAmount.toFixed(2)} UZS</span>
                  </div>
                )}
                {discountAmount > 0 && (
                  <div className="flex justify-between text-destructive font-medium">
                    <span>Total Discount:</span>
                    <span>-{discountAmount.toFixed(2)} UZS</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold pt-2 border-t">
                  <span>Total:</span>
                  <span>{total.toFixed(2)} UZS</span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 h-12"
                  size="lg"
                  disabled={cart.length === 0}
                  onClick={() => {
                    if (cart.length === 0) {
                      toast({
                        title: 'Cannot Hold Empty Cart',
                        description: 'Please add items to the cart',
                        variant: 'destructive',
                      });
                      return;
                    }
                    setHoldOrderDialogOpen(true);
                  }}
                >
                  <Pause className="h-5 w-5 mr-2" />
                  Hold Order
                </Button>
                <Button
                  className="flex-1 h-12"
                  size="lg"
                  disabled={cart.length === 0}
                  onClick={() => setPaymentDialogOpen(true)}
                >
                  <DollarSign className="h-5 w-5 mr-2" />
                  Process Payment
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Process Payment</DialogTitle>
            <DialogDescription>Total Amount: ${total.toFixed(2)}</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="cash" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="cash">Cash</TabsTrigger>
              <TabsTrigger value="card">Card</TabsTrigger>
              <TabsTrigger value="qr">QR Pay</TabsTrigger>
              <TabsTrigger value="mixed">Mixed</TabsTrigger>
              <TabsTrigger 
                value="credit" 
                disabled={!selectedCustomer || selectedCustomer.id === 'none'}
              >
                Credit
              </TabsTrigger>
            </TabsList>
            <TabsContent value="cash" className="space-y-4">
              <div className="space-y-2">
                <Label>Cash Received</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              {cashReceived && (
                <div className="p-4 bg-muted rounded-lg">
                  <div className="flex justify-between text-lg font-bold">
                    <span>Change:</span>
                    <span className={Number(cashReceived) >= total ? 'text-green-600' : 'text-destructive'}>
                      {(Number(cashReceived) - total).toFixed(2)} UZS
                    </span>
                  </div>
                </div>
              )}
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
                Process Card Payment
              </Button>
            </TabsContent>
            <TabsContent value="qr" className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <p className="text-sm text-muted-foreground">Amount to charge:</p>
                <p className="text-2xl font-bold">{total.toFixed(2)} UZS</p>
              </div>
              <Button
                className="w-full"
                onClick={() => handleCompletePayment('qr')}
              >
                <Smartphone className="h-5 w-5 mr-2" />
                Process QR Payment
              </Button>
            </TabsContent>
            <TabsContent value="mixed" className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Total:</span>
                  <span className="font-bold">{total.toFixed(2)} UZS</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Paid:</span>
                  <span className="font-bold">{paidAmount.toFixed(2)} UZS</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Remaining:</span>
                  <span className={`font-bold ${remainingAmount > 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {remainingAmount.toFixed(2)} UZS
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
                  Add Cash
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPayments([...payments, { method: 'card', amount: remainingAmount }]);
                  }}
                  disabled={remainingAmount <= 0}
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  Add Card
                </Button>
              </div>
              {payments.length > 0 && (
                <div className="space-y-2">
                  <Label>Payment Methods:</Label>
                  {payments.map((payment, index) => (
                    <div key={index} className="flex justify-between items-center p-2 border rounded">
                      <span className="capitalize">{payment.method}</span>
                      <div className="flex items-center gap-2">
                        <span>{payment.amount.toFixed(2)} UZS</span>
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
                <div className="p-4 bg-muted rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">
                    Credit sales are only available for registered customers.
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Please select a customer to continue.
                  </p>
                </div>
              ) : (
                <>
                  <div className="p-4 bg-muted rounded-lg space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Customer:</span>
                      <span className="font-semibold">{selectedCustomer.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Current Balance:</span>
                      <span className={`font-bold ${(selectedCustomer.balance || 0) > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {(selectedCustomer.balance || 0).toFixed(2)} UZS
                      </span>
                    </div>
                    {selectedCustomer.credit_limit > 0 && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Credit Limit:</span>
                        <span className="font-semibold">{selectedCustomer.credit_limit.toFixed(2)} UZS</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Available Credit:</span>
                      <span className="font-semibold text-primary">
                        {(() => {
                          const maxCredit = selectedCustomer.credit_limit > 0 
                            ? Math.min(total, selectedCustomer.credit_limit - (selectedCustomer.balance || 0))
                            : total;
                          return Math.max(0, maxCredit).toFixed(2);
                        })()} UZS
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="credit-amount">Credit Amount (UZS)</Label>
                    <Input
                      id="credit-amount"
                      type="number"
                      step="0.01"
                      min="0"
                      max={(() => {
                        const maxCredit = selectedCustomer.credit_limit > 0 
                          ? Math.min(total, selectedCustomer.credit_limit - (selectedCustomer.balance || 0))
                          : total;
                        return Math.max(0, maxCredit);
                      })()}
                      value={creditAmount}
                      onChange={(e) => {
                        const value = e.target.value;
                        const numValue = Number(value);
                        const maxCredit = selectedCustomer.credit_limit > 0 
                          ? Math.min(total, selectedCustomer.credit_limit - (selectedCustomer.balance || 0))
                          : total;
                        
                        if (value === '' || (numValue >= 0 && numValue <= Math.max(0, maxCredit))) {
                          setCreditAmount(value);
                        }
                      }}
                      placeholder={`Max: ${(() => {
                        const maxCredit = selectedCustomer.credit_limit > 0 
                          ? Math.min(total, selectedCustomer.credit_limit - (selectedCustomer.balance || 0))
                          : total;
                        return Math.max(0, maxCredit).toFixed(2);
                      })()}`}
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter the amount to be paid on credit. Leave empty or enter full amount for complete credit sale.
                    </p>
                  </div>

                  <div className="p-4 bg-muted rounded-lg space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Order Total:</span>
                      <span className="font-bold">{total.toFixed(2)} UZS</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Credit Amount:</span>
                      <span className="font-bold text-primary">
                        {(creditAmount ? Number(creditAmount) : total).toFixed(2)} UZS
                      </span>
                    </div>
                    {creditAmount && Number(creditAmount) < total && (
                      <div className="flex justify-between border-t pt-2">
                        <span className="text-sm font-medium">Remaining to Pay:</span>
                        <span className="font-bold text-destructive">
                          {(total - Number(creditAmount)).toFixed(2)} UZS
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-2">
                      <span className="text-sm text-muted-foreground">New Balance:</span>
                      <span className={`font-bold ${
                        ((selectedCustomer.balance || 0) + (creditAmount ? Number(creditAmount) : total)) > (selectedCustomer.credit_limit || 0) && selectedCustomer.credit_limit > 0 
                          ? 'text-destructive' 
                          : 'text-primary'
                      }`}>
                        {((selectedCustomer.balance || 0) + (creditAmount ? Number(creditAmount) : total)).toFixed(2)} UZS
                      </span>
                    </div>
                  </div>

                  {selectedCustomer.credit_limit > 0 && 
                   ((selectedCustomer.balance || 0) + (creditAmount ? Number(creditAmount) : total)) > selectedCustomer.credit_limit && (
                    <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                      <p className="text-sm text-destructive font-medium">
                        ⚠️ Credit Limit Exceeded
                      </p>
                      <p className="text-xs text-destructive/80 mt-1">
                        This credit amount would exceed the customer's credit limit.
                      </p>
                    </div>
                  )}

                  {creditAmount && Number(creditAmount) < total && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-sm text-blue-900 font-medium">
                        ℹ️ Partial Credit Payment
                      </p>
                      <p className="text-xs text-blue-700 mt-1">
                        After confirming, you'll need to collect the remaining {(total - Number(creditAmount)).toFixed(2)} UZS via Cash, Card, or QR.
                      </p>
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={handleCreditSale}
                    disabled={
                      selectedCustomer.status !== 'active' ||
                      (selectedCustomer.credit_limit > 0 && 
                       ((selectedCustomer.balance || 0) + (creditAmount ? Number(creditAmount) : total)) > selectedCustomer.credit_limit) ||
                      (creditAmount && Number(creditAmount) < 0)
                    }
                  >
                    <Tag className="h-5 w-5 mr-2" />
                    {creditAmount && Number(creditAmount) < total 
                      ? 'Continue with Partial Credit' 
                      : 'Sell on Credit'}
                  </Button>
                  {selectedCustomer.status !== 'active' && (
                    <p className="text-xs text-center text-destructive">
                      Customer account is inactive
                    </p>
                  )}
                </>
              )}
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
            <AlertDialogTitle>Replace Current Cart?</AlertDialogTitle>
            <AlertDialogDescription>
              You have items in the current cart. Do you want to replace them with the waiting order?
              Current cart items will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setOrderToRestore(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => orderToRestore && restoreOrder(orderToRestore)}>
              Replace Cart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
