import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Badge } from '@/components/ui/badge';
import { getProducts, getCategories, deleteProduct } from '@/db/api';
import type { ProductWithCategory, Category } from '@/types/database';
import { Plus, Search, Pencil, Trash2, Eye, AlertTriangle, Package } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Link, useNavigate } from 'react-router-dom';

export default function Products() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [productsData, categoriesData] = await Promise.all([
        getProducts(true),
        getCategories(),
      ]);
      setProducts(productsData);
      setCategories(categoriesData);
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('products.failed_to_load'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t('products.delete_confirm', { name }))) return;
    try {
      await deleteProduct(id);
      toast({ title: t('common.success'), description: t('products.product_deleted') });
      loadData();
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('products.failed_to_delete'),
        variant: 'destructive',
      });
    }
  };

  const getStockStatus = (product: ProductWithCategory) => {
    if (product.current_stock <= 0) {
      return { label: t('products.out_of_stock_label'), color: 'bg-destructive text-destructive-foreground' };
    }
    if (product.current_stock <= product.min_stock_level) {
      return { label: t('products.low_stock_label'), color: 'bg-warning text-warning-foreground' };
    }
    return { label: t('products.in_stock_label'), color: 'bg-success text-success-foreground' };
  };

  const filteredProducts = products.filter((product) => {
    const matchesSearch =
      searchTerm === '' ||
      product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (product.barcode && product.barcode.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesCategory = categoryFilter === 'all' || product.category_id === categoryFilter;

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && product.is_active) ||
      (statusFilter === 'inactive' && !product.is_active);

    const matchesStock =
      stockFilter === 'all' ||
      (stockFilter === 'low' && product.current_stock <= product.min_stock_level) ||
      (stockFilter === 'out' && product.current_stock <= 0);

    return matchesSearch && matchesCategory && matchesStatus && matchesStock;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('products.title')}</h1>
          <p className="text-muted-foreground">{t('products.subtitle')}</p>
        </div>
        <Button onClick={() => navigate('/products/new')}>
          <Plus className="h-4 w-4 mr-2" />
          {t('products.add_product')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('products.filters')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('products.search_placeholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue placeholder={t('products.all_categories')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('products.all_categories')}</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder={t('products.all_statuses')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('products.all_statuses')}</SelectItem>
                <SelectItem value="active">{t('common.active')}</SelectItem>
                <SelectItem value="inactive">{t('common.inactive')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={stockFilter} onValueChange={setStockFilter}>
              <SelectTrigger>
                <SelectValue placeholder={t('products.all_stock')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('products.all_stock')}</SelectItem>
                <SelectItem value="low">{t('products.low_stock')}</SelectItem>
                <SelectItem value="out">{t('products.out_of_stock')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('products.title')} ({filteredProducts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{t('products.no_products_found')}</p>
              <Button className="mt-4" onClick={() => navigate('/products/new')}>
                <Plus className="h-4 w-4 mr-2" />
                {t('products.add_product')}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('products.product_name')}</TableHead>
                    <TableHead>{t('products.sku')} / {t('products.barcode')}</TableHead>
                    <TableHead>{t('products.category')}</TableHead>
                    <TableHead>{t('products.unit')}</TableHead>
                    <TableHead className="text-right">{t('products.purchase_price')}</TableHead>
                    <TableHead className="text-right">{t('products.sale_price')}</TableHead>
                    <TableHead className="text-right">{t('pos.stock')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((product) => {
                    const stockStatus = getStockStatus(product);
                    return (
                      <TableRow key={product.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                              {product.image_url ? (
                                <img
                                  src={product.image_url}
                                  alt={product.name}
                                  className="h-full w-full object-cover rounded"
                                />
                              ) : (
                                <Package className="h-5 w-5 text-muted-foreground" />
                              )}
                            </div>
                            <div>
                              <p className="font-medium">{product.name}</p>
                              {product.description && (
                                <p className="text-xs text-muted-foreground line-clamp-1">
                                  {product.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <p className="font-mono">{product.sku}</p>
                            {product.barcode && (
                              <p className="text-xs text-muted-foreground font-mono">
                                {product.barcode}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {product.category ? (
                            <Badge variant="outline">{product.category.name}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>{product.unit}</TableCell>
                        <TableCell className="text-right">
                          ${Number(product.purchase_price).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ${Number(product.sale_price).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {product.current_stock <= product.min_stock_level && (
                              <AlertTriangle className="h-4 w-4 text-warning" />
                            )}
                            <span className="font-medium">{product.current_stock}</span>
                            <span className="text-xs text-muted-foreground">{product.unit}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant={product.is_active ? 'default' : 'secondary'}>
                              {product.is_active ? t('common.active') : t('common.inactive')}
                            </Badge>
                            <Badge className={stockStatus.color} variant="secondary">
                              {stockStatus.label}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => navigate(`/products/${product.id}`)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => navigate(`/products/${product.id}/edit`)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(product.id, product.name)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
