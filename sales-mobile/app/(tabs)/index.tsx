import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchQueueCounts } from '@/api/client';
import { t } from '@/i18n';
import { isNotificationsEnabled } from '@/lib/notificationsPref';
import type { QueueCounts, WebOrderQueueId } from '@/types/orders';

const POLL_MS = 60_000;

const QUEUE_KEYS: { id: WebOrderQueueId; labelKey: string; color: string }[] = [
  { id: 'incoming', labelKey: 'incoming', color: '#2563eb' },
  { id: 'preparing', labelKey: 'preparing', color: '#d97706' },
  { id: 'ready', labelKey: 'ready', color: '#16a34a' },
  { id: 'delivering', labelKey: 'delivering', color: '#7c3aed' },
  { id: 'delivered', labelKey: 'delivered', color: '#64748b' },
];

export default function DashboardScreen() {
  const router = useRouter();
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const enabled = await isNotificationsEnabled();
      if (!enabled) {
        setCounts({ incoming: 0, preparing: 0, ready: 0, delivering: 0, delivered: 0 });
        return;
      }
      const data = await fetchQueueCounts();
      setCounts(data);
    } catch (e) {
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

  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const timer = setInterval(() => {
      if (appState.current === 'active') void load();
    }, POLL_MS);
    const sub = AppState.addEventListener('change', (next) => {
      if (appState.current.match(/inactive|background/) && next === 'active') void load();
      appState.current = next;
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [load]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Text style={styles.heading}>{t('queues')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading && !counts ? (
        <ActivityIndicator size="large" color="#166534" style={{ marginTop: 32 }} />
      ) : (
        <View style={styles.grid}>
          {QUEUE_KEYS.map((q) => (
            <Pressable
              key={q.id}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => router.push({ pathname: '/(tabs)/orders', params: { queue: q.id } })}
            >
              <Text style={[styles.count, { color: q.color }]}>
                {counts ? counts[q.id] : 0}
              </Text>
              <Text style={styles.label}>{t(q.labelKey)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 32 },
  heading: { fontSize: 22, fontWeight: '700', color: '#0f172a', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '47%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minHeight: 96,
    justifyContent: 'center',
  },
  cardPressed: { opacity: 0.85 },
  count: { fontSize: 32, fontWeight: '700' },
  label: { fontSize: 14, color: '#475569', marginTop: 4 },
  error: { color: '#dc2626', marginBottom: 12 },
});
