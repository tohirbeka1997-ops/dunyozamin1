/**
 * Network / offline sync status badge for desktop POS header.
 */

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CloudOff, Loader2, RefreshCw, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getOfflineSalesQueueCount, syncOfflinePosSalesNow } from '@/lib/offlineSalesQueue';
import { isOfflineSalesSyncInProgress, subscribeOfflineSalesSync } from '@/lib/offlineSalesQueue';

export default function NetworkBadge({ compact = false }: { compact?: boolean }) {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  );
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(isOfflineSalesSyncInProgress());

  const refreshPending = useCallback(async () => {
    try {
      setPending(await getOfflineSalesQueueCount());
    } catch {
      /* best effort */
    }
  }, []);

  useEffect(() => {
    void refreshPending();
    const onOnline = () => {
      setOnline(true);
      void refreshPending();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const unsub = subscribeOfflineSalesSync(setSyncing);
    const interval = window.setInterval(() => void refreshPending(), 30_000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      unsub();
      window.clearInterval(interval);
    };
  }, [refreshPending]);

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

  return (
    <Badge
      variant={online ? 'default' : 'secondary'}
      title={online ? 'Online' : 'Offline'}
      className={cn(
        'shrink-0 gap-0.5',
        online ? 'bg-green-600' : '',
        compact && 'h-6 px-1.5 text-[10px] font-normal',
      )}
    >
      {online ? <Wifi className="h-2.5 w-2.5" /> : <CloudOff className="h-2.5 w-2.5" />}
      {!compact && (online ? 'Online' : 'Offline')}
    </Badge>
  );
}
