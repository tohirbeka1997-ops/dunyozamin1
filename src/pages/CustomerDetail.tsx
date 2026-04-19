import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
  getCustomerById,
  getOrdersByCustomer,
  getCustomerPayments,
  getCustomerLedger,
  getCustomerBonusLedger,
  adjustCustomerBonusPoints,
} from '@/db/api';
import type {
  Customer,
  OrderWithDetails,
  CustomerPayment,
  CustomerLedgerEntry,
  CustomerBonusLedgerEntry,
} from '@/types/database';
import { ArrowLeft, Edit, Mail, Phone, MapPin, Building2, FileText, ShoppingCart, DollarSign, History, RefreshCw, Gift } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { isElectron } from '@/utils/electron';
import ReceivePaymentModal from '@/components/customers/ReceivePaymentModal';
import { formatMoneyUZS, formatCustomerBalance } from '@/lib/format';
import { formatDate, formatDateTime } from '@/lib/datetime';
import { createBackNavigationState, navigateBackTo, resolveBackTarget } from '@/lib/pageState';

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [ledger, setLedger] = useState<CustomerLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [bonusLedger, setBonusLedger] = useState<CustomerBonusLedgerEntry[]>([]);
  const [bonusLedgerLoading, setBonusLedgerLoading] = useState(true);
  const [receivePaymentOpen, setReceivePaymentOpen] = useState(false);
  const [bonusAdjustOpen, setBonusAdjustOpen] = useState(false);
  const [bonusAdjustDelta, setBonusAdjustDelta] = useState('');
  const [bonusAdjustNote, setBonusAdjustNote] = useState('');
  const [bonusAdjustSaving, setBonusAdjustSaving] = useState(false);
  const activeTab = searchParams.get('tab') || 'info';
  const canAdjustBonus = profile?.role === 'admin' || profile?.role === 'manager';
  const backTo = resolveBackTarget(location, '/customers');

  useEffect(() => {
    if (id) {
      loadCustomer();
      loadOrders();
      loadPayments();
      loadLedger();
      loadBonusLedger();
    }
  }, [id]);

  // Refresh when user returns to this tab (e.g. after making credit sale in POS)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && id) {
        loadCustomer();
        loadOrders();
        loadPayments();
        loadLedger();
        loadBonusLedger();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [id]);

  const loadCustomer = async () => {
    if (!id) return;

    try {
      setLoading(true);
      const data = await getCustomerById(id);
      setCustomer(data);
    } catch (error) {
      toast({
        title: 'Xatolik',
        description: 'Mijozni yuklab bo‘lmadi',
        variant: 'destructive',
      });
      navigate(backTo);
    } finally {
      setLoading(false);
    }
  };

  const loadOrders = async () => {
    if (!id) return;

    try {
      setOrdersLoading(true);
      const data = await getOrdersByCustomer(id);
      setOrders(data);
    } catch (error) {
      console.error('Failed to load orders:', error);
    } finally {
      setOrdersLoading(false);
    }
  };

  const loadPayments = async () => {
    if (!id) return;

    try {
      setPaymentsLoading(true);
      const data = await getCustomerPayments(id);
      setPayments(data);
    } catch (error) {
      console.error('Failed to load payments:', error);
    } finally {
      setPaymentsLoading(false);
    }
  };

  const loadLedger = async () => {
    if (!id) return;

    try {
      setLedgerLoading(true);
      const data = await getCustomerLedger(id, { limit: 100 });
      setLedger(data);
    } catch (error) {
      console.error('Failed to load ledger:', error);
    } finally {
      setLedgerLoading(false);
    }
  };

  const loadBonusLedger = async () => {
    if (!id) return;
    if (!isElectron()) {
      setBonusLedger([]);
      setBonusLedgerLoading(false);
      return;
    }
    try {
      setBonusLedgerLoading(true);
      const data = await getCustomerBonusLedger(id, { limit: 200 });
      setBonusLedger(data);
    } catch (error) {
      console.error('Failed to load bonus ledger:', error);
    } finally {
      setBonusLedgerLoading(false);
    }
  };

  const handlePaymentSuccess = () => {
    loadCustomer();
    loadPayments();
    loadLedger(); // Refresh ledger after payment
    loadBonusLedger();
  };

  const handleRefresh = () => {
    loadCustomer();
    loadOrders();
    loadPayments();
    loadLedger();
    loadBonusLedger();
  };

  const handleBonusAdjust = async () => {
    if (!id || !profile?.id) return;
    const delta = Number(bonusAdjustDelta);
    if (!Number.isFinite(delta) || delta === 0) {
      toast({ title: 'Xatolik', description: 'Nol dan farqli ball kiriting', variant: 'destructive' });
      return;
    }
    try {
      setBonusAdjustSaving(true);
      const updated = await adjustCustomerBonusPoints({
        actorUserId: profile.id,
        customerId: id,
        deltaPoints: delta,
        note: bonusAdjustNote.trim() || undefined,
      });
      setCustomer(updated);
      setBonusAdjustOpen(false);
      setBonusAdjustDelta('');
      setBonusAdjustNote('');
      await loadBonusLedger();
      toast({ title: 'Saqlandi', description: 'Bonus balansi yangilandi' });
    } catch (e: any) {
      toast({
        title: 'Xatolik',
        description: e?.message || 'Saqlab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setBonusAdjustSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    return status === 'active' ? (
      <Badge className="bg-success text-success-foreground">Faol</Badge>
    ) : (
      <Badge variant="outline">Nofaol</Badge>
    );
  };

  const getTypeBadge = (type: string) => {
    return type === 'company' ? (
      <Badge variant="secondary">Yuridik shaxs</Badge>
    ) : (
      <Badge variant="outline">Jismoniy shaxs</Badge>
    );
  };

  // Use formatCustomerBalance helper for consistency

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Mijoz topilmadi</p>
        <Button className="mt-4" onClick={() => navigate(backTo)}>
          Mijozlar ro‘yxatiga qaytish
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigateBackTo(navigate, location, '/customers')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{customer.name}</h1>
            <p className="text-muted-foreground">Mijoz profili</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Always show balance operation button */}
          <Button onClick={() => setReceivePaymentOpen(true)} variant="default" className="bg-green-600 hover:bg-green-700 text-white">
            <DollarSign className="h-4 w-4 mr-2" />
            Hisob operatsiyasi
          </Button>
          <Button onClick={handleRefresh} variant="outline" size="icon" title="Yangilash">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            onClick={() =>
              navigate(`/customers/${id}/edit`, {
                state: createBackNavigationState(location),
              })
            }
            variant="outline"
          >
            <Edit className="h-4 w-4 mr-2" />
            Tahrirlash
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jami savdo</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatMoneyUZS(
                !ordersLoading && orders.length > 0
                  ? orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0)
                  : (customer.total_sales ?? 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground">Umumiy (barcha davr)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jami buyurtma</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {!ordersLoading ? orders.length : (customer.total_orders ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground">Umumiy (barcha davr)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Balans</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {(() => {
              const balanceInfo = formatCustomerBalance(customer.balance);
              return (
                <>
                  <div className="text-2xl font-bold">
                    <Badge variant={balanceInfo.variant} className={balanceInfo.type === 'balance' ? 'bg-green-600 text-white hover:bg-green-700' : ''}>
                      {balanceInfo.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">Joriy balans</p>
                </>
              );
            })()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bonus ball</CardTitle>
            <Gift className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Math.round(Number(customer.bonus_points) || 0)}</div>
            <p className="text-xs text-muted-foreground">Joriy balans</p>
            {canAdjustBonus && isElectron() && (
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setBonusAdjustOpen(true)}>
                Korreksiya
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {(() => {
        const balanceInfo = formatCustomerBalance(customer.balance);
        const hasDebt = (customer.balance || 0) < 0;
        
        if (!hasDebt) return null;
        
        return (
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Qarz</span>
                <Badge variant="destructive">Qarzdor</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Joriy qarz:</span>
                <span className="text-2xl font-bold text-destructive">
                  {formatMoneyUZS(Math.abs(customer.balance || 0))}
                </span>
              </div>
            {customer.credit_limit > 0 && (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Nasiya limiti:</span>
                  <span className="text-lg font-semibold">{formatMoneyUZS(customer.credit_limit)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Qolgan limit:</span>
                  {(() => {
                    const currentDebt = Math.max(0, -(customer.balance || 0));
                    const remaining = Math.max(0, (customer.credit_limit || 0) - currentDebt);
                    return (
                      <span className={`text-lg font-semibold ${remaining > 0 ? 'text-success' : 'text-destructive'}`}>
                        {formatMoneyUZS(remaining)}
                      </span>
                    );
                  })()}
                </div>
              </>
            )}
            <Button 
              className="w-full bg-green-600 hover:bg-green-700 text-white" 
              onClick={() => setReceivePaymentOpen(true)}
            >
              <DollarSign className="h-4 w-4 mr-2" />
              Qarz to'lovini qabul qilish
            </Button>
          </CardContent>
        </Card>
        );
      })()}

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value === 'info') next.delete('tab');
          else next.set('tab', value);
          setSearchParams(next, { replace: true });
        }}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="info">Ma’lumot</TabsTrigger>
          <TabsTrigger value="orders">Buyurtmalar ({orders.length})</TabsTrigger>
          <TabsTrigger value="payments">To‘lovlar ({payments.length})</TabsTrigger>
          <TabsTrigger value="ledger">Hisob tarixi ({ledger.length})</TabsTrigger>
          <TabsTrigger value="bonus">Bonus tarixi ({bonusLedger.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Aloqa ma’lumotlari</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <Phone className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <Label className="text-muted-foreground">Telefon</Label>
                    <p className="font-medium">{customer.phone || '-'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Mail className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <Label className="text-muted-foreground">Email</Label>
                    <p className="font-medium">{customer.email || '-'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <Label className="text-muted-foreground">Manzil</Label>
                    <p className="font-medium">{customer.address || '-'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <Label className="text-muted-foreground">Turi</Label>
                    <p className="font-medium">{getTypeBadge(customer.type)}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {customer.type === 'company' && (
            <Card>
              <CardHeader>
                <CardTitle>Kompaniya ma’lumotlari</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-start gap-3">
                    <Building2 className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <Label className="text-muted-foreground">Kompaniya nomi</Label>
                      <p className="font-medium">{customer.company_name || '-'}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <Label className="text-muted-foreground">INN</Label>
                      <p className="font-medium">{customer.tax_number || '-'}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Qo‘shimcha ma’lumot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-muted-foreground">Holati</Label>
                <p className="font-medium mt-1">{getStatusBadge(customer.status)}</p>
              </div>

              <div>
                <Label className="text-muted-foreground">Oxirgi buyurtma</Label>
                <p className="font-medium">
                  {customer.last_order_date
                    ? formatDate(customer.last_order_date)
                    : 'Hali buyurtma yo‘q'}
                </p>
              </div>

              {customer.notes && (
                <div>
                  <Label className="text-muted-foreground">Izoh</Label>
                  <p className="font-medium whitespace-pre-wrap">{customer.notes}</p>
                </div>
              )}

              <div>
                <Label className="text-muted-foreground">Yaratilgan sana</Label>
                <p className="font-medium">{formatDateTime(customer.created_at)}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card>
            <CardHeader>
              <CardTitle>Buyurtmalar tarixi</CardTitle>
            </CardHeader>
            <CardContent>
              {ordersLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">Bu mijoz bo‘yicha buyurtmalar topilmadi</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Buyurtma raqami</TableHead>
                      <TableHead>Sana</TableHead>
                      <TableHead className="text-right">Jami</TableHead>
                      <TableHead>Holat</TableHead>
                      <TableHead className="text-right">Amal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">{order.order_number}</TableCell>
                        <TableCell>{formatDate(order.created_at)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoneyUZS(order.total_amount)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              order.status === 'completed'
                                ? 'default'
                                : order.status === 'hold'
                                  ? 'secondary'
                                  : 'outline'
                            }
                          >
                            {order.status === 'completed'
                              ? 'Tugallangan'
                              : order.status === 'hold'
                                ? 'Kutilmoqda'
                                : order.status === 'refunded'
                                  ? 'Qaytarilgan'
                                  : order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              navigate(`/orders/${order.id}`, {
                                state: createBackNavigationState(location),
                              })
                            }
                          >
                            Ko‘rish
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
        <TabsContent value="payments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>To‘lovlar tarixi</CardTitle>
            </CardHeader>
            <CardContent>
              {paymentsLoading ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">To‘lovlar yuklanmoqda...</p>
                </div>
              ) : payments.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">To‘lovlar tarixi yo‘q</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>To‘lov raqami</TableHead>
                      <TableHead>Sana/vaqt</TableHead>
                      <TableHead>Usul</TableHead>
                      <TableHead className="text-right">Summa</TableHead>
                      <TableHead>Izoh</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="font-medium">{payment.payment_number}</TableCell>
                        <TableCell>{formatDateTime(payment.created_at)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {payment.payment_method === 'cash'
                              ? 'Naqd'
                              : payment.payment_method === 'card'
                                ? 'Karta'
                                : payment.payment_method === 'qr'
                                  ? 'QR'
                                  : payment.payment_method}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-success">
                          {formatMoneyUZS(payment.amount)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {payment.notes || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ledger" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Hisob tarixi</CardTitle>
            </CardHeader>
            <CardContent>
              {ledgerLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : ledger.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">Hisob tarixi yo'q</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sana/vaqt</TableHead>
                      <TableHead>Tur</TableHead>
                      <TableHead>Izoh</TableHead>
                      <TableHead className="text-right">Summa</TableHead>
                      <TableHead className="text-right">Balans</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledger.map((entry) => {
                      const getTypeLabel = (type: string) => {
                        switch (type) {
                          case 'sale': return 'Sotuv';
                          case 'payment_in': return 'Pul qabul qilindi';
                          case 'payment_out': return 'Pul berildi';
                          case 'refund': return 'Qaytarish';
                          case 'adjustment': return 'Tuzatish';
                          case 'payment': return 'To\'lov'; // Legacy support
                          default: return type;
                        }
                      };

                      const getTypeBadge = (type: string) => {
                        let variant: 'default' | 'secondary' | 'outline' | 'destructive' = 'default';
                        if (type === 'payment_in' || type === 'payment') {
                          variant = 'default';
                        } else if (type === 'payment_out') {
                          variant = 'outline';
                        } else if (type === 'sale') {
                          variant = 'secondary';
                        } else if (type === 'refund') {
                          variant = 'outline';
                        } else {
                          variant = 'destructive';
                        }
                        return (
                          <Badge variant={variant}>{getTypeLabel(type)}</Badge>
                        );
                      };

                      const handleRowClick = () => {
                        if (entry.type === 'sale' && entry.ref_id) {
                          navigate(`/orders/${entry.ref_id}`, {
                            state: createBackNavigationState(location),
                          });
                        } else if (entry.type === 'refund' && entry.ref_id) {
                          navigate(`/returns/${entry.ref_id}`, {
                            state: createBackNavigationState(location),
                          });
                        }
                        // Payment entries don't navigate (or could open a read-only modal)
                      };

                      const isClickable = (entry.type === 'sale' || entry.type === 'refund') && entry.ref_id;

                      return (
                        <TableRow 
                          key={entry.id}
                          onClick={isClickable ? handleRowClick : undefined}
                          className={isClickable ? 'cursor-pointer hover:bg-muted/50' : ''}
                        >
                          <TableCell>
                            {formatDateTime(entry.created_at)}
                          </TableCell>
                          <TableCell>{getTypeBadge(entry.type)}</TableCell>
                          <TableCell>
                            {entry.ref_no ? (
                              <span className="font-medium">{entry.ref_no}</span>
                            ) : entry.note ? (
                              <span className="text-muted-foreground">{entry.note}</span>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${entry.amount >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                            {entry.amount >= 0 ? '+' : ''}{formatMoneyUZS(entry.amount)}
                          </TableCell>
                          <TableCell>
                            {entry.method ? (
                              <Badge variant="outline" className="capitalize">
                                {entry.method}
                              </Badge>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {(() => {
                              const balanceInfo = formatCustomerBalance(entry.balance_after);
                              return (
                                <Badge variant={balanceInfo.variant} className={balanceInfo.type === 'balance' ? 'bg-green-600 text-white hover:bg-green-700' : ''}>
                                  {balanceInfo.label}
                                </Badge>
                              );
                            })()}
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

        <TabsContent value="bonus" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Bonus ball tarixi</CardTitle>
              {canAdjustBonus && isElectron() && (
                <Button variant="outline" size="sm" onClick={() => setBonusAdjustOpen(true)}>
                  Korreksiya
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {!isElectron() ? (
                <p className="text-sm text-muted-foreground">Bonus tarixi faqat desktop ilovada ko‘rinadi.</p>
              ) : bonusLedgerLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : bonusLedger.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Yozuvlar yo‘q</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sana</TableHead>
                      <TableHead>Tur</TableHead>
                      <TableHead>Ball</TableHead>
                      <TableHead>Buyurtma</TableHead>
                      <TableHead>Izoh</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bonusLedger.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{formatDateTime(row.created_at)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {row.type === 'earn' ? 'Yig‘ildi' : row.type === 'redeem' ? 'Ishlatildi' : row.type === 'adjust' ? 'Korreksiya' : row.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono font-medium">
                          {Number(row.points) > 0 ? '+' : ''}
                          {Number(row.points)}
                        </TableCell>
                        <TableCell>
                          {row.order_id ? (
                            <Button
                              variant="link"
                              className="h-auto p-0"
                              onClick={() =>
                                navigate(`/orders/${row.order_id}`, {
                                  state: createBackNavigationState(location),
                                })
                              }
                            >
                              Ochish
                            </Button>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[240px] truncate" title={row.note || ''}>
                          {row.note || '—'}
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

      <Dialog open={bonusAdjustOpen} onOpenChange={setBonusAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bonus korreksiyasi</DialogTitle>
            <DialogDescription>
              Ijobiy qiymat qo‘shadi, manfiy ayiradi. Harakat bonus jurnaliga yoziladi.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Ball (±)</Label>
              <Input
                type="number"
                step="1"
                value={bonusAdjustDelta}
                onChange={(e) => setBonusAdjustDelta(e.target.value)}
                placeholder="Masalan: 100 yoki -50"
              />
            </div>
            <div className="space-y-1">
              <Label>Izoh</Label>
              <Textarea
                value={bonusAdjustNote}
                onChange={(e) => setBonusAdjustNote(e.target.value)}
                placeholder="Sabab"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBonusAdjustOpen(false)}>
              Bekor
            </Button>
            <Button onClick={handleBonusAdjust} disabled={bonusAdjustSaving}>
              {bonusAdjustSaving ? 'Saqlanmoqda...' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceivePaymentModal
        open={receivePaymentOpen}
        onOpenChange={setReceivePaymentOpen}
        customer={customer}
        source="customers"
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
}
