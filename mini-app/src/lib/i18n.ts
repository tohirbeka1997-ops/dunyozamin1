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
  'common.all': { uz: 'Barchasi', ru: 'Все', en: 'All' },
  'common.som': { uz: 'soʻm', ru: 'сум', en: 'soʻm' },

  // Marketplace — top bar
  'home.delivery': { uz: 'Yetkazib berish', ru: 'Доставка', en: 'Delivery' },
  'home.city': { uz: 'Toshkent', ru: 'Ташкент', en: 'Tashkent' },
  'home.brand.tagline': { uz: 'QURILISH MARKETPLACE', ru: 'СТРОЙ МАРКЕТПЛЕЙС', en: 'CONSTRUCTION MARKETPLACE' },

  // Marketplace — hero
  'home.hero.tag': { uz: '🔨 Mavsumiy aksiya', ru: '🔨 Сезонная акция', en: '🔨 Seasonal sale' },
  'home.hero.cta': { uz: 'Aksiyani koʻrish →', ru: 'Смотреть акцию →', en: 'View the sale →' },
  'home.hero.season1': { uz: 'Qurilish mavsumi', ru: 'Сезон стройки', en: 'Building season' },
  'home.hero.season2': { uz: '−30% gacha', ru: 'до −30%', en: 'up to −30%' },
  'home.hero.season.sub': {
    uz: 'Elektrika, asbob va montaj mollari',
    ru: 'Электрика, инструмент и монтаж',
    en: 'Electrics, tools & assembly goods',
  },

  // Marketplace — trust chips
  'trust.delivery': { uz: 'Bepul yetkazish', ru: 'Бесплатная доставка', en: 'Free delivery' },
  'trust.warranty': { uz: 'Original · Kafolat', ru: 'Оригинал · Гарантия', en: 'Original · Warranty' },
  'trust.installment': { uz: 'Boʻlib toʻlash', ru: 'Рассрочка', en: 'Installment' },

  // Marketplace — sections
  'section.categories': { uz: 'Kategoriyalar', ru: 'Категории', en: 'Categories' },
  'section.brands': { uz: 'Brendlar', ru: 'Бренды', en: 'Brands' },
  'section.deals': { uz: 'Chegirmalar', ru: 'Скидки', en: 'Deals' },
  'section.popular': { uz: 'Ommabop', ru: 'Популярное', en: 'Popular' },
  'section.featured': { uz: 'Tanlangan mahsulotlar', ru: 'Избранные товары', en: 'Featured products' },
  'section.featured.sub': { uz: 'Eng koʻp tanlangan tovarlar', ru: 'Самые выбираемые товары', en: 'Most chosen items' },
  'deals.sold': { uz: 'Sotildi', ru: 'Продано', en: 'Sold' },

  // Marketplace — product card / detail
  'product.inStock': { uz: 'omborda', ru: 'на складе', en: 'in stock' },
  'product.stockCount': { uz: 'Omborda {n} dona', ru: 'На складе {n} шт', en: '{n} in stock' },
  'product.outOfStock': { uz: 'Tugagan', ru: 'Нет в наличии', en: 'Out of stock' },
  'product.lowStock': { uz: 'Kam qoldi', ru: 'Осталось мало', en: 'Low stock' },
  'product.addToCart': { uz: 'Savatga', ru: 'В корзину', en: 'Add to cart' },
  'product.added': { uz: 'Savatga qoʻshildi', ru: 'Добавлено в корзину', en: 'Added to cart' },
  'product.top': { uz: '★ TOP', ru: '★ ТОП', en: '★ TOP' },
  'product.delivery.title': { uz: 'Ertaga yetkazib berish', ru: 'Доставка завтра', en: 'Delivery tomorrow' },
  'product.delivery.sub': {
    uz: '300.000 soʻmdan yuqori — bepul',
    ru: 'от 300.000 сум — бесплатно',
    en: 'over 300.000 soʻm — free',
  },

  // Marketplace — cart
  'cart.promo': { uz: 'Promokod kiritish', ru: 'Ввести промокод', en: 'Enter promo code' },
  'cart.promo.apply': { uz: 'Qoʻllash', ru: 'Применить', en: 'Apply' },
  'cart.products': { uz: 'Mahsulotlar', ru: 'Товары', en: 'Products' },
  'cart.delivery': { uz: 'Yetkazish', ru: 'Доставка', en: 'Delivery' },
  'cart.delivery.calc': { uz: 'Operator hisoblaydi', ru: 'Рассчитает оператор', en: 'Operator calculates' },
  'cart.bonus': { uz: 'Bonus ball', ru: 'Бонусные баллы', en: 'Bonus points' },
  'cart.total': { uz: 'Jami', ru: 'Итого', en: 'Total' },
  'cart.clear': { uz: 'Savatni tozalash', ru: 'Очистить корзину', en: 'Clear cart' },
  'cart.clear.confirm': {
    uz: 'Savatni butunlay tozalaysizmi?',
    ru: 'Очистить корзину полностью?',
    en: 'Clear the entire cart?',
  },

  // Catalog — category drill-down
  'catalog.back': { uz: 'Ortga', ru: 'Назад', en: 'Back' },
  'catalog.categories.title': { uz: 'Kategoriyalar', ru: 'Категории', en: 'Categories' },
  'catalog.viewAll': { uz: 'Hammasini koʻrish', ru: 'Показать все', en: 'View all' },
  'catalog.categories.empty': { uz: 'Kategoriyalar topilmadi', ru: 'Категории не найдены', en: 'No categories found' },
  'catalog.subcategories': { uz: 'Ichki kategoriyalar', ru: 'Подкатегории', en: 'Subcategories' },

  // Marketplace — bonus banner
  'bonus.title': { uz: 'Bonus dasturi', ru: 'Бонусная программа', en: 'Bonus program' },
  'bonus.rule': { uz: 'Har 1.000 soʻm = 1 ball', ru: 'Каждые 1.000 сум = 1 балл', en: 'Every 1.000 soʻm = 1 point' },

  // Profile theme toggle
  'profile.theme': { uz: 'Mavzu', ru: 'Тема', en: 'Theme' },
  'profile.theme.light': { uz: 'Yorugʻ', ru: 'Светлая', en: 'Light' },
  'profile.theme.dark': { uz: 'Tungi', ru: 'Тёмная', en: 'Dark' },
  'profile.tier.gold': { uz: 'Oltin mijoz', ru: 'Золотой клиент', en: 'Gold customer' },
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
