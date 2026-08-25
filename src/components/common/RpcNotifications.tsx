import { useEffect } from 'react';
import { toast } from '@/hooks/use-toast';
import type { RpcNoticeDetail } from '@/lib/remotePosApi';

/**
 * Bridges centralized transport-level RPC notices (`pos:rpc:notice`, dispatched
 * by `remotePosApi`) into user-facing toasts. This guarantees that rate-limit
 * (429), network, and 5xx failures are NEVER silent — the operator always sees
 * what happened instead of a button that appears dead.
 *
 * Business errors (validation / not-found / forbidden) and auth-required are
 * intentionally NOT routed here; the relevant screens render contextual
 * messages for those.
 */
export default function RpcNotifications() {
  useEffect(() => {
    // Light de-dupe so a burst of identical notices (e.g. several reads hitting
    // the same 429) doesn't spam the same toast repeatedly.
    let lastKey = '';
    let lastAt = 0;

    function onNotice(ev: Event) {
      const detail = (ev as CustomEvent<RpcNoticeDetail>).detail;
      if (!detail || !detail.message) return;

      const key = `${detail.level}:${detail.message}`;
      const now = Date.now();
      if (key === lastKey && now - lastAt < 4000) return;
      lastKey = key;
      lastAt = now;

      if (detail.level === 'error') {
        toast({
          title: '❌ Aloqa xatosi',
          description: detail.message,
          variant: 'destructive',
          duration: 8000,
        });
      } else {
        toast({
          title: 'Iltimos kuting',
          description: detail.message,
          className: 'bg-amber-50 border-amber-200',
          duration: 4000,
        });
      }
    }

    window.addEventListener('pos:rpc:notice', onNotice);
    return () => window.removeEventListener('pos:rpc:notice', onNotice);
  }, []);

  return null;
}
