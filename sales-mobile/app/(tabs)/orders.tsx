import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  fetchOrders,
  fetchPosSales,
  fetchQueueCounts,
  updateOrderStatus,
} from '@/api/client';
import { loadUser } from '@/auth/session';
import { paymentMethodLabel, salesChannelLabel, statusLabel, t } from '@/i18n';
import { canAccessWebOrders } from '@/lib/staffAccess';
import type { QueueCounts, WebOrderQueueId, WebOrderStatus, WebOrderSummary } from '@/types/orders';
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

const NEXT_ACTION_LABEL_KEY: Partial<Record<WebOrderStatus, string>> = {
  processing: 'actionStartPreparing',
  ready: 'actionMarkReady',
  out_for_delivery: 'actionDispatchCourier',
  delivered: 'actionMarkDelivered',
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

function primaryNextStatus(order: WebOrderSummary): WebOrderStatus | null {
  const s = String(order.status || '').toLowerCase() as WebOrderStatus;
  const pickup = String(order.delivery_method || '').toLowerCase() === 'pickup';
  if (s === 'new' || s === 'paid') return 'processing';
  if (s === 'processing') return 'ready';
  if (s === 'ready') return pickup ? 'delivered' : 'out_for_delivery';
  if (s === 'out_for_delivery') return 'delivered';
  return null;
}

const EMPTY_COUNTS: QueueCounts = {
  incoming: 0,
  preparing: 0,
  ready: 0,
  delivering: 0,
  delivered: 0,
};

export default function OrdersListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ queue?: string; mode?: string }>();
  const initialQueue = (
    QUEUES.includes(params.queue as WebOrderQueueId) ? params.queue : 'incoming'
  ) as WebOrderQueueId;

  const [roleReady, setRoleReady] = useState(false);
  const [allowOnline, setAllowOnline] = useState(true);
  const [mode, setMode] = useState<OrdersMode>(params.mode === 'sales' ? 'sales' : 'online');
  const [queue, setQueue] = useState<WebOrderQueueId>(initialQueue);
  const [orders, setOrders] = useState<WebOrderSummary[]>([]);
  const [sales, setSales] = useState<PosSaleSummary[]>([]);
  const [counts, setCounts] = useState<QueueCounts>(EMPTY_COUNTS);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ordersPage, setOrdersPage] = useState(1);
  const [salesPage, setSalesPage] = useState(1);
  const [ordersHasMore, setOrdersHasMore] = useState(false);
  const [salesHasMore, setSalesHasMore] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadUser().then((u) => {
      const ok = canAccessWebOrders(u?.role);
      setAllowOnline(ok);
      if (!ok) setMode('sales');
      setRoleReady(true);
    });
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (mode === 'online') {
        const [result, queueCounts] = await Promise.all([
          fetchOrders(queue, 1, debouncedSearch),
          fetchQueueCounts().catch(() => null),
        ]);
        setOrders(result.data);
        setOrdersPage(1);
        setOrdersHasMore(result.meta.page < result.meta.total_pages);
        if (queueCounts) setCounts(queueCounts);
      } else {
        const result = await fetchPosSales(1, {
          q: debouncedSearch.length >= 2 ? debouncedSearch : undefined,
        });
        setSales(result.data);
        setSalesPage(1);
        setSalesHasMore(!!result.meta.has_more);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [mode, queue, debouncedSearch]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore) return;
    if (mode === 'online' && !ordersHasMore) return;
    if (mode === 'sales' && !salesHasMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      if (mode === 'online') {
        const nextPage = ordersPage + 1;
        const result = await fetchOrders(queue, nextPage, debouncedSearch);
        setOrders((prev) => [...prev, ...result.data]);
        setOrdersPage(nextPage);
        setOrdersHasMore(result.meta.page < result.meta.total_pages);
      } else {
        const nextPage = salesPage + 1;
        const result = await fetchPosSales(nextPage, {
          q: debouncedSearch.length >= 2 ? debouncedSearch : undefined,
        });
        setSales((prev) => [...prev, ...result.data]);
        setSalesPage(nextPage);
        setSalesHasMore(!!result.meta.has_more);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setLoadingMore(false);
    }
  }, [
    loading,
    loadingMore,
    mode,
    ordersHasMore,
    ordersPage,
    salesHasMore,
    salesPage,
    queue,
    debouncedSearch,
  ]);

  useFocusEffect(
    useCallback(() => {
      if (!roleReady) return;
      setLoading(true);
      void load();
    }, [load, roleReady]),
  );

  const isEmpty = mode === 'online' ? orders.length === 0 : sales.length === 0;

  const handleAdvance = useCallback(
    async (order: WebOrderSummary) => {
      const next = primaryNextStatus(order);
      if (!next || actingId != null) return;
      setActingId(order.id);
      setError(null);
      try {
        await updateOrderStatus(order.id, next);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : t('networkError'));
      } finally {
        setActingId(null);
      }
    },
    [actingId, load],
  );

  if (!roleReady) {
    return (
      <View style={styles.root}>
        <ActivityIndicator size="large" color="#166534" style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {allowOnline ? (
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
      ) : null}

      {mode === 'online' ? (
        <View style={styles.tabs}>
          {QUEUES.map((q) => {
            const n = counts[q] ?? 0;
            return (
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
                  {n > 0 ? ` (${n})` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder={t('searchOrders')}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading && isEmpty ? (
        <ActivityIndicator size="large" color="#166534" style={{ marginTop: 40 }} />
      ) : mode === 'online' ? (
        <FlatList
          data={orders}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.empty}>{t('noOrders')}</Text>
              <Text style={styles.emptyHint}>{t('emptyOrdersHint')}</Text>
              <View style={styles.emptyActions}>
                <Pressable
                  style={styles.emptyBtnSecondary}
                  onPress={() => {
                    setLoading(true);
                    void load();
                  }}
                >
                  <Text style={styles.emptyBtnSecondaryText}>{t('refresh')}</Text>
                </Pressable>
                <Pressable style={styles.emptyBtn} onPress={() => router.push('/(tabs)/sell')}>
                  <Text style={styles.emptyBtnText}>{t('goToSell')}</Text>
                </Pressable>
              </View>
            </View>
          }
          contentContainerStyle={orders.length === 0 ? styles.emptyWrap : styles.listContent}
          renderItem={({ item }) => {
            const next = primaryNextStatus(item);
            const busy = actingId === item.id;
            return (
              <Pressable style={styles.row} onPress={() => router.push(`/orders/${item.id}`)}>
                <View style={styles.rowTop}>
                  <Text style={styles.orderNo}>{item.order_number}</Text>
                  <Text style={styles.amount}>{formatMoney(item.total_amount)}</Text>
                </View>
                <Text style={styles.meta} numberOfLines={1}>
                  {customerName(item)}
                  {item.phone ? ` · ${item.phone}` : ''}
                </Text>
                <View style={styles.rowBottom}>
                  <Text style={styles.status}>{statusLabel(item.status)}</Text>
                  {item.delivery_address ? (
                    <Text style={styles.addr} numberOfLines={1}>
                      {item.delivery_address}
                    </Text>
                  ) : null}
                </View>
                {next ? (
                  <Pressable
                    style={[styles.nextBtn, busy && styles.nextBtnDisabled]}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      void handleAdvance(item);
                    }}
                    disabled={busy}
                  >
                    <Text style={styles.nextBtnText}>
                      {busy
                        ? t('processing')
                        : t(NEXT_ACTION_LABEL_KEY[next] || 'nextStatus')}
                    </Text>
                  </Pressable>
                ) : null}
              </Pressable>
            );
          }}
          ListFooterComponent={
            ordersHasMore ? (
              <Pressable
                style={styles.loadMoreBtn}
                onPress={() => void loadMore()}
                disabled={loadingMore}
              >
                <Text style={styles.loadMoreText}>
                  {loadingMore ? t('processing') : t('loadMore')}
                </Text>
              </Pressable>
            ) : null
          }
        />
      ) : (
        <FlatList
          data={sales}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.empty}>{t('noSales')}</Text>
              <View style={styles.emptyActions}>
                <Pressable
                  style={styles.emptyBtnSecondary}
                  onPress={() => {
                    setLoading(true);
                    void load();
                  }}
                >
                  <Text style={styles.emptyBtnSecondaryText}>{t('refresh')}</Text>
                </Pressable>
                <Pressable style={styles.emptyBtn} onPress={() => router.push('/(tabs)/sell')}>
                  <Text style={styles.emptyBtnText}>{t('goToSell')}</Text>
                </Pressable>
              </View>
            </View>
          }
          contentContainerStyle={sales.length === 0 ? styles.emptyWrap : styles.listContent}
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
          ListFooterComponent={
            salesHasMore ? (
              <Pressable
                style={styles.loadMoreBtn}
                onPress={() => void loadMore()}
                disabled={loadingMore}
              >
                <Text style={styles.loadMoreText}>
                  {loadingMore ? t('processing') : t('loadMore')}
                </Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  segments: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 6,
    backgroundColor: '#fff',
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  segmentActive: { backgroundColor: '#166534' },
  segmentText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  segmentTextActive: { color: '#fff' },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    paddingHorizontal: 10,
    paddingBottom: 8,
    paddingTop: 2,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  tab: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
  },
  tabActive: { backgroundColor: '#166534' },
  tabText: { fontSize: 11, color: '#475569' },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  searchWrap: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  search: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    backgroundColor: '#f8fafc',
  },
  listContent: { paddingBottom: 12 },
  row: {
    backgroundColor: '#fff',
    marginHorizontal: 10,
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  orderNo: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  amount: { fontSize: 13, fontWeight: '600', color: '#166534' },
  meta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  status: { fontSize: 11, color: '#334155', fontWeight: '500' },
  addr: { fontSize: 11, color: '#94a3b8', flex: 1 },
  date: { fontSize: 11, color: '#94a3b8', marginLeft: 'auto' },
  badge: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  badgeText: { fontSize: 10, fontWeight: '600', color: '#0369a1' },
  nextBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#166534',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  nextBtnDisabled: { opacity: 0.6 },
  nextBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  error: { color: '#dc2626', paddingHorizontal: 12, paddingVertical: 6, fontSize: 12 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  emptyBox: { alignItems: 'center' },
  empty: { textAlign: 'center', color: '#64748b', fontSize: 15, fontWeight: '600' },
  emptyHint: { textAlign: 'center', color: '#94a3b8', fontSize: 12, marginTop: 6 },
  emptyActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  emptyBtn: {
    backgroundColor: '#166534',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  emptyBtnSecondary: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
  },
  emptyBtnSecondaryText: { color: '#334155', fontWeight: '600', fontSize: 13 },
  loadMoreBtn: {
    marginHorizontal: 10,
    marginTop: 8,
    marginBottom: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
  },
  loadMoreText: { color: '#166534', fontWeight: '700', fontSize: 13 },
});
