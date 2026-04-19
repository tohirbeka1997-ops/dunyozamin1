/**
 * Telegram Mini App (WebApp) — safe no-op when not inside Telegram.
 * @see https://core.telegram.org/bots/webapps
 */
export function initTelegramWebApp(): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { Telegram?: { WebApp?: TelegramWebAppLike } };
  const tg = w.Telegram?.WebApp;
  if (!tg || typeof tg.ready !== 'function') return;
  try {
    tg.ready();
    if (typeof tg.expand === 'function') tg.expand();
  } catch {
    // ignore
  }
}

type TelegramWebAppLike = {
  ready: () => void;
  expand?: () => void;
};
