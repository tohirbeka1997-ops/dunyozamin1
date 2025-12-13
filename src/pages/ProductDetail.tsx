import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { getProductById } from '@/db/api';
import type { ProductWithCategory } from '@/types/database';
import { ArrowLeft, Pencil, Package, AlertTriangle } from 'lucide-react';
import { useInventoryStore } from '@/store/inventoryStore';
import StockMovementsHistory from '@/components/inventory/StockMovementsHistory';
import { formatUnit } from '@/utils/formatters';

export default function ProductDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { getCurrentStockByProductId, getMovementsByProductId } = useInventoryStore();
  const [product, setProduct] = useState<ProductWithCategory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadData();
    }
  }, [id]);

  useEffect(() => {
    // Load inventory from storage on mount
    useInventoryStore.getState().loadFromStorage();
  }, []);

  const loadData = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const productData = await getProductById(id);
      setProduct(productData);
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('products.detail.failed_to_load'),
        variant: 'destructive',
      });
      navigate('/products');
    } finally {
      setLoading(false);
    }
  };

  if (loading || !product) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  const margin = product.purchase_price > 0
    ? (((product.sale_price - product.purchase_price) / product.purchase_price) * 100).toFixed(2)
    : '0.00';

  const getStockStatus = () => {
    if (product.current_stock <= 0) {
      return { label: t('products.detail.out_of_stock'), color: 'bg-destructive text-destructive-foreground' };
    }
    if (product.current_stock <= product.min_stock_level) {
      return { label: t('products.detail.low_stock'), color: 'bg-warning text-warning-foreground' };
    }
    return { label: t('products.detail.in_stock'), color: 'bg-success text-success-foreground' };
  };

  const stockStatus = getStockStatus();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/products')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{t('products.detail.title')}</h1>
            <p className="text-muted-foreground">{t('products.detail.subtitle')}</p>
          </div>
        </div>
        <Button onClick={() => navigate(`/products/${id}/edit`)}>
          <Pencil className="h-4 w-4 mr-2" />
          {t('products.detail.edit_product')}
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{t('products.detail.product_information')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-start gap-6">
              <div className="h-32 w-32 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="h-full w-full object-cover rounded-lg"
                  />
                ) : (
                  <Package className="h-16 w-16 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-4">
                <div>
                  <h2 className="text-2xl font-bold">{product.name}</h2>
                  {product.description && (
                    <p className="text-muted-foreground mt-1">{product.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={product.is_active ? 'default' : 'secondary'}>
                    {product.is_active ? t('products.detail.active') : t('products.detail.inactive')}
                  </Badge>
                  <Badge className={stockStatus.color} variant="secondary">
                    {stockStatus.label}
                  </Badge>
                  {product.category && (
                    <Badge variant="outline">{product.category.name}</Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
              <div>
                <p className="text-sm text-muted-foreground">{t('products.sku')}</p>
                <p className="font-mono font-medium">{product.sku}</p>
              </div>
              {product.barcode && (
                <div>
                  <p className="text-sm text-muted-foreground">{t('products.barcode')}</p>
                  <p className="font-mono font-medium">{product.barcode}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">{t('products.unit')}</p>
                <p className="font-medium">{formatUnit(product.unit)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('products.min_stock_level')}</p>
                <p className="font-medium">{product.min_stock_level} {formatUnit(product.unit)}</p>
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
                <div className="text-4xl font-bold">{product.current_stock}</div>
                <div className="text-muted-foreground">{formatUnit(product.unit)}</div>
                {product.current_stock <= product.min_stock_level && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-warning">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm">{t('products.detail.low_stock_alert')}</span>
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
                <p className="text-xl font-bold">{formatMoneyUZS(product.purchase_price)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('products.sale_price')}</p>
                <p className="text-xl font-bold">{formatMoneyUZS(product.sale_price)}</p>
              </div>
              <div className="pt-4 border-t">
                <p className="text-sm text-muted-foreground">{t('products.detail.profit_margin')}</p>
                <p className="text-2xl font-bold text-success">{margin}%</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <Tabs defaultValue="movements" className="w-full">
          <CardHeader>
            <TabsList>
              <TabsTrigger value="movements">{t('products.detail.inventory_movements')}</TabsTrigger>
              <TabsTrigger value="summary">{t('products.detail.stock_summary')}</TabsTrigger>
              <TabsTrigger value="sales">{t('products.detail.sales_history')}</TabsTrigger>
              <TabsTrigger value="purchases">{t('products.detail.purchase_history')}</TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent>
            <TabsContent value="summary" className="mt-0">
              {(() => {
                const movements = id ? getMovementsByProductId(id) : [];
                const totalIn = movements
                  .filter((m) => m.quantity > 0)
                  .reduce((sum, m) => sum + m.quantity, 0);
                const totalOut = Math.abs(
                  movements
                    .filter((m) => m.quantity < 0)
                    .reduce((sum, m) => sum + m.quantity, 0)
                );
                const currentStock = id ? getCurrentStockByProductId(id) : 0;

                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Total In
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-success">
                          +{totalIn} {formatUnit(product.unit)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Total Out
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-destructive">
                          -{totalOut} {formatUnit(product.unit)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Current Stock
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {currentStock} {formatUnit(product.unit)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Calculated from movements
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                );
              })()}
            </TabsContent>
            <TabsContent value="movements" className="mt-0">
              {id ? (
                <StockMovementsHistory productId={id} />
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t('products.detail.no_movements')}
                </div>
              )}
            </TabsContent>

            <TabsContent value="sales" className="mt-0">
              <div className="text-center py-8 text-muted-foreground">
                {t('products.detail.sales_history_placeholder')}
              </div>
            </TabsContent>

            <TabsContent value="purchases" className="mt-0">
              <div className="text-center py-8 text-muted-foreground">
                {t('products.detail.purchase_history_placeholder')}
              </div>
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  );
}
