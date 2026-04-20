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
import { HomePage } from './pages/HomePage';
import { OrdersPage } from './pages/OrdersPage';
import { ProductPage } from './pages/ProductPage';

export default function App() {
  const loc = useLocation();
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [cartN, setCartN] = useState(() => cartCount(loadCart()));
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
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const bumpCart = () => setCartN(cartCount(loadCart()));

  const isCheckout = loc.pathname === '/checkout';

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-[var(--dz-bg)]">
      <header className="sticky top-0 z-10 border-b border-black/[0.07] bg-[var(--tg-theme-bg-color,#fff)]/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Link to="/" className="block text-lg font-bold tracking-tight text-[var(--tg-theme-text-color,#111)]">
              DunyoZamin
            </Link>
            <p className="mt-0.5 text-xs text-black/50">Onlayn do&apos;kon</p>
          </div>
          {userName ? (
            <div className="rounded-full bg-black/[0.05] px-3 py-1 text-right text-xs font-medium text-black/70">
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

      <main
        className={`flex-1 px-4 ${isCheckout ? 'pb-8' : 'pb-[calc(5rem+env(safe-area-inset-bottom))]'} pt-4`}
      >
        {!authReady ? <LoadingScreen /> : null}
        {authReady ? (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/product/:id" element={<ProductPage onCartChange={bumpCart} />} />
            <Route path="/cart" element={<CartPage onCartChange={bumpCart} />} />
            <Route path="/checkout" element={<CheckoutPage onCartChange={bumpCart} />} />
            <Route path="/orders" element={<OrdersPage />} />
          </Routes>
        ) : null}
      </main>

      {authReady && !isCheckout ? <BottomNav cartCount={cartN} /> : null}
    </div>
  );
}
