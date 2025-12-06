import { useState, useEffect } from 'react';
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
import { Save, AlertTriangle, Building2, Monitor, CreditCard, Receipt, Package, Hash, Shield, Globe } from 'lucide-react';
import { getSettingsByCategory, bulkUpdateSettings } from '@/db/api';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
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
          { label: 'Dashboard', href: '/' },
          { label: 'Settings', href: '/settings' },
        ]}
      />

      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage system configuration and preferences</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 xl:grid-cols-8">
          <TabsTrigger value="company" className="gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden xl:inline">Company</span>
          </TabsTrigger>
          <TabsTrigger value="pos" className="gap-2">
            <Monitor className="h-4 w-4" />
            <span className="hidden xl:inline">POS</span>
          </TabsTrigger>
          <TabsTrigger value="payment" className="gap-2">
            <CreditCard className="h-4 w-4" />
            <span className="hidden xl:inline">Payment</span>
          </TabsTrigger>
          <TabsTrigger value="receipt" className="gap-2">
            <Receipt className="h-4 w-4" />
            <span className="hidden xl:inline">Receipt</span>
          </TabsTrigger>
          <TabsTrigger value="inventory" className="gap-2">
            <Package className="h-4 w-4" />
            <span className="hidden xl:inline">Inventory</span>
          </TabsTrigger>
          <TabsTrigger value="numbering" className="gap-2">
            <Hash className="h-4 w-4" />
            <span className="hidden xl:inline">Numbering</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="h-4 w-4" />
            <span className="hidden xl:inline">Security</span>
          </TabsTrigger>
          <TabsTrigger value="localization" className="gap-2">
            <Globe className="h-4 w-4" />
            <span className="hidden xl:inline">Localization</span>
          </TabsTrigger>
        </TabsList>

        {/* Company Profile Tab */}
        <TabsContent value="company">
          <Card>
            <CardHeader>
              <CardTitle>Company Profile</CardTitle>
              <CardDescription>
                Company information displayed on receipts, invoices, and reports
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="company_name">
                    Company Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="company_name"
                    value={companySettings.name}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, name: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="Enter company name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="legal_name">Legal Name</Label>
                  <Input
                    id="legal_name"
                    value={companySettings.legal_name}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, legal_name: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="Legal company name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
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
                  <Label htmlFor="email">Email</Label>
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
                  <Label htmlFor="website">Website</Label>
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
                  <Label htmlFor="tax_id">Tax ID / INN / VAT</Label>
                  <Input
                    id="tax_id"
                    value={companySettings.tax_id}
                    onChange={(e) => {
                      setCompanySettings({ ...companySettings, tax_id: e.target.value });
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="Tax identification number"
                  />
                </div>
              </div>

              <div className="space-y-4 border-t pt-6">
                <h3 className="text-lg font-semibold">Address</h3>
                <div className="grid gap-6 xl:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="country">Country</Label>
                    <Input
                      id="country"
                      value={companySettings.address_country}
                      onChange={(e) => {
                        setCompanySettings({ ...companySettings, address_country: e.target.value });
                        setHasUnsavedChanges(true);
                      }}
                      placeholder="Country"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      value={companySettings.address_city}
                      onChange={(e) => {
                        setCompanySettings({ ...companySettings, address_city: e.target.value });
                        setHasUnsavedChanges(true);
                      }}
                      placeholder="City"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="street">Street Address</Label>
                    <Input
                      id="street"
                      value={companySettings.address_street}
                      onChange={(e) => {
                        setCompanySettings({ ...companySettings, address_street: e.target.value });
                        setHasUnsavedChanges(true);
                      }}
                      placeholder="Street address"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t pt-6">
                <Button variant="outline" onClick={() => loadAllSettings()}>
                  Cancel
                </Button>
                <Button onClick={() => handleSave('company', companySettings as unknown as Record<string, unknown>)} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* POS Terminal Tab */}
        <TabsContent value="pos">
          <Card>
            <CardHeader>
              <CardTitle>POS Terminal Settings</CardTitle>
              <CardDescription>Configure POS terminal behavior and features</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pos_mode">POS Mode</Label>
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
                  <p className="text-xs text-muted-foreground">For future use</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="auto_logout">Auto Logout (minutes)</Label>
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
                  <Label htmlFor="quick_access">Quick Access Products Limit</Label>
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
                <h3 className="text-lg font-semibold">Features</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label>Enable Hold Order</Label>
                      <p className="text-sm text-muted-foreground">
                        Allow cashiers to hold orders for later
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
                      <Label>Enable Mixed Payment</Label>
                      <p className="text-sm text-muted-foreground">
                        Allow multiple payment methods per order
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
                      <Label>Require Customer for Credit Sales</Label>
                      <p className="text-sm text-muted-foreground">
                        Force customer selection when selling on credit
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
                      <Label>Show Low Stock Warning</Label>
                      <p className="text-sm text-muted-foreground">
                        Display warning when product stock is low
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
                  Cancel
                </Button>
                <Button onClick={() => handleSave('pos', posSettings as unknown as Record<string, unknown>)} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Changes'}
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
                <CardTitle>Payment Methods</CardTitle>
                <CardDescription>Configure available payment methods</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  {['cash', 'card', 'terminal', 'qr'].map((method) => (
                    <div key={method} className="flex items-center justify-between">
                      <div className="space-y-1">
                        <Label className="capitalize">{method}</Label>
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
                          placeholder="Display label"
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
                  ))}
                </div>

                <div className="flex justify-end gap-3 border-t pt-6">
                  <Button variant="outline" onClick={() => loadAllSettings()}>
                    Cancel
                  </Button>
                  <Button onClick={() => handleSave('payment', paymentSettings as unknown as Record<string, unknown>)} disabled={saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tax Settings</CardTitle>
                <CardDescription>Configure tax calculation and display</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Enable Tax System</Label>
                    <p className="text-sm text-muted-foreground">Apply taxes to sales</p>
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
                    Cancel
                  </Button>
                  <Button onClick={() => handleSave('tax', taxSettings as unknown as Record<string, unknown>)} disabled={saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Saving...' : 'Save Changes'}
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
              <CardTitle>Receipt & Printing</CardTitle>
              <CardDescription>Configure receipt template and printing options</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="paper_size">Paper Size</Label>
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
                <Label htmlFor="header_text">Receipt Header Text</Label>
                <Textarea
                  id="header_text"
                  value={receiptSettings.header_text}
                  onChange={(e) => {
                    setReceiptSettings({ ...receiptSettings, header_text: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  placeholder="Thank you for shopping with us!"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="footer_text">Receipt Footer Text</Label>
                <Textarea
                  id="footer_text"
                  value={receiptSettings.footer_text}
                  onChange={(e) => {
                    setReceiptSettings({ ...receiptSettings, footer_text: e.target.value });
                    setHasUnsavedChanges(true);
                  }}
                  placeholder="Returns accepted within 7 days with receipt"
                  rows={3}
                />
              </div>

              <div className="space-y-4 border-t pt-6">
                <h3 className="text-lg font-semibold">Display Options</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Auto Print Receipt</Label>
                    <Switch
                      checked={receiptSettings.auto_print}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, auto_print: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>Show Company Logo</Label>
                    <Switch
                      checked={receiptSettings.show_logo}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, show_logo: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>Show Cashier Name</Label>
                    <Switch
                      checked={receiptSettings.show_cashier}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, show_cashier: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>Show Customer Name</Label>
                    <Switch
                      checked={receiptSettings.show_customer}
                      onCheckedChange={(checked) => {
                        setReceiptSettings({ ...receiptSettings, show_customer: checked });
                        setHasUnsavedChanges(true);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>Show Product SKU</Label>
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
                  Cancel
                </Button>
                <Button onClick={() => handleSave('receipt', receiptSettings as unknown as Record<string, unknown>)} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inventory Tab */}
        <TabsContent value="inventory">
          <Card>
            <CardHeader>
              <CardTitle>Inventory Settings</CardTitle>
              <CardDescription>Configure inventory tracking and stock management</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>Enable Inventory Tracking</Label>
                  <p className="text-sm text-muted-foreground">Track product stock levels</p>
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
                  Cancel
                </Button>
                <Button onClick={() => handleSave('inventory', inventorySettings as unknown as Record<string, unknown>)} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Numbering Tab */}
        <TabsContent value="numbering">
          <Card>
            <CardHeader>
              <CardTitle>Numbering & IDs</CardTitle>
              <CardDescription>Configure auto-generated document numbers</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="order_prefix">Order Number Prefix</Label>
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
                  <Label htmlFor="order_format">Order Number Format</Label>
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
                  <Label htmlFor="return_prefix">Return Number Prefix</Label>
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
                  <Label htmlFor="return_format">Return Number Format</Label>
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
                  <Label htmlFor="purchase_prefix">Purchase Order Prefix</Label>
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
                  <Label htmlFor="purchase_format">Purchase Order Format</Label>
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
                  <Label htmlFor="movement_prefix">Movement Number Prefix</Label>
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
                  <Label htmlFor="movement_format">Movement Number Format</Label>
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
                  Cancel
                </Button>
                <Button onClick={() => handleSave('numbering', numberingSettings as unknown as Record<string, unknown>)} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>User & Security</CardTitle>
              <CardDescription>Configure security policies and user management</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Password Policy</h3>
                <div className="grid gap-6 xl:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="min_password">Minimum Password Length</Label>
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
                      <Label>Require Strong Password</Label>
                      <p className="text-sm text-muted-foreground">Letters + numbers required</p>
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
                <h3 className="text-lg font-semibold">Session Management</h3>
                <div className="grid gap-6 xl:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="max_attempts">Max Failed Login Attempts</Label>
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
                    <Label htmlFor="session_timeout">Session Timeout (minutes)</Label>
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
                    <Label>Allow Multiple Sessions</Label>
                    <p className="text-sm text-muted-foreground">
                      Users can log in from multiple devices
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
                <h3 className="text-lg font-semibold">Audit & Logging</h3>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Enable Activity Logging</Label>
                    <p className="text-sm text-muted-foreground">
                      Log key actions (orders, returns, inventory)
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
                  Cancel
                </Button>
                <Button onClick={() => handleSave('security', securitySettings as unknown as Record<string, unknown>)} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Localization Tab */}
        <TabsContent value="localization">
          <Card>
            <CardHeader>
              <CardTitle>Localization</CardTitle>
              <CardDescription>Configure language and currency preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="language">Default Language</Label>
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
                  <Label htmlFor="currency">Default Currency</Label>
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
                  <Label htmlFor="currency_symbol">Currency Symbol</Label>
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
                  <Label htmlFor="currency_position">Currency Position</Label>
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
                      <SelectItem value="before">Before Amount ($ 100)</SelectItem>
                      <SelectItem value="after">After Amount (100 UZS)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="thousand_sep">Thousand Separator</Label>
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
                  <Label htmlFor="decimal_sep">Decimal Separator</Label>
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
                  Cancel
                </Button>
                <Button
                  onClick={() => handleSave('localization', localizationSettings as unknown as Record<string, unknown>)}
                  disabled={saving}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </CardContent>
          </Card>
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
