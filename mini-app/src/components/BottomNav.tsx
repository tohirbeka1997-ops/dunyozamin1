import { NavLink } from 'react-router-dom';

const tabs: { to: string; end?: boolean; label: string; emoji: string; key: string }[] = [
  { key: 'home', to: '/', end: true, label: 'Bosh', emoji: '🏠' },
  { key: 'catalog', to: '/catalog', label: 'Katalog', emoji: '📦' },
  { key: 'favorites', to: '/favorites', label: 'Sevimli', emoji: '❤' },
  { key: 'cart', to: '/cart', label: 'Savat', emoji: '🛒' },
  { key: 'profile', to: '/profile', label: 'Profil', emoji: '👤' },
];

type Props = { cartCount: number; favoritesCount: number };

export function BottomNav({ cartCount, favoritesCount }: Props) {
  return (
    <nav
      className="dz-glass fixed bottom-0 left-0 right-0 z-20 mx-auto flex max-w-lg justify-around border-t border-white/35 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_28px_rgba(66,71,125,0.14)]"
      aria-label="Asosiy menyu"
    >
      {tabs.map(({ key, to, end, label, emoji }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `relative flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-1 text-[10px] font-medium leading-tight transition-colors ${
              isActive
                ? 'text-[var(--dz-accent)]'
                : 'text-[var(--dz-soft)] hover:text-[var(--dz-muted)]'
            }`
          }
        >
          <span className="relative text-[1.35rem] leading-none" aria-hidden>
            {emoji}
            {to === '/cart' && cartCount > 0 ? (
              <span className="absolute -right-1.5 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[var(--dz-accent)] px-0.5 text-[10px] font-semibold text-[var(--dz-accent-text)]">
                {cartCount > 99 ? '99+' : cartCount}
              </span>
            ) : null}
            {key === 'favorites' && favoritesCount > 0 ? (
              <span className="absolute -right-1.5 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-pink-500 px-0.5 text-[10px] font-semibold text-white">
                {favoritesCount > 99 ? '99+' : favoritesCount}
              </span>
            ) : null}
          </span>
          <span className="truncate">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
