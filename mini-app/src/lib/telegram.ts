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
  if (tg) {
    document.body.dataset.tg = '1';
  } else {
    document.body.dataset.tg = '0';
    document.body.dataset.tgTheme = 'light';
  }
  tg?.ready();
  tg?.expand();
  const bg = tg?.themeParams?.bg_color;
  const hc = tg?.themeParams?.header_bg_color;

  if (bg) {
    const hex = String(bg).trim();
    const m = /^#?([a-fA-F0-9]{6})$/.exec(hex);
    if (m) {
      const v = m[1];
      const r = Number.parseInt(v.slice(0, 2), 16);
      const g = Number.parseInt(v.slice(2, 4), 16);
      const b = Number.parseInt(v.slice(4, 6), 16);
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      document.body.dataset.tgTheme = luminance < 0.45 ? 'dark' : 'light';
    }
  }

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
