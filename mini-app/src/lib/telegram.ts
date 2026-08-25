type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type NotificationStyle = 'error' | 'success' | 'warning';

export type TelegramHapticFeedback = {
  impactOccurred: (style: ImpactStyle) => void;
  notificationOccurred: (type: NotificationStyle) => void;
  selectionChanged: () => void;
};

export type TelegramMainButton = {
  text: string;
  color?: string;
  textColor?: string;
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  setText: (text: string) => TelegramMainButton;
  setParams: (params: {
    text?: string;
    color?: string;
    text_color?: string;
    is_active?: boolean;
    is_visible?: boolean;
  }) => TelegramMainButton;
  show: () => TelegramMainButton;
  hide: () => TelegramMainButton;
  enable: () => TelegramMainButton;
  disable: () => TelegramMainButton;
  showProgress: (leaveActive?: boolean) => TelegramMainButton;
  hideProgress: () => TelegramMainButton;
  onClick: (cb: () => void) => TelegramMainButton;
  offClick: (cb: () => void) => TelegramMainButton;
};

export type TelegramBackButton = {
  isVisible: boolean;
  show: () => TelegramBackButton;
  hide: () => TelegramBackButton;
  onClick: (cb: () => void) => TelegramBackButton;
  offClick: (cb: () => void) => TelegramBackButton;
};

export type TelegramCloudStorage = {
  setItem: (
    key: string,
    value: string,
    cb?: (err: Error | null, ok?: boolean) => void,
  ) => void;
  getItem: (key: string, cb: (err: Error | null, value?: string) => void) => void;
  getItems: (
    keys: string[],
    cb: (err: Error | null, values?: Record<string, string>) => void,
  ) => void;
  removeItem: (key: string, cb?: (err: Error | null, ok?: boolean) => void) => void;
  removeItems: (keys: string[], cb?: (err: Error | null, ok?: boolean) => void) => void;
  getKeys: (cb: (err: Error | null, keys?: string[]) => void) => void;
};

export type TelegramWebAppLike = {
  ready: () => void;
  expand: () => void;
  close?: () => void;
  initData: string;
  version?: string;
  isVersionAtLeast?: (version: string) => boolean;
  platform?: string;
  colorScheme?: 'light' | 'dark';
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink?: (url: string) => void;
  shareMessage?: (msgId: string, cb?: (sent: boolean) => void) => void;
  switchInlineQuery?: (query: string, choose_chat_types?: string[]) => void;
  showAlert?: (message: string, cb?: () => void) => void;
  showConfirm?: (message: string, cb?: (ok: boolean) => void) => void;
  showPopup?: (
    params: {
      title?: string;
      message: string;
      buttons?: { id?: string; type?: 'default' | 'destructive' | 'ok' | 'close' | 'cancel'; text?: string }[];
    },
    cb?: (id: string) => void,
  ) => void;
  showScanQrPopup?: (
    params: { text?: string },
    cb?: (text: string) => boolean | void,
  ) => void;
  closeScanQrPopup?: () => void;
  initDataUnsafe?: {
    user?: { id?: number; first_name?: string; last_name?: string; username?: string };
  };
  themeParams?: Record<string, string | undefined>;
  BackButton?: TelegramBackButton;
  MainButton?: TelegramMainButton;
  HapticFeedback?: TelegramHapticFeedback;
  CloudStorage?: TelegramCloudStorage;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
};

export function getTg(): TelegramWebAppLike | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebAppLike } }).Telegram?.WebApp;
}

export function isTgEnv(): boolean {
  return !!getTg();
}

/* ============= Haptic feedback (no-op outside TG) ============= */

export const haptic = {
  impact(style: ImpactStyle = 'light'): void {
    try {
      getTg()?.HapticFeedback?.impactOccurred(style);
    } catch {
      /* ignore */
    }
  },
  notify(type: NotificationStyle): void {
    try {
      getTg()?.HapticFeedback?.notificationOccurred(type);
    } catch {
      /* ignore */
    }
  },
  selection(): void {
    try {
      getTg()?.HapticFeedback?.selectionChanged();
    } catch {
      /* ignore */
    }
  },
};

