import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { clearRemoteSessionForLogin, isRemoteRpcMode } from '@/lib/remotePosApi';
import { handleIpcResponse } from '@/utils/electron';
import { loadRememberedLogin, saveRememberedLogin } from '@/lib/auth/rememberLogin';
import { setRememberMeEnabled } from '@/lib/auth/sessionPersistence';
import {
  detectAppEntryMode,
  loadPreferredEntryMode,
  savePreferredEntryMode,
  switchAppEntry,
  type AppEntryMode,
} from '@/lib/appEntry';
import { cn } from '@/lib/utils';
import { Monitor, ShoppingCart, Store } from 'lucide-react';

type TenantBranding = {
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
};

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { signIn, signInWithGoogle, signUp, loading, multiTenantMode } = useAuth();

  const redirectFrom = (location.state as { from?: { pathname?: string } })?.from?.pathname;

  const googleBtnRef = useRef<HTMLDivElement | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const [entryMode, setEntryMode] = useState<AppEntryMode>(() => {
    return loadPreferredEntryMode() ?? detectAppEntryMode();
  });

  const resolvePostLoginRoute = (mode: AppEntryMode): string => {
    if (mode === 'kassa') return '/pos';
    if (redirectFrom && redirectFrom !== '/login' && redirectFrom !== '/pos') return redirectFrom;
    return '/';
  };

  const completeLoginNavigation = (mode: AppEntryMode) => {
    savePreferredEntryMode(mode);
    const target = resolvePostLoginRoute(mode);
    if (mode === detectAppEntryMode()) {
      navigate(target, { replace: true });
      return;
    }
    switchAppEntry(mode, target);
  };

  // Auto-prefill tenant slug from subdomain (e.g. acme.pos.example.com → "acme").
  // Falls back to whatever is already stored from a previous session. Users
  // on apex / single-tenant installs see no field at all (see below).
  const [signInData, setSignInData] = useState(() => {
    const remembered = loadRememberedLogin();
    let tenant = remembered.enabled ? remembered.tenant : '';
    try {
      const api = (window as any).posApi;
      if (!tenant) {
        tenant = api?._session?.getTenantSlug?.() || '';
      }
      if (!tenant && api?._session?.extractTenantSlugFromHost) {
        tenant = api._session.extractTenantSlugFromHost() || '';
      }
    } catch { /* ignore */ }
    return {
      tenant,
      email: remembered.enabled ? remembered.identifier : '',
      password: '',
    };
  });

  const [rememberLogin, setRememberLogin] = useState(() => loadRememberedLogin().enabled);

  const [signUpData, setSignUpData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    fullName: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // Must sit AFTER the state it mirrors — otherwise TDZ ("Cannot access 'P'
  // before initialization") crashes Login/POS in production minified builds.
  const googleCtxRef = useRef({
    multiTenantMode,
    rememberLogin,
    entryMode,
    tenant: signInData.tenant,
    email: signInData.email,
    loading,
    isSubmitting,
  });
  googleCtxRef.current = {
    multiTenantMode,
    rememberLogin,
    entryMode,
    tenant: signInData.tenant,
    email: signInData.email,
    loading,
    isSubmitting,
  };

  // Web: drop any stale session before login RPC runs (prevents 401 on auth.me
  // and accidental redirect to /pos with an expired token).
  useEffect(() => {
    if (!isRemoteRpcMode()) return;
    clearRemoteSessionForLogin();
  }, []);

  // Google Sign-In: load GIS once when server has GOOGLE_CLIENT_ID.
  useEffect(() => {
    let cancelled = false;

    const finishGoogleLogin = async (idToken: string) => {
      const ctx = googleCtxRef.current;
      if (submittingRef.current || ctx.isSubmitting || ctx.loading) return;
      const trimmedTenant = String(ctx.tenant || '').trim().toLowerCase();
      if (ctx.multiTenantMode === true) {
        if (!trimmedTenant || !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(trimmedTenant)) {
          toast({
            title: 'Xatolik',
            description: 'Google bilan kirishdan oldin do\'kon (tenant) kodini kiriting',
            variant: 'destructive',
          });
          return;
        }
      }
      submittingRef.current = true;
      setIsSubmitting(true);
      try {
        setRememberMeEnabled(ctx.rememberLogin);
        await signInWithGoogle(idToken, trimmedTenant || null);
        saveRememberedLogin(ctx.rememberLogin, ctx.email || 'google', trimmedTenant || null);
        toast({ title: 'Muvaffaqiyatli', description: 'Google orqali kirdingiz' });
        completeLoginNavigation(ctx.entryMode);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Google kirishda xatolik';
        toast({ title: 'Xatolik', description: errorMessage, variant: 'destructive' });
      } finally {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    };

    (async () => {
      try {
        const api = (window as any).posApi;
        if (!api?.auth?.googleConfig) return;
        const cfg = await handleIpcResponse<{ enabled?: boolean; client_id?: string | null }>(
          api.auth.googleConfig(),
        );
        const clientId = cfg?.enabled && cfg?.client_id ? String(cfg.client_id).trim() : '';
        if (!clientId || cancelled) return;

        await new Promise<void>((resolve, reject) => {
          if ((window as any).google?.accounts?.id) {
            resolve();
            return;
          }
          const existing = document.querySelector(
            'script[src="https://accounts.google.com/gsi/client"]',
          ) as HTMLScriptElement | null;
          if (existing) {
            // Script already present but may still be loading (or already failed).
            if ((window as any).google?.accounts?.id) {
              resolve();
              return;
            }
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('Google script yuklanmadi')), {
              once: true,
            });
            return;
          }
          const scriptEl = document.createElement('script');
          scriptEl.src = 'https://accounts.google.com/gsi/client';
          scriptEl.async = true;
          scriptEl.onload = () => resolve();
          scriptEl.onerror = () => reject(new Error('Google script yuklanmadi'));
          document.head.appendChild(scriptEl);
        });

        if (cancelled) return;
        const googleId = (window as any).google?.accounts?.id;
        if (!googleId || !googleBtnRef.current) return;
        try {
          googleId.initialize({
            client_id: clientId,
            callback: (resp: { credential?: string }) => {
              const token = resp?.credential;
              if (token) void finishGoogleLogin(token);
            },
            auto_select: false,
            cancel_on_tap_outside: true,
          });
          googleBtnRef.current.innerHTML = '';
          googleId.renderButton(googleBtnRef.current, {
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            shape: 'rectangular',
            width: 320,
            locale: 'uz',
          });
        } catch (gisErr) {
          console.warn('[Login] Google GIS render failed:', gisErr);
          if (!cancelled) setGoogleEnabled(false);
          return;
        }
        if (!cancelled) setGoogleEnabled(true);
      } catch (err) {
        console.warn('[Login] Google config unavailable:', err);
        if (!cancelled) setGoogleEnabled(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    if (submittingRef.current || isSubmitting || loading) {
      return;
    }

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

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      console.log('🔐 Login attempt:', { identifier: trimmedId, tenant: trimmedTenant || undefined });
      // Set the remember-me intent BEFORE signing in so the session token +
      // cached profile are written to the correct store (localStorage when
      // remembered → survives new tabs / restart; sessionStorage otherwise →
      // survives same-tab F5 only).
      setRememberMeEnabled(rememberLogin);
      await signIn(trimmedId, signInData.password, trimmedTenant || null);
      saveRememberedLogin(rememberLogin, trimmedId, trimmedTenant || null);
      console.log('✅ Login successful');
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Tizimga muvaffaqiyatli kirdingiz',
      });
      completeLoginNavigation(entryMode);
    } catch (error) {
      console.error('❌ Sign in error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Kirishda xatolik yuz berdi';
      toast({
        title: 'Xatolik',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      submittingRef.current = false;
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
      await signUp(signUpData.email, signUpData.password, {
        fullName: signUpData.fullName || undefined,
        username: signUpData.username || undefined,
      });
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Hisob yaratildi va tizimga kirildi',
      });
      completeLoginNavigation(entryMode);
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
          <div className="mb-6 space-y-2">
            <p className="text-center text-sm font-medium text-muted-foreground">
              Qaysi dasturga kirasiz?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEntryMode('full')}
                disabled={isSubmitting || loading}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border-2 p-3 text-left transition-colors',
                  entryMode === 'full'
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/40 hover:bg-muted/50',
                )}
              >
                <Monitor
                  className={cn('h-6 w-6', entryMode === 'full' ? 'text-primary' : 'text-muted-foreground')}
                />
                <span className="text-sm font-semibold leading-tight">POS dastur</span>
                <span className="text-center text-xs text-muted-foreground leading-snug">To&apos;liq tizim</span>
              </button>
              <button
                type="button"
                onClick={() => setEntryMode('kassa')}
                disabled={isSubmitting || loading}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border-2 p-3 text-left transition-colors',
                  entryMode === 'kassa'
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/40 hover:bg-muted/50',
                )}
              >
                <ShoppingCart
                  className={cn('h-6 w-6', entryMode === 'kassa' ? 'text-primary' : 'text-muted-foreground')}
                />
                <span className="text-sm font-semibold leading-tight">Kassa</span>
                <span className="text-center text-xs text-muted-foreground leading-snug">Yengil rejim</span>
              </button>
            </div>
          </div>
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
                  <Label htmlFor="signin-email">Email yoki login</Label>
                  <Input
                    id="signin-email"
                    type="text"
                    placeholder="Email yoki foydalanuvchi nomi"
                    value={signInData.email}
                    onChange={(e) => setSignInData({ ...signInData, email: e.target.value })}
                    disabled={isSubmitting || loading}
                    autoComplete="username"
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
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="signin-remember"
                      checked={rememberLogin}
                      onCheckedChange={(checked) => setRememberLogin(checked === true)}
                      disabled={isSubmitting || loading}
                    />
                    <Label
                      htmlFor="signin-remember"
                      className="text-sm font-normal cursor-pointer leading-none"
                    >
                      Meni eslab qol
                    </Label>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/forgot-password')}
                    className="text-sm text-primary hover:underline shrink-0"
                    disabled={isSubmitting || loading}
                  >
                    Parolni unutdingizmi?
                  </button>
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting || loading}>
                  {isSubmitting || loading ? 'Kirilmoqda...' : 'Kirish'}
                </Button>
                <div
                  className={cn('space-y-3', googleEnabled ? '' : 'hidden')}
                  aria-hidden={!googleEnabled}
                >
                  <div className="relative py-1">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">yoki</span>
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <div ref={googleBtnRef} />
                  </div>
                  <p className="text-xs text-center text-muted-foreground">
                    Google hisobidagi email POS foydalanuvchisiga mos kelishi kerak
                  </p>
                </div>
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
