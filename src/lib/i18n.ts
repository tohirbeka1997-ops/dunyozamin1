import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import uzBase from '../locales/uz.json';
import enBase from '../locales/en.json';
import ruBase from '../locales/ru.json';
import settingsUz from '../locales/settings.uz.json';
import settingsEn from '../locales/settings.en.json';
import settingsRu from '../locales/settings.ru.json';

function mergeSettings<T extends Record<string, unknown>>(base: T, settings: unknown): T & { settings: unknown } {
  return { ...base, settings } as T & { settings: unknown };
}

const resources = {
  uz: { translation: mergeSettings(uzBase, settingsUz) },
  en: { translation: mergeSettings(enBase, settingsEn) },
  ru: { translation: mergeSettings(ruBase, settingsRu) },
} as const;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'uz',
    supportedLngs: ['uz', 'en', 'ru'],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    // Faqat localStorage: brauzer (navigator) rus tilida bo‘lsa ham ilova o‘zbekcha boshlanadi,
    // aks holda Sozlamalar (settings.ru) sidebar (uz.json) bilan aralash ko‘rinadi.
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'pos:language',
    },
    debug: false,
  });

export default i18n;
