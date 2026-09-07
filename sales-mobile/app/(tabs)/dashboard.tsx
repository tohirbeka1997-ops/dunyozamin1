import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchCurrentShift, fetchDailyReport, fetchQueueCounts } from '@/api/client';
import { t } from '@/i18n';
import type { CurrentShiftResponse, DailyReport } from '@/types/sales';

function formatMoney(n?: number | null): string {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

function KpiTile({
  label,
  value,
  emphasize,
  danger,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  danger?: boolean;
}) {
  return (
    <View style={[styles.kpi, emphasize && styles.kpiEmphasize]}>
      <Text style={styles.kpiLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.kpiValue, emphasize && styles.kpiValueEmphasize, danger && styles.kpiDanger]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [shift, setShift] = useState<CurrentShiftResponse | null>(null);
  const [incoming, setIncoming] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [report, current, queues] = await Promise.all([
        fetchDailyReport(),
        fetchCurrentShift().catch(() => null),
        fetchQueueCounts().catch(() => null),
      ]);
      setDaily(report);
      setShift(current);
      setIncoming(Math.max(0, Number(queues?.incoming) || 0));
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

  if (loading && !daily) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  const summary = shift?.summary;
  const expected = Number(summary?.expectedCash);
  const hasShift = !!shift?.shift;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Text style={styles.title}>{t('dashboard')}</Text>
      <Text style={styles.subtitle}>
        {daily?.date || '—'} · {t('todayOverview')}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.kpiGrid}>
        <KpiTile
          label={t('salesTotal')}
          value={formatMoney(daily?.total_sales)}
          emphasize
        />
        <KpiTile label={t('ordersCount')} value={String(daily?.order_count ?? 0)} />
        <KpiTile label={t('cashSales')} value={formatMoney(daily?.cash_total)} />
        <KpiTile label={t('cardSales')} value={formatMoney(daily?.card_total)} />
        <KpiTile label={t('creditSale')} value={formatMoney(daily?.credit_total)} />
        <KpiTile
          label={t('incoming')}
          value={String(incoming)}
          danger={incoming > 0}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('shift')}</Text>
        {hasShift ? (
          <>
            <Text style={styles.shiftMeta} numberOfLines={1}>
              {shift?.shift?.shift_number}
              {shift?.is_own_shift === false ? ` · ${t('shiftOwnedByOther')}` : ''}
            </Text>
            <View style={styles.shiftRows}>
              <View style={styles.shiftRow}>
                <Text style={styles.shiftLabel}>{t('cashSales')}</Text>
                <Text style={styles.shiftValue}>{formatMoney(summary?.cashSales)}</Text>
              </View>
              <View style={styles.shiftRow}>
                <Text style={styles.shiftLabel}>{t('expectedCash')}</Text>
                <Text
                  style={[
                    styles.shiftValue,
                    styles.shiftValueBold,
                    Number.isFinite(expected) && expected < 0 && styles.kpiDanger,
                  ]}
                >
                  {formatMoney(summary?.expectedCash)}
                </Text>
              </View>
              <View style={styles.shiftRow}>
                <Text style={styles.shiftLabel}>{t('ordersCount')}</Text>
                <Text style={styles.shiftValue}>{String(summary?.orders ?? 0)}</Text>
              </View>
            </View>
            <Pressable style={styles.linkBtn} onPress={() => router.push('/(tabs)/shift')}>
              <Text style={styles.linkBtnText}>{t('openShiftPanel')}</Text>
              <Ionicons name="chevron-forward" size={16} color="#166534" />
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.emptyShift}>{t('noOpenShift')}</Text>
            <Pressable style={styles.primaryBtn} onPress={() => router.push('/(tabs)/shift')}>
              <Text style={styles.primaryBtnText}>{t('openShift')}</Text>
            </Pressable>
          </>
        )}
      </View>

      <Text style={styles.sectionLabel}>{t('quickActions')}</Text>
      <View style={styles.actions}>
        <Pressable style={styles.action} onPress={() => router.push('/(tabs)/sell')}>
          <Ionicons name="pricetag-outline" size={20} color="#166534" />
          <Text style={styles.actionText}>{t('sell')}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => router.push('/(tabs)/orders')}>
          <Ionicons name="list-outline" size={20} color="#166534" />
          <Text style={styles.actionText}>{t('orders')}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => router.push('/(tabs)/cart')}>
          <Ionicons name="cart-outline" size={20} color="#166534" />
          <Text style={styles.actionText}>{t('cart')}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => router.push('/expenses' as never)}>
          <Ionicons name="wallet-outline" size={20} color="#166534" />
          <Text style={styles.actionText}>{t('expenses')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 12, paddingBottom: 28 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2, marginBottom: 12 },
  error: { color: '#dc2626', marginBottom: 8, fontSize: 12 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpi: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    paddingVertical: 10,
    paddingHorizontal: 10,
    minWidth: '46%',
  },
  kpiEmphasize: { borderColor: '#86efac', backgroundColor: '#f0fdf4' },
  kpiLabel: { fontSize: 11, color: '#64748b', fontWeight: '600' },
  kpiValue: { fontSize: 14, color: '#0f172a', fontWeight: '700', marginTop: 4 },
  kpiValueEmphasize: { color: '#166534', fontSize: 15 },
  kpiDanger: { color: '#dc2626' },
  card: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    padding: 12,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a', marginBottom: 6 },
  shiftMeta: { fontSize: 12, color: '#64748b', marginBottom: 8 },
  shiftRows: { gap: 4 },
  shiftRow: { flexDirection: 'row', justifyContent: 'space-between' },
  shiftLabel: { fontSize: 12, color: '#64748b' },
  shiftValue: { fontSize: 12, color: '#0f172a', fontWeight: '600' },
  shiftValueBold: { fontWeight: '800' },
  emptyShift: { fontSize: 13, color: '#94a3b8', marginBottom: 10 },
  linkBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  linkBtnText: { color: '#166534', fontWeight: '700', fontSize: 13 },
  primaryBtn: {
    backgroundColor: '#166534',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  sectionLabel: {
    marginTop: 16,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    width: '23%',
    flexGrow: 1,
    minWidth: 72,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    paddingVertical: 12,
    alignItems: 'center',
    gap: 4,
  },
  actionText: { fontSize: 11, fontWeight: '600', color: '#0f172a' },
});
