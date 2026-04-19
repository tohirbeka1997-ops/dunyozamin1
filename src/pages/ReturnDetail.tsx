import { useEffect, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
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
import { formatMoneyUZS } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/datetime';
import { createBackNavigationState, navigateBackTo, resolveBackTarget } from '@/lib/pageState';

export default function ReturnDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [returnData, setReturnData] = useState<SalesReturnWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const backTo = resolveBackTarget(location, '/sales-returns');

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
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Qaytarish tafsilotlarini yuklab bo‘lmadi',
        variant: 'destructive',
      });
      navigate(backTo);
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
        title: 'Muvaffaqiyatli',
        description: 'Qaytarish yakunlangan deb belgilandi',
      });
      loadReturnData();
    } catch (error) {
      console.error('Error completing return:', error);
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Qaytarishni yakunlab bo‘lmadi',
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
        title: 'Muvaffaqiyatli',
        description: 'Qaytarish o‘chirildi. Ombordagi o‘zgarishlar bekor qilindi.',
      });
      navigate(backTo);
    } catch (error) {
      console.error('Error deleting return:', error);
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Qaytarishni o‘chirib bo‘lmadi',
        variant: 'destructive',
      });
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Completed':
        return <Badge className="bg-success text-success-foreground">Yakunlangan</Badge>;
      case 'Pending':
        return <Badge className="bg-primary text-primary-foreground">Kutilmoqda</Badge>;
      case 'Cancelled':
        return <Badge variant="destructive">Bekor qilingan</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getReasonLabel = (reason: string) => {
    const reasons: Record<string, string> = {
      damaged: 'Shikastlangan mahsulot',
      incorrect: 'Noto‘g‘ri mahsulot',
      defective: 'Nuqsonli mahsulot',
      dissatisfaction: 'Mijoz rozi emas',
      expired: 'Muddati o‘tgan',
      other: 'Boshqa',
    };
    return reasons[reason] || reason;
  };

  const getRefundMethodLabel = (method: string) => {
    const methods: Record<string, string> = {
      cash: 'Naqd',
      card: 'Karta',
      credit: 'Mijoz hisobiga',
      customer_account: 'Mijoz hisobiga',
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
        <p className="text-muted-foreground">Qaytarish topilmadi</p>
        <Button className="mt-4" onClick={() => navigate(backTo)}>
          Qaytarishlar ro‘yxatiga qaytish
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
          <Button variant="outline" size="icon" onClick={() => navigateBackTo(navigate, location, '/sales-returns')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Qaytarish tafsilotlari</h1>
            <p className="text-sm text-muted-foreground">{returnData.return_number}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              variant="outline"
              onClick={() =>
                navigate(`/returns/${id}/edit`, {
                  state: createBackNavigationState(location),
                })
              }
            >
              <Edit className="h-4 w-4 mr-2" />
              Tahrirlash
            </Button>
          )}
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={actionLoading}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  O‘chirish
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Qaytarishni o‘chirasizmi?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Bu qaytarishni butunlay o‘chiradi va ombordagi barcha o‘zgarishlarni bekor qiladi.
                    Bu amalni ortga qaytarib bo‘lmaydi.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Bekor qilish</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                    O‘chirish
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {returnData.status === 'Pending' && (
            <Button onClick={handleComplete} disabled={actionLoading}>
              Yakunlash
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              toast({
                title: 'Chop etish',
                description: 'Chop etish funksiyasi tez orada qo‘shiladi',
              });
            }}
          >
            <Printer className="h-4 w-4 mr-2" />
            Chop etish
          </Button>
        </div>
      </div>

      {/* Return Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Qaytarish ma’lumotlari</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Qaytarish raqami</Label>
                <p className="font-medium">{returnData.return_number}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Holati</Label>
                <div className="mt-1">{getStatusBadge(returnData.status)}</div>
              </div>
              <div>
                <Label className="text-muted-foreground">Manba</Label>
                <p className="font-medium">
                  {returnData.return_mode === 'manual' ? 'Ordersiz qaytarish' : 'Buyurtma bo‘yicha qaytarish'}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Buyurtma raqami</Label>
                <p className="font-medium">
                  {returnData.order_id ? (
                    <Button
                      variant="link"
                      className="p-0 h-auto font-medium"
                      onClick={() => navigate(`/orders/${returnData.order_id}`)}
                    >
                      {returnData.order?.order_number || returnData.order_id}
                    </Button>
                  ) : (
                    'Ordersiz'
                  )}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Jami summa</Label>
                <p className="font-medium text-lg">{formatMoneyUZS(returnData.total_amount)}</p>
              </div>
              <div className="col-span-2">
                <Label className="text-muted-foreground">Mijoz</Label>
                <p className="font-medium">
                  {returnData.customer?.name || 'Yuruvchi mijoz'}
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
            <CardTitle>Qaytarish tafsilotlari</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Qaytarish sababi</Label>
              <p className="font-medium">{getReasonLabel(returnData.reason)}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Pul qaytarish usuli</Label>
              <p className="font-medium">{getRefundMethodLabel(returnData.refund_method)}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Izoh</Label>
              <p className="text-sm">{returnData.notes || 'Izoh kiritilmagan'}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Qabul qilgan</Label>
              <p className="font-medium">{returnData.cashier?.username || 'N/A'}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Yaratilgan vaqt</Label>
              <p className="text-sm">
                {formatOrderDateTime(returnData.created_at)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Returned Items */}
      <Card>
        <CardHeader>
          <CardTitle>Qaytarilgan mahsulotlar</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mahsulot</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-center">Miqdori</TableHead>
                <TableHead className="text-right">Narxi</TableHead>
                <TableHead className="text-right">Jami</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returnData.items && returnData.items.length > 0 ? (
                returnData.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <div>{item.product?.name || item.product_name || 'Noma’lum mahsulot'}</div>
                      {returnData.return_mode === 'manual' && (
                        <div className="text-xs text-muted-foreground">
                          Narx turi: {item.price_source === 'usta' ? 'Usta' : 'Oddiy'}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{item.product?.sku || 'N/A'}</TableCell>
                    <TableCell className="text-center">{item.quantity}</TableCell>
                    <TableCell className="text-right">{formatMoneyUZS(item.unit_price)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoneyUZS(item.line_total)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Mahsulotlar topilmadi
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="mt-4 flex justify-end border-t pt-4">
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Jami qaytarilgan summa</p>
              <p className="text-2xl font-bold">{formatMoneyUZS(returnData.total_amount)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Inventory Adjustments Info */}
      <Card>
        <CardHeader>
          <CardTitle>Omborga ta’siri</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Qaytarish yaratilganda omborda quyidagi o‘zgarishlar qilindi:
          </p>
          <ul className="mt-2 space-y-1">
            {returnData.items?.map((item) => (
              <li key={item.id} className="text-sm">
                • <span className="font-medium">{item.product?.name}</span>: 
                ombordagi qoldiq <span className="font-medium">{item.quantity}</span> ga oshirildi
              </li>
            ))}
          </ul>
          {canDelete && (
            <p className="mt-4 text-sm text-muted-foreground">
              Agar qaytarishni o‘chirsangiz, bu ombor o‘zgarishlari bekor qilinadi.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
