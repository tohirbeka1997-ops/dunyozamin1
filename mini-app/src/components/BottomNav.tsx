import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { haptic } from '../lib/telegram';
import { t, useLang, type StringKey } from '../lib/i18n';

const ICONS: Record<string, ReactNode> = {
  home: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  catalog: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  favorites: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  ),
  cart: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="21" r="1.5" />
      <circle cx="19" cy="21" r="1.5" />
      <path d="M2 2h3l2.6 13.4a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L23 6H6" />
    </svg>
  ),
  profile: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  ),
};

const tabs: { to: string; end?: boolean; labelKey: StringKey; key: string }[] = [
  { key: 'home', to: '/', end: true, labelKey: 'nav.home' },
  { key: 'catalog', to: '/catalog', labelKey: 'nav.catalog' },
  { key: 'favorites', to: '/favorites', labelKey: 'nav.favorites' },
  { key: 'cart', to: '/cart', labelKey: 'nav.cart' },
  { key: 'profile', to: '/profile', labelKey: 'nav.profile' },
];

type Props = { cartCount: number; favoritesCount: number };

export function BottomNav({ cartCount, favoritesCount }: Props) {
  useLang();
  return (
    <nav
      className="dz-tabbar fixed bottom-0 left-0 right-0 z-20 mx-auto flex max-w-[400px] justify-around px-1.5 pt-2 pb-[max(0.7rem,env(safe-area-inset-bottom))]"
      aria-label="Asosiy menyu"
    >
      {tabs.map(({ key, to, end, labelKey }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => haptic.selection()}
          className={({ isActive }) =>
            `group relative flex min-w-0 flex-1 flex-col items-center justify-end gap-1 px-1 text-[9.5px] font-semibold leading-tight tracking-tight transition-colors ${
              isActive ? 'text-[var(--brand-deep)]' : 'text-[var(--muted)] hover:text-[var(--brand-deep)]'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive ? (
                <span className="dz-tab-ind absolute -top-2 h-[3px] w-6 rounded-full" aria-hidden />
              ) : null}
              <span className="relative flex h-[23px] w-[23px] items-center justify-center" aria-hidden>
                {ICONS[key]}
                {to === '/cart' && cartCount > 0 ? (
                  <span className="dz-pulse-dot absolute -top-[3px] left-1/2 ml-[3px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--amber)] px-1 text-[8.5px] font-extrabold text-white shadow-[0_0_0_2px_var(--dz-surface)]">
                    {cartCount > 99 ? '99+' : cartCount}
                  </span>
                ) : null}
                {key === 'favorites' && favoritesCount > 0 ? (
                  <span className="absolute -top-[3px] left-1/2 ml-[3px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[8.5px] font-extrabold text-white shadow-[0_0_0_2px_var(--dz-surface)]">
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
