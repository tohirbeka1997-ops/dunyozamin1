import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { getPurchaseOrders, getSuppliers, approvePurchaseOrder } from '@/db/api';
import type { PurchaseOrderWithDetails, SupplierWithBalance } from '@/types/database';
import { Plus, Search, FileDown, Eye, Edit, Package, X, DollarSign, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { formatMoneyUZS } from '@/lib/format';
import PaySupplierDialog from '@/components/suppliers/PaySupplierDialog';

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderWithDetails[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrderWithDetails | null>(null);

  useEffect(() => {
    loadData();
  }, [statusFilter, supplierFilter, dateFrom, dateTo]);

  const loadData = async () => {
    try {
      setLoading(true);
      const filters: any = {};
      
      if (statusFilter !== 'all') {
        filters.status = statusFilter;
      }
      
      if (supplierFilter !== 'all') {
        filters.supplier_id = supplierFilter;
      }
      
      if (dateFrom) {
        filters.date_from = dateFrom;
      }
      
      if (dateTo) {
        filters.date_to = dateTo;
      }
      
      if (searchTerm) {
        filters.search = searchTerm;
      }
      
      const [ordersData, suppliersData] = await Promise.all([
        getPurchaseOrders(filters),
        getSuppliers(),
      ]);
      
      setPurchaseOrders(ordersData);
      setSuppliers(suppliersData);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Xarid buyurtmalarini yuklab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    loadData();
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      draft: { label: 'Qoralama', className: 'bg-muted text-muted-foreground' },
      approved: { label: 'Tasdiqlangan', className: 'bg-primary text-primary-foreground' },
      partially_received: { label: 'Qisman qabul qilingan', className: 'bg-warning text-warning-foreground' },
      received: { label: 'Qabul qilingan', className: 'bg-success text-success-foreground' },
      cancelled: { label: 'Bekor qilingan', className: 'bg-destructive text-destructive-foreground' },
    };
    
    const config = statusConfig[status] || { label: status, className: '' };
    return <Badge className={config.className}>{config.label}</Badge>;
  };

  const calculateTotalReceived = (items: any[]) => {
    if (!items || items.length === 0) return 0;
    return items.reduce((sum, item) => {
      const receivedQty = Number(item.received_qty) || 0;
      const unitCost = Number(item.unit_cost) || 0;
      return sum + (receivedQty * unitCost);
    }, 0);
  };

  const getPaymentStatusBadge = (status?: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      UNPAID: { label: 'To\'lanmagan', className: 'bg-destructive text-destructive-foreground' },
      PARTIALLY_PAID: { label: 'Qisman to\'langan', className: 'bg-warning text-warning-foreground' },
      PAID: { label: 'To\'langan', className: 'bg-success text-success-foreground' },
    };
    
    const config = statusConfig[status || 'UNPAID'] || statusConfig.UNPAID;
    return <Badge className={config.className}>{config.label}</Badge>;
  };

  const handlePayClick = (po: PurchaseOrderWithDetails) => {
    if (!po.supplier) {
      toast({
        title: 'Xatolik',
        description: 'Yetkazib beruvchi topilmadi',
        variant: 'destructive',
      });
      return;
    }
    setSelectedPO(po);
    setPayDialogOpen(true);
  };

  const handlePaymentSuccess = () => {
    loadData(); // Reload to refresh payment info
  };

  const handleApprove = async (poId: string) => {
    try {
      await approvePurchaseOrder(poId, 'current-user-id'); // TODO: Get actual user ID from auth context
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Xarid buyurtmasi tasdiqlandi',
      });
      loadData(); // Refresh the list
    } catch (error: any) {
      toast({
        title: 'Xatolik',
        description: error.message || 'Xarid buyurtmasini tasdiqlab bo\'lmadi',
        variant: 'destructive',
      });
    }
  };

  const filteredOrders = purchaseOrders;

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Xarid buyurtmalari</h1>
          <p className="text-muted-foreground">Xarid buyurtmalarini boshqarish va tovar qabul qilish</p>
        </div>
        <Button onClick={() => navigate('/purchase-orders/new')}>
          <Plus className="h-4 w-4 mr-2" />
          Yangi xarid buyurtmasi
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buyurtma raqami yoki yetkazib beruvchi bo'yicha qidirish..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="pl-9"
                  />
                </div>
                <Button onClick={handleSearch}>Qidirish</Button>
              </div>
            </div>
            
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Holati" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha holatlar</SelectItem>
                <SelectItem value="draft">Qoralama</SelectItem>
                <SelectItem value="approved">Tasdiqlangan</SelectItem>
                <SelectItem value="partially_received">Qisman qabul qilingan</SelectItem>
                <SelectItem value="received">Qabul qilingan</SelectItem>
                <SelectItem value="cancelled">Bekor qilingan</SelectItem>
              </SelectContent>
            </Select>

            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Yetkazib beruvchi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha yetkazib beruvchilar</SelectItem>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={() => toast({ title: 'Eksport qilish', description: 'Eksport funksiyasi tez orada qo\'shiladi' })}
            >
              <FileDown className="h-4 w-4 mr-2" />
              Eksport qilish
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="text-sm text-muted-foreground">Boshlanish sana</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Tugash sana</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filteredOrders.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Xarid buyurtmalari topilmadi</p>
              <Button onClick={() => navigate('/purchase-orders/new')} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Birinchi xarid buyurtmasini yaratish
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyurtma raqami</TableHead>
                  <TableHead>Yetkazib beruvchi</TableHead>
                  <TableHead>Sana va vaqt</TableHead>
                  <TableHead>Kutilayotgan sana</TableHead>
                  <TableHead className="text-right">Jami summa</TableHead>
                  <TableHead className="text-right">To'langan</TableHead>
                  <TableHead className="text-right">Qoldiq</TableHead>
                  <TableHead>To'lov holati</TableHead>
                  <TableHead>Holati</TableHead>
                  <TableHead className="text-right">Amallar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((po) => {
                  const paidAmount = po.paid_amount ?? 0;
                  const remainingAmount = po.remaining_amount ?? (po.total_amount - paidAmount);
                  const canPay = po.status === 'received' || po.status === 'partially_received';
                  
                  return (
                    <TableRow key={po.id}>
                      <TableCell className="font-medium">{po.po_number}</TableCell>
                      <TableCell>
                        {po.supplier?.name || po.supplier_name || '-'}
                      </TableCell>
                      <TableCell>
                        {format(new Date(po.order_date), 'MMM dd, yyyy')}
                      </TableCell>
                      <TableCell>
                        {po.expected_date 
                          ? format(new Date(po.expected_date), 'MMM dd, yyyy')
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoneyUZS(po.total_amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoneyUZS(paidAmount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={remainingAmount > 0 ? 'font-medium' : ''}>
                          {formatMoneyUZS(remainingAmount)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {getPaymentStatusBadge(po.payment_status)}
                      </TableCell>
                      <TableCell>{getStatusBadge(po.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/purchase-orders/${po.id}`)}
                            title="Tafsilotlarni ko'rish"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {canPay && remainingAmount > 0 && po.supplier && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handlePayClick(po)}
                              title="To'lov qilish"
                              className="text-primary hover:text-primary"
                            >
                              <DollarSign className="h-4 w-4" />
                            </Button>
                          )}
                          {po.status === 'draft' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleApprove(po.id)}
                              title="Tasdiqlash"
                              className="text-primary hover:text-primary"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          )}
                          {(po.status === 'draft' || po.status === 'approved') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => navigate(`/purchase-orders/${po.id}/edit`)}
                              title="Tahrirlash"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          )}
                          {(po.status === 'approved' || po.status === 'partially_received') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => navigate(`/purchase-orders/${po.id}/receive`)}
                              title="Tovar qabul qilish"
                            >
                              <Package className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pay Supplier Dialog */}
      {selectedPO && selectedPO.supplier && (
        <PaySupplierDialog
          supplier={selectedPO.supplier}
          purchaseOrder={selectedPO}
          open={payDialogOpen}
          onOpenChange={setPayDialogOpen}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
}

