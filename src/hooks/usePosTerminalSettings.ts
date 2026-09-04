import { useEffect, useState } from 'react';
import { getSettingsByCategory } from '@/db/api';

/**
 * Settings → POS terminal (`category=pos`) values used by the POS UI.
 * Defaults mirror the form defaults in `Settings.tsx`.
 */
export type PosTerminalSettings = {
  mode: 'retail' | 'restaurant';
  auto_logout_minutes: number;
  quick_access_limit: number;
  enable_hold_order: boolean;
  enable_mixed_payment: boolean;
  /** Cosmetic: backend always requires a customer for credit. Kept for forward compat. */
  require_customer_for_credit: boolean;
  show_low_stock_warning: boolean;
  auto_apply_advance_to_sale: boolean;
};

const DEFAULTS: PosTerminalSettings = {
  mode: 'retail',
  auto_logout_minutes: 0,
  quick_access_limit: 12,
  enable_hold_order: true,
  enable_mixed_payment: true,
  require_customer_for_credit: true,
  show_low_stock_warning: true,
  auto_apply_advance_to_sale: false,
};

const STORAGE_EVENT = 'pos:settings:changed';

const toBool = (v: unknown, fallback: boolean): boolean => {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return fallback;
};

const toIntInRange = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

const normalize = (raw: Record<string, unknown> | null | undefined): PosTerminalSettings => {
  const r = raw || {};
  const mode = r.mode === 'restaurant' ? 'restaurant' : 'retail';
  return {
    mode,
    auto_logout_minutes: toIntInRange(r.auto_logout_minutes, DEFAULTS.auto_logout_minutes, 0, 480),
    quick_access_limit: toIntInRange(r.quick_access_limit, DEFAULTS.quick_access_limit, 4, 24),
    enable_hold_order: toBool(r.enable_hold_order, DEFAULTS.enable_hold_order),
    enable_mixed_payment: toBool(r.enable_mixed_payment, DEFAULTS.enable_mixed_payment),
    require_customer_for_credit: toBool(r.require_customer_for_credit, DEFAULTS.require_customer_for_credit),
    show_low_stock_warning: toBool(r.show_low_stock_warning, DEFAULTS.show_low_stock_warning),
    auto_apply_advance_to_sale: toBool(r.auto_apply_advance_to_sale, DEFAULTS.auto_apply_advance_to_sale),
  };
};

/**
 * React hook that loads the POS settings once and refreshes when:
 *   - the in-page custom event `pos:settings:changed` fires (Settings page can dispatch),
 *   - a storage event fires (multi-tab / cross-window).
 *
 * Returns a stable object initialized to safe defaults, so consumers never
 * need to handle a null state.
 */
export function usePosTerminalSettings(): PosTerminalSettings {
  const [state, setState] = useState<PosTerminalSettings>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const raw = await getSettingsByCategory('pos');
        if (!cancelled) setState(normalize(raw as Record<string, unknown>));
      } catch {
        if (!cancelled) setState(DEFAULTS);
      }
    };
    load();

    const onChange = () => {
      load();
    };
    window.addEventListener(STORAGE_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(STORAGE_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  return state;
}

/**
 * Manually notify all `usePosTerminalSettings` consumers that the underlying
 * settings have changed. Call this from the Settings page after a save.
 */
export function notifyPosSettingsChanged() {
  try {
    window.dispatchEvent(new Event(STORAGE_EVENT));
  } catch {
    // ignore
  }
}
