import { useState, useEffect } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { getSupplierById, getSupplierLedger, getSuppliers } from '@/db/api';
import type { SupplierWithPOs, SupplierLedgerEntry } from '@/types/database';
import { ArrowLeft, Edit, Mail, Phone, MapPin, FileText, DollarSign } from 'lucide-react';
import { format } from 'date-fns';
import { formatMoneyUZS } from '@/lib/format';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PaySupplierDialog from '@/components/suppliers/PaySupplierDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SupplierDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [supplier, setSupplier] = useState<SupplierWithPOs | null>(null);
  const [loading, setLoading] = useState(true);
  const [ledger, setLedger] = useState<SupplierLedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (id) {
      loadSupplier();
    }
  }, [id]);

  useEffect(() => {
    if (supplier) {
      loadLedger(supplier.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier?.id, dateFrom, dateTo]);

  const loadSupplier = async () => {
    try {
      setLoading(true);
      // getSupplierById now returns supplier with calculated balance
      const data = await getSupplierById(id!);
      setSupplier(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load supplier',
        variant: 'destructive',
      });
      navigate('/suppliers');
    } finally {
      setLoading(false);
    }
  };

  const loadLedger = async (supplierId: string) => {
    try {
      setLedgerLoading(true);
      const ledgerData = await getSupplierLedger(supplierId, dateFrom || undefined, dateTo || undefined);
      setLedger(ledgerData);
    } catch (error) {
      console.error('Failed to load ledger:', error);
      toast({
        title: 'Error',
        description: 'Failed to load ledger',
        variant: 'destructive',
      });
    } finally {
      setLedgerLoading(false);
    }
  };

  const handlePaymentSuccess = () => {
    loadSupplier(); // Reload supplier to refresh balance
  };

  const getStatusBadge = (status: string) => {
    if (status === 'active') {
      return <Badge className="bg-success text-success-foreground">Active</Badge>;
    }
    return <Badge className="bg-muted text-muted-foreground">Inactive</Badge>;
  };

  const getPOStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
      approved: { label: 'Approved', className: 'bg-primary text-primary-foreground' },
      partially_received: {
        label: 'Partially Received',
        className: 'bg-warning text-warning-foreground',
      },
      received: { label: 'Received', className: 'bg-success text-success-foreground' },
      cancelled: { label: 'Cancelled', className: 'bg-destructive text-destructive-foreground' },
    };

    const config = statusConfig[status] || { label: status, className: '' };
    return <Badge className={config.className}>{config.label}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Supplier not found</p>
        <Button onClick={() => navigate('/suppliers')} className="mt-4">
          Back to Suppliers
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/suppliers')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{supplier.name}</h1>
            <p className="text-muted-foreground">Supplier Details</p>
          </div>
        </div>
        <div className="flex gap-2">
          {supplier && (
            <Button 
              variant="outline"
              onClick={() => setPayDialogOpen(true)}
              className="border-primary text-primary"
            >
              <DollarSign className="h-4 w-4 mr-2" />
              To'lov qilish
            </Button>
          )}
          <Button onClick={() => navigate(`/suppliers/${id}/edit`)}>
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
        </div>
      </div>

      <Tabs defaultValue="info" className="space-y-6">
        <TabsList>
          <TabsTrigger value="info">Ma'lumotlar</TabsTrigger>
          <TabsTrigger value="ledger">Hisob-kitob</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Supplier Information */}
          <Card>
            <CardHeader>
              <CardTitle>Supplier Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Supplier Name</p>
                  <p className="font-medium">{supplier.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <div className="mt-1">{getStatusBadge(supplier.status)}</div>
                </div>
                {supplier.contact_person && (
                  <div>
                    <p className="text-sm text-muted-foreground">Contact Person</p>
                    <p className="font-medium">{supplier.contact_person}</p>
                  </div>
                )}
                {supplier.phone && (
                  <div>
                    <p className="text-sm text-muted-foreground">Phone</p>
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <p className="font-medium">{supplier.phone}</p>
                    </div>
                  </div>
                )}
                {supplier.email && (
                  <div>
                    <p className="text-sm text-muted-foreground">Email</p>
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <p className="font-medium">{supplier.email}</p>
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Created Date</p>
                  <p className="font-medium">
                    {format(new Date(supplier.created_at), 'MMM dd, yyyy')}
                  </p>
                </div>
              </div>
              {supplier.address && (
                <div className="mt-4">
                  <p className="text-sm text-muted-foreground">Address</p>
                  <div className="flex items-start gap-2 mt-1">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <p>{supplier.address}</p>
                  </div>
                </div>
              )}
              {supplier.note && (
                <div className="mt-4">
                  <p className="text-sm text-muted-foreground">Notes</p>
                  <div className="flex items-start gap-2 mt-1">
                    <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <p>{supplier.note}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Purchase Orders */}
          <Card>
            <CardHeader>
              <CardTitle>Purchase Orders</CardTitle>
            </CardHeader>
            <CardContent>
              {!supplier.purchase_orders || supplier.purchase_orders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No purchase orders found for this supplier</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO Number</TableHead>
                      <TableHead>Order Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {supplier.purchase_orders.map((po) => (
                      <TableRow key={po.id}>
                        <TableCell className="font-medium">{po.po_number}</TableCell>
                        <TableCell>
                          {format(new Date(po.order_date), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell>{getPOStatusBadge(po.status)}</TableCell>
                        <TableCell className="text-right">
                          {formatMoneyUZS(po.total_amount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/purchase-orders/${po.id}`)}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Umumiy ma'lumot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Joriy balans</p>
                <p className={`text-2xl font-bold ${supplier.balance > 0 ? 'text-destructive' : supplier.balance < 0 ? 'text-success' : ''}`}>
                  {formatMoneyUZS(supplier.balance)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {supplier.balance > 0 ? 'Qarz (biz yetkazib beruvchiga qarzdormiz)' : 
                   supplier.balance < 0 ? 'Avans (yetkazib beruvchi bizga qarzdor)' : 
                   'Balans nol'}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Jami xarid buyurtmalari</p>
                <p className="text-2xl font-bold">
                  {supplier.purchase_orders?.length || 0}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Jami summa</p>
                <p className="text-2xl font-bold">
                  {formatMoneyUZS((supplier.purchase_orders || [])
                    .reduce((sum, po) => sum + po.total_amount, 0))}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Faol buyurtmalar</p>
                <p className="text-2xl font-bold">
                  {(supplier.purchase_orders || []).filter(
                    (po) => po.status === 'approved' || po.status === 'partially_received'
                  ).length}
                </p>
              </div>
            </CardContent>
          </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="ledger" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Hisob-kitob</CardTitle>
                <div className="flex gap-2">
                  <div>
                    <Label htmlFor="dateFrom" className="text-xs">Boshlanish</Label>
                    <Input
                      id="dateFrom"
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="w-40"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dateTo" className="text-xs">Tugash</Label>
                    <Input
                      id="dateTo"
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="w-40"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {ledgerLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : ledger.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>Hisob-kitob ma'lumotlari topilmadi</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sana</TableHead>
                      <TableHead>Turi</TableHead>
                      <TableHead>Ma'lumot</TableHead>
                      <TableHead className="text-right">Debet</TableHead>
                      <TableHead className="text-right">Kredit</TableHead>
                      <TableHead className="text-right">Balans</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledger.map((entry, index) => (
                      <TableRow key={index}>
                        <TableCell>{format(new Date(entry.date), 'dd.MM.yyyy')}</TableCell>
                        <TableCell>
                          <Badge className={
                            entry.type === 'PURCHASE' 
                              ? 'bg-primary text-primary-foreground' 
                              : 'bg-success text-success-foreground'
                          }>
                            {entry.type === 'PURCHASE' ? 'Xarid' : 'To\'lov'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{entry.reference}</TableCell>
                        <TableCell className="text-right">
                          {entry.debit > 0 ? formatMoneyUZS(entry.debit) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {entry.credit > 0 ? formatMoneyUZS(entry.credit) : '-'}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${
                          entry.balance > 0 ? 'text-destructive' : 
                          entry.balance < 0 ? 'text-success' : ''
                        }`}>
                          {formatMoneyUZS(entry.balance)}
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

      {/* Pay Supplier Dialog */}
      {supplier && (
        <PaySupplierDialog
          supplier={supplier}
          purchaseOrder={null}
          open={payDialogOpen}
          onOpenChange={setPayDialogOpen}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
}
