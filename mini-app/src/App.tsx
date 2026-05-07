import { useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { authTelegram, loadTokens } from './lib/api';
import { cartCount, loadCart } from './lib/cart';
import { getTg, initTelegramUi } from './lib/telegram';
import { BottomNav } from './components/BottomNav';
import { LoadingScreen } from './components/LoadingScreen';
import { CartPage } from './pages/CartPage';
import { CatalogPage } from './pages/CatalogPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { HomePage } from './pages/HomePage';
import { OrdersPage } from './pages/OrdersPage';
import { ProfilePage } from './pages/ProfilePage';
import { ProductPage } from './pages/ProductPage';
import { favoritesCount } from './lib/favorites';

export default function App() {
  const loc = useLocation();
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [cartN, setCartN] = useState(() => cartCount(loadCart()));
  const [favN, setFavN] = useState(() => favoritesCount());
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    initTelegramUi();
    const tg = getTg();
    const u = tg?.initDataUnsafe?.user;
    if (u?.first_name) setUserName(u.first_name);
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
    <div className="relative mx-auto flex min-h-dvh max-w-lg flex-col overflow-hidden bg-transparent">
      <div className="tg-decor pointer-events-none absolute -left-24 -top-24 h-56 w-56 rounded-full bg-[#91a5ff]/30 blur-3xl" />
      <div className="tg-decor pointer-events-none absolute -right-20 top-24 h-48 w-48 rounded-full bg-[#d59bff]/25 blur-3xl" />
      <header className="dz-glass sticky top-0 z-10 border-b border-white/30 px-3 pb-1.5 pt-[max(0.3rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link to="/" className="block text-[15px] font-bold tracking-tight text-[var(--dz-text)]">
              DunyoZamin
            </Link>
            <p className="text-[10px] text-[var(--dz-soft)]">Onlayn do&apos;kon</p>
          </div>
          {userName ? (
            <div className="rounded-full border border-white/40 bg-gradient-to-br from-white/90 to-white/65 px-2.5 py-0.5 text-right text-[11px] font-medium text-[var(--dz-muted)] shadow-[var(--dz-card-shadow-soft)]">
              {userName}
            </div>
          ) : null}
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
          </Routes>
        ) : null}
      </main>

      {authReady && !isCheckout ? <BottomNav cartCount={cartN} favoritesCount={favN} /> : null}
    </div>
  );
}
