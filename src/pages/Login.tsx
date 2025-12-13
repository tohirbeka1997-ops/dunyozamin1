import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { Store } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { login, signUp, resetPassword } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);

  // Get redirect path from location state or default to /
  const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/';

  const [signInData, setSignInData] = useState({
    email: '',
    password: '',
  });

  const [signUpData, setSignUpData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    fullName: '',
  });

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!signInData.email || !signInData.password) {
      toast({
        title: t('auth.required_field'),
        description: t('auth.fill_all_fields'),
        variant: 'destructive',
      });
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(signInData.email)) {
      toast({
        title: t('auth.required_field'),
        description: t('auth.invalid_email_format'),
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      await login(signInData.email, signInData.password);
      toast({
        title: t('auth.successful'),
        description: t('auth.signed_in_success'),
      });
      navigate(from, { replace: true });
    } catch (error) {
      toast({
        title: t('auth.something_went_wrong'),
        description: error instanceof Error ? error.message : t('auth.failed_to_sign_in'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!signUpData.email || !signUpData.password || !signUpData.confirmPassword) {
      toast({
        title: t('auth.required_field'),
        description: t('auth.fill_required_fields'),
        variant: 'destructive',
      });
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(signUpData.email)) {
      toast({
        title: t('auth.required_field'),
        description: t('auth.invalid_email_format'),
        variant: 'destructive',
      });
      return;
    }

    if (signUpData.password !== signUpData.confirmPassword) {
      toast({
        title: t('auth.required_field'),
        description: t('auth.passwords_no_match'),
        variant: 'destructive',
      });
      return;
    }

    if (signUpData.password.length < 6) {
      toast({
        title: t('auth.required_field'),
        description: t('auth.min_6_characters'),
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      await signUp(
        signUpData.email,
        signUpData.password,
        signUpData.fullName || undefined,
        signUpData.username || undefined
      );
      toast({
        title: t('auth.successful'),
        description: t('auth.account_created_success'),
      });
      navigate(from, { replace: true });
    } catch (error) {
      toast({
        title: t('auth.something_went_wrong'),
        description: error instanceof Error ? error.message : t('auth.failed_to_create_account'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!forgotPasswordEmail) {
      toast({
        title: t('auth.required_field'),
        description: t('auth.enter_email'),
        variant: 'destructive',
      });
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(forgotPasswordEmail)) {
      toast({
        title: t('auth.required_field'),
        description: t('auth.invalid_email_format'),
        variant: 'destructive',
      });
      return;
    }

    setForgotPasswordLoading(true);
    try {
      await resetPassword(forgotPasswordEmail);
      toast({
        title: t('auth.successful'),
        description: t('auth.forgot_password_dialog.reset_link_sent'),
      });
      setForgotPasswordOpen(false);
      setForgotPasswordEmail('');
    } catch (error) {
      toast({
        title: t('auth.something_went_wrong'),
        description: error instanceof Error ? error.message : t('auth.forgot_password_dialog.email_not_found'),
        variant: 'destructive',
      });
    } finally {
      setForgotPasswordLoading(false);
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
          <CardTitle className="text-2xl font-bold">{t('auth.pos_system')}</CardTitle>
          <CardDescription>{t('auth.point_of_sale_management')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">{t('auth.sign_in')}</TabsTrigger>
              <TabsTrigger value="signup">{t('auth.sign_up')}</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">{t('auth.email')}</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    placeholder={t('auth.enter_email')}
                    value={signInData.email}
                    onChange={(e) => setSignInData({ ...signInData, email: e.target.value })}
                    disabled={loading}
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">{t('auth.password')}</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    placeholder={t('auth.enter_password')}
                    value={signInData.password}
                    onChange={(e) => setSignInData({ ...signInData, password: e.target.value })}
                    disabled={loading}
                    autoComplete="current-password"
                  />
                </div>
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setForgotPasswordOpen(true)}
                    className="text-sm text-primary hover:underline"
                  >
                    {t('auth.forgot_password')}
                  </button>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? t('auth.signing_in') : t('auth.sign_in')}
                </Button>
                <div className="text-center text-sm text-muted-foreground">
                  {t('auth.dont_have_account')}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      const tabs = document.querySelector('[role="tablist"]');
                      const signupTab = tabs?.querySelector('[value="signup"]') as HTMLElement;
                      signupTab?.click();
                    }}
                    className="text-primary hover:underline"
                  >
                    {t('auth.create_account')}
                  </button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-email">{t('auth.email')} *</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder={t('auth.enter_email')}
                    value={signUpData.email}
                    onChange={(e) => setSignUpData({ ...signUpData, email: e.target.value })}
                    disabled={loading}
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-username">{t('auth.username')}</Label>
                  <Input
                    id="signup-username"
                    type="text"
                    placeholder={t('auth.choose_username')}
                    value={signUpData.username}
                    onChange={(e) => setSignUpData({ ...signUpData, username: e.target.value })}
                    disabled={loading}
                    autoComplete="username"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('auth.username_helper')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-fullname">{t('auth.full_name')}</Label>
                  <Input
                    id="signup-fullname"
                    type="text"
                    placeholder={t('auth.enter_full_name')}
                    value={signUpData.fullName}
                    onChange={(e) => setSignUpData({ ...signUpData, fullName: e.target.value })}
                    disabled={loading}
                    autoComplete="name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">{t('auth.password')} *</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder={t('auth.create_password')}
                    value={signUpData.password}
                    onChange={(e) => setSignUpData({ ...signUpData, password: e.target.value })}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-confirm">{t('auth.confirm_password')} *</Label>
                  <Input
                    id="signup-confirm"
                    type="password"
                    placeholder={t('auth.confirm_password_placeholder')}
                    value={signUpData.confirmPassword}
                    onChange={(e) => setSignUpData({ ...signUpData, confirmPassword: e.target.value })}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? t('auth.creating_account') : t('auth.sign_up')}
                </Button>
                <div className="text-center text-sm text-muted-foreground">
                  {t('auth.already_have_account')}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      const tabs = document.querySelector('[role="tablist"]');
                      const signinTab = tabs?.querySelector('[value="signin"]') as HTMLElement;
                      signinTab?.click();
                    }}
                    className="text-primary hover:underline"
                  >
                    {t('auth.go_to_login')}
                  </button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Forgot Password Dialog */}
      <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('auth.forgot_password_dialog.title')}</DialogTitle>
            <DialogDescription>
              {t('auth.forgot_password_dialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-password-email">{t('auth.forgot_password_dialog.email_label')}</Label>
              <Input
                id="forgot-password-email"
                type="email"
                placeholder={t('auth.forgot_password_dialog.email_placeholder')}
                value={forgotPasswordEmail}
                onChange={(e) => setForgotPasswordEmail(e.target.value)}
                disabled={forgotPasswordLoading}
                autoComplete="email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForgotPasswordOpen(false);
                setForgotPasswordEmail('');
              }}
              disabled={forgotPasswordLoading}
            >
              {t('auth.forgot_password_dialog.cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleForgotPassword}
              disabled={forgotPasswordLoading}
            >
              {forgotPasswordLoading
                ? t('auth.forgot_password_dialog.sending')
                : t('auth.forgot_password_dialog.send_reset_link')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
