import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
  getProductById,
  getInventoryMovements,
  getProductPurchaseHistory,
  getProductSalesHistory,
  createStockAdjustment,
} from '@/db/api';
import type { Product, InventoryMovementWithDetails } from '@/types/database';
import { ArrowLeft, Package, TrendingUp, TrendingDown, Edit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { formatUnit } from '@/utils/formatters';
import { formatMoneyUZS } from '@/lib/format';

export default function InventoryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [product, setProduct] = useState<Product | null>(null);
  const [movements, setMovements] = useState<InventoryMovementWithDetails[]>([]);
  const [purchaseHistory, setPurchaseHistory] = useState<any[]>([]);
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState({
    type: 'increase',
    quantity: '',
    reason: '',
    notes: '',
  });

  useEffect(() => {
    if (id) {
      loadData();
    }
  }, [id]);

  const loadData = async () => {
    if (!id) return;
    
    try {
      setLoading(true);
      const [productData, movementsData, purchaseData, salesData] = await Promise.all([
        getProductById(id),
        getInventoryMovements(id),
        getProductPurchaseHistory(id),
        getProductSalesHistory(id),
      ]);
      
      setProduct(productData);
      setMovements(movementsData);
      setPurchaseHistory(purchaseData);
      setSalesHistory(salesData);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Ombor tafsilotlarini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAdjustment = async () => {
    if (!id || !adjustmentForm.quantity || !adjustmentForm.reason) {
      toast({
        title: 'Xatolik',
        description: 'Iltimos, barcha majburiy maydonlarni to\'ldiring',
        variant: 'destructive',
      });
      return;
    }

    try {
      const quantity = adjustmentForm.type === 'increase' 
        ? Number(adjustmentForm.quantity) 
        : -Number(adjustmentForm.quantity);

      await createStockAdjustment({
        product_id: id,
        quantity,
        reason: adjustmentForm.reason,
        notes: adjustmentForm.notes || undefined,
      });

      toast({
        title: 'Muvaffaqiyatli',
        description: 'Qoldiq muvaffaqiyatli to\'g\'rilandi',
      });

      setAdjustmentOpen(false);
      setAdjustmentForm({
        type: 'increase',
        quantity: '',
        reason: '',
        notes: '',
      });
      loadData();
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Qoldiqni to\'g\'rilab bo\'lmadi',
        variant: 'destructive',
      });
    }
  };

  const getStockStatusBadge = () => {
    if (!product) return null;
    
    const stock = Number(product.current_stock);
    const minStock = Number(product.min_stock_level);

    if (stock === 0) {
      return <Badge variant="destructive">Omborda yo'q</Badge>;
    } else if (stock <= minStock) {
      return <Badge className="bg-warning text-warning-foreground">Qoldiq kam</Badge>;
    } else {
      return <Badge className="bg-success text-success-foreground">Omborda bor</Badge>;
    }
  };

  const getMovementTypeBadge = (type: string) => {
    const types: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      purchase: { label: 'Sotib olish', variant: 'default' },
      sale: { label: 'Sotish', variant: 'secondary' },
      return: { label: 'Qaytarish', variant: 'outline' },
      adjustment: { label: 'To\'g\'rilash', variant: 'outline' },
      audit: { label: 'Audit', variant: 'outline' },
    };
    
    const config = types[type] || { label: type, variant: 'outline' };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const formatMovementQuantity = (quantity: number) => {
    const num = Number(quantity);
    if (num > 0) {
      return <span className="text-success font-medium">+{num}</span>;
    } else {
      return <span className="text-destructive font-medium">{num}</span>;
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Mahsulot topilmadi</p>
          <Button onClick={() => navigate('/inventory')} className="mt-4">
            Omborga qaytish
          </Button>
        </div>
      </div>
    );
  }

  const inventoryValue = Number(product.current_stock) * Number(product.purchase_price);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/inventory')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{product.name}</h1>
            <p className="text-muted-foreground">SKU: {product.sku}</p>
          </div>
        </div>
        <Dialog open={adjustmentOpen} onOpenChange={setAdjustmentOpen}>
          <DialogTrigger asChild>
            <Button>
              <Edit className="h-4 w-4 mr-2" />
              Qoldiqni to'g'rilash
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Qoldiqni to'g'rilash</DialogTitle>
              <DialogDescription>
                {product.name} uchun qoldiqni to'g'rilash
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>To'g'rilash turi</Label>
                <Select
                  value={adjustmentForm.type}
                  onValueChange={(value) => setAdjustmentForm({ ...adjustmentForm, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="increase">Qoldiqni oshirish</SelectItem>
                    <SelectItem value="decrease">Qoldiqni kamaytirish</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Miqdor</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={adjustmentForm.quantity}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, quantity: e.target.value })}
                  placeholder="Miqdorni kiriting"
                />
              </div>
              <div className="space-y-2">
                <Label>Sabab</Label>
                <Select
                  value={adjustmentForm.reason}
                  onValueChange={(value) => setAdjustmentForm({ ...adjustmentForm, reason: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sababni tanlang" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="damaged">Zararlangan</SelectItem>
                    <SelectItem value="lost">Yo'qolgan</SelectItem>
                    <SelectItem value="correction">To'g'rilash</SelectItem>
                    <SelectItem value="audit">Inventarizatsiya farqi</SelectItem>
                    <SelectItem value="other">Boshqa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Izoh (Ixtiyoriy)</Label>
                <Textarea
                  value={adjustmentForm.notes}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, notes: e.target.value })}
                  placeholder="Qo'shimcha izohlar..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdjustmentOpen(false)}>
                Bekor qilish
              </Button>
              <Button onClick={handleAdjustment}>
                Saqlash
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Joriy qoldiq</p>
                <p className="text-2xl font-bold">{Number(product.current_stock).toFixed(2)}</p>
                <p className="text-sm text-muted-foreground">{formatUnit(product.unit)}</p>
              </div>
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Minimal qoldiq</p>
                <p className="text-2xl font-bold">{Number(product.min_stock_level).toFixed(2)}</p>
                <p className="text-sm text-muted-foreground">{formatUnit(product.unit)}</p>
              </div>
              <TrendingDown className="h-8 w-8 text-warning" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Sotib olish narxi</p>
                <p className="text-2xl font-bold">{formatMoneyUZS(product.purchase_price)}</p>
                <p className="text-sm text-muted-foreground">{formatUnit(product.unit)} uchun</p>
              </div>
              <TrendingUp className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Ombordagi qiymat</p>
                <p className="text-2xl font-bold">{formatMoneyUZS(inventoryValue)}</p>
                <div className="mt-1">{getStockStatusBadge()}</div>
              </div>
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mahsulot ma'lumotlari</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">SKU</p>
              <p className="font-medium">{product.sku}</p>
            </div>
            {product.barcode && (
              <div>
                <p className="text-sm text-muted-foreground">Shtrix kod</p>
                <p className="font-medium">{product.barcode}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">Sotish narxi</p>
              <p className="font-medium">{formatMoneyUZS(product.sale_price)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">O'lchov birligi</p>
              <p className="font-medium">{formatUnit(product.unit)}</p>
            </div>
            {product.description && (
              <div className="md:col-span-2">
                <p className="text-sm text-muted-foreground">Tavsif</p>
                <p className="font-medium">{product.description}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="movements" className="space-y-4">
        <TabsList>
          <TabsTrigger value="movements">Qoldiq tarixi</TabsTrigger>
          <TabsTrigger value="purchases">Sotib olish tarixi</TabsTrigger>
          <TabsTrigger value="sales">Sotish tarixi</TabsTrigger>
        </TabsList>

        <TabsContent value="movements">
          <Card>
            <CardHeader>
              <CardTitle>Harakatlar tarixi</CardTitle>
            </CardHeader>
            <CardContent>
              {movements.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">Hozircha qoldiq harakatlari yo'q</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sana va vaqt</TableHead>
                      <TableHead>Turi</TableHead>
                      <TableHead className="text-right">Oldin</TableHead>
                      <TableHead className="text-right">O'zgarish</TableHead>
                      <TableHead className="text-right">Keyin</TableHead>
                      <TableHead>Hujjat raqami</TableHead>
                      <TableHead>Sabab</TableHead>
                      <TableHead>Foydalanuvchi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((movement) => (
                      <TableRow key={movement.id}>
                        <TableCell>
                          {format(new Date(movement.created_at), 'MMM dd, yyyy HH:mm')}
                        </TableCell>
                        <TableCell>{getMovementTypeBadge(movement.movement_type)}</TableCell>
                        <TableCell className="text-right">
                          {Number(movement.before_quantity).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMovementQuantity(movement.quantity)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {Number(movement.after_quantity).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {movement.reference_type && movement.reference_id ? (
                            <span className="text-sm">
                              {movement.reference_type}: {movement.reference_id.slice(0, 8)}
                            </span>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>{movement.reason || '-'}</TableCell>
                        <TableCell>
                          {movement.user?.username || movement.user?.full_name || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchases">
          <Card>
            <CardHeader>
              <CardTitle>Sotib olish tarixi</CardTitle>
            </CardHeader>
            <CardContent>
              {purchaseHistory.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">Sotib olish tarixi yo'q</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Xarid raqami</TableHead>
                      <TableHead>Ta'minotchi</TableHead>
                      <TableHead>Sana</TableHead>
                      <TableHead className="text-right">Miqdor</TableHead>
                      <TableHead className="text-right">Narxi</TableHead>
                      <TableHead className="text-right">Jami</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchaseHistory.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.purchase_order?.po_number || '-'}</TableCell>
                        <TableCell>{item.purchase_order?.supplier?.name || '-'}</TableCell>
                        <TableCell>
                          {item.purchase_order?.created_at 
                            ? format(new Date(item.purchase_order.created_at), 'MMM dd, yyyy')
                            : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(item.quantity).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoneyUZS(item.unit_cost)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoneyUZS(Number(item.quantity) * Number(item.unit_cost))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sales">
          <Card>
            <CardHeader>
              <CardTitle>Sotish tarixi</CardTitle>
            </CardHeader>
            <CardContent>
              {salesHistory.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">Sotish tarixi yo'q</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Buyurtma raqami</TableHead>
                      <TableHead>Mijoz</TableHead>
                      <TableHead>Sana</TableHead>
                      <TableHead className="text-right">Miqdor</TableHead>
                      <TableHead className="text-right">Tushum</TableHead>
                      <TableHead className="text-right">Foyda</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salesHistory.map((item: any) => {
                      const revenue = Number(item.quantity) * Number(item.unit_price);
                      const cost = Number(item.quantity) * Number(product.purchase_price);
                      const profit = revenue - cost;
                      
                      return (
                        <TableRow key={item.id}>
                          <TableCell>{item.order?.order_number || '-'}</TableCell>
                          <TableCell>{item.order?.customer?.name || '-'}</TableCell>
                          <TableCell>
                            {item.order?.created_at 
                              ? format(new Date(item.order.created_at), 'MMM dd, yyyy')
                              : '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            {Number(item.quantity).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMoneyUZS(revenue)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            <span className={profit >= 0 ? 'text-success' : 'text-destructive'}>
                              {formatMoneyUZS(profit)}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
