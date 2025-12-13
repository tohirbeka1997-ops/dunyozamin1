import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
import { formatMoneyUZS } from '@/lib/format';

export default function EditReturn() {
  const { t } = useTranslation();
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
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('sales_returns.create.failed_to_load_order_details'),
        variant: 'destructive',
      });
      navigate('/returns');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!id) return;
    
    // Validation
    if (!reason || reason.trim() === '') {
      toast({
        title: t('sales_returns.create.reason_required_title'),
        description: t('sales_returns.create.reason_required'),
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
        title: t('common.success'),
        description: t('toast.operation_failed'), // TODO: Add proper success message
      });
      
      navigate(`/returns/${id}`);
    } catch (error) {
      console.error('Error updating return:', error);
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('toast.operation_failed'),
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
      title: t('common.error'),
      description: t('sales_returns.cannot_edit_completed', { defaultValue: 'Yakunlangan qaytarishlarni tahrirlab bo\'lmaydi' }),
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
            <h1 className="text-2xl font-bold">{t('navigation.edit_return')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('sales_returns.return_number')} #{returnData.return_number}
            </p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>

      {/* Return Information (Read-only) */}
      <Card>
        <CardHeader>
          <CardTitle>{t('sales_returns.create.order_information')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground">{t('sales_returns.create.order_number')}</Label>
              <p className="font-medium">{returnData.order?.order_number || t('common.no_data')}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">{t('sales_returns.create.customer')}</Label>
              <p className="font-medium">{returnData.customer?.name || t('pos.walk_in_customer')}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">{t('sales_returns.create.total_amount')}</Label>
              <p className="font-medium">{formatMoneyUZS(returnData.total_amount)}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">{t('common.status')}</Label>
              <p className="font-medium">{returnData.status}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Returned Items (Read-only) */}
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
                <TableHead className="text-center">{t('common.quantity')}</TableHead>
                <TableHead className="text-right">{t('sales_returns.create.table.unit_price')}</TableHead>
                <TableHead className="text-right">{t('common.total')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returnData.items?.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    {item.product?.name || t('products.no_products_found')}
                  </TableCell>
                  <TableCell>{item.product?.sku || t('common.no_data')}</TableCell>
                  <TableCell className="text-center">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatMoneyUZS(item.unit_price)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatMoneyUZS(item.line_total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 flex justify-end">
            <div className="text-right">
              <p className="text-sm text-muted-foreground">{t('sales_returns.create.total_refund')}</p>
              <p className="text-2xl font-bold">{formatMoneyUZS(returnData.total_amount)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Editable Fields */}
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
            <Label htmlFor="notes">{t('sales_returns.create.notes_optional')}</Label>
            <Textarea
              id="notes"
              placeholder={t('sales_returns.create.notes_placeholder')}
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
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSave} disabled={saving || !reason}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
