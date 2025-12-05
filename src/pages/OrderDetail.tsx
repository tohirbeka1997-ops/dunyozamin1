import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { getOrderById } from '@/db/api';
import type { OrderWithDetails } from '@/types/database';
import { ArrowLeft, Printer, RotateCcw, XCircle } from 'lucide-react';

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [order, setOrder] = useState<OrderWithDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadOrder();
    }
  }, [id]);

  const loadOrder = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const orderData = await getOrderById(id);
      setOrder(orderData);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load order details',
        variant: 'destructive',
      });
      navigate('/orders');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; className: string }> = {
      completed: { label: 'Completed', className: 'bg-success text-success-foreground' },
      pending: { label: 'Pending', className: 'bg-primary text-primary-foreground' },
      voided: { label: 'Voided', className: 'bg-muted text-muted-foreground' },
      refunded: { label: 'Refunded', className: 'bg-warning text-warning-foreground' },
    };
    const variant = variants[status] || variants.completed;
    return <Badge className={variant.className}>{variant.label}</Badge>;
  };

  const getPaymentStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
      paid: { label: 'Paid', variant: 'default' },
      partial: { label: 'Partially Paid', variant: 'secondary' },
      unpaid: { label: 'Unpaid', variant: 'destructive' },
    };
    const variant = variants[status] || variants.paid;
    return <Badge variant={variant.variant}>{variant.label}</Badge>;
  };

  const getPaymentMethodIcon = (method: string) => {
    const icons: Record<string, string> = {
      cash: '💵',
      card: '💳',
      qr: '📱',
    };
    return icons[method] || '💰';
  };

  if (loading || !order) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  const canVoid = profile && ['admin', 'manager'].includes(profile.role) && order.status === 'completed';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/orders')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Order Details</h1>
            <p className="text-muted-foreground">View order information and history</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => toast({ title: 'Print', description: 'Print feature coming soon' })}>
            <Printer className="h-4 w-4 mr-2" />
            Print Receipt
          </Button>
          {order.status === 'completed' && (
            <Button onClick={() => navigate(`/sales-returns/create`)}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Create Return
            </Button>
          )}
          {canVoid && (
            <Button variant="destructive" onClick={() => toast({ title: 'Void Order', description: 'Void feature coming soon' })}>
              <XCircle className="h-4 w-4 mr-2" />
              Void Order
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Order Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Order Number</p>
                <p className="font-mono font-bold text-lg">{order.order_number}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Date & Time</p>
                <p className="font-medium">{new Date(order.created_at).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Cashier</p>
                <p className="font-medium">{order.cashier?.username || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Customer</p>
                <p className="font-medium">{order.customer?.name || 'Walk-in Customer'}</p>
              </div>
            </div>

            <div className="flex gap-2">
              {getStatusBadge(order.status)}
              {getPaymentStatusBadge(order.payment_status)}
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold mb-4">Order Items</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items?.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <p className="font-medium">{item.product_name}</p>
                      </TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">
                        ${Number(item.unit_price).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.discount_amount > 0 ? (
                          <span className="text-destructive">
                            -${Number(item.discount_amount).toFixed(2)}
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${Number(item.total).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal:</span>
                  <span className="font-medium">${Number(order.subtotal).toFixed(2)}</span>
                </div>
                {order.discount_amount > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>Discount:</span>
                    <span className="font-medium">-${Number(order.discount_amount).toFixed(2)}</span>
                  </div>
                )}
                {order.discount_percent > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Discount Rate:</span>
                    <span>{order.discount_percent}%</span>
                  </div>
                )}
                {order.tax_amount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax:</span>
                    <span className="font-medium">${Number(order.tax_amount).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold pt-2 border-t">
                  <span>Total:</span>
                  <span>${Number(order.total_amount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-success">
                  <span>Amount Paid:</span>
                  <span className="font-medium">${Number(order.paid_amount).toFixed(2)}</span>
                </div>
                {order.change_amount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Change:</span>
                    <span className="font-medium">${Number(order.change_amount).toFixed(2)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {!order.payments || order.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded</p>
              ) : (
                <div className="space-y-3">
                  {order.payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{getPaymentMethodIcon(payment.payment_method)}</span>
                        <div>
                          <p className="font-medium capitalize">{payment.payment_method}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(payment.created_at).toLocaleString()}
                          </p>
                          {payment.reference_number && (
                            <p className="text-xs text-muted-foreground font-mono">
                              Ref: {payment.reference_number}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">${Number(payment.amount).toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {order.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{order.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
