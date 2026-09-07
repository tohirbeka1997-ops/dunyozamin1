/**
 * PosDeviceBar — compact inline bar showing printer and scale status for POS header.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, Scale, Loader2, CircleCheck, CircleAlert, RefreshCw, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useScale } from '@/hooks/useScale';
import { getPrintAgentHealth, type PrintAgentHealth } from '@/lib/receipts/printAgent';
import { invalidatePrintAgentCache } from '@/lib/receipts/escposPrint';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';

type AgentState = 'unknown' | 'ok' | 'down';
type ScaleState = 'unknown' | 'online' | 'warning' | 'offline';

export type PosDeviceBarProps = {
  onWeigh?: (weightKg: number, unit: string) => boolean | void;
  visible?: boolean;
  healthIntervalMs?: number;
  className?: string;
};

export function PosDeviceBar({
  onWeigh,
  visible = true,
  healthIntervalMs = 30000,
  className,
}: PosDeviceBarProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { read, reading, isReading, error } = useScale();

  const [health, setHealth] = useState<PrintAgentHealth | null>(null);
  const [agentState, setAgentState] = useState<AgentState>('unknown');
  const [scaleState, setScaleState] = useState<ScaleState>('unknown');
  const mountedRef = useRef(true);

  const refreshHealth = useCallback(async () => {
    invalidatePrintAgentCache();
    const h = await getPrintAgentHealth(1500);
    if (!mountedRef.current) return;
    setHealth(h);
    setAgentState(h ? 'ok' : 'down');
    if (!h) {
      setScaleState('offline');
    } else if (error) {
      setScaleState('warning');
    } else {
      setScaleState('online');
    }
  }, [error]);

  useEffect(() => {
    if (!visible) return;
    mountedRef.current = true;
    refreshHealth();
    const id = window.setInterval(refreshHealth, Math.max(5000, healthIntervalMs));
    return () => {
      mountedRef.current = false;
      window.clearInterval(id);
    };
  }, [visible, healthIntervalMs, refreshHealth]);

  useEffect(() => {
    if (agentState === 'down') {
      setScaleState('offline');
    } else if (error) {
      setScaleState('warning');
    } else if (agentState === 'ok') {
      setScaleState('online');
    }
  }, [agentState, error]);

  const handleWeigh = useCallback(async () => {
    try {
      const r = await read();
      const handled = onWeigh?.(r.weight, r.unit);
      if (handled !== false) {
        toast({
          title: t('pos.device_bar.weighed_title'),
          description: `${r.weight.toFixed(3)} ${r.unit}${r.stable ? '' : ` (${t('pos.device_bar.unstable')})`}`,
        });
      }
    } catch (e: any) {
      setScaleState('warning');
      toast({
        variant: 'destructive',
        title: t('pos.device_bar.scale_error_title'),
        description: t('pos.device_bar.scale_cashier_hint', {
          defaultValue: 'Tarozi o‘qilmadi. Og‘irlikni qo‘lda kiriting.',
        }),
      });
    }
  }, [read, onWeigh, toast, t]);

  if (!visible) return null;

  const hasAgent = agentState === 'ok';
  const printerOnline = agentState === 'ok';
  const scaleAdvertised = Boolean((health as any)?.scale?.enabled) || hasAgent;

  const scaleLabel =
    scaleState === 'online'
      ? t('pos.device_status.online', { defaultValue: 'Online' })
      : scaleState === 'warning'
        ? t('pos.device_status.warning', { defaultValue: 'Ogohlantirish' })
        : scaleState === 'offline'
          ? t('pos.device_status.offline', { defaultValue: 'Offline' })
          : '…';

  const scalePillClass =
    scaleState === 'online'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
      : scaleState === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200'
        : scaleState === 'offline'
          ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300'
          : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400';

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={`flex items-center gap-1.5 ${className || ''}`}
        aria-label={t('pos.device_status.devices_aria', { defaultValue: 'Kassa qurilmalari' })}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                printerOnline
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                  : agentState === 'down'
                    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300'
                    : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
              }`}
              role="status"
            >
              <Printer className="h-3 w-3" aria-hidden />
              <span className="hidden sm:inline">
                {t('pos.device_status.printer', { defaultValue: 'Printer' })}:{' '}
                {printerOnline
                  ? t('pos.device_status.online', { defaultValue: 'Online' })
                  : agentState === 'down'
                    ? t('pos.device_status.offline', { defaultValue: 'Offline' })
                    : '…'}
              </span>
              {agentState === 'ok' ? (
                <CircleCheck className="h-3 w-3" aria-hidden />
              ) : agentState === 'down' ? (
                <CircleAlert className="h-3 w-3" aria-hidden />
              ) : (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            {agentState === 'ok' ? (
              <div className="space-y-0.5 text-xs">
                <div className="font-medium">{t('pos.device_bar.print_agent_ok')}</div>
                {health?.printer?.interface && (
                  <div className="text-muted-foreground">{health.printer.interface}</div>
                )}
                {health?.version && (
                  <div className="text-muted-foreground">v{health.version}</div>
                )}
              </div>
            ) : (
              <div className="space-y-1 text-xs">
                <div className="font-medium">{t('pos.device_bar.print_agent_down')}</div>
                <div className="text-muted-foreground">{t('pos.device_bar.print_agent_down_hint')}</div>
                <div className="flex gap-1 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => void refreshHealth()}
                  >
                    <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
                    {t('common.retry', { defaultValue: 'Qayta tekshirish' })}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => navigate('/settings')}
                  >
                    <Settings className="mr-1 h-3 w-3" aria-hidden />
                    {t('pos.device_status.settings', { defaultValue: 'Sozlamalar' })}
                  </Button>
                </div>
              </div>
            )}
          </TooltipContent>
        </Tooltip>

        {agentState === 'down' && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={() => void refreshHealth()}
            title={t('common.retry', { defaultValue: 'Qayta tekshirish' })}
            aria-label={t('pos.device_status.retry_printer', { defaultValue: 'Printerni qayta tekshirish' })}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        )}

        {scaleAdvertised && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${scalePillClass}`}
                  role="status"
                >
                  <Scale className="h-3 w-3" aria-hidden />
                  <span className="hidden sm:inline">
                    {t('pos.device_status.scale', { defaultValue: 'Tarozi' })}: {scaleLabel}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="space-y-0.5 text-xs">
                  {scaleState === 'online' && (
                    <div className="font-medium">
                      {t('pos.device_bar.weigh_tooltip', { defaultValue: 'Tarozi tayyor' })}
                    </div>
                  )}
                  {scaleState === 'warning' && (
                    <div className="font-medium text-amber-700">
                      {t('pos.device_bar.scale_cashier_hint', {
                        defaultValue: 'Tarozi o‘qilmadi. Og‘irlikni qo‘lda kiriting.',
                      })}
                    </div>
                  )}
                  {scaleState === 'offline' && (
                    <div className="font-medium text-rose-700">
                      {t('pos.device_status.scale_offline_hint', {
                        defaultValue: 'Tarozi ulanmagan. Og‘irlikni qo‘lda kiriting.',
                      })}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={handleWeigh}
                  disabled={isReading || !hasAgent}
                >
                  {isReading ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : (
                    <Scale className="h-3 w-3" aria-hidden />
                  )}
                  <span>{isReading ? t('pos.device_bar.weighing') : t('pos.device_bar.weigh')}</span>
                  {reading && !isReading && !error && (
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                      {reading.weight.toFixed(3)} {reading.unit}
                    </span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="space-y-0.5 text-xs">
                  <div className="font-medium">{t('pos.device_bar.weigh_tooltip')}</div>
                  <div className="text-muted-foreground">{t('pos.device_bar.weigh_tooltip_hint')}</div>
                </div>
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

export default PosDeviceBar;
