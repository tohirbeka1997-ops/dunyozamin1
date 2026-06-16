import { Alert } from 'react-native';
import type { Router } from 'expo-router';
import { t } from '@/i18n';
import { syncNow, type SyncResult } from '@/lib/offlineQueue';

export interface SyncFeedbackOptions {
  router?: Router;
  /** Navigate to receipt when user taps "View receipt" (default true when router given). */
  offerReceipt?: boolean;
}

/** Run offline sync and show success/error alerts. Returns sync result for badge refresh. */
export async function syncWithFeedback(opts: SyncFeedbackOptions = {}): Promise<SyncResult> {
  const result = await syncNow();

  if (result.syncedOrders.length === 1) {
    const order = result.syncedOrders[0];
    const buttons: { text: string; style?: 'cancel' | 'default'; onPress?: () => void }[] = [
      { text: t('done'), style: 'cancel' },
    ];
    if (opts.router && opts.offerReceipt !== false) {
      buttons.unshift({
        text: t('viewReceipt'),
        onPress: () =>
          opts.router!.push({ pathname: '/sell/receipt', params: { id: order.orderId } }),
      });
    }
    Alert.alert(
      t('saleSyncedTitle'),
      t('saleSyncedMessage').replace('{n}', order.orderNumber),
      buttons,
    );
  } else if (result.syncedOrders.length > 1) {
    Alert.alert(
      t('saleSyncedTitle'),
      t('saleSyncedMultiple').replace('{n}', String(result.syncedOrders.length)),
    );
  }

  return result;
}
