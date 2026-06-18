import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/lib/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DatabaseSourceSettings } from '@/components/settings/DatabaseSourceSettings';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Save,
  AlertTriangle,
  Building2,
  Monitor,
  CreditCard,
  Receipt,
  Package,
  Hash,
  Shield,
  Globe,
  Coins,
  Wifi,
  RefreshCw,
  Trash2,
  Server,
  Gift,
  Loader2,
  HardDrive,
  Database,
  SlidersHorizontal,
  Truck,
  Image as ImageIcon,
  Upload,
  X,
  Download,
} from 'lucide-react';
import { getSettingsByCategory, bulkUpdateSettings } from '@/db/api';
import { notifyPosSettingsChanged } from '@/hooks/usePosTerminalSettings';
import { notifyPaymentSettingsChanged } from '@/hooks/usePaymentSettings';
import { notifyReceiptSettingsChanged } from '@/hooks/useReceiptSettings';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
// Removed: Network status, sync engine, offline DB, reset functions - no longer using Supabase
import { clearAllBrowserStorageAndReload } from '@/lib/clearBrowserStorage';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { isElectron, requireElectron, handleIpcResponse, formatUserFacingError } from '@/utils/electron';
import type {
  CompanySettings,
  POSSettings,
  PaymentSettings,
  TaxSettings,
  ReceiptSettings,
  InventorySettings,
  NumberingSettings,
  SecuritySettings,
  LocalizationSettings,
} from '@/types/database';
import PageBreadcrumb from '@/components/common/PageBreadcrumb';
import { ExchangeRatesSettings } from '@/components/settings/ExchangeRatesSettings';

const MARKETPLACE_TUNING_DEFAULTS = {
  search_prefilter_limit: 500,
  trending_recent_weight: 2,
  trending_availability_bonus: 8,
  trending_margin_divisor: 1000,
  trending_margin_cap: 80,
};

type CourierRow = {
  id: number;
  telegram_id?: number | null;
  username?: string | null;
  display_name?: string | null;
  phone?: string | null;
  active: number;
  created_at?: string;
  updated_at?: string;
};

function normalizeMarketplaceTuning(input: typeof MARKETPLACE_TUNING_DEFAULTS): typeof MARKETPLACE_TUNING_DEFAULTS {
  const intInRange = (v: number, min: number, max: number, fallback: number) => {
    const n = Number.isFinite(v) ? Math.floor(v) : fallback;
    return Math.min(max, Math.max(min, n));
  };
  const floatInRange = (v: number, min: number, max: number, fallback: number) => {
    const n = Number.isFinite(v) ? v : fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    search_prefilter_limit: intInRange(
      Number(input.search_prefilter_limit),
      100,
      5000,
      MARKETPLACE_TUNING_DEFAULTS.search_prefilter_limit,
    ),
    trending_recent_weight: floatInRange(
      Number(input.trending_recent_weight),
      0,
      20,
      MARKETPLACE_TUNING_DEFAULTS.trending_recent_weight,
    ),
    trending_availability_bonus: floatInRange(
      Number(input.trending_availability_bonus),
      0,
      100,
      MARKETPLACE_TUNING_DEFAULTS.trending_availability_bonus,
    ),
    trending_margin_divisor: intInRange(
      Number(input.trending_margin_divisor),
      1,
      1_000_000,
      MARKETPLACE_TUNING_DEFAULTS.trending_margin_divisor,
    ),
    trending_margin_cap: floatInRange(
      Number(input.trending_margin_cap),
      0,
      10_000,
      MARKETPLACE_TUNING_DEFAULTS.trending_margin_cap,
    ),
  };
}

async function clearAllLocalData() {
  // Minimal safe implementation: clear browser storage and reload.
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {}
}

async function resetDatabase(payload: { confirmText: string }) {
  if (!isElectron()) {
    throw new Error(i18n.t('settings.errors.dbResetDesktopOnly'));
  }
  const api = requireElectron();
  // This will relaunch the app on success
  return handleIpcResponse(api.settings.resetDatabase(payload));
}

async function downloadDatabaseToPc() {
  if (!isElectron()) {
    throw new Error(i18n.t('settings.network.downloadDesktopOnly'));
  }
  const api = requireElectron();
  return handleIpcResponse<{ canceled?: boolean; filePath?: string }>(api.database.downloadToPc());
}

const DB_UPLOAD_CONFIRM_TEXT = 'TASDIQLAYMAN';

async function uploadDatabaseToServer(payload: { confirmText: string }) {
  if (!isElectron()) {
    throw new Error(i18n.t('settings.network.uploadDesktopOnly'));
  }
  const api = requireElectron();
  return handleIpcResponse<{
    canceled?: boolean;
    restartRequired?: boolean;
    relaunchScheduled?: boolean;
  }>(api.database.uploadToServer(payload));
}

function clearLocalMockDataForDbReset() {
  // Some legacy modules still store data in localStorage (e.g., expenses/returns).
  // Resetting SQLite alone won't clear these, so we remove them explicitly.
  const keys = [
    'pos_expenses',
    'pos_sales_returns',
    'pos_sales_return_items',
  ];
  try {
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // ignore storage errors
  }
}

