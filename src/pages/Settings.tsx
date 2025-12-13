import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Save, AlertTriangle, Building2, Monitor, CreditCard, Receipt, Package, Hash, Shield, Globe, Wifi, WifiOff, RefreshCw, Trash2 } from 'lucide-react';
import { getSettingsByCategory, bulkUpdateSettings } from '@/db/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useSyncEngine } from '@/hooks/useSyncEngine';
import { clearAllLocalData, getAllOutboxItems } from '@/offline/db';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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

// Offline Settings Tab Component
function OfflineSettingsTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { isOnline, syncStatus, lastSyncAt, pendingCount } = useNetworkStatus();
  const { syncNow, isSyncing } = useSyncEngine();
  const [offlineEnabled, setOfflineEnabled] = useState(true); // Always enabled for now
  const [clearingCache, setClearingCache] = useState(false);

  const handleRetrySync = async () => {
    await syncNow();
    toast({
      title: t('settings.offline.sync_started'),
      description: t('settings.offline.sync_started_desc'),
    });
  };

  const handleClearCache = async () => {
    if (!confirm(t('settings.offline.clear_cache_confirm'))) {
      return;
    }

    setClearingCache(true);
    try {
      await clearAllLocalData();
      toast({
        title: t('settings.offline.cache_cleared'),
        description: t('settings.offline.cache_cleared_desc'),
      });
    } catch (error) {
      toast({
        title: t('settings.offline.error'),
        description: t('settings.offline.failed_to_clear', { error: error instanceof Error ? error.message : t('common.error') }),
        variant: 'destructive',
      });
    } finally {
      setClearingCache(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.offline.title')}</CardTitle>
        <CardDescription>{t('settings.offline.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status Alert */}
        <Alert>
          <Wifi className="h-4 w-4" />
          <AlertTitle>{t('settings.offline.connection_status')}</AlertTitle>
          <AlertDescription>
            {isOnline ? (
              <div className="space-y-1">
                <p>{t('settings.offline.online')}</p>
                {pendingCount > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t('settings.offline.pending_sync', { count: pendingCount })}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <p>{t('settings.offline.offline')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('settings.offline.changes_will_sync')}
                </p>
              </div>
            )}
          </AlertDescription>
        </Alert>

        {/* Sync Status */}
        <div className="space-y-2">
          <Label>{t('settings.offline.sync_status')}</Label>
          <div className="flex items-center gap-2">
            {syncStatus === 'syncing' || isSyncing ? (
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>{t('settings.offline.syncing')}</span>
              </div>
            ) : syncStatus === 'failed' ? (
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>{t('settings.offline.sync_failed')}</span>
              </div>
            ) : syncStatus === 'success' ? (
              <div className="flex items-center gap-2 text-green-600">
                <Wifi className="h-4 w-4" />
                <span>{t('settings.offline.synced')}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <WifiOff className="h-4 w-4" />
                <span>{t('settings.offline.idle')}</span>
              </div>
            )}
          </div>
          {lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              {t('settings.offline.last_sync').replace('{{date}}', new Date(lastSyncAt).toLocaleString())}
            </p>
          )}
        </div>

        {/* Offline Mode Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="offline-enabled">{t('settings.offline.enable_offline_mode')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('settings.offline.enable_offline_desc')}
            </p>
          </div>
          <Switch
            id="offline-enabled"
            checked={offlineEnabled}
            onCheckedChange={setOfflineEnabled}
            disabled
          />
        </div>

        {/* Actions */}
        <div className="space-y-3 border-t pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t('settings.offline.manual_sync')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.offline.manual_sync_desc')}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleRetrySync}
              disabled={!isOnline || isSyncing || pendingCount === 0}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              {t('settings.offline.retry_sync')}
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t('settings.offline.clear_cache')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.offline.clear_cache_desc')}
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={handleClearCache}
              disabled={clearingCache}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {clearingCache ? t('settings.offline.clearing') : t('settings.offline.clear_cache')}
            </Button>
          </div>
        </div>

        {/* Info */}
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t('settings.offline.about_offline')}</AlertTitle>
          <AlertDescription className="text-xs">
            {t('settings.offline.about_offline_desc')}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [activeTab, setActiveTab] = useState('company');

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
    footer_text: '',
    show_logo: true,
    show_cashier: true,
    show_customer: true,
    show_sku: true,
    paper_size: '80mm',
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

  useEffect(() => {
    loadAllSettings();
  }, []);

  const loadAllSettings = async () => {
    try {
      setLoading(true);
      const [company, pos, payment, tax, receipt, inventory, numbering, security, localization] =
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
    } catch (error) {
      console.error('Error loading settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load settings',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (category: string, settings: Record<string, unknown>) => {
    if (!profile?.id) return;

    try {
      setSaving(true);
      await bulkUpdateSettings(category, settings, profile.id);
      setHasUnsavedChanges(false);
      toast({
        title: 'Success',
        description: 'Settings saved successfully',
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTabChange = (value: string) => {
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true);
      return;
    }
    setActiveTab(value);
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageBreadcrumb
        items={[
          { label: 'Bosh sahifa', href: '/' },
          { label: 'Sozlamalar', href: '/settings' },
        ]}
      />

      <div>
        <h1 className="text-3xl font-bold">Sozlamalar</h1>
        <p className="text-muted-foreground">Tizim sozlamalari va ustuvorliklarini boshqarish</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 xl:grid-cols-9">
          <TabsTrigger value="company" className="gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden xl:inline">Kompaniya</span>
          </TabsTrigger>
          <TabsTrigger value="pos" className="gap-2">
            <Monitor className="h-4 w-4" />
            <span className="hidden xl:inline">POS tizimi</span>
          </TabsTrigger>
          <TabsTrigger value="payment" className="gap-2">
            <CreditCard className="h-4 w-4" />
            <span className="hidden xl:inline">To'lov</span>
          </TabsTrigger>
          <TabsTrigger value="receipt" className="gap-2">
            <Receipt className="h-4 w-4" />
            <span className="hidden xl:inline">Chek</span>
          </TabsTrigger>
          <TabsTrigger value="inventory" className="gap-2">
            <Package className="h-4 w-4" />
            <span className="hidden xl:inline">Ombor</span>
          </TabsTrigger>
          <TabsTrigger value="numbering" className="gap-2">
            <Hash className="h-4 w-4" />
            <span className="hidden xl:inline">Raqamlashtirish</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="h-4 w-4" />
            <span className="hidden xl:inline">Xavfsizlik</span>
          </TabsTrigger>
          <TabsTrigger value="localization" className="gap-2">
            <Globe className="h-4 w-4" />
            <span className="hidden xl:inline">Mahalliylashtirish</span>
          </TabsTrigger>
          <TabsTrigger value="offline" className="gap-2">
            <Wifi className="h-4 w-4" />
            <span className="hidden xl:inline">Offline & Sync</span>
          </TabsTrigger>
        </TabsList>

        {/* Company Profile Tab */}
        <TabsContent value="company">
          <Card>
            <CardHeader>
              <CardTitle>Kompaniya profili</CardTitle>
              <CardDescription>
                Cheklar, hisob-fakturalar va hisobotlarda ko'rinadigan kompaniya ma'lumotlari
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="company_name">
                    Kompaniya nomi <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="company_name"
                    value={companySettings.name}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, name: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="Kompaniya nomini kiriting"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="legal_name">Yuridik nomi</Label>
                  <Input
                    id="legal_name"
                    value={companySettings.legal_name}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, legal_name: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="Kompaniyaning yuridik nomi"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Telefon raqami</Label>
                  <Input
                    id="phone"
                    value={companySettings.phone}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, phone: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="+998 XX XXX XX XX"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Elektron pochta</Label>
                  <Input
                    id="email"
                    type="email"
                    value={companySettings.email}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, email: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="company@example.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">Veb-sayt</Label>
                  <Input
                    id="website"
                    value={companySettings.website}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, website: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="https://example.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tax_id">STIR / INN / QQS</Label>
                  <Input
                    id="tax_id"
                    value={companySettings.tax_id}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, tax_id: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="Soliq identifikatsiya raqami"
                  />
                </div>
              </div>

              <div className="space-y-4 border-t pt-6">
                <h3 className="text-lg font-semibold">Manzil</h3>
                <div className="grid gap-6 xl:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="country">Mamlakat</Label>
                    <Input
                      id="country"
                      value={companySettings.address_country}
                      onChange={(e) => {
                        setCompanySettings({ ...companySettings, address_country: e.target.value });
                        setHasUnsavedChanges(true);
                      }}
                      placeholder="Mamlakat"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="city">Shahar</Label>
                    <Input
                      id="city"
                      value={companySettings.address_city}
                      onChange={(e) => {
                        setCompanySettings({ ...companySettings, address_city: e.target.value });
                        setHasUnsavedChanges(true);
                      }}
                      placeholder="Shahar"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="street">Ko'cha manzili</Label>
                    <Input
                      id="street"
                      value={companySettings.address_street}
                      onChange={(e) => {
                        setCompanySettings({ ...companySettings, address_street: e.target.value });
                        setHasUnsavedChanges(true);
                      }}
                      placeholder="Ko'cha manzili"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t pt-6">
                <Button variant="outline" onClick={() => loadAllSettings()}>
                  Bekor qilish
                </Button>
                <Button onClick={() => handleSave('company', companySettings as unknown as Record<string, unknown>)} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saqlanmoqda...' : 'O\'zgarishlarni saqlash'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* POS Terminal Tab */}
        <TabsContent value="pos">
          <Card>
            <CardHeader>
              <CardTitle>POS terminal sozlamalari</CardTitle>
              <CardDescription>POS terminalining ishlash tartibi va funksiyalarini sozlash</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pos_mode">POS rejimi</Label>
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
                      <SelectItem value="retail">Retail</SelectItem>
                      <SelectItem value="restaurant">Restaurant</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Kelajakda foydalanish uchun</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="auto_logout">Avto chiqish (daqiqada)</Label>
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
                  <Label htmlFor="quick_access">Tezkor kirish mahsulotlar limiti</Label>
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
                <h3 className="text-lg font-semibold">Qo'shimcha imkoniyatlar</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>Buyurtmani ushlab turishni yoqish</Label>
                      <p className="text-sm text-muted-foreground">
                        Kassirlarga buyurtmalarni keyinroq davom ettirish uchun ushlab turishga ruxsat berish
                      </p>
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
                      <Label>Aralash to'lovni yoqish</Label>
                      <p className="text-sm text-muted-foreground">
                        Bitta buyurtma uchun bir nechta to'lov usulidan foydalanishga ruxsat berish
                      </p>
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
                      <Label>Qarzga sotishda mijozni tanlash majburiy</Label>
                      <p className="text-sm text-muted-foreground">
                        Qarzga sotilganda albatta mijozni tanlashni talab qilish
                      </p>
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
                      <Label>Qoldiq kamaysa ogohlantirish</Label>
                      <p className="text-sm text-muted-foreground">
                        Mahsulot qoldig'i kam bo'lganda ogohlantirish ko'rsatish
                      </p>
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
                <Button variant="outline" onClick={() => loadAllSettings()}>
                  Bekor qilish
                </Button>
                <Button onClick={() => handleSave('pos', posSettings as unknown as Record<string, unknown>)} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saqlanmoqda...' : 'O\'zgarishlarni saqlash'}
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
                <CardTitle>To'lov usullari</CardTitle>
                <CardDescription>Mavjud to'lov usullarini sozlash</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  {['cash', 'card', 'terminal', 'qr'].map((method) => {
                    const methodLabels: Record<string, string> = {
                      cash: 'Naqd',
                      card: 'Karta',
                      terminal: 'Terminal',
                      qr: 'QR to\'lov',
                    };
                    return (
                      <div key={method} className="flex items-center justify-between">
                        <div className="space-y-1">
                          <Label>{methodLabels[method] || method}</Label>
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
                            placeholder="Ko'rsatish nomi"
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
                  <Button variant="outline" onClick={() => loadAllSettings()}>
                    Bekor qilish
                  </Button>
                  <Button onClick={() => handleSave('payment', paymentSettings as unknown as Record<string, unknown>)} disabled={saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Saqlanmoqda...' : 'O\'zgarishlarni saqlash'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Soliq sozlamalari</CardTitle>
                <CardDescription>Soliq hisobini va ko'rsatishni sozlash</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Soliq tizimini yoqish</Label>
                    <p className="text-sm text-muted-foreground">Savdolarga soliq qo'llash</p>
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
                      <Label htmlFor="tax_rate">Default Tax Rate (%)</Label>
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
                        <Label>Tax Inclusive</Label>
                        <p className="text-sm text-muted-foreground">
                          Tax is included in product prices
                        </p>
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
                        <Label>Per-Product Tax Override</Label>
                        <p className="text-sm text-muted-foreground">
                          Allow different tax rates per product
                        </p>
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
                  <Button variant="outline" onClick={() => loadAllSettings()}>
                    Bekor qilish
                  </Button>
                  <Button onClick={() => handleSave('tax', taxSettings as unknown as Record<string, unknown>)} disabled={saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Saqlanmoqda...' : 'O\'zgarishlarni saqlash'}
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
              <CardTitle>Chek va Chop etish</CardTitle>
              <CardDescription>Chek shabloni va chop etish parametrlarini sozlash</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="paper_size">Qog'oz o'lchami</Label>
                <Select
                  value={receiptSettings.paper_size}
                  onValueChange={(value: '58mm' | '80mm') => {
                    setReceiptSettings({ ...receiptSettings, paper_size: value });
                    setHasUnsavedChanges(true);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58mm">58mm</SelectItem>
                    <SelectItem value="80mm">80mm</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="header_text">Chek sarlavhasi matni</Label>
                <Textarea
                  id="header_text"
                  value={receiptSettings.header_text}
                  onChange={(e) => {
                    setReceiptSettings({ ...receiptSettings, header_text: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  placeholder="Bizdan xarid qilganingiz uchun rahmat!"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="footer_text">Chek pastki matni</Label>
                <Textarea
                  id="footer_text"
                  value={receiptSettings.footer_text}
                  onChange={(e) => {
                    setReceiptSettings({ ...receiptSettings, footer_text: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  placeholder="Qaytarish faqat 7 kun ichida, chek bilan qabul qilinadi"
                  rows={3}
                />
              </div>

              <div className="space-y-4 border-t pt-6">
                <h3 className="text-lg font-semibold">Ko'rsatish parametrlari</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Chekni avtomatik chop etish</Label>
                    <Switch
                      checked={receiptSettings.auto_print}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, auto_print: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>Kompaniya logosini ko'rsatish</Label>
                    <Switch
                      checked={receiptSettings.show_logo}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, show_logo: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>Kassir ismini ko'rsatish</Label>
                    <Switch
                      checked={receiptSettings.show_cashier}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, show_cashier: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>Mijoz ismini ko'rsatish</Label>
                    <Switch
                      checked={receiptSettings.show_customer}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, show_customer: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>Mahsulot SKU ko'rsatish</Label>
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
                <Button variant="outline" onClick={() => loadAllSettings()}>
                  Bekor qilish
                </Button>
                <Button onClick={() => handleSave('receipt', receiptSettings as unknown as Record<string, unknown>)} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saqlanmoqda...' : 'O\'zgarishlarni saqlash'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inventory Tab */}
        <TabsContent value="inventory">
          <Card>
            <CardHeader>
              <CardTitle>Ombor sozlamalari</CardTitle>
              <CardDescription>Ombor hisobini yuritish va zaxiralarni boshqarishni sozlash</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>Ombor hisobini yoqish</Label>
                  <p className="text-sm text-muted-foreground">Mahsulot zaxiralarini kuzatish</p>
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
                    <Label htmlFor="min_stock">Default Minimal Stock Level</Label>
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
                    <Label htmlFor="negative_stock">Allow Negative Stock</Label>
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
                        <SelectItem value="block">Block Sale</SelectItem>
                        <SelectItem value="allow_with_warning">Allow with Warning</SelectItem>
                        <SelectItem value="allow_without_warning">Allow without Warning</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {inventorySettings.allow_negative_stock === 'block' &&
                        'Prevent sales when stock is zero'}
                      {inventorySettings.allow_negative_stock === 'allow_with_warning' &&
                        'Show warning but allow sale'}
                      {inventorySettings.allow_negative_stock === 'allow_without_warning' &&
                        'Allow sale without any warning'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cost_calc">Cost Calculation Mode</Label>
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
                        <SelectItem value="latest_purchase">Latest Purchase Price</SelectItem>
                        <SelectItem value="average_cost">Average Cost</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>Require Approval for Adjustments</Label>
                      <p className="text-sm text-muted-foreground">
                        Stock adjustments need manager approval
                      </p>
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
                <Button variant="outline" onClick={() => loadAllSettings()}>
                  Bekor qilish
                </Button>
                <Button onClick={() => handleSave('inventory', inventorySettings as unknown as Record<string, unknown>)} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saqlanmoqda...' : 'O\'zgarishlarni saqlash'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Numbering Tab */}
        <TabsContent value="numbering">
          <Card>
            <CardHeader>
              <CardTitle>Raqamlashtirish va identifikatorlar</CardTitle>
              <CardDescription>Hujjatlar uchun avtomatik yaratiladigan raqamlarni sozlash</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="order_prefix">Sotuv raqami prefiksi</Label>
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
                  <Label htmlFor="order_format">Sotuv raqami formati</Label>
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
                  <Label htmlFor="return_prefix">Qaytarish raqami prefiksi</Label>
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
                  <Label htmlFor="return_format">Qaytarish raqami formati</Label>
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
                  <Label htmlFor="purchase_prefix">Xarid buyurtmasi prefiksi</Label>
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
                  <Label htmlFor="purchase_format">Xarid buyurtmasi formati</Label>
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
                  <Label htmlFor="movement_prefix">Harakat (ombor ko'chirish) raqami prefiksi</Label>
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
                  <Label htmlFor="movement_format">Harakat raqami formati</Label>
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
                <Button variant="outline" onClick={() => loadAllSettings()}>
                  Bekor qilish
                </Button>
                <Button onClick={() => handleSave('numbering', numberingSettings as unknown as Record<string, unknown>)} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saqlanmoqda...' : 'O\'zgarishlarni saqlash'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>Foydalanuvchi va xavfsizlik</CardTitle>
              <CardDescription>Xavfsizlik siyosatlari va foydalanuvchi boshqaruvini sozlash</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Parol siyosati</h3>
                <div className="grid gap-6 xl:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="min_password">Parolning minimal uzunligi</Label>
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
                      <Label>Kuchli parol talab qilinsin</Label>
                      <p className="text-sm text-muted-foreground">Harf va raqamlar majburiy</p>
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
                <h3 className="text-lg font-semibold">Sessiyalarni boshqarish</h3>
                <div className="grid gap-6 xl:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="max_attempts">Maksimal muvaffaqiyatsiz kirish urinishlari</Label>
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
                    <Label htmlFor="session_timeout">Sessiya muddati (daqiqalarda)</Label>
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
                    <Label>Bir nechta sessiyalarga ruxsat berish</Label>
                    <p className="text-sm text-muted-foreground">
                      Foydalanuvchilar bir nechta qurilmadan tizimga kira oladi
                    </p>
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
                <h3 className="text-lg font-semibold">Audit va jurnal yuritish</h3>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Faoliyat jurnalini yoqish</Label>
                    <p className="text-sm text-muted-foreground">
                      Asosiy harakatlarni qayd etish (sotuvlar, qaytarishlar, ombor harakatlari)
                    </p>
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
                <Button variant="outline" onClick={() => loadAllSettings()}>
                  Bekor qilish
                </Button>
                <Button onClick={() => handleSave('security', securitySettings as unknown as Record<string, unknown>)} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saqlanmoqda...' : 'O\'zgarishlarni saqlash'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Localization Tab */}
        <TabsContent value="localization">
          <Card>
            <CardHeader>
              <CardTitle>Mahalliylashtirish</CardTitle>
              <CardDescription>Til va valyuta sozlamalarini boshqarish</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="language">Asosiy til</Label>
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
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="uz">Uzbek</SelectItem>
                      <SelectItem value="ru">Russian</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency">Asosiy valyuta</Label>
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
                  <Label htmlFor="currency_symbol">Valyuta belgisi</Label>
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
                  <Label htmlFor="currency_position">Valyuta belgisi joylashuvi</Label>
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
                      <SelectItem value="before">Summadan oldin ($ 100)</SelectItem>
                      <SelectItem value="after">Summadan keyin (100 UZS)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="thousand_sep">Minglik ajratgich</Label>
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
                  <Label htmlFor="decimal_sep">O'nlik ajratgich</Label>
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
                <Button variant="outline" onClick={() => loadAllSettings()}>
                  Bekor qilish
                </Button>
                <Button
                  onClick={() => handleSave('localization', localizationSettings as unknown as Record<string, unknown>)}
                  disabled={saving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saqlanmoqda...' : 'O\'zgarishlarni saqlash'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Offline & Sync Tab */}
        <TabsContent value="offline">
          <OfflineSettingsTab />
        </TabsContent>
      </Tabs>

      <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Unsaved Changes
            </DialogTitle>
            <DialogDescription>
              You have unsaved changes. If you leave this tab, your changes will be lost. Do you want
              to continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUnsavedDialog(false)}>
              Stay
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setHasUnsavedChanges(false);
                setShowUnsavedDialog(false);
                loadAllSettings();
              }}
            >
              Discard Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
