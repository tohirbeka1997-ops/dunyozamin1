import { useState, useEffect } from 'react';
import { useLocation, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
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
import { formatUnit } from '@/utils/formatters';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate, formatDateTime } from '@/lib/datetime';
import { isElectron, requireElectron, handleIpcResponse } from '@/utils/electron';
import { qk } from '@/lib/queryKeys';
import {
  clampQuantityForUnit,
  formatQuantity,
  getQuantityMin,
  getQuantityStep,
  isFractionalUnit,
  normalizeQuantityInput,
} from '@/utils/quantity';
import { navigateBackTo, resolveBackTarget } from '@/lib/pageState';

// Fetch product detail using React Query
const fetchProductDetail = async (productId: string) => {
  if (!productId) {
    throw new Error('Product ID is required');
  }

  console.log('[InventoryDetail] Fetching product detail for:', productId);
  
  if (isElectron()) {
    const api = requireElectron();
    const productData = await handleIpcResponse(
      api.inventory.getProductDetail(productId)
    ) as Product;
    
    console.log('[InventoryDetail] Product detail fetched:', {
      id: productData?.id,
      name: productData?.name,
      current_stock: productData?.current_stock,
      purchase_price: productData?.purchase_price,
      stock_value: productData?.stock_value,
      min_stock_level: productData?.min_stock_level,
    });
    
    return productData;
  }
  
  // Fallback to getProductById if Electron API not available
  console.warn('[InventoryDetail] Electron API not available, using getProductById');
  return await getProductById(productId);
};

// Fetch product batches (partiyalar) using Electron IPC
const fetchProductBatches = async (productId: string) => {
  if (!productId) {
    throw new Error('Product ID is required');
  }
  if (!isElectron()) {
    return [];
  }
  const api = requireElectron();
  const rows = await handleIpcResponse(
    api.inventory.getBatchesByProduct(productId, 'main-warehouse-001')
  );
  return Array.isArray(rows) ? rows : [];
};

// Fetch batch reconciliation (Act Sverka) for this product
const fetchProductBatchReconcile = async (productId: string) => {
  if (!productId) {
    throw new Error('Product ID is required');
  }
  if (!isElectron()) {
    return null;
  }
  const api = requireElectron();
  const rows = await handleIpcResponse(
    api.inventory.getBatchReconcile(productId, 'main-warehouse-001')
  );
  const arr = Array.isArray(rows) ? rows : [];
  return arr.length > 0 ? arr[0] : null;
};

