/**
 * Network / offline sync status badge for desktop POS header.
 * Online reflects browser connectivity AND a lightweight backend health probe.
 */

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CloudOff, Loader2, RefreshCw, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getOfflineSalesQueueCount, syncOfflinePosSalesNow } from '@/lib/offlineSalesQueue';
import { isOfflineSalesSyncInProgress, subscribeOfflineSalesSync } from '@/lib/offlineSalesQueue';
import { useTranslation } from 'react-i18next';

function isHealthPayloadOk(payload: unknown): boolean {
  if (payload == null) return false;
  if (typeof payload !== 'object') return Boolean(payload);
  const r = payload as Record<string, unknown>;
  // preload / remotePosApi envelope: { success, data?, error? }
  if (r.success === false || r.ok === false) return false;
  if (r.success === true) {
    const data = r.data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (d.success === false || d.ok === false) return false;
    }
    return true;
  }
  // Bare health payload from some handlers: { success, dbOpen, multi_tenant, ok }
  if ('dbOpen' in r || 'multi_tenant' in r) return true;
  if (r.ok === true) return true;
  return false;
}

async function probeBackendHealth(): Promise<boolean> {
  try {
    const api = (window as any)?.posApi;
    if (!api?.health || typeof api.health !== 'function') {
      // Local Electron without remote health — browser online is enough.
      return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    }
    const result = await Promise.race([
      api.health(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('health timeout')), 4000)),
    ]);
    return isHealthPayloadOk(result);
  } catch {
    return false;
  }
}

export default function NetworkBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  );
  const [backendOk, setBackendOk] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(isOfflineSalesSyncInProgress());

  const online = browserOnline && backendOk;

  const refreshPending = useCallback(async () => {
    try {
      setPending(await getOfflineSalesQueueCount());
    } catch {
      /* best effort */
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setBackendOk(false);
      return;
    }
    const ok = await probeBackendHealth();
    setBackendOk(ok);
  }, []);

  useEffect(() => {
    void refreshPending();
    void refreshHealth();
    const onOnline = () => {
      setBrowserOnline(true);
      void refreshPending();
      void refreshHealth();
    };
    const onOffline = () => {
      setBrowserOnline(false);
      setBackendOk(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const unsub = subscribeOfflineSalesSync(setSyncing);
    const interval = window.setInterval(() => {
      void refreshPending();
      void refreshHealth();
    }, 30_000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      unsub();
      window.clearInterval(interval);
    };
  }, [refreshPending, refreshHealth]);

  const handleManualSync = async () => {
    if (syncing) return;
    await syncOfflinePosSalesNow();
    await refreshPending();
  };

  if (pending > 0) {
    return (
      <div className="flex shrink-0 items-center gap-0.5">
        <Badge
          variant="secondary"
          title={`${pending} offline sotuv`}
          className={cn(
            'gap-0.5 bg-amber-100 text-amber-900 border-amber-200',
            compact && 'h-6 px-1.5 text-[10px] font-normal',
          )}
        >
          {syncing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CloudOff className="h-2.5 w-2.5" />}
          {compact ? pending : `${pending} offline`}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(compact ? 'h-7 w-7' : 'h-7 px-2')}
          disabled={syncing || !online}
          onClick={() => void handleManualSync()}
          title="Offline sotuvlarni yuborish"
          aria-label="Offline sotuvlarni yuborish"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', syncing ? 'animate-spin' : '')} />
        </Button>
      </div>
    );
  }

  const label = !browserOnline
    ? t('pos.device_status.offline', { defaultValue: 'Offline' })
    : !backendOk
      ? t('pos.device_status.server_down', { defaultValue: 'Server yo‘q' })
      : t('pos.device_status.online', { defaultValue: 'Online' });
  const title = !browserOnline
    ? 'Browser offline'
    : !backendOk
      ? 'Backend health-check failed'
      : 'Online';
  const compactText = compact
    ? `${t('pos.device_status.internet', { defaultValue: 'Internet' })}: ${label}`
    : `${t('pos.device_status.internet', { defaultValue: 'Internet' })} — ${label}`;

  return (
    <Badge
      variant={online ? 'default' : 'secondary'}
      title={title}
      className={cn(
        'shrink-0 gap-0.5',
        online ? 'bg-green-600' : '',
        compact && 'h-6 px-1.5 text-[10px] font-normal',
      )}
    >
      {online ? <Wifi className="h-2.5 w-2.5" /> : <CloudOff className="h-2.5 w-2.5" />}
      {compactText}
    </Badge>
  );
}
