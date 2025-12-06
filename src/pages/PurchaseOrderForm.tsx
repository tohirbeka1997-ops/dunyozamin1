import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  getSuppliers,
  getProducts,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrder,
  receiveGoods,
  generatePONumber,
  createSupplier,
  searchSuppliers,
} from '@/db/api';
import type {
  Supplier,
  ProductWithCategory,
  PurchaseOrderWithDetails,
  PurchaseOrder,
  PurchaseOrderStatus,
} from '@/types/database';
import { Plus, Trash2, Search, ArrowLeft, Save, Package, UserPlus } from 'lucide-react';
import { format } from 'date-fns';

interface OrderItem {
  product_id: string;
  product_name: string;
  ordered_qty: number;
  unit_cost: number;
  line_total: number;
}

export default function PurchaseOrderForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const isEditMode = !!id;

  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [existingPO, setExistingPO] = useState<PurchaseOrderWithDetails | null>(null);

  // Form fields
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [expectedDate, setExpectedDate] = useState('');
  const [status, setStatus] = useState<'draft' | 'approved'>('draft');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<OrderItem[]>([]);

  // Product search
  const [searchTerm, setSearchTerm] = useState('');
  const [showProductSearch, setShowProductSearch] = useState(false);

  // Supplier modal
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [newSupplierEmail, setNewSupplierEmail] = useState('');
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  useEffect(() => {
    loadInitialData();
  }, [id]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [suppliersData, productsData] = await Promise.all([
        getSuppliers(),
        getProducts(true),
      ]);

      setSuppliers(suppliersData);
      setProducts(productsData);

      if (id) {
        const poData = await getPurchaseOrderById(id);
        if (poData) {
          setExistingPO(poData);
          setSupplierId(poData.supplier_id || '');
          setOrderDate(poData.order_date);
          setExpectedDate(poData.expected_date || '');
          setStatus(poData.status as 'draft' | 'approved');
          setNotes(poData.notes || '');

          if (poData.items) {
            setItems(
              poData.items.map((item) => ({
                product_id: item.product_id,
                product_name: item.product_name,
                ordered_qty: item.ordered_qty,
                unit_cost: item.unit_cost,
                line_total: item.line_total,
              }))
            );
          }
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const addProduct = (product: ProductWithCategory) => {
    const existingItem = items.find((item) => item.product_id === product.id);
    if (existingItem) {
      toast({
        title: 'Product already added',
        description: 'This product is already in the order',
        variant: 'destructive',
      });
      return;
    }

    const newItem: OrderItem = {
      product_id: product.id,
      product_name: product.name,
      ordered_qty: 1,
      unit_cost: product.purchase_price,
      line_total: product.purchase_price,
    };

    setItems([...items, newItem]);
    setSearchTerm('');
    setShowProductSearch(false);
  };

  const updateItem = (index: number, field: 'ordered_qty' | 'unit_cost', value: number) => {
    const updatedItems = [...items];
    updatedItems[index][field] = value;
    updatedItems[index].line_total = updatedItems[index].ordered_qty * updatedItems[index].unit_cost;
    setItems(updatedItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const calculateSubtotal = () => {
    return items.reduce((sum, item) => sum + item.line_total, 0);
  };

  const validateForm = () => {
    if (!supplierId) {
      toast({
        title: 'Validation Error',
        description: 'Please select a supplier from the dropdown',
        variant: 'destructive',
      });
      return false;
    }

    if (!orderDate) {
      toast({
        title: 'Validation Error',
        description: 'Please select an order date',
        variant: 'destructive',
      });
      return false;
    }

    if (items.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please add at least one product',
        variant: 'destructive',
      });
      return false;
    }

    for (const item of items) {
      if (item.ordered_qty <= 0) {
        toast({
          title: 'Validation Error',
          description: 'Quantity must be greater than 0',
          variant: 'destructive',
        });
        return false;
      }

      if (item.unit_cost < 0) {
        toast({
          title: 'Validation Error',
          description: 'Unit cost cannot be negative',
          variant: 'destructive',
        });
        return false;
      }
    }

    return true;
  };

  const handleCreateSupplier = async () => {
    if (!newSupplierName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Supplier name is required',
        variant: 'destructive',
      });
      return;
    }

    if (newSupplierEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newSupplierEmail)) {
      toast({
        title: 'Validation Error',
        description: 'Invalid email format',
        variant: 'destructive',
      });
      return;
    }

    try {
      setCreatingSupplier(true);
      const newSupplier = await createSupplier({
        name: newSupplierName.trim(),
        phone: newSupplierPhone.trim() || null,
        email: newSupplierEmail.trim() || null,
        contact_person: null,
        address: null,
        note: null,
        status: 'active',
      });

      toast({
        title: 'Success',
        description: 'Supplier created successfully',
      });

      // Reload suppliers and select the new one
      const updatedSuppliers = await getSuppliers();
      setSuppliers(updatedSuppliers);
      setSupplierId(newSupplier.id);

      // Reset modal
      setShowSupplierModal(false);
      setNewSupplierName('');
      setNewSupplierPhone('');
      setNewSupplierEmail('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create supplier',
        variant: 'destructive',
      });
    } finally {
      setCreatingSupplier(false);
    }
  };

  const handleSave = async (markAsReceived = false) => {
    if (!validateForm()) return;

    try {
      setLoading(true);

      const subtotal = calculateSubtotal();
      
      let poId: string;

      if (isEditMode && id) {
        // Update existing PO
        const purchaseOrderData: Partial<PurchaseOrder> = {
          supplier_id: supplierId,
          supplier_name: null,
          order_date: orderDate,
          expected_date: expectedDate || null,
          subtotal,
          discount: 0,
          tax: 0,
          total_amount: subtotal,
          status: (markAsReceived ? 'received' : status) as PurchaseOrderStatus,
          received_by: markAsReceived ? (user?.id || null) : undefined,
          notes,
        };

        const itemsData = items.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          ordered_qty: item.ordered_qty,
          received_qty: markAsReceived ? item.ordered_qty : 0,
          unit_cost: item.unit_cost,
          line_total: item.line_total,
        }));

        await updatePurchaseOrder(id, purchaseOrderData, itemsData);
        poId = id;
        toast({
          title: 'Success',
          description: 'Purchase order updated successfully',
        });
      } else {
        // Create new PO - generate PO number first
        const poNumber = await generatePONumber();
        
        const purchaseOrderData: Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'> = {
          po_number: poNumber,
          supplier_id: supplierId,
          supplier_name: null,
          order_date: orderDate,
          expected_date: expectedDate || null,
          reference: null,
          subtotal,
          discount: 0,
          tax: 0,
          total_amount: subtotal,
          status: (markAsReceived ? 'received' : status) as PurchaseOrderStatus,
          invoice_number: null,
          received_by: markAsReceived ? (user?.id || null) : null,
          approved_by: null,
          approved_at: null,
          notes,
          created_by: user?.id || null,
        };

        const itemsData = items.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          ordered_qty: item.ordered_qty,
          received_qty: markAsReceived ? item.ordered_qty : 0,
          unit_cost: item.unit_cost,
          line_total: item.line_total,
        }));

        const newPO = await createPurchaseOrder(purchaseOrderData, itemsData);
        poId = newPO.id;
        toast({
          title: 'Success',
          description: 'Purchase order created successfully',
        });
      }

      // If marking as received, call receive_goods RPC
      if (markAsReceived) {
        // Need to fetch the created PO to get item IDs
        const createdPO = await getPurchaseOrderById(poId);
        if (createdPO && createdPO.items) {
          const receiveItems = createdPO.items.map((item) => ({
            item_id: item.id,
            received_qty: item.ordered_qty,
          }));

          await receiveGoods(poId, receiveItems, orderDate);

          toast({
            title: 'Stock Updated',
            description: 'Product stock has been updated',
          });
        }
      }

      navigate('/purchase-orders');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save purchase order',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(
    (product) =>
      searchTerm &&
      (product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (product.barcode && product.barcode.toLowerCase().includes(searchTerm.toLowerCase())))
  );

  if (loading && !suppliers.length) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Don't allow editing if already received
  const isReadOnly = existingPO && existingPO.status === 'received';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/purchase-orders')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">
              {isEditMode ? 'Edit Purchase Order' : 'New Purchase Order'}
            </h1>
            <p className="text-muted-foreground">
              {isReadOnly
                ? 'This purchase order has been received and cannot be edited'
                : 'Fill in the details below to create or update a purchase order'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="supplier">
                    Supplier <span className="text-destructive">*</span>
                  </Label>
                  <div className="flex gap-2">
                    <Select value={supplierId} onValueChange={setSupplierId} disabled={isReadOnly}>
                      <SelectTrigger id="supplier" className="flex-1">
                        <SelectValue placeholder="Select supplier" />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!isReadOnly && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setShowSupplierModal(true)}
                        title="Add New Supplier"
                      >
                        <UserPlus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="order-date">
                    Order Date <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="order-date"
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    disabled={isReadOnly}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expected-date">Expected Date</Label>
                  <Input
                    id="expected-date"
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    disabled={isReadOnly}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={status}
                    onValueChange={(value) => setStatus(value as 'draft' | 'approved')}
                    disabled={isReadOnly}
                  >
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any additional notes..."
                  rows={3}
                  disabled={isReadOnly}
                />
              </div>
            </CardContent>
          </Card>

          {/* Products */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Products</CardTitle>
                {!isReadOnly && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowProductSearch(!showProductSearch)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Product
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isReadOnly && showProductSearch && (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search products by name, SKU, or barcode..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  {searchTerm && filteredProducts.length > 0 && (
                    <Card>
                      <CardContent className="p-2 max-h-60 overflow-y-auto">
                        {filteredProducts.map((product) => (
                          <div
                            key={product.id}
                            className="flex items-center justify-between p-2 hover:bg-muted rounded cursor-pointer"
                            onClick={() => addProduct(product)}
                          >
                            <div>
                              <p className="font-medium">{product.name}</p>
                              <p className="text-sm text-muted-foreground">
                                SKU: {product.sku} | Stock: {product.current_stock} {product.unit}
                              </p>
                            </div>
                            <p className="text-sm font-medium">
                              ${product.purchase_price.toFixed(2)}
                            </p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No products added yet</p>
                  {!isReadOnly && <p className="text-sm mt-2">Click "Add Product" to get started</p>}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Unit Cost</TableHead>
                      <TableHead className="text-right">Line Total</TableHead>
                      {!isReadOnly && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{item.product_name}</TableCell>
                        <TableCell className="text-right">
                          {isReadOnly ? (
                            item.ordered_qty
                          ) : (
                            <Input
                              type="number"
                              min="1"
                              step="1"
                              value={item.ordered_qty}
                              onChange={(e) =>
                                updateItem(index, 'ordered_qty', Number(e.target.value))
                              }
                              className="w-24 text-right"
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isReadOnly ? (
                            `$${item.unit_cost.toFixed(2)}`
                          ) : (
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unit_cost}
                              onChange={(e) =>
                                updateItem(index, 'unit_cost', Number(e.target.value))
                              }
                              className="w-32 text-right"
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ${item.line_total.toFixed(2)}
                        </TableCell>
                        {!isReadOnly && (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeItem(index)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Summary */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">${calculateSubtotal().toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="font-medium">$0.00</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="font-medium">$0.00</span>
                </div>
                <div className="border-t pt-2 flex justify-between">
                  <span className="font-semibold">Total</span>
                  <span className="font-bold text-lg">${calculateSubtotal().toFixed(2)}</span>
                </div>
              </div>

              {!isReadOnly && (
                <div className="space-y-2">
                  <Button
                    className="w-full"
                    onClick={() => handleSave(false)}
                    disabled={loading || items.length === 0}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {isEditMode ? 'Update Purchase Order' : 'Save as Draft'}
                  </Button>

                  {!isEditMode && (
                    <Button
                      className="w-full"
                      variant="default"
                      onClick={() => handleSave(true)}
                      disabled={loading || items.length === 0}
                    >
                      <Package className="h-4 w-4 mr-2" />
                      Save & Mark as Received
                    </Button>
                  )}
                </div>
              )}

              <div className="text-xs text-muted-foreground space-y-1">
                <p>• Draft: Save without affecting stock</p>
                <p>• Mark as Received: Update stock immediately</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add New Supplier Modal */}
      <Dialog open={showSupplierModal} onOpenChange={setShowSupplierModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Supplier</DialogTitle>
            <DialogDescription>
              Create a new supplier to add to your purchase order
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-supplier-name">
                Supplier Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new-supplier-name"
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder="Enter supplier name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-supplier-phone">Phone</Label>
              <Input
                id="new-supplier-phone"
                value={newSupplierPhone}
                onChange={(e) => setNewSupplierPhone(e.target.value)}
                placeholder="Enter phone number"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-supplier-email">Email</Label>
              <Input
                id="new-supplier-email"
                type="email"
                value={newSupplierEmail}
                onChange={(e) => setNewSupplierEmail(e.target.value)}
                placeholder="Enter email address"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowSupplierModal(false);
                setNewSupplierName('');
                setNewSupplierPhone('');
                setNewSupplierEmail('');
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateSupplier} disabled={creatingSupplier}>
              {creatingSupplier ? 'Creating...' : 'Create Supplier'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