/* ============= Cloud storage (Promise wrapper, no-op fallback) ============= */

export const cloudStorage = {
  async setItem(key: string, value: string): Promise<boolean> {
    const cs = getTg()?.CloudStorage;
    if (!cs) return false;
    return new Promise<boolean>((resolve) => {
      try {
        cs.setItem(key, value, (err) => resolve(!err));
      } catch {
        resolve(false);
      }
    });
  },
  async getItem(key: string): Promise<string | null> {
    const cs = getTg()?.CloudStorage;
    if (!cs) return null;
    return new Promise<string | null>((resolve) => {
      try {
        cs.getItem(key, (err, value) => resolve(err ? null : value ?? null));
      } catch {
        resolve(null);
      }
    });
  },
  async removeItem(key: string): Promise<boolean> {
    const cs = getTg()?.CloudStorage;
    if (!cs) return false;
    return new Promise<boolean>((resolve) => {
      try {
        cs.removeItem(key, (err) => resolve(!err));
      } catch {
        resolve(false);
      }
    });
  },
};

/* ============= Share via Telegram ============= */

export function shareToTelegram(url: string, text?: string): boolean {
  const tg = getTg();
  if (!tg) return false;
  try {
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}${
      text ? `&text=${encodeURIComponent(text)}` : ''
    }`;
    if (tg.openTelegramLink) {
      tg.openTelegramLink(shareUrl);
      return true;
    }
    if (tg.openLink) {
      tg.openLink(shareUrl);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/* ============= Native popup wrappers ============= */

export function tgAlert(message: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const tg = getTg();
    if (!tg?.showAlert) {
      try {
        window.alert(message);
      } catch {
        /* ignore */
      }
      resolve();
      return;
    }
    try {
      tg.showAlert(message, () => resolve());
    } catch {
      resolve();
    }
  });
}

export function tgConfirm(message: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const tg = getTg();
    const confirmViaWeb = () => {
      try {
        resolve(window.confirm(message));
      } catch {
        resolve(false);
      }
    };
    // showConfirm was added in Bot API 6.2. Older Telegram clients expose the
    // method but silently no-op (the callback never fires), which would hang
    // the awaiting caller — so fall back to a plain confirm in that case.
    const supportsConfirm = !!tg?.showConfirm && (tg.isVersionAtLeast ? tg.isVersionAtLeast('6.2') : true);
    if (!supportsConfirm) {
      confirmViaWeb();
      return;
    }
    try {
      tg!.showConfirm!(message, (ok) => resolve(!!ok));
    } catch {
      confirmViaWeb();
    }
  });
}

/**
 * Open Telegram's native QR scanner. Resolves with the scanned text or
 * `null` if the user dismissed the popup or the API is unavailable.
 *
 * The TWA callback should return `true` to signal "we handled this scan,
 * close the popup". We close it ourselves to be safe across SDK versions.
 */
export function tgScanQr(prompt = 'QR kodni skanerlang'): Promise<string | null> {
  return new Promise((resolve) => {
    const tg = getTg();
    if (!tg?.showScanQrPopup) {
      resolve(null);
      return;
    }
    let settled = false;
    try {
      tg.showScanQrPopup({ text: prompt }, (text) => {
        if (settled) return true;
        settled = true;
        resolve(text || null);
        try {
          tg.closeScanQrPopup?.();
        } catch {
          /* noop */
        }
        return true;
      });
    } catch {
      resolve(null);
    }
  });
}

export function isQrSupported(): boolean {
  return !!getTg()?.showScanQrPopup;
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

  if (bg && typeof tg?.setBackgroundColor === 'function') {
    try {
      tg.setBackgroundColor(bg);
    } catch {
      /* ignore */
    }
  }
  if (hc && typeof tg?.setHeaderColor === 'function') {
    try {
      tg.setHeaderColor(hc);
    } catch {
      /* ignore */
    }
  }
}
