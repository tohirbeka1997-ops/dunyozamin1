import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

export default function LoginPage() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tenant, setTenant] = useState('default');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) {
    nav('/', { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password, tenant.trim() || 'default');
      nav('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Server bilan bog‘lanishda xatolik');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-primary px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-2xl"
      >
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold text-brand-primary">Dunyozamin</div>
          <div className="text-sm text-gray-400">Admin panelga kirish</div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-600">{error}</div>
        )}

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Foydalanuvchi nomi</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/20"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Parol</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/20"
          />
        </label>

        <label className="mb-5 block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Do'kon (tenant)</span>
          <input
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            placeholder="default"
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/20"
          />
          <span className="mt-1 block text-[11px] text-gray-400">
            Bu yerga loginingizni emas, do‘kon bazasi nomini yozing. Odatda: <b>default</b>.
          </span>
        </label>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-brand-primary py-3 text-sm font-semibold text-white transition hover:bg-brand-teal disabled:opacity-50"
        >
          {busy ? 'Kirilmoqda…' : 'Kirish'}
        </button>
      </form>
    </div>
  );
}
