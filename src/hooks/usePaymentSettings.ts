import { useEffect, useState } from 'react';
import { getSettingsByCategory } from '@/db/api';

export type PaymentMethodKey = 'cash' | 'card' | 'terminal' | 'qr' | 'credit';

export type PaymentSettingsState = {
  /** Subset of {@link PaymentMethodKey} the operator has enabled. Always contains 'cash'. */
  methods: PaymentMethodKey[];
  /** Optional custom display label per method (max 32 chars). */
  method_labels: Partial<Record<PaymentMethodKey, string>>;
};

const ALL_METHODS: PaymentMethodKey[] = ['cash', 'card', 'terminal', 'qr', 'credit'];

const DEFAULTS: PaymentSettingsState = {
  methods: ['cash', 'card', 'qr', 'credit'],
  method_labels: {},
};

const STORAGE_EVENT = 'payment:settings:changed';

const normalize = (raw: Record<string, unknown> | null | undefined): PaymentSettingsState => {
  const r = raw || {};
  let methods: PaymentMethodKey[];
  if (Array.isArray(r.methods)) {
    methods = (r.methods as unknown[])
      .map((m) => String(m || '').toLowerCase().trim() as PaymentMethodKey)
      .filter((m): m is PaymentMethodKey => (ALL_METHODS as string[]).includes(m));
  } else if (typeof r.methods === 'string' && (r.methods as string).length > 0) {
    methods = (r.methods as string)
      .split(',')
      .map((m) => m.toLowerCase().trim() as PaymentMethodKey)
      .filter((m): m is PaymentMethodKey => (ALL_METHODS as string[]).includes(m));
  } else {
    methods = [...DEFAULTS.methods];
  }
  if (!methods.includes('cash')) methods = ['cash', ...methods];

  const labels: Partial<Record<PaymentMethodKey, string>> = {};
  const rawLabels = (r.method_labels && typeof r.method_labels === 'object'
    ? (r.method_labels as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  for (const m of ALL_METHODS) {
    const v = rawLabels[m];
    if (typeof v === 'string') {
      const trimmed = v.trim().slice(0, 32);
      if (trimmed.length > 0) labels[m] = trimmed;
    }
  }
  return { methods, method_labels: labels };
};

/**
 * React hook that loads payment settings (`category=payment`) once and
 * refreshes when:
 *   - the in-page custom event `payment:settings:changed` fires (Settings page dispatches),
 *   - a `storage` event fires (multi-tab / cross-window).
 *
 * Always returns a state with at least `cash` enabled.
 */
export function usePaymentSettings(): PaymentSettingsState {
  const [state, setState] = useState<PaymentSettingsState>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const raw = await getSettingsByCategory('payment');
        if (!cancelled) setState(normalize(raw as Record<string, unknown>));
      } catch {
        if (!cancelled) setState(DEFAULTS);
      }
    };
    load();

    const onChange = () => load();
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

export function notifyPaymentSettingsChanged() {
  try {
    window.dispatchEvent(new Event(STORAGE_EVENT));
  } catch {
    // ignore
  }
}

/** Resolve the visible label for a payment method (custom label OR fallback). */
export function resolvePaymentLabel(
  state: PaymentSettingsState,
  method: PaymentMethodKey,
  fallback: string
): string {
  return state.method_labels?.[method] || fallback;
}
