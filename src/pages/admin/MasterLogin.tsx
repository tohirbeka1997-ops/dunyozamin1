/**
 * Super-admin login (multi-tenant only).
 *
 * This page is SEPARATE from the per-tenant /login form because:
 *   1. The credential set (`master_users`) lives in master.db, not in any
 *      tenant DB, so it has its own login channel (`pos:master:login`).
 *   2. Successful login should land on /admin/stores, not on the POS UI —
 *      master sessions have no tenant and therefore no cashier/manager views.
 *   3. Having a distinct URL keeps audit logs clean and lets ops put extra
 *      rate-limiting / WAF rules in front of /admin/* in production.
 *
 * If `multiTenantMode !== true` we render a 404-style message so a single-tenant
 * install doesn't accidentally hint at an admin surface that doesn't exist.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { ShieldCheck } from 'lucide-react';

export default function MasterLogin() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { masterSignIn, loading, multiTenantMode } = useAuth();

  const [form, setForm] = useState({ username: '', password: '' });
  const [submitting, setSubmitting] = useState(false);

  if (multiTenantMode === false) {
    // Single-tenant deployment — there is no master scope. Show a friendly
    // dead-end rather than a broken login form.
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Mavjud emas</CardTitle>
            <CardDescription>
              Bu server single-tenant rejimda ishlayapti. Super-admin paneli faqat
              multi-tenant o'rnatmada mavjud.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate('/login')}>
              Oddiy kirishga qaytish
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.username || !form.password) {
      toast({ title: 'Xatolik', description: 'Login va parol majburiy', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      await masterSignIn(form.username.trim(), form.password);
      toast({ title: 'Muvaffaqiyatli', description: 'Super-admin sifatida kirdingiz' });
      setTimeout(() => navigate('/admin/stores', { replace: true }), 100);
    } catch (err) {
      toast({
        title: 'Xatolik',
        description: err instanceof Error ? err.message : 'Kirishda xatolik',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center">
              <ShieldCheck className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Super-admin</CardTitle>
          <CardDescription>Barcha do'konlarni boshqarish paneli</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="master-username">Login</Label>
              <Input
                id="master-username"
                type="text"
                placeholder="superadmin"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                disabled={submitting || loading}
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="master-password">Parol</Label>
              <Input
                id="master-password"
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                disabled={submitting || loading}
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting || loading}>
              {submitting || loading ? 'Kirilmoqda…' : 'Kirish'}
            </Button>
            <div className="text-center text-sm text-muted-foreground">
              Oddiy foydalanuvchi sifatida kirasizmi?{' '}
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="text-primary hover:underline"
              >
                /login
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
