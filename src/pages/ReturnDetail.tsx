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
import { getSalesReturnById, deleteSalesReturn, updateSalesReturn } from '@/db/api';
import type { SalesReturnWithDetails } from '@/types/database';
import { ArrowLeft, Printer, Package, Edit, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';

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
      console.error('Error loading return:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load return details',
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
      await updateSalesReturn(id, { status: 'Completed' });
      toast({
        title: 'Success',
        description: 'Return marked as completed',
      });
      loadReturnData();
    } catch (error) {
      console.error('Error completing return:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to complete return',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    
    try {
      setActionLoading(true);
      await deleteSalesReturn(id);
      toast({
        title: 'Success',
        description: 'Return deleted successfully. Inventory has been reversed.',
      });
      navigate('/sales-returns');
    } catch (error) {
      console.error('Error deleting return:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete return',
        variant: 'destructive',
      });
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

  const getRefundMethodLabel = (method: string) => {
    const methods: Record<string, string> = {
      cash: 'Cash',
      card: 'Card',
      credit: 'Store Credit',
    };
    return methods[method] || method;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-64 bg-muted" />
          <Skeleton className="h-10 w-32 bg-muted" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64 bg-muted" />
          <Skeleton className="h-64 bg-muted" />
        </div>
        <Skeleton className="h-96 bg-muted" />
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

  const canEdit = returnData.status !== 'Completed';
  const canDelete = returnData.status !== 'Completed';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => navigate('/sales-returns')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Return Details</h1>
            <p className="text-sm text-muted-foreground">{returnData.return_number}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              variant="outline"
              onClick={() => navigate(`/sales-returns/${id}/edit`)}
            >
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={actionLoading}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Return?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the return and reverse all inventory changes.
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {returnData.status === 'Pending' && (
            <Button onClick={handleComplete} disabled={actionLoading}>
              Mark as Completed
            </Button>
          )}
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
        </div>
      </div>

      {/* Return Information */}
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
                    {returnData.order?.order_number || 'N/A'}
                  </Button>
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Total Amount</Label>
                <p className="font-medium text-lg">${returnData.total_amount.toFixed(2)}</p>
              </div>
              <div className="col-span-2">
                <Label className="text-muted-foreground">Customer</Label>
                <p className="font-medium">
                  {returnData.customer?.name || 'Walk-in Customer'}
                </p>
                {returnData.customer?.phone && (
                  <p className="text-sm text-muted-foreground">{returnData.customer.phone}</p>
                )}
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
            <div>
              <Label className="text-muted-foreground">Refund Method</Label>
              <p className="font-medium">{getRefundMethodLabel(returnData.refund_method)}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Notes</Label>
              <p className="text-sm">{returnData.notes || 'No notes provided'}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Processed By</Label>
              <p className="font-medium">{returnData.cashier?.username || 'N/A'}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Created At</Label>
              <p className="text-sm">
                {new Date(returnData.created_at).toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Returned Items */}
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
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returnData.items && returnData.items.length > 0 ? (
                returnData.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.product?.name || 'Unknown Product'}
                    </TableCell>
                    <TableCell>{item.product?.sku || 'N/A'}</TableCell>
                    <TableCell className="text-center">{item.quantity}</TableCell>
                    <TableCell className="text-right">${item.unit_price.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">
                      ${item.line_total.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No items found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="mt-4 flex justify-end border-t pt-4">
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Total Refund</p>
              <p className="text-2xl font-bold">${returnData.total_amount.toFixed(2)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Inventory Adjustments Info */}
      <Card>
        <CardHeader>
          <CardTitle>Inventory Impact</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            When this return was created, the following inventory adjustments were made:
          </p>
          <ul className="mt-2 space-y-1">
            {returnData.items?.map((item) => (
              <li key={item.id} className="text-sm">
                • <span className="font-medium">{item.product?.name}</span>: 
                Stock increased by <span className="font-medium">{item.quantity}</span> units
              </li>
            ))}
          </ul>
          {canDelete && (
            <p className="mt-4 text-sm text-muted-foreground">
              If you delete this return, these inventory changes will be reversed.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
