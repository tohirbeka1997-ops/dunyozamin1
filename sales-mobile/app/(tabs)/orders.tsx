import { useCallback, useState } from 'react';

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import {

  ActivityIndicator,

  FlatList,

  Pressable,

  RefreshControl,

  StyleSheet,

  Text,

  View,

} from 'react-native';

import { fetchOrders, fetchPosSales } from '@/api/client';

import { paymentMethodLabel, salesChannelLabel, statusLabel, t } from '@/i18n';

import type { WebOrderQueueId, WebOrderSummary } from '@/types/orders';

import type { PosSaleSummary } from '@/types/sales';



type OrdersMode = 'online' | 'sales';



const QUEUES: WebOrderQueueId[] = ['incoming', 'preparing', 'ready', 'delivering', 'delivered'];



const queueLabelKey: Record<WebOrderQueueId, string> = {

  incoming: 'incoming',

  preparing: 'preparing',

  ready: 'ready',

  delivering: 'delivering',

  delivered: 'delivered',

};



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



function customerName(o: WebOrderSummary): string {

  const parts = [o.first_name, o.last_name].filter(Boolean);

  return parts.length ? parts.join(' ') : o.phone || '—';

}



function primaryPayment(methods?: string | null): string {

  const first = String(methods || '')

    .split(',')

    .map((s) => s.trim())

    .find(Boolean);

  return paymentMethodLabel(first);

}



export default function OrdersListScreen() {

  const router = useRouter();

  const params = useLocalSearchParams<{ queue?: string; mode?: string }>();

  const initialMode = params.mode === 'sales' ? 'sales' : 'online';

  const initialQueue = (QUEUES.includes(params.queue as WebOrderQueueId)

    ? params.queue

    : 'incoming') as WebOrderQueueId;



  const [mode, setMode] = useState<OrdersMode>(initialMode);

  const [queue, setQueue] = useState<WebOrderQueueId>(initialQueue);

  const [orders, setOrders] = useState<WebOrderSummary[]>([]);

  const [sales, setSales] = useState<PosSaleSummary[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);



  const load = useCallback(async () => {

    setError(null);

    try {

      if (mode === 'online') {

        const result = await fetchOrders(queue, 1);

        setOrders(result.data);

      } else {

        const result = await fetchPosSales(1);

        setSales(result.data);

      }

    } catch (e) {

      setError(e instanceof Error ? e.message : t('networkError'));

    } finally {

      setLoading(false);

    }

  }, [mode, queue]);



  useFocusEffect(

    useCallback(() => {

      setLoading(true);

      void load();

    }, [load]),

  );



  const isEmpty = mode === 'online' ? orders.length === 0 : sales.length === 0;

  const emptyLabel = mode === 'online' ? t('noOrders') : t('noSales');



  return (

    <View style={styles.root}>

      <View style={styles.segments}>

        <Pressable

          style={[styles.segment, mode === 'online' && styles.segmentActive]}

          onPress={() => {

            setMode('online');

            setLoading(true);

          }}

        >

          <Text style={[styles.segmentText, mode === 'online' && styles.segmentTextActive]}>

            {t('onlineOrders')}

          </Text>

        </Pressable>

        <Pressable

          style={[styles.segment, mode === 'sales' && styles.segmentActive]}

          onPress={() => {

            setMode('sales');

            setLoading(true);

          }}

        >

          <Text style={[styles.segmentText, mode === 'sales' && styles.segmentTextActive]}>

            {t('posSales')}

          </Text>

        </Pressable>

      </View>



      {mode === 'online' ? (

        <View style={styles.tabs}>

          {QUEUES.map((q) => (

            <Pressable

              key={q}

              style={[styles.tab, queue === q && styles.tabActive]}

              onPress={() => {

                setQueue(q);

                setLoading(true);

              }}

            >

              <Text style={[styles.tabText, queue === q && styles.tabTextActive]} numberOfLines={1}>

                {t(queueLabelKey[q])}

              </Text>

            </Pressable>

          ))}

        </View>

      ) : null}



      {error ? <Text style={styles.error}>{error}</Text> : null}



      {loading && isEmpty ? (

        <ActivityIndicator size="large" color="#166534" style={{ marginTop: 40 }} />

      ) : mode === 'online' ? (

        <FlatList

          data={orders}

          keyExtractor={(item) => String(item.id)}

          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}

          ListEmptyComponent={<Text style={styles.empty}>{emptyLabel}</Text>}

          contentContainerStyle={orders.length === 0 ? styles.emptyWrap : undefined}

          renderItem={({ item }) => (

            <Pressable style={styles.row} onPress={() => router.push(`/orders/${item.id}`)}>

              <View style={styles.rowTop}>

                <Text style={styles.orderNo}>{item.order_number}</Text>

                <Text style={styles.amount}>{formatMoney(item.total_amount)}</Text>

              </View>

              <Text style={styles.meta}>{customerName(item)}</Text>

              <Text style={styles.status}>{statusLabel(item.status)}</Text>

            </Pressable>

          )}

        />

      ) : (

        <FlatList

          data={sales}

          keyExtractor={(item) => item.id}

          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}

          ListEmptyComponent={<Text style={styles.empty}>{emptyLabel}</Text>}

          contentContainerStyle={sales.length === 0 ? styles.emptyWrap : undefined}

          renderItem={({ item }) => (

            <Pressable style={styles.row} onPress={() => router.push(`/orders/sales/${item.id}`)}>

              <View style={styles.rowTop}>

                <Text style={styles.orderNo}>{item.order_number}</Text>

                <Text style={styles.amount}>{formatMoney(item.total_amount)}</Text>

              </View>

              <Text style={styles.meta}>{item.customer_name || '—'}</Text>

              <View style={styles.rowBottom}>

                <View style={styles.badge}>

                  <Text style={styles.badgeText}>{salesChannelLabel(item.sales_channel)}</Text>

                </View>

                <Text style={styles.status}>{primaryPayment(item.payment_methods)}</Text>

                <Text style={styles.date}>{formatDate(item.created_at)}</Text>

              </View>

            </Pressable>

          )}

        />

      )}

    </View>

  );

}



