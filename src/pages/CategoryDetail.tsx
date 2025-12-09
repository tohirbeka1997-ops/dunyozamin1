import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { getCategoryById, getProductsByCategoryId } from '@/db/api';
import type { Category, Product } from '@/types/database';
import { ArrowLeft, Pencil, Package, FolderTree } from 'lucide-react';

export default function CategoryDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [category, setCategory] = useState<Category | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadData();
    }
  }, [id]);

  const loadData = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [categoryData, productsData] = await Promise.all([
        getCategoryById(id),
        getProductsByCategoryId(id),
      ]);
      setCategory(categoryData);
      setProducts(productsData);
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('categoryDetail.failed_to_load'),
        variant: 'destructive',
      });
      navigate('/categories');
    } finally {
      setLoading(false);
    }
  };

  const getStockStatusBadge = (product: Product) => {
    if (product.current_stock <= 0) {
      return <Badge variant="destructive">{t('categoryDetail.out_of_stock')}</Badge>;
    }
    if (product.current_stock <= product.min_stock_level) {
      return <Badge className="bg-warning text-warning-foreground">{t('categoryDetail.low_stock')}</Badge>;
    }
    return <Badge className="bg-success text-success-foreground">{t('categoryDetail.in_stock')}</Badge>;
  };

  if (loading || !category) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/categories')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div
              className="h-16 w-16 rounded-lg flex items-center justify-center text-3xl"
              style={{ backgroundColor: category.color || '#2563EB' }}
            >
              {category.icon || '📁'}
            </div>
            <div>
              <h1 className="text-3xl font-bold">{category.name}</h1>
              <p className="text-muted-foreground">{category.description || t('categoryDetail.no_description')}</p>
            </div>
          </div>
        </div>
        <Button onClick={() => navigate('/categories')}>
          <Pencil className="h-4 w-4 mr-2" />
          {t('categoryDetail.edit_category')}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('categoryDetail.total_products')}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{products.length}</div>
            <p className="text-xs text-muted-foreground">{t('categoryDetail.products_in_category')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('categoryDetail.total_value')}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${products.reduce((sum, p) => sum + (Number(p.sale_price) * p.current_stock), 0).toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">{t('categoryDetail.inventory_value')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('categoryDetail.in_stock')}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {products.filter(p => p.current_stock > p.min_stock_level).length}
            </div>
            <p className="text-xs text-muted-foreground">{t('categoryDetail.products_available')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('categoryDetail.low_stock')}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {products.filter(p => p.current_stock > 0 && p.current_stock <= p.min_stock_level).length}
            </div>
            <p className="text-xs text-muted-foreground">{t('categoryDetail.need_restock')}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t('categoryDetail.category_information')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-muted-foreground mb-1">{t('categoryDetail.category_name')}</p>
              <p className="font-medium">{category.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">{t('categoryDetail.created_date')}</p>
              <p className="font-medium">{new Date(category.created_at).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">{t('categoryDetail.description')}</p>
              <p className="font-medium">{category.description || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">{t('categoryDetail.parent_category')}</p>
              {category.parent_id ? (
                <Badge variant="outline">
                  <FolderTree className="h-3 w-3 mr-1" />
                  {t('categoryDetail.parent_category_badge')}
                </Badge>
              ) : (
                <p className="font-medium">{t('categoryDetail.root_category')}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="products" className="space-y-4">
        <TabsList>
          <TabsTrigger value="products">{t('categoryDetail.products_tab', { count: products.length })}</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('categoryDetail.products_in_category_title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {products.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">{t('categoryDetail.no_products')}</p>
                  <Button className="mt-4" onClick={() => navigate('/products/new')}>
                    <Package className="h-4 w-4 mr-2" />
                    {t('categoryDetail.add_product')}
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('categoryDetail.table.product_name')}</TableHead>
                      <TableHead>{t('categoryDetail.table.sku_barcode')}</TableHead>
                      <TableHead className="text-right">{t('categoryDetail.table.price')}</TableHead>
                      <TableHead className="text-right">{t('categoryDetail.table.stock')}</TableHead>
                      <TableHead>{t('categoryDetail.table.status')}</TableHead>
                      <TableHead className="text-right">{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell className="font-medium">{product.name}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {product.sku}
                          {product.barcode && (
                            <div className="text-xs text-muted-foreground">{product.barcode}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          ${Number(product.sale_price).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">{product.current_stock}</TableCell>
                        <TableCell>{getStockStatusBadge(product)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/products/${product.id}`)}
                          >
                            {t('common.view')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
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
