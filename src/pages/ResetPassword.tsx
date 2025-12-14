import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import { Store, AlertTriangle, ArrowLeft } from 'lucide-react';

export default function ResetPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasValidSession, setHasValidSession] = useState(false);

  const [formData, setFormData] = useState({
    newPassword: '',
    confirmPassword: '',
  });

  useEffect(() => {
    // Check if there's a valid recovery session from Supabase
    const checkSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Error checking session:', error);
          setHasValidSession(false);
        } else if (session) {
          // Check if this is a recovery session (password reset)
          // Supabase sets a recovery session when user clicks reset link
          setHasValidSession(true);
        } else {
          setHasValidSession(false);
        }
      } catch (error) {
        console.error('Error checking session:', error);
        setHasValidSession(false);
      } finally {
        setCheckingSession(false);
      }
    };

    checkSession();
  }, []);

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

    setLoading(true);
    try {
      // Update password using Supabase Auth
      const { error } = await supabase.auth.updateUser({
        password: formData.newPassword,
      });

      if (error) {
        throw error;
      }

      toast({
        title: t('auth.successful'),
        description: t('auth.reset_password.password_updated'),
      });

      // Sign out and redirect to login
      await supabase.auth.signOut();
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

  const handleRequestNewLink = () => {
    navigate('/forgot-password');
  };

  if (checkingSession) {
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

  if (!hasValidSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <div className="flex justify-center mb-4">
              <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-8 w-8 text-destructive" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold">{t('auth.reset_password.invalid_token')}</CardTitle>
            <CardDescription>{t('auth.reset_password.invalid_token_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t('auth.reset_password.link_expired')}</AlertTitle>
              <AlertDescription>
                {t('auth.reset_password.link_expired_desc')}
              </AlertDescription>
            </Alert>
            <Button
              type="button"
              className="w-full"
              onClick={handleRequestNewLink}
            >
              {t('auth.reset_password.request_new_link')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => navigate('/login')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('common.back_to_login')}
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
                minLength={6}
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



