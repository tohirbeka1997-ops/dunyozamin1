import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const LANGUAGE_LABELS: Record<string, string> = {
  uz: 'UZ',
  en: 'EN',
  ru: 'RU',
};

function getAvailableLanguages(resources: unknown): string[] {
  if (!resources || typeof resources !== 'object') return [];
  return Object.keys(resources as Record<string, unknown>).sort();
}

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const available = useMemo(() => getAvailableLanguages((i18n as any)?.options?.resources), [i18n]);

  if (available.length <= 1) return null;

  const current = i18n.resolvedLanguage || i18n.language || available[0];

  const setLanguage = async (lng: string) => {
    if (!lng || lng === current) return;
    try {
      await i18n.changeLanguage(lng);
      localStorage.setItem('pos:language', lng);
    } catch (e) {
      // keep UI non-fatal if an optional language isn't loaded
      console.warn('Failed to change language:', e);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Globe className="h-4 w-4" />
          <span className="text-xs font-medium">{LANGUAGE_LABELS[current] ?? String(current).toUpperCase()}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {available.map((lng) => (
          <DropdownMenuItem key={lng} onSelect={() => setLanguage(lng)}>
            {LANGUAGE_LABELS[lng] ?? lng}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default LanguageSwitcher;

