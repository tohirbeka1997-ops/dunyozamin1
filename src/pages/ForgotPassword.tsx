import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Store, ArrowLeft, CheckCircle2, Copy, MailX } from 'lucide-react';
import { requestPasswordReset } from '@/db/api';

function readInitialTenant(): string {
  try {
    const api = (window as any).posApi;
    return api?._session?.getTenantSlug?.() || api?._session?.extractTenantSlugFromHost?.() || '';
  } catch {
    return '';
  }
}

export default function ForgotPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { multiTenantMode } = useAuth();
  const [loading, setLoading] = useState(false);
  const [tenant, setTenant] = useState(readInitialTenant);
  const [identifier, setIdentifier] = useState('');
  const [resetData, setResetData] = useState<{ token_id: string; code: string; expires_at: string } | null>(null);

  useEffect(() => {
    if (multiTenantMode === true && !tenant) {
      const next = readInitialTenant();
      if (next) setTenant(next);
    }
  }, [multiTenantMode, tenant]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!identifier || !identifier.trim()) {
      toast({
        title: t('auth.required_field'),
        description: 'Login, email yoki telefon raqam kiritilishi shart',
        variant: 'destructive',
      });
      return;
    }

    const trimmedTenant = tenant.trim().toLowerCase();
    if (multiTenantMode === true) {
      if (!trimmedTenant) {
        toast({
          title: t('auth.required_field'),
          description: 'Do\'kon (tenant) kodini kiriting',
          variant: 'destructive',
        });
        return;
      }
      if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(trimmedTenant)) {
        toast({
          title: t('auth.required_field'),
          description: 'Do\'kon kodi: faqat a-z, 0-9, "-", "_" (2..40 belgi)',
          variant: 'destructive',
        });
        return;
      }
    }

    setLoading(true);
    try {
      const result = await requestPasswordReset(identifier.trim(), trimmedTenant || null);
      if (!result?.code || !String(result.code).trim()) {
        throw new Error('Tiklash kodi qaytarilmadi. Server yangilanganmi? pos-rpc xizmatini qayta ishga tushiring.');
      }
      setResetData(result);
      toast({
        title: 'Kod yaratildi',
        description: 'Kod ekranda ko\'rsatiladi — email yuborilmaydi',
      });
    } catch (error: any) {
      toast({
        title: t('auth.something_went_wrong'),
        description: error?.message || error?.error?.message || 'Parolni tiklash kodini so\'rab bo\'lmadi',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (resetData?.code) {
      navigator.clipboard.writeText(resetData.code);
      toast({
        title: 'Nusxalandi',
        description: 'Kod clipboard\'ga nusxalandi',
      });
    }
  };

  const handleContinueToReset = () => {
    if (resetData) {
      navigate('/reset-password', {
        state: { token_id: resetData.token_id, tenant: tenant.trim().toLowerCase() || null },
      });
    }
  };

  if (resetData) {
    const expiresAt = new Date(resetData.expires_at);
    const minutesRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 60000));

    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <div className="flex justify-center mb-4">
              <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold">Tiklash kodi yaratildi</CardTitle>
            <CardDescription>Quyidagi kodni nusxalab, yangi parol o&apos;rnating</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <MailX className="h-4 w-4" />
              <AlertDescription>
                Email yoki SMS yuborilmaydi — kod faqat shu ekranda ko&apos;rsatiladi.
                Google/Gmail orqali kirish hozircha qo&apos;llab-quvvatlanmaydi.
              </AlertDescription>
            </Alert>
            <Alert>
              <AlertDescription>
                Tiklash kodi {minutesRemaining} daqiqadan so&apos;ng eskiradi
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label>Tiklash kodi</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={resetData.code}
                  readOnly
                  className="text-2xl font-mono text-center tracking-widest"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyCode}
                  title="Kodni nusxalash"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>1. Yuqoridagi tiklash kodini nusxalang</p>
              <p>2. &quot;Parolni tiklashga o&apos;tish&quot; tugmasini bosing</p>
              <p>3. Kodni va yangi parolni kiriting</p>
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={handleContinueToReset}
            >
              Parolni tiklashga o&apos;tish
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => navigate('/login')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('common.back_to_login')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setResetData(null);
                setIdentifier('');
              }}
            >
              Boshqa kod so&apos;rash
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center">
              <Store className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">{t('auth.forgot_password_dialog.title')}</CardTitle>
          <CardDescription>
            Login, email yoki telefon raqamingizni kiriting. Kod ekranda ko&apos;rsatiladi (email yuborilmaydi).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {multiTenantMode === true && (
              <div className="space-y-2">
                <Label htmlFor="tenant">Do&apos;kon (tenant)</Label>
                <Input
                  id="tenant"
                  type="text"
                  placeholder="masalan: default, myshop"
                  value={tenant}
                  onChange={(e) => setTenant(e.target.value.toLowerCase())}
                  disabled={loading}
                  autoComplete="organization"
                  pattern="[a-z0-9][a-z0-9_\\-]{1,39}"
                  title="faqat a-z, 0-9, - va _ (2..40 belgi)"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="identifier">Login, email yoki telefon</Label>
              <Input
                id="identifier"
                type="text"
                placeholder="Login, email yoki telefon raqam"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={loading}
                autoComplete="username"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Kod yaratilmoqda...' : 'Tiklash kodini yaratish'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => navigate('/login')}
              disabled={loading}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('common.back_to_login')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
