import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/hooks/use-toast';
import {
  listUnreadStaffCreditAlerts,
  markStaffCreditAlertRead,
  type StaffCreditAlertRow,
} from '@/db/customerCredit.api';
import { hasPosApi } from '@/db/internal';

const POLL_MS = 60_000;

/**
 * Polls unread nasiya due-date alerts for cashiers/admins and shows in-app toasts.
 */
export default function CreditStaffAlerts() {
  const { t } = useTranslation();
  const seenRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!hasPosApi()) return;

    let cancelled = false;

    async function poll() {
      try {
        const rows = await listUnreadStaffCreditAlerts({ limit: 20 });
        if (cancelled || !rows.length) return;

        for (const row of rows) {
          if (seenRef.current.has(row.id)) continue;
          seenRef.current.add(row.id);
          showAlertToast(row, t);
          void markStaffCreditAlertRead(row.id).catch(() => {});
        }
      } catch {
        // ignore polling errors
      }
    }

    void poll();
    const interval = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [t]);

  return null;
}

function showAlertToast(row: StaffCreditAlertRow, t: (key: string, opts?: Record<string, unknown>) => string) {
  toast({
    title: row.title || t('pos.credit_staff_alert_title'),
    description: row.body,
    duration: 12_000,
    className: 'bg-amber-50 border-amber-300 dark:bg-amber-950/40 dark:border-amber-700',
  });
}
