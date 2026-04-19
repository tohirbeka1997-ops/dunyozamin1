import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';
import { Store, AlertTriangle, ArrowLeft } from 'lucide-react';
import { confirmPasswordReset } from '@/db/api';

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [tokenId, setTokenId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    code: '',
    newPassword: '',
    confirmPassword: '',
  });

  useEffect(() => {
    // Get token_id from route state or query param
    const stateTokenId = (location.state as any)?.token_id;
    const queryParams = new URLSearchParams(location.search);
    const queryTokenId = queryParams.get('token_id');
    
    const token = stateTokenId || queryTokenId;
    
    if (token) {
      setTokenId(token);
    } else {
      // No token provided, redirect to forgot password
      toast({
        title: 'Invalid reset link',
        description: 'Please request a new password reset code',
        variant: 'destructive',
      });
      navigate('/forgot-password');
    }
  }, [location, navigate, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.newPassword || !formData.confirmPassword) {
      toast({
        title: t('auth.required_field'),
        description: t('auth.fill_all_fields'),
        variant: 'destructive',
      });
      return;
    }

    if (formData.newPassword.length < 6) {
      toast({
        title: t('auth.required_field'),
        description: t('auth.min_6_characters'),
        variant: 'destructive',
      });
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      toast({
        title: t('auth.required_field'),
        description: t('auth.passwords_no_match'),
        variant: 'destructive',
      });
      return;
    }

    if (!tokenId) {
      toast({
        title: 'Xatolik',
        description: 'Tiklash tokeni topilmadi. Iltimos, yangi kod so‘rang.',
        variant: 'destructive',
      });
      navigate('/forgot-password');
      return;
    }

    setLoading(true);
    try {
      await confirmPasswordReset({
        token_id: tokenId,
        code: formData.code.trim(),
        new_password: formData.newPassword,
      });
      
      toast({
        title: t('auth.successful'),
        description: t('auth.reset_password.password_updated'),
      });
      navigate('/login');
    } catch (error: any) {
      toast({
        title: t('auth.something_went_wrong'),
        description: error?.message || error?.error?.message || t('auth.reset_password.failed_to_update'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!tokenId) {
    // Show loading while checking for token
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
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
          <CardTitle className="text-2xl font-bold">{t('auth.reset_password.title')}</CardTitle>
          <CardDescription>{t('auth.point_of_sale_management')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Tiklash kodi</Label>
              <Input
                id="code"
                type="text"
                placeholder="6 xonali tiklash kodini kiriting"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                disabled={loading}
                autoComplete="off"
                maxLength={6}
                className="text-center text-2xl font-mono tracking-widest"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">{t('auth.reset_password.new_password')}</Label>
              <Input
                id="new-password"
                type="password"
                placeholder={t('auth.reset_password.new_password_placeholder')}
                value={formData.newPassword}
                onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                disabled={loading}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-new-password">{t('auth.reset_password.confirm_new_password')}</Label>
              <Input
                id="confirm-new-password"
                type="password"
                placeholder={t('auth.reset_password.confirm_new_password_placeholder')}
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                disabled={loading}
                autoComplete="new-password"
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.reset_password.updating') : t('auth.reset_password.update_password')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => navigate('/login')}
              disabled={loading}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('common.back')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}