export default function InventoryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const activeTab = searchParams.get('tab') || 'movements';
  const backTo = resolveBackTarget(location, '/inventory');
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState({
    type: 'increase',
    quantity: '',
    reason: '',
    notes: '',
  });

  // Use React Query to fetch product detail with automatic refetch
  const { 
    data: product, 
    isLoading: loading, 
    error: productError,
    refetch: refetchProduct 
  } = useQuery({
    queryKey: ['inventoryDetail', id],
    queryFn: () => fetchProductDetail(id!),
    enabled: !!id,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  // Fetch movements, purchase, and sales history
  const resolvedProductId = product?.id || id;
  
  const { data: movementsData = [] } = useQuery({
    queryKey: ['inventoryMovements', resolvedProductId],
    queryFn: () => getInventoryMovements(resolvedProductId!),
    enabled: !!resolvedProductId,
    retry: 1,
  });

  const { data: purchaseHistoryData = [] } = useQuery({
    queryKey: ['productPurchaseHistory', resolvedProductId],
    queryFn: () => getProductPurchaseHistory(resolvedProductId!),
    enabled: !!resolvedProductId,
    retry: 1,
  });

  const { data: salesHistoryData = [] } = useQuery({
    queryKey: ['productSalesHistory', resolvedProductId],
    queryFn: () => getProductSalesHistory(resolvedProductId!),
    enabled: !!resolvedProductId,
    retry: 1,
  });

  const { data: batchesData = [] } = useQuery({
    queryKey: ['productBatches', resolvedProductId],
    queryFn: () => fetchProductBatches(resolvedProductId!),
    enabled: !!resolvedProductId && isElectron(),
    retry: 1,
  });

  const { data: batchReconcile } = useQuery({
    queryKey: ['productBatchReconcile', resolvedProductId],
    queryFn: () => fetchProductBatchReconcile(resolvedProductId!),
    enabled: !!resolvedProductId && isElectron(),
    retry: 1,
  });

  // Stock adjustment mutation
  const adjustmentMutation = useMutation({
    mutationFn: async (adjustment: {
      product_id: string;
      quantity: number;
      reason: string;
      notes?: string;
    }) => {
      return await createStockAdjustment(adjustment);
    },
    onSuccess: () => {
      console.log('[InventoryDetail] Stock adjustment successful, invalidating queries...');
      
      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ['inventoryDetail', id] });
      queryClient.invalidateQueries({ queryKey: ['inventoryMovements', resolvedProductId] });
      queryClient.invalidateQueries({ queryKey: ['productPurchaseHistory', resolvedProductId] });
      queryClient.invalidateQueries({ queryKey: ['productSalesHistory', resolvedProductId] });
      queryClient.invalidateQueries({ queryKey: ['productBatches', resolvedProductId] });
      
      // Also invalidate inventory list and products list
      queryClient.invalidateQueries({ queryKey: qk.products, exact: false });
      queryClient.invalidateQueries({ queryKey: qk.inventory, exact: false });
      queryClient.invalidateQueries({ queryKey: qk.stock, exact: false });
      
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
    },
    onError: (error) => {
      console.error('[InventoryDetail] Stock adjustment error:', error);
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Qoldiqni to\'g\'rilab bo\'lmadi',
        variant: 'destructive',
      });
    },
  });

  // Handle errors
  useEffect(() => {
    if (productError) {
      console.error('[InventoryDetail] Error loading product:', productError);
      toast({
        title: 'Xatolik',
        description: productError instanceof Error ? productError.message : 'Ombor tafsilotlarini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    }
  }, [productError, toast]);

  // Navigate back if no ID
  useEffect(() => {
    if (!id) {
      console.error('[InventoryDetail] No product ID provided');
      toast({
        title: 'Xatolik',
        description: 'Mahsulot ID topilmadi',
        variant: 'destructive',
      });
      navigate(backTo);
    }
  }, [id, navigate, toast, backTo]);

  const handleAdjustment = async () => {
    if (!id || !adjustmentForm.quantity || !adjustmentForm.reason) {
      toast({
        title: 'Xatolik',
        description: 'Iltimos, barcha majburiy maydonlarni to\'ldiring',
        variant: 'destructive',
      });
      return;
    }

    const normalized = normalizeQuantityInput(adjustmentForm.quantity);
    const qtyRaw = Number(normalized);
    if (!Number.isFinite(qtyRaw) || qtyRaw <= 0) {
      toast({
        title: 'Xatolik',
        description: 'Miqdor musbat son bo\'lishi kerak',
        variant: 'destructive',
      });
      return;
    }

    const unit = product?.unit;
    const qty = clampQuantityForUnit(qtyRaw, unit);
    if (qty !== qtyRaw) {
      toast({
        title: 'Miqdor tuzatildi',
        description: `Miqdor ${formatQuantity(qty, unit)} ga o'rnatildi`,
      });
    }

    const quantity = adjustmentForm.type === 'increase' 
      ? qty 
      : -qty;

    adjustmentMutation.mutate({
      product_id: id,
      quantity,
      reason: adjustmentForm.reason,
      notes: adjustmentForm.notes || undefined,
    });
  };

  const getStockStatusBadge = () => {
    if (!product) return null;
    
    // CRITICAL: Use real-time stock from backend (same as Inventory list)
    // Ensure safe defaults (no NaN)
    const stock = Number(product.current_stock ?? product.stock_available ?? product.available_stock ?? 0) || 0;
    const minStock = Number(product.min_stock_level || 0) || 0;

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
          <Button onClick={() => navigate(backTo)} className="mt-4">
            Omborga qaytish
          </Button>
        </div>
      </div>
    );
  }

  // CRITICAL: Use real-time stock from backend (same as Inventory list)
  // Ensure all values are numbers with safe defaults (no NaN)
  const currentStock = Number(product.current_stock ?? product.stock_available ?? product.available_stock ?? 0) || 0;
  const purchasePrice = Number(product.purchase_price || 0) || 0;
  const salePrice = Number(product.sale_price || 0) || 0;
  const minStockLevel = Number(product.min_stock_level || 0) || 0;
  const quantityMin = getQuantityMin(product.unit);
  const quantityStep = getQuantityStep(product.unit);
  const quantityInputMode = isFractionalUnit(product.unit) ? 'decimal' : 'numeric';
  // Use stock_value from backend if available, otherwise calculate
  const inventoryValue = Number(product.stock_value ?? (currentStock * purchasePrice)) || 0;
  
  // Use data from React Query
  const movements = Array.isArray(movementsData) ? movementsData : [];
  const purchaseHistory = Array.isArray(purchaseHistoryData) ? purchaseHistoryData : [];
  const salesHistory = Array.isArray(salesHistoryData) ? salesHistoryData : [];
  const batches = Array.isArray(batchesData) ? batchesData : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigateBackTo(navigate, location, '/inventory')}>
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
                  min={quantityMin.toString()}
                  step={quantityStep.toString()}
                  inputMode={quantityInputMode}
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
                <p className="text-2xl font-bold">{Number(currentStock).toFixed(2)}</p>
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
                <p className="text-2xl font-bold">{minStockLevel.toFixed(2)}</p>
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
                <p className="text-2xl font-bold">{formatMoneyUZS(purchasePrice)}</p>
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
                <p className="text-2xl font-bold">{formatMoneyUZS(inventoryValue || 0)}</p>
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
              <p className="font-medium">{formatMoneyUZS(salePrice)}</p>
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

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value === 'movements') next.delete('tab');
          else next.set('tab', value);
          setSearchParams(next, { replace: true });
        }}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="batches">Partiyalar</TabsTrigger>
          <TabsTrigger value="movements">Qoldiq tarixi</TabsTrigger>
          <TabsTrigger value="purchases">Sotib olish tarixi</TabsTrigger>
          <TabsTrigger value="sales">Sotish tarixi</TabsTrigger>
        </TabsList>

        <TabsContent value="batches">
          <Card>
            <CardHeader>
              <CardTitle>Partiyalar (FIFO)</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const stockFromMovements = Number(
                  batchReconcile?.stock_from_movements ?? product?.current_stock ?? 0
                );
                const stockFromBatches = Number(
                  batchReconcile?.stock_from_batches ??
                    batches.reduce((s: number, b: any) => s + Number(b.remaining_qty || 0), 0)
                );
                const difference = Number(batchReconcile?.difference ?? stockFromMovements - stockFromBatches);

                const totalQty = batches.reduce((s: number, b: any) => s + Number(b.remaining_qty || 0), 0);
                const totalValue = batches.reduce(
                  (s: number, b: any) => s + Number(b.remaining_qty || 0) * Number(b.unit_cost || 0),
                  0
                );

                return (
                  <>
                    {/* Act Sverka summary should be visible even when there are no batches */}
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <div className="text-sm text-muted-foreground">
                        Act sverka:{' '}
                        <span className="font-medium text-foreground">
                          movements {stockFromMovements.toFixed(2)}
                        </span>
                        {' • '}
                        <span className="font-medium text-foreground">
                          batches {stockFromBatches.toFixed(2)}
                        </span>
                        {' • '}
                        <span className="font-medium text-foreground">
                          farq {difference.toFixed(2)}
                        </span>
                        {' '}
                        {Math.abs(difference) < 0.0001 ? (
                          <Badge variant="default" className="ml-2">OK</Badge>
                        ) : (
                          <Badge variant="destructive" className="ml-2">FARQ</Badge>
                        )}
                      </div>

                      <div className="text-sm text-muted-foreground">
                        Jami qoldiq:{' '}
                        <span className="font-medium text-foreground">{totalQty.toFixed(2)}</span>
                      </div>

                      <div className="text-sm text-muted-foreground">
                        Jami qiymat:{' '}
                        <span className="font-medium text-foreground">{formatMoneyUZS(totalValue)}</span>
                      </div>
                    </div>

                    {batches.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-muted-foreground">Partiyalar topilmadi</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Ehtimol batch (partiya) rejimi o‘chiq yoki bu mahsulotga hali kirim partiyasi yaratilmagan.
                        </p>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Sana</TableHead>
                            <TableHead>Hujjat</TableHead>
                            <TableHead>Ta'minotchi</TableHead>
                            <TableHead className="text-right">Kirim</TableHead>
                            <TableHead className="text-right">Qoldiq</TableHead>
                            <TableHead className="text-right">Narx (cost)</TableHead>
                            <TableHead>Valyuta</TableHead>
                            <TableHead className="text-right">Kurs</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {batches.map((b: any) => (
                            <TableRow key={b.id}>
                              <TableCell>{b.opened_at ? formatDateTime(b.opened_at) : '-'}</TableCell>
                              <TableCell>{b.doc_no || '-'}</TableCell>
                              <TableCell>{b.supplier_name || '-'}</TableCell>
                              <TableCell className="text-right">{Number(b.initial_qty || 0).toFixed(2)}</TableCell>
                              <TableCell className="text-right font-medium">{Number(b.remaining_qty || 0).toFixed(2)}</TableCell>
                              <TableCell className="text-right">{formatMoneyUZS(Number(b.unit_cost || 0) || 0)}</TableCell>
                              <TableCell>{b.currency || '-'}</TableCell>
                              <TableCell className="text-right">
                                {b.exchange_rate != null ? Number(b.exchange_rate || 0).toFixed(2) : '-'}
                              </TableCell>
                              <TableCell>
                                <Badge variant={b.status === 'closed' ? 'secondary' : 'default'}>
                                  {b.status || 'active'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

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
                          {formatDateTime(movement.created_at)}
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
                            ? formatDate(item.purchase_order.created_at)
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
                      const cost = Number(item.quantity) * purchasePrice;
                      const profit = revenue - cost;
                      
                      return (
                        <TableRow key={item.id}>
                          <TableCell>{item.order?.order_number || '-'}</TableCell>
                          <TableCell>{item.order?.customer?.name || '-'}</TableCell>
                          <TableCell>
                            {item.order?.created_at 
                              ? formatDate(item.order.created_at)
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
