import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchPurchaseOrder, receivePurchaseOrder } from '@/api/client';
import { useRequireStaffAccess } from '@/hooks/useRequireStaffAccess';
import { poStatusLabel, t } from '@/i18n';
import type { PurchaseOrder, PurchaseOrderItem } from '@/types/customers';

function formatMoney(n?: number | null): string {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

function remainingQty(item: PurchaseOrderItem): number {
  return Math.max(0, Number(item.ordered_qty || 0) - Number(item.received_qty || 0));
}

type ReceiveQtyMap = Record<string, number>;

export default function PurchaseOrderDetailScreen() {
  const allowed = useRequireStaffAccess('purchasing');
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiveQty, setReceiveQty] = useState<ReceiveQtyMap>({});

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await fetchPurchaseOrder(id);
      setPo(data);
      const initial: ReceiveQtyMap = {};
      for (const it of data.items || []) {
        initial[it.id] = 0;
      }
      setReceiveQty(initial);
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

  const canReceive = po != null && po.status !== 'cancelled' && po.status !== 'received';

  if (!allowed) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' }}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }
  const selectedItems = useMemo(() => {
    if (!po?.items) return [];
    return po.items
      .map((it) => ({
        item_id: it.id,
        product_id: it.product_id,
        received_qty: receiveQty[it.id] || 0,
        remaining: remainingQty(it),
      }))
      .filter((it) => it.received_qty > 0);
  }, [po, receiveQty]);

  function setLineQty(itemId: string, next: number, max: number) {
    setReceiveQty((prev) => ({ ...prev, [itemId]: Math.max(0, Math.min(max, next)) }));
  }

  function fillAllRemaining() {
    if (!po?.items) return;
    const next: ReceiveQtyMap = {};
    for (const it of po.items) {
      next[it.id] = remainingQty(it);
    }
    setReceiveQty(next);
  }

  async function submitReceive(items: { item_id: string; received_qty: number; product_id?: string }[]) {
    if (!po || receiving || items.length === 0) return;
    setReceiving(true);
    try {
      await receivePurchaseOrder(po.id, { items });
      Alert.alert(t('goodsReceived'));
      await load();
    } catch (e) {
      Alert.alert(t('networkError'), e instanceof Error ? e.message : '');
    } finally {
      setReceiving(false);
    }
  }

  function handleReceiveSelected() {
    if (selectedItems.length === 0) {
      Alert.alert(t('receiveGoods'), t('selectReturnQty'));
      return;
    }
    Alert.alert(t('receivePartial'), t('receivePartial'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('done'),
        onPress: () =>
          void submitReceive(
            selectedItems.map((it) => ({
              item_id: it.item_id,
              received_qty: it.received_qty,
              product_id: it.product_id,
            })),
          ),
      },
    ]);
  }

  function handleReceiveAll() {
    if (!po) return;
    const items = (po.items || [])
      .map((it) => ({ item_id: it.id, received_qty: remainingQty(it), product_id: it.product_id }))
      .filter((it) => it.received_qty > 0);
    if (items.length === 0) return;

    Alert.alert(t('receiveAll'), t('receiveAll'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('done'), onPress: () => void submitReceive(items) },
    ]);
  }

  if (loading && !po) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (!po) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || t('noPurchaseOrders')}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>{t('back')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.poNumber}>{po.po_number}</Text>
      <Text style={styles.sub}>{po.supplier_name || '—'}</Text>
      <Text style={styles.meta}>
        {t('poStatus')}: {poStatusLabel(po.status)} · {formatMoney(po.total_amount)}
      </Text>

      {(po.items || []).map((item) => {
        const rem = remainingQty(item);
        const selected = receiveQty[item.id] || 0;
        return (
          <View key={item.id} style={styles.line}>
            <Text style={styles.lineName}>{item.product_name || item.product_id}</Text>
            <Text style={styles.lineMeta}>
              {t('orderedQty')}: {item.ordered_qty} · {t('receivedQty')}: {item.received_qty ?? 0}
              {rem > 0 ? ` · ${t('remaining')}: ${rem}` : ''}
            </Text>
            {canReceive && rem > 0 ? (
              <View style={styles.qtyRow}>
                <Pressable style={styles.qtyBtn} onPress={() => setLineQty(item.id, selected - 1, rem)}>
                  <Text style={styles.qtyBtnText}>−</Text>
                </Pressable>
                <Text style={styles.qtyValue}>{selected}</Text>
                <Pressable style={styles.qtyBtn} onPress={() => setLineQty(item.id, selected + 1, rem)}>
                  <Text style={styles.qtyBtnText}>+</Text>
                </Pressable>
                <Pressable style={styles.maxBtn} onPress={() => setLineQty(item.id, rem, rem)}>
                  <Text style={styles.maxBtnText}>MAX</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}

      {canReceive ? (
        <>
          <Pressable
            style={[styles.btn, receiving && styles.btnDisabled]}
            onPress={handleReceiveSelected}
            disabled={receiving}
          >
            <Text style={styles.btnText}>{receiving ? t('processing') : t('receivePartial')}</Text>
          </Pressable>
          <Pressable
            style={[styles.btnSecondary, receiving && styles.btnDisabled]}
            onPress={handleReceiveAll}
            disabled={receiving}
          >
            <Text style={styles.btnSecondaryText}>{t('receiveAll')}</Text>
          </Pressable>
          <Pressable style={styles.linkBtn} onPress={fillAllRemaining} disabled={receiving}>
            <Text style={styles.link}>{t('receiveQty')} → MAX</Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  poNumber: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  sub: { fontSize: 14, color: '#64748b', marginTop: 4 },
  meta: { fontSize: 13, color: '#475569', marginTop: 8, marginBottom: 16 },
  line: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  lineName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  lineMeta: { fontSize: 12, color: '#64748b', marginTop: 4 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10 },
  qtyBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  qtyValue: { fontSize: 16, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  maxBtn: {
    marginLeft: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  maxBtnText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  btn: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  btnSecondary: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#166534',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondaryText: { color: '#166534', fontWeight: '700', fontSize: 15 },
  linkBtn: { alignItems: 'center', marginTop: 10 },
  error: { color: '#dc2626', marginBottom: 12 },
  link: { color: '#166534', fontWeight: '600' },
});
