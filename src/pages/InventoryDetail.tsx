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
        title: 'Error',
        description: 'Failed to load inventory details',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAdjustment = async () => {
    if (!id || !adjustmentForm.quantity || !adjustmentForm.reason) {
      toast({
        title: 'Error',
        description: 'Please fill in all required fields',
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
        title: 'Success',
        description: 'Stock adjusted successfully',
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
        title: 'Error',
        description: 'Failed to adjust stock',
        variant: 'destructive',
      });
    }
  };

  const getStockStatusBadge = () => {
    if (!product) return null;
    
    const stock = Number(product.current_stock);
    const minStock = Number(product.min_stock_level);

    if (stock === 0) {
      return <Badge variant="destructive">Out of Stock</Badge>;
    } else if (stock <= minStock) {
      return <Badge className="bg-warning text-warning-foreground">Low Stock</Badge>;
    } else {
      return <Badge className="bg-success text-success-foreground">In Stock</Badge>;
    }
  };

  const getMovementTypeBadge = (type: string) => {
    const types: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      purchase: { label: 'Purchase', variant: 'default' },
      sale: { label: 'Sale', variant: 'secondary' },
      return: { label: 'Return', variant: 'outline' },
      adjustment: { label: 'Adjustment', variant: 'outline' },
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
          <p className="text-muted-foreground">Product not found</p>
          <Button onClick={() => navigate('/inventory')} className="mt-4">
            Back to Inventory
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
              Adjust Stock
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adjust Stock</DialogTitle>
              <DialogDescription>
                Make adjustments to the inventory for {product.name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Adjustment Type</Label>
                <Select
                  value={adjustmentForm.type}
                  onValueChange={(value) => setAdjustmentForm({ ...adjustmentForm, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="increase">Increase</SelectItem>
                    <SelectItem value="decrease">Decrease</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={adjustmentForm.quantity}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, quantity: e.target.value })}
                  placeholder="Enter quantity"
                />
              </div>
              <div className="space-y-2">
                <Label>Reason</Label>
                <Select
                  value={adjustmentForm.reason}
                  onValueChange={(value) => setAdjustmentForm({ ...adjustmentForm, reason: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="damaged">Damaged</SelectItem>
                    <SelectItem value="lost">Lost</SelectItem>
                    <SelectItem value="correction">Correction</SelectItem>
                    <SelectItem value="audit">Inventory Count Difference</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes (Optional)</Label>
                <Textarea
                  value={adjustmentForm.notes}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, notes: e.target.value })}
                  placeholder="Additional notes..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdjustmentOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdjustment}>
                Confirm Adjustment
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
                <p className="text-sm text-muted-foreground">Current Stock</p>
                <p className="text-2xl font-bold">{Number(product.current_stock).toFixed(2)}</p>
                <p className="text-sm text-muted-foreground">{product.unit}</p>
              </div>
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Min Stock Level</p>
                <p className="text-2xl font-bold">{Number(product.min_stock_level).toFixed(2)}</p>
                <p className="text-sm text-muted-foreground">{product.unit}</p>
              </div>
              <TrendingDown className="h-8 w-8 text-warning" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Cost Price</p>
                <p className="text-2xl font-bold">${Number(product.purchase_price).toFixed(2)}</p>
                <p className="text-sm text-muted-foreground">per {product.unit}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Inventory Value</p>
                <p className="text-2xl font-bold">${inventoryValue.toFixed(2)}</p>
                <div className="mt-1">{getStockStatusBadge()}</div>
              </div>
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Product Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">SKU</p>
              <p className="font-medium">{product.sku}</p>
            </div>
            {product.barcode && (
              <div>
                <p className="text-sm text-muted-foreground">Barcode</p>
                <p className="font-medium">{product.barcode}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">Sale Price</p>
              <p className="font-medium">${Number(product.sale_price).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Unit</p>
              <p className="font-medium">{product.unit}</p>
            </div>
            {product.description && (
              <div className="md:col-span-2">
                <p className="text-sm text-muted-foreground">Description</p>
                <p className="font-medium">{product.description}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="movements" className="space-y-4">
        <TabsList>
          <TabsTrigger value="movements">Stock Movements</TabsTrigger>
          <TabsTrigger value="purchases">Purchase History</TabsTrigger>
          <TabsTrigger value="sales">Sales History</TabsTrigger>
        </TabsList>

        <TabsContent value="movements">
          <Card>
            <CardHeader>
              <CardTitle>Movement History</CardTitle>
            </CardHeader>
            <CardContent>
              {movements.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">No movements recorded</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date & Time</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Before</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead className="text-right">After</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>User</TableHead>
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
              <CardTitle>Purchase History</CardTitle>
            </CardHeader>
            <CardContent>
              {purchaseHistory.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">No purchase history</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO Number</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Total</TableHead>
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
                          ${Number(item.unit_cost).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ${(Number(item.quantity) * Number(item.unit_cost)).toFixed(2)}
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
              <CardTitle>Sales History</CardTitle>
            </CardHeader>
            <CardContent>
              {salesHistory.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">No sales history</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order Number</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
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
                            ${revenue.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            <span className={profit >= 0 ? 'text-success' : 'text-destructive'}>
                              ${profit.toFixed(2)}
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
