import { useMemo, useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import {
  getSupplierById,
  getSupplierLedger,
  getSupplierPayments,
  getSupplierPurchaseSummary,
  listSupplierReturns,
  getSupplierActSverka,
} from '@/db/api';
import type { SupplierPayment, SupplierWithPOs, SupplierLedgerEntry } from '@/types/database';
import { ArrowLeft, Edit, Mail, Phone, MapPin, FileText, DollarSign, FileDown, RefreshCcw } from 'lucide-react';
import { formatMoneyUZS } from '@/lib/format';
import { formatDate } from '@/lib/datetime';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PaySupplierDialog from '@/components/suppliers/PaySupplierDialog';
import SupplierReturnDialog from '@/components/suppliers/SupplierReturnDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isElectron, requireElectron } from '@/utils/electron';
import { createBackNavigationState, navigateBackTo, resolveBackTarget } from '@/lib/pageState';

type SupplierReturnRow = {
  id: string;
  return_number: string;
  supplier_id: string;
  supplier_name?: string;
  purchase_order_id?: string | null;
  po_number?: string | null;
  warehouse_id: string;
  status: 'draft' | 'completed' | 'cancelled' | string;
  return_reason?: string | null;
  notes?: string | null;
  total_amount: number;
  created_by?: string | null;
  created_at: string;
  updated_at?: string;
};

export default function SupplierDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  const [supplier, setSupplier] = useState<SupplierWithPOs | null>(null);
  const settlementCurrency = String((supplier as any)?.settlement_currency || 'USD').toUpperCase();
  const formatSupplierAmount = (amount: number) => {
    if (settlementCurrency === 'USD') return `${Number(amount || 0).toFixed(2)} USD`;
    return formatMoneyUZS(amount || 0);
  };
  const [loading, setLoading] = useState(true);
  const [ledger, setLedger] = useState<SupplierLedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [purchaseSummary, setPurchaseSummary] = useState<any[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [returns, setReturns] = useState<SupplierReturnRow[]>([]);
  const [returnsLoading, setReturnsLoading] = useState(false);
  const [returnsAll, setReturnsAll] = useState<SupplierReturnRow[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const activeTab = searchParams.get('tab') || 'info';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const backTo = resolveBackTarget(location, '/suppliers');

  type ActRow = {
    id: string;
    created_at: string;
    type: 'purchase' | 'payment' | 'credit_note' | string;
    ref_no?: string | null;
    po_status?: string | null;
    in_amount: number;
    out_amount: number;
    balance_after: number;
    method?: string | null;
    note?: string | null;
    created_by_name?: string | null;
  };

  type ActResponse = {
    supplier: { id: string; name: string; settlement_currency?: string | null };
    period: { date_from?: string | null; date_to?: string | null };
    opening_balance: number;
    closing_balance: number;
    totals: { in_amount: number; out_amount: number; net_amount: number };
    rows: ActRow[];
  };

  const [actLoading, setActLoading] = useState(false);
  const [actData, setActData] = useState<ActResponse | null>(null);

  useEffect(() => {
    if (id) {
      loadSupplier();
    }
  }, [id]);

  useEffect(() => {
    if (supplier) {
      loadLedger(supplier.id);
      loadPurchaseSummary(supplier.id);
      loadReturns(supplier.id);
      loadActSverka(supplier.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier?.id, dateFrom, dateTo]);

  // Load all-time totals for summary card (do NOT depend on date filters)
  useEffect(() => {
    if (!supplier?.id) return;
    loadReturnsAll(supplier.id);
    loadPayments(supplier.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier?.id]);

  const loadSupplier = async () => {
    try {
      setLoading(true);
      // getSupplierById now returns supplier with calculated balance
      const data = await getSupplierById(id!);
      setSupplier(data);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Yetkazib beruvchini yuklab bo‘lmadi',
        variant: 'destructive',
      });
      navigate(backTo);
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
        title: 'Xatolik',
        description: 'Hisob-kitob tarixini yuklab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setLedgerLoading(false);
    }
  };

  const loadPurchaseSummary = async (supplierId: string) => {
    try {
      setSummaryLoading(true);
      const rows = await getSupplierPurchaseSummary(supplierId, dateFrom || undefined, dateTo || undefined);
      setPurchaseSummary(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.error('Failed to load purchase summary:', error);
      toast({
        title: 'Xatolik',
        description: 'Xaridlar bo‘yicha ma’lumotni yuklab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setSummaryLoading(false);
    }
  };

  const loadReturns = async (supplierId: string) => {
    try {
      setReturnsLoading(true);
      const rows = await listSupplierReturns({
        supplier_id: supplierId,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: 200,
        offset: 0,
      });
      setReturns(Array.isArray(rows) ? (rows as SupplierReturnRow[]) : []);
    } catch (error) {
      console.error('Failed to load supplier returns:', error);
      toast({
        title: 'Xatolik',
        description: 'Qaytarishlar ro‘yxatini yuklab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setReturnsLoading(false);
    }
  };

  const loadReturnsAll = async (supplierId: string) => {
    try {
      const rows = await listSupplierReturns({
        supplier_id: supplierId,
        status: 'completed',
        limit: 500,
        offset: 0,
      });
      setReturnsAll(Array.isArray(rows) ? (rows as SupplierReturnRow[]) : []);
    } catch (e) {
      console.error('Failed to load supplier returns (all):', e);
      setReturnsAll([]);
    }
  };

  const loadPayments = async (supplierId: string) => {
    try {
      setPaymentsLoading(true);
      const rows = await getSupplierPayments(supplierId);
      setPayments(Array.isArray(rows) ? rows : []);
    } catch (e) {
      console.error('Failed to load supplier payments:', e);
      setPayments([]);
    } finally {
      setPaymentsLoading(false);
    }
  };

  const loadActSverka = async (supplierId: string) => {
    try {
      setActLoading(true);
      const res = await getSupplierActSverka({
        supplier_id: supplierId,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setActData(res || null);
    } catch (e: any) {
      console.error('Failed to load supplier act sverka:', e);
      setActData(null);
    } finally {
      setActLoading(false);
    }
  };

  const exportActCsv = async () => {
    if (!actData || !supplier?.id) return;
    if (!isElectron()) {
      toast({ title: 'Xatolik', description: 'Eksport faqat desktop ilovada mavjud.', variant: 'destructive' });
      return;
    }
    const rows = actData.rows || [];
    const headers = ['date_time', 'type', 'ref_no', 'po_status', 'method', 'in_amount', 'out_amount', 'balance_after', 'note'];
    const escape = (v: any) => {
      const s = String(v ?? '');
      if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replaceAll('"', '""')}"`;
      return s;
    };
    const csv = [
      headers.join(','),
      ...rows.map((r) =>
        [
          r.created_at,
          r.type,
          r.ref_no || '',
          r.po_status || '',
          r.method || '',
          r.in_amount,
          r.out_amount,
          r.balance_after,
          r.note || '',
        ]
          .map(escape)
          .join(',')
      ),
    ].join('\n');

    const api = requireElectron();
    await api.files.saveTextFile({
      defaultFileName: `supplier-act-sverka-${supplier.name}-${dateFrom || 'all'}_${dateTo || 'all'}.csv`,
      content: csv,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      encoding: 'utf8',
    });
    toast({ title: 'Tayyor', description: 'CSV eksport qilindi.' });
  };

  const handlePaymentSuccess = () => {
    loadSupplier(); // Reload supplier to refresh balance
    if (supplier?.id) loadPayments(supplier.id);
  };

  const handleReturnSuccess = () => {
    loadSupplier();
    if (supplier?.id) {
      loadLedger(supplier.id);
      loadPurchaseSummary(supplier.id);
      loadReturns(supplier.id);
      loadReturnsAll(supplier.id);
      loadPayments(supplier.id); // credit_note also affects payments totals
    }
  };

  const summary = useMemo(() => {
    const poAll = supplier?.purchase_orders || [];
    const receivedPOs = poAll.filter((po: any) => po.status === 'received' || po.status === 'partially_received');
    const totalPurchases = receivedPOs.reduce((sum: number, po: any) => sum + (Number(po.total_amount || 0) || 0), 0);

    const paidToSupplier = payments
      .filter((p) => (Number(p.amount || 0) || 0) > 0 && p.payment_method !== 'credit_note')
      .reduce((sum, p) => sum + (Number(p.amount || 0) || 0), 0);

    const creditNotes = payments
      .filter((p) => (Number(p.amount || 0) || 0) > 0 && p.payment_method === 'credit_note')
      .reduce((sum, p) => sum + (Number(p.amount || 0) || 0), 0);

    const supplierRefunds = payments
      .filter((p) => (Number(p.amount || 0) || 0) < 0)
      .reduce((sum, p) => sum + Math.abs(Number(p.amount || 0) || 0), 0);

    const returnsTotal = returnsAll
      .filter((r) => r.status === 'completed')
      .reduce((sum, r) => sum + (Number(r.total_amount || 0) || 0), 0);

    return {
      receivedPOCount: receivedPOs.length,
      totalPurchases,
      paidToSupplier,
      creditNotes,
      supplierRefunds,
      returnsCount: returnsAll.filter((r) => r.status === 'completed').length,
      returnsTotal,
    };
  }, [supplier?.purchase_orders, payments, returnsAll]);

  const filteredPurchaseSummary = useMemo(() => {
    const term = String(productSearchTerm || '').trim().toLowerCase();
    if (!term) return purchaseSummary;
    return (purchaseSummary || []).filter((row: any) => {
      const name = String(row?.product_name || '').toLowerCase();
      const sku = String(row?.product_sku || '').toLowerCase();
      return name.includes(term) || sku.includes(term);
    });
  }, [purchaseSummary, productSearchTerm]);

  const getStatusBadge = (status: string) => {
    if (status === 'active') {
      return <Badge className="bg-success text-white">Faol</Badge>;
    }
    return <Badge className="bg-muted text-muted-foreground">Nofaol</Badge>;
  };

  const getPOStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      draft: { label: 'Qoralama', className: 'bg-muted text-muted-foreground' },
      approved: { label: 'Tasdiqlangan', className: 'bg-primary text-primary-foreground' },
      partially_received: {
        label: 'Qisman qabul qilingan',
        className: 'bg-warning text-warning-foreground',
      },
      received: { label: 'Qabul qilingan', className: 'bg-success text-white' },
      cancelled: { label: 'Bekor qilingan', className: 'bg-destructive text-destructive-foreground' },
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
        <Button onClick={() => navigate(backTo)} className="mt-4">
          Back to Suppliers
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigateBackTo(navigate, location, '/suppliers')}>
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
              className="border-primary text-primary-foreground"
            >
              <DollarSign className="h-4 w-4 mr-2" />
              To'lov qilish
            </Button>
          )}
          {supplier && (
            <Button variant="outline" onClick={() => setReturnDialogOpen(true)}>
              Postavshikka qaytarish
            </Button>
          )}
          <Button
            onClick={() =>
              navigate(`/suppliers/${id}/edit`, {
                state: createBackNavigationState(location),
              })
            }
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value === 'info') next.delete('tab');
          else next.set('tab', value);
          setSearchParams(next, { replace: true });
        }}
        className="space-y-6"
      >
        <TabsList>
          <TabsTrigger value="info">Ma'lumotlar</TabsTrigger>
          <TabsTrigger value="act">Act sverka</TabsTrigger>
          <TabsTrigger value="ledger">Hisob-kitob</TabsTrigger>
          <TabsTrigger value="products">Mahsulotlar</TabsTrigger>
          <TabsTrigger value="returns">Qaytarishlar</TabsTrigger>
        </TabsList>

        <TabsContent value="act" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Act sverka (kirdi/chiqdi)</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => supplier?.id && loadActSverka(supplier.id)} disabled={!supplier?.id || actLoading}>
                    <RefreshCcw className="h-4 w-4 mr-2" />
                    Yangilash
                  </Button>
                  <Button variant="outline" onClick={exportActCsv} disabled={!actData || (actData?.rows || []).length === 0}>
                    <FileDown className="h-4 w-4 mr-2" />
                    CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <div>
                  <Label htmlFor="actDateFrom" className="text-xs">Boshlanish</Label>
                  <Input
                    id="actDateFrom"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => {
                      const next = new URLSearchParams(searchParams);
                      if (e.target.value) next.set('dateFrom', e.target.value);
                      else next.delete('dateFrom');
                      setSearchParams(next, { replace: true });
                    }}
                    className="w-44"
                  />
                </div>
                <div>
                  <Label htmlFor="actDateTo" className="text-xs">Tugash</Label>
                  <Input
                    id="actDateTo"
                    type="date"
                    value={dateTo}
                    onChange={(e) => {
                      const next = new URLSearchParams(searchParams);
                      if (e.target.value) next.set('dateTo', e.target.value);
                      else next.delete('dateTo');
                      setSearchParams(next, { replace: true });
                    }}
                    className="w-44"
                  />
                </div>
              </div>

              {actLoading ? (
                <div className="flex justify-center py-10">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : !actData ? (
                <div className="text-center py-10 text-muted-foreground">
                  Act sverka ma'lumotlari topilmadi
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground">Opening</p>
                        <p className="text-lg font-bold">{formatSupplierAmount(actData.opening_balance || 0)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground">Kirdi</p>
                        <p className="text-lg font-bold text-primary">{formatSupplierAmount(actData.totals?.in_amount || 0)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground">Chiqdi</p>
                        <p className="text-lg font-bold text-success">{formatSupplierAmount(actData.totals?.out_amount || 0)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground">Closing</p>
                        <p className="text-lg font-bold">{formatSupplierAmount(actData.closing_balance || 0)}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sana/vaqt</TableHead>
                        <TableHead>Turi</TableHead>
                        <TableHead>Ref</TableHead>
                        <TableHead>PO status</TableHead>
                        <TableHead className="text-right">Kirdi</TableHead>
                        <TableHead className="text-right">Chiqdi</TableHead>
                        <TableHead className="text-right">Balans</TableHead>
                        <TableHead>Izoh</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(actData.rows || []).map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-xs">{r.created_at}</TableCell>
                          <TableCell>
                            <Badge className={
                              r.type === 'purchase' ? 'bg-primary text-primary-foreground' :
                              r.type === 'credit_note' ? 'bg-warning text-warning-foreground' :
                              'bg-success text-white'
                            }>
                              {r.type === 'purchase' ? 'Xarid' : r.type === 'credit_note' ? 'Credit note' : 'To‘lov'}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.ref_no || '-'}</TableCell>
                          <TableCell className="text-xs">{r.po_status || '-'}</TableCell>
                          <TableCell className="text-right">{r.in_amount > 0 ? formatSupplierAmount(r.in_amount) : '-'}</TableCell>
                          <TableCell className="text-right">{r.out_amount > 0 ? formatSupplierAmount(r.out_amount) : '-'}</TableCell>
                          <TableCell className={`text-right font-medium ${
                            (r.balance_after || 0) > 0 ? 'text-destructive' :
                            (r.balance_after || 0) < 0 ? 'text-success' : ''
                          }`}>
                            {formatSupplierAmount(r.balance_after || 0)}
                          </TableCell>
                          <TableCell className="text-xs">{r.note || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

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
                    {formatDate(supplier.created_at)}
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
                          {formatDate(po.order_date)}
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
                  {formatSupplierAmount(supplier.balance)}
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
              <div className="border-t pt-3 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Jami qabul qilingan xarid (qarz bazasi)</span>
                  <span className="font-semibold">
                    {formatMoneyUZS(summary.totalPurchases)} ({summary.receivedPOCount} ta)
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Jami pul berilgan (to'lovlar)</span>
                  <span className="font-semibold">
                    {paymentsLoading ? '...' : formatMoneyUZS(summary.paidToSupplier)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Jami qaytarishlar (credit note)</span>
                  <span className="font-semibold">
                    {returnsAll.length === 0 ? formatMoneyUZS(0) : formatMoneyUZS(summary.returnsTotal)} ({summary.returnsCount} ta)
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Jami credit note (payments ichida)</span>
                  <span className="font-semibold">
                    {paymentsLoading ? '...' : formatMoneyUZS(summary.creditNotes)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Yetkazib beruvchi qaytargan pul (avans qaytarish)</span>
                  <span className="font-semibold">
                    {paymentsLoading ? '...' : formatMoneyUZS(summary.supplierRefunds)}
                  </span>
                </div>
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
                        <TableCell>{formatDate(entry.date)}</TableCell>
                        <TableCell>
                          <Badge className={
                            entry.type === 'PURCHASE' 
                              ? 'bg-primary text-primary-foreground' 
                              : 'bg-success text-white'
                          }>
                            {entry.type === 'PURCHASE' ? 'Xarid' : 'To\'lov'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{entry.reference}</TableCell>
                        <TableCell className="text-right">
                          {entry.debit > 0 ? formatSupplierAmount(entry.debit) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {entry.credit > 0 ? formatSupplierAmount(entry.credit) : '-'}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${
                          entry.balance > 0 ? 'text-destructive' : 
                          entry.balance < 0 ? 'text-success' : ''
                        }`}>
                          {formatSupplierAmount(entry.balance)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Yetkazib beruvchidan olingan mahsulotlar (qabul qilingan)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="space-y-2">
                  <Label>Boshlanish sana</Label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Tugash sana</Label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Mahsulot qidirish</Label>
                  <Input
                    placeholder="Nomi yoki SKU bo‘yicha..."
                    value={productSearchTerm}
                    onChange={(e) => setProductSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              {summaryLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : purchaseSummary.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  Hozircha qabul qilingan mahsulotlar topilmadi
                </div>
              ) : filteredPurchaseSummary.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  Qidiruv bo‘yicha mahsulot topilmadi
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mahsulot</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Qabul qilingan</TableHead>
                      <TableHead className="text-right">Jami qiymat</TableHead>
                      <TableHead className="text-right">PO soni</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPurchaseSummary.map((row: any) => (
                      <TableRow key={row.product_id}>
                        <TableCell className="font-medium">{row.product_name}</TableCell>
                        <TableCell className="font-mono text-sm">{row.product_sku || '-'}</TableCell>
                        <TableCell className="text-right">{Number(row.total_received_qty || 0)}</TableCell>
                        <TableCell className="text-right">{formatMoneyUZS(Number(row.total_cost || 0))}</TableCell>
                        <TableCell className="text-right">{Number(row.po_count || 0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="returns" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Postavshikka qaytarishlar</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <Label className="text-sm text-muted-foreground">Boshlanish sana</Label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Tugash sana</Label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button variant="outline" className="w-full" onClick={() => supplier?.id && loadReturns(supplier.id)} disabled={returnsLoading}>
                    {returnsLoading ? 'Yuklanmoqda...' : 'Yangilash'}
                  </Button>
                </div>
              </div>

              {returnsLoading ? (
                <div className="flex justify-center items-center min-h-[200px]">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : returns.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>Hozircha qaytarishlar yo‘q</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Return #</TableHead>
                      <TableHead>Sana</TableHead>
                      <TableHead>PO</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Summa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {returns.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.return_number}</TableCell>
                        <TableCell>{formatDate(r.created_at)}</TableCell>
                        <TableCell className="font-mono text-sm">{r.po_number || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{r.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">{formatMoneyUZS(Number(r.total_amount || 0) || 0)}</TableCell>
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

      {/* Supplier Return Dialog */}
      {supplier && (
        <SupplierReturnDialog
          supplier={supplier as any}
          open={returnDialogOpen}
          onOpenChange={setReturnDialogOpen}
          onSuccess={handleReturnSuccess}
        />
      )}
    </div>
  );
}
