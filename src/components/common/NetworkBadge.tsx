/**
 * Network status badge component
 * Shows online/offline status and sync state
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { Wifi, WifiOff, RefreshCw, AlertCircle } from 'lucide-react';
import { useSyncEngine } from '@/hooks/useSyncEngine';

export default function NetworkBadge() {
  const { isOnline, syncStatus, pendingCount, syncError } = useNetworkStatus();
  const { syncNow, isSyncing } = useSyncEngine();

  const getStatusBadge = () => {
    if (!isOnline) {
      return (
        <Badge variant="destructive" className="gap-1">
          <WifiOff className="h-3 w-3" />
          Offline
          {pendingCount > 0 && (
            <span className="ml-1">({pendingCount})</span>
          )}
        </Badge>
      );
    }

    if (syncStatus === 'syncing' || isSyncing) {
      return (
        <Badge variant="default" className="gap-1">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Syncing...
          {pendingCount > 0 && (
            <span className="ml-1">({pendingCount})</span>
          )}
        </Badge>
      );
    }

    if (syncStatus === 'failed') {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Sync failed
            {pendingCount > 0 && (
              <span className="ml-1">({pendingCount})</span>
            )}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncNow()}
            className="h-6 text-xs"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        </div>
      );
    }

    if (syncStatus === 'success') {
      return (
        <Badge variant="default" className="gap-1 bg-green-600">
          <Wifi className="h-3 w-3" />
          Online
        </Badge>
      );
    }

    // Idle
    return (
      <Badge variant="default" className="gap-1">
        <Wifi className="h-3 w-3" />
        Online
        {pendingCount > 0 && (
          <span className="ml-1">({pendingCount} pending)</span>
        )}
      </Badge>
    );
  };

  return (
    <div className="flex items-center gap-2">
      {getStatusBadge()}
      {syncError && (
        <span className="text-xs text-muted-foreground" title={syncError}>
          {syncError.length > 50 ? `${syncError.substring(0, 50)}...` : syncError}
        </span>
      )}
    </div>
  );
}

