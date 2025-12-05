import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { getOrders, getOrderForReturn, createSalesReturn } from '@/db/api';
import type { Order, OrderWithDetails, OrderItem } from '@/types/database';
import { Search, ArrowLeft, Package, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ReturnItem {
  product_id: string;
  product_name: string;
  sku: string;
  sold_quantity: number;
  return_quantity: number;
  unit_price: number;
  line_total: number;
}

export default function CreateReturn() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  
  // Step 1: Order Selection
  const [orders, setOrders] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<OrderWithDetails | null>(null);
  
  // Step 2: Return Items
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  
  // Step 3: Additional Info
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [refundMethod, setRefundMethod] = useState('');

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    try {
      setLoading(true);
      const data = await getOrders();
      // Filter for completed orders only
      const completedOrders = data.filter((order: any) => order.status === 'completed');
      setOrders(completedOrders);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load orders',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOrder = async (orderId: string) => {
    try {
      setLoading(true);
      const orderData = await getOrderForReturn(orderId);
      setSelectedOrder(orderData);
      
      // Initialize return items from order items
      const items: ReturnItem[] = (orderData.items || []).map((item: any) => ({
        product_id: item.product_id,
        product_name: item.product?.name || item.product_name,
        sku: item.product?.sku || '',
        sold_quantity: item.quantity,
        return_quantity: 0,
        unit_price: Number(item.unit_price),
        line_total: 0,
      }));
      
      setReturnItems(items);
      setStep(2);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load order details',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReturnQuantityChange = (index: number, value: string) => {
    const quantity = parseInt(value) || 0;
    const item = returnItems[index];
    
    if (quantity > item.sold_quantity) {
      toast({
        title: 'Invalid Quantity',
        description: `Return quantity cannot exceed sold quantity (${item.sold_quantity})`,
        variant: 'destructive',
      });
      return;
    }
    
    const newItems = [...returnItems];
    newItems[index].return_quantity = quantity;
    newItems[index].line_total = quantity * item.unit_price;
    setReturnItems(newItems);
  };

  const calculateTotals = () => {
    const subtotal = returnItems.reduce((sum, item) => sum + item.line_total, 0);
    const taxAmount = 0; // No tax on returns for now
    const totalRefund = subtotal - taxAmount;
    
    return { subtotal, taxAmount, totalRefund };
  };

  const handleSubmit = async () => {
    if (!selectedOrder) return;
    
    // Validate at least one item is being returned
    const itemsToReturn = returnItems.filter(item => item.return_quantity > 0);
    if (itemsToReturn.length === 0) {
      toast({
        title: 'No Items Selected',
        description: 'Please select at least one item to return',
        variant: 'destructive',
      });
      return;
    }
    
    if (!reason) {
      toast({
        title: 'Reason Required',
        description: 'Please provide a reason for the return',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      setLoading(true);
      const { totalRefund } = calculateTotals();
      
      await createSalesReturn({
        order_id: selectedOrder.id,
        customer_id: selectedOrder.customer_id,
        total_amount: totalRefund,
        reason,
        notes,
        refund_method: refundMethod || null,
        items: itemsToReturn.map(item => ({
          product_id: item.product_id,
          quantity: item.return_quantity,
          unit_price: item.unit_price,
          line_total: item.line_total,
        })),
      });
      
      toast({
        title: 'Success',
        description: 'Sales return created successfully',
      });
      
      navigate('/sales-returns');
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create return',
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

  const { subtotal, taxAmount, totalRefund } = calculateTotals();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/sales-returns')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Create Sales Return</h1>
            <p className="text-muted-foreground">
              {step === 1 && 'Step 1: Select an order'}
              {step === 2 && 'Step 2: Select items to return'}
              {step === 3 && 'Step 3: Additional information'}
            </p>
          </div>
        </div>
      </div>

      {/* Step 1: Order Selection */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Select Order</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by order number or customer..."
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
                <p className="text-muted-foreground">No completed orders found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order Number</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.order_number}</TableCell>
                      <TableCell>{order.customer?.name || 'Walk-in'}</TableCell>
                      <TableCell>{new Date(order.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">${Number(order.total_amount).toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => handleSelectOrder(order.id)}>
                          Select
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

      {/* Step 2: Return Items */}
      {step === 2 && selectedOrder && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Order Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label className="text-muted-foreground">Order Number</Label>
                  <p className="font-medium">{selectedOrder.order_number}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Customer</Label>
                  <p className="font-medium">{selectedOrder.customer?.name || 'Walk-in'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Date</Label>
                  <p className="font-medium">{new Date(selectedOrder.created_at).toLocaleDateString()}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Total Amount</Label>
                  <p className="font-medium">${Number(selectedOrder.total_amount).toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Return Items</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-center">Sold Qty</TableHead>
                    <TableHead className="text-center">Return Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Line Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {returnItems.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.product_name}</TableCell>
                      <TableCell>{item.sku}</TableCell>
                      <TableCell className="text-center">{item.sold_quantity}</TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="number"
                          min="0"
                          max={item.sold_quantity}
                          value={item.return_quantity}
                          onChange={(e) => handleReturnQuantityChange(index, e.target.value)}
                          className="w-20 text-center"
                        />
                      </TableCell>
                      <TableCell className="text-right">${item.unit_price.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">
                        ${item.line_total.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-6 space-y-2 border-t pt-4">
                <div className="flex justify-between text-sm">
                  <span>Subtotal:</span>
                  <span className="font-medium">${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Tax:</span>
                  <span className="font-medium">${taxAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>Total Refund:</span>
                  <span>${totalRefund.toFixed(2)}</span>
                </div>
              </div>

              <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button onClick={() => setStep(3)}>
                  Continue
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
            <CardTitle>Additional Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Reason for Return *</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="damaged">Damaged Product</SelectItem>
                  <SelectItem value="incorrect">Incorrect Item</SelectItem>
                  <SelectItem value="defective">Defective Product</SelectItem>
                  <SelectItem value="dissatisfaction">Customer Dissatisfaction</SelectItem>
                  <SelectItem value="expired">Expired Product</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="refund_method">Refund Method</Label>
              <Select value={refundMethod} onValueChange={setRefundMethod}>
                <SelectTrigger>
                  <SelectValue placeholder="Select refund method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="store_credit">Store Credit</SelectItem>
                  <SelectItem value="original_payment">Original Payment Method</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add any additional notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
              />
            </div>

            <div className="bg-muted p-4 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-primary mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium">Return Summary</p>
                  <p className="text-sm text-muted-foreground">
                    Order: {selectedOrder?.order_number}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Items to return: {returnItems.filter(i => i.return_quantity > 0).length}
                  </p>
                  <p className="text-sm font-medium">
                    Total refund amount: ${totalRefund.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={handleSubmit} disabled={loading}>
                {loading ? 'Creating...' : 'Submit Return'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
