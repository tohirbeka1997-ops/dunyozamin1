import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { getResetTokenFromStorage } from '@/db/auth-mock';
import { useTranslation } from 'react-i18next';
import { Store } from 'lucide-react';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { resetPasswordWithToken } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    newPassword: '',
    confirmPassword: '',
  });

  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Get token from URL or localStorage
    const urlToken = searchParams.get('token');
    const storedToken = getResetTokenFromStorage();

    if (urlToken) {
      setToken(urlToken);
    } else if (storedToken) {
      setToken(storedToken);
    } else {
      toast({
        title: t('auth.reset_password.invalid_token'),
        description: t('auth.reset_password.invalid_token'),
        variant: 'destructive',
      });
      navigate('/login');
    }
  }, [searchParams, navigate, toast, t]);

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

    if (!token) {
      toast({
        title: t('auth.reset_password.invalid_token'),
        description: t('auth.reset_password.invalid_token'),
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      await resetPasswordWithToken(token, formData.newPassword);
      toast({
        title: t('auth.successful'),
        description: t('auth.reset_password.password_updated'),
      });
      navigate('/login');
    } catch (error) {
      toast({
        title: t('auth.something_went_wrong'),
        description: error instanceof Error ? error.message : t('auth.reset_password.failed_to_update'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

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
              <Label htmlFor="new-password">{t('auth.reset_password.new_password')}</Label>
              <Input
                id="new-password"
                type="password"
                placeholder={t('auth.reset_password.new_password_placeholder')}
                value={formData.newPassword}
                onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                disabled={loading}
                autoComplete="new-password"
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
              {t('common.back')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}


