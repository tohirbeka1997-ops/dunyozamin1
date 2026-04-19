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
  Wifi,
  RefreshCw,
  Trash2,
  Server,
  Gift,
  Loader2,
  HardDrive,
  Database,
} from 'lucide-react';
import { getSettingsByCategory, bulkUpdateSettings } from '@/db/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
// Removed: Network status, sync engine, offline DB, reset functions - no longer using Supabase
import { clearAllBrowserStorageAndReload } from '@/lib/clearBrowserStorage';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { isElectron, requireElectron, handleIpcResponse } from '@/utils/electron';
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
  const [clearingLocal, setClearingLocal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  /** Tab to activate after user discards unsaved changes */
  const pendingTabRef = useRef<string | null>(null);

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
    auto_logout_minutes: 30,
    show_low_stock_warning: true,
    quick_access_limit: 12,
  });

  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>({
    methods: [],
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
        description: e instanceof Error ? e.message : t('settings.toast.netSaveErr'),
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

  const loadAllSettings = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    try {
      if (!silent) setLoading(true);
      const [company, pos, payment, tax, receipt, inventory, numbering, security, localization, sales] =
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
        ]);

      setCompanySettings(company as unknown as CompanySettings);
      setPosSettings(pos as unknown as POSSettings);
      setPaymentSettings(payment as unknown as PaymentSettings);
      setTaxSettings(tax as unknown as TaxSettings);
      setReceiptSettings(receipt as unknown as ReceiptSettings);
      setInventorySettings(inventory as unknown as InventorySettings);
      setNumberingSettings(numbering as unknown as NumberingSettings);
      setSecuritySettings(security as unknown as SecuritySettings);
      setLocalizationSettings(localization as unknown as LocalizationSettings);

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
        <h1 className="text-3xl font-bold">{t('settings.header.title')}</h1>
        <p className="text-muted-foreground">{t('settings.header.subtitle')}</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className={`grid w-full grid-cols-4 ${profile?.role === 'admin' ? 'xl:grid-cols-10' : 'xl:grid-cols-9'}`}>
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
          <TabsTrigger value="offline" className="gap-2">
            <HardDrive className="h-4 w-4" />
            <span className="hidden xl:inline">{t('settings.tabs.local')}</span>
          </TabsTrigger>
          {profile?.role === 'admin' && (
            <TabsTrigger value="network" className="gap-2">
              <Server className="h-4 w-4" />
              <span className="hidden xl:inline">{t('settings.tabs.hostClient')}</span>
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

              <div className="flex justify-end gap-3 border-t pt-6">
                <Button variant="outline" onClick={() => loadAllSettings({ silent: true })}>
                  {t('settings.common.cancel')}
                </Button>
                <Button onClick={() => handleSave('company', companySettings as unknown as Record<string, unknown>)} disabled={saving}>
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
                      setPosSettings({
                        ...posSettings,
                        auto_logout_minutes: parseInt(e.target.value) || 30,
                      });
                      setHasUnsavedChanges(true);
                    }}
                    min="1"
                    max="480"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quick_access">{t('settings.pos.quickAccess')}</Label>
                  <Input
                    id="quick_access"
                    type="number"
                    value={posSettings.quick_access_limit}
                    onChange={(e) => {
                      setPosSettings({
                        ...posSettings,
                        quick_access_limit: parseInt(e.target.value) || 12,
                      });
                      setHasUnsavedChanges(true);
                    }}
                    min="4"
                    max="24"
                  />
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
                <Button onClick={() => handleSave('pos', posSettings as unknown as Record<string, unknown>)} disabled={saving}>
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
                  {(['cash', 'card', 'terminal', 'qr'] as const).map((method) => {
                    return (
                      <div key={method} className="flex items-center justify-between">
                        <div className="space-y-1">
                          <Label>{t(`settings.payment.method_${method}`)}</Label>
                          <Input
                            value={paymentSettings.method_labels?.[method] || method}
                            onChange={(e) => {
                              setPaymentSettings({
                                ...paymentSettings,
                                method_labels: {
                                  ...paymentSettings.method_labels,
                                  [method]: e.target.value,
                                },
                              });
                              setHasUnsavedChanges(true);
                            }}
                            placeholder={t('settings.payment.displayNamePh')}
                            className="max-w-xs"
                          />
                        </div>
                        <Switch
                          checked={paymentSettings.methods?.includes(method)}
                          onCheckedChange={(checked) => {
                            const methods = checked
                              ? [...(paymentSettings.methods || []), method]
                              : (paymentSettings.methods || []).filter((m) => m !== method);
                            setPaymentSettings({ ...paymentSettings, methods });
                            setHasUnsavedChanges(true);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-end gap-3 border-t pt-6">
                  <Button variant="outline" onClick={() => loadAllSettings({ silent: true })}>
                    {t('settings.common.cancel')}
                  </Button>
                  <Button onClick={() => handleSave('payment', paymentSettings as unknown as Record<string, unknown>)} disabled={saving}>
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
                    setReceiptSettings({ ...receiptSettings, header_text: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  placeholder={t('settings.receipt.headerPh')}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="middle_text">{t('settings.receipt.middleLabel')}</Label>
                <Textarea
                  id="middle_text"
                  value={receiptSettings.middle_text ?? ''}
                  onChange={(e) => {
                    setReceiptSettings({ ...receiptSettings, middle_text: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  placeholder={t('settings.receipt.middlePh')}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">{t('settings.receipt.middleHint')}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="footer_text">{t('settings.receipt.footerLabel')}</Label>
                <Textarea
                  id="footer_text"
                  value={receiptSettings.footer_text}
                  onChange={(e) => {
                    setReceiptSettings({ ...receiptSettings, footer_text: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  placeholder={t('settings.receipt.footerPh')}
                  rows={3}
                />
              </div>

              <div className="space-y-4 border-t pt-6">
                <h3 className="text-lg font-semibold">{t('settings.receipt.displayTitle')}</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>{t('settings.receipt.autoPrint')}</Label>
                    <Switch
                      checked={receiptSettings.auto_print}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, auto_print: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>{t('settings.receipt.showLogo')}</Label>
                    <Switch
                      checked={receiptSettings.show_logo}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, show_logo: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>{t('settings.receipt.showCashier')}</Label>
                    <Switch
                      checked={receiptSettings.show_cashier}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, show_cashier: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>{t('settings.receipt.showCustomer')}</Label>
                    <Switch
                      checked={receiptSettings.show_customer}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, show_customer: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
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
                <Button onClick={() => handleSave('receipt', receiptSettings as unknown as Record<string, unknown>)} disabled={saving}>
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

                            const d = new Date();
                            d.setDate(d.getDate() + 1);
                            d.setHours(0, 0, 0, 0);
                            const y = d.getFullYear();
                            const m = String(d.getMonth() + 1).padStart(2, '0');
                            const day = String(d.getDate()).padStart(2, '0');
                            const cutoverAt = `${y}-${m}-${day} 00:00:00`;

                            await handleIpcResponse(
                              api.inventory.runBatchCutoverSnapshot({
                                cutoverAt,
                                warehouseId: 'main-warehouse-001',
                                costMode: 'last_received_po_cost',
                                updatedBy: profile?.id || null,
                              })
                            );

                            toast({
                              title: t('settings.inventory.batchToastTitle'),
                              description: t('settings.inventory.batchToastOn', { cutover: cutoverAt }),
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
              {batchCfg.enabled && (
                <p className="text-xs text-muted-foreground">{t('settings.inventory.batchCostNote')}</p>
              )}
                  </div>

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
                <Button onClick={() => handleSave('numbering', numberingSettings as unknown as Record<string, unknown>)} disabled={saving}>
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
                      min="6"
                      max="32"
                    />
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
                      min="30"
                      max="1440"
                    />
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
                <Button onClick={() => handleSave('security', securitySettings as unknown as Record<string, unknown>)} disabled={saving}>
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
                        default_currency: e.target.value,
                      });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="UZS"
                  />
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
                  onClick={() => handleSave('localization', localizationSettings as unknown as Record<string, unknown>)}
                  disabled={saving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? t('settings.common.saving') : t('settings.common.saveChanges')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Offline & Sync Tab */}
        <TabsContent value="offline">
          <OfflineSettingsTab />
        </TabsContent>

        {/* POS Network (HOST/CLIENT) - Admin only */}
        {profile?.role === 'admin' && (
          <TabsContent value="network">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  {t('settings.network.title')}
                </CardTitle>
                <CardDescription>{t('settings.network.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {posNetLoading ? (
                  <div className="text-sm text-muted-foreground">{t('settings.network.loading')}</div>
                ) : !posNetConfig ? (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>{t('settings.network.configMissing')}</AlertTitle>
                    <AlertDescription className="text-xs">{t('settings.network.configMissingDesc')}</AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <div className="grid gap-6 xl:grid-cols-2">
                      <div className="space-y-2">
                        <Label>{t('settings.network.mode')}</Label>
                        <Select
                          value={posNetConfig.mode || 'host'}
                          onValueChange={(value) => {
                            setPosNetConfig({ ...posNetConfig, mode: value });
                            setHasUnsavedChanges(true);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t('settings.network.mode')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="host">{t('settings.network.modeHost')}</SelectItem>
                            <SelectItem value="client">{t('settings.network.modeClient')}</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">{t('settings.network.modeHint')}</p>
                      </div>

                      <div className="space-y-2">
                        <Label>{t('settings.network.configFile')}</Label>
                        <Input value={posNetConfig.configPath || ''} readOnly />
                        <p className="text-xs text-muted-foreground">{t('settings.network.configFileHint')}</p>
                      </div>
                    </div>

                    <div className="grid gap-6 xl:grid-cols-2">
                      <div className="space-y-2">
                        <Label>{t('settings.network.hostPort')}</Label>
                        <Input
                          value={String(posNetConfig.host?.port ?? 3333)}
                          onChange={(e) => {
                            const n = Number(e.target.value || 0);
                            setPosNetConfig({ ...posNetConfig, host: { ...posNetConfig.host, port: n } });
                            setHasUnsavedChanges(true);
                          }}
                          placeholder="3333"
                        />
                        <p className="text-xs text-muted-foreground">{t('settings.network.hostPortHint')}</p>
                      </div>

                      <div className="space-y-2">
                        <Label>{t('settings.network.hostSecret')}</Label>
                        <Input
                          value={String(posNetConfig.host?.secret || '')}
                          onChange={(e) => {
                            setPosNetConfig({ ...posNetConfig, host: { ...posNetConfig.host, secret: e.target.value } });
                            setHasUnsavedChanges(true);
                          }}
                          placeholder={t('settings.network.hostSecretPh')}
                        />
                        <p className="text-xs text-muted-foreground">{t('settings.network.hostSecretHint')}</p>
                      </div>
                    </div>

                    <div className="grid gap-6 xl:grid-cols-2">
                      <div className="space-y-2">
                        <Label>{t('settings.network.clientUrl')}</Label>
                        <Input
                          value={String(posNetConfig.client?.hostUrl || '')}
                          onChange={(e) => {
                            setPosNetConfig({ ...posNetConfig, client: { ...posNetConfig.client, hostUrl: e.target.value } });
                            setHasUnsavedChanges(true);
                          }}
                          placeholder="http://192.168.1.10:3333"
                        />
                        <p className="text-xs text-muted-foreground">{t('settings.network.clientUrlHint')}</p>
                      </div>

                      <div className="space-y-2">
                        <Label>{t('settings.network.clientSecret')}</Label>
                        <Input
                          value={String(posNetConfig.client?.secret || '')}
                          onChange={(e) => {
                            setPosNetConfig({ ...posNetConfig, client: { ...posNetConfig.client, secret: e.target.value } });
                            setHasUnsavedChanges(true);
                          }}
                          placeholder={t('settings.network.clientSecretPh')}
                        />
                        <p className="text-xs text-muted-foreground">{t('settings.network.clientSecretHint')}</p>
                      </div>
                    </div>

                    {posNetTestResult && (
                      <Alert variant={posNetTestResult.ok ? 'default' : 'destructive'}>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>
                          {posNetTestResult.ok ? t('settings.network.connOk') : t('settings.network.connFail')}
                        </AlertTitle>
                        <AlertDescription className="text-xs">{posNetTestResult.message}</AlertDescription>
                      </Alert>
                    )}

                    <div className="flex justify-end gap-3 border-t pt-6">
                      <Button variant="outline" onClick={loadPosNetConfig} disabled={posNetLoading || posNetSaving}>
                        {t('settings.network.reload')}
                      </Button>
                      <Button variant="outline" onClick={testHostConnection} disabled={posNetTesting || posNetSaving}>
                        {posNetTesting ? (
                          <>
                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                            {t('settings.network.testing')}
                          </>
                        ) : (
                          t('settings.network.testConn')
                        )}
                      </Button>
                      <Button
                        onClick={() =>
                          savePosNetConfig({
                            mode: posNetConfig.mode,
                            host: posNetConfig.host,
                            client: posNetConfig.client,
                          })
                        }
                        disabled={posNetSaving}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        {posNetSaving ? t('settings.network.saving') : t('settings.network.saveRestart')}
                      </Button>
                    </div>
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
