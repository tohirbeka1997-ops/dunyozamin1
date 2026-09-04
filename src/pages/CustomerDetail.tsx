import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  ChevronDown,
  Download,
  Edit,
  FileText,
  Gift,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  ShoppingCart,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import CustomerCreditOrdersSheet from "@/components/customers/CustomerCreditOrdersSheet";
import ReceivePaymentModal from "@/components/customers/ReceivePaymentModal";
import { DualCurrencyAmount } from "@/components/common/DualCurrencyAmount";
import QRCodeDataUrl from "@/components/ui/qrcodedataurl";
import { useAuth } from "@/contexts/AuthContext";
import {
  adjustCustomerBonusPoints,
  getCustomerBonusLedger,
  getCustomerById,
  getCustomerLedger,
  getCustomerLoyaltyCard,
  getCustomerPayments,
  getOrdersByCustomer,
  reissueCustomerLoyaltyCard,
} from "@/db/api";
import { listOpenCreditOrders, type OpenCreditOrderRow } from "@/db/customerCredit.api";
import { useToast } from "@/hooks/use-toast";
import {
  formatMoney,
  formatOrderMoney,
  getCustomerDebtAdvance,
  normalizeCurrency,
} from "@/lib/currency";
import { formatDate, formatDateTime, todayYMD } from "@/lib/datetime";
import { downloadCSV } from "@/lib/exportHelpers";
import { fetchUzsPerUsdRate } from "@/lib/fxRate";
import { formatMoneyUZS } from "@/lib/format";
import {
  formatCashierSigned,
  formatLedgerQoldiPlain,
  ledgerCashFlow,
  ledgerLastMatchesPosition,
  ledgerRunningPosition,
  resolveLedgerEventTimes,
  signedBalanceClassName,
  sortLedgerEntries,
  toCashierSigned,
} from "@/lib/customerLedgerDisplay";
import { createBackNavigationState, navigateBackTo, resolveBackTarget } from "@/lib/pageState";
import type {
  Customer,
  CustomerBonusLedgerEntry,
  CustomerLedgerEntry,
  CustomerLoyaltyCard,
  CustomerPayment,
  OrderWithDetails,
} from "@/types/database";
import { isElectron } from "@/utils/electron";

const PAYMENTS_PAGE_SIZE = 200;
const LEDGER_PAGE_SIZE = 200;
const STICKY_HEAD = "sticky top-0 z-10 bg-background";

type CustomerPosition = {
  open_order_debt?: number | null;
  loan_debt?: number | null;
  total_debt?: number | null;
  advance?: number | null;
  net?: number | null;
  overdue_amount?: number | null;
};
type CustomerWithPosition = Customer & {
  position?: CustomerPosition | null;
  position_usd?: CustomerPosition | null;
};
type UiState = {
  tab?: string;
  ordersSearch?: string;
  ledgerOrder?: "newest" | "oldest";
  scrollY?: number;
};

function readUiState(id?: string): UiState {
  if (!id) return {};
  try {
    return JSON.parse(sessionStorage.getItem(`customerDetail:ui:${id}`) || "{}") || {};
  } catch {
    return {};
  }
}
function isActiveOrder(order: { status?: string } | null | undefined) {
  return !["voided", "refunded", "returned", "amended"].includes(
    String(order?.status || "").toLowerCase(),
  );
}
function paymentMethodLabel(method?: string | null) {
  const raw = String(method || "").trim();
  if (!raw) return "—";
  const labels: Record<string, string> = {
    cash: "Naqd",
    card: "Karta",
    qr: "QR",
    credit: "Nasiya",
    advance: "Ortiqcha to‘lov",
    click: "Click",
    payme: "Payme",
    transfer: "O‘tkazma",
    other: "Boshqa",
  };
  return labels[raw.toLowerCase()] || raw;
}
function ledgerOpLabel(entry: Pick<CustomerLedgerEntry, "type" | "op_code">) {
  const code = String(entry.op_code || "").toUpperCase();
  const byCode: Record<string, string> = {
    ADVANCE_RECEIVED: "Ortiqcha to‘lov",
    ADVANCE_REFUND: "Ortiqcha qaytarildi",
    ADVANCE_REFUNDED: "Ortiqcha qaytarildi",
    CUSTOMER_LOAN_ISSUED: "Qarz berildi",
    CUSTOMER_LOAN_REPAID: "Qarz qaytdi",
    DEBT_PAYMENT_RECEIVED: "To‘lov olindi",
    CUSTOMER_PAYMENT: "To‘lov olindi",
    CREDIT_SALE: "Nasiya",
    SALE_ON_CREDIT: "Nasiya",
    SALE_PAYMENT: "Sotuv",
    SALE_RETURN: "Qaytarish",
    ADVANCE_APPLIED_TO_ORDER: "Ortiqcha → buyurtma",
  };
  const byType: Record<string, string> = {
    sale: "Sotuv",
    payment_in: "To‘lov olindi",
    payment_out: "Pul berildi",
    refund: "Qaytarish",
    adjustment: "Tuzatish",
    payment: "To‘lov",
  };
  return byCode[code] || byType[String(entry.type || "")] || entry.type || "—";
}
function ledgerOpBadgeClass(entry: Pick<CustomerLedgerEntry, "type" | "op_code">) {
  const code = String(entry.op_code || "").toUpperCase();
  if (
    [
      "ADVANCE_RECEIVED",
      "DEBT_PAYMENT_RECEIVED",
      "CUSTOMER_PAYMENT",
      "CUSTOMER_LOAN_REPAID",
    ].includes(code) ||
    entry.type === "payment_in"
  )
    return "border-emerald-300 bg-emerald-100 text-emerald-800";
  if (
    ["CUSTOMER_LOAN_ISSUED", "ADVANCE_REFUND", "ADVANCE_REFUNDED"].includes(code) ||
    entry.type === "payment_out"
  )
    return "border-red-300 bg-red-100 text-red-800";
  if (["CREDIT_SALE", "SALE_ON_CREDIT"].includes(code))
    return "border-amber-300 bg-amber-100 text-amber-900";
  if (entry.type === "sale" || code === "SALE_PAYMENT")
    return "border-blue-300 bg-blue-100 text-blue-800";
  return "border-slate-300 bg-slate-100 text-slate-700";
}
function isOverdue(order: OpenCreditOrderRow) {
  const due = String(order.due_date || "").slice(0, 10);
  return due.length === 10 && due < todayYMD();
}

