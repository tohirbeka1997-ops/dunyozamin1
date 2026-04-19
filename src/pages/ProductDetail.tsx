import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { isElectron, requireElectron, handleIpcResponse } from '@/utils/electron';
import { ArrowLeft, Pencil, Package, AlertTriangle, DollarSign } from 'lucide-react';
import { formatUnit } from '@/utils/formatters';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate, formatDateTime } from '@/lib/datetime';
import { getProductImageDisplayUrl } from '@/lib/productImageUrl';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCategories, getProductImages } from '@/db/api';
import type { Category } from '@/types/database';

interface ProductDetailData {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  sale_price: number;
  purchase_price: number;
  cost_price: number;
  min_stock_level: number;
  max_stock_level: number | null;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  is_active: boolean;
  track_stock: boolean;
  current_stock: number;
  stock_available: number;
  available_stock: number;
  stock_quantity: number;
  stock_value: number;
  movements: any[];
  purchase_history: any[];
  sales_history: any[];
  image_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

type ProductDetailProps = {
  productId?: string | null;
  onClose?: () => void;
};

export function ProductDetailContent({ productId, onClose }: ProductDetailProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [productDetail, setProductDetail] = useState<ProductDetailData | null>(null);
  const [productImages, setProductImages] = useState<Array<{ id: string; url: string; sort_order: number; is_primary: number }>>([]);
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const handleClose = onClose || (() => navigate('/products'));

  useEffect(() => {
    if (productId) {
      loadData(productId);
    }
  }, [productId]);

  useEffect(() => {
    // Load categories to reliably show category name in detail view.
    // This is a fallback when category_name is missing in the backend response.
    const loadCategories = async () => {
      try {
        const data = await getCategories();
        setCategories(Array.isArray(data) ? data : []);
      } catch {
        setCategories([]);
      }
    };
    loadCategories();
  }, []);

  const loadData = async (id: string) => {
    if (!id) return;
    
    try {
      setLoading(true);
      console.log('[ProductDetail] Loading product detail for ID:', id);
      
      if (isElectron()) {
        const api = requireElectron();
        const data = await handleIpcResponse(
          api.inventory.getProductDetail(id)
        ) as ProductDetailData;
        
        console.log('[ProductDetail] Product detail loaded:', {
          id: data.id,
          name: data.name,
          current_stock: data.current_stock,
          stock_value: data.stock_value,
          purchase_price: data.purchase_price,
          movements_count: data.movements?.length || 0,
        });
        
        setProductDetail(data);
        try {
          const imgs = await getProductImages(id);
          setProductImages(imgs);
          setSelectedImageIdx(0);
        } catch {
          setProductImages((data as any).image_url ? [{ id: 'legacy', url: (data as any).image_url, sort_order: 0, is_primary: 1 }] : []);
        }
      } else {
        throw new Error('Ushbu dastur Electron (desktop) rejimida ishlaydi.');
      }
    } catch (error) {
      console.error('[ProductDetail] Error loading product detail:', error);
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('products.detail.failed_to_load'),
        variant: 'destructive',
      });
      handleClose();
    } finally {
      setLoading(false);
    }
  };

  if (loading || !productDetail) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  // Calculate profit margin
  const margin = productDetail.purchase_price > 0
    ? (((productDetail.sale_price - productDetail.purchase_price) / productDetail.purchase_price) * 100).toFixed(2)
    : '0.00';

  // Get stock status based on real-time stock from backend
  const getStockStatus = () => {
    if (productDetail.current_stock <= 0) {
      return { label: t('products.detail.out_of_stock'), color: 'bg-destructive text-destructive-foreground' };
    }
    if (productDetail.current_stock <= productDetail.min_stock_level) {
      return { label: t('products.detail.low_stock'), color: 'bg-warning text-warning-foreground' };
    }
    return { label: t('products.detail.in_stock'), color: 'bg-success text-success-foreground' };
  };

  const stockStatus = getStockStatus();
  const categoryName =
    productDetail.category_name ||
    categories.find((c) => c.id === productDetail.category_id)?.name ||
    '';
  
  // Calculate totals from movements (for summary tab) - using backend data
  const totalIn = (productDetail.movements || [])
    .filter((m: any) => (m.quantity || 0) > 0)
    .reduce((sum: number, m: any) => sum + (m.quantity || 0), 0);
  const totalOut = Math.abs(
    (productDetail.movements || [])
      .filter((m: any) => (m.quantity || 0) < 0)
      .reduce((sum: number, m: any) => sum + (m.quantity || 0), 0)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{t('products.detail.title')}</h1>
            <p className="text-muted-foreground">{t('products.detail.subtitle')}</p>
          </div>
        </div>
        <Button onClick={() => productId && navigate(`/products/${productId}/edit`)}>
          <Pencil className="h-4 w-4 mr-2" />
          {t('products.detail.edit_product')}
        </Button>
      </div>

      {/* Online market layout: image left, details right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Image gallery — online market style */}
        <Card className="lg:col-span-5">
          <CardContent className="p-4 sm:p-6">
            <div className="aspect-square w-full bg-muted rounded-lg overflow-hidden flex items-center justify-center">
              {productImages.length > 0 ? (
                <img
                  src={getProductImageDisplayUrl(productImages[selectedImageIdx]?.url) || productImages[selectedImageIdx]?.url}
                  alt={productDetail.name}
                  className="w-full h-full object-contain"
                />
              ) : (productDetail as any).image_url ? (
                <img
                  src={getProductImageDisplayUrl((productDetail as any).image_url) || (productDetail as any).image_url}
                  alt={productDetail.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <Package className="h-24 w-24 text-muted-foreground" />
              )}
            </div>
            {productImages.length > 1 && (
              <div className="flex gap-2 mt-3 justify-center flex-wrap">
                {productImages.map((img, idx) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setSelectedImageIdx(idx)}
                    className={`h-14 w-14 rounded-lg border-2 overflow-hidden flex-shrink-0 transition-all ${selectedImageIdx === idx ? 'ring-2 ring-primary border-primary' : 'border-muted hover:border-muted-foreground/50'}`}
                  >
                    <img src={getProductImageDisplayUrl(img.url) || img.url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Product info — online market style */}
        <div className="lg:col-span-7 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('products.detail.product_information')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">{productDetail.name}</h2>
                {productDetail.description && (
                  <p className="text-muted-foreground mt-1">{productDetail.description}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  <Badge variant={productDetail.is_active ? 'default' : 'secondary'}>
                    {productDetail.is_active ? t('products.detail.active') : t('products.detail.inactive')}
                  </Badge>
                  <Badge className={stockStatus.color} variant="secondary">
                    {stockStatus.label}
                  </Badge>
                  {categoryName && (
                    <Badge variant="outline">{categoryName}</Badge>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
              <div>
                <p className="text-sm text-muted-foreground">{t('products.sku')}</p>
                <p className="font-mono font-medium">{productDetail.sku}</p>
              </div>
              {productDetail.barcode && (
                <div>
                  <p className="text-sm text-muted-foreground">{t('products.barcode')}</p>
                  <p className="font-mono font-medium">{productDetail.barcode}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">{t('products.unit')}</p>
                <p className="font-medium">{formatUnit(productDetail.unit)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('products.min_stock_level')}</p>
                <p className="font-medium">{productDetail.min_stock_level} {formatUnit(productDetail.unit)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('products.detail.current_stock')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <div className="text-4xl font-bold">{productDetail.current_stock.toFixed(2)}</div>
                <div className="text-muted-foreground">{formatUnit(productDetail.unit)}</div>
                {productDetail.current_stock <= productDetail.min_stock_level && productDetail.current_stock > 0 && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-warning">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm">{t('products.detail.low_stock_alert')}</span>
                  </div>
                )}
                {productDetail.current_stock <= 0 && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm">{t('products.detail.out_of_stock')}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('products.pricing')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">{t('products.purchase_price')}</p>
                <p className="text-xl font-bold">{formatMoneyUZS(productDetail.purchase_price)}</p>
                {productDetail.purchase_price > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('products.detail.latest_purchase_price')}
                  </p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('products.sale_price')}</p>
                <p className="text-xl font-bold">{formatMoneyUZS(productDetail.sale_price)}</p>
              </div>
              <div className="pt-4 border-t">
                <p className="text-sm text-muted-foreground">{t('products.detail.profit_margin')}</p>
                <p className="text-2xl font-bold text-success">{margin}%</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                {t('products.detail.stock_value')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <div className="text-3xl font-bold">{formatMoneyUZS(productDetail.stock_value || 0)}</div>
                <p className="text-sm text-muted-foreground mt-2">
                  {productDetail.current_stock.toFixed(2)} {formatUnit(productDetail.unit)} × {formatMoneyUZS(productDetail.purchase_price)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      </div>

      <Card className="w-full min-w-0">
        <Tabs defaultValue="movements" className="w-full min-w-0">
          <CardHeader>
            <TabsList>
              <TabsTrigger value="movements">{t('products.detail.inventory_movements')}</TabsTrigger>
              <TabsTrigger value="summary">{t('products.detail.stock_summary')}</TabsTrigger>
              <TabsTrigger value="sales">{t('products.detail.sales_history')}</TabsTrigger>
              <TabsTrigger value="purchases">{t('products.detail.purchase_history')}</TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent>
            <TabsContent value="movements" className="mt-0 min-w-0">
              {productDetail.movements && productDetail.movements.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('products.detail.date')}</TableHead>
                        <TableHead>{t('products.detail.type')}</TableHead>
                        <TableHead>{t('products.detail.quantity')}</TableHead>
                        <TableHead>{t('products.detail.reason')}</TableHead>
                        <TableHead>{t('products.detail.warehouse')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {productDetail.movements.map((movement: any) => (
                        <TableRow key={movement.id}>
                          <TableCell>
                            {movement.created_at 
                              ? formatDateTime(movement.created_at)
                              : '-'}
                          </TableCell>
                          <TableCell className="max-w-[140px] truncate" title={movement.movement_type || movement.reason || ''}>
                            {movement.movement_type || movement.reason || '—'}
                          </TableCell>
                          <TableCell className="font-mono whitespace-nowrap">
                            <span className={movement.quantity > 0 ? 'text-success' : 'text-destructive'}>
                              {movement.quantity > 0 ? '+' : ''}
                              {movement.quantity}
                            </span>{' '}
                            {formatUnit(productDetail.unit)}
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate" title={movement.reason || ''}>
                            {movement.reason || '—'}
                          </TableCell>
                          <TableCell>{movement.warehouse_name || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t('products.detail.no_movements')}
                </div>
              )}
            </TabsContent>

            <TabsContent value="summary" className="mt-0 min-w-0">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {t('products.detail.summary_total_in')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-success tabular-nums">
                      +{totalIn.toFixed(2)} {formatUnit(productDetail.unit)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {t('products.detail.summary_total_out')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-destructive tabular-nums">
                      -{totalOut.toFixed(2)} {formatUnit(productDetail.unit)}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {t('products.detail.summary_current_stock')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold tabular-nums">
                      {productDetail.current_stock.toFixed(2)} {formatUnit(productDetail.unit)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {t('products.detail.summary_from_movements')}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="sales" className="mt-0 min-w-0">
              {productDetail.sales_history && productDetail.sales_history.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('products.detail.date')}</TableHead>
                        <TableHead>{t('products.detail.order_number')}</TableHead>
                        <TableHead>{t('products.detail.quantity')}</TableHead>
                        <TableHead>{t('products.detail.unit_price')}</TableHead>
                        <TableHead>{t('products.detail.customer')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {productDetail.sales_history.map((sale: any) => (
                        <TableRow key={sale.id}>
                          <TableCell>
                            {sale.order?.created_at 
                              ? formatDate(sale.order.created_at)
                              : '-'}
                          </TableCell>
                          <TableCell className="font-mono">{sale.order?.order_number || '-'}</TableCell>
                          <TableCell>{sale.quantity} {formatUnit(productDetail.unit)}</TableCell>
                          <TableCell>{formatMoneyUZS(sale.unit_price)}</TableCell>
                          <TableCell>{sale.order?.customer?.name || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t('products.detail.sales_history_placeholder')}
                </div>
              )}
            </TabsContent>

            <TabsContent value="purchases" className="mt-0 min-w-0">
              {productDetail.purchase_history && productDetail.purchase_history.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('products.detail.date')}</TableHead>
                        <TableHead>{t('products.detail.po_number')}</TableHead>
                        <TableHead>{t('products.detail.quantity')}</TableHead>
                        <TableHead>{t('products.detail.unit_cost')}</TableHead>
                        <TableHead>{t('products.detail.supplier')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {productDetail.purchase_history.map((purchase: any) => (
                        <TableRow key={purchase.id}>
                          <TableCell>
                            {purchase.purchase_order?.created_at 
                              ? formatDate(purchase.purchase_order.created_at)
                              : '-'}
                          </TableCell>
                          <TableCell className="font-mono">{purchase.purchase_order?.po_number || '-'}</TableCell>
                          <TableCell>{purchase.received_qty || purchase.quantity} {formatUnit(productDetail.unit)}</TableCell>
                          <TableCell>{formatMoneyUZS(purchase.unit_cost)}</TableCell>
                          <TableCell>{purchase.purchase_order?.supplier?.name || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t('products.detail.purchase_history_placeholder')}
                </div>
              )}
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  );
}

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  return <ProductDetailContent productId={id} onClose={() => navigate('/products')} />;
}
