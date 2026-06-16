import { NavLink, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Boshqaruv paneli', icon: '📊', end: true },
  { to: '/orders', label: 'Buyurtmalar', icon: '🧾' },
  { to: '/products', label: 'Mahsulotlar', icon: '📦' },
  { to: '/promotions', label: 'Aksiyalar', icon: '🎯' },
  { to: '/customers', label: 'Mijozlar', icon: '👥' },
];

export default function Layout({ children, title }: { children: ReactNode; title: string }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  async function onLogout() {
    await logout();
    nav('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-brand-primary px-3 py-5 text-white md:flex">
        <div className="px-3 pb-6">
          <div className="text-lg font-bold">Dunyozamin</div>
          <div className="text-xs text-white/60">Admin panel</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={onLogout}
          className="mt-4 rounded-xl px-3 py-2.5 text-left text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          ⎋ Chiqish
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-black/5 bg-white px-5 py-3.5">
          <h1 className="text-lg font-bold text-brand-primary">{title}</h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">{user?.full_name || user?.username}</span>
            <span className="rounded-full bg-brand-teal/10 px-2.5 py-1 text-xs font-semibold text-brand-teal">
              {user?.role}
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-5">{children}</main>
      </div>
    </div>
  );
}
