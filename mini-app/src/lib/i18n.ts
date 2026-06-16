import { useEffect, useState } from 'react';
import { cloudStorage, getTg } from './telegram';

export type Lang = 'uz' | 'ru' | 'en';

const KEY = 'dz_lang_v1';
const SUPPORTED: Lang[] = ['uz', 'ru', 'en'];

export const LANG_META: Record<Lang, { flag: string; native: string }> = {
  uz: { flag: '🇺🇿', native: 'Oʻzbekcha' },
  ru: { flag: '🇷🇺', native: 'Русский' },
  en: { flag: '🇬🇧', native: 'English' },
};

/**
 * Translation table. Keep keys short and stable. Adding a new key in
 * one language with no translation in others falls back to the Uz value
 * (the source of truth for this app).
 */
const STRINGS = {
  // Bottom nav
  'nav.home': { uz: 'Bosh sahifa', ru: 'Главная', en: 'Home' },
  'nav.catalog': { uz: 'Katalog', ru: 'Каталог', en: 'Catalog' },
  'nav.favorites': { uz: 'Sevimli', ru: 'Избранное', en: 'Favorites' },
  'nav.cart': { uz: 'Savat', ru: 'Корзина', en: 'Cart' },
  'nav.profile': { uz: 'Profil', ru: 'Профиль', en: 'Profile' },

  // Home hero
  'home.hero.kicker': { uz: '🌿 DunyoZamin', ru: '🌿 DunyoZamin', en: '🌿 DunyoZamin' },
  'home.hero.title1': { uz: 'Sizga kerakli har narsa', ru: 'Всё что нужно вам', en: 'Everything you need' },
  'home.hero.title2': { uz: 'bir joyda', ru: 'в одном месте', en: 'in one place' },
  'home.hero.subtitle': {
    uz: 'Tezkor xarid, qulay yetkazib berish, bonus ball.',
    ru: 'Быстрая покупка, удобная доставка, бонусные баллы.',
    en: 'Fast shopping, easy delivery, loyalty points.',
  },
  'home.search.placeholder': {
    uz: 'Mahsulot qidirish…',
    ru: 'Найти товар…',
    en: 'Search products…',
  },

  // Common actions
  'action.add': { uz: 'Qoʻshish', ru: 'Добавить', en: 'Add' },
  'action.cancel': { uz: 'Bekor', ru: 'Отмена', en: 'Cancel' },
  'action.save': { uz: 'Saqlash', ru: 'Сохранить', en: 'Save' },
  'action.confirm': { uz: 'Tasdiqlash', ru: 'Подтвердить', en: 'Confirm' },
  'action.checkout': { uz: 'Buyurtma berish', ru: 'Оформить', en: 'Checkout' },
  'action.continue': { uz: 'Davom etish', ru: 'Продолжить', en: 'Continue' },

  // Profile
  'profile.orders': { uz: 'Buyurtmalar', ru: 'Заказы', en: 'Orders' },
  'profile.spent': { uz: 'Sarflandi', ru: 'Потрачено', en: 'Spent' },
  'profile.cart': { uz: 'Savatda', ru: 'В корзине', en: 'In cart' },
  'profile.favorites': { uz: 'Sevimli', ru: 'Избранное', en: 'Favorites' },
  'profile.lang': { uz: 'Til', ru: 'Язык', en: 'Language' },

  // Misc
  'common.loading': { uz: 'Yuklanmoqda…', ru: 'Загрузка…', en: 'Loading…' },
  'common.empty': { uz: 'Boʻsh', ru: 'Пусто', en: 'Empty' },
  'common.retry': { uz: 'Qayta urinish', ru: 'Повторить', en: 'Retry' },
  'common.error': { uz: 'Xato', ru: 'Ошибка', en: 'Error' },
} as const;

export type StringKey = keyof typeof STRINGS;

function autoDetect(): Lang {
  const code = getTg()?.initDataUnsafe?.user
    ? // @ts-expect-error language_code is on user but not in our type yet
      (getTg()?.initDataUnsafe?.user?.language_code as string | undefined)
    : undefined;
  if (typeof code === 'string') {
    const c = code.toLowerCase();
    if (c.startsWith('ru')) return 'ru';
    if (c.startsWith('en')) return 'en';
    if (c.startsWith('uz')) return 'uz';
  }
  // Fallback to browser language
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  if (nav.toLowerCase().startsWith('ru')) return 'ru';
  if (nav.toLowerCase().startsWith('en')) return 'en';
  return 'uz';
}

function readStored(): Lang | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (SUPPORTED as string[]).includes(v)) return v as Lang;
  } catch {
    /* noop */
  }
  return null;
}

let current: Lang = readStored() || autoDetect();

const subscribers = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  if (current === next) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* noop */
  }
  void cloudStorage.setItem(KEY, next);
  document.documentElement.lang = next;
  subscribers.forEach((fn) => fn());
}

/**
 * React hook that re-renders the consumer whenever the active language
 * changes. Cheap; use it freely in any component that calls `t`.
 */
export function useLang(): Lang {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  return current;
}

export function t(key: StringKey): string {
  const row = STRINGS[key];
  if (!row) return key;
  return row[current] || row.uz || key;
}

export async function hydrateLangFromCloud(): Promise<void> {
  const remote = await cloudStorage.getItem(KEY);
  if (!remote) return;
  if ((SUPPORTED as string[]).includes(remote) && remote !== current) {
    setLang(remote as Lang);
  }
}

// Apply detected language to <html lang="…">
if (typeof document !== 'undefined') {
  document.documentElement.lang = current;
}
