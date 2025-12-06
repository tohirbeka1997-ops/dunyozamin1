import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { getSalesReturnById, updateSalesReturn } from '@/db/api';
import type { SalesReturnWithDetails } from '@/types/database';
import { ArrowLeft, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';

export default function EditReturn() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [returnData, setReturnData] = useState<SalesReturnWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

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
      setReason(data.reason || '');
      setNotes(data.notes || '');
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

  const handleSave = async () => {
    if (!id) return;
    
    // Validation
    if (!reason || reason.trim() === '') {
      toast({
        title: 'Validation Error',
        description: 'Reason for return is required',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      setSaving(true);
      await updateSalesReturn(id, {
        reason: reason.trim(),
        notes: notes.trim() || null,
      });
      
      toast({
        title: 'Success',
        description: 'Return updated successfully',
      });
      
      navigate(`/sales-returns/${id}`);
    } catch (error) {
      console.error('Error updating return:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update return',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48 bg-muted" />
          <Skeleton className="h-10 w-24 bg-muted" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32 bg-muted" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-20 w-full bg-muted" />
            <Skeleton className="h-20 w-full bg-muted" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!returnData) {
    return null;
  }

  // Check if return can be edited
  const canEdit = returnData.status !== 'Completed';

  if (!canEdit) {
    toast({
      title: 'Cannot Edit',
      description: 'Completed returns cannot be edited',
      variant: 'destructive',
    });
    navigate(`/sales-returns/${id}`);
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate(`/sales-returns/${id}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Edit Return</h1>
            <p className="text-sm text-muted-foreground">
              Return #{returnData.return_number}
            </p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Return Information (Read-only) */}
      <Card>
        <CardHeader>
          <CardTitle>Return Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground">Order Number</Label>
              <p className="font-medium">{returnData.order?.order_number || 'N/A'}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Customer</Label>
              <p className="font-medium">{returnData.customer?.name || 'Walk-in Customer'}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Total Amount</Label>
              <p className="font-medium">${returnData.total_amount.toFixed(2)}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Status</Label>
              <p className="font-medium">{returnData.status}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Returned Items (Read-only) */}
      <Card>
        <CardHeader>
          <CardTitle>Returned Items (Read-only)</CardTitle>
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
              {returnData.items?.map((item) => (
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
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 flex justify-end">
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Total Refund</p>
              <p className="text-2xl font-bold">${returnData.total_amount.toFixed(2)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Editable Fields */}
      <Card>
        <CardHeader>
          <CardTitle>Return Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reason" className="flex items-center gap-1">
              Reason for Return
              <span className="text-destructive">*</span>
            </Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className={!reason ? 'border-destructive' : ''}>
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
            {!reason && (
              <p className="text-sm text-destructive">Please select a reason for the return</p>
            )}
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
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => navigate(`/sales-returns/${id}`)}
        >
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving || !reason}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
