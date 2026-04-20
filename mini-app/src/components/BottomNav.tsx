import { NavLink } from 'react-router-dom';

const tabs: { to: string; end?: boolean; label: string; emoji: string }[] = [
  { to: '/', end: true, label: 'Bosh', emoji: '🏠' },
  { to: '/catalog', label: 'Katalog', emoji: '📦' },
  { to: '/cart', label: 'Savat', emoji: '🛒' },
  { to: '/orders', label: 'Buyurtmalar', emoji: '📋' },
];

type Props = { cartCount: number };

export function BottomNav({ cartCount }: Props) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-20 mx-auto flex max-w-lg justify-around border-t bg-[var(--dz-bg)]/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_24px_rgba(15,23,42,0.08)] backdrop-blur-md supports-[backdrop-filter]:bg-[var(--dz-bg)]/85"
      aria-label="Asosiy menyu"
    >
      {tabs.map(({ to, end, label, emoji }) => (
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
          </span>
          <span className="truncate">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
