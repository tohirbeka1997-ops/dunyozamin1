/**
 * Network / offline sync status badge for desktop POS header.
 */

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CloudOff, Loader2, RefreshCw, Wifi } from 'lucide-react';
import { getOfflineSalesQueueCount, syncOfflinePosSalesNow } from '@/lib/offlineSalesQueue';
import { isOfflineSalesSyncInProgress, subscribeOfflineSalesSync } from '@/lib/offlineSalesQueue';

export default function NetworkBadge() {
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
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-900 border-amber-200">
          {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CloudOff className="h-3 w-3" />}
          {pending} offline
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          disabled={syncing || !online}
          onClick={() => void handleManualSync()}
          title="Offline sotuvlarni yuborish"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant={online ? 'default' : 'secondary'} className={`gap-1 ${online ? 'bg-green-600' : ''}`}>
        {online ? <Wifi className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
        {online ? 'Online' : 'Offline'}
      </Badge>
    </div>
  );
}
