import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
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
import { ArrowLeft, Save, Plus, Minus } from 'lucide-react';
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
  // Editable item quantities
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({});

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
      console.log('[EDIT_RETURN_RAW] Raw data from API:', JSON.stringify(data, null, 2));
      
      console.log('[EditReturn] Loaded return data:', {
        id: data.id,
        return_number: data.return_number,
        items_count: data.items?.length || 0,
        items_sample: data.items?.slice(0, 2).map(item => ({
          id: item.id,
          order_item_id: (item as any).order_item_id,
          quantity: item.quantity,
          sold_quantity: (item as any).sold_quantity,
          original_sold_quantity: (item as any).original_sold_quantity,
          returned_quantity: (item as any).returned_quantity,
          already_returned_quantity: (item as any).already_returned_quantity,
          current_quantity: (item as any).current_quantity,
          max_allowed_quantity: (item as any).max_allowed_quantity,
          all_fields: Object.keys(item),
        })),
      });
      
      setReturnData(data);
      setReason(data.reason || '');
      setNotes(data.notes || '');
      
      // Initialize item quantities from return data
      const initialQuantities: Record<string, number> = {};
      data.items?.forEach(item => {
        if (item.id) {
          initialQuantities[item.id] = item.quantity || 0;
        }
      });
      setItemQuantities(initialQuantities);
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

  // Calculate totals from current item quantities
  const calculatedTotals = useMemo(() => {
    if (!returnData?.items) return { total: 0, isValid: true, errors: [] };
    
    let total = 0;
    const errors: string[] = [];
    let isValid = true;
    
    returnData.items.forEach(item => {
      const quantity = itemQuantities[item.id] || 0;
      const maxAllowed = (item as any).max_allowed_quantity ?? Infinity;
      
      if (quantity < 1) {
        isValid = false;
        errors.push(`${item.product_name || 'Item'}: Quantity must be >= 1`);
      } else if (quantity > maxAllowed) {
        isValid = false;
        errors.push(`${item.product_name || 'Item'}: Quantity ${quantity} exceeds maximum ${maxAllowed}`);
      }
      
      total += quantity * (item.unit_price || 0);
    });
    
    return { total, isValid, errors };
  }, [returnData, itemQuantities]);

  const handleQuantityChange = (itemId: string, newQuantity: number) => {
    const item = returnData?.items?.find(i => i.id === itemId);
    if (!item) return;
    
    const maxAllowed = (item as any).max_allowed_quantity ?? Infinity;
    const clampedQty = Math.max(1, Math.min(newQuantity, maxAllowed));
    
    setItemQuantities(prev => ({
      ...prev,
      [itemId]: clampedQty,
    }));
  };

  const handleQuantityIncrement = (itemId: string) => {
    const currentQty = itemQuantities[itemId] || 0;
    handleQuantityChange(itemId, currentQty + 1);
  };

  const handleQuantityDecrement = (itemId: string) => {
    const currentQty = itemQuantities[itemId] || 0;
    if (currentQty > 1) {
      handleQuantityChange(itemId, currentQty - 1);
    }
  };

  const handleSave = async () => {
    if (!id || !returnData) return;
    
    // Validation
    if (!reason || reason.trim() === '') {
      toast({
        title: t('sales_returns.create.reason_required_title'),
        description: t('sales_returns.create.reason_required'),
        variant: 'destructive',
      });
      return;
    }
    
    if (!calculatedTotals.isValid) {
      toast({
        title: t('common.error'),
        description: calculatedTotals.errors.join(', '),
        variant: 'destructive',
      });
      return;
    }
    
    try {
      setSaving(true);
      
      // Prepare items array for update
      // CRITICAL: Use return_id (UUID) from route params, NOT return_number
      const items = returnData.items?.map(item => ({
        return_item_id: item.id!,
        order_item_id: (item as any).order_item_id || '',
        quantity: itemQuantities[item.id!] || item.quantity || 0,
      })) || [];
      
      console.log('[EditReturn] Saving with:', {
        return_id: id,
        items_count: items.length,
        items: items.map(i => ({ return_item_id: i.return_item_id, quantity: i.quantity })),
      });
      
      await updateSalesReturn(id, {
        reason: reason.trim(),
        notes: notes.trim() || null,
        items,
      });
      
      toast({
        title: t('common.success'),
        description: 'Qaytarish muvaffaqiyatli yangilandi',
      });
      
      // Navigate back to returns list and refresh
      navigate('/returns');
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
              <p className="font-medium">{returnData.order?.order_number || returnData.order_id || t('common.no_data')}</p>
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

      {/* Returned Items (Editable) */}
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
                <TableHead className="text-center">Sotilgan</TableHead>
                <TableHead className="text-center">Qaytarilgan</TableHead>
                <TableHead className="text-center">{t('common.quantity')}</TableHead>
                <TableHead className="text-right">{t('sales_returns.create.table.unit_price')}</TableHead>
                <TableHead className="text-right">{t('common.total')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returnData.items?.map((item) => {
                const quantity = itemQuantities[item.id!] ?? item.quantity ?? 0;
                const maxAllowed = (item as any).max_allowed_quantity ?? Infinity;
                // CRITICAL: Use sold_quantity and returned_quantity from backend (primary field names)
                const soldQty = Number((item as any).sold_quantity ?? 0);
                const returnedQty = Number((item as any).returned_quantity ?? 0);
                const lineTotal = quantity * (item.unit_price || 0);
                const isInvalid = quantity < 1 || quantity > maxAllowed;
                
                console.log('[EDIT_RETURN_ITEMS_MAPPED] Item being rendered:', {
                  item_id: item.id,
                  order_item_id: (item as any).order_item_id,
                  sold_quantity: soldQty,
                  returned_quantity: returnedQty,
                  current_quantity: quantity,
                  max_allowed: maxAllowed,
                  all_keys: Object.keys(item),
                });
                
                // Verify sold_quantity is not 0
                if (soldQty === 0) {
                  console.error('[EditReturn] ⚠️ WARNING: sold_quantity is 0 for item:', {
                    item_id: item.id,
                    order_item_id: (item as any).order_item_id,
                    raw_item: item,
                  });
                }
                
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.product?.name || item.product_name || t('products.no_products_found')}
                    </TableCell>
                    <TableCell>{item.product?.sku || (item as any).product_sku || t('common.no_data')}</TableCell>
                    <TableCell className="text-center font-medium">{soldQty}</TableCell>
                    <TableCell className="text-center font-medium">{returnedQty}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleQuantityDecrement(item.id!)}
                          disabled={quantity <= 1}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <Input
                          type="number"
                          min="0.01"
                          max={maxAllowed}
                          step="0.01"
                          value={quantity}
                          onChange={(e) => {
                            const newQty = parseFloat(String(e.target.value).replace(',', '.')) || 0.01;
                            handleQuantityChange(item.id!, newQty);
                          }}
                          className={`w-20 text-center ${isInvalid ? 'border-destructive' : ''}`}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleQuantityIncrement(item.id!)}
                          disabled={quantity >= maxAllowed}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      {isInvalid && (
                        <p className="text-xs text-destructive mt-1">
                          {quantity < 1 ? 'Min: 1' : `Max: ${maxAllowed}`}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(item.unit_price)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoneyUZS(lineTotal)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="mt-4 flex justify-end">
            <div className="text-right">
              <p className="text-sm text-muted-foreground">{t('sales_returns.create.total_refund')}</p>
              <p className="text-2xl font-bold">{formatMoneyUZS(calculatedTotals.total)}</p>
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
        <Button onClick={handleSave} disabled={saving || !reason || !calculatedTotals.isValid}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
