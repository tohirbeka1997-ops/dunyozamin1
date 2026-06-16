import { useEffect, useState } from 'react';
import { getSettingsByCategory } from '@/db/api';
import type { ReceiptSettings } from '@/types/database';
import {
  normalizeReceiptSettings,
  RECEIPT_SETTINGS_DEFAULTS,
} from '@/lib/receipts/normalizeReceiptSettings';

const STORAGE_EVENT = 'receipt:settings:changed';

/**
 * React hook that loads receipt settings (`category=receipt`) once and refreshes
 * when the in-page `receipt:settings:changed` event or a storage event fires.
 *
 * Returned object is always fully populated with safe defaults so consumers
 * never need to defensive-check fields.
 */
export function useReceiptSettings(): ReceiptSettings {
  const [state, setState] = useState<ReceiptSettings>(RECEIPT_SETTINGS_DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const raw = await getSettingsByCategory('receipt');
        if (!cancelled) setState(normalizeReceiptSettings(raw as Record<string, unknown>));
      } catch {
        if (!cancelled) setState(RECEIPT_SETTINGS_DEFAULTS);
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

export function notifyReceiptSettingsChanged() {
  try {
    window.dispatchEvent(new Event(STORAGE_EVENT));
  } catch {
    // ignore
  }
}

/**
 * Apply receipt-settings visibility overrides onto a receipt template.
 * Settings can FORCE OFF (hide) but cannot FORCE ON if the template explicitly
 * hides a section — principle of least surprise.
 *
 * Returns a shallow clone of the template with merged section flags.
 */
export function applyReceiptSettingsToTemplate<T extends {
  sections: {
    header: { showLogo: boolean };
    orderInfo: { showCashier: boolean; showCustomer: boolean };
    products: { showSku: boolean };
  };
}>(template: T, settings: ReceiptSettings): T {
  return {
    ...template,
    sections: {
      ...template.sections,
      header: {
        ...template.sections.header,
        showLogo: template.sections.header.showLogo && settings.show_logo,
      },
      orderInfo: {
        ...template.sections.orderInfo,
        showCashier: template.sections.orderInfo.showCashier && settings.show_cashier,
        showCustomer: template.sections.orderInfo.showCustomer && settings.show_customer,
      },
      products: {
        ...template.sections.products,
        showSku: template.sections.products.showSku && settings.show_sku,
      },
    },
  };
}