const styles = StyleSheet.create({

  root: { flex: 1, backgroundColor: '#f8fafc' },

  segments: {

    flexDirection: 'row',

    padding: 12,

    paddingBottom: 8,

    gap: 8,

    backgroundColor: '#fff',

    borderBottomWidth: 1,

    borderBottomColor: '#e2e8f0',

  },

  segment: {

    flex: 1,

    paddingVertical: 10,

    borderRadius: 8,

    backgroundColor: '#f1f5f9',

    alignItems: 'center',

  },

  segmentActive: { backgroundColor: '#166534' },

  segmentText: { fontSize: 13, fontWeight: '600', color: '#475569' },

  segmentTextActive: { color: '#fff' },

  tabs: {

    flexDirection: 'row',

    flexWrap: 'wrap',

    gap: 6,

    padding: 12,

    paddingTop: 4,

    backgroundColor: '#fff',

    borderBottomWidth: 1,

    borderBottomColor: '#e2e8f0',

  },

  tab: {

    paddingHorizontal: 10,

    paddingVertical: 6,

    borderRadius: 16,

    backgroundColor: '#f1f5f9',

  },

  tabActive: { backgroundColor: '#166534' },

  tabText: { fontSize: 12, color: '#475569' },

  tabTextActive: { color: '#fff', fontWeight: '600' },

  row: {

    backgroundColor: '#fff',

    marginHorizontal: 12,

    marginTop: 10,

    padding: 14,

    borderRadius: 10,

    borderWidth: 1,

    borderColor: '#e2e8f0',

  },

  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  rowBottom: {

    flexDirection: 'row',

    alignItems: 'center',

    flexWrap: 'wrap',

    gap: 8,

    marginTop: 6,

  },

  orderNo: { fontSize: 16, fontWeight: '700', color: '#0f172a' },

  amount: { fontSize: 14, fontWeight: '600', color: '#166534' },

  meta: { fontSize: 13, color: '#64748b', marginTop: 4 },

  status: { fontSize: 12, color: '#334155', fontWeight: '500' },

  date: { fontSize: 11, color: '#94a3b8', marginLeft: 'auto' },

  badge: {

    backgroundColor: '#e0f2fe',

    paddingHorizontal: 8,

    paddingVertical: 2,

    borderRadius: 4,

  },

  badgeText: { fontSize: 11, fontWeight: '600', color: '#0369a1' },

  error: { color: '#dc2626', padding: 12 },

  empty: { textAlign: 'center', color: '#94a3b8', fontSize: 15 },

  emptyWrap: { flexGrow: 1, justifyContent: 'center', padding: 32 },

});


