import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { getSalesReturnById, completeSalesReturn, cancelSalesReturn } from '@/db/api';
import type { SalesReturnWithDetails } from '@/types/database';
import { ArrowLeft, Printer, CheckCircle, XCircle, Package } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function ReturnDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [returnData, setReturnData] = useState<SalesReturnWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (id) {
      loadReturnData();
    }
  }, [id]);

  const loadReturnData = async () => {
    if (!id) return;
    
    try {
      setLoading(true);
      const data = await getSalesReturnById(id);
      setReturnData(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load return details',
        variant: 'destructive',
      });
      navigate('/sales-returns');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    if (!id) return;
    
    try {
      setActionLoading(true);
      await completeSalesReturn(id);
      toast({
        title: 'Success',
        description: 'Return completed successfully. Inventory has been updated.',
      });
      loadReturnData();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to complete return',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!id) return;
    
    try {
      setActionLoading(true);
      await cancelSalesReturn(id);
      toast({
        title: 'Success',
        description: 'Return cancelled successfully',
      });
      loadReturnData();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to cancel return',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Completed':
        return <Badge className="bg-success text-success-foreground">Completed</Badge>;
      case 'Pending':
        return <Badge className="bg-primary text-primary-foreground">Pending</Badge>;
      case 'Cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getReasonLabel = (reason: string) => {
    const reasons: Record<string, string> = {
      damaged: 'Damaged Product',
      incorrect: 'Incorrect Item',
      defective: 'Defective Product',
      dissatisfaction: 'Customer Dissatisfaction',
      expired: 'Expired Product',
      other: 'Other',
    };
    return reasons[reason] || reason;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!returnData) {
    return (
      <div className="text-center py-12">
        <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Return not found</p>
        <Button className="mt-4" onClick={() => navigate('/sales-returns')}>
          Back to Returns
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/sales-returns')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Return Details</h1>
            <p className="text-muted-foreground">{returnData.return_number}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              toast({
                title: 'Print',
                description: 'Print functionality coming soon',
              });
            }}
          >
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          {returnData.status === 'Pending' && (
            <>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={actionLoading}>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Complete Return
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Complete Return?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will update the inventory and mark the return as completed. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleComplete}>Complete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={actionLoading}>
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel Return
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel Return?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will cancel the return. No inventory changes will be made.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>No</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCancel}>Yes, Cancel</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Return Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Return Number</Label>
                <p className="font-medium">{returnData.return_number}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Status</Label>
                <div className="mt-1">{getStatusBadge(returnData.status)}</div>
              </div>
              <div>
                <Label className="text-muted-foreground">Order Number</Label>
                <p className="font-medium">
                  <Button
                    variant="link"
                    className="p-0 h-auto font-medium"
                    onClick={() => navigate(`/orders/${returnData.order_id}`)}
                  >
                    {returnData.order?.order_number}
                  </Button>
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Date & Time</Label>
                <p className="font-medium">{new Date(returnData.created_at).toLocaleString()}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Customer</Label>
                <p className="font-medium">{returnData.customer?.name || 'Walk-in'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Cashier</Label>
                <p className="font-medium">{returnData.cashier?.username || '-'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Return Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Reason for Return</Label>
              <p className="font-medium">{getReasonLabel(returnData.reason)}</p>
            </div>
            {returnData.refund_method && (
              <div>
                <Label className="text-muted-foreground">Refund Method</Label>
                <p className="font-medium capitalize">{returnData.refund_method.replace('_', ' ')}</p>
              </div>
            )}
            {returnData.notes && (
              <div>
                <Label className="text-muted-foreground">Notes</Label>
                <p className="text-sm">{returnData.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Returned Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-center">Quantity</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Line Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returnData.items?.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    {item.product?.name || item.product_name}
                  </TableCell>
                  <TableCell>{item.product?.sku || '-'}</TableCell>
                  <TableCell className="text-center">{item.quantity}</TableCell>
                  <TableCell className="text-right">${Number(item.unit_price).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-medium">
                    ${Number(item.line_total).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-6 space-y-2 border-t pt-4">
            <div className="flex justify-between text-lg font-bold">
              <span>Total Refund Amount:</span>
              <span>${Number(returnData.total_amount).toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {returnData.order && (
        <Card>
          <CardHeader>
            <CardTitle>Order Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-muted-foreground">Original Total</Label>
                <p className="font-medium">${Number(returnData.order.total_amount).toFixed(2)}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Return Amount</Label>
                <p className="font-medium text-destructive">
                  -${Number(returnData.total_amount).toFixed(2)}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Net Total</Label>
                <p className="font-medium">
                  ${(Number(returnData.order.total_amount) - Number(returnData.total_amount)).toFixed(2)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
