import { NavLink } from 'react-router-dom';
import { haptic } from '../lib/telegram';
import { t, useLang, type StringKey } from '../lib/i18n';

const tabs: { to: string; end?: boolean; labelKey: StringKey; icon: string; key: string }[] = [
  { key: 'home', to: '/', end: true, labelKey: 'nav.home', icon: '🏠' },
  { key: 'catalog', to: '/catalog', labelKey: 'nav.catalog', icon: '🧺' },
  { key: 'favorites', to: '/favorites', labelKey: 'nav.favorites', icon: '♥' },
  { key: 'cart', to: '/cart', labelKey: 'nav.cart', icon: '🛒' },
  { key: 'profile', to: '/profile', labelKey: 'nav.profile', icon: '👤' },
];

type Props = { cartCount: number; favoritesCount: number };

export function BottomNav({ cartCount, favoritesCount }: Props) {
  useLang();
  return (
    <nav
      className="dz-glass fixed bottom-0 left-0 right-0 z-20 mx-auto flex max-w-lg justify-around pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5"
      aria-label="Asosiy menyu"
    >
      {tabs.map(({ key, to, end, labelKey, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => haptic.selection()}
          className={({ isActive }) =>
            `group relative flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5 px-1 pb-1 pt-1 text-[10px] font-semibold leading-tight transition-colors ${
              isActive
                ? 'text-[var(--brand-primary)]'
                : 'text-[var(--dz-soft)] hover:text-[var(--brand-teal)]'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={`relative flex h-9 w-9 items-center justify-center rounded-2xl text-[1.05rem] leading-none transition ${
                  isActive
                    ? 'dz-brand-bg text-white'
                    : 'bg-transparent text-[var(--dz-muted)]'
                }`}
                aria-hidden
              >
                {icon}
                {to === '/cart' && cartCount > 0 ? (
                  <span className="absolute -right-1 -top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[var(--brand-teal)] px-1 text-[9.5px] font-bold text-white shadow-[var(--dz-glow-teal)]">
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                ) : null}
                {key === 'favorites' && favoritesCount > 0 ? (
                  <span className="absolute -right-1 -top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[var(--brand-accent)] px-1 text-[9.5px] font-bold text-[var(--brand-primary)]">
                    {favoritesCount > 99 ? '99+' : favoritesCount}
                  </span>
                ) : null}
              </span>
              <span className="truncate">{t(labelKey)}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