/** Mahalliy maʼlumotlar — bulut sinxroni yo‘q; faqat brauzer qatlamini tozalash */
function OfflineSettingsTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [clearingCache, setClearingCache] = useState(false);

  const handleClearCache = async () => {
    if (!confirm(t('settings.offline.clearConfirm'))) {
      return;
    }

    setClearingCache(true);
    try {
      await clearAllLocalData();
      toast({
        title: t('settings.offline.toastClearedTitle'),
        description: t('settings.offline.toastClearedDesc'),
      });
    } catch (error) {
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: error instanceof Error ? error.message : t('settings.offline.toastClearErr'),
        variant: 'destructive',
      });
    } finally {
      setClearingCache(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          {t('settings.offline.title')}
        </CardTitle>
        <CardDescription>{t('settings.offline.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <Wifi className="h-4 w-4" />
          <AlertTitle>{t('settings.offline.autonomousTitle')}</AlertTitle>
          <AlertDescription className="text-sm space-y-2">
            <p>
              {t('settings.offline.autonomousP1a')}{' '}
              <strong>{t('settings.offline.autonomousP1b')}</strong> {t('settings.offline.autonomousP1c')}
            </p>
            <p className="text-muted-foreground text-xs">{t('settings.offline.autonomousP2')}</p>
          </AlertDescription>
        </Alert>

        <div className="space-y-3 border-t pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <Label>{t('settings.offline.clearTitle')}</Label>
              <p className="text-xs text-muted-foreground max-w-xl">{t('settings.offline.clearDesc')}</p>
            </div>
            <Button
              variant="destructive"
              className="shrink-0"
              onClick={handleClearCache}
              disabled={clearingCache}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {clearingCache ? t('settings.offline.clearing') : t('settings.offline.clearBtn')}
            </Button>
          </div>
        </div>

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t('settings.offline.noteTitle')}</AlertTitle>
          <AlertDescription className="text-xs">{t('settings.offline.noteDesc')}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [activeTab, setActiveTab] = useState('company');
  const [resettingDB, setResettingDB] = useState(false);
  const [downloadingDb, setDownloadingDb] = useState(false);
  const [uploadingDb, setUploadingDb] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [clearingLocal, setClearingLocal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showUploadConfirm, setShowUploadConfirm] = useState(false);
  const [showMarketplaceResetConfirm, setShowMarketplaceResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [uploadConfirmText, setUploadConfirmText] = useState('');
  /** Tab to activate after user discards unsaved changes */
  const pendingTabRef = useRef<string | null>(null);
  /** File input for company logo upload (hidden). */
  const logoFileInputRef = useRef<HTMLInputElement>(null);

  // Batch (partiya) mode config (DB settings)
  const [batchCfgLoading, setBatchCfgLoading] = useState(false);
  const [batchCfg, setBatchCfg] = useState<{
    enabled: boolean;
    cutoverAt: string | null;
    costMode: string | null;
  }>({ enabled: false, cutoverAt: null, costMode: null });

  // HOST/CLIENT network mode config (local file in userData)
  const [posNetConfig, setPosNetConfig] = useState<any>(null);
  const [posNetLoading, setPosNetLoading] = useState(false);
  const [posNetSaving, setPosNetSaving] = useState(false);
  const [posNetTesting, setPosNetTesting] = useState(false);
  const [posNetTestResult, setPosNetTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [couriers, setCouriers] = useState<CourierRow[]>([]);
  const [couriersLoading, setCouriersLoading] = useState(false);
  const [courierSaving, setCourierSaving] = useState(false);
  const [newCourierIdentifier, setNewCourierIdentifier] = useState('');
  const [newCourierName, setNewCourierName] = useState('');
  const [newCourierPhone, setNewCourierPhone] = useState('');

  const [companySettings, setCompanySettings] = useState<CompanySettings>({
    name: '',
    legal_name: '',
    logo_url: '',
    address_country: '',
    address_city: '',
    address_street: '',
    phone: '',
    email: '',
    website: '',
    tax_id: '',
  });

  const [posSettings, setPosSettings] = useState<POSSettings>({
    mode: 'retail',
    enable_hold_order: true,
    enable_mixed_payment: true,
    require_customer_for_credit: true,
    auto_logout_minutes: 0,
    show_low_stock_warning: true,
    quick_access_limit: 12,
  });

  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>({
    methods: ['cash', 'card', 'qr', 'credit'],
    method_labels: {},
  });

  const [taxSettings, setTaxSettings] = useState<TaxSettings>({
    enabled: false,
    default_rate: 15,
    inclusive: true,
    per_product_override: false,
  });

  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>({
    auto_print: true,
    header_text: '',
    middle_text: '',
    footer_text: '',
    show_logo: true,
    show_cashier: true,
    show_customer: true,
    show_sku: true,
    paper_size: '78mm',
  });

  const [inventorySettings, setInventorySettings] = useState<InventorySettings>({
    tracking_enabled: true,
    default_min_stock: 10,
    allow_negative_stock: 'allow_with_warning',
    cost_calculation: 'latest_purchase',
    adjustment_approval_required: false,
  });

  const [numberingSettings, setNumberingSettings] = useState<NumberingSettings>({
    order_prefix: 'POS-',
    order_format: 'POS-YYYYMMDD-#####',
    return_prefix: 'RET-',
    return_format: 'RET-YYYYMMDD-#####',
    purchase_prefix: 'PO-',
    purchase_format: 'PO-YYYYMMDD-#####',
    movement_prefix: 'MOV-',
    movement_format: 'MOV-YYYYMMDD-#####',
  });

  const [securitySettings, setSecuritySettings] = useState<SecuritySettings>({
    min_password_length: 6,
    require_strong_password: false,
    max_failed_attempts: 5,
    session_timeout_minutes: 480,
    allow_multiple_sessions: true,
    enable_activity_logging: true,
  });

  const [localizationSettings, setLocalizationSettings] = useState<LocalizationSettings>({
    default_language: 'en',
    available_languages: [],
    default_currency: 'UZS',
    currency_symbol: 'UZS',
    currency_position: 'after',
    thousand_separator: ' ',
    decimal_separator: '.',
  });
  const [marketplaceTuning, setMarketplaceTuning] = useState(MARKETPLACE_TUNING_DEFAULTS);

  /** Usta (master-tier) mijoz loyalty — `settings.category` = sales */
  const [masterLoyaltyEnabled, setMasterLoyaltyEnabled] = useState(false);
  const [masterLoyaltyPointsPerUzs, setMasterLoyaltyPointsPerUzs] = useState(1000);
  const [generalLoyaltyEnabled, setGeneralLoyaltyEnabled] = useState(false);
  const [loyaltyEarnScope, setLoyaltyEarnScope] = useState<'master_only' | 'all_registered' | 'exclude_walk_in'>(
    'master_only'
  );
  const [loyaltyEarnPointsPerUzs, setLoyaltyEarnPointsPerUzs] = useState(1000);
  const [loyaltyMinOrderUzs, setLoyaltyMinOrderUzs] = useState(0);
  const [loyaltyRedeemEnabled, setLoyaltyRedeemEnabled] = useState(false);
  const [loyaltyRedeemPointsPerUzs, setLoyaltyRedeemPointsPerUzs] = useState(100);
  const [loyaltyRedeemMinPoints, setLoyaltyRedeemMinPoints] = useState(1);
  const [loyaltyRedeemMaxPercent, setLoyaltyRedeemMaxPercent] = useState(50);

  useEffect(() => {
    loadAllSettings();
    loadPosNetConfig();
  }, []);

  useEffect(() => {
    if (profile?.role === 'admin') {
      loadCouriers();
    }
  }, [profile?.role]);

  useEffect(() => {
    if (batchCfg.enabled && inventorySettings.cost_calculation === 'average_cost') {
      setInventorySettings((prev) => ({ ...prev, cost_calculation: 'latest_purchase' }));
      setHasUnsavedChanges(true);
    }
  }, [batchCfg.enabled, inventorySettings.cost_calculation]);

  const loadBatchConfig = async () => {
    if (!isElectron()) return;
    try {
      setBatchCfgLoading(true);
      const api = requireElectron();
      const enabled = await handleIpcResponse<any>(api.settings.get('inventory.batch_mode_enabled')).catch(() => false);
      const cutoverAt = await handleIpcResponse<any>(api.settings.get('inventory.batch_cutover_at')).catch(() => null);
      const costMode = await handleIpcResponse<any>(api.settings.get('inventory.batch_opening_cost_mode')).catch(
        () => 'last_received_po_cost'
      );
      setBatchCfg({
        enabled: !!enabled,
        cutoverAt: cutoverAt ? String(cutoverAt) : null,
        costMode: costMode ? String(costMode) : null,
      });
    } finally {
      setBatchCfgLoading(false);
    }
  };

  const loadPosNetConfig = async () => {
    try {
      setPosNetLoading(true);
      setPosNetTestResult(null);
      const api = (window as any)?.posApi?.appConfig;
      if (!api?.get) return;
      const res = await api.get();
      if (res?.success) {
        setPosNetConfig(res.data);
      } else {
        throw new Error(res?.error?.message || 'Failed to load POS network config');
      }
    } catch (e) {
      console.error('Error loading pos-config.json:', e);
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: e instanceof Error ? e.message : t('settings.toast.netLoadErr'),
        variant: 'destructive',
      });
    } finally {
      setPosNetLoading(false);
    }
  };

  const savePosNetConfig = async (patch: any) => {
    try {
      setPosNetSaving(true);
      const api = (window as any)?.posApi?.appConfig;
      if (!api?.set) throw new Error('posApi.appConfig.set not available');
      const res = await api.set(patch);
      if (res?.success) {
        setPosNetConfig(res.data);
        setHasUnsavedChanges(false);
        toast({
          title: t('settings.toast.netSavedTitle'),
          description: t('settings.toast.netSavedDesc'),
        });
      } else {
        throw new Error(res?.error?.message || 'Failed to save POS network config');
      }
    } catch (e) {
      console.error('Error saving pos-config.json:', e);
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: formatUserFacingError(e, t('settings.toast.netSaveErr')),
        variant: 'destructive',
      });
    } finally {
      setPosNetSaving(false);
    }
  };

  const testHostConnection = async () => {
    try {
      setPosNetTesting(true);
      setPosNetTestResult(null);

      const hostUrl: string = String(posNetConfig?.client?.hostUrl || '').replace(/\/+$/, '');
      const secret: string = String(posNetConfig?.client?.secret || '');
      if (!hostUrl) {
        setPosNetTestResult({ ok: false, message: t('settings.network.errEmptyUrl') });
        return;
      }
      if (!secret) {
        setPosNetTestResult({ ok: false, message: t('settings.network.errEmptySecret') });
        return;
      }

      const res = await fetch(`${hostUrl}/health`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret}` },
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        setPosNetTestResult({ ok: true, message: t('settings.network.testOkDetail') });
      } else {
        setPosNetTestResult({
          ok: false,
          message: `${t('settings.network.connFail')}: ${json?.error?.message || res.statusText}`,
        });
      }
    } catch (e) {
      setPosNetTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setPosNetTesting(false);
    }
  };

  const canManageDatabase = profile?.role === 'admin' || profile?.role === 'manager';

  const handleDownloadDatabase = async () => {
    if (!isElectron()) {
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: t('settings.network.downloadDesktopOnly'),
        variant: 'destructive',
      });
      return;
    }

    setDownloadingDb(true);
    try {
      const result = await downloadDatabaseToPc();
      if (result?.canceled) return;
      toast({
        title: t('settings.network.downloadToastOkTitle'),
        description: result?.filePath
          ? t('settings.network.downloadToastOkDesc', { path: result.filePath })
          : t('settings.network.downloadToastOkDescShort'),
      });
    } catch (error) {
      toast({
        title: t('settings.network.downloadToastErrTitle'),
        description: error instanceof Error ? error.message : t('settings.network.downloadToastErrDesc'),
        variant: 'destructive',
      });
    } finally {
      setDownloadingDb(false);
    }
  };

  useEffect(() => {
    if (!isElectron()) return;
    const api = requireElectron();
    if (typeof api.database?.onUploadProgress !== 'function') return;
    return api.database.onUploadProgress((progress: { percent?: number }) => {
      if (typeof progress?.percent === 'number') {
        setUploadProgress(progress.percent);
      }
    });
  }, []);

  const handleUploadDatabase = async () => {
    if (!isElectron()) {
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: t('settings.network.uploadDesktopOnly'),
        variant: 'destructive',
      });
      return;
    }

    if (uploadConfirmText !== DB_UPLOAD_CONFIRM_TEXT) {
      toast({
        title: t('settings.network.uploadConfirmInvalidTitle'),
        description: t('settings.network.uploadConfirmInvalidDesc'),
        variant: 'destructive',
      });
      return;
    }

    setShowUploadConfirm(false);
    setUploadingDb(true);
    setUploadProgress(0);
    try {
      const result = await uploadDatabaseToServer({ confirmText: uploadConfirmText });
      setUploadConfirmText('');
      if (result?.canceled) return;
      toast({
        title: t('settings.network.uploadToastOkTitle'),
        description: result?.restartRequired || result?.relaunchScheduled
          ? t('settings.network.uploadToastOkRestartDesc')
          : t('settings.network.uploadToastOkDesc'),
      });
    } catch (error) {
      toast({
        title: t('settings.network.uploadToastErrTitle'),
        description: error instanceof Error ? error.message : t('settings.network.uploadToastErrDesc'),
        variant: 'destructive',
      });
    } finally {
      setUploadingDb(false);
      setUploadProgress(0);
    }
  };

  const loadAllSettings = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    try {
      if (!silent) setLoading(true);
      const [company, pos, payment, tax, receipt, inventory, numbering, security, localization, sales, marketplace] =
        await Promise.all([
          getSettingsByCategory('company'),
          getSettingsByCategory('pos'),
          getSettingsByCategory('payment'),
          getSettingsByCategory('tax'),
          getSettingsByCategory('receipt'),
          getSettingsByCategory('inventory'),
          getSettingsByCategory('numbering'),
          getSettingsByCategory('security'),
          getSettingsByCategory('localization'),
          getSettingsByCategory('sales'),
          getSettingsByCategory('marketplace'),
        ]);

      setCompanySettings((prev) => {
        const c = { ...(company as Record<string, unknown>) };
        const fieldsAsString = [
          'name',
          'legal_name',
          'logo_url',
          'address_country',
          'address_city',
          'address_street',
          'phone',
          'email',
          'website',
          'tax_id',
        ] as const;
        for (const f of fieldsAsString) {
          if (c[f] === undefined || c[f] === null) {
            c[f] = (prev as unknown as Record<string, unknown>)[f] ?? '';
          } else {
            c[f] = String(c[f]);
          }
        }
        return { ...prev, ...c } as CompanySettings;
      });
      setPosSettings((prev) => {
        const p = { ...(pos as Record<string, unknown>) };
        const toBool = (v: unknown, fallback: boolean) => {
          if (v === undefined || v === null || v === '') return fallback;
          if (typeof v === 'boolean') return v;
          if (typeof v === 'number') return v !== 0;
          const s = String(v).toLowerCase();
          if (s === '1' || s === 'true' || s === 'yes') return true;
          if (s === '0' || s === 'false' || s === 'no') return false;
          return fallback;
        };
        const toIntInRange = (v: unknown, fallback: number, min: number, max: number) => {
          const n = Number(v);
          if (!Number.isFinite(n)) return fallback;
          return Math.min(max, Math.max(min, Math.floor(n)));
        };
        const validModes = new Set(['retail', 'restaurant']);
        const mode = validModes.has(String(p.mode || '')) ? (p.mode as 'retail' | 'restaurant') : prev.mode;
        return {
          ...prev,
          mode,
          enable_hold_order: toBool(p.enable_hold_order, prev.enable_hold_order ?? true),
          enable_mixed_payment: toBool(p.enable_mixed_payment, prev.enable_mixed_payment ?? true),
          require_customer_for_credit: toBool(p.require_customer_for_credit, prev.require_customer_for_credit ?? true),
          show_low_stock_warning: toBool(p.show_low_stock_warning, prev.show_low_stock_warning ?? true),
          auto_logout_minutes: toIntInRange(p.auto_logout_minutes, prev.auto_logout_minutes ?? 0, 0, 480),
          quick_access_limit: toIntInRange(p.quick_access_limit, prev.quick_access_limit ?? 12, 4, 24),
        } as POSSettings;
      });
      setPaymentSettings((prev) => {
        const p = { ...(payment as Record<string, unknown>) };
        const allMethods = ['cash', 'card', 'terminal', 'qr', 'credit'];
        let methods: string[];
        if (Array.isArray(p.methods)) {
          methods = (p.methods as unknown[])
            .map((m) => String(m || '').toLowerCase().trim())
            .filter((m) => allMethods.includes(m));
        } else if (typeof p.methods === 'string' && (p.methods as string).length > 0) {
          methods = (p.methods as string)
            .split(',')
            .map((m) => m.toLowerCase().trim())
            .filter((m) => allMethods.includes(m));
        } else {
          methods = prev.methods && prev.methods.length > 0 ? prev.methods : ['cash', 'card', 'qr', 'credit'];
        }
        if (!methods.includes('cash')) methods = ['cash', ...methods];
        const labels: Record<string, string> = { ...(prev.method_labels || {}) };
        const rawLabels = (p.method_labels && typeof p.method_labels === 'object'
          ? (p.method_labels as Record<string, unknown>)
          : {}) as Record<string, unknown>;
        for (const m of allMethods) {
          const v = rawLabels[m];
          if (typeof v === 'string') {
            const trimmed = v.trim();
            if (trimmed.length > 0) labels[m] = trimmed.slice(0, 32);
          }
        }
        return { ...prev, methods, method_labels: labels } as PaymentSettings;
      });
      setTaxSettings(tax as unknown as TaxSettings);
      setReceiptSettings((prev) => {
        const r = { ...(receipt as Record<string, unknown>) };
        const toBool = (v: unknown, fb: boolean) => {
          if (v === undefined || v === null || v === '') return fb;
          if (typeof v === 'boolean') return v;
          if (typeof v === 'number') return v !== 0;
          const s = String(v).toLowerCase();
          if (s === '1' || s === 'true' || s === 'yes') return true;
          if (s === '0' || s === 'false' || s === 'no') return false;
          return fb;
        };
        const validPaper = new Set(['58mm', '78mm', '80mm']);
        const paper_size = validPaper.has(String(r.paper_size || ''))
          ? (r.paper_size as '58mm' | '78mm' | '80mm')
          : prev.paper_size || '78mm';
        const safeText = (v: unknown, fb: string): string => {
          if (v === undefined || v === null) return fb;
          return String(v).slice(0, 500);
        };
        return {
          ...prev,
          paper_size,
          header_text: safeText(r.header_text, prev.header_text ?? ''),
          middle_text: safeText(r.middle_text, prev.middle_text ?? ''),
          footer_text: safeText(r.footer_text, prev.footer_text ?? ''),
          auto_print: toBool(r.auto_print, prev.auto_print ?? true),
          show_logo: toBool(r.show_logo, prev.show_logo ?? true),
          show_cashier: toBool(r.show_cashier, prev.show_cashier ?? true),
          show_customer: toBool(r.show_customer, prev.show_customer ?? true),
          show_sku: toBool(r.show_sku, prev.show_sku ?? true),
        } as ReceiptSettings;
      });
      setInventorySettings((prev) => {
        const inv = { ...(inventory as Record<string, unknown>) };
        const legacyNeg = inv.allow_negative_stock;
        if (legacyNeg === '1' || legacyNeg === 1 || legacyNeg === true) {
          inv.allow_negative_stock = 'allow_with_warning';
        } else if (legacyNeg === '0' || legacyNeg === 0 || legacyNeg === false) {
          inv.allow_negative_stock = 'block';
        }
        const validNegModes = new Set(['block', 'allow_with_warning', 'allow_without_warning']);
        if (!validNegModes.has(String(inv.allow_negative_stock || ''))) {
          inv.allow_negative_stock = prev.allow_negative_stock || 'allow_with_warning';
        }
        const validCostModes = new Set(['latest_purchase', 'average_cost']);
        if (!validCostModes.has(String(inv.cost_calculation || ''))) {
          inv.cost_calculation = prev.cost_calculation || 'latest_purchase';
        }
        const numericMin = Number(inv.default_min_stock);
        if (!Number.isFinite(numericMin) || numericMin < 0) {
          inv.default_min_stock = prev.default_min_stock ?? 10;
        } else {
          inv.default_min_stock = Math.floor(numericMin);
        }
        const toBool = (v: unknown) => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
        if (inv.tracking_enabled === undefined || inv.tracking_enabled === null || inv.tracking_enabled === '') {
          inv.tracking_enabled = prev.tracking_enabled ?? true;
        } else {
          inv.tracking_enabled = toBool(inv.tracking_enabled);
        }
        if (inv.adjustment_approval_required === undefined || inv.adjustment_approval_required === null || inv.adjustment_approval_required === '') {
          inv.adjustment_approval_required = prev.adjustment_approval_required ?? false;
        } else {
          inv.adjustment_approval_required = toBool(inv.adjustment_approval_required);
        }
        return { ...prev, ...inv } as InventorySettings;
      });
      setNumberingSettings((prev) => {
        const n = { ...(numbering as Record<string, unknown>) };
        const cleanPrefix = (v: unknown, fb: string): string => {
          if (v === undefined || v === null) return fb;
          const s = String(v).trim().slice(0, 8);
          return s.replace(/[^A-Za-z0-9_\-.]/g, '') || fb;
        };
        const cleanFormat = (v: unknown, fb: string): string => {
          if (v === undefined || v === null) return fb;
          return String(v).slice(0, 64) || fb;
        };
        return {
          ...prev,
          order_prefix: cleanPrefix(n.order_prefix, prev.order_prefix ?? 'POS-'),
          order_format: cleanFormat(n.order_format, prev.order_format ?? 'POS-YYYYMMDD-#####'),
          return_prefix: cleanPrefix(n.return_prefix, prev.return_prefix ?? 'RET-'),
          return_format: cleanFormat(n.return_format, prev.return_format ?? 'RET-YYYYMMDD-#####'),
          purchase_prefix: cleanPrefix(n.purchase_prefix, prev.purchase_prefix ?? 'PO-'),
          purchase_format: cleanFormat(n.purchase_format, prev.purchase_format ?? 'PO-YYYYMMDD-#####'),
          movement_prefix: cleanPrefix(n.movement_prefix, prev.movement_prefix ?? 'MOV-'),
          movement_format: cleanFormat(n.movement_format, prev.movement_format ?? 'MOV-YYYYMMDD-#####'),
        } as NumberingSettings;
      });
      setSecuritySettings((prev) => {
        const s = { ...(security as Record<string, unknown>) };
        const toBool = (v: unknown, fb: boolean): boolean => {
          if (v === '1' || v === 1 || v === true || v === 'true') return true;
          if (v === '0' || v === 0 || v === false || v === 'false') return false;
          return fb;
        };
        const clampNum = (v: unknown, fb: number, min: number, max: number): number => {
          const n = Number(v);
          if (!Number.isFinite(n)) return fb;
          return Math.min(max, Math.max(min, Math.round(n)));
        };
        return {
          ...prev,
          min_password_length: clampNum(s.min_password_length, prev.min_password_length ?? 6, 4, 64),
          require_strong_password: toBool(s.require_strong_password, prev.require_strong_password ?? false),
          max_failed_attempts: clampNum(s.max_failed_attempts, prev.max_failed_attempts ?? 5, 3, 20),
          session_timeout_minutes: clampNum(s.session_timeout_minutes, prev.session_timeout_minutes ?? 480, 5, 1440),
          allow_multiple_sessions: toBool(s.allow_multiple_sessions, prev.allow_multiple_sessions ?? true),
          enable_activity_logging: toBool(s.enable_activity_logging, prev.enable_activity_logging ?? true),
        } as SecuritySettings;
      });
      setLocalizationSettings((prev) => {
        const l = { ...(localization as Record<string, unknown>) };
        const validLang = new Set(['en', 'uz', 'ru']);
        const validPos = new Set(['before', 'after']);
        const safeStr = (v: unknown, fb: string, max = 32): string => {
          if (v === undefined || v === null) return fb;
          const s = String(v).trim().slice(0, max);
          return s || fb;
        };
        const oneChar = (v: unknown, fb: string): string => {
          if (v === undefined || v === null) return fb;
          const s = String(v).slice(0, 1);
          return s || fb;
        };
        return {
          ...prev,
          default_language: validLang.has(String(l.default_language || ''))
            ? (l.default_language as 'en' | 'uz' | 'ru')
            : prev.default_language || 'uz',
          default_currency: safeStr(l.default_currency, prev.default_currency ?? 'UZS', 8).toUpperCase(),
          currency_symbol: safeStr(l.currency_symbol, prev.currency_symbol ?? 'UZS', 8),
          currency_position: validPos.has(String(l.currency_position || ''))
            ? (l.currency_position as 'before' | 'after')
            : prev.currency_position || 'after',
          thousand_separator: oneChar(l.thousand_separator, prev.thousand_separator ?? ' '),
          decimal_separator: oneChar(l.decimal_separator, prev.decimal_separator ?? '.'),
        } as LocalizationSettings;
      });

      const salesRec = sales as Record<string, unknown>;
      const en = salesRec['loyalty.master.enabled'];
      setMasterLoyaltyEnabled(en === true || en === 1 || en === '1' || String(en).toLowerCase() === 'true');
      const per = Number(salesRec['loyalty.master.points_per_uzs']);
      setMasterLoyaltyPointsPerUzs(Number.isFinite(per) && per > 0 ? per : 1000);

      const gen = salesRec['loyalty.general.enabled'];
      setGeneralLoyaltyEnabled(gen === true || gen === 1 || gen === '1' || String(gen).toLowerCase() === 'true');
      const scopeRaw = String(salesRec['loyalty.earn.scope'] || 'master_only').toLowerCase();
      if (scopeRaw === 'all_registered' || scopeRaw === 'exclude_walk_in') {
        setLoyaltyEarnScope(scopeRaw);
      } else {
        setLoyaltyEarnScope('master_only');
      }
      const ge = Number(salesRec['loyalty.earn.points_per_uzs']);
      setLoyaltyEarnPointsPerUzs(Number.isFinite(ge) && ge > 0 ? ge : 1000);
      const mo = Number(salesRec['loyalty.earn.min_order_uzs']);
      setLoyaltyMinOrderUzs(Number.isFinite(mo) && mo >= 0 ? mo : 0);

      const re = salesRec['loyalty.redeem.enabled'];
      setLoyaltyRedeemEnabled(re === true || re === 1 || re === '1' || String(re).toLowerCase() === 'true');
      const rpu = Number(salesRec['loyalty.redeem.points_per_uzs']);
      setLoyaltyRedeemPointsPerUzs(Number.isFinite(rpu) && rpu > 0 ? rpu : 100);
      const rmin = Number(salesRec['loyalty.redeem.min_points']);
      setLoyaltyRedeemMinPoints(Number.isFinite(rmin) && rmin > 0 ? Math.floor(rmin) : 1);
      const rmax = Number(salesRec['loyalty.redeem.max_percent_of_order']);
      setLoyaltyRedeemMaxPercent(Number.isFinite(rmax) && rmax > 0 ? Math.min(100, rmax) : 50);

      const mpRec = marketplace as Record<string, unknown>;
      const prefilter = Number(mpRec['search_prefilter_limit']);
      const recentWeight = Number(mpRec['trending_recent_weight']);
      const availBonus = Number(mpRec['trending_availability_bonus']);
      const marginDivisor = Number(mpRec['trending_margin_divisor']);
      const marginCap = Number(mpRec['trending_margin_cap']);
      setMarketplaceTuning(normalizeMarketplaceTuning({
        search_prefilter_limit: Number.isFinite(prefilter) && prefilter >= 100 ? Math.floor(prefilter) : MARKETPLACE_TUNING_DEFAULTS.search_prefilter_limit,
        trending_recent_weight: Number.isFinite(recentWeight) && recentWeight >= 0 ? recentWeight : MARKETPLACE_TUNING_DEFAULTS.trending_recent_weight,
        trending_availability_bonus: Number.isFinite(availBonus) && availBonus >= 0 ? availBonus : MARKETPLACE_TUNING_DEFAULTS.trending_availability_bonus,
        trending_margin_divisor: Number.isFinite(marginDivisor) && marginDivisor >= 1 ? marginDivisor : MARKETPLACE_TUNING_DEFAULTS.trending_margin_divisor,
        trending_margin_cap: Number.isFinite(marginCap) && marginCap >= 0 ? marginCap : MARKETPLACE_TUNING_DEFAULTS.trending_margin_cap,
      }));

      if (isElectron()) await loadBatchConfig();
    } catch (error) {
      console.error('Error loading settings:', error);
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: error instanceof Error ? error.message : t('settings.toast.loadErr'),
        variant: 'destructive',
      });
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadCouriers = async () => {
    if (!isElectron()) return;
    try {
      setCouriersLoading(true);
      const api = requireElectron();
      const rows = await handleIpcResponse<CourierRow[]>(
        api.couriers.list({ includeInactive: true })
      );
      setCouriers(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.error('Error loading couriers:', error);
      const raw = error instanceof Error ? error.message : 'Kuryerlar yuklanmadi';
      const description =
        /database connection is not open|database is not available/i.test(raw)
          ? 'Server bazasi hozir mavjud emas. pos-server ni qayta ishga tushiring yoki biroz kutib qayta urinib ko\'ring.'
          : raw;
      toast({
        title: t('settings.offline.toastErrTitle'),
        description,
        variant: 'destructive',
      });
    } finally {
      setCouriersLoading(false);
    }
  };

  const handleAddCourier = async () => {
    const identifier = newCourierIdentifier.trim();
    if (!identifier) {
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: 'Telegram username yoki ID kiriting',
        variant: 'destructive',
      });
      return;
    }
    const isNumericId = /^-?\d+$/.test(identifier);
    if (!isNumericId && !/^@?[A-Za-z0-9_]{3,32}$/.test(identifier)) {
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: 'Username 3-32 ta belgi, faqat A-Z, 0-9, _ ruxsat etiladi',
        variant: 'destructive',
      });
      return;
    }
    const phone = newCourierPhone.trim();
    if (phone && !/^\+?[0-9\s\-()]{7,20}$/.test(phone)) {
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: 'Telefon raqam noto‘g‘ri formatda',
        variant: 'destructive',
      });
      return;
    }
    try {
      setCourierSaving(true);
      const api = requireElectron();
      const payload: Record<string, unknown> = {
        display_name: newCourierName.trim().slice(0, 64) || undefined,
        phone: phone || undefined,
        active: true,
      };
      if (isNumericId) {
        const n = Number.parseInt(identifier, 10);
        if (!Number.isSafeInteger(n) || Math.abs(n) > 1e15) {
          throw new Error('Telegram ID juda katta');
        }
        payload.telegram_id = n;
      } else {
        payload.username = identifier.replace(/^@/, '');
      }
      await handleIpcResponse(api.couriers.upsert(payload));
      setNewCourierIdentifier('');
      setNewCourierName('');
      setNewCourierPhone('');
      await loadCouriers();
      toast({
        title: t('settings.toast.savedTitle'),
        description: 'Kuryer saqlandi',
      });
    } catch (error) {
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: error instanceof Error ? error.message : 'Kuryer saqlanmadi',
        variant: 'destructive',
      });
    } finally {
      setCourierSaving(false);
    }
  };

  const handleCourierActive = async (courier: CourierRow, active: boolean) => {
    try {
      setCourierSaving(true);
      const api = requireElectron();
      await handleIpcResponse(api.couriers.setActive(courier.id, active));
      await loadCouriers();
    } catch (error) {
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: error instanceof Error ? error.message : 'Kuryer holati yangilanmadi',
        variant: 'destructive',
      });
    } finally {
      setCourierSaving(false);
    }
  };

  const handleSave = async (category: string, settings: Record<string, unknown>) => {
    if (!profile?.id) {
      toast({
        title: t('settings.toast.loginRequiredTitle'),
        description: t('settings.toast.loginRequiredDesc'),
        variant: 'destructive',
      });
      return;
    }

    try {
      setSaving(true);
      await bulkUpdateSettings(category, settings, profile.id);
      setHasUnsavedChanges(false);
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      if (category === 'localization') {
        const lang = settings.default_language;
        if (lang === 'en' || lang === 'uz' || lang === 'ru') {
          await i18n.changeLanguage(lang);
          localStorage.setItem('pos:language', lang);
        }
      }
      if (category === 'pos') {
        notifyPosSettingsChanged();
      }
      if (category === 'payment') {
        notifyPaymentSettingsChanged();
      }
      if (category === 'receipt') {
        notifyReceiptSettingsChanged();
      }
      toast({
        title: t('settings.toast.savedTitle'),
        description: t('settings.toast.savedDesc'),
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: t('settings.offline.toastErrTitle'),
        description: error instanceof Error ? error.message : t('settings.toast.saveErr'),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTabChange = (value: string) => {
    if (value === activeTab) return;
    if (hasUnsavedChanges) {
      pendingTabRef.current = value;
      setShowUnsavedDialog(true);
      return;
    }
    setActiveTab(value);
  };

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{t('settings.common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageBreadcrumb
        items={[
          { label: t('settings.breadcrumb.home'), href: '/' },
          { label: t('settings.breadcrumb.settings'), href: '/settings' },
        ]}
      />

      <div>
        <h1 className="page-heading">{t('settings.header.title')}</h1>
        <p className="text-muted-foreground">{t('settings.header.subtitle')}</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className={`flex w-full flex-wrap gap-1 overflow-x-auto ${profile?.role === 'admin' ? 'xl:flex-nowrap' : ''}`}>
          <TabsTrigger value="company" className="gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden xl:inline">{t('settings.tabs.company')}</span>
          </TabsTrigger>
          <TabsTrigger value="pos" className="gap-2">
            <Monitor className="h-4 w-4" />
            <span className="hidden xl:inline">{t('settings.tabs.pos')}</span>
          </TabsTrigger>
          <TabsTrigger value="payment" className="gap-2">
            <CreditCard className="h-4 w-4" />
            <span className="hidden xl:inline">{t('settings.tabs.payment')}</span>
          </TabsTrigger>
          <TabsTrigger value="receipt" className="gap-2">
            <Receipt className="h-4 w-4" />
            <span className="hidden xl:inline">{t('settings.tabs.receipt')}</span>
          </TabsTrigger>
          <TabsTrigger value="inventory" className="gap-2">
            <Package className="h-4 w-4" />
            <span className="hidden xl:inline">{t('settings.tabs.inventory')}</span>
          </TabsTrigger>
          <TabsTrigger value="numbering" className="gap-2">
            <Hash className="h-4 w-4" />
            <span className="hidden xl:inline">{t('settings.tabs.numbering')}</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="h-4 w-4" />
            <span className="hidden xl:inline">{t('settings.tabs.security')}</span>
          </TabsTrigger>
          <TabsTrigger value="localization" className="gap-2">
            <Globe className="h-4 w-4" />
            <span className="hidden xl:inline">{t('settings.tabs.localization')}</span>
          </TabsTrigger>
          {profile?.role === 'admin' && (
            <TabsTrigger value="currency" className="gap-2">
              <Coins className="h-4 w-4" />
              <span className="hidden xl:inline">Valyuta</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="offline" className="gap-2">
            <HardDrive className="h-4 w-4" />
            <span className="hidden xl:inline">{t('settings.tabs.local')}</span>
          </TabsTrigger>
          {profile?.role === 'admin' && (
            <TabsTrigger value="marketplace" className="gap-2 shrink-0">
              <SlidersHorizontal className="h-4 w-4 shrink-0" />
              <span className="hidden xl:inline truncate max-w-[9rem]">{t('settings.marketplace.tab')}</span>
            </TabsTrigger>
          )}
          {profile?.role === 'admin' && (
            <TabsTrigger value="couriers" className="gap-2 shrink-0">
              <Truck className="h-4 w-4 shrink-0" />
              <span className="hidden xl:inline truncate max-w-[9rem]">{t('settings.marketplace.delivery')}</span>
            </TabsTrigger>
          )}
          {canManageDatabase && (
            <TabsTrigger value="network" className="gap-2">
              <Database className="h-4 w-4" />
              <span className="hidden xl:inline">{t('settings.tabs.database')}</span>
            </TabsTrigger>
          )}
          {profile?.role === 'admin' && (
            <TabsTrigger value="reset" className="gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span className="hidden xl:inline">{t('settings.tabs.systemReset')}</span>
            </TabsTrigger>
          )}
        </TabsList>

        {/* Company Profile Tab */}
        <TabsContent value="company">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.company.title')}</CardTitle>
              <CardDescription>{t('settings.company.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="company_name">
                    {t('settings.company.name')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="company_name"
                    value={companySettings.name}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, name: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder={t('settings.company.namePh')}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="legal_name">{t('settings.company.legalName')}</Label>
                  <Input
                    id="legal_name"
                    value={companySettings.legal_name}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, legal_name: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder={t('settings.company.legalPh')}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">{t('settings.company.phone')}</Label>
                  <Input
                    id="phone"
                    value={companySettings.phone}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, phone: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder={t('settings.company.phonePh')}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">{t('settings.company.email')}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={companySettings.email}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, email: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder={t('settings.company.emailPh')}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">{t('settings.company.website')}</Label>
                  <Input
                    id="website"
                    value={companySettings.website}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, website: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder={t('settings.company.websitePh')}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tax_id">{t('settings.company.taxId')}</Label>
                  <Input
                    id="tax_id"
                    value={companySettings.tax_id}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, tax_id: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder={t('settings.company.taxPh')}
                  />
                </div>
              </div>

              <div className="space-y-4 border-t pt-6">
                <h3 className="text-lg font-semibold">{t('settings.company.addressSection')}</h3>
                <div className="grid gap-6 xl:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="country">{t('settings.company.country')}</Label>
                    <Input
                      id="country"
                      value={companySettings.address_country}
                      onChange={(e) => {
                        setCompanySettings({ ...companySettings, address_country: e.target.value });
                        setHasUnsavedChanges(true);
                      }}
                      placeholder={t('settings.company.countryPh')}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="city">{t('settings.company.city')}</Label>
                    <Input
                      id="city"
                      value={companySettings.address_city}
                      onChange={(e) => {
                        setCompanySettings({ ...companySettings, address_city: e.target.value });
                        setHasUnsavedChanges(true);
                      }}
                      placeholder={t('settings.company.cityPh')}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="street">{t('settings.company.street')}</Label>
                    <Input
                      id="street"
                      value={companySettings.address_street}
                      onChange={(e) => {
                        setCompanySettings({ ...companySettings, address_street: e.target.value });
                        setHasUnsavedChanges(true);
                      }}
                      placeholder={t('settings.company.streetPh')}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 border-t pt-6">
                <h3 className="text-lg font-semibold">{t('settings.company.logoSection')}</h3>
                <p className="text-sm text-muted-foreground">{t('settings.company.logoSectionDesc')}</p>

                <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <Label htmlFor="logo_url">{t('settings.company.logoUrl')}</Label>
                    <Input
                      id="logo_url"
                      value={companySettings.logo_url}
                      onChange={(e) => {
                        setCompanySettings({ ...companySettings, logo_url: e.target.value });
                        setHasUnsavedChanges(true);
                      }}
                      placeholder={t('settings.company.logoUrlPh')}
                    />
                    <p className="text-xs text-muted-foreground">{t('settings.company.logoHint')}</p>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <input
                        ref={logoFileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const MAX_BYTES = 256 * 1024;
                          if (file.size > MAX_BYTES) {
                            toast({
                              title: t('settings.offline.toastErrTitle'),
                              description: t('settings.company.logoTooLarge'),
                              variant: 'destructive',
                            });
                            if (logoFileInputRef.current) logoFileInputRef.current.value = '';
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = () => {
                            const dataUrl = String(reader.result || '');
                            setCompanySettings({ ...companySettings, logo_url: dataUrl });
                            setHasUnsavedChanges(true);
                          };
                          reader.readAsDataURL(file);
                          if (logoFileInputRef.current) logoFileInputRef.current.value = '';
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => logoFileInputRef.current?.click()}
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        {t('settings.company.logoUpload')}
                      </Button>
                      {companySettings.logo_url ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCompanySettings({ ...companySettings, logo_url: '' });
                            setHasUnsavedChanges(true);
                          }}
                        >
                          <X className="mr-2 h-4 w-4" />
                          {t('settings.company.logoRemove')}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex h-32 w-32 items-center justify-center rounded-lg border bg-muted/40">
                    {companySettings.logo_url ? (
                      <img
                        src={companySettings.logo_url}
                        alt={t('settings.company.logoUrl')}
                        className="max-h-full max-w-full object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <ImageIcon className="h-10 w-10 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t pt-6">
                <Button variant="outline" onClick={() => loadAllSettings({ silent: true })}>
                  {t('settings.common.cancel')}
                </Button>
                <Button
                  onClick={() => {
                    const errors: string[] = [];
                    const name = String(companySettings.name || '').trim();
                    if (!name) errors.push(t('settings.company.errNameRequired'));

                    const email = String(companySettings.email || '').trim();
                    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                      errors.push(t('settings.company.errEmailInvalid'));
                    }

                    const website = String(companySettings.website || '').trim();
                    if (website && !/^(https?:\/\/|\/\/|[a-z0-9.-]+\.[a-z]{2,})/i.test(website)) {
                      errors.push(t('settings.company.errWebsiteInvalid'));
                    }

                    const taxId = String(companySettings.tax_id || '').trim();
                    if (taxId && !/^\d{6,15}$/.test(taxId)) {
                      errors.push(t('settings.company.errTaxIdInvalid'));
                    }

                    const logoUrl = String(companySettings.logo_url || '').trim();
                    if (logoUrl && !/^(https?:|data:image\/|\/)/i.test(logoUrl)) {
                      errors.push(t('settings.company.errLogoInvalid'));
                    }

                    if (errors.length > 0) {
                      toast({
                        title: t('settings.company.errTitle'),
                        description: errors.join('\n'),
                        variant: 'destructive',
                      });
                      return;
                    }

                    const normalized: Record<string, unknown> = {
                      ...companySettings,
                      name,
                      legal_name: String(companySettings.legal_name || '').trim(),
                      email,
                      website,
                      tax_id: taxId,
                      phone: String(companySettings.phone || '').trim(),
                      address_country: String(companySettings.address_country || '').trim(),
                      address_city: String(companySettings.address_city || '').trim(),
                      address_street: String(companySettings.address_street || '').trim(),
                      logo_url: logoUrl,
                    };
                    handleSave('company', normalized);
                  }}
                  disabled={saving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? t('settings.common.saving') : t('settings.common.saveChanges')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* POS Terminal Tab */}
        <TabsContent value="pos">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.pos.title')}</CardTitle>
              <CardDescription>{t('settings.pos.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pos_mode">{t('settings.pos.mode')}</Label>
                  <Select
                    value={posSettings.mode}
                    onValueChange={(value: 'retail' | 'restaurant') => {
                      setPosSettings({ ...posSettings, mode: value });
                      setHasUnsavedChanges(true);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="retail">{t('settings.pos.modeRetail')}</SelectItem>
                      <SelectItem value="restaurant">{t('settings.pos.modeRestaurant')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t('settings.pos.modeFuture')}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="auto_logout">{t('settings.pos.autoLogout')}</Label>
                  <Input
                    id="auto_logout"
                    type="number"
                    value={posSettings.auto_logout_minutes}
                    onChange={(e) => {
                      const raw = parseInt(e.target.value);
                      const clamped = Math.min(480, Math.max(0, Number.isFinite(raw) ? raw : 0));
                      setPosSettings({
                        ...posSettings,
                        auto_logout_minutes: clamped,
                      });
                      setHasUnsavedChanges(true);
                    }}
                    min="0"
                    max="480"
                  />
                  <p className="text-xs text-muted-foreground">{t('settings.pos.autoLogoutHint')}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quick_access">{t('settings.pos.quickAccess')}</Label>
                  <Input
                    id="quick_access"
                    type="number"
                    value={posSettings.quick_access_limit}
                    onChange={(e) => {
                      const raw = parseInt(e.target.value);
                      const clamped = Math.min(24, Math.max(4, Number.isFinite(raw) ? raw : 12));
                      setPosSettings({
                        ...posSettings,
                        quick_access_limit: clamped,
                      });
                      setHasUnsavedChanges(true);
                    }}
                    min="4"
                    max="24"
                  />
                  <p className="text-xs text-muted-foreground">{t('settings.pos.quickAccessHint')}</p>
                </div>
              </div>

              <div className="space-y-4 border-t pt-6">
                <h3 className="text-lg font-semibold">{t('settings.pos.featuresTitle')}</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>{t('settings.pos.holdOrder')}</Label>
                      <p className="text-sm text-muted-foreground">{t('settings.pos.holdOrderDesc')}</p>
                    </div>
                    <Switch
                      checked={posSettings.enable_hold_order}
                      onCheckedChange={(checked) => {
                        setPosSettings({ ...posSettings, enable_hold_order: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>{t('settings.pos.mixedPayment')}</Label>
                      <p className="text-sm text-muted-foreground">{t('settings.pos.mixedPaymentDesc')}</p>
                    </div>
                    <Switch
                      checked={posSettings.enable_mixed_payment}
                      onCheckedChange={(checked) => {
                        setPosSettings({ ...posSettings, enable_mixed_payment: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <Label>{t('settings.pos.requireCustomerCredit')}</Label>
                        <p className="text-sm text-muted-foreground">{t('settings.pos.requireCustomerCreditDesc')}</p>
                      </div>
                      <Switch
                        checked={posSettings.require_customer_for_credit}
                        onCheckedChange={(checked) => {
                          setPosSettings({ ...posSettings, require_customer_for_credit: checked });
                          setHasUnsavedChanges(true);
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{t('settings.pos.requireCustomerAlways')}</p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>{t('settings.pos.lowStock')}</Label>
                      <p className="text-sm text-muted-foreground">{t('settings.pos.lowStockDesc')}</p>
                    </div>
                    <Switch
                      checked={posSettings.show_low_stock_warning}
                      onCheckedChange={(checked) => {
                        setPosSettings({ ...posSettings, show_low_stock_warning: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t pt-6">
                <Button variant="outline" onClick={() => loadAllSettings({ silent: true })}>
                  {t('settings.common.cancel')}
                </Button>
                <Button
                  onClick={() => {
                    const auto = Number(posSettings.auto_logout_minutes);
                    const quick = Number(posSettings.quick_access_limit);
                    const normalized: Record<string, unknown> = {
                      ...posSettings,
                      auto_logout_minutes: Math.min(
                        480,
                        Math.max(0, Number.isFinite(auto) ? Math.floor(auto) : 0)
                      ),
                      quick_access_limit: Math.min(
                        24,
                        Math.max(4, Number.isFinite(quick) ? Math.floor(quick) : 12)
                      ),
                      enable_hold_order: !!posSettings.enable_hold_order,
                      enable_mixed_payment: !!posSettings.enable_mixed_payment,
                      require_customer_for_credit: !!posSettings.require_customer_for_credit,
                      show_low_stock_warning: !!posSettings.show_low_stock_warning,
                      mode: posSettings.mode === 'restaurant' ? 'restaurant' : 'retail',
                    };
                    handleSave('pos', normalized);
                  }}
                  disabled={saving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? t('settings.common.saving') : t('settings.common.saveChanges')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift className="h-5 w-5" />
                {t('settings.loyalty.cardTitle')}
              </CardTitle>
              <CardDescription>{t('settings.loyalty.cardDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>{t('settings.loyalty.masterEnable')}</Label>
                  <p className="text-sm text-muted-foreground">{t('settings.loyalty.masterEnableDesc')}</p>
                </div>
                <Switch
                  checked={masterLoyaltyEnabled}
                  onCheckedChange={(checked) => {
                    setMasterLoyaltyEnabled(checked);
                    setHasUnsavedChanges(true);
                  }}
                />
              </div>
              <div className="space-y-2 max-w-md">
                <Label htmlFor="loyalty_points_per_uzs">{t('settings.loyalty.pointsPerUzs')}</Label>
                <Input
                  id="loyalty_points_per_uzs"
                  type="number"
                  min={1}
                  step={1}
                  value={masterLoyaltyPointsPerUzs}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setMasterLoyaltyPointsPerUzs(Number.isFinite(n) && n > 0 ? n : 1000);
                    setHasUnsavedChanges(true);
                  }}
                />
                <p className="text-xs text-muted-foreground">{t('settings.loyalty.pointsHint')}</p>
              </div>

              <div className="border-t pt-6 space-y-4">
                <h3 className="text-sm font-semibold">{t('settings.loyalty.generalTitle')}</h3>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>{t('settings.loyalty.generalEnable')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.loyalty.generalEnableDesc')}</p>
                  </div>
                  <Switch
                    checked={generalLoyaltyEnabled}
                    onCheckedChange={(checked) => {
                      setGeneralLoyaltyEnabled(checked);
                      setHasUnsavedChanges(true);
                    }}
                  />
                </div>
                <div className="space-y-2 max-w-md">
                  <Label>{t('settings.loyalty.earnScope')}</Label>
                  <Select
                    value={loyaltyEarnScope}
                    onValueChange={(v: 'master_only' | 'all_registered' | 'exclude_walk_in') => {
                      setLoyaltyEarnScope(v);
                      setHasUnsavedChanges(true);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="master_only">{t('settings.loyalty.scopeMasterOnly')}</SelectItem>
                      <SelectItem value="all_registered">{t('settings.loyalty.scopeAll')}</SelectItem>
                      <SelectItem value="exclude_walk_in">{t('settings.loyalty.scopeExcludeWalkIn')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 max-w-md">
                  <Label htmlFor="loyalty_earn_ppu">{t('settings.loyalty.earnPpu')}</Label>
                  <Input
                    id="loyalty_earn_ppu"
                    type="number"
                    min={1}
                    step={1}
                    value={loyaltyEarnPointsPerUzs}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      setLoyaltyEarnPointsPerUzs(Number.isFinite(n) && n > 0 ? n : 1000);
                      setHasUnsavedChanges(true);
                    }}
                  />
                </div>
                <div className="space-y-2 max-w-md">
                  <Label htmlFor="loyalty_min_order">{t('settings.loyalty.minOrder')}</Label>
                  <Input
                    id="loyalty_min_order"
                    type="number"
                    min={0}
                    step={1}
                    value={loyaltyMinOrderUzs}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      setLoyaltyMinOrderUzs(Number.isFinite(n) && n >= 0 ? n : 0);
                      setHasUnsavedChanges(true);
                    }}
                  />
                </div>
              </div>

              <div className="border-t pt-6 space-y-4">
                <h3 className="text-sm font-semibold">{t('settings.loyalty.redeemTitle')}</h3>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>{t('settings.loyalty.redeemEnable')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.loyalty.redeemEnableDesc')}</p>
                  </div>
                  <Switch
                    checked={loyaltyRedeemEnabled}
                    onCheckedChange={(checked) => {
                      setLoyaltyRedeemEnabled(checked);
                      setHasUnsavedChanges(true);
                    }}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
                  <div className="space-y-2">
                    <Label htmlFor="loyalty_redeem_ppu">{t('settings.loyalty.redeemPpu')}</Label>
                    <Input
                      id="loyalty_redeem_ppu"
                      type="number"
                      min={1}
                      step={1}
                      value={loyaltyRedeemPointsPerUzs}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        setLoyaltyRedeemPointsPerUzs(Number.isFinite(n) && n > 0 ? n : 100);
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="loyalty_redeem_min">{t('settings.loyalty.redeemMin')}</Label>
                    <Input
                      id="loyalty_redeem_min"
                      type="number"
                      min={1}
                      step={1}
                      value={loyaltyRedeemMinPoints}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        setLoyaltyRedeemMinPoints(Number.isFinite(n) && n > 0 ? n : 1);
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="loyalty_redeem_max_pct">{t('settings.loyalty.redeemMax')}</Label>
                    <Input
                      id="loyalty_redeem_max_pct"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={loyaltyRedeemMaxPercent}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        setLoyaltyRedeemMaxPercent(Number.isFinite(n) && n > 0 ? Math.min(100, n) : 50);
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-6 space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">{t('settings.loyalty.advancedTitle')}</h3>
                <p className="text-xs text-muted-foreground">{t('settings.loyalty.advancedDesc')}</p>
              </div>

              <div className="flex justify-end gap-3 border-t pt-6">
                <Button
                  variant="outline"
                  onClick={() => loadAllSettings({ silent: true })}
                >
                  {t('settings.common.cancel')}
                </Button>
                <Button
                  onClick={() =>
                    handleSave('sales', {
                      'loyalty.master.enabled': masterLoyaltyEnabled,
                      'loyalty.master.points_per_uzs': masterLoyaltyPointsPerUzs,
                      'loyalty.general.enabled': generalLoyaltyEnabled,
                      'loyalty.earn.scope': loyaltyEarnScope,
                      'loyalty.earn.points_per_uzs': loyaltyEarnPointsPerUzs,
                      'loyalty.earn.min_order_uzs': loyaltyMinOrderUzs,
                      'loyalty.redeem.enabled': loyaltyRedeemEnabled,
                      'loyalty.redeem.points_per_uzs': loyaltyRedeemPointsPerUzs,
                      'loyalty.redeem.min_points': loyaltyRedeemMinPoints,
                      'loyalty.redeem.max_percent_of_order': loyaltyRedeemMaxPercent,
                    })
                  }
                  disabled={saving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? t('settings.common.saving') : t('settings.common.saveAllLoyalty')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payment & Tax Tab */}
        <TabsContent value="payment">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('settings.payment.title')}</CardTitle>
                <CardDescription>{t('settings.payment.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  {(['cash', 'card', 'terminal', 'qr', 'credit'] as const).map((method) => {
                    const isCash = method === 'cash';
                    const isEnabled = paymentSettings.methods?.includes(method) ?? false;
                    return (
                      <div key={method} className="flex items-center justify-between gap-4">
                        <div className="space-y-1 flex-1 min-w-0">
                          <Label>
                            {t(`settings.payment.method_${method}`)}
                            {isCash && (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                ({t('settings.payment.cashAlwaysOn')})
                              </span>
                            )}
                          </Label>
                          <Input
                            value={paymentSettings.method_labels?.[method] ?? ''}
                            onChange={(e) => {
                              const v = e.target.value.slice(0, 32);
                              setPaymentSettings({
                                ...paymentSettings,
                                method_labels: {
                                  ...(paymentSettings.method_labels || {}),
                                  [method]: v,
                                },
                              });
                              setHasUnsavedChanges(true);
                            }}
                            placeholder={t(`settings.payment.method_${method}`)}
                            className="max-w-xs"
                            maxLength={32}
                          />
                          {method === 'credit' && (
                            <p className="text-xs text-muted-foreground">
                              {t('settings.payment.creditHint')}
                            </p>
                          )}
                          {method === 'terminal' && (
                            <p className="text-xs text-muted-foreground">
                              {t('settings.payment.terminalHint')}
                            </p>
                          )}
                        </div>
                        <Switch
                          checked={isEnabled || isCash}
                          disabled={isCash}
                          onCheckedChange={(checked) => {
                            if (isCash) return;
                            const current = paymentSettings.methods || [];
                            const methods = checked
                              ? Array.from(new Set([...current, method]))
                              : current.filter((m) => m !== method);
                            if (!methods.includes('cash')) methods.unshift('cash');
                            setPaymentSettings({ ...paymentSettings, methods });
                            setHasUnsavedChanges(true);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs text-muted-foreground border-t pt-4">
                  {t('settings.payment.mixedNote')}
                </p>

                <div className="flex justify-end gap-3 border-t pt-6">
                  <Button variant="outline" onClick={() => loadAllSettings({ silent: true })}>
                    {t('settings.common.cancel')}
                  </Button>
                  <Button
                    onClick={() => {
                      const allMethods = ['cash', 'card', 'terminal', 'qr', 'credit'];
                      const incoming = (paymentSettings.methods || [])
                        .map((m) => String(m || '').toLowerCase().trim())
                        .filter((m) => allMethods.includes(m));
                      const methodsSet = new Set<string>(['cash', ...incoming]);
                      const methods = Array.from(methodsSet);
                      if (methods.length === 0) {
                        toast({
                          title: t('settings.payment.errTitle'),
                          description: t('settings.payment.errNoMethods'),
                          variant: 'destructive',
                        });
                        return;
                      }
                      const cleanLabels: Record<string, string> = {};
                      const rawLabels = paymentSettings.method_labels || {};
                      for (const m of allMethods) {
                        const v = rawLabels[m];
                        if (typeof v === 'string') {
                          const trimmed = v.trim().slice(0, 32);
                          if (trimmed.length > 0) cleanLabels[m] = trimmed;
                        }
                      }
                      const normalized: Record<string, unknown> = {
                        methods,
                        method_labels: cleanLabels,
                      };
                      handleSave('payment', normalized);
                    }}
                    disabled={saving}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? t('settings.common.saving') : t('settings.common.saveChanges')}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('settings.tax.title')}</CardTitle>
                <CardDescription>{t('settings.tax.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>{t('settings.tax.enable')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.tax.enableDesc')}</p>
                  </div>
                  <Switch
                    checked={taxSettings.enabled}
                    onCheckedChange={(checked) => {
                      setTaxSettings({ ...taxSettings, enabled: checked });
                      setHasUnsavedChanges(true);
                    }}
                  />
                </div>

                {taxSettings.enabled && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="tax_rate">{t('settings.tax.rate')}</Label>
                      <Input
                        id="tax_rate"
                        type="number"
                        value={taxSettings.default_rate}
                        onChange={(e) => {
                          setTaxSettings({
                            ...taxSettings,
                            default_rate: parseFloat(e.target.value) || 0,
                          });
                          setHasUnsavedChanges(true);
                        }}
                        min="0"
                        max="100"
                        step="0.1"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <Label>{t('settings.tax.inclusive')}</Label>
                        <p className="text-sm text-muted-foreground">{t('settings.tax.inclusiveDesc')}</p>
                      </div>
                      <Switch
                        checked={taxSettings.inclusive}
                        onCheckedChange={(checked) => {
                          setTaxSettings({ ...taxSettings, inclusive: checked });
                          setHasUnsavedChanges(true);
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <Label>{t('settings.tax.perProduct')}</Label>
                        <p className="text-sm text-muted-foreground">{t('settings.tax.perProductDesc')}</p>
                      </div>
                      <Switch
                        checked={taxSettings.per_product_override}
                        onCheckedChange={(checked) => {
                          setTaxSettings({ ...taxSettings, per_product_override: checked });
                          setHasUnsavedChanges(true);
                        }}
                      />
                    </div>
                  </>
                )}

                <div className="flex justify-end gap-3 border-t pt-6">
                  <Button variant="outline" onClick={() => loadAllSettings({ silent: true })}>
                    {t('settings.common.cancel')}
                  </Button>
                  <Button onClick={() => handleSave('tax', taxSettings as unknown as Record<string, unknown>)} disabled={saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? t('settings.common.saving') : t('settings.common.saveChanges')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Receipt Tab */}
        <TabsContent value="receipt">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.receipt.title')}</CardTitle>
              <CardDescription>{t('settings.receipt.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="paper_size">{t('settings.receipt.paperSize')}</Label>
                <Select
                  value={receiptSettings.paper_size}
                  onValueChange={(value: '58mm' | '78mm' | '80mm') => {
                    setReceiptSettings({ ...receiptSettings, paper_size: value });
                    setHasUnsavedChanges(true);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58mm">58mm</SelectItem>
                    <SelectItem value="78mm">78mm</SelectItem>
                    <SelectItem value="80mm">80mm</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="header_text">{t('settings.receipt.headerLabel')}</Label>
                <Textarea
                  id="header_text"
                  value={receiptSettings.header_text}
                  onChange={(e) => {
                    setReceiptSettings({ ...receiptSettings, header_text: e.target.value.slice(0, 500) });
                    setHasUnsavedChanges(true);
                  }}
                  placeholder={t('settings.receipt.headerPh')}
                  rows={3}
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {(receiptSettings.header_text || '').length}/500
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="middle_text">{t('settings.receipt.middleLabel')}</Label>
                <Textarea
                  id="middle_text"
                  value={receiptSettings.middle_text ?? ''}
                  onChange={(e) => {
                    setReceiptSettings({ ...receiptSettings, middle_text: e.target.value.slice(0, 500) });
                    setHasUnsavedChanges(true);
                  }}
                  placeholder={t('settings.receipt.middlePh')}
                  rows={3}
                  maxLength={500}
                />
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <p>{t('settings.receipt.middleHint')}</p>
                  <p>{(receiptSettings.middle_text || '').length}/500</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="footer_text">{t('settings.receipt.footerLabel')}</Label>
                <Textarea
                  id="footer_text"
                  value={receiptSettings.footer_text}
                  onChange={(e) => {
                    setReceiptSettings({ ...receiptSettings, footer_text: e.target.value.slice(0, 500) });
                    setHasUnsavedChanges(true);
                  }}
                  placeholder={t('settings.receipt.footerPh')}
                  rows={3}
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {(receiptSettings.footer_text || '').length}/500
                </p>
              </div>

              <div className="space-y-4 border-t pt-6">
                <h3 className="text-lg font-semibold">{t('settings.receipt.displayTitle')}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('settings.receipt.templateNote')}
                </p>
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <Label>{t('settings.receipt.autoPrint')}</Label>
                      <p className="text-xs text-muted-foreground">{t('settings.receipt.autoPrintHint')}</p>
                    </div>
                    <Switch
                      checked={receiptSettings.auto_print}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, auto_print: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <Label>{t('settings.receipt.showLogo')}</Label>
                      <p className="text-xs text-muted-foreground">{t('settings.receipt.showLogoHint')}</p>
                    </div>
                    <Switch
                      checked={receiptSettings.show_logo}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, show_logo: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <Label>{t('settings.receipt.showCashier')}</Label>
                    <Switch
                      checked={receiptSettings.show_cashier}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, show_cashier: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <Label>{t('settings.receipt.showCustomer')}</Label>
                    <Switch
                      checked={receiptSettings.show_customer}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, show_customer: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <Label>{t('settings.receipt.showSku')}</Label>
                    <Switch
                      checked={receiptSettings.show_sku}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, show_sku: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t pt-6">
                <Button variant="outline" onClick={() => loadAllSettings({ silent: true })}>
                  {t('settings.common.cancel')}
                </Button>
                <Button
                  onClick={() => {
                    const validPaper = new Set(['58mm', '78mm', '80mm']);
                    const paper_size = validPaper.has(String(receiptSettings.paper_size || ''))
                      ? receiptSettings.paper_size
                      : '78mm';
                    const trimCap = (s: unknown) => String(s ?? '').slice(0, 500);
                    const normalized: Record<string, unknown> = {
                      paper_size,
                      header_text: trimCap(receiptSettings.header_text),
                      middle_text: trimCap(receiptSettings.middle_text),
                      footer_text: trimCap(receiptSettings.footer_text),
                      auto_print: !!receiptSettings.auto_print,
                      show_logo: !!receiptSettings.show_logo,
                      show_cashier: !!receiptSettings.show_cashier,
                      show_customer: !!receiptSettings.show_customer,
                      show_sku: !!receiptSettings.show_sku,
                    };
                    handleSave('receipt', normalized);
                  }}
                  disabled={saving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? t('settings.common.saving') : t('settings.common.saveChanges')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inventory Tab */}
        <TabsContent value="inventory">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.inventory.title')}</CardTitle>
              <CardDescription>{t('settings.inventory.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {profile?.role === 'admin' && (
                <div className="space-y-4 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>{t('settings.inventory.batchLabel')}</Label>
                      <p className="text-xs text-muted-foreground">{t('settings.inventory.batchDesc')}</p>
                    </div>
                    <Switch
                      checked={batchCfg.enabled}
                      disabled={batchCfgLoading}
                      onCheckedChange={async (checked) => {
                        if (!isElectron()) return;
                        try {
                          const api = requireElectron();
                          if (checked) {
                            const ok = confirm(t('settings.inventory.batchEnableConfirm'));
                            if (!ok) return;

                            // Compute "tomorrow midnight LOCAL", but encode as UTC string
                            // because the DB / batchService compares against `_nowSql()` (UTC).
                            const localTomorrowMidnight = new Date();
                            localTomorrowMidnight.setDate(localTomorrowMidnight.getDate() + 1);
                            localTomorrowMidnight.setHours(0, 0, 0, 0);
                            const cutoverAt = localTomorrowMidnight
                              .toISOString()
                              .replace('T', ' ')
                              .replace('Z', '')
                              .substring(0, 19);

                            const result = await handleIpcResponse<any>(
                              api.inventory.runBatchCutoverSnapshot({
                                cutoverAt,
                                // null = apply to ALL active warehouses (multi-warehouse safe)
                                warehouseId: null,
                                costMode: 'last_received_po_cost',
                                updatedBy: profile?.id || null,
                              })
                            );

                            const resumed = !!result?.resumed;
                            toast({
                              title: t('settings.inventory.batchToastTitle'),
                              description: resumed
                                ? t('settings.inventory.batchToastResumed', {
                                    cutover: result?.settings?.batch_cutover_at || cutoverAt,
                                  })
                                : t('settings.inventory.batchToastOn', { cutover: cutoverAt }),
                            });
                          } else {
                            const ok = confirm(t('settings.inventory.batchDisableConfirm'));
                            if (!ok) return;
                            await handleIpcResponse(api.settings.set('inventory.batch_mode_enabled', false, 'boolean', profile?.id || null));
                            toast({
                              title: t('settings.inventory.batchToastTitle'),
                              description: t('settings.inventory.batchToastOff'),
                            });
                          }
                          await loadBatchConfig();
                        } catch (e) {
                          toast({
                            title: t('settings.offline.toastErrTitle'),
                            description: e instanceof Error ? e.message : t('settings.inventory.batchErr'),
                            variant: 'destructive',
                          });
                        }
                      }}
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">{t('settings.inventory.statusLabel')}</p>
                      <p className="text-sm font-medium">
                        {batchCfg.enabled ? t('settings.inventory.statusOn') : t('settings.inventory.statusOff')}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">{t('settings.inventory.cutoverLabel')}</p>
                      <p className="text-sm font-medium">{batchCfg.cutoverAt || '-'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">{t('settings.inventory.openingCostLabel')}</p>
                      <p className="text-sm font-medium">{batchCfg.costMode || 'last_received_po_cost'}</p>
                    </div>
                  </div>

                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>{t('settings.inventory.batchAlertTitle')}</AlertTitle>
                    <AlertDescription className="text-xs">{t('settings.inventory.batchAlertText')}</AlertDescription>
                  </Alert>

                  {batchCfg.enabled && batchCfg.cutoverAt && (
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={batchCfgLoading}
                        onClick={async () => {
                          if (!isElectron()) return;
                          const ok = confirm(t('settings.inventory.batchResetConfirm'));
                          if (!ok) return;
                          try {
                            const api = requireElectron();
                            const localTomorrowMidnight = new Date();
                            localTomorrowMidnight.setDate(localTomorrowMidnight.getDate() + 1);
                            localTomorrowMidnight.setHours(0, 0, 0, 0);
                            const cutoverAt = localTomorrowMidnight
                              .toISOString()
                              .replace('T', ' ')
                              .replace('Z', '')
                              .substring(0, 19);

                            const result = await handleIpcResponse<any>(
                              api.inventory.runBatchCutoverSnapshot({
                                cutoverAt,
                                warehouseId: null,
                                costMode: 'last_received_po_cost',
                                updatedBy: profile?.id || null,
                                force: true,
                              })
                            );
                            toast({
                              title: t('settings.inventory.batchToastTitle'),
                              description: t('settings.inventory.batchResetDone', {
                                cutover: result?.opened_at || cutoverAt,
                                created: result?.created ?? 0,
                              }),
                            });
                            await loadBatchConfig();
                          } catch (e) {
                            toast({
                              title: t('settings.offline.toastErrTitle'),
                              description: e instanceof Error ? e.message : t('settings.inventory.batchErr'),
                              variant: 'destructive',
                            });
                          }
                        }}
                      >
                        {t('settings.inventory.batchResetButton')}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>{t('settings.inventory.tracking')}</Label>
                  <p className="text-sm text-muted-foreground">{t('settings.inventory.trackingDesc')}</p>
                </div>
                <Switch
                  checked={inventorySettings.tracking_enabled}
                  onCheckedChange={(checked) => {
                    setInventorySettings({ ...inventorySettings, tracking_enabled: checked });
                    setHasUnsavedChanges(true);
                  }}
                />
              </div>

              {inventorySettings.tracking_enabled && (
                <>
                    <div className="space-y-2">
                    <Label htmlFor="min_stock">{t('settings.inventory.minStock')}</Label>
                    <Input
                      id="min_stock"
                      type="number"
                      value={inventorySettings.default_min_stock}
                      onChange={(e) => {
                        setInventorySettings({
                          ...inventorySettings,
                          default_min_stock: parseInt(e.target.value) || 0,
                        });
                        setHasUnsavedChanges(true);
                      }}
                      min="0"
                    />
                    <p className="text-xs text-muted-foreground">{t('settings.inventory.minStockHint')}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="negative_stock">{t('settings.inventory.negativeStock')}</Label>
                    <Select
                      value={inventorySettings.allow_negative_stock}
                      onValueChange={(
                        value: 'block' | 'allow_with_warning' | 'allow_without_warning'
                      ) => {
                        setInventorySettings({ ...inventorySettings, allow_negative_stock: value });
                        setHasUnsavedChanges(true);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="block">{t('settings.inventory.negBlock')}</SelectItem>
                        <SelectItem value="allow_with_warning">{t('settings.inventory.negWarn')}</SelectItem>
                        <SelectItem value="allow_without_warning">{t('settings.inventory.negAllow')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {inventorySettings.allow_negative_stock === 'block' && t('settings.inventory.negHintBlock')}
                      {inventorySettings.allow_negative_stock === 'allow_with_warning' &&
                        t('settings.inventory.negHintWarn')}
                      {inventorySettings.allow_negative_stock === 'allow_without_warning' &&
                        t('settings.inventory.negHintAllow')}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cost_calc">{t('settings.inventory.costCalc')}</Label>
                    <Select
                      value={inventorySettings.cost_calculation}
                      onValueChange={(value: 'latest_purchase' | 'average_cost') => {
                        setInventorySettings({ ...inventorySettings, cost_calculation: value });
                        setHasUnsavedChanges(true);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                  <SelectItem value="latest_purchase">{t('settings.inventory.costLatest')}</SelectItem>
                  <SelectItem value="average_cost" disabled={batchCfg.enabled}>
                    {t('settings.inventory.costAverage')}
                  </SelectItem>
                      </SelectContent>
                    </Select>
              {batchCfg.enabled ? (
                <p className="text-xs text-muted-foreground">{t('settings.inventory.batchCostNote')}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t('settings.inventory.costCalcHint')}</p>
              )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <Label>{t('settings.inventory.approval')}</Label>
                        <p className="text-sm text-muted-foreground">{t('settings.inventory.approvalDesc')}</p>
                      </div>
                      <Switch
                        checked={inventorySettings.adjustment_approval_required}
                        onCheckedChange={(checked) => {
                          setInventorySettings({
                            ...inventorySettings,
                            adjustment_approval_required: checked,
                          });
                          setHasUnsavedChanges(true);
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{t('settings.inventory.approvalNotImplemented')}</p>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-3 border-t pt-6">
                <Button variant="outline" onClick={() => loadAllSettings({ silent: true })}>
                  {t('settings.common.cancel')}
                </Button>
                <Button
                  onClick={() => {
                    const normalized =
                      batchCfg.enabled && inventorySettings.cost_calculation === 'average_cost'
                        ? { ...inventorySettings, cost_calculation: 'latest_purchase' }
                        : inventorySettings;
                    handleSave('inventory', normalized as unknown as Record<string, unknown>);
                  }}
                  disabled={saving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? t('settings.common.saving') : t('settings.common.saveChanges')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Numbering Tab */}
        <TabsContent value="numbering">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.numbering.title')}</CardTitle>
              <CardDescription>{t('settings.numbering.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t('settings.numbering.orphanTitle')}</AlertTitle>
                <AlertDescription className="text-xs">{t('settings.numbering.orphanDesc')}</AlertDescription>
              </Alert>
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="order_prefix">{t('settings.numbering.orderPrefix')}</Label>
                  <Input
                    id="order_prefix"
                    value={numberingSettings.order_prefix}
                    onChange={(e) => {
                      setNumberingSettings({ ...numberingSettings, order_prefix: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="POS-"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="order_format">{t('settings.numbering.orderFormat')}</Label>
                  <Input
                    id="order_format"
                    value={numberingSettings.order_format}
                    onChange={(e) => {
                      setNumberingSettings({ ...numberingSettings, order_format: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="POS-YYYYMMDD-#####"
                    disabled
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="return_prefix">{t('settings.numbering.returnPrefix')}</Label>
                  <Input
                    id="return_prefix"
                    value={numberingSettings.return_prefix}
                    onChange={(e) => {
                      setNumberingSettings({ ...numberingSettings, return_prefix: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="RET-"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="return_format">{t('settings.numbering.returnFormat')}</Label>
                  <Input
                    id="return_format"
                    value={numberingSettings.return_format}
                    onChange={(e) => {
                      setNumberingSettings({ ...numberingSettings, return_format: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="RET-YYYYMMDD-#####"
                    disabled
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="purchase_prefix">{t('settings.numbering.purchasePrefix')}</Label>
                  <Input
                    id="purchase_prefix"
                    value={numberingSettings.purchase_prefix}
                    onChange={(e) => {
                      setNumberingSettings({
                        ...numberingSettings,
                        purchase_prefix: e.target.value,
                      });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="PO-"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="purchase_format">{t('settings.numbering.purchaseFormat')}</Label>
                  <Input
                    id="purchase_format"
                    value={numberingSettings.purchase_format}
                    onChange={(e) => {
                      setNumberingSettings({
                        ...numberingSettings,
                        purchase_format: e.target.value,
                      });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="PO-YYYYMMDD-#####"
                    disabled
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="movement_prefix">{t('settings.numbering.movementPrefix')}</Label>
                  <Input
                    id="movement_prefix"
                    value={numberingSettings.movement_prefix}
                    onChange={(e) => {
                      setNumberingSettings({
                        ...numberingSettings,
                        movement_prefix: e.target.value,
                      });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="MOV-"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="movement_format">{t('settings.numbering.movementFormat')}</Label>
                  <Input
                    id="movement_format"
                    value={numberingSettings.movement_format}
                    onChange={(e) => {
                      setNumberingSettings({
                        ...numberingSettings,
                        movement_format: e.target.value,
                      });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="MOV-YYYYMMDD-#####"
                    disabled
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t pt-6">
                <Button variant="outline" onClick={() => loadAllSettings({ silent: true })}>
                  {t('settings.common.cancel')}
                </Button>
                <Button
                  onClick={() => {
                    const cleanPrefix = (v: unknown, fb: string): string => {
                      const s = String(v ?? '').trim().slice(0, 8);
                      return s.replace(/[^A-Za-z0-9_\-.]/g, '') || fb;
                    };
                    const cleanFormat = (v: unknown, fb: string): string => {
                      const s = String(v ?? '').slice(0, 64);
                      return s || fb;
                    };
                    const normalized: Record<string, unknown> = {
                      order_prefix: cleanPrefix(numberingSettings.order_prefix, 'POS-'),
                      order_format: cleanFormat(numberingSettings.order_format, 'POS-YYYYMMDD-#####'),
                      return_prefix: cleanPrefix(numberingSettings.return_prefix, 'RET-'),
                      return_format: cleanFormat(numberingSettings.return_format, 'RET-YYYYMMDD-#####'),
                      purchase_prefix: cleanPrefix(numberingSettings.purchase_prefix, 'PO-'),
                      purchase_format: cleanFormat(numberingSettings.purchase_format, 'PO-YYYYMMDD-#####'),
                      movement_prefix: cleanPrefix(numberingSettings.movement_prefix, 'MOV-'),
                      movement_format: cleanFormat(numberingSettings.movement_format, 'MOV-YYYYMMDD-#####'),
                    };
                    handleSave('numbering', normalized);
                  }}
                  disabled={saving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? t('settings.common.saving') : t('settings.common.saveChanges')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.security.title')}</CardTitle>
              <CardDescription>{t('settings.security.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t('settings.security.orphanTitle')}</AlertTitle>
                <AlertDescription className="text-xs">{t('settings.security.orphanDesc')}</AlertDescription>
              </Alert>
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">{t('settings.security.policyTitle')}</h3>
                <div className="grid gap-6 xl:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="min_password">{t('settings.security.minPassword')}</Label>
                    <Input
                      id="min_password"
                      type="number"
                      value={securitySettings.min_password_length}
                      onChange={(e) => {
                        setSecuritySettings({
                          ...securitySettings,
                          min_password_length: parseInt(e.target.value) || 6,
                        });
                        setHasUnsavedChanges(true);
                      }}
                      min="4"
                      max="64"
                    />
                    <p className="text-xs text-muted-foreground">{t('settings.security.minPasswordHint')}</p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>{t('settings.security.strongPassword')}</Label>
                      <p className="text-sm text-muted-foreground">{t('settings.security.strongPasswordDesc')}</p>
                    </div>
                    <Switch
                      checked={securitySettings.require_strong_password}
                      onCheckedChange={(checked) => {
                        setSecuritySettings({ ...securitySettings, require_strong_password: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 border-t pt-6">
                <h3 className="text-lg font-semibold">{t('settings.security.sessionsTitle')}</h3>
                <div className="grid gap-6 xl:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="max_attempts">{t('settings.security.maxAttempts')}</Label>
                    <Input
                      id="max_attempts"
                      type="number"
                      value={securitySettings.max_failed_attempts}
                      onChange={(e) => {
                        setSecuritySettings({
                          ...securitySettings,
                          max_failed_attempts: parseInt(e.target.value) || 5,
                        });
                        setHasUnsavedChanges(true);
                      }}
                      min="3"
                      max="10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="session_timeout">{t('settings.security.sessionTimeout')}</Label>
                    <Input
                      id="session_timeout"
                      type="number"
                      value={securitySettings.session_timeout_minutes}
                      onChange={(e) => {
                        setSecuritySettings({
                          ...securitySettings,
                          session_timeout_minutes: parseInt(e.target.value) || 480,
                        });
                        setHasUnsavedChanges(true);
                      }}
                      min="5"
                      max="1440"
                    />
                    <p className="text-xs text-muted-foreground">{t('settings.security.sessionTimeoutHint')}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>{t('settings.security.multiSession')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.security.multiSessionDesc')}</p>
                  </div>
                  <Switch
                    checked={securitySettings.allow_multiple_sessions}
                    onCheckedChange={(checked) => {
                      setSecuritySettings({ ...securitySettings, allow_multiple_sessions: checked });
                      setHasUnsavedChanges(true);
                    }}
                  />
                </div>
              </div>

              <div className="space-y-4 border-t pt-6">
                <h3 className="text-lg font-semibold">{t('settings.security.auditTitle')}</h3>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>{t('settings.security.activityLog')}</Label>
                    <p className="text-sm text-muted-foreground">{t('settings.security.activityLogDesc')}</p>
                  </div>
                  <Switch
                    checked={securitySettings.enable_activity_logging}
                    onCheckedChange={(checked) => {
                      setSecuritySettings({ ...securitySettings, enable_activity_logging: checked });
                      setHasUnsavedChanges(true);
                    }}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t pt-6">
                <Button variant="outline" onClick={() => loadAllSettings({ silent: true })}>
                  {t('settings.common.cancel')}
                </Button>
                <Button
                  onClick={() => {
                    const clampNum = (v: unknown, fb: number, min: number, max: number): number => {
                      const n = Number(v);
                      if (!Number.isFinite(n)) return fb;
                      return Math.min(max, Math.max(min, Math.round(n)));
                    };
                    const toBool = (v: unknown, fb: boolean): boolean => {
                      if (v === '1' || v === 1 || v === true || v === 'true') return true;
                      if (v === '0' || v === 0 || v === false || v === 'false') return false;
                      return fb;
                    };
                    const normalized: Record<string, unknown> = {
                      min_password_length: clampNum(securitySettings.min_password_length, 6, 4, 64),
                      require_strong_password: toBool(securitySettings.require_strong_password, false),
                      max_failed_attempts: clampNum(securitySettings.max_failed_attempts, 5, 3, 20),
                      session_timeout_minutes: clampNum(securitySettings.session_timeout_minutes, 480, 5, 1440),
                      allow_multiple_sessions: toBool(securitySettings.allow_multiple_sessions, true),
                      enable_activity_logging: toBool(securitySettings.enable_activity_logging, true),
                    };
                    handleSave('security', normalized);
                  }}
                  disabled={saving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? t('settings.common.saving') : t('settings.common.saveChanges')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Localization Tab */}
        <TabsContent value="localization">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.localization.title')}</CardTitle>
              <CardDescription>{t('settings.localization.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t('settings.localization.currencyOrphanTitle')}</AlertTitle>
                <AlertDescription className="text-xs">{t('settings.localization.currencyOrphanDesc')}</AlertDescription>
              </Alert>
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="language">{t('settings.localization.language')}</Label>
                  <Select
                    value={localizationSettings.default_language}
                    onValueChange={(value: 'en' | 'uz' | 'ru') => {
                      setLocalizationSettings({ ...localizationSettings, default_language: value });
                      setHasUnsavedChanges(true);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">{t('settings.localization.lang_en')}</SelectItem>
                      <SelectItem value="uz">{t('settings.localization.lang_uz')}</SelectItem>
                      <SelectItem value="ru">{t('settings.localization.lang_ru')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency">{t('settings.localization.currency')}</Label>
                  <Input
                    id="currency"
                    value={localizationSettings.default_currency}
                    onChange={(e) => {
                      setLocalizationSettings({
                        ...localizationSettings,
                        default_currency: e.target.value.slice(0, 8).toUpperCase(),
                      });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="UZS"
                    maxLength={8}
                  />
                  <p className="text-xs text-muted-foreground">{t('settings.localization.currencyHint')}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency_symbol">{t('settings.localization.currencySymbol')}</Label>
                  <Input
                    id="currency_symbol"
                    value={localizationSettings.currency_symbol}
                    onChange={(e) => {
                      setLocalizationSettings({
                        ...localizationSettings,
                        currency_symbol: e.target.value,
                      });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="UZS"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency_position">{t('settings.localization.currencyPosition')}</Label>
                  <Select
                    value={localizationSettings.currency_position}
                    onValueChange={(value: 'before' | 'after') => {
                      setLocalizationSettings({
                        ...localizationSettings,
                        currency_position: value,
                      });
                      setHasUnsavedChanges(true);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="before">{t('settings.localization.posBefore')}</SelectItem>
                      <SelectItem value="after">{t('settings.localization.posAfter')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="thousand_sep">{t('settings.localization.thousandSep')}</Label>
                  <Input
                    id="thousand_sep"
                    value={localizationSettings.thousand_separator}
                    onChange={(e) => {
                      setLocalizationSettings({
                        ...localizationSettings,
                        thousand_separator: e.target.value,
                      });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder=" "
                    maxLength={1}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="decimal_sep">{t('settings.localization.decimalSep')}</Label>
                  <Input
                    id="decimal_sep"
                    value={localizationSettings.decimal_separator}
                    onChange={(e) => {
                      setLocalizationSettings({
                        ...localizationSettings,
                        decimal_separator: e.target.value,
                      });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="."
                    maxLength={1}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t pt-6">
                <Button variant="outline" onClick={() => loadAllSettings({ silent: true })}>
                  {t('settings.common.cancel')}
                </Button>
                <Button
                  onClick={() => {
                    const validLang = new Set(['en', 'uz', 'ru']);
                    const validPos = new Set(['before', 'after']);
                    const safeStr = (v: unknown, fb: string, max = 32): string => {
                      const s = String(v ?? '').trim().slice(0, max);
                      return s || fb;
                    };
                    const oneChar = (v: unknown, fb: string): string => {
                      const s = String(v ?? '').slice(0, 1);
                      return s || fb;
                    };
                    const normalized: Record<string, unknown> = {
                      default_language: validLang.has(String(localizationSettings.default_language || ''))
                        ? localizationSettings.default_language
                        : 'uz',
                      default_currency: safeStr(localizationSettings.default_currency, 'UZS', 8).toUpperCase(),
                      currency_symbol: safeStr(localizationSettings.currency_symbol, 'UZS', 8),
                      currency_position: validPos.has(String(localizationSettings.currency_position || ''))
                        ? localizationSettings.currency_position
                        : 'after',
                      thousand_separator: oneChar(localizationSettings.thousand_separator, ' '),
                      decimal_separator: oneChar(localizationSettings.decimal_separator, '.'),
                    };
                    handleSave('localization', normalized);
                  }}
                  disabled={saving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? t('settings.common.saving') : t('settings.common.saveChanges')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {profile?.role === 'admin' && (
          <TabsContent value="currency">
            <ExchangeRatesSettings />
          </TabsContent>
        )}

        {/* Offline & Sync Tab */}
        <TabsContent value="offline">
          <OfflineSettingsTab />
        </TabsContent>

        {/* POS Network (HOST/CLIENT) - Admin only */}
        {profile?.role === 'admin' && (
          <TabsContent value="marketplace">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SlidersHorizontal className="h-5 w-5" />
                  {t('settings.marketplace.title')}
                </CardTitle>
                <CardDescription>{t('settings.marketplace.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-6 xl:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t('settings.marketplace.searchPrefilterLimit')}</Label>
                    <Input
                      type="number"
                      min={100}
                      max={5000}
                      value={marketplaceTuning.search_prefilter_limit}
                      onChange={(e) => {
                        setMarketplaceTuning({
                          ...marketplaceTuning,
                          search_prefilter_limit: Math.max(100, Number.parseInt(e.target.value || '500', 10) || 500),
                        });
                        setHasUnsavedChanges(true);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">{t('settings.marketplace.searchPrefilterLimitHint')}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('settings.marketplace.trendingRecentWeight')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      step={0.1}
                      value={marketplaceTuning.trending_recent_weight}
                      onChange={(e) => {
                        setMarketplaceTuning({
                          ...marketplaceTuning,
                          trending_recent_weight: Math.max(0, Number.parseFloat(e.target.value || '2') || 2),
                        });
                        setHasUnsavedChanges(true);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">{t('settings.marketplace.trendingRecentWeightHint')}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('settings.marketplace.trendingAvailabilityBonus')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={marketplaceTuning.trending_availability_bonus}
                      onChange={(e) => {
                        setMarketplaceTuning({
                          ...marketplaceTuning,
                          trending_availability_bonus: Math.max(0, Number.parseFloat(e.target.value || '8') || 8),
                        });
                        setHasUnsavedChanges(true);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">{t('settings.marketplace.trendingAvailabilityBonusHint')}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('settings.marketplace.trendingMarginDivisor')}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={1000000}
                      value={marketplaceTuning.trending_margin_divisor}
                      onChange={(e) => {
                        setMarketplaceTuning({
                          ...marketplaceTuning,
                          trending_margin_divisor: Math.max(1, Number.parseInt(e.target.value || '1000', 10) || 1000),
                        });
                        setHasUnsavedChanges(true);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">{t('settings.marketplace.trendingMarginDivisorHint')}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('settings.marketplace.trendingMarginCap')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={10000}
                      step={0.5}
                      value={marketplaceTuning.trending_margin_cap}
                      onChange={(e) => {
                        setMarketplaceTuning({
                          ...marketplaceTuning,
                          trending_margin_cap: Math.max(0, Number.parseFloat(e.target.value || '80') || 80),
                        });
                        setHasUnsavedChanges(true);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">{t('settings.marketplace.trendingMarginCapHint')}</p>
                  </div>
                </div>
                <Alert>
                  <SlidersHorizontal className="h-4 w-4" />
                  <AlertTitle>{t('settings.marketplace.effectivePreviewTitle')}</AlertTitle>
                  <AlertDescription className="space-y-2 text-xs">
                    <p>{t('settings.marketplace.effectivePreviewDesc')}</p>
                    <div className="rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
                      <div>{`search_prefilter_limit = ${marketplaceTuning.search_prefilter_limit}`}</div>
                      <div>{`recent_weight = ${marketplaceTuning.trending_recent_weight}`}</div>
                      <div>{`availability_bonus = ${marketplaceTuning.trending_availability_bonus}`}</div>
                      <div>{`margin_divisor = ${marketplaceTuning.trending_margin_divisor}`}</div>
                      <div>{`margin_cap = ${marketplaceTuning.trending_margin_cap}`}</div>
                      <div className="mt-1">{`score = sold_total + sold_recent*recent_weight + availability_bonus + min(margin_cap, margin/divisor)`}</div>
                    </div>
                  </AlertDescription>
                </Alert>
                <div className="flex justify-end gap-3 border-t pt-6">
                  <Button variant="secondary" onClick={() => setShowMarketplaceResetConfirm(true)}>
                    {t('settings.marketplace.resetDefaults')}
                  </Button>
                  <Button variant="outline" onClick={() => loadAllSettings({ silent: true })}>
                    {t('settings.common.cancel')}
                  </Button>
                  <Button
                    onClick={() => {
                      const normalized = normalizeMarketplaceTuning(marketplaceTuning);
                      setMarketplaceTuning(normalized);
                      void handleSave('marketplace', normalized as unknown as Record<string, unknown>);
                    }}
                    disabled={saving}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? t('settings.common.saving') : t('settings.common.saveChanges')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Telegram Couriers - Admin only */}
        {profile?.role === 'admin' && (
          <TabsContent value="couriers">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" />
                  {t('settings.marketplace.delivery')}
                </CardTitle>
                <CardDescription>
                  Telegram bot kuryer paneliga kira oladigan foydalanuvchilarni boshqaring.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 rounded-lg border p-4 xl:grid-cols-[1fr_1fr_1fr_auto]">
                  <div className="space-y-2">
                    <Label>Telegram username yoki ID</Label>
                    <Input
                      value={newCourierIdentifier}
                      onChange={(e) => setNewCourierIdentifier(e.target.value)}
                      placeholder="@TOHIR3 yoki 123456789"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Ism</Label>
                    <Input
                      value={newCourierName}
                      onChange={(e) => setNewCourierName(e.target.value)}
                      placeholder="Tohirbek Abdullajonov"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Telefon</Label>
                    <Input
                      value={newCourierPhone}
                      onChange={(e) => setNewCourierPhone(e.target.value)}
                      placeholder="+998901234567"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={handleAddCourier} disabled={courierSaving || !newCourierIdentifier.trim()}>
                      {courierSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Qo'shish
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border">
                  <div className="flex items-center justify-between border-b p-4">
                    <div>
                      <h3 className="font-semibold">Kuryerlar ro'yxati</h3>
                      <p className="text-sm text-muted-foreground">Aktiv kuryerlar botdan buyurtma statusini o'zgartira oladi.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={loadCouriers} disabled={couriersLoading}>
                      <RefreshCw className={`mr-2 h-4 w-4 ${couriersLoading ? 'animate-spin' : ''}`} />
                      Yangilash
                    </Button>
                  </div>
                  <div className="divide-y">
                    {couriersLoading ? (
                      <div className="p-4 text-sm text-muted-foreground">Yuklanmoqda...</div>
                    ) : couriers.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground">Kuryerlar yo'q.</div>
                    ) : (
                      couriers.map((courier) => (
                        <div key={courier.id} className="flex items-center justify-between gap-4 p-4">
                          <div>
                            <div className="font-medium">
                              {courier.display_name || courier.username || courier.telegram_id || `#${courier.id}`}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {courier.username ? `@${courier.username}` : 'Username yo‘q'} · ID: {courier.telegram_id || 'hali bog‘lanmagan'}
                            </div>
                            {courier.phone && (
                              <div className="text-sm text-muted-foreground">Tel: {courier.phone}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={Number(courier.active) ? 'text-sm text-emerald-600' : 'text-sm text-muted-foreground'}>
                              {Number(courier.active) ? 'Aktiv' : 'Noaktiv'}
                            </span>
                            <Switch
                              checked={!!Number(courier.active)}
                              disabled={courierSaving}
                              onCheckedChange={(checked) => handleCourierActive(courier, checked)}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Database backup + network config */}
        {canManageDatabase && (
          <TabsContent value="network">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  {t('settings.network.title')}
                </CardTitle>
                <CardDescription>{t('settings.network.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4 border rounded-lg p-4">
                  <div>
                    <Label className="text-base font-semibold">{t('settings.network.downloadTitle')}</Label>
                    <p className="text-sm text-muted-foreground mt-1 mb-3">{t('settings.network.downloadDesc')}</p>
                    <Button
                      variant="outline"
                      onClick={handleDownloadDatabase}
                      disabled={downloadingDb || !isElectron()}
                      title={!isElectron() ? t('settings.network.downloadDesktopOnly') : undefined}
                    >
                      {downloadingDb ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t('settings.network.downloading')}
                        </>
                      ) : (
                        <>
                          <Download className="mr-2 h-4 w-4" />
                          {t('settings.network.downloadBtn')}
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {profile?.role === 'admin' && (
                  <div className="space-y-4 border border-destructive rounded-lg p-4 bg-destructive/5">
                    <div>
                      <Label className="text-base font-semibold text-destructive">
                        {t('settings.network.uploadTitle')}
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1 mb-3">
                        {t('settings.network.uploadDesc')}
                      </p>
                      <Button
                        variant="destructive"
                        onClick={() => setShowUploadConfirm(true)}
                        disabled={uploadingDb || downloadingDb || !isElectron()}
                        title={!isElectron() ? t('settings.network.uploadDesktopOnly') : undefined}
                      >
                        {uploadingDb ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {uploadProgress > 0
                              ? t('settings.network.uploadingProgress', { percent: uploadProgress })
                              : t('settings.network.uploading')}
                          </>
                        ) : (
                          <>
                            <Upload className="mr-2 h-4 w-4" />
                            {t('settings.network.uploadBtn')}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {profile?.role === 'admin' && (
                  <>
                    {!posNetConfig && !posNetLoading ? (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>{t('settings.network.configMissing')}</AlertTitle>
                        <AlertDescription className="text-xs">{t('settings.network.configMissingDesc')}</AlertDescription>
                      </Alert>
                    ) : posNetConfig ? (
                      <DatabaseSourceSettings
                        config={posNetConfig}
                        loading={posNetLoading}
                        saving={posNetSaving}
                        testing={posNetTesting}
                        testResult={posNetTestResult}
                        onChange={(next) => {
                          setPosNetConfig(next);
                          setHasUnsavedChanges(true);
                        }}
                        onReload={loadPosNetConfig}
                        onTest={testHostConnection}
                        onSave={() =>
                          savePosNetConfig({
                            mode: posNetConfig.mode,
                            host: posNetConfig.host,
                            client: posNetConfig.client,
                          })
                        }
                      />
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* System Reset (Danger Zone) - Admin only */}
        {profile?.role === 'admin' && (
          <TabsContent value="reset">
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  {t('settings.reset.cardTitle')}
                </CardTitle>
                <CardDescription>{t('settings.reset.cardDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{t('settings.reset.dangerTitle')}</AlertTitle>
                  <AlertDescription>{t('settings.reset.dangerDesc')}</AlertDescription>
                </Alert>

                {/* Clear Local App Data */}
                <div className="space-y-4 border rounded-lg p-4">
                  <div>
                    <Label className="text-base font-semibold">{t('settings.reset.browserTitle')}</Label>
                    <p className="text-sm text-muted-foreground mt-1 mb-3">{t('settings.reset.browserDesc')}</p>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        if (!confirm(t('settings.reset.browserConfirm'))) {
                          return;
                        }

                        setClearingLocal(true);
                        try {
                          await clearAllBrowserStorageAndReload(queryClient);
                        } catch (error) {
                          setClearingLocal(false);
                          toast({
                            title: t('settings.reset.toastClearErrTitle'),
                            description:
                              error instanceof Error ? error.message : t('settings.reset.toastClearErrDesc'),
                            variant: 'destructive',
                          });
                        }
                      }}
                      disabled={clearingLocal}
                    >
                      {clearingLocal ? (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                          {t('settings.reset.clearing')}
                        </>
                      ) : (
                        <>
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t('settings.reset.browserBtn')}
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Reset local SQLite database */}
                <div className="space-y-4 border-destructive border-2 rounded-lg p-4 bg-destructive/5">
                  <div>
                    <Label className="text-base font-semibold text-destructive">
                      {t('settings.reset.sqliteTitle')}
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1 mb-3">{t('settings.reset.sqliteDesc')}</p>
                    <Button
                      variant="destructive"
                      onClick={() => setShowResetConfirm(true)}
                      disabled={resettingDB || !isElectron()}
                      title={!isElectron() ? t('settings.reset.sqliteBtnTitle') : undefined}
                    >
                      <Database className="mr-2 h-4 w-4" />
                      {t('settings.reset.sqliteBtn')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <Dialog
        open={showUnsavedDialog}
        onOpenChange={(open) => {
          setShowUnsavedDialog(open);
          if (!open) pendingTabRef.current = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t('settings.dialogs.unsavedTitle')}
            </DialogTitle>
            <DialogDescription>{t('settings.dialogs.unsavedDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                pendingTabRef.current = null;
                setShowUnsavedDialog(false);
              }}
            >
              {t('settings.dialogs.stay')}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const nextTab = pendingTabRef.current;
                pendingTabRef.current = null;
                setShowUnsavedDialog(false);
                setHasUnsavedChanges(false);
                await loadAllSettings({ silent: true });
                if (nextTab) setActiveTab(nextTab);
              }}
            >
              {t('settings.dialogs.discardGo')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showMarketplaceResetConfirm} onOpenChange={setShowMarketplaceResetConfirm}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              {t('settings.marketplace.resetDialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('settings.marketplace.resetDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMarketplaceResetConfirm(false)}>
              {t('settings.marketplace.resetDialogCancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setMarketplaceTuning(normalizeMarketplaceTuning(MARKETPLACE_TUNING_DEFAULTS));
                setHasUnsavedChanges(true);
                setShowMarketplaceResetConfirm(false);
              }}
            >
              {t('settings.marketplace.resetDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Database Upload Confirmation Dialog */}
      <Dialog
        open={showUploadConfirm}
        onOpenChange={(open) => {
          setShowUploadConfirm(open);
          if (!open) setUploadConfirmText('');
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t('settings.network.uploadDialogTitle')}
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <p className="font-semibold text-destructive">{t('settings.network.uploadDialogWarning')}</p>
              <p>{t('settings.network.uploadDialogBackupHint')}</p>
              <p className="mt-2">{t('settings.network.uploadDialogTypeConfirm')}</p>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={uploadConfirmText}
              onChange={(e) => setUploadConfirmText(e.target.value)}
              placeholder={t('settings.network.uploadDialogPh')}
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowUploadConfirm(false);
                setUploadConfirmText('');
              }}
            >
              {t('settings.network.uploadDialogCancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleUploadDatabase}
              disabled={uploadingDb || uploadConfirmText !== DB_UPLOAD_CONFIRM_TEXT}
            >
              {uploadingDb ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('settings.network.uploading')}
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  {t('settings.network.uploadBtn')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Database Reset Confirmation Dialog */}
      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t('settings.dialogs.resetTitle')}
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <p className="font-semibold">{t('settings.dialogs.resetIntro')}</p>
              <ul className="list-disc list-inside text-sm space-y-1 ml-2">
                <li>{t('settings.dialogs.resetLi1')}</li>
                <li>{t('settings.dialogs.resetLi2')}</li>
                <li>{t('settings.dialogs.resetLi3')}</li>
                <li>{t('settings.dialogs.resetLi4')}</li>
                <li>{t('settings.dialogs.resetLi5')}</li>
                <li>{t('settings.dialogs.resetLi6')}</li>
              </ul>
              <p className="font-semibold text-destructive mt-4">{t('settings.dialogs.resetIrreversible')}</p>
              <p className="mt-2">{t('settings.dialogs.resetTypeDelete')}</p>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder={t('settings.dialogs.resetPh')}
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowResetConfirm(false);
              setResetConfirmText('');
            }}>
              {t('settings.dialogs.resetCancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (resetConfirmText !== 'DELETE') {
                  toast({
                    title: t('settings.dialogs.resetConfirmInvalidTitle'),
                    description: t('settings.dialogs.resetConfirmInvalidDesc'),
                    variant: 'destructive',
                  });
                  return;
                }

                setResettingDB(true);
                try {
                  clearLocalMockDataForDbReset();
                  await resetDatabase({ confirmText: resetConfirmText });
                  toast({
                    title: t('settings.dialogs.resetToastOkTitle'),
                    description: t('settings.dialogs.resetToastOkDesc'),
                  });
                  setShowResetConfirm(false);
                  setResetConfirmText('');
                  // Reload after a short delay
                  setTimeout(() => {
                    window.location.reload();
                  }, 2000);
                } catch (error) {
                  toast({
                    title: t('settings.offline.toastErrTitle'),
                    description: error instanceof Error ? error.message : t('settings.dialogs.resetErr'),
                    variant: 'destructive',
                  });
                } finally {
                  setResettingDB(false);
                }
              }}
              disabled={resettingDB || resetConfirmText !== 'DELETE'}
            >
              {resettingDB ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  {t('settings.reset.clearing')}
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('settings.reset.sqliteBtn')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
