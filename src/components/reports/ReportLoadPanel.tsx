import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import type { ReportLoadStatus } from '@/lib/reportLoadState';

type ReportLoadPanelProps = {
  status: ReportLoadStatus;
  error?: string | null;
  correlationId?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  /** When true, only loading / empty / error panels render (not success). */
  overlay?: boolean;
};

export function ReportLoadPanel({
  status,
  error,
  correlationId,
  onRetry,
  emptyTitle,
  emptyDescription,
  className = '',
  overlay = true,
}: ReportLoadPanelProps) {
  const { t } = useTranslation();

  if (status === 'success' && overlay) return null;
  if (status === 'idle' && overlay) return null;

  if (status === 'loading') {
    return (
      <div
        className={`flex min-h-[240px] flex-col items-center justify-center gap-3 ${className}`}
        data-testid="report-load-loading"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          {t('reports.load_state.loading', 'Yuklanmoqda...')}
        </p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        className={`flex min-h-[240px] flex-col items-center justify-center gap-3 px-4 text-center ${className}`}
        data-testid="report-load-error"
      >
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <div className="space-y-1">
          <p className="font-medium">{t('reports.load_state.error_title', 'Yuklashda xatolik')}</p>
          <p className="text-sm text-muted-foreground">
            {error || t('reports.load_state.error_default', "Ma'lumotlarni yuklab bo'lmadi")}
          </p>
          {correlationId ? (
            <p className="text-xs text-muted-foreground">
              {t('reports.load_state.correlation_id', 'ID')}: <code>{correlationId}</code>
            </p>
          ) : null}
        </div>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('reports.load_state.retry', 'Qayta urinish')}
          </Button>
        ) : null}
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div
        className={`flex min-h-[200px] flex-col items-center justify-center gap-2 px-4 text-center ${className}`}
        data-testid="report-load-empty"
      >
        <Inbox className="h-10 w-10 text-muted-foreground" />
        <p className="font-medium">
          {emptyTitle || t('reports.load_state.empty_title', 'Maʼlumot topilmadi')}
        </p>
        {emptyDescription ? (
          <p className="text-sm text-muted-foreground">{emptyDescription}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(
              'reports.load_state.empty_hint',
              'Tanlangan filtr yoki davr uchun yozuvlar yoʻq. Bu xatolik emas.',
            )}
          </p>
        )}
      </div>
    );
  }

  return null;
}
