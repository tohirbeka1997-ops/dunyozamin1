import type { ReceiptTemplate, ReceiptTemplateStore } from '@/types/database';
import { defaultReceiptTemplates } from '@/lib/receipts/templates';

export const normalizeReceiptTemplateStore = (raw: any): ReceiptTemplateStore => {
  const templates = Array.isArray(raw?.templates) ? (raw.templates as ReceiptTemplate[]) : [];
  const activeId = typeof raw?.active_id === 'string' ? raw.active_id : '';
  return {
    templates,
    active_id: activeId || templates[0]?.id,
  };
};

const RECEIPT_TEMPLATE_STORAGE_KEY = 'pos:receiptTemplates:v1';

export const loadReceiptTemplateStoreFromLocalStorage = (): ReceiptTemplateStore | null => {
  try {
    const raw = localStorage.getItem(RECEIPT_TEMPLATE_STORAGE_KEY);
    if (!raw) return null;
    return normalizeReceiptTemplateStore(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const saveReceiptTemplateStoreToLocalStorage = (store: ReceiptTemplateStore) => {
  try {
    localStorage.setItem(RECEIPT_TEMPLATE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage errors
  }
};

export const ensureReceiptTemplates = (store?: ReceiptTemplateStore | null): ReceiptTemplateStore => {
  const normalized = normalizeReceiptTemplateStore(store || {});
  if (normalized.templates.length > 0) return normalized;
  const local = loadReceiptTemplateStoreFromLocalStorage();
  if (local?.templates?.length) return local;
  const seeded = defaultReceiptTemplates();
  return {
    templates: seeded,
    active_id: seeded[0]?.id,
  };
};

export const resolveReceiptTemplateStore = (raw?: any): ReceiptTemplateStore => {
  const normalized = normalizeReceiptTemplateStore(raw || {});
  if (normalized.templates.length > 0) return normalized;
  const local = loadReceiptTemplateStoreFromLocalStorage();
  if (local?.templates?.length) return local;
  const seeded = defaultReceiptTemplates();
  return {
    templates: seeded,
    active_id: seeded[0]?.id,
  };
};

export const getActiveReceiptTemplate = (store?: ReceiptTemplateStore | null): ReceiptTemplate | null => {
  if (!store?.templates?.length) return null;
  const active = store.templates.find((t) => t.id === store.active_id);
  return active || store.templates[0] || null;
};
