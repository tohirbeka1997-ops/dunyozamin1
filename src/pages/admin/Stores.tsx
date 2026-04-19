/**
 * Super-admin Stores page.
 *
 * Lists tenants from `pos:tenants:list`, lets the super-admin create new ones
 * (which seeds an initial admin user in the new tenant DB) and enable/disable
 * them. Disabled tenants immediately have their cached dispatcher + sessions
 * torn down on the server side — any connected cashier sees the next request
 * fail with AUTH_ERROR and gets bounced to the tenant login form.
 *
 * Guardrails:
 *   - The whole page is wrapped by <AdminRouteGuard> at the router level, so
 *     we assume scope='master' is already true by the time this renders.
 *   - We double-check `multiTenantMode` here so a misconfigured single-tenant
 *     server can't accidentally expose the UI via a leftover localStorage
 *     scope flag.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, RefreshCw, Store, Power, PowerOff, Palette } from 'lucide-react';
import { handleIpcResponse } from '@/utils/electron';

type TenantBranding = {
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
};

type Tenant = {
  id: string;
  slug: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  disabled_at: string | null;
  branding?: TenantBranding;
};

export default function StoresAdmin() {
  const { toast } = useToast();
  const { scope, multiTenantMode, signOut } = useAuth();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [brandingTenant, setBrandingTenant] = useState<Tenant | null>(null);

  const loadTenants = useCallback(async () => {
    setLoading(true);
    try {
      const api = (window as any).posApi;
      if (!api?.tenants?.list) throw new Error('Multi-tenant API topilmadi');
      const raw = await api.tenants.list({ includeInactive: true });
      const data = await handleIpcResponse<Tenant[]>(raw);
      setTenants(Array.isArray(data) ? data : []);
    } catch (err) {
      toast({
        title: 'Xatolik',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (scope === 'master') void loadTenants();
  }, [scope, loadTenants]);

  if (multiTenantMode === false) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Multi-tenant rejim o'chirilgan</CardTitle>
            <CardDescription>
              Server <code>POS_MULTI_TENANT=0</code> bilan ishlamoqda. Ushbu panel faqat
              multi-tenant o'rnatmada ma'noga ega.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Store className="h-6 w-6" /> Do'konlar (tenants)
          </h1>
          <p className="text-sm text-muted-foreground">
            Har bir do'kon o'z SQLite bazasida ishlaydi.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadTenants} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Yangilash
          </Button>
          <CreateTenantDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreated={() => {
              setCreateOpen(false);
              void loadTenants();
            }}
          />
          <Button variant="ghost" onClick={() => void signOut()}>
            Chiqish
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Nomi</TableHead>
                <TableHead>Holati</TableHead>
                <TableHead>Yaratilgan</TableHead>
                <TableHead className="text-right">Amallar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Do'konlar yo'q. Yangi do'kon yarating.
                  </TableCell>
                </TableRow>
              )}
              {tenants.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-sm">{t.slug}</TableCell>
                  <TableCell>{t.display_name}</TableCell>
                  <TableCell>
                    {t.is_active ? (
                      <Badge variant="default">faol</Badge>
                    ) : (
                      <Badge variant="secondary">o'chiq</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.created_at?.replace('T', ' ').slice(0, 19)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap gap-2 justify-end">
                      {t.is_active ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setBrandingTenant(t)}
                          >
                            <Palette className="h-4 w-4 mr-1" /> Brend
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busySlug === t.slug}
                            onClick={async () => {
                              setBusySlug(t.slug);
                              try {
                                const api = (window as any).posApi;
                                await handleIpcResponse(api.tenants.disable(t.slug));
                                toast({ title: 'O\'chirildi', description: t.slug });
                                await loadTenants();
                              } catch (e) {
                                toast({
                                  title: 'Xatolik',
                                  description: e instanceof Error ? e.message : String(e),
                                  variant: 'destructive',
                                });
                              } finally {
                                setBusySlug(null);
                              }
                            }}
                          >
                            <PowerOff className="h-4 w-4 mr-1" /> O'chirish
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busySlug === t.slug}
                          onClick={async () => {
                            setBusySlug(t.slug);
                            try {
                              const api = (window as any).posApi;
                              await handleIpcResponse(api.tenants.enable(t.slug));
                              toast({ title: 'Yoqildi', description: t.slug });
                              await loadTenants();
                            } catch (e) {
                              toast({
                                title: 'Xatolik',
                                description: e instanceof Error ? e.message : String(e),
                                variant: 'destructive',
                              });
                            } finally {
                              setBusySlug(null);
                            }
                          }}
                        >
                          <Power className="h-4 w-4 mr-1" /> Yoqish
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <TenantBrandingDialog
        tenant={brandingTenant}
        open={!!brandingTenant}
        onOpenChange={(v) => {
          if (!v) setBrandingTenant(null);
        }}
        onSaved={() => {
          setBrandingTenant(null);
          void loadTenants();
        }}
      />
    </div>
  );
}

function TenantBrandingDialog({
  tenant,
  open,
  onOpenChange,
  onSaved,
}: {
  tenant: Tenant | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (tenant) {
      const br = tenant.branding || {};
      setLogoUrl(br.logoUrl || '');
      setPrimaryColor(br.primaryColor || '');
      setAccentColor(br.accentColor || '');
    }
  }, [tenant]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant) return;
    if (primaryColor && !/^#[0-9a-fA-F]{6}$/.test(primaryColor.trim())) {
      toast({
        title: 'Xatolik',
        description: 'Asosiy rang: #RRGGBB formatida (masalan #0f766e)',
        variant: 'destructive',
      });
      return;
    }
    if (accentColor && !/^#[0-9a-fA-F]{6}$/.test(accentColor.trim())) {
      toast({
        title: 'Xatolik',
        description: 'Accent rang: #RRGGBB formatida',
        variant: 'destructive',
      });
      return;
    }
    if (logoUrl.trim() && !/^https:\/\//i.test(logoUrl.trim())) {
      toast({
        title: 'Xatolik',
        description: 'Logo faqat https:// manzili bo\'lishi kerak',
        variant: 'destructive',
      });
      return;
    }
    setSubmitting(true);
    try {
      const api = (window as any).posApi;
      await handleIpcResponse(
        api.tenants.setBranding({
          slug: tenant.slug,
          branding: {
            logoUrl: logoUrl.trim() || null,
            primaryColor: primaryColor.trim() || null,
            accentColor: accentColor.trim() || null,
          },
        }),
      );
      toast({ title: 'Saqlandi', description: tenant.slug });
      onSaved();
    } catch (err) {
      toast({
        title: 'Xatolik',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Do'kon brendi — {tenant?.slug}</DialogTitle>
          <DialogDescription>
            Kirish sahifasi: logo (HTTPS), asosiy va accent ranglar. Bo'sh qoldirsangiz — maydon tozalanadi.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="br-logo">Logo URL (https)</Label>
            <Input
              id="br-logo"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://cdn.example.com/logo.png"
              disabled={submitting}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="br-primary">Asosiy rang (#RRGGBB)</Label>
            <Input
              id="br-primary"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              placeholder="#0f766e"
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="br-accent">Accent rang (#RRGGBB)</Label>
            <Input
              id="br-accent"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              placeholder="#14b8a6"
              disabled={submitting}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Bekor
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saqlanmoqda…' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateTenantDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    slug: '',
    display_name: '',
    admin_username: 'admin',
    admin_password: '',
  });
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Mirror server-side slug validation so the user gets instant feedback.
    if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(form.slug)) {
      toast({
        title: 'Xatolik',
        description: 'Slug: a-z, 0-9, "-", "_" (2..40 belgi)',
        variant: 'destructive',
      });
      return;
    }
    if (form.admin_password.length < 8) {
      toast({
        title: 'Xatolik',
        description: 'Admin paroli kamida 8 belgi bo\'lishi kerak',
        variant: 'destructive',
      });
      return;
    }
    setSubmitting(true);
    try {
      const api = (window as any).posApi;
      await handleIpcResponse(
        api.tenants.create({
          slug: form.slug,
          display_name: form.display_name || form.slug,
          admin_username: form.admin_username,
          admin_password: form.admin_password,
        }),
      );
      toast({ title: 'Yaratildi', description: form.slug });
      setForm({ slug: '', display_name: '', admin_username: 'admin', admin_password: '' });
      onCreated();
    } catch (e) {
      toast({
        title: 'Xatolik',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" /> Yangi do'kon
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Yangi do'kon yaratish</DialogTitle>
          <DialogDescription>
            Yangi tenant uchun alohida SQLite baza yaratiladi va dastlabki admin
            foydalanuvchi seedlanadi.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-slug">Slug (subdomain)</Label>
            <Input
              id="new-slug"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
              placeholder="acme"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-name">Ko'rinadigan nomi</Label>
            <Input
              id="new-name"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="Acme POS"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-admin-user">Admin login</Label>
            <Input
              id="new-admin-user"
              value={form.admin_username}
              onChange={(e) => setForm({ ...form, admin_username: e.target.value })}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-admin-pass">Admin parol</Label>
            <Input
              id="new-admin-pass"
              type="password"
              value={form.admin_password}
              onChange={(e) => setForm({ ...form, admin_password: e.target.value })}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              Kamida 8 belgi. Birinchi kirishdan keyin admin uni almashtirishi tavsiya etiladi.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Bekor qilish
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Yaratilmoqda…' : 'Yaratish'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
