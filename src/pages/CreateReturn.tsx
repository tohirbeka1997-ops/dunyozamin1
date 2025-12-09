import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
  const [refundMethod, setRefundMethod] = useState<'cash' | 'card' | 'credit' | ''>('');

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
        title: t('common.error'),
        description: t('sales_returns.create.failed_to_load_orders'),
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
        title: t('common.error'),
        description: t('sales_returns.create.failed_to_load_order_details'),
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
        title: t('sales_returns.create.invalid_quantity_title'),
        description: t('sales_returns.create.invalid_quantity', { max: item.sold_quantity }),
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
    if (!selectedOrder) {
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
      
      await createSalesReturn({
        order_id: selectedOrder.id,
        customer_id: selectedOrder.customer_id,
        total_amount: totalRefund,
        refund_method: refundMethod as 'cash' | 'card' | 'credit',
        reason: reason.trim(),
        notes: notes.trim() || null,
        items: itemsToReturn.map(item => ({
          product_id: item.product_id,
          quantity: item.return_quantity,
          unit_price: item.unit_price,
          line_total: item.line_total,
        })),
      });
      
      toast({
        title: t('common.success'),
        description: t('sales_returns.create.success'),
      });
      
      navigate('/sales-returns');
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
              {step === 1 && t('sales_returns.create.step_1')}
              {step === 2 && t('sales_returns.create.step_2')}
              {step === 3 && t('sales_returns.create.step_3')}
            </p>
          </div>
        </div>
      </div>

      {/* Step 1: Order Selection */}
      {step === 1 && (
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
                      <TableCell>{new Date(order.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">${Number(order.total_amount).toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => handleSelectOrder(order.id)}>
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

      {/* Step 2: Return Items */}
      {step === 2 && selectedOrder && (
        <div className="space-y-6">
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
                  <p className="font-medium">{new Date(selectedOrder.created_at).toLocaleDateString()}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t('sales_returns.create.total_amount')}</Label>
                  <p className="font-medium">${Number(selectedOrder.total_amount).toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

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
                    <TableHead className="text-center">{t('sales_returns.create.table.sold_qty')}</TableHead>
                    <TableHead className="text-center">{t('sales_returns.create.table.return_qty')}</TableHead>
                    <TableHead className="text-right">{t('sales_returns.create.table.unit_price')}</TableHead>
                    <TableHead className="text-right">{t('sales_returns.create.table.line_total')}</TableHead>
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
                  <span>{t('sales_returns.create.subtotal')}:</span>
                  <span className="font-medium">${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>{t('sales_returns.create.tax')}:</span>
                  <span className="font-medium">${taxAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>{t('sales_returns.create.total_refund')}:</span>
                  <span>${totalRefund.toFixed(2)}</span>
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
                <Select value={refundMethod} onValueChange={(value) => setRefundMethod(value as 'cash' | 'card' | 'credit')}>
                  <SelectTrigger className={!refundMethod ? 'border-destructive' : ''}>
                    <SelectValue placeholder={t('sales_returns.create.select_refund_method')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t('pos.cash')}</SelectItem>
                    <SelectItem value="card">{t('pos.card')}</SelectItem>
                    <SelectItem value="credit">{t('sales_returns.create.store_credit')}</SelectItem>
                  </SelectContent>
                </Select>
                {!refundMethod && (
                  <p className="text-sm text-destructive">{t('sales_returns.create.select_refund_method_error')}</p>
                )}
              </div>

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
                      {t('sales_returns.create.summary.order')}: {selectedOrder?.order_number}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('sales_returns.create.summary.items_to_return')}: {returnItems.filter(i => i.return_quantity > 0).length}
                    </p>
                    <p className="text-sm font-medium">
                      {t('sales_returns.create.summary.total_refund')}: ${totalRefund.toFixed(2)}
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
