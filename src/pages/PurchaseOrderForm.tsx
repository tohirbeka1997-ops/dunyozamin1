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
import { formatUnit } from '@/utils/formatters';
import { formatMoneyUZS } from '@/lib/format';
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
  productUpdateEmitter,
} from '@/db/api';
import type {
  SupplierWithBalance,
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
  const { profile: user } = useAuth();
  const queryClient = useQueryClient();
  const isEditMode = !!id;

  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
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
    } catch (error: unknown) {
      console.error('Load initial data error:', error);
      
      toast({
        title: 'Xatolik',
        description: 'Ma\'lumotlarni yuklab bo\'lmadi',
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
        title: 'Mahsulot allaqachon qo\'shilgan',
        description: 'Bu mahsulot allaqachon buyurtmada mavjud',
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
        title: 'Validatsiya xatosi',
        description: 'Iltimos, ro\'yxatdan yetkazib beruvchini tanlang',
        variant: 'destructive',
      });
      return false;
    }

    if (!orderDate) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Iltimos, buyurtma sanasini tanlang',
        variant: 'destructive',
      });
      return false;
    }

    if (items.length === 0) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Iltimos, kamida bitta mahsulot qo\'shing',
        variant: 'destructive',
      });
      return false;
    }

    for (const item of items) {
      if (item.ordered_qty <= 0) {
        toast({
          title: 'Validatsiya xatosi',
          description: 'Miqdor 0 dan katta bo\'lishi kerak',
          variant: 'destructive',
        });
        return false;
      }

      if (item.unit_cost < 0) {
        toast({
          title: 'Validatsiya xatosi',
          description: 'Birlik narxi manfiy bo\'lishi mumkin emas',
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
        title: 'Validatsiya xatosi',
        description: 'Yetkazib beruvchi nomi majburiy',
        variant: 'destructive',
      });
      return;
    }

    if (newSupplierEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newSupplierEmail)) {
      toast({
        title: 'Validatsiya xatosi',
        description: 'Email formati noto\'g\'ri',
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
        title: 'Muvaffaqiyatli',
        description: 'Yetkazib beruvchi muvaffaqiyatli yaratildi',
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
    } catch (error: unknown) {
      console.error('Create supplier error:', error);
      
      const errorMessage = error instanceof Error
        ? error.message
        : 'Yetkazib beruvchini yaratishda xatolik yuz berdi';
      
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setCreatingSupplier(false);
    }
  };

  const handleSave = async (markAsReceived = false): Promise<void> => {
    if (!validateForm()) return;

    try {
      setLoading(true);

      // Calculate subtotal safely
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
        
        // Invalidate dashboard queries
        invalidateDashboardQueries(queryClient);
        
        toast({
          title: 'Muvaffaqiyatli',
          description: isEditMode 
            ? 'Xarid buyurtmasi muvaffaqiyatli yangilandi'
            : 'Xarid buyurtmasi muvaffaqiyatli yaratildi',
        });
      } else {
        // Create new PO - generate PO number first
        const poNumber = await generatePONumber();
        
        // IMPORTANT: When creating a NEW PO with markAsReceived=true:
        // - Create with status='approved' (NOT 'received') to allow receiveGoods() to process it
        // - Set received_qty=0 initially, let receiveGoods() handle the receiving
        // - This prevents the "already received" error in receiveGoods()
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
          // For NEW PO: if markAsReceived, create as 'approved' so receiveGoods() can process it
          // If NOT markAsReceived, use the selected status (usually 'draft')
          status: (markAsReceived ? 'approved' : status) as PurchaseOrderStatus,
          invoice_number: null,
          received_by: null, // Will be set by receiveGoods() if markAsReceived
          approved_by: null,
          approved_at: null,
          notes,
          created_by: user?.id || null,
        };

        // IMPORTANT: Always set received_qty=0 when creating NEW PO
        // receiveGoods() will update it when receiving
        const itemsData = items.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          ordered_qty: item.ordered_qty,
          received_qty: 0, // Always 0 for new PO - receiveGoods() will update it
          unit_cost: item.unit_cost,
          line_total: item.line_total,
        }));

        const newPO = await createPurchaseOrder(purchaseOrderData, itemsData);
        poId = newPO.id;
        
        // Invalidate dashboard queries
        invalidateDashboardQueries(queryClient);
        
        toast({
          title: 'Muvaffaqiyatli',
          description: 'Xarid buyurtmasi muvaffaqiyatli yaratildi',
        });
      }

      // If marking as received, call receiveGoods() to update stock and status
      // This works for both NEW and EXISTING POs
      if (markAsReceived) {
        // Fetch the created/updated PO to get the actual item IDs
        const createdPO = await getPurchaseOrderById(poId);
        
        // Map form items to receive items using actual PO item IDs
        // For NEW PO: received_qty will be 0, so we receive the full ordered_qty
        // For EXISTING PO: received_qty may be > 0, so we receive the remaining quantity
        const receiveItems = (createdPO.items || []).map((poItem) => {
          // Find the corresponding form item to get product_id
          const formItem = items.find(fi => fi.product_id === poItem.product_id);
          return {
            item_id: poItem.id, // Use actual purchase order item ID
            received_qty: poItem.ordered_qty - poItem.received_qty, // Receive remaining quantity
            product_id: poItem.product_id, // Include product_id for stock update
          };
        });

        await receiveGoods(poId, receiveItems, orderDate);

        // Invalidate dashboard queries
        invalidateDashboardQueries(queryClient);

        // Emit product update event to refresh inventory pages
        // This ensures inventory quantities update immediately across all open pages
        productUpdateEmitter.emit();

        toast({
          title: 'Muvaffaqiyatli',
          description: 'Ombor muvaffaqiyatli yangilandi',
        });
      }

      navigate('/purchase-orders');
    } catch (error: unknown) {
      console.error('Purchase order save error:', error);
      
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Xarid buyurtmasini saqlashda xatolik yuz berdi';
      
      toast({
        title: 'Xatolik',
        description: errorMessage,
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
              {isEditMode ? 'Xarid buyurtmasini tahrirlash' : 'Yangi xarid buyurtmasi'}
            </h1>
            <p className="text-muted-foreground">
              {isReadOnly
                ? 'Bu xarid buyurtmasi qabul qilingan va tahrirlash mumkin emas'
                : 'Xarid buyurtmasini yaratish yoki tahrirlash uchun quyidagi maʼlumotlarni toʻldiring'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Asosiy maʼlumotlar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="supplier">
                    Yetkazib beruvchi <span className="text-destructive">*</span>
                  </Label>
                  <div className="flex gap-2">
                    <Select value={supplierId} onValueChange={setSupplierId} disabled={isReadOnly}>
                      <SelectTrigger id="supplier" className="flex-1">
                        <SelectValue placeholder="Yetkazib beruvchini tanlang" />
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
                        title="Yangi yetkazib beruvchi qo'shish"
                      >
                        <UserPlus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="order-date">
                    Buyurtma sanasi <span className="text-destructive">*</span>
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
                  <Label htmlFor="expected-date">Kutilayotgan sana</Label>
                  <Input
                    id="expected-date"
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    disabled={isReadOnly}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Holati</Label>
                  <Select
                    value={status}
                    onValueChange={(value) => setStatus(value as 'draft' | 'approved')}
                    disabled={isReadOnly}
                  >
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Qoralama</SelectItem>
                      <SelectItem value="approved">Tasdiqlangan</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Izohlar</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Qo'shimcha izoh kiriting..."
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
                <CardTitle>Mahsulotlar</CardTitle>
                {!isReadOnly && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowProductSearch(!showProductSearch)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Mahsulot qo'shish
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
                      placeholder="Mahsulotni nom, SKU yoki shtrix kod bo'yicha qidirish..."
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
                                SKU: {product.sku} | Stock: {product.current_stock} {formatUnit(product.unit)}
                              </p>
                            </div>
                            <p className="text-sm font-medium">
                              {formatMoneyUZS(product.purchase_price)}
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
                  <p>Hozircha mahsulot qo'shilmagan</p>
                  {!isReadOnly && <p className="text-sm mt-2">Boshlash uchun "Mahsulot qo'shish" tugmasini bosing</p>}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mahsulot</TableHead>
                      <TableHead className="text-right">Miqdor</TableHead>
                      <TableHead className="text-right">Birlik narxi</TableHead>
                      <TableHead className="text-right">Jami</TableHead>
                      {!isReadOnly && <TableHead className="text-right">Amallar</TableHead>}
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
                            formatMoneyUZS(item.unit_cost)
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
                          {formatMoneyUZS(item.line_total)}
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
              <CardTitle>Buyurtma yig'indisi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Oraliq summa</span>
                  <span className="font-medium">{formatMoneyUZS(calculateSubtotal())}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Chegirma</span>
                  <span className="font-medium">{formatMoneyUZS(0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Soliq</span>
                  <span className="font-medium">{formatMoneyUZS(0)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between">
                  <span className="font-semibold">Jami</span>
                  <span className="font-bold text-lg">{formatMoneyUZS(calculateSubtotal())}</span>
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
                    {isEditMode ? 'Xarid buyurtmasini yangilash' : 'Qoralama sifatida saqlash'}
                  </Button>

                  {!isEditMode && (
                    <Button
                      className="w-full"
                      variant="default"
                      onClick={() => handleSave(true)}
                      disabled={loading || items.length === 0}
                    >
                      <Package className="h-4 w-4 mr-2" />
                      Saqlash va qabul qilingan deb belgilash
                    </Button>
                  )}
                </div>
              )}

              <div className="text-xs text-muted-foreground space-y-1">
                <p>• Qoralama: Ombor miqdoriga ta'sir qilmaydi</p>
                <p>• Qabul qilingan deb belgilash: Ombor qoldig'i darhol yangilanadi</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add New Supplier Modal */}
      <Dialog open={showSupplierModal} onOpenChange={setShowSupplierModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yangi yetkazib beruvchi qo'shish</DialogTitle>
            <DialogDescription>
              Xarid buyurtmangizga yangi yetkazib beruvchi qo'shing
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-supplier-name">
                Yetkazib beruvchi nomi <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new-supplier-name"
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder="Yetkazib beruvchi nomini kiriting"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-supplier-phone">Telefon</Label>
              <Input
                id="new-supplier-phone"
                value={newSupplierPhone}
                onChange={(e) => setNewSupplierPhone(e.target.value)}
                placeholder="Telefon raqamini kiriting"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-supplier-email">Email</Label>
              <Input
                id="new-supplier-email"
                type="email"
                value={newSupplierEmail}
                onChange={(e) => setNewSupplierEmail(e.target.value)}
                placeholder="Email manzilini kiriting"
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
              Bekor qilish
            </Button>
            <Button onClick={handleCreateSupplier} disabled={creatingSupplier}>
              {creatingSupplier ? 'Yaratilmoqda...' : 'Yetkazib beruvchi yaratish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
