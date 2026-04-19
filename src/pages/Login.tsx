import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { handleIpcResponse } from '@/utils/electron';
import { Store } from 'lucide-react';

type TenantBranding = {
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
};

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { signIn, signUp, loading, multiTenantMode } = useAuth();

  // Get redirect path from location state or default to /
  const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/';

  // Auto-prefill tenant slug from subdomain (e.g. acme.pos.example.com → "acme").
  // Falls back to whatever is already stored from a previous session. Users
  // on apex / single-tenant installs see no field at all (see below).
  const [signInData, setSignInData] = useState(() => {
    let tenant = '';
    try {
      const api = (window as any).posApi;
      tenant = api?._session?.getTenantSlug?.() || '';
      if (!tenant && api?._session?.extractTenantSlugFromHost) {
        tenant = api._session.extractTenantSlugFromHost() || '';
      }
    } catch { /* ignore */ }
    return {
      tenant,
      email: '',
      password: '',
    };
  });

  const [signUpData, setSignUpData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    fullName: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  /** Loaded from pos:tenants:publicProfile when tenant slug is valid (MT only). */
  const [tenantVisual, setTenantVisual] = useState<{
    displayName: string;
    branding: TenantBranding;
  } | null>(null);

  // Keep the tenant input in sync when the MT probe finishes after the
  // component first mounted (happens when the probe is slow on a cold
  // page load).
  useEffect(() => {
    if (multiTenantMode && !signInData.tenant) {
      try {
        const api = (window as any).posApi;
        const fromHost = api?._session?.extractTenantSlugFromHost?.() || '';
        const fromStore = api?._session?.getTenantSlug?.() || '';
        const next = fromStore || fromHost;
        if (next) setSignInData((s) => ({ ...s, tenant: next }));
      } catch { /* ignore */ }
    }
  }, [multiTenantMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    const slug = signInData.tenant.trim().toLowerCase();
    if (multiTenantMode !== true || !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(slug)) {
      setTenantVisual(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const api = (window as any).posApi;
        if (!api?.tenants?.publicProfile) {
          if (!cancelled) setTenantVisual(null);
          return;
        }
        const data = await handleIpcResponse<{
          slug: string;
          display_name: string;
          branding: TenantBranding;
        }>(api.tenants.publicProfile(slug));
        if (cancelled || data.slug !== slug) return;
        setTenantVisual({
          displayName: data.display_name || slug,
          branding: data.branding && typeof data.branding === 'object' ? data.branding : {},
        });
      } catch {
        if (!cancelled) setTenantVisual(null);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [signInData.tenant, multiTenantMode]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!signInData.email || !signInData.password) {
      toast({
        title: 'Xatolik',
        description: 'Iltimos, barcha maydonlarni to\'ldiring',
        variant: 'destructive',
      });
      return;
    }

    // In multi-tenant mode the tenant slug is REQUIRED. Server-side regex:
    //   ^[a-z0-9][a-z0-9_-]{1,39}$
    // We pre-validate here to give a useful error before the network call.
    const trimmedTenant = signInData.tenant.trim().toLowerCase();
    if (multiTenantMode === true) {
      if (!trimmedTenant) {
        toast({
          title: 'Xatolik',
          description: 'Do\'kon (tenant) kodini kiriting',
          variant: 'destructive',
        });
        return;
      }
      if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(trimmedTenant)) {
        toast({
          title: 'Xatolik',
          description: 'Do\'kon kodi: faqat a-z, 0-9, "-", "_" (2..40 belgi)',
          variant: 'destructive',
        });
        return;
      }
    }

    // Accept email OR plain username (some installs seed `admin` without a domain).
    const trimmedId = signInData.email.trim();
    const looksLikeEmail = /@/.test(trimmedId);
    const looksLikeUsername = /^[A-Za-z0-9._-]{2,64}$/.test(trimmedId);
    if (!looksLikeEmail && !looksLikeUsername) {
      toast({
        title: 'Xatolik',
        description: 'Email yoki foydalanuvchi nomini to\'g\'ri kiriting',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      console.log('🔐 Login attempt:', { identifier: trimmedId, tenant: trimmedTenant || undefined });
      await signIn(trimmedId, signInData.password, trimmedTenant || null);
      console.log('✅ Login successful');
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Tizimga muvaffaqiyatli kirdingiz',
      });
      // Wait a moment for auth state to update, then navigate
      setTimeout(() => {
        navigate(from, { replace: true });
      }, 100);
    } catch (error) {
      console.error('❌ Sign in error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Kirishda xatolik yuz berdi';
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!signUpData.email || !signUpData.password || !signUpData.confirmPassword) {
      toast({
        title: 'Xatolik',
        description: 'Iltimos, barcha majburiy maydonlarni to\'ldiring',
        variant: 'destructive',
      });
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(signUpData.email)) {
      toast({
        title: 'Xatolik',
        description: 'Noto\'g\'ri email formati',
        variant: 'destructive',
      });
      return;
    }

    if (signUpData.password !== signUpData.confirmPassword) {
      toast({
        title: 'Xatolik',
        description: 'Parollar mos kelmaydi',
        variant: 'destructive',
      });
      return;
    }

    if (signUpData.password.length < 6) {
      toast({
        title: 'Xatolik',
        description: 'Parol kamida 6 belgi bo\'lishi kerak',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await signUp(
        signUpData.email,
        signUpData.password,
        signUpData.fullName || undefined,
        signUpData.username || undefined
      );
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Hisob yaratildi va tizimga kirildi',
      });
      // Wait a moment for auth state to update, then navigate
      setTimeout(() => {
        navigate(from, { replace: true });
      }, 100);
    } catch (error) {
      console.error('Sign up error:', error);
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Hisob yaratishda xatolik yuz berdi',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };


  const b = tenantVisual?.branding;
  const headerBg =
    b?.primaryColor && b?.accentColor
      ? `linear-gradient(135deg, ${b.primaryColor}, ${b.accentColor})`
      : b?.primaryColor || undefined;
  const headerOnColor = !!headerBg;

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md overflow-hidden">
        <CardHeader
          className="space-y-1 text-center border-b bg-card"
          style={
            headerBg
              ? { background: headerBg, borderColor: 'transparent', color: '#fff' }
              : undefined
          }
        >
          <div className="flex justify-center mb-4">
            {b?.logoUrl ? (
              <img
                src={b.logoUrl}
                alt={tenantVisual?.displayName || ''}
                className="h-16 max-w-[200px] object-contain rounded-md bg-white/95 px-2 py-1 shadow-sm"
              />
            ) : (
              <div
                className="h-16 w-16 rounded-full flex items-center justify-center bg-primary"
                style={
                  headerOnColor
                    ? { backgroundColor: 'rgba(255,255,255,0.22)' }
                    : undefined
                }
              >
                <Store className={`h-8 w-8 ${headerOnColor ? 'text-white' : 'text-primary-foreground'}`} />
              </div>
            )}
          </div>
          <CardTitle className={`text-2xl font-bold ${headerOnColor ? 'text-white' : ''}`}>
            {multiTenantMode === true && tenantVisual?.displayName
              ? tenantVisual.displayName
              : 'POS Tizimi'}
          </CardTitle>
          <CardDescription className={headerOnColor ? 'text-white/90' : undefined}>
            {multiTenantMode === true && tenantVisual?.displayName
              ? `Do'kon: ${signInData.tenant.trim().toLowerCase()}`
              : 'Savdo nuqtasi boshqaruvi'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Kirish</TabsTrigger>
              <TabsTrigger value="signup">Ro'yxatdan o'tish</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                {multiTenantMode === true && (
                  <div className="space-y-2">
                    <Label htmlFor="signin-tenant">Do'kon (tenant)</Label>
                    <Input
                      id="signin-tenant"
                      type="text"
                      placeholder="masalan: default, myshop"
                      value={signInData.tenant}
                      onChange={(e) =>
                        setSignInData({ ...signInData, tenant: e.target.value.toLowerCase() })
                      }
                      disabled={isSubmitting || loading}
                      autoComplete="organization"
                      pattern="[a-z0-9][a-z0-9_\\-]{1,39}"
                      title="faqat a-z, 0-9, - va _ (2..40 belgi)"
                    />
                    <p className="text-xs text-muted-foreground">
                      Super-admin sifatida kirasizmi?{' '}
                      <button
                        type="button"
                        onClick={() => navigate('/admin/login')}
                        className="text-primary hover:underline"
                      >
                        /admin/login
                      </button>
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    placeholder="Email kiriting"
                    value={signInData.email}
                    onChange={(e) => setSignInData({ ...signInData, email: e.target.value })}
                    disabled={isSubmitting || loading}
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Parol</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    placeholder="Parol kiriting"
                    value={signInData.password}
                    onChange={(e) => setSignInData({ ...signInData, password: e.target.value })}
                    disabled={isSubmitting || loading}
                    autoComplete="current-password"
                  />
                </div>
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => navigate('/forgot-password')}
                    className="text-sm text-primary hover:underline"
                    disabled={isSubmitting || loading}
                  >
                    Parolni unutdingizmi?
                  </button>
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting || loading}>
                  {isSubmitting || loading ? 'Kirilmoqda...' : 'Kirish'}
                </Button>
                <div className="text-center text-sm text-muted-foreground">
                  Hisobingiz yo'qmi?{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/register')}
                    className="text-primary hover:underline"
                  >
                    Ro'yxatdan o'tish
                  </button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email *</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="Email kiriting"
                    value={signUpData.email}
                    onChange={(e) => setSignUpData({ ...signUpData, email: e.target.value })}
                    disabled={isSubmitting || loading}
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-username">Foydalanuvchi nomi</Label>
                  <Input
                    id="signup-username"
                    type="text"
                    placeholder="Foydalanuvchi nomi tanlang"
                    value={signUpData.username}
                    onChange={(e) => setSignUpData({ ...signUpData, username: e.target.value })}
                    disabled={isSubmitting || loading}
                    autoComplete="username"
                  />
                  <p className="text-xs text-muted-foreground">
                    Ixtiyoriy, lekin tavsiya etiladi
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-fullname">To'liq ism</Label>
                  <Input
                    id="signup-fullname"
                    type="text"
                    placeholder="To'liq ism kiriting"
                    value={signUpData.fullName}
                    onChange={(e) => setSignUpData({ ...signUpData, fullName: e.target.value })}
                    disabled={isSubmitting || loading}
                    autoComplete="name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Parol *</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="Parol yarating"
                    value={signUpData.password}
                    onChange={(e) => setSignUpData({ ...signUpData, password: e.target.value })}
                    disabled={isSubmitting || loading}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-confirm">Parolni tasdiqlash *</Label>
                  <Input
                    id="signup-confirm"
                    type="password"
                    placeholder="Parolni qayta kiriting"
                    value={signUpData.confirmPassword}
                    onChange={(e) => setSignUpData({ ...signUpData, confirmPassword: e.target.value })}
                    disabled={isSubmitting || loading}
                    autoComplete="new-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting || loading}>
                  {isSubmitting || loading ? 'Yaratilmoqda...' : 'Ro\'yxatdan o\'tish'}
                </Button>
                <div className="text-center text-sm text-muted-foreground">
                  Allaqachon hisobingiz bormi?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      const tabs = document.querySelector('[role="tablist"]');
                      const signinTab = tabs?.querySelector('[value="signin"]') as HTMLElement;
                      signinTab?.click();
                    }}
                    className="text-primary hover:underline"
                  >
                    Kirish
                  </button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

    </div>
  );
}
