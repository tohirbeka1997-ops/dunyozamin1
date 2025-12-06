import { useState, useEffect } from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  generateOrderNumber,
  generatePaymentNumber,
  getActiveShift,
  createShift,
  generateShiftNumber,
} from '@/db/api';
import type { Product, Customer, CartItem, PaymentMethod } from '@/types/database';
import { Search, Trash2, Plus, Minus, DollarSign, CreditCard, Smartphone, Banknote, Tag } from 'lucide-react';

export default function POSTerminal() {
  const { toast } = useToast();
  const { profile } = useAuth();
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

  useEffect(() => {
    loadCustomers();
    checkShift();
  }, []);

  const checkShift = async () => {
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
  };

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

  const loadCustomers = async () => {
    try {
      const data = await getCustomers();
      setCustomers(data);
    } catch (error) {
      console.error('Error loading customers:', error);
    }
  };

  const handleSearch = async (term: string) => {
    setSearchTerm(term);
    if (term.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const results = await searchProducts(term);
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching products:', error);
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
    setCart(
      cart.map((item) => {
        if (item.product.id === productId) {
          const subtotal = Number(item.product.sale_price) * quantity;
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
            quantity,
            subtotal,
            discount_amount: lineDiscount,
            total: subtotal - lineDiscount,
          };
        }
        return item;
      })
    );
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
        title: 'Error',
        description: 'Cart is empty. Please add items before completing the order.',
        variant: 'destructive',
      });
      return;
    }

    const { subtotal, discountAmount, total } = calculateTotals();

    if (total <= 0) {
      toast({
        title: 'Error',
        description: 'Order total must be greater than zero',
        variant: 'destructive',
      });
      return;
    }

    // Prepare payment data based on method
    let orderPayments: { method: PaymentMethod; amount: number }[] = [];
    let paidAmount = 0;
    let changeAmount = 0;

    if (paymentMethod === 'cash') {
      const cashAmount = Number(cashReceived);
      if (!cashAmount || cashAmount < total) {
        toast({
          title: 'Error',
          description: 'Cash received must be greater than or equal to the total amount',
          variant: 'destructive',
        });
        return;
      }
      orderPayments = [{ method: 'cash', amount: cashAmount }];
      paidAmount = cashAmount;
      changeAmount = cashAmount - total;
    } else if (paymentMethod === 'card') {
      orderPayments = [{ method: 'card', amount: total }];
      paidAmount = total;
      changeAmount = 0;
    } else if (paymentMethod === 'qr') {
      orderPayments = [{ method: 'qr', amount: total }];
      paidAmount = total;
      changeAmount = 0;
    } else if (paymentMethod === 'mixed') {
      if (payments.length === 0) {
        toast({
          title: 'Error',
          description: 'Please add at least one payment method',
          variant: 'destructive',
        });
        return;
      }
      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      if (totalPaid < total) {
        toast({
          title: 'Error',
          description: `Insufficient payment. Paid: ${totalPaid.toFixed(2)} UZS, Required: ${total.toFixed(2)} UZS`,
          variant: 'destructive',
        });
        return;
      }
      orderPayments = payments;
      paidAmount = totalPaid;
      changeAmount = totalPaid - total;
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
        change_amount: changeAmount,
        status: 'completed' as const,
        payment_status: 'paid' as const,
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

      // Success!
      toast({
        title: 'Success',
        description: changeAmount > 0 
          ? `Order ${orderNumber} completed. Change: ${changeAmount.toFixed(2)} UZS`
          : `Order ${orderNumber} completed successfully`,
      });

      // Clear cart and reset state
      setCart([]);
      setPayments([]);
      setDiscount({ type: 'amount', value: 0 });
      setSelectedCustomer(null);
      setPaymentDialogOpen(false);
      setCashReceived('');
    } catch (error) {
      console.error('Order completion error:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to complete order. Please try again.',
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
          <Card>
            <CardHeader>
              <CardTitle>Product Search</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search products by name, SKU, or barcode..."
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
              {searchResults.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                  {searchResults.map((product) => (
                    <Button
                      key={product.id}
                      variant="outline"
                      className="h-auto p-3 flex flex-col items-start"
                      onClick={() => {
                        addToCart(product);
                        setSearchTerm('');
                        setSearchResults([]);
                      }}
                    >
                      <span className="font-medium text-sm">{product.name}</span>
                      <span className="text-xs text-muted-foreground">{Number(product.sale_price).toFixed(2)} UZS</span>
                      <span className="text-xs text-muted-foreground">Stock: {product.current_stock}</span>
                    </Button>
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
                  {cart.map((item) => (
                    <div key={item.product.id} className="flex flex-col gap-2 p-3 border rounded-lg">
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <p className="font-medium">{item.product.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {Number(item.product.sale_price).toFixed(2)} UZS × {item.quantity} = {item.subtotal.toFixed(2)} UZS
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="w-8 text-center">{item.quantity}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => removeFromCart(item.product.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between pt-2 border-t">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 gap-2">
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
                                  placeholder="0.00"
                                  className="h-8"
                                />
                                <p className="text-xs text-muted-foreground">
                                  Max: {item.subtotal.toFixed(2)} UZS
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="flex-1 h-7 text-xs"
                                  onClick={() => updateLineDiscount(item.product.id, item.subtotal * 0.05)}
                                >
                                  5%
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="flex-1 h-7 text-xs"
                                  onClick={() => updateLineDiscount(item.product.id, item.subtotal * 0.10)}
                                >
                                  10%
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="flex-1 h-7 text-xs"
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
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Customer (Optional)</Label>
                <Select
                  value={selectedCustomer?.id || 'none'}
                  onValueChange={(value) => {
                    const customer = customers.find((c) => c.id === value);
                    setSelectedCustomer(customer || null);
                  }}
                >
                  <SelectTrigger>
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

              <Button
                className="w-full h-12"
                size="lg"
                disabled={cart.length === 0}
                onClick={() => setPaymentDialogOpen(true)}
              >
                <DollarSign className="h-5 w-5 mr-2" />
                Process Payment
              </Button>
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
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="cash">Cash</TabsTrigger>
              <TabsTrigger value="card">Card</TabsTrigger>
              <TabsTrigger value="qr">QR Pay</TabsTrigger>
              <TabsTrigger value="mixed">Mixed</TabsTrigger>
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
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
