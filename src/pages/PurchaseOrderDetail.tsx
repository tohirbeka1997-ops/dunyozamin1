import { useState, useEffect } from 'react';
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
import { getPurchaseOrderById, receiveGoods, updatePurchaseOrder, approvePurchaseOrder, cancelPurchaseOrder, productUpdateEmitter } from '@/db/api';
import type { PurchaseOrderWithDetails } from '@/types/database';
import { ArrowLeft, Edit, Package, X, FileText, DollarSign, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { formatMoneyUZS } from '@/lib/format';
import PaySupplierDialog from '@/components/suppliers/PaySupplierDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrderWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReceiveDialog, setShowReceiveDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);

  useEffect(() => {
    if (id) {
      loadPurchaseOrder();
    }
  }, [id]);

  const loadPurchaseOrder = async () => {
    try {
      setLoading(true);
      const data = await getPurchaseOrderById(id!);
      setPurchaseOrder(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load purchase order',
        variant: 'destructive',
      });
      navigate('/purchase-orders');
    } finally {
      setLoading(false);
    }
  };

  const handleReceiveGoods = async () => {
    if (!purchaseOrder || !id) return;

    try {
      setProcessing(true);

      // Prepare items for receiving (receive all ordered quantities)
      const receiveItems = (purchaseOrder.items || []).map((item) => ({
        item_id: item.id,
        received_qty: item.ordered_qty - item.received_qty, // Receive remaining quantity
      }));

      await receiveGoods(id, receiveItems);

      // Emit product update event to refresh inventory pages
      // This ensures inventory quantities update immediately across all open pages
      productUpdateEmitter.emit();

      toast({
        title: 'Success',
        description: 'Goods received successfully. Stock has been updated.',
      });

      setShowReceiveDialog(false);
      loadPurchaseOrder();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to receive goods',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleApprove = async () => {
    if (!purchaseOrder || !id) return;

    try {
      setProcessing(true);
      await approvePurchaseOrder(id, 'current-user-id'); // TODO: Get actual user ID from auth context
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Xarid buyurtmasi tasdiqlandi',
      });
      loadPurchaseOrder(); // Refresh to show updated status
    } catch (error: any) {
      toast({
        title: 'Xatolik',
        description: error.message || 'Xarid buyurtmasini tasdiqlab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!id) return;

    try {
      setProcessing(true);

      await updatePurchaseOrder(id, { status: 'cancelled' });

      toast({
        title: 'Success',
        description: 'Purchase order cancelled',
      });

      setShowCancelDialog(false);
      loadPurchaseOrder();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to cancel purchase order',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
      approved: { label: 'Approved', className: 'bg-primary text-primary-foreground' },
      partially_received: {
        label: 'Partially Received',
        className: 'bg-warning text-warning-foreground',
      },
      received: { label: 'Received', className: 'bg-success text-success-foreground' },
      cancelled: { label: 'Cancelled', className: 'bg-destructive text-destructive-foreground' },
    };

    const config = statusConfig[status] || { label: status, className: '' };
    return <Badge className={config.className}>{config.label}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!purchaseOrder) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Purchase order not found</p>
        <Button onClick={() => navigate('/purchase-orders')} className="mt-4">
          Back to Purchase Orders
        </Button>
      </div>
    );
  }

  const canApprove = purchaseOrder.status === 'draft';
  const canEdit = purchaseOrder.status === 'draft' || purchaseOrder.status === 'approved';
  const canReceive =
    purchaseOrder.status === 'approved' || purchaseOrder.status === 'partially_received';
  const canCancel = purchaseOrder.status === 'draft' || purchaseOrder.status === 'approved';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/purchase-orders')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Purchase Order Details</h1>
            <p className="text-muted-foreground">{purchaseOrder.po_number}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {canApprove && (
            <Button onClick={handleApprove} disabled={processing}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Tasdiqlash
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" onClick={() => navigate(`/purchase-orders/${id}/edit`)}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
          {canReceive && (
            <Button onClick={() => setShowReceiveDialog(true)}>
              <Package className="h-4 w-4 mr-2" />
              Receive Goods
            </Button>
          )}
          {canCancel && (
            <Button variant="destructive" onClick={() => setShowCancelDialog(true)}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Order Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">PO Number</p>
                  <p className="font-medium">{purchaseOrder.po_number}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <div className="mt-1">{getStatusBadge(purchaseOrder.status)}</div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Supplier</p>
                  {purchaseOrder.supplier_id ? (
                    <Button
                      variant="link"
                      className="h-auto p-0 font-medium text-primary"
                      onClick={() => navigate(`/suppliers/${purchaseOrder.supplier_id}`)}
                    >
                      {purchaseOrder.supplier?.name || purchaseOrder.supplier_name || '-'}
                    </Button>
                  ) : (
                    <p className="font-medium">
                      {purchaseOrder.supplier_name || '-'}
                    </p>
                  )}
                  {purchaseOrder.supplier?.phone && (
                    <p className="text-sm text-muted-foreground">{purchaseOrder.supplier.phone}</p>
                  )}
                  {purchaseOrder.supplier?.email && (
                    <p className="text-sm text-muted-foreground">{purchaseOrder.supplier.email}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Order Date</p>
                  <p className="font-medium">
                    {format(new Date(purchaseOrder.order_date), 'MMM dd, yyyy')}
                  </p>
                </div>
                {purchaseOrder.expected_date && (
                  <div>
                    <p className="text-sm text-muted-foreground">Expected Date</p>
                    <p className="font-medium">
                      {format(new Date(purchaseOrder.expected_date), 'MMM dd, yyyy')}
                    </p>
                  </div>
                )}
                {purchaseOrder.reference && (
                  <div>
                    <p className="text-sm text-muted-foreground">Reference</p>
                    <p className="font-medium">{purchaseOrder.reference}</p>
                  </div>
                )}
                {purchaseOrder.created_by_profile && (
                  <div>
                    <p className="text-sm text-muted-foreground">Created By</p>
                    <p className="font-medium">
                      {purchaseOrder.created_by_profile.full_name ||
                        purchaseOrder.created_by_profile.username}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Created At</p>
                  <p className="font-medium">
                    {format(new Date(purchaseOrder.created_at), 'MMM dd, yyyy HH:mm')}
                  </p>
                </div>
              </div>
              {purchaseOrder.notes && (
                <div className="mt-4">
                  <p className="text-sm text-muted-foreground">Notes</p>
                  <p className="mt-1">{purchaseOrder.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle>Order Items</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Ordered Qty</TableHead>
                    <TableHead className="text-right">Received Qty</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Line Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(purchaseOrder.items || []).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.product_name}</TableCell>
                      <TableCell className="text-right">{item.ordered_qty}</TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            item.received_qty >= item.ordered_qty
                              ? 'text-success'
                              : item.received_qty > 0
                                ? 'text-warning'
                                : ''
                          }
                        >
                          {item.received_qty}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{formatMoneyUZS(item.unit_cost)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoneyUZS(item.line_total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Summary */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatMoneyUZS(purchaseOrder.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="font-medium">{formatMoneyUZS(purchaseOrder.discount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="font-medium">{formatMoneyUZS(purchaseOrder.tax)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between">
                  <span className="font-semibold">Total</span>
                  <span className="font-bold text-lg">
                    {formatMoneyUZS(purchaseOrder.total_amount)}
                  </span>
                </div>
                {(purchaseOrder.status === 'received' || purchaseOrder.status === 'partially_received') && (
                  <>
                    <div className="border-t pt-2 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">To'langan:</span>
                        <span className="font-medium">{formatMoneyUZS(purchaseOrder.paid_amount ?? 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Qoldiq:</span>
                        <span className={`font-medium ${(purchaseOrder.remaining_amount ?? purchaseOrder.total_amount) > 0 ? 'text-destructive' : 'text-success'}`}>
                          {formatMoneyUZS(purchaseOrder.remaining_amount ?? purchaseOrder.total_amount)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">To'lov holati:</span>
                        <Badge className={
                          purchaseOrder.payment_status === 'PAID' 
                            ? 'bg-success text-success-foreground'
                            : purchaseOrder.payment_status === 'PARTIALLY_PAID'
                            ? 'bg-warning text-warning-foreground'
                            : 'bg-destructive text-destructive-foreground'
                        }>
                          {purchaseOrder.payment_status === 'PAID' ? 'To\'langan' :
                           purchaseOrder.payment_status === 'PARTIALLY_PAID' ? 'Qisman to\'langan' :
                           'To\'lanmagan'}
                        </Badge>
                      </div>
                      {(purchaseOrder.remaining_amount ?? purchaseOrder.total_amount) > 0 && purchaseOrder.supplier && (
                        <div className="pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => setPayDialogOpen(true)}
                          >
                            <DollarSign className="h-4 w-4 mr-2" />
                            To'lov qilish
                          </Button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="pt-4 border-t space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Items</span>
                  <span className="font-medium">{purchaseOrder.items?.length || 0}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Ordered Qty</span>
                  <span className="font-medium">
                    {(purchaseOrder.items || []).reduce(
                      (sum, item) => sum + item.ordered_qty,
                      0
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Received Qty</span>
                  <span className="font-medium">
                    {(purchaseOrder.items || []).reduce(
                      (sum, item) => sum + item.received_qty,
                      0
                    )}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Receive Goods Dialog */}
      <Dialog open={showReceiveDialog} onOpenChange={setShowReceiveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Receive Goods</DialogTitle>
            <DialogDescription>
              This will mark all items as received and update the product stock quantities. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              The following items will be received:
            </p>
            <ul className="mt-2 space-y-1">
              {(purchaseOrder.items || []).map((item) => {
                const remainingQty = item.ordered_qty - item.received_qty;
                if (remainingQty > 0) {
                  return (
                    <li key={item.id} className="text-sm">
                      • {item.product_name}: <strong>{remainingQty}</strong> units
                    </li>
                  );
                }
                return null;
              })}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReceiveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleReceiveGoods} disabled={processing}>
              {processing ? 'Processing...' : 'Confirm Receive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Order Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Purchase Order</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel this purchase order? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelDialog(false)}>
              No, Keep It
            </Button>
            <Button variant="destructive" onClick={handleCancelOrder} disabled={processing}>
              {processing ? 'Cancelling...' : 'Yes, Cancel Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay Supplier Dialog */}
      {purchaseOrder && purchaseOrder.supplier && (
        <PaySupplierDialog
          supplier={purchaseOrder.supplier}
          purchaseOrder={purchaseOrder}
          open={payDialogOpen}
          onOpenChange={setPayDialogOpen}
          onSuccess={() => {
            loadPurchaseOrder(); // Reload to refresh payment info
          }}
        />
      )}
    </div>
  );
}
