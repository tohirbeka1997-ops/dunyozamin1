import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchPurchaseOrders } from '@/api/client';
import { poStatusLabel, t } from '@/i18n';
import type { PurchaseOrder } from '@/types/customers';

function formatMoney(n?: number | null): string {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

export default function PurchasingScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await fetchPurchaseOrders();
      setOrders(rows);
    } catch (e) {
      setOrders([]);
      setError(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  return (
    <View style={styles.root}>
      <Pressable style={styles.createBtn} onPress={() => router.push('/purchase-orders/create')}>
        <Text style={styles.createBtnText}>+ {t('createPO')}</Text>
      </Pressable>

      {loading ? <ActivityIndicator color="#166534" style={{ marginTop: 24 }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          !loading && !error ? <Text style={styles.empty}>{t('noPurchaseOrders')}</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push({ pathname: '/purchase-orders/[id]', params: { id: item.id } })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.poNumber}>{item.po_number}</Text>
              <Text style={styles.meta}>{item.supplier_name || '—'}</Text>
            </View>
            <View style={styles.right}>
              <Text style={styles.status}>{poStatusLabel(item.status)}</Text>
              <Text style={styles.total}>{formatMoney(item.total_amount)}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  createBtn: {
    margin: 12,
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  row: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  poNumber: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  meta: { fontSize: 13, color: '#64748b', marginTop: 2 },
  right: { alignItems: 'flex-end' },
  status: { fontSize: 12, color: '#475569', marginBottom: 4 },
  total: { fontSize: 13, fontWeight: '600', color: '#166534' },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 24 },
  error: { color: '#dc2626', textAlign: 'center', marginTop: 12 },
});
