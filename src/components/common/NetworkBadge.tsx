/**
 * Network status badge component
 * Shows online/offline status and sync state
 */

import { Badge } from '@/components/ui/badge';
import { Wifi } from 'lucide-react';

export default function NetworkBadge() {
      return (
        <div className="flex items-center gap-2">
      {/* Local SQLite build: treat app as always-online */}
        <Badge variant="default" className="gap-1 bg-green-600">
        <Wifi className="h-3 w-3" />
        Online
      </Badge>
    </div>
  );
}