/** Display amounts for open credit rows: prefer API fields, reconstruct if total/paid missing. */
function creditOrderAmounts(order: OpenCreditOrderRow) {
  const remaining = Math.max(0, Number(order.credit_amount || 0) || 0);
  const total = Math.max(0, Number(order.total_amount || 0) || 0);
  const paidRaw = Math.max(0, Number(order.paid_amount || 0) || 0);
  const original =
    total > 0.009 ? total : remaining + paidRaw > 0.009 ? remaining + paidRaw : remaining;
  const paid = paidRaw > 0.009 ? paidRaw : Math.max(0, Math.round((original - remaining) * 100) / 100);
  return { original, paid, remaining };
}

function CreditTable({
  rows,
  loading,
  openOrder,
}: {
  rows: OpenCreditOrderRow[];
  loading: boolean;
  openOrder: (id: string) => void;
}) {
  if (loading)
    return (
      <div className="flex justify-center py-4 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Yuklanmoqda...
      </div>
    );
  if (!rows.length)
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        Ochiq nasiya buyurtmalari yo‘q
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={STICKY_HEAD}>Buyurtma #</TableHead>
            <TableHead className={STICKY_HEAD}>Sana</TableHead>
            <TableHead className={STICKY_HEAD}>Muddat</TableHead>
            <TableHead className={`${STICKY_HEAD} text-right`}>Boshlang‘ich summa</TableHead>
            <TableHead className={`${STICKY_HEAD} text-right`}>To‘langan</TableHead>
            <TableHead className={`${STICKY_HEAD} text-right`}>Qoldiq</TableHead>
            <TableHead className={STICKY_HEAD}>Holat</TableHead>
            <TableHead className={`${STICKY_HEAD} text-right`}>Amal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((order) => {
            const overdue = isOverdue(order);
            const { original, paid, remaining } = creditOrderAmounts(order);
            return (
              <TableRow
                key={order.id}
                className={overdue ? "bg-destructive/5 hover:bg-destructive/10" : undefined}
              >
                <TableCell className="py-2 font-medium">{order.order_number}</TableCell>
                <TableCell className="py-2">
                  {order.created_at ? formatDate(order.created_at) : "—"}
                </TableCell>
                <TableCell className={`py-2 ${overdue ? "font-medium text-destructive" : ""}`}>
                  {order.due_date ? formatDate(order.due_date) : "—"}
                </TableCell>
                <TableCell className="py-2 text-right tabular-nums">
                  {formatMoneyUZS(original)}
                </TableCell>
                <TableCell className="py-2 text-right tabular-nums">{formatMoneyUZS(paid)}</TableCell>
                <TableCell className="py-2 text-right font-semibold tabular-nums text-destructive">
                  {formatMoneyUZS(remaining)}
                </TableCell>
                <TableCell className="py-2">
                  {overdue ? (
                    <Badge variant="destructive">Muddati o‘tgan</Badge>
                  ) : (
                    <Badge variant="outline">
                      {order.payment_status === "partially_paid" ||
                      order.payment_status === "partial"
                        ? "Qisman to‘langan"
                        : "Ochiq"}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="py-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => openOrder(order.id)}>
                    Ko‘rish
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { profile } = useAuth();
  const initialUi = useMemo(() => readUiState(id), [id]);
  const [customer, setCustomer] = useState<CustomerWithPosition | null>(null);
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [ledger, setLedger] = useState<CustomerLedgerEntry[]>([]);
  const [bonusLedger, setBonusLedger] = useState<CustomerBonusLedgerEntry[]>([]);
  const [loyaltyCard, setLoyaltyCard] = useState<CustomerLoyaltyCard | null>(null);
  const [creditOrders, setCreditOrders] = useState<OpenCreditOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [bonusLoading, setBonusLoading] = useState(true);
  const [loyaltyLoading, setLoyaltyLoading] = useState(true);
  const [creditLoading, setCreditLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [paymentsHasMore, setPaymentsHasMore] = useState(false);
  const [ledgerHasMore, setLedgerHasMore] = useState(false);
  const [paymentsLoadingMore, setPaymentsLoadingMore] = useState(false);
  const [ledgerLoadingMore, setLedgerLoadingMore] = useState(false);
  const [usdRate, setUsdRate] = useState<number | null>(null);
  const [ordersSearch, setOrdersSearch] = useState(initialUi.ordersSearch || "");
  const [ledgerOrder, setLedgerOrder] = useState<"newest" | "oldest">(
    initialUi.ledgerOrder || "oldest",
  );
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentInitialKind, setPaymentInitialKind] = useState<
    "payment_in" | "advance_out" | undefined
  >();
  const [creditSheetOpen, setCreditSheetOpen] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);
  const [bonusDelta, setBonusDelta] = useState<number | null>(null);
  const [bonusNote, setBonusNote] = useState("");
  const [bonusSaving, setBonusSaving] = useState(false);
  const [bonusApproved, setBonusApproved] = useState(false);
  const [reissueOpen, setReissueOpen] = useState(false);
  const [reissueReason, setReissueReason] = useState("");
  const [reissueSaving, setReissueSaving] = useState(false);
  const restoredScroll = useRef<string | null>(null);
  const activeTab = searchParams.get("tab") || initialUi.tab || "info";
  const canManageLoyalty = profile?.role === "admin" || profile?.role === "manager";
  const canExport = profile?.role === "admin";
  const backTo = resolveBackTarget(location, "/customers");

  const loadCustomer = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setCustomer((await getCustomerById(id)) as CustomerWithPosition);
    } catch {
      toast({ title: "Xatolik", description: "Mijozni yuklab bo‘lmadi", variant: "destructive" });
      navigate(backTo);
    } finally {
      setLoading(false);
    }
  }, [backTo, id, navigate, toast]);
  const loadOrders = useCallback(async () => {
    if (!id) return;
    try {
      setOrdersLoading(true);
      setOrdersError(null);
      setOrders(await getOrdersByCustomer(id));
    } catch (error) {
      setOrders([]);
      setOrdersError(error instanceof Error ? error.message : "Buyurtmalarni yuklab bo‘lmadi");
    } finally {
      setOrdersLoading(false);
    }
  }, [id]);
  const loadPayments = useCallback(
    async (append = false) => {
      if (!id) return;
      try {
        append ? setPaymentsLoadingMore(true) : setPaymentsLoading(true);
        const rows = await getCustomerPayments(id, {
          limit: PAYMENTS_PAGE_SIZE,
          offset: append ? payments.length : 0,
        });
        setPayments((old) => (append ? [...old, ...rows] : rows));
        setPaymentsHasMore(rows.length === PAYMENTS_PAGE_SIZE);
      } catch (error) {
        console.error(error);
      } finally {
        append ? setPaymentsLoadingMore(false) : setPaymentsLoading(false);
      }
    },
    [id, payments.length],
  );
  const loadLedger = useCallback(
    async (append = false) => {
      if (!id) return;
      try {
        append ? setLedgerLoadingMore(true) : setLedgerLoading(true);
        const order = ledgerOrder === "newest" ? "desc" : "asc";
        const rows = await getCustomerLedger(id, {
          limit: LEDGER_PAGE_SIZE,
          offset: append ? ledger.length : 0,
          order,
        });
        setLedger((old) => (append ? [...old, ...rows] : rows));
        setLedgerHasMore(rows.length === LEDGER_PAGE_SIZE);
      } catch (error) {
        console.error(error);
      } finally {
        append ? setLedgerLoadingMore(false) : setLedgerLoading(false);
      }
    },
    [id, ledger.length, ledgerOrder],
  );
  const loadBonus = useCallback(async () => {
    if (!id || !isElectron()) {
      setBonusLedger([]);
      setBonusLoading(false);
      return;
    }
    try {
      setBonusLoading(true);
      setBonusLedger(await getCustomerBonusLedger(id, { limit: 200 }));
    } catch (error) {
      console.error(error);
    } finally {
      setBonusLoading(false);
    }
  }, [id]);
  const loadLoyalty = useCallback(async () => {
    if (!id || !isElectron()) {
      setLoyaltyCard(null);
      setLoyaltyLoading(false);
      return;
    }
    try {
      setLoyaltyLoading(true);
      setLoyaltyCard(await getCustomerLoyaltyCard(id));
    } catch (error) {
      console.error(error);
      setLoyaltyCard(null);
    } finally {
      setLoyaltyLoading(false);
    }
  }, [id]);
  const loadOpenCreditOrders = useCallback(async () => {
    if (!id) return;
    try {
      setCreditLoading(true);
      setCreditOrders(await listOpenCreditOrders({ customerId: id, limit: 100 }));
    } catch (error) {
      console.error(error);
      setCreditOrders([]);
    } finally {
      setCreditLoading(false);
    }
  }, [id]);
  const refreshAll = useCallback(async () => {
    // Load customer first so attachPosition can settle advance→open nasiya before credit list.
    await loadCustomer();
    void loadOrders();
    void loadPayments();
    void loadLedger();
    void loadBonus();
    void loadLoyalty();
    void loadOpenCreditOrders();
  }, [
    loadBonus,
    loadCustomer,
    loadLedger,
    loadLoyalty,
    loadOpenCreditOrders,
    loadOrders,
    loadPayments,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload once when the route customer changes
  useEffect(() => {
    void refreshAll();
  }, [id]);
  useEffect(() => {
    void fetchUzsPerUsdRate().then((rate) => setUsdRate(rate && rate > 0 ? rate : null));
  }, []);
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [refreshAll]);
  useEffect(() => {
    setOrdersSearch(initialUi.ordersSearch || "");
    setLedgerOrder(initialUi.ledgerOrder || "oldest");
    restoredScroll.current = null;
  }, [initialUi]);
  const ledgerSortBoot = useRef(true);
  useEffect(() => {
    ledgerSortBoot.current = true;
  }, [id]);
  useEffect(() => {
    if (!id) return;
    if (ledgerSortBoot.current) {
      ledgerSortBoot.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLedgerLoading(true);
        const rows = await getCustomerLedger(id, {
          limit: LEDGER_PAGE_SIZE,
          offset: 0,
          order: ledgerOrder === "newest" ? "desc" : "asc",
        });
        if (cancelled) return;
        setLedger(rows);
        setLedgerHasMore(rows.length === LEDGER_PAGE_SIZE);
      } catch (error) {
        console.error(error);
      } finally {
        if (!cancelled) setLedgerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, ledgerOrder]);
  useEffect(() => {
    if (!id || loading || restoredScroll.current === id) return;
    restoredScroll.current = id;
    const frame = requestAnimationFrame(() =>
      window.scrollTo({ top: Number(initialUi.scrollY || 0) }),
    );
    return () => cancelAnimationFrame(frame);
  }, [id, initialUi.scrollY, loading]);
  useEffect(() => {
    if (!id) return;
    let frame = 0;
    const save = () =>
      sessionStorage.setItem(
        `customerDetail:ui:${id}`,
        JSON.stringify({ tab: activeTab, ordersSearch, ledgerOrder, scrollY: window.scrollY }),
      );
    const scroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(save);
    };
    window.addEventListener("scroll", scroll, { passive: true });
    save();
    return () => {
      window.removeEventListener("scroll", scroll);
      cancelAnimationFrame(frame);
      save();
    };
  }, [activeTab, id, ledgerOrder, ordersSearch]);

  const activeOrders = useMemo(() => orders.filter(isActiveOrder), [orders]);
  const orderCount =
    ordersError || ordersLoading ? Number(customer?.total_orders || 0) : activeOrders.length;
  const sales = useMemo(
    () =>
      activeOrders.reduce(
        (sum, order) => {
          // Gross sales only — never let return/credit-note negatives flip «Jami savdo».
          const amount = Math.max(0, Number(order.total_amount || 0) || 0);
          if (!(amount > 0.009)) return sum;
          if (normalizeCurrency(order.currency) === "USD") {
            sum.usd += amount;
            sum.uzsEquiv += amount * Number(order.fx_rate || 0);
          } else {
            sum.uzs += amount;
            sum.uzsEquiv += amount;
          }
          return sum;
        },
        { uzs: 0, usd: 0, uzsEquiv: 0 },
      ),
    [activeOrders],
  );
  const sortedCredit = useMemo(
    () =>
      [...creditOrders].sort(
        (a, b) =>
          Number(isOverdue(b)) - Number(isOverdue(a)) ||
          String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")),
      ),
    [creditOrders],
  );
  const creditSummary = useMemo(
    () =>
      creditOrders.reduce(
        (sum, order) => {
          const amount = Number(order.credit_amount || 0);
          sum.total += amount;
          if (isOverdue(order)) {
            sum.overdue += amount;
            sum.count += 1;
          }
          return sum;
        },
        { total: 0, overdue: 0, count: 0 },
      ),
    [creditOrders],
  );
  const position = useMemo(() => {
    if (!customer) return { open: 0, loan: 0, debt: 0, advance: 0, net: 0, overdue: 0, usdDebt: 0 };
    const fallback = getCustomerDebtAdvance(customer, "UZS");
    const fallbackUsd = getCustomerDebtAdvance(customer, "USD");
    const pos = customer.position;
    const open = Number(pos?.open_order_debt ?? creditSummary.total) || 0;
    const debt = Number(pos?.total_debt ?? fallback.debt) || 0;
    const loan = Number(pos?.loan_debt ?? Math.max(0, debt - open)) || 0;
    const advance = Number(pos?.advance ?? fallback.advance) || 0;
    const totalDebt = pos ? debt : Math.max(debt, open + loan);
    return {
      open,
      loan,
      debt: totalDebt,
      advance,
      net: Number(pos?.net ?? advance - totalDebt) || 0,
      overdue: Number(pos?.overdue_amount ?? creditSummary.overdue) || 0,
      usdDebt: Number(customer.position_usd?.total_debt ?? fallbackUsd.debt) || 0,
    };
  }, [creditSummary, customer]);
  const visibleOrders = useMemo(() => {
    const query = ordersSearch.trim().toLowerCase();
    return query
      ? orders.filter((order) =>
          [
            order.order_number,
            order.status,
            order.payment_status,
            formatDate(order.created_at),
          ].some((value) =>
            String(value || "")
              .toLowerCase()
              .includes(query),
          ),
        )
      : orders;
  }, [orders, ordersSearch]);
  const ledgerTimeMsById = useMemo(() => resolveLedgerEventTimes(ledger), [ledger]);
  const visibleLedger = useMemo(
    () => sortLedgerEntries(ledger, ledgerOrder === "newest" ? "desc" : "asc"),
    [ledger, ledgerOrder],
  );
  const chronologicallyLastLedger = useMemo(() => {
    if (!ledger.length) return null;
    const sorted = sortLedgerEntries(ledger, "asc");
    return sorted[sorted.length - 1] || null;
  }, [ledger]);
  const ledgerMatchesHisobHolati = useMemo(
    () =>
      ledgerLastMatchesPosition(chronologicallyLastLedger, {
        net: position.net,
        debt: position.debt,
        advance: position.advance,
      }),
    [chronologicallyLastLedger, position.advance, position.debt, position.net],
  );
  const orderAmountsById = useMemo(() => {
    const map = new Map<string, { total: number; paid: number }>();
    for (const order of orders) {
      if (!order.id) continue;
      map.set(order.id, {
        total: Number(order.total_amount || 0) || 0,
        paid: Number(order.paid_amount || 0) || 0,
      });
    }
    return map;
  }, [orders]);
  const openOrder = (orderId: string) =>
    navigate(`/orders/${orderId}`, { state: createBackNavigationState(location) });
  const openPayment = (kind?: "payment_in" | "advance_out") => {
    setPaymentInitialKind(kind);
    setPaymentOpen(true);
  };

  const exportLedgerCsv = useCallback(() => {
    if (!canExport) return;
    const headers = [
      "Sana/vaqt",
      "Operatsiya",
      "Buyurtma",
      "Xodim",
      "Sotuv / Umumiy",
      "Olindi",
      "Berildi",
      "Qoldi",
      "Usul",
      "Izoh",
    ];
    const rows = visibleLedger.map((entry) => {
      const flow = ledgerCashFlow(entry, orderAmountsById);
      const running = ledgerRunningPosition(entry);
      const qoldi = formatLedgerQoldiPlain(running);
      const timeMs = ledgerTimeMsById.get(String(entry.id || "")) ?? entry.created_at;
      return [
        formatDateTime(timeMs),
        ledgerOpLabel(entry),
        entry.ref_no || "",
        entry.created_by_name || entry.created_by || "",
        flow.total || "",
        flow.received || "",
        flow.given || "",
        qoldi,
        paymentMethodLabel(entry.method),
        entry.note || "",
      ];
    });
    const safeName = String(customer?.name || "mijoz")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .slice(0, 40);
    downloadCSV(
      headers,
      rows.map((row) => row.map(String)),
      `mijoz-tarix-${safeName}-${todayYMD()}.csv`,
    );
  }, [canExport, customer?.name, ledgerTimeMsById, orderAmountsById, visibleLedger]);

  const adjustBonus = async () => {
    if (
      !id ||
      !profile?.id ||
      bonusDelta == null ||
      !Number.isInteger(bonusDelta) ||
      bonusDelta === 0 ||
      !bonusNote.trim()
    ) {
      toast({
        title: "Xatolik",
        description: "Ball va sababni to‘g‘ri kiriting",
        variant: "destructive",
      });
      return;
    }
    try {
      setBonusSaving(true);
      setCustomer(
        (await adjustCustomerBonusPoints({
          actorUserId: profile.id,
          customerId: id,
          deltaPoints: bonusDelta,
          note: bonusNote.trim(),
          largeApproved: bonusApproved || profile.role === "admin",
        })) as CustomerWithPosition,
      );
      setBonusOpen(false);
      setBonusDelta(null);
      setBonusNote("");
      setBonusApproved(false);
      await loadBonus();
    } catch (error: any) {
      toast({
        title: "Xatolik",
        description: error?.message || "Saqlab bo‘lmadi",
        variant: "destructive",
      });
    } finally {
      setBonusSaving(false);
    }
  };
  const reissueLoyalty = async () => {
    if (!id || !profile?.id || !reissueReason.trim()) return;
    try {
      setReissueSaving(true);
      setLoyaltyCard(
        await reissueCustomerLoyaltyCard({
          actorUserId: profile.id,
          customerId: id,
          reason: reissueReason.trim(),
        }),
      );
      setReissueOpen(false);
      setReissueReason("");
    } catch (error: any) {
      toast({
        title: "Xatolik",
        description: error?.message || "Qayta chiqarib bo‘lmadi",
        variant: "destructive",
      });
    } finally {
      setReissueSaving(false);
    }
  };

  if (loading)
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  if (!customer)
    return (
      <div className="py-12 text-center">
        <p>Mijoz topilmadi</p>
        <Button className="mt-4" onClick={() => navigate(backTo)}>
          Orqaga
        </Button>
      </div>
    );

  const rawLimit = customer.credit_limit;
  const hasCreditLimit = rawLimit != null && Number.isFinite(Number(rawLimit)) && Number(rawLimit) > 0;
  const limit = hasCreditLimit ? Number(rawLimit) : 0;
  const exposure = position.debt + position.usdDebt * Number(usdRate || 0);
  const usage = hasCreditLimit ? (exposure / limit) * 100 : 0;
  const overBy = hasCreditLimit ? Math.max(0, exposure - limit) : 0;
  const hasOpenOrderDebt = position.open > 0.001 || creditOrders.length > 0;
  const hasDebt = position.debt > 0.001 || position.usdDebt > 0.001 || creditOrders.length > 0;
  const cashierSigned = toCashierSigned(position.net);
  const owesUs = cashierSigned > 0.001;
  const hasOverpayment = cashierSigned < -0.001;
  const primaryFinanceCta = owesUs
    ? ({ kind: "payment_in" as const, label: "Qarz to‘lovini qabul qilish" })
    : hasOverpayment
      ? ({ kind: "advance_out" as const, label: "Ortiqcha to‘lovni qaytarish" })
      : null;
  const limitBadge = !hasCreditLimit ? (
    <Badge variant="secondary">Limit belgilanmagan</Badge>
  ) : overBy > 0 ? (
    <Badge variant="destructive">Limit oshgan</Badge>
  ) : (
    <Badge variant="outline" className="border-emerald-300 text-emerald-700">
      Limit ichida
    </Badge>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => navigateBackTo(navigate, location, "/customers")}
            aria-label="Orqaga"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="page-heading truncate text-xl leading-tight sm:text-2xl">
                {customer.name}
              </h1>
              <Badge
                className={customer.status === "active" ? "bg-emerald-600 text-white" : ""}
                variant={customer.status === "active" ? "default" : "outline"}
              >
                {customer.status === "active" ? "Faol" : "Nofaol"}
              </Badge>
              {limitBadge}
            </div>
            <p className="text-sm text-muted-foreground">
              {customer.phone || "Telefon ko‘rsatilmagan"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pl-10 lg:pl-0">
          <Button
            size="sm"
            onClick={() =>
              navigate("/pos", {
                state: { customerId: customer.id, ...createBackNavigationState(location) },
              })
            }
          >
            <ShoppingCart className="mr-1.5 h-4 w-4" />
            Sotuv qilish
          </Button>
          <Button size="sm" variant="outline" onClick={() => openPayment()}>
            <WalletCards className="mr-1.5 h-4 w-4" />
            Hisob amali
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              navigate(`/customers/${id}/edit`, { state: createBackNavigationState(location) })
            }
          >
            <Edit className="mr-1.5 h-4 w-4" />
            Tahrirlash
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={refreshAll} aria-label="Yangilash">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Yangilash</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch xl:gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold tracking-tight">Hisob holati</h2>
                {position.overdue > 0.001 && (
                  <span className="text-xs font-medium text-destructive">
                    Muddati o‘tgan: {formatMoneyUZS(position.overdue)}
                  </span>
                )}
              </div>
              {(() => {
                const signed = cashierSigned;
                return (
                  <div className="space-y-1.5">
                    <div>
                      <p className="text-[11px] leading-tight text-muted-foreground">
                        Mijoz balansi
                      </p>
                      <p
                        className={`mt-0.5 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl ${signedBalanceClassName(signed)}`}
                      >
                        {formatCashierSigned(signed, formatMoneyUZS)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {owesUs
                          ? "Mijoz qarzdor"
                          : hasOverpayment
                            ? "Ortiqcha to‘lov"
                            : "Balans nol"}
                      </p>
                    </div>
                    {(position.open > 0.009 || position.loan > 0.009) && (
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                        {position.open > 0.009 && (
                          <span>
                            Ichida ochiq nasiya:{" "}
                            <b className="tabular-nums text-destructive">
                              {formatMoneyUZS(position.open)}
                            </b>
                          </span>
                        )}
                        {position.loan > 0.009 && (
                          <span>
                            Pul berilgan:{" "}
                            <b className="tabular-nums text-destructive">
                              {formatMoneyUZS(position.loan)}
                            </b>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
              {position.usdDebt > 0.001 && (
                <p className="text-xs text-destructive">
                  USD qarz: {formatMoney(position.usdDebt, "USD")}
                  {!usdRate ? " (limitga kiritilmadi)" : ""}
                </p>
              )}
            </div>

            <div className="flex shrink-0 flex-col justify-between gap-2 border-t pt-3 xl:w-[260px] xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
              <div className="space-y-1 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">Kredit limiti</span>
                  <b className="tabular-nums">
                    {hasCreditLimit ? formatMoneyUZS(limit) : "Belgilanmagan"}
                  </b>
                </div>
                {hasCreditLimit && (
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">Foydalanish</span>
                    <b className="tabular-nums">{usage.toFixed(0)}%</b>
                  </div>
                )}
                {!hasCreditLimit && (
                  <div className="flex gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>Kredit limiti belgilanmagan — nasiya bloklangan</span>
                  </div>
                )}
                {hasCreditLimit && overBy > 0 && (
                  <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <b>Kredit limtidan {formatMoneyUZS(overBy)} ortiq</b>
                  </div>
                )}
              </div>
              {primaryFinanceCta ? (
                <Button
                  size="sm"
                  className="w-full"
                  variant={primaryFinanceCta.kind === "advance_out" ? "outline" : "default"}
                  onClick={() => openPayment(primaryFinanceCta.kind)}
                >
                  <WalletCards className="mr-1.5 h-4 w-4" />
                  {primaryFinanceCta.label}
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="w-full" onClick={() => openPayment()}>
                  <WalletCards className="mr-1.5 h-4 w-4" />
                  Hisob amali
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/20 px-3 py-1.5 text-xs sm:text-sm">
        <span className="text-muted-foreground">
          Jami savdo:{" "}
          <b className="text-foreground">
            {!ordersLoading && !ordersError && activeOrders.length ? (
              <DualCurrencyAmount
                uzs={Math.max(0, sales.uzs)}
                usd={Math.max(0, sales.usd)}
              />
            ) : (
              formatMoneyUZS(Math.max(0, Number(customer.total_sales || 0) || 0))
            )}
          </b>
        </span>
        <span className="hidden text-border sm:inline">·</span>
        <span className="text-muted-foreground">
          Buyurtmalar:{" "}
          <b className="text-foreground">
            {orderCount}
            {ordersError || ordersLoading ? "*" : ""}
          </b>
        </span>
        <span className="hidden text-border sm:inline">·</span>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Gift className="h-3.5 w-3.5" />
          Bonus: <b className="text-foreground">{Math.round(customer.bonus_points || 0)}</b>
          {canManageLoyalty && isElectron() && (
            <Button
              variant="link"
              size="sm"
              className="h-auto px-1 py-0 text-xs"
              onClick={() => setBonusOpen(true)}
            >
              Korreksiya
            </Button>
          )}
        </span>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(tab) => {
          const next = new URLSearchParams(searchParams);
          tab === "info" ? next.delete("tab") : next.set("tab", tab);
          setSearchParams(next, { replace: true });
        }}
        className="space-y-2"
      >
        <div className="overflow-x-auto">
          <TabsList className="h-9 min-w-max">
            <TabsTrigger value="info" className="px-3 text-xs sm:text-sm">
              Umumiy
            </TabsTrigger>
            <TabsTrigger value="debts" className="px-3 text-xs sm:text-sm">
              Ochiq qarzlar ({creditOrders.length})
            </TabsTrigger>
            <TabsTrigger value="orders" className="px-3 text-xs sm:text-sm">
              Buyurtmalar ({orderCount})
            </TabsTrigger>
            <TabsTrigger value="payments" className="px-3 text-xs sm:text-sm">
              To‘lovlar ({payments.length})
            </TabsTrigger>
            <TabsTrigger value="ledger" className="px-3 text-xs sm:text-sm">
              Hisob tarixi ({ledger.length})
            </TabsTrigger>
            <TabsTrigger value="bonus" className="px-3 text-xs sm:text-sm">
              Bonuslar ({bonusLedger.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="info" className="mt-2 space-y-2">
          {hasOpenOrderDebt && (
            <Card>
              <CardHeader className="flex flex-col gap-2 space-y-0 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                <div>
                  <CardTitle className="text-sm sm:text-base">Ochiq nasiya buyurtmalari</CardTitle>
                  {position.overdue > 0 && (
                    <p className="text-xs text-destructive">
                      Muddati o‘tgan: {formatMoneyUZS(position.overdue)}
                    </p>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => setCreditSheetOpen(true)}>
                  Muddat / eslatma
                </Button>
              </CardHeader>
              <CardContent className="px-3 pb-3 pt-0 sm:px-4">
                <CreditTable
                  rows={sortedCredit.slice(0, 8)}
                  loading={creditLoading}
                  openOrder={openOrder}
                />
                {sortedCredit.length > 8 && (
                  <div className="flex justify-end pt-2">
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      onClick={() => {
                        const next = new URLSearchParams(searchParams);
                        next.set("tab", "debts");
                        setSearchParams(next, { replace: true });
                      }}
                    >
                      Barchasi ({sortedCredit.length})
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {hasDebt && !hasOpenOrderDebt && position.loan > 0.001 && (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4">
                <div>
                  <p className="text-sm font-medium">Mijozga berilgan qarz</p>
                  <p className="text-base font-semibold text-destructive">
                    {formatMoneyUZS(position.loan)}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Collapsible defaultOpen={!hasOpenOrderDebt} className="group">
            <Card>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left sm:px-4"
                >
                  <span className="text-sm font-semibold">Batafsil — ma’lumot va Loyalty QR</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="grid gap-3 border-t px-3 pb-3 pt-3 sm:px-4 lg:grid-cols-2">
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="flex gap-2">
                      <Phone className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div>
                        <Label className="text-xs">Telefon</Label>
                        <p>{customer.phone || "—"}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div>
                        <Label className="text-xs">Email</Label>
                        <p>{customer.email || "—"}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div>
                        <Label className="text-xs">Manzil</Label>
                        <p>{customer.address || "—"}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div>
                        <Label className="text-xs">Turi</Label>
                        <p>{customer.type === "company" ? "Yuridik shaxs" : "Jismoniy shaxs"}</p>
                      </div>
                    </div>
                    {customer.type === "company" && (
                      <>
                        <div className="flex gap-2">
                          <Building2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          <div>
                            <Label className="text-xs">Kompaniya</Label>
                            <p>{customer.company_name || "—"}</p>
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs">INN</Label>
                          <p>{customer.tax_number || "—"}</p>
                        </div>
                      </>
                    )}
                    <div>
                      <Label className="text-xs">Oxirgi buyurtma</Label>
                      <p>
                        {customer.last_order_date
                          ? formatDate(customer.last_order_date)
                          : "Hali buyurtma yo‘q"}
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs">Yaratilgan</Label>
                      <p>{formatDateTime(customer.created_at)}</p>
                    </div>
                    {customer.notes && (
                      <div className="sm:col-span-2">
                        <Label className="text-xs">Izoh</Label>
                        <p className="whitespace-pre-wrap">{customer.notes}</p>
                      </div>
                    )}
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">Loyalty QR</p>
                      <div className="flex gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => void loadLoyalty()}>
                          Yangilash
                        </Button>
                        {canManageLoyalty && isElectron() && (
                          <Button size="sm" disabled={!loyaltyCard} onClick={() => setReissueOpen(true)}>
                            Qayta chiqarish
                          </Button>
                        )}
                      </div>
                    </div>
                    {!isElectron() ? (
                      <p className="text-sm text-muted-foreground">Faqat desktop ilovada ko‘rinadi.</p>
                    ) : loyaltyLoading ? (
                      <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                    ) : !loyaltyCard ? (
                      <p className="text-sm text-muted-foreground">Loyalty karta topilmadi.</p>
                    ) : (
                      <div className="flex items-center gap-3">
                        <QRCodeDataUrl text={loyaltyCard.qr_payload} width={112} />
                        <div>
                          <p className="text-xs text-muted-foreground">Karta kodi</p>
                          <p className="font-mono text-sm">{loyaltyCard.loyalty_card_code}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </TabsContent>

        <TabsContent value="debts" className="mt-2 space-y-2">
          <Card>
            <CardHeader className="flex flex-col gap-2 space-y-0 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <div>
                <CardTitle className="text-sm sm:text-base">Ochiq nasiya buyurtmalari</CardTitle>
                {creditSummary.count > 0 && (
                  <p className="text-xs text-destructive">
                    {creditSummary.count} ta muddati o‘tgan ·{" "}
                    {formatMoneyUZS(creditSummary.overdue)}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => setCreditSheetOpen(true)}>
                Muddat / eslatma
              </Button>
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-0 sm:px-4">
              {creditOrders.length > 0 || creditLoading ? (
                <CreditTable rows={sortedCredit} loading={creditLoading} openOrder={openOrder} />
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Ochiq nasiya buyurtmalari yo‘q
                </p>
              )}
            </CardContent>
          </Card>
          {position.loan > 0.001 && (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4">
                <div>
                  <p className="text-sm font-medium">Mijozga berilgan qarz (buyurtmasiz)</p>
                  <p className="text-base font-semibold text-destructive">
                    {formatMoneyUZS(position.loan)}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="orders">
          <Card>
            <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">Buyurtmalar</CardTitle>
              <Input
                className="sm:max-w-sm"
                value={ordersSearch}
                onChange={(e) => setOrdersSearch(e.target.value)}
                placeholder="Raqam, sana yoki holat bo‘yicha qidirish"
              />
            </CardHeader>
            <CardContent>
              {ordersLoading ? (
                <Loader2 className="mx-auto my-8 h-7 w-7 animate-spin" />
              ) : ordersError ? (
                <div className="py-8 text-center">
                  <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
                  <p>{ordersError}</p>
                  <Button variant="outline" size="sm" onClick={() => void loadOrders()}>
                    Qayta urinish
                  </Button>
                </div>
              ) : !visibleOrders.length ? (
                <p className="py-8 text-center">Buyurtmalar topilmadi</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className={STICKY_HEAD}>Buyurtma #</TableHead>
                        <TableHead className={STICKY_HEAD}>Sana</TableHead>
                        <TableHead className={`${STICKY_HEAD} text-right`}>Jami</TableHead>
                        <TableHead className={STICKY_HEAD}>Holat</TableHead>
                        <TableHead className={`${STICKY_HEAD} text-right`}>Amal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleOrders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell>{order.order_number}</TableCell>
                          <TableCell>{formatDate(order.created_at)}</TableCell>
                          <TableCell className="text-right">
                            {formatOrderMoney(order, order.total_amount)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={order.status === "completed" ? "default" : "outline"}>
                              {order.status === "completed"
                                ? "Tugallangan"
                                : order.status === "hold"
                                  ? "Kutilmoqda"
                                  : order.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => openOrder(order.id)}>
                              Ko‘rish
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">To‘lovlar</CardTitle>
            </CardHeader>
            <CardContent>
              {paymentsLoading ? (
                <p className="py-8 text-center">Yuklanmoqda...</p>
              ) : !payments.length ? (
                <p className="py-8 text-center">To‘lovlar tarixi yo‘q</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className={STICKY_HEAD}>To‘lov #</TableHead>
                          <TableHead className={STICKY_HEAD}>Sana/vaqt</TableHead>
                          <TableHead className={STICKY_HEAD}>Valyuta</TableHead>
                          <TableHead className={STICKY_HEAD}>Usul</TableHead>
                          <TableHead className={`${STICKY_HEAD} text-right`}>Summa</TableHead>
                          <TableHead className={STICKY_HEAD}>Izoh</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell>{payment.payment_number}</TableCell>
                            <TableCell>{formatDateTime(payment.created_at)}</TableCell>
                            <TableCell>{normalizeCurrency(payment.currency, "UZS")}</TableCell>
                            <TableCell>{paymentMethodLabel(payment.payment_method)}</TableCell>
                            <TableCell
                              className={`text-right font-semibold ${payment.operation === "payment_out" ? "text-destructive" : "text-emerald-600"}`}
                            >
                              {payment.operation === "payment_out" ? "−" : "+"}
                              {formatMoney(
                                Math.abs(payment.amount || 0),
                                normalizeCurrency(payment.currency, "UZS"),
                              )}
                            </TableCell>
                            <TableCell>{payment.notes || payment.op_type || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {paymentsHasMore && (
                    <div className="flex justify-center pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={paymentsLoadingMore}
                        onClick={() => void loadPayments(true)}
                      >
                        {paymentsLoadingMore ? "Yuklanmoqda..." : "Yana yuklash"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ledger">
          <Card>
            <CardHeader className="flex flex-col gap-2 space-y-0 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <div>
                <CardTitle className="text-sm sm:text-base">Hisob tarixi</CardTitle>
                {ledgerOrder === "oldest" && visibleLedger.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Chronologik: oxirgi qator — joriy yakuniy holatga yaqin
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {canExport && ledger.length > 0 && (
                  <Button variant="outline" size="sm" onClick={exportLedgerCsv}>
                    <Download className="mr-1 h-4 w-4" />
                    Eksport
                  </Button>
                )}
                <Select
                  value={ledgerOrder}
                  onValueChange={(value) => setLedgerOrder(value as "newest" | "oldest")}
                >
                  <SelectTrigger className="w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="oldest">Eng eski avval (qarz o‘sishi)</SelectItem>
                    <SelectItem value="newest">Eng yangi avval</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="px-3 pb-3 pt-0 sm:px-4">
              {ledgerLoading ? (
                <Loader2 className="mx-auto my-8 h-7 w-7 animate-spin" />
              ) : !visibleLedger.length ? (
                <p className="py-8 text-center">Hisob tarixi yo‘q</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className={STICKY_HEAD}>Sana/vaqt</TableHead>
                          <TableHead className={STICKY_HEAD}>Operatsiya</TableHead>
                          <TableHead className={STICKY_HEAD}>Buyurtma</TableHead>
                          <TableHead className={STICKY_HEAD}>Xodim</TableHead>
                          <TableHead className={`${STICKY_HEAD} text-right`}>
                            Sotuv / Umumiy
                          </TableHead>
                          <TableHead className={`${STICKY_HEAD} text-right`}>Olindi</TableHead>
                          <TableHead className={`${STICKY_HEAD} text-right`}>Berildi</TableHead>
                          <TableHead className={`${STICKY_HEAD} text-right`}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dotted border-muted-foreground/60">
                                  Qoldi
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                Shu amaldan keyingi bitta mijoz balansi. Oxirgi qator («Hozir») —
                                joriy balans; yuqoridagi «Mijoz balansi» bilan bir xil.
                              </TooltipContent>
                            </Tooltip>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleLedger.map((entry, index) => {
                          const code = String(entry.op_code || "").toUpperCase();
                          const allocationOrder =
                            entry.allocations?.find((a) => a.order_id)?.order_id || null;
                          const linkedOrder =
                            allocationOrder ||
                            (entry.type === "sale" ||
                            ["CREDIT_SALE", "SALE_ON_CREDIT", "SALE_PAYMENT", "SALE_RETURN"].includes(
                              code,
                            )
                              ? entry.ref_id
                              : null);
                          const currency = normalizeCurrency(entry.currency, "UZS");
                          const flow = ledgerCashFlow(entry, orderAmountsById);
                          const running = ledgerRunningPosition(entry);
                          const isLast =
                            ledgerOrder === "oldest" && index === visibleLedger.length - 1;
                          const staffName = entry.created_by_name || entry.created_by || "—";
                          const method = paymentMethodLabel(entry.method);
                          const orderLabel = linkedOrder
                            ? orders.find((o) => o.id === linkedOrder)?.order_number ||
                              entry.ref_no ||
                              null
                            : null;
                          return (
                            <TableRow
                              key={entry.id}
                              className={`${linkedOrder ? "cursor-pointer" : ""} ${
                                isLast ? "bg-muted/40" : ""
                              }`}
                              onClick={linkedOrder ? () => openOrder(linkedOrder) : undefined}
                            >
                              <TableCell className="whitespace-nowrap py-1.5 text-xs tabular-nums">
                                {formatDateTime(
                                  ledgerTimeMsById.get(String(entry.id || "")) ??
                                    entry.created_at,
                                )}
                              </TableCell>
                              <TableCell className="max-w-[160px] py-1.5">
                                <div className="flex flex-col gap-0.5">
                                  {entry.note ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge
                                          variant="outline"
                                          className={`w-fit max-w-full truncate text-[11px] ${ledgerOpBadgeClass(entry)}`}
                                        >
                                          {ledgerOpLabel(entry)}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs text-xs">
                                        {entry.note}
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className={`w-fit text-[11px] ${ledgerOpBadgeClass(entry)}`}
                                    >
                                      {ledgerOpLabel(entry)}
                                    </Badge>
                                  )}
                                  {method !== "—" && (
                                    <span className="text-[10px] text-muted-foreground">
                                      {method}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="py-1.5">
                                {linkedOrder ? (
                                  <Button
                                    variant="link"
                                    className="h-auto p-0 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openOrder(linkedOrder);
                                    }}
                                  >
                                    {orderLabel || "Ko‘rish"}
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    {orderLabel || "—"}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell
                                className="max-w-[110px] truncate py-1.5 text-xs"
                                title={staffName}
                              >
                                {staffName}
                              </TableCell>
                              <TableCell className="py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                                {flow.total > 0.009
                                  ? formatMoney(flow.total, currency)
                                  : "—"}
                              </TableCell>
                              <TableCell className="py-1.5 text-right text-sm font-semibold tabular-nums text-emerald-600">
                                {flow.received > 0.009
                                  ? formatMoney(flow.received, currency)
                                  : "—"}
                              </TableCell>
                              <TableCell className="py-1.5 text-right text-sm font-semibold tabular-nums text-destructive">
                                {flow.given > 0.009
                                  ? formatMoney(flow.given, currency)
                                  : "—"}
                              </TableCell>
                              <TableCell
                                className={`py-1.5 text-right text-sm font-bold tabular-nums ${running.className}`}
                              >
                                {formatCashierSigned(running.signed, (abs) =>
                                  formatMoney(abs, currency),
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        <TableRow className="border-t-2 bg-muted/50 hover:bg-muted/50">
                          <TableCell
                            colSpan={7}
                            className="py-2 text-xs font-medium text-muted-foreground"
                          >
                            Hozir — joriy mijoz balansi
                          </TableCell>
                          <TableCell
                            className={`py-2 text-right text-sm font-bold tabular-nums ${signedBalanceClassName(
                              toCashierSigned(position.net),
                            )}`}
                          >
                            {formatCashierSigned(toCashierSigned(position.net), formatMoneyUZS)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                  <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                    «Qoldi» — har amaldan keyingi yuruvchi balans (+ qarz, − ortiqcha to‘lov).
                    Oxirgi qator / «Hozir» = «Mijoz balansi» va ro‘yxatdagi Balans.
                  </p>
                  {!ledgerMatchesHisobHolati && chronologicallyLastLedger && (
                    <p className="mt-1 flex gap-1.5 text-[11px] leading-snug text-amber-800 dark:text-amber-200">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Oxirgi tarixiy Qoldi joriy balans bilan mos emas (eski yozuvlarda snapshot
                        to‘liq emas bo‘lishi mumkin). Kassir uchun to‘g‘ri raqam —{" "}
                        <b>Mijoz balansi / Hozir</b>.
                      </span>
                    </p>
                  )}
                  {ledgerHasMore && (
                    <div className="flex justify-center pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={ledgerLoadingMore}
                        onClick={() => void loadLedger(true)}
                      >
                        {ledgerLoadingMore ? "Yuklanmoqda..." : "Yana yuklash"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bonus">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Bonuslar</CardTitle>
              {canManageLoyalty && isElectron() && (
                <Button variant="outline" size="sm" onClick={() => setBonusOpen(true)}>
                  Korreksiya
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {!isElectron() ? (
                <p>Faqat desktop ilovada ko‘rinadi.</p>
              ) : bonusLoading ? (
                <Loader2 className="mx-auto h-7 w-7 animate-spin" />
              ) : !bonusLedger.length ? (
                <p className="py-8 text-center">Yozuvlar yo‘q</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className={STICKY_HEAD}>Sana</TableHead>
                        <TableHead className={STICKY_HEAD}>Tur</TableHead>
                        <TableHead className={STICKY_HEAD}>Ball</TableHead>
                        <TableHead className={STICKY_HEAD}>Buyurtma</TableHead>
                        <TableHead className={STICKY_HEAD}>Izoh</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bonusLedger.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{formatDateTime(row.created_at)}</TableCell>
                          <TableCell>
                            {row.type === "earn"
                              ? "Yig‘ildi"
                              : row.type === "redeem"
                                ? "Ishlatildi"
                                : row.type === "adjust"
                                  ? "Korreksiya"
                                  : "Avtomatik"}
                          </TableCell>
                          <TableCell>
                            {row.points > 0 ? "+" : ""}
                            {row.points}
                          </TableCell>
                          <TableCell>
                            {row.order_id ? (
                              <Button variant="link" onClick={() => openOrder(row.order_id!)}>
                                Ochish
                              </Button>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>{row.note || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={bonusOpen} onOpenChange={setBonusOpen}>
        <DialogContent aria-describedby="bonus-desc">
          <DialogHeader>
            <DialogTitle>Bonus korreksiyasi</DialogTitle>
            <DialogDescription id="bonus-desc">Butun son va sabab majburiy.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="bonus-delta">Ball (±)</Label>
              <Input
                id="bonus-delta"
                type="number"
                value={bonusDelta ?? ""}
                onChange={(e) =>
                  setBonusDelta(e.target.value === "" ? null : Number(e.target.value))
                }
              />
            </div>
            <div>
              <Label htmlFor="bonus-note">Sabab</Label>
              <Textarea
                id="bonus-note"
                value={bonusNote}
                onChange={(e) => setBonusNote(e.target.value)}
              />
            </div>
            {profile?.role === "manager" && bonusDelta != null && Math.abs(bonusDelta) >= 1000 && (
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={bonusApproved}
                  onChange={(e) => setBonusApproved(e.target.checked)}
                />
                Katta korreksiyani tasdiqlayman
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBonusOpen(false)}>
              Bekor
            </Button>
            <Button disabled={bonusSaving || !bonusNote.trim()} onClick={() => void adjustBonus()}>
              {bonusSaving ? "Saqlanmoqda..." : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={reissueOpen} onOpenChange={setReissueOpen}>
        <DialogContent aria-describedby="reissue-desc">
          <DialogHeader>
            <DialogTitle>Loyalty QR qayta chiqarish</DialogTitle>
            <DialogDescription id="reissue-desc">
              Eski QR tarixda saqlanadi. Sabab majburiy.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="reissue-reason">Sabab</Label>
            <Textarea
              id="reissue-reason"
              value={reissueReason}
              onChange={(e) => setReissueReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReissueOpen(false)}>
              Bekor
            </Button>
            <Button
              disabled={reissueSaving || !reissueReason.trim()}
              onClick={() => void reissueLoyalty()}
            >
              {reissueSaving ? "Jarayonda..." : "Qayta chiqarish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReceivePaymentModal
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        customer={customer}
        source="customers"
        initialOpKind={paymentInitialKind}
        onSuccess={() => {
          void loadCustomer();
          void loadPayments();
          void loadLedger();
          void loadBonus();
          void loadOpenCreditOrders();
        }}
      />
      {id && (
        <CustomerCreditOrdersSheet
          open={creditSheetOpen}
          onOpenChange={setCreditSheetOpen}
          customerId={id}
          customerName={customer.name}
          advanceAvailable={position.advance}
          onUpdated={() => {
            void loadOpenCreditOrders();
            void loadCustomer();
          }}
        />
      )}
    </div>
  );
}
