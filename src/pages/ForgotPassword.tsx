import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';
import { Store, ArrowLeft, CheckCircle2, Copy } from 'lucide-react';
import { requestPasswordReset } from '@/db/api';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [identifier, setIdentifier] = useState(''); // Username or phone
  const [resetData, setResetData] = useState<{ token_id: string; code: string; expires_at: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!identifier || !identifier.trim()) {
      toast({
        title: t('auth.required_field'),
        description: 'Login yoki telefon raqam kiritilishi shart',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const result = await requestPasswordReset(identifier.trim());
      setResetData(result);
      toast({
        title: 'Kod yaratildi',
        description: 'Kodni nusxalab, parolni tiklashga o‘ting',
      });
    } catch (error: any) {
      toast({
        title: t('auth.something_went_wrong'),
        description: error?.message || error?.error?.message || 'Parolni tiklash kodini so‘rab bo‘lmadi',
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
        description: 'Kod clipboard’ga nusxalandi',
      });
    }
  };

  const handleContinueToReset = () => {
    if (resetData) {
      navigate('/reset-password', { state: { token_id: resetData.token_id } });
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
            <CardDescription>Quyidagi kodni nusxalab, parolni tiklashga o‘ting</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription>
                Tiklash kodi {minutesRemaining} daqiqadan so‘ng eskiradi
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
              <p>2. Pastdagi “Parolni tiklashga o‘tish” tugmasini bosing</p>
              <p>3. Kodni va yangi parolni kiriting</p>
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={handleContinueToReset}
            >
              Parolni tiklashga o‘tish
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
              Request Another Code
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
          <CardTitle className="text-2xl font-bold">{t('auth.forgot_password_form.title')}</CardTitle>
          <CardDescription>Enter your username or phone number to receive a reset code</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">Login yoki telefon raqam</Label>
              <Input
                id="identifier"
                type="text"
                placeholder="Login yoki telefon raqam kiriting"
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

