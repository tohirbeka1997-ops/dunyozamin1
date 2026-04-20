export type TelegramWebAppLike = {
  ready: () => void;
  expand: () => void;
  initData: string;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  initDataUnsafe?: { user?: { id?: number; first_name?: string; last_name?: string } };
  themeParams?: Record<string, string | undefined>;
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void };
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
};

export function getTg(): TelegramWebAppLike | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebAppLike } }).Telegram?.WebApp;
}

export function initTelegramUi(): void {
  const tg = getTg();
  tg?.ready();
  tg?.expand();
  const bg = tg?.themeParams?.bg_color;
  const hc = tg?.themeParams?.header_bg_color;
  if (bg && typeof tg.setBackgroundColor === 'function') {
    try {
      tg.setBackgroundColor(bg);
    } catch {
      /* ignore */
    }
  }
  if (hc && typeof tg.setHeaderColor === 'function') {
    try {
      tg.setHeaderColor(hc);
    } catch {
      /* ignore */
    }
  }
}
