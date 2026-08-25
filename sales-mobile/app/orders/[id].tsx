import { Alert } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { cancelOrder, dispatchCourier, fetchOrder, updateOrderStatus } from '@/api/client';
import { useRequireStaffAccess } from '@/hooks/useRequireStaffAccess';
import { statusLabel, t } from '@/i18n';
import type { WebOrderDetail, WebOrderStatus } from '@/types/orders';

function formatMoney(n?: number | null): string {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

const ACTION_LABELS: Partial<Record<WebOrderStatus, string>> = {
  processing: 'Tayyorlash',
  ready: 'Tayyor',
  out_for_delivery: 'Kuryerga',
  delivered: 'Yetkazildi',
  cancelled: 'Bekor qilish',
};

export default function OrderDetailScreen() {
  const allowed = useRequireStaffAccess('orders');
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<WebOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await fetchOrder(id);
      setOrder(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      if (!allowed) return;
      setLoading(true);
      void load();
    }, [allowed, load]),
  );

  async function applyStatus(status: WebOrderStatus) {
    if (!id || acting) return;
    if (status === 'cancelled') {
      Alert.alert(t('cancelOrderTitle'), t('cancelOrderConfirm'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('confirmCancel'),
          style: 'destructive',
          onPress: () => void runCancel(),
        },
      ]);
      return;
    }
    setActing(true);
    setError(null);
    try {
      const updated = await updateOrderStatus(id, status);
      setOrder(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xatolik');
    } finally {
      setActing(false);
    }
  }

  async function runCancel() {
    if (!id || acting) return;
    setActing(true);
    setError(null);
    try {
      const updated = await cancelOrder(id);
      setOrder(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xatolik');
    } finally {
      setActing(false);
    }
  }

  async function handleDispatch() {
    if (!id || acting) return;
    setActing(true);
    setError(null);
    try {
      const updated = await dispatchCourier(id);
      setOrder(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xatolik');
    } finally {
      setActing(false);
    }
  }

  if (!allowed || (loading && !order)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || 'Topilmadi'}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Orqaga</Text>
        </Pressable>
      </View>
    );
  }

  const customer = [order.first_name, order.last_name].filter(Boolean).join(' ') || order.phone || '—';
  const nextStatuses = (order.allowed_next_statuses || []).filter(
    (st) =>
      !(
        st === 'out_for_delivery' &&
        order.status === 'ready' &&
        order.delivery_method !== 'pickup'
      ),
  );
  const showDispatch = order.status === 'ready' && order.delivery_method !== 'pickup';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.orderNo}>{order.order_number}</Text>
      <Text style={styles.statusBadge}>{statusLabel(order.status)}</Text>

      <View style={styles.block}>
        <Text style={styles.label}>{t('customer')}</Text>
        <Text style={styles.value}>{customer}</Text>
        {order.phone ? <Text style={styles.sub}>{order.phone}</Text> : null}
      </View>

      {order.delivery_address ? (
        <View style={styles.block}>
          <Text style={styles.label}>{t('address')}</Text>
          <Text style={styles.value}>{order.delivery_address}</Text>
        </View>
      ) : null}

      {order.note ? (
        <View style={styles.block}>
          <Text style={styles.label}>Eslatma</Text>
          <Text style={styles.value}>{order.note}</Text>
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={styles.label}>{t('items')}</Text>
        {(order.items || []).map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <Text style={styles.itemName}>
              {item.product_name || item.product_id} × {item.quantity}
            </Text>
            <Text style={styles.itemPrice}>{formatMoney(item.price_at_order * item.quantity)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>{t('total')}</Text>
        <Text style={styles.total}>{formatMoney(order.total_amount)}</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.actionsTitle}>{t('nextStatus')}</Text>
      <View style={styles.actions}>
        {nextStatuses.map((st) => (
          <Pressable
            key={st}
            style={[styles.actionBtn, st === 'cancelled' && styles.actionDanger, acting && styles.disabled]}
            disabled={acting}
            onPress={() => applyStatus(st)}
          >
            <Text style={[styles.actionText, st === 'cancelled' && styles.actionTextDanger]}>
              {ACTION_LABELS[st] || statusLabel(st)}
            </Text>
          </Pressable>
        ))}
        {showDispatch ? (
          <Pressable
            style={[styles.actionBtn, styles.actionPrimary, acting && styles.disabled]}
            disabled={acting}
            onPress={handleDispatch}
          >
            <Text style={styles.actionTextPrimary}>{t('dispatchCourier')}</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  orderNo: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  statusBadge: {
    alignSelf: 'flex-start',
    marginTop: 8,
    marginBottom: 16,
    backgroundColor: '#dcfce7',
    color: '#166534',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
    fontWeight: '600',
  },
  block: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  label: { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 4 },
  value: { fontSize: 15, color: '#0f172a' },
  sub: { fontSize: 13, color: '#64748b', marginTop: 2 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  itemName: { flex: 1, fontSize: 14, color: '#334155' },
  itemPrice: { fontSize: 14, fontWeight: '500', color: '#0f172a' },
  total: { fontSize: 20, fontWeight: '700', color: '#166534' },
  actionsTitle: { fontSize: 14, fontWeight: '600', color: '#475569', marginTop: 16, marginBottom: 8 },
  actions: { gap: 8 },
  actionBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#166534',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionPrimary: { backgroundColor: '#166534', borderColor: '#166534' },
  actionDanger: { borderColor: '#dc2626' },
  actionText: { fontSize: 16, fontWeight: '600', color: '#166534' },
  actionTextPrimary: { fontSize: 16, fontWeight: '600', color: '#fff' },
  actionTextDanger: { color: '#dc2626' },
  disabled: { opacity: 0.6 },
  error: { color: '#dc2626', marginVertical: 8 },
  link: { color: '#166534', marginTop: 12, fontWeight: '600' },
});
