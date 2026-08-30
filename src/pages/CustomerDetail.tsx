import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
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
import {
  getCustomerById,
  getOrdersByCustomer,
  getCustomerPayments,
  getCustomerLedger,
  getCustomerBonusLedger,
  adjustCustomerBonusPoints,
  getCustomerLoyaltyCard,
  reissueCustomerLoyaltyCard,
} from '@/db/api';
import type {
  Customer,
  OrderWithDetails,
  CustomerPayment,
  CustomerLedgerEntry,
  CustomerBonusLedgerEntry,
  CustomerLoyaltyCard,
} from '@/types/database';
import { ArrowLeft, Edit, Mail, Phone, MapPin, Building2, FileText, ShoppingCart, DollarSign, History, RefreshCw, Gift, AlertTriangle, Loader2, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { isElectron } from '@/utils/electron';
import ReceivePaymentModal from '@/components/customers/ReceivePaymentModal';
import { formatMoneyUZS, formatCustomerBalance, splitCustomerLedgerAmount } from '@/lib/format';
import { formatOrderMoney, getCustomerBalances, formatMoney, normalizeCurrency } from '@/lib/currency';
import { DualCurrencyAmount } from '@/components/common/DualCurrencyAmount';
import { formatDate, formatDateTime, parseDbDate, todayYMD } from '@/lib/datetime';
import { createBackNavigationState, navigateBackTo, resolveBackTarget } from '@/lib/pageState';
import QRCodeDataUrl from '@/components/ui/qrcodedataurl';
import { listOpenCreditOrders, type OpenCreditOrderRow } from '@/db/customerCredit.api';
import CustomerCreditOrdersSheet from '@/components/customers/CustomerCreditOrdersSheet';
import { fetchUzsPerUsdRate } from '@/lib/fxRate';

const PAYMENTS_PAGE_SIZE = 200;
const LEDGER_PAGE_SIZE = 100;

function isActiveOrderForStats(order: { status?: string } | null | undefined) {
  const s = String(order?.status || '').toLowerCase();
  return s !== 'voided' && s !== 'refunded' && s !== 'returned' && s !== 'amended';
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [ledger, setLedger] = useState<CustomerLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [paymentsHasMore, setPaymentsHasMore] = useState(false);
  const [ledgerHasMore, setLedgerHasMore] = useState(false);
  const [paymentsLoadingMore, setPaymentsLoadingMore] = useState(false);
  const [ledgerLoadingMore, setLedgerLoadingMore] = useState(false);
  const [usdRate, setUsdRate] = useState<number | null>(null);
  const [bonusLedger, setBonusLedger] = useState<CustomerBonusLedgerEntry[]>([]);
  const [bonusLedgerLoading, setBonusLedgerLoading] = useState(true);
  const [loyaltyCard, setLoyaltyCard] = useState<CustomerLoyaltyCard | null>(null);
  const [loyaltyCardLoading, setLoyaltyCardLoading] = useState(true);
  const [receivePaymentOpen, setReceivePaymentOpen] = useState(false);
  const [bonusAdjustOpen, setBonusAdjustOpen] = useState(false);
  const [bonusAdjustDelta, setBonusAdjustDelta] = useState<number | null>(null);
  const [bonusAdjustNote, setBonusAdjustNote] = useState('');
  const [bonusAdjustSaving, setBonusAdjustSaving] = useState(false);
  const [bonusLargeApproved, setBonusLargeApproved] = useState(false);
  const [loyaltyReissueOpen, setLoyaltyReissueOpen] = useState(false);
  const [loyaltyReissueReason, setLoyaltyReissueReason] = useState('');
  const [loyaltyReissueSaving, setLoyaltyReissueSaving] = useState(false);
  const [ledgerOrder, setLedgerOrder] = useState<'newest' | 'oldest'>('newest');
  const [openCreditOrders, setOpenCreditOrders] = useState<OpenCreditOrderRow[]>([]);
  const [creditOrdersLoading, setCreditOrdersLoading] = useState(true);
  const [creditOrdersSheetOpen, setCreditOrdersSheetOpen] = useState(false);
  const activeTab = searchParams.get('tab') || 'info';
  const canAdjustBonus = profile?.role === 'admin' || profile?.role === 'manager';
  const backTo = resolveBackTarget(location, '/customers');

  const displayedLedger = useMemo(() => {
    const list = [...ledger];
    list.sort((a, b) => {
      const at = parseDbDate(a.created_at).getTime();
      const bt = parseDbDate(b.created_at).getTime();
      const safeA = Number.isFinite(at) ? at : 0;
      const safeB = Number.isFinite(bt) ? bt : 0;
      return ledgerOrder === 'newest' ? safeB - safeA : safeA - safeB;
    });
    return list;
  }, [ledger, ledgerOrder]);

  const activeOrders = useMemo(
    () => orders.filter((o) => isActiveOrderForStats(o)),
    [orders],
  );

  const orderSalesSummary = useMemo(() => {
    let uzs = 0;
    let usd = 0;
    let uzsEquiv = 0;
    for (const o of activeOrders) {
      const amt = Number(o.total_amount || 0) || 0;
      if (normalizeCurrency(o.currency) === 'USD') {
        usd += amt;
        const fx = Number(o.fx_rate || 0) || 0;
        uzsEquiv += fx > 0 ? amt * fx : 0;
      } else {
        uzs += amt;
        uzsEquiv += amt;
      }
    }
    return { uzs, usd, uzsEquiv };
  }, [activeOrders]);

  const ordersTabCount = ordersError
    ? (customer?.total_orders ?? 0)
    : ordersLoading
      ? (customer?.total_orders ?? 0)
      : activeOrders.length;
  const ordersCountIsFallback = !!ordersError || ordersLoading;

  const creditOrdersSummary = useMemo(() => {
    let totalRemaining = 0;
    let overdueAmount = 0;
    let overdueCount = 0;
    let nextDue: string | null = null;
    const today = todayYMD();
    for (const row of openCreditOrders) {
      const rem = Number(row.credit_amount || 0) || 0;
      totalRemaining += rem;
      const due = row.due_date ? String(row.due_date).slice(0, 10) : '';
      if (due.length === 10 && due < today) {
        overdueCount += 1;
        overdueAmount += rem;
      }
      if (due.length === 10 && due >= today) {
        if (!nextDue || due < nextDue) nextDue = due;
      }
    }
    return { totalRemaining, overdueCount, overdueAmount, nextDue };
  }, [openCreditOrders]);

  const balanceMetrics = useMemo(() => {
    if (!customer) {
      return { advance: 0, openDebt: 0, net: 0 };
    }
    const b = getCustomerBalances(customer);
    const advance = Math.max(0, b.uzs) + Math.max(0, b.usd);
    // Display UZS-primary: keep separate in UI; net is informational only
    const openDebt = Math.max(0, -b.uzs);
    const net = b.uzs;
    return { advance: Math.max(0, b.uzs), openDebt, net, usdAdvance: Math.max(0, b.usd), usdDebt: Math.max(0, -b.usd) };
  }, [customer]);

  useEffect(() => {
    void fetchUzsPerUsdRate().then((r) => setUsdRate(r && r > 0 ? r : null));
  }, []);

  useEffect(() => {
    if (id) {
      loadCustomer();
      loadOrders();
      loadPayments();
      loadLedger();
      loadBonusLedger();
      loadLoyaltyCard();
    }
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
      setOrdersError(null);
      const data = await getOrdersByCustomer(id);
      setOrders(data);
    } catch (error) {
      console.error('Failed to load orders:', error);
      setOrders([]);
      setOrdersError(error instanceof Error ? error.message : 'Buyurtmalar ro‘yxatini yuklab bo‘lmadi');
      toast({
        title: 'Xatolik',
        description: 'Buyurtmalar ro‘yxatini yuklab bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setOrdersLoading(false);
    }
  };

  const loadPayments = async (opts?: { append?: boolean }) => {
    if (!id) return;
    const append = !!opts?.append;

    try {
      if (append) setPaymentsLoadingMore(true);
      else setPaymentsLoading(true);
      const offset = append ? payments.length : 0;
      const data = await getCustomerPayments(id, { limit: PAYMENTS_PAGE_SIZE, offset });
      const rows = Array.isArray(data) ? data : [];
      setPayments((prev) => (append ? [...prev, ...rows] : rows));
      setPaymentsHasMore(rows.length === PAYMENTS_PAGE_SIZE);
    } catch (error) {
      console.error('Failed to load payments:', error);
    } finally {
      if (append) setPaymentsLoadingMore(false);
      else setPaymentsLoading(false);
    }
  };

  const loadLedger = async (opts?: { append?: boolean }) => {
    if (!id) return;
    const append = !!opts?.append;

    try {
      if (append) setLedgerLoadingMore(true);
      else setLedgerLoading(true);
      const offset = append ? ledger.length : 0;
      const data = await getCustomerLedger(id, { limit: LEDGER_PAGE_SIZE, offset });
      const rows = Array.isArray(data) ? data : [];
      setLedger((prev) => (append ? [...prev, ...rows] : rows));
      setLedgerHasMore(rows.length === LEDGER_PAGE_SIZE);
    } catch (error) {
      console.error('Failed to load ledger:', error);
    } finally {
      if (append) setLedgerLoadingMore(false);
      else setLedgerLoading(false);
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

  const loadLoyaltyCard = async () => {
    if (!id) return;
    if (!isElectron()) {
      setLoyaltyCard(null);
      setLoyaltyCardLoading(false);
      return;
    }
    try {
      setLoyaltyCardLoading(true);
      const data = await getCustomerLoyaltyCard(id);
      setLoyaltyCard(data);
    } catch (error) {
      console.error('Failed to load loyalty card:', error);
      setLoyaltyCard(null);
    } finally {
      setLoyaltyCardLoading(false);
    }
  };

  const loadOpenCreditOrders = useCallback(async () => {
    if (!id) return;
    try {
      setCreditOrdersLoading(true);
      const data = await listOpenCreditOrders({ customerId: id, limit: 100 });
      setOpenCreditOrders(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load open credit orders:', error);
      setOpenCreditOrders([]);
    } finally {
      setCreditOrdersLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) void loadOpenCreditOrders();
  }, [id, loadOpenCreditOrders]);

  // Refresh when user returns to this tab (e.g. after making credit sale in POS)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && id) {
        loadCustomer();
        loadOrders();
        loadPayments();
        loadLedger();
        loadBonusLedger();
        loadLoyaltyCard();
        loadOpenCreditOrders();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [id, loadOpenCreditOrders]);

  const handlePaymentSuccess = () => {
    loadCustomer();
    loadPayments();
    loadLedger(); // Refresh ledger after payment
    loadBonusLedger();
    loadOpenCreditOrders();
  };

  const handleRefresh = () => {
    loadCustomer();
    loadOrders();
    loadPayments();
    loadLedger();
    loadBonusLedger();
    loadLoyaltyCard();
    loadOpenCreditOrders();
  };

  const handleBonusAdjust = async () => {
    if (!id || !profile?.id) return;
    const delta = bonusAdjustDelta;
    if (delta == null || !Number.isInteger(delta) || delta === 0) {
      toast({ title: 'Xatolik', description: 'Nol dan farqli butun son kiriting', variant: 'destructive' });
      return;
    }
    if (!bonusAdjustNote.trim()) {
      toast({ title: 'Xatolik', description: 'Sabab majburiy', variant: 'destructive' });
      return;
    }
    try {
      setBonusAdjustSaving(true);
      const updated = await adjustCustomerBonusPoints({
        actorUserId: profile.id,
        customerId: id,
        deltaPoints: delta,
        note: bonusAdjustNote.trim(),
        largeApproved: bonusLargeApproved || profile.role === 'admin',
      });
      setCustomer(updated);
      setBonusAdjustOpen(false);
      setBonusAdjustDelta(null);
      setBonusAdjustNote('');
      setBonusLargeApproved(false);
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

  const handleLoyaltyReissue = async () => {
    if (!id || !profile?.id) return;
    if (!loyaltyReissueReason.trim()) {
      toast({ title: 'Xatolik', description: 'Qayta chiqarish sababi majburiy', variant: 'destructive' });
      return;
    }
    try {
      setLoyaltyReissueSaving(true);
      const card = await reissueCustomerLoyaltyCard({
        actorUserId: profile.id,
        customerId: id,
        reason: loyaltyReissueReason.trim(),
      });
      setLoyaltyCard(card);
      setLoyaltyReissueOpen(false);
      setLoyaltyReissueReason('');
      toast({ title: 'Yangilandi', description: 'Loyalty QR qayta chiqarildi' });
    } catch (e: any) {
      toast({
        title: 'Xatolik',
        description: e?.message || 'Qayta chiqarib bo‘lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoyaltyReissueSaving(false);
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
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigateBackTo(navigate, location, '/customers')}
            aria-label="Mijozlar ro'yxatiga qaytish"
            title="Orqaga"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="page-heading">{customer.name}</h1>
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
              {ordersError ? (
                <span className="text-base text-muted-foreground" title={ordersError}>
                  {customer.total_orders ?? 0}
                  <span className="text-xs align-super text-muted-foreground">*</span>
                </span>
              ) : !ordersLoading && activeOrders.length > 0 ? (
                <>
                  <DualCurrencyAmount
                    uzs={orderSalesSummary.uzs}
                    usd={orderSalesSummary.usd}
                    className="text-2xl font-bold"
                  />
                  {orderSalesSummary.usd > 0.0001 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      UZS ekv.: {formatMoneyUZS(orderSalesSummary.uzsEquiv)}
                    </p>
                  )}
                </>
              ) : (
                formatMoneyUZS(customer.total_sales ?? 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Umumiy (barcha davr)
              {ordersError ? ' — saqlangan qiymat' : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jami buyurtma</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {ordersCountIsFallback ? (
                <>
                  {ordersTabCount}
                  <span className="text-xs align-super text-muted-foreground">*</span>
                </>
              ) : (
                ordersTabCount
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Umumiy (barcha davr)
              {ordersError ? ' — saqlangan qiymat' : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Balans</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {(() => {
              const b = getCustomerBalances(customer);
              const uzsInfo = formatCustomerBalance(b.uzs, 'UZS');
              const usdInfo = formatCustomerBalance(b.usd, 'USD');
              return (
                <>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Kredit limiti</span>
                      <span className="font-semibold tabular-nums">
                        {Number(customer.credit_limit) > 0
                          ? formatMoneyUZS(customer.credit_limit)
                          : 'Belgilanmagan'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Mijoz avansi (UZS)</span>
                      <span className="font-semibold text-green-600 tabular-nums">
                        {formatMoneyUZS(balanceMetrics.advance)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Ochiq qarz (ledger)</span>
                      <span className="font-semibold text-destructive tabular-nums">
                        {formatMoneyUZS(Math.max(0, -b.uzs))}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Ochiq qarz (buyurtmalar)</span>
                      <span className="font-semibold text-destructive tabular-nums">
                        {formatMoneyUZS(creditOrdersSummary.totalRemaining)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Muddati o‘tgan</span>
                      <span className="font-semibold text-destructive tabular-nums">
                        {formatMoneyUZS(creditOrdersSummary.overdueAmount)}
                        {creditOrdersSummary.overdueCount > 0
                          ? ` (${creditOrdersSummary.overdueCount})`
                          : ''}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">Keyingi muddat</span>
                      <span className="font-medium tabular-nums">
                        {creditOrdersSummary.nextDue || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2 pt-1 border-t">
                      <span className="text-muted-foreground">Net (info)</span>
                      <Badge
                        variant={uzsInfo.variant}
                        className={uzsInfo.type === 'balance' ? 'bg-green-600 text-white hover:bg-green-700' : ''}
                      >
                        UZS: {uzsInfo.label}
                      </Badge>
                    </div>
                    {(Math.abs(b.usd) > 0.0001) && (
                      <Badge variant={usdInfo.variant} className={usdInfo.type === 'balance' ? 'bg-green-600 text-white hover:bg-green-700' : ''}>
                        USD: {usdInfo.label}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Oldindan to‘lov qarzni avtomatik yopmaydi. Net — ma’lumot uchun.
                  </p>
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
        const b = getCustomerBalances(customer);
        const hasUzsDebt = b.uzs < -0.001;
        const hasUsdDebt = b.usd < -0.001;
        if (!hasUzsDebt && !hasUsdDebt) return null;

        return (
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Qarz</span>
                <Badge variant="destructive">Qarzdor</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasUzsDebt && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Qarz (UZS):</span>
                  <span className="text-2xl font-bold text-destructive">
                    {formatMoney(Math.abs(b.uzs), 'UZS')}
                  </span>
                </div>
              )}
              {hasUsdDebt && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Qarz (USD):</span>
                  <span className="text-2xl font-bold text-destructive">
                    {formatMoney(Math.abs(b.usd), 'USD')}
                  </span>
                </div>
              )}
            {customer.credit_limit > 0 && (hasUzsDebt || hasUsdDebt) && (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Nasiya limiti (UZS):</span>
                  <span className="text-lg font-semibold">{formatMoneyUZS(customer.credit_limit)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Qolgan limit (UZS):</span>
                  {(() => {
                    const currentDebt =
                      Math.max(0, -b.uzs) + Math.max(0, -b.usd) * (usdRate || 0);
                    const remaining = Math.max(0, (customer.credit_limit || 0) - currentDebt);
                    const usdNote =
                      hasUsdDebt && !usdRate ? ' (USD hisobga olinmagan)' : '';
                    return (
                      <span className={`text-lg font-semibold ${remaining > 0 ? 'text-success' : 'text-destructive'}`}>
                        {formatMoneyUZS(remaining)}
                        {usdNote}
                      </span>
                    );
                  })()}
                </div>
              </>
            )}
              {hasUsdDebt && (
                <p className="text-xs text-muted-foreground">USD qarz uchun alohida kredit limiti hozircha yo‘q.</p>
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

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{t('customers.credit_orders_title')}</p>
            {creditOrdersLoading ? (
              <div className="flex items-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                {t('customers.credit_orders_loading')}
              </div>
            ) : openCreditOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('customers.credit_orders_empty')}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{t('customers.credit_orders_count', { count: openCreditOrders.length })}</span>
                {creditOrdersSummary.overdueCount > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {t('customers.credit_orders_overdue_count', { count: creditOrdersSummary.overdueCount })}
                  </Badge>
                )}
                <span className="font-semibold text-destructive tabular-nums">
                  {formatMoneyUZS(creditOrdersSummary.totalRemaining)}
                </span>
              </div>
            )}
          </div>
          <Button
            variant={openCreditOrders.length > 0 ? 'default' : 'outline'}
            size="sm"
            disabled={creditOrdersLoading}
            onClick={() => setCreditOrdersSheetOpen(true)}
          >
            {openCreditOrders.length > 0
              ? t('customers.credit_orders_open', { count: openCreditOrders.length })
              : t('customers.credit_orders_view')}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

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
          <TabsTrigger value="loyalty">Loyalty karta</TabsTrigger>
          <TabsTrigger value="orders">
            Buyurtmalar ({ordersTabCount}
            {ordersCountIsFallback ? '*' : ''})
          </TabsTrigger>
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

        <TabsContent value="loyalty" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Nakopitel karta</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadLoyaltyCard} disabled={loyaltyCardLoading}>
                  {loyaltyCardLoading ? 'Yuklanmoqda...' : 'Yangilash'}
                </Button>
                {(profile?.role === 'admin' || profile?.role === 'manager') && isElectron() && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setLoyaltyReissueOpen(true)}
                    disabled={loyaltyCardLoading || !loyaltyCard}
                  >
                    QR ni qayta chiqarish
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!isElectron() ? (
                <p className="text-sm text-muted-foreground">Karta faqat desktop ilovada ko‘rinadi.</p>
              ) : !(profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'cashier') ? (
                <p className="text-sm text-muted-foreground">Loyalty QR ko‘rish uchun ruxsat yo‘q.</p>
              ) : loyaltyCardLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : !loyaltyCard ? (
                <p className="text-sm text-muted-foreground">Bu mijoz uchun loyalty karta topilmadi.</p>
              ) : (
                <div className="flex flex-col items-center gap-4 py-2">
                  <QRCodeDataUrl text={loyaltyCard.qr_payload} width={220} />
                  <div className="space-y-1 text-center">
                    <p className="text-sm text-muted-foreground">Karta kodi</p>
                    <p className="font-mono text-base">{loyaltyCard.loyalty_card_code}</p>
                    <p className="text-xs text-muted-foreground">QR payload: {loyaltyCard.qr_payload}</p>
                  </div>
                </div>
              )}
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
              ) : ordersError ? (
                <div className="rounded-lg border bg-muted/20 py-10 text-center">
                  <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive" />
                  <p className="mb-1 font-semibold">Xatolik</p>
                  <p className="mb-4 text-sm text-muted-foreground">{ordersError}</p>
                  <Button variant="outline" size="sm" onClick={loadOrders}>
                    Qayta urinish
                  </Button>
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
                          {formatOrderMoney(order, order.total_amount)}
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
                                : order.status === 'amended'
                                  ? 'Tahrirlangan'
                                  : order.status === 'returned'
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
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>To‘lov raqami</TableHead>
                      <TableHead>Sana/vaqt</TableHead>
                      <TableHead>Valyuta</TableHead>
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
                        <TableCell
                          className={`text-right font-semibold ${
                            payment.operation === 'payment_out' ? 'text-destructive' : 'text-success'
                          }`}
                        >
                          {payment.operation === 'payment_out' ? '-' : '+'}
                          {formatMoney(
                            Math.abs(Number(payment.amount || 0)),
                            normalizeCurrency(payment.currency, 'UZS')
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {payment.notes || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {paymentsHasMore && (
                  <div className="flex justify-center pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={paymentsLoadingMore}
                      onClick={() => void loadPayments({ append: true })}
                    >
                      {paymentsLoadingMore ? 'Yuklanmoqda...' : 'Yana yuklash'}
                    </Button>
                  </div>
                )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ledger" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0">
              <CardTitle>Hisob tarixi</CardTitle>
              <div className="flex w-full sm:w-auto items-center gap-2 sm:shrink-0">
                <span className="text-xs text-muted-foreground shrink-0">Tartib</span>
                <Select
                  value={ledgerOrder}
                  onValueChange={(v) => setLedgerOrder(v as 'newest' | 'oldest')}
                  disabled={ledgerLoading || ledger.length === 0}
                >
                  <SelectTrigger className="h-8 w-full sm:w-[200px] text-xs" aria-label="Hisob tarixi tartibi">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Eng yangi avval</SelectItem>
                    <SelectItem value="oldest">Eng eski avval</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sana/vaqt</TableHead>
                      <TableHead>Tur</TableHead>
                      <TableHead>Izoh</TableHead>
                      <TableHead className="text-right">Kirim</TableHead>
                      <TableHead className="text-right">Chiqim</TableHead>
                      <TableHead>Usul</TableHead>
                      <TableHead className="text-right">Balans</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedLedger.map((entry) => {
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
                          <TableCell className="text-right font-medium">
                            {(() => {
                              const entryCur = normalizeCurrency(entry.currency, 'UZS');
                              const { inAmount } = splitCustomerLedgerAmount(entry.amount);
                              const fmt = (n: number) =>
                                entryCur === 'USD' ? formatMoney(n, 'USD') : formatMoneyUZS(n);
                              return (
                                <span className="text-green-600">
                                  {inAmount > 0 ? fmt(inAmount) : '-'}
                                </span>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {(() => {
                              const entryCur = normalizeCurrency(entry.currency, 'UZS');
                              const { outAmount } = splitCustomerLedgerAmount(entry.amount);
                              const fmt = (n: number) =>
                                entryCur === 'USD' ? formatMoney(n, 'USD') : formatMoneyUZS(n);
                              return (
                                <span className="text-destructive">
                                  {outAmount > 0 ? fmt(outAmount) : '-'}
                                </span>
                              );
                            })()}
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
                              const entryCur = normalizeCurrency(entry.currency, 'UZS');
                              const balanceInfo = formatCustomerBalance(entry.balance_after, entryCur);
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
                {ledgerHasMore && (
                  <div className="flex justify-center pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={ledgerLoadingMore}
                      onClick={() => void loadLedger({ append: true })}
                    >
                      {ledgerLoadingMore ? 'Yuklanmoqda...' : 'Yana yuklash'}
                    </Button>
                  </div>
                )}
                </>
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
                            {row.type === 'earn'
                              ? 'Yig‘ildi'
                              : row.type === 'redeem'
                                ? 'Ishlatildi'
                                : row.type === 'adjust'
                                  ? 'Korreksiya'
                                  : row.type === 'return_reverse' ||
                                      row.type === 'auto' ||
                                      row.type === 'automatic' ||
                                      String(row.note || '').toLowerCase().includes('avtomatik') ||
                                      String(row.note || '').toLowerCase().includes('return')
                                    ? 'Avtomatik'
                                    : row.type}
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
        <DialogContent aria-describedby="bonus-adjust-desc">
          <DialogHeader>
            <DialogTitle>Bonus korreksiyasi</DialogTitle>
            <DialogDescription id="bonus-adjust-desc">
              Butun son, nol emas. Sabab majburiy. Katta o‘zgarish uchun qo‘shimcha tasdiq kerak.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="bonus-delta">Ball (±) *</Label>
              <input
                id="bonus-delta"
                type="number"
                step={1}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={bonusAdjustDelta ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === '' || raw === '-') {
                    setBonusAdjustDelta(null);
                    return;
                  }
                  if (!/^-?\d+$/.test(raw)) return;
                  const n = Number(raw);
                  if (!Number.isFinite(n) || n === 0) {
                    setBonusAdjustDelta(n === 0 ? 0 : null);
                    return;
                  }
                  setBonusAdjustDelta(n);
                }}
                placeholder="Masalan: 100 yoki -50"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bonus-note">Sabab *</Label>
              <Textarea
                id="bonus-note"
                value={bonusAdjustNote}
                onChange={(e) => setBonusAdjustNote(e.target.value)}
                placeholder="Sabab majburiy"
                rows={3}
                required
              />
            </div>
            {profile?.role === 'manager' &&
              bonusAdjustDelta != null &&
              Math.abs(bonusAdjustDelta) >= 1000 && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={bonusLargeApproved}
                    onChange={(e) => setBonusLargeApproved(e.target.checked)}
                  />
                  Katta korreksiyani tasdiqlayman (ikkilamchi tasdiq)
                </label>
              )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBonusAdjustOpen(false)}>
              Bekor
            </Button>
            <Button
              onClick={handleBonusAdjust}
              disabled={
                bonusAdjustSaving ||
                bonusAdjustDelta == null ||
                bonusAdjustDelta === 0 ||
                !bonusAdjustNote.trim()
              }
            >
              {bonusAdjustSaving ? 'Saqlanmoqda...' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={loyaltyReissueOpen} onOpenChange={setLoyaltyReissueOpen}>
        <DialogContent aria-describedby="loyalty-reissue-desc">
          <DialogHeader>
            <DialogTitle>Loyalty QR qayta chiqarish</DialogTitle>
            <DialogDescription id="loyalty-reissue-desc">
              Eski QR tarixda saqlanadi. Sabab majburiy.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="loyalty-reissue-reason">Sabab *</Label>
            <Textarea
              id="loyalty-reissue-reason"
              value={loyaltyReissueReason}
              onChange={(e) => setLoyaltyReissueReason(e.target.value)}
              rows={3}
              required
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoyaltyReissueOpen(false)}>
              Bekor
            </Button>
            <Button
              onClick={() => void handleLoyaltyReissue()}
              disabled={loyaltyReissueSaving || !loyaltyReissueReason.trim()}
            >
              {loyaltyReissueSaving ? 'Jarayonda...' : 'Qayta chiqarish'}
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

      {id && (
        <CustomerCreditOrdersSheet
          open={creditOrdersSheetOpen}
          onOpenChange={setCreditOrdersSheetOpen}
          customerId={id}
          customerName={customer.name}
          onUpdated={loadOpenCreditOrders}
        />
      )}
    </div>
  );
}
