import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Store } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { signIn, signUp, loading } = useAuth();

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

  const [isSubmitting, setIsSubmitting] = useState(false);

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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(signInData.email)) {
      toast({
        title: 'Xatolik',
        description: 'Noto\'g\'ri email formati',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await signIn(signInData.email, signInData.password);
      toast({
        title: 'Muvaffaqiyatli',
        description: 'Tizimga muvaffaqiyatli kirdingiz',
      });
      // Wait a moment for auth state to update, then navigate
      setTimeout(() => {
        navigate(from, { replace: true });
      }, 100);
    } catch (error) {
      console.error('Sign in error:', error);
      toast({
        title: 'Xatolik',
        description: error instanceof Error ? error.message : 'Kirishda xatolik yuz berdi',
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


  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center">
              <Store className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">POS Tizimi</CardTitle>
          <CardDescription>Savdo nuqtasi boshqaruvi</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Kirish</TabsTrigger>
              <TabsTrigger value="signup">Ro'yxatdan o'tish</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
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
