import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { createSaleReturn, fetchReturnableSale } from '@/api/client';
import { paymentMethodLabel, t } from '@/i18n';
import type { RefundMethod, ReturnableItem } from '@/types/sales';

function formatMoney(n?: number | null): string {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

type QtyMap = Record<string, number>;

export default function SaleReturnScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [items, setItems] = useState<ReturnableItem[]>([]);
  const [hasCustomer, setHasCustomer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('cash');
  const [qty, setQty] = useState<QtyMap>({});

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await fetchReturnableSale(id);
      setItems(data.items || []);
      setHasCustomer(!!data.customer?.id && data.customer.id !== 'default-customer-001');
      const initial: QtyMap = {};
      for (const it of data.items || []) {
        initial[it.order_item_id] = 0;
      }
      setQty(initial);
      if (!data.has_returnable) {
        setError(t('noReturnableItems'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  const selectedLines = useMemo(
    () => items.filter((it) => (qty[it.order_item_id] || 0) > 0),
    [items, qty],
  );

  const refundTotal = useMemo(
    () =>
      selectedLines.reduce((sum, it) => {
        const q = qty[it.order_item_id] || 0;
        return sum + it.unit_price * q;
      }, 0),
    [selectedLines, qty],
  );

  function setLineQty(orderItemId: string, next: number, max: number) {
    const clamped = Math.max(0, Math.min(max, next));
    setQty((prev) => ({ ...prev, [orderItemId]: clamped }));
  }

  async function handleSubmit() {
    if (!id || submitting) return;
    if (selectedLines.length === 0) {
      Alert.alert(t('returnScreen'), t('selectReturnQty'));
      return;
    }

    setSubmitting(true);
    try {
      await createSaleReturn({
        order_id: id,
        items: selectedLines.map((it) => ({
          order_item_id: it.order_item_id,
          quantity: qty[it.order_item_id],
        })),
        reason: reason.trim() || undefined,
        refund_method: refundMethod,
      });
      Alert.alert(t('returnComplete'), t('returnComplete'), [
        {
          text: t('done'),
          onPress: () => router.replace(`/orders/sales/${id}`),
        },
      ]);
    } catch (e) {
      Alert.alert(t('networkError'), e instanceof Error ? e.message : '');
    } finally {
      setSubmitting(false);
    }
  }

  const refundOptions: { key: RefundMethod; label: string; disabled?: boolean }[] = [
    { key: 'cash', label: paymentMethodLabel('cash') },
    { key: 'card', label: paymentMethodLabel('card') },
    { key: 'credit', label: t('refundToBalance'), disabled: !hasCustomer },
  ];

  if (loading && items.length === 0 && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {items.map((item) => {
        const selected = qty[item.order_item_id] || 0;
        return (
          <View key={item.order_item_id} style={styles.line}>
            <Text style={styles.lineName}>{item.product_name || item.product_id}</Text>
            <Text style={styles.lineMeta}>
              {t('returnableQty')}: {item.returnable_quantity} · {formatMoney(item.unit_price)}
            </Text>
            <View style={styles.qtyRow}>
              <Pressable
                style={styles.qtyBtn}
                onPress={() => setLineQty(item.order_item_id, selected - 1, item.returnable_quantity)}
              >
                <Text style={styles.qtyBtnText}>−</Text>
              </Pressable>
              <Text style={styles.qtyValue}>{selected}</Text>
              <Pressable
                style={styles.qtyBtn}
                onPress={() => setLineQty(item.order_item_id, selected + 1, item.returnable_quantity)}
              >
                <Text style={styles.qtyBtnText}>+</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      <View style={styles.block}>
        <Text style={styles.label}>{t('returnReason')}</Text>
        <TextInput
          style={styles.input}
          value={reason}
          onChangeText={setReason}
          placeholder={t('returnReason')}
          multiline
        />
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>{t('refundMethod')}</Text>
        <View style={styles.methodRow}>
          {refundOptions.map((opt) => (
            <Pressable
              key={opt.key}
              style={[
                styles.methodChip,
                refundMethod === opt.key && styles.methodChipActive,
                opt.disabled && styles.methodChipDisabled,
              ]}
              disabled={opt.disabled}
              onPress={() => setRefundMethod(opt.key)}
            >
              <Text
                style={[
                  styles.methodChipText,
                  refundMethod === opt.key && styles.methodChipTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {selectedLines.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.label}>{t('total')}</Text>
          <Text style={styles.total}>{formatMoney(refundTotal)}</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.submitBtn, (submitting || items.length === 0) && styles.submitBtnDisabled]}
        onPress={handleSubmit}
        disabled={submitting || items.length === 0}
      >
        <Text style={styles.submitBtnText}>{submitting ? t('processing') : t('submitReturn')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  line: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  lineName: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  lineMeta: { fontSize: 12, color: '#64748b', marginTop: 4 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 12 },
  qtyBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  qtyValue: { fontSize: 18, fontWeight: '700', minWidth: 32, textAlign: 'center' },
  block: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  label: { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    minHeight: 44,
    color: '#0f172a',
  },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  methodChipActive: { backgroundColor: '#dcfce7', borderColor: '#166534' },
  methodChipDisabled: { opacity: 0.45 },
  methodChipText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  methodChipTextActive: { color: '#166534' },
  total: { fontSize: 20, fontWeight: '700', color: '#166534' },
  submitBtn: {
    backgroundColor: '#b45309',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.55 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  error: { color: '#dc2626', marginBottom: 8 },
});
