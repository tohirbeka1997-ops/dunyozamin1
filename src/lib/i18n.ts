import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import uzTranslations from '../locales/uz.json';

// Force Uzbek language only - no language switching
i18n
  .use(initReactI18next)
  .init({
    resources: {
      uz: {
        translation: uzTranslations,
      },
    },
    lng: 'uz',
    fallbackLng: 'uz',
    debug: false,
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;








