import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { useToast } from '@/hooks/use-toast';
import { getProductById, getInventoryMovements } from '@/db/api';
import type { ProductWithCategory } from '@/types/database';
import { ArrowLeft, Pencil, Package, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [product, setProduct] = useState<ProductWithCategory | null>(null);
  const [movements, setMovements] = useState<any[]>([]);
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
      const [productData, movementsData] = await Promise.all([
        getProductById(id),
        getInventoryMovements(id),
      ]);
      setProduct(productData);
      setMovements(movementsData);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load product details',
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
      return { label: 'Out of Stock', color: 'bg-destructive text-destructive-foreground' };
    }
    if (product.current_stock <= product.min_stock_level) {
      return { label: 'Low Stock', color: 'bg-warning text-warning-foreground' };
    }
    return { label: 'In Stock', color: 'bg-success text-success-foreground' };
  };

  const stockStatus = getStockStatus();

  const getMovementIcon = (type: string) => {
    switch (type) {
      case 'purchase':
      case 'return':
      case 'adjustment':
        return <TrendingUp className="h-4 w-4 text-success" />;
      case 'sale':
        return <TrendingDown className="h-4 w-4 text-destructive" />;
      default:
        return <Package className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/products')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Product Details</h1>
            <p className="text-muted-foreground">View product information and history</p>
          </div>
        </div>
        <Button onClick={() => navigate(`/products/${id}/edit`)}>
          <Pencil className="h-4 w-4 mr-2" />
          Edit Product
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Product Information</CardTitle>
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
                    {product.is_active ? 'Active' : 'Inactive'}
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
                <p className="text-sm text-muted-foreground">SKU</p>
                <p className="font-mono font-medium">{product.sku}</p>
              </div>
              {product.barcode && (
                <div>
                  <p className="text-sm text-muted-foreground">Barcode</p>
                  <p className="font-mono font-medium">{product.barcode}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Unit</p>
                <p className="font-medium">{product.unit}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Min Stock Level</p>
                <p className="font-medium">{product.min_stock_level} {product.unit}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Current Stock</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <div className="text-4xl font-bold">{product.current_stock}</div>
                <div className="text-muted-foreground">{product.unit}</div>
                {product.current_stock <= product.min_stock_level && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-warning">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm">Low stock alert</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Purchase Price</p>
                <p className="text-xl font-bold">${Number(product.purchase_price).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Sale Price</p>
                <p className="text-xl font-bold">${Number(product.sale_price).toFixed(2)}</p>
              </div>
              <div className="pt-4 border-t">
                <p className="text-sm text-muted-foreground">Profit Margin</p>
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
              <TabsTrigger value="movements">Inventory Movements</TabsTrigger>
              <TabsTrigger value="sales">Sales History</TabsTrigger>
              <TabsTrigger value="purchases">Purchase History</TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent>
            <TabsContent value="movements" className="mt-0">
              {movements.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No inventory movements yet
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Movement #</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((movement: any) => (
                      <TableRow key={movement.id}>
                        <TableCell>
                          {new Date(movement.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getMovementIcon(movement.movement_type)}
                            <span className="capitalize">{movement.movement_type}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {movement.movement_number}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={
                              movement.quantity > 0 ? 'text-success' : 'text-destructive'
                            }
                          >
                            {movement.quantity > 0 ? '+' : ''}
                            {movement.quantity}
                          </span>
                        </TableCell>
                        <TableCell>
                          {movement.created_by_profile?.username || '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {movement.notes || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="sales" className="mt-0">
              <div className="text-center py-8 text-muted-foreground">
                Sales history will be displayed here
              </div>
            </TabsContent>

            <TabsContent value="purchases" className="mt-0">
              <div className="text-center py-8 text-muted-foreground">
                Purchase history will be displayed here
              </div>
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  );
}
