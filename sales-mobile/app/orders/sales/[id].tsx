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
import { fetchReturnableSale, fetchSale } from '@/api/client';
import { paymentMethodLabel, salesChannelLabel, t } from '@/i18n';
import type { SaleOrder } from '@/types/sales';

function formatMoney(n?: number | null): string {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function PosSaleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [sale, setSale] = useState<SaleOrder | null>(null);
  const [canReturn, setCanReturn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await fetchSale(id);
      setSale(data);
      if (String(data.status || '').toLowerCase() === 'completed') {
        try {
          const returnable = await fetchReturnableSale(id);
          setCanReturn(!!returnable.has_returnable);
        } catch {
          setCanReturn(false);
        }
      } else {
        setCanReturn(false);
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

  if (loading && !sale) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (!sale) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || 'Topilmadi'}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>{t('back')}</Text>
        </Pressable>
      </View>
    );
  }

  const payments = sale.payments || [];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.orderNo}>{sale.order_number}</Text>
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{salesChannelLabel(sale.sales_channel)}</Text>
        </View>
        <Text style={styles.statusBadge}>{t('completed')}</Text>
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>{t('saleDate')}</Text>
        <Text style={styles.value}>{formatDate(sale.created_at)}</Text>
      </View>

      {sale.customer_name ? (
        <View style={styles.block}>
          <Text style={styles.label}>{t('customer')}</Text>
          <Text style={styles.value}>{sale.customer_name}</Text>
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={styles.label}>{t('items')}</Text>
        {(sale.items || []).map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <Text style={styles.itemName}>
              {item.product_name || item.product_id} × {item.quantity}
            </Text>
            <Text style={styles.itemPrice}>{formatMoney(item.line_total ?? item.unit_price * item.quantity)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>{t('paymentMethod')}</Text>
        {payments.length > 0 ? (
          payments.map((p, idx) => (
            <Text key={idx} style={styles.value}>
              {paymentMethodLabel(p.payment_method)} — {formatMoney(p.amount)}
            </Text>
          ))
        ) : (
          <Text style={styles.value}>—</Text>
        )}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>{t('total')}</Text>
        <Text style={styles.total}>{formatMoney(sale.total_amount)}</Text>
        {sale.change_amount != null && sale.change_amount > 0 ? (
          <Text style={styles.sub}>
            {t('change')}: {formatMoney(sale.change_amount)}
          </Text>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {canReturn ? (
        <Pressable style={styles.returnBtn} onPress={() => router.push(`/orders/sales/${sale.id}/return`)}>
          <Text style={styles.returnBtnText}>{t('returnSale')}</Text>
        </Pressable>
      ) : null}

      <Pressable style={styles.receiptBtn} onPress={() => router.push(`/sell/receipt?id=${sale.id}`)}>
        <Text style={styles.receiptBtnText}>{t('viewReceipt')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  orderNo: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 16 },
  badge: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: { fontSize: 12, fontWeight: '600', color: '#0369a1' },
  statusBadge: {
    backgroundColor: '#dcfce7',
    color: '#166534',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
    fontWeight: '600',
    fontSize: 12,
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
  sub: { fontSize: 13, color: '#64748b', marginTop: 4 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  itemName: { flex: 1, fontSize: 14, color: '#334155' },
  itemPrice: { fontSize: 14, fontWeight: '500', color: '#0f172a' },
  total: { fontSize: 20, fontWeight: '700', color: '#166534' },
  returnBtn: {
    backgroundColor: '#b45309',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  returnBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  receiptBtn: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  receiptBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  error: { color: '#dc2626', marginVertical: 8 },
  link: { color: '#166534', marginTop: 12, fontWeight: '600' },
});

