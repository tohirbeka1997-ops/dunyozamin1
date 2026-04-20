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
      className="fixed bottom-0 left-0 right-0 z-20 mx-auto flex max-w-lg justify-around border-t border-black/[0.08] bg-[var(--tg-theme-bg-color,#fff)]/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur-md supports-[backdrop-filter]:bg-[var(--tg-theme-bg-color,#fff)]/80"
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
                ? 'text-[var(--tg-theme-button-color,#2481cc)]'
                : 'text-black/50 hover:text-black/70'
            }`
          }
        >
          <span className="relative text-[1.35rem] leading-none" aria-hidden>
            {emoji}
            {to === '/cart' && cartCount > 0 ? (
              <span className="absolute -right-1.5 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[var(--tg-theme-button-color,#2481cc)] px-0.5 text-[10px] font-semibold text-[var(--tg-theme-button-text-color,#fff)]">
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
