import { useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { authTelegram, loadTokens } from './lib/api';
import { cartCount, loadCart } from './lib/cart';
import { getTg, initTelegramUi } from './lib/telegram';
import { BottomNav } from './components/BottomNav';
import { LoadingScreen } from './components/LoadingScreen';
import { initTheme } from './theme';
import { t, useLang } from './lib/i18n';
import { CartPage } from './pages/CartPage';
import { CatalogPage } from './pages/CatalogPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { HomePage } from './pages/HomePage';
import { OrdersPage } from './pages/OrdersPage';
import { ProfilePage } from './pages/ProfilePage';
import { ProductPage } from './pages/ProductPage';
import { HelpPage } from './pages/HelpPage';
import { OnboardingTour } from './components/OnboardingTour';
import { favoritesCount, hydrateFavoritesFromCloud } from './lib/favorites';
import { hydrateRecentSearchesFromCloud } from './lib/recentSearches';
import { hydrateRecentlyViewedFromCloud } from './lib/recentlyViewed';
import { hydrateAddressesFromCloud } from './lib/addresses';
import { hydrateLangFromCloud } from './lib/i18n';

export default function App() {
  useLang();
  const loc = useLocation();
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [cartN, setCartN] = useState(() => cartCount(loadCart()));
  const [favN, setFavN] = useState(() => favoritesCount());
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => initTheme(), []);

  useEffect(() => {
    initTelegramUi();
    const tg = getTg();
    const u = tg?.initDataUnsafe?.user;
    if (u?.first_name) setUserName(u.first_name);
    // Pull favorites + recent searches from Telegram CloudStorage so the
    // user's data follows them across devices. Fire-and-forget: failure
    // just keeps the local copy.
    void hydrateFavoritesFromCloud().catch(() => undefined);
    void hydrateRecentSearchesFromCloud().catch(() => undefined);
    void hydrateRecentlyViewedFromCloud().catch(() => undefined);
    void hydrateAddressesFromCloud().catch(() => undefined);
    void hydrateLangFromCloud().catch(() => undefined);
    const initData = tg?.initData || '';
    if (!initData) {
      setAuthReady(true);
      return;
    }
    if (loadTokens()) {
      setAuthReady(true);
      return;
    }
    void authTelegram(initData)
      .then(() => setAuthReady(true))
      .catch((e: Error) => {
        setAuthError(e.message);
        setAuthReady(true);
      });
  }, []);

  useEffect(() => {
    const onStorage = () => setCartN(cartCount(loadCart()));
    const onCartChange = () => setCartN(cartCount(loadCart()));
    const onFavoritesChange = () => setFavN(favoritesCount());
    window.addEventListener('storage', onStorage);
    window.addEventListener('cart:change', onCartChange);
    window.addEventListener('favorites:change', onFavoritesChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('cart:change', onCartChange);
      window.removeEventListener('favorites:change', onFavoritesChange);
    };
  }, []);

  const bumpCart = () => setCartN(cartCount(loadCart()));

  const isCheckout = loc.pathname === '/checkout';

  return (
    <div className="relative mx-auto flex min-h-dvh max-w-[400px] flex-col overflow-hidden bg-transparent">
      <div className="tg-decor pointer-events-none absolute -left-24 -top-24 h-56 w-56 rounded-full bg-[#00a19b]/20 blur-3xl" />
      <div className="tg-decor pointer-events-none absolute -right-24 top-32 h-52 w-52 rounded-full bg-[#e4ddd3]/55 blur-3xl" />
      <div className="tg-decor pointer-events-none absolute bottom-32 -left-20 h-40 w-40 rounded-full bg-[#ccda47]/18 blur-3xl" />
      <header className="dz-glass sticky top-0 z-10 px-3.5 pb-2.5 pt-[max(0.55rem,env(safe-area-inset-top))]">
        <div className="dz-loc mb-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          <span>
            {t('home.delivery')} · <b>{t('home.city')}</b>
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="dz-brand-block flex items-center gap-2.5">
            <span className="dz-logo">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" aria-hidden>
                <path d="M3 21V9l9-6 9 6v12" />
                <path d="M9 21v-6h6v6" />
              </svg>
            </span>
            <div className="leading-tight">
              <span className="dz-brand-name block text-[16px] font-bold tracking-tight">
                DunyoZamin
              </span>
              <span className="dz-brand-tagline block text-[10px] font-bold uppercase tracking-[0.02em]">
                {t('home.brand.tagline')}
              </span>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            {userName ? (
              <span className="dz-chip-teal dz-chip max-w-[7.5rem] truncate">
                <span aria-hidden>👋</span>
                <span className="truncate">{userName}</span>
              </span>
            ) : null}
            <Link to="/orders" className="dz-ibtn" aria-label={t('profile.orders')}>
              <span className="dz-nd" />
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      {authError ? (
        <div className="mx-4 mt-3 rounded-2xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm">
          <p className="font-medium">Kirish xatosi</p>
          <p className="mt-1 text-amber-900/90">{authError}</p>
          <p className="mt-2 text-xs text-amber-800/80">
            Telegram ichida qayta oching yoki administratorga murojaat qiling.
          </p>
        </div>
      ) : null}

      <main className={`flex-1 px-3 ${isCheckout ? 'pb-8' : 'pb-[calc(5rem+env(safe-area-inset-bottom))]'} pt-2`}>
        {!authReady ? <LoadingScreen /> : null}
        {authReady ? (
          <Routes>
            <Route path="/" element={<HomePage onCartChange={bumpCart} />} />
            <Route path="/catalog" element={<CatalogPage onCartChange={bumpCart} />} />
            <Route path="/product/:id" element={<ProductPage onCartChange={bumpCart} />} />
            <Route path="/favorites" element={<FavoritesPage onCartChange={bumpCart} />} />
            <Route path="/cart" element={<CartPage onCartChange={bumpCart} />} />
            <Route path="/checkout" element={<CheckoutPage onCartChange={bumpCart} />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/help" element={<HelpPage />} />
          </Routes>
        ) : null}
      </main>

      {authReady && !isCheckout ? <BottomNav cartCount={cartN} favoritesCount={favN} /> : null}

      {/* First-time onboarding overlay — auto-shows once per device */}
      {authReady ? <OnboardingTour /> : null}
    </div>
  );
}
