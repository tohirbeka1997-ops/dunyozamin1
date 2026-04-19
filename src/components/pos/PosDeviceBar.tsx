/**
 * PosDeviceBar — compact inline bar showing the state of local cashier
 * hardware (print agent + scale) and offering one-click "Tortish" (weigh)
 * for the currently selected cart line.
 *
 * Designed to be mounted in the POS terminal header near ShiftControl.
 * All logic lives here so POSTerminal.tsx doesn't grow further.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Printer, Scale, Loader2, CircleCheck, CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useScale } from '@/hooks/useScale';
import { getPrintAgentHealth, type PrintAgentHealth } from '@/lib/receipts/printAgent';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from 'react-i18next';

type AgentState = 'unknown' | 'ok' | 'down';

export type PosDeviceBarProps = {
  /**
   * Called when a new weight reading is available. Return `true` if the
   * bar should also surface a "Tortishdi: 0.245 kg" toast; return `false`
   * if the caller already provided their own feedback (e.g. added to cart).
   *
   * The bar will still keep the reading visible regardless.
   */
  onWeigh?: (weightKg: number, unit: string) => boolean | void;
  /** If false the bar is hidden. Useful when shift is closed. */
  visible?: boolean;
  /** How often to re-check agent health. Default 30_000 ms. */
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
  const { read, reading, isReading, error } = useScale();

  const [health, setHealth] = useState<PrintAgentHealth | null>(null);
  const [agentState, setAgentState] = useState<AgentState>('unknown');
  const mountedRef = useRef(true);

  const refreshHealth = useCallback(async () => {
    const h = await getPrintAgentHealth(1500);
    if (!mountedRef.current) return;
    setHealth(h);
    setAgentState(h ? 'ok' : 'down');
  }, []);

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
      toast({
        variant: 'destructive',
        title: t('pos.device_bar.scale_error_title'),
        description: e?.message || String(e),
      });
    }
  }, [read, onWeigh, toast, t]);

  if (!visible) return null;

  const hasAgent = agentState === 'ok';
  const scaleAdvertised = Boolean((health as any)?.scale?.enabled) || hasAgent; // scale may or may not be wired; expose button whenever agent is up

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={`flex items-center gap-1.5 ${className || ''}`}
        aria-label="Cashier devices"
      >
        {/* Print agent status pill */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                agentState === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                  : agentState === 'down'
                  ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300'
                  : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
              }`}
              role="status"
            >
              <Printer className="h-3 w-3" />
              <span className="hidden sm:inline">{t('pos.device_bar.printer')}</span>
              {agentState === 'ok' ? (
                <CircleCheck className="h-3 w-3" />
              ) : agentState === 'down' ? (
                <CircleAlert className="h-3 w-3" />
              ) : (
                <Loader2 className="h-3 w-3 animate-spin" />
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
              <div className="space-y-0.5 text-xs">
                <div className="font-medium">{t('pos.device_bar.print_agent_down')}</div>
                <div className="text-muted-foreground">
                  {t('pos.device_bar.print_agent_down_hint')}
                </div>
              </div>
            )}
          </TooltipContent>
        </Tooltip>

        {/* Weigh button — only render if agent advertises a scale OR we don't
            know yet; disables itself while reading. */}
        {scaleAdvertised && (
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
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Scale className="h-3 w-3" />
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
                <div className="text-muted-foreground">
                  {t('pos.device_bar.weigh_tooltip_hint')}
                </div>
                {error && (
                  <div className="text-rose-500">{error.message}</div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

export default PosDeviceBar;
