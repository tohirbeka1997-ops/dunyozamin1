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
import { getPurchaseOrders, getSuppliers } from '@/db/api';
import type { PurchaseOrderWithDetails, Supplier } from '@/types/database';
import { Plus, Search, FileDown, Eye, Edit, Package, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderWithDetails[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

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
        title: 'Error',
        description: 'Failed to load purchase orders',
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
      draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
      approved: { label: 'Approved', className: 'bg-primary text-primary-foreground' },
      partially_received: { label: 'Partially Received', className: 'bg-warning text-warning-foreground' },
      received: { label: 'Received', className: 'bg-success text-success-foreground' },
      cancelled: { label: 'Cancelled', className: 'bg-destructive text-destructive-foreground' },
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
          <h1 className="text-3xl font-bold">Purchase Orders</h1>
          <p className="text-muted-foreground">Manage purchase orders and receive goods</p>
        </div>
        <Button onClick={() => navigate('/purchase-orders/new')}>
          <Plus className="h-4 w-4 mr-2" />
          New Purchase Order
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
                    placeholder="Search by PO number or supplier..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="pl-9"
                  />
                </div>
                <Button onClick={handleSearch}>Search</Button>
              </div>
            </div>
            
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="partially_received">Partially Received</SelectItem>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Supplier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Suppliers</SelectItem>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={() => toast({ title: 'Export', description: 'Export feature coming soon' })}
            >
              <FileDown className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="text-sm text-muted-foreground">From Date</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">To Date</label>
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
              <p className="text-muted-foreground">No purchase orders found</p>
              <Button onClick={() => navigate('/purchase-orders/new')} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Create First Purchase Order
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Expected Date</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead className="text-right">Received Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((po) => {
                  const receivedAmount = calculateTotalReceived(po.items || []);
                  
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
                      <TableCell className="text-right">
                        ${Number(po.total_amount).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${receivedAmount.toFixed(2)}
                      </TableCell>
                      <TableCell>{getStatusBadge(po.status)}</TableCell>
                      <TableCell>
                        {po.created_by_profile?.username || 
                         po.created_by_profile?.full_name || 
                         '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/purchase-orders/${po.id}`)}
                            title="View Details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {(po.status === 'draft' || po.status === 'approved') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => navigate(`/purchase-orders/${po.id}/edit`)}
                              title="Edit"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          )}
                          {(po.status === 'approved' || po.status === 'partially_received') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => navigate(`/purchase-orders/${po.id}/receive`)}
                              title="Receive Goods"
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
    </div>
  );
}

