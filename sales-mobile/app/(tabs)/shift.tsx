import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
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
import { closeShift, fetchCurrentShift, fetchDailyReport, openShift } from '@/api/client';
import { t } from '@/i18n';
import type { CurrentShiftResponse, DailyReport } from '@/types/sales';

function formatMoney(n?: number | null): string {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

function parseCashInput(raw: string): number | null {
  const trimmed = String(raw || '').trim().replace(/\s/g, '');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function Row({
  label,
  value,
  bold,
  danger,
}: {
  label: string;
  value: string;
  bold?: boolean;
  danger?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          bold && styles.rowValueBold,
          danger && styles.rowValueDanger,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export default function ShiftScreen() {
  const router = useRouter();
  const [current, setCurrent] = useState<CurrentShiftResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cashInput, setCashInput] = useState('');
  const [daily, setDaily] = useState<DailyReport | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [data, report] = await Promise.all([fetchCurrentShift(), fetchDailyReport()]);
      setCurrent(data);
      setDaily(report);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      setInfo(null);
      void load();
    }, [load]),
  );

  async function handleOpen() {
    if (acting) return;
    const cash = parseCashInput(cashInput) ?? 0;
    setActing(true);
    setError(null);
    setInfo(null);
    try {
      await openShift(cash);
      setCashInput('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setActing(false);
    }
  }

  function requestClose() {
    if (acting) return;
    const cash = parseCashInput(cashInput);
    if (cash == null) {
      setError(t('closingCashRequired'));
      return;
    }
    const expected = Number(current?.summary?.expectedCash);
    const diff = Number.isFinite(expected) ? cash - expected : null;
    const lines = [
      `${t('closingCash')}: ${formatMoney(cash)}`,
      Number.isFinite(expected) ? `${t('expectedCash')}: ${formatMoney(expected)}` : null,
      diff != null ? `${t('cashDifference')}: ${formatMoney(diff)}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    Alert.alert(t('closeShift'), lines, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('closeShift'),
        style: 'destructive',
        onPress: () => void runClose(cash),
      },
    ]);
  }

  async function runClose(cash: number) {
    if (acting) return;
    setActing(true);
    setError(null);
    setInfo(null);
    try {
      const result = await closeShift(cash);
      setCashInput('');
      setInfo(
        `${t('shiftClosed')} · ${t('expectedCash')}: ${formatMoney(result.expectedCash)} · ${t('cashDifference')}: ${formatMoney(result.cashDifference)}`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  const shift = current?.shift || null;
  const summary = current?.summary || null;
  const isOwnShift = current?.is_own_shift !== false;
  const closingPreview = parseCashInput(cashInput);
  const expectedPreview = Number(summary?.expectedCash);
  const diffPreview =
    closingPreview != null && Number.isFinite(expectedPreview)
      ? closingPreview - expectedPreview
      : null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {info ? <Text style={styles.info}>{info}</Text> : null}

      {daily ? (
        <View style={[styles.card, styles.dailyCard]}>
          <Text style={styles.cardTitle}>{t('dailyReport')}</Text>
          <Text style={styles.dailyDate}>{daily.date}</Text>
          <Row label={t('ordersCount')} value={String(daily.order_count)} />
          <Row label={t('salesTotal')} value={formatMoney(daily.total_sales)} bold />
          <Row label={t('cashSales')} value={formatMoney(daily.cash_total)} />
          <Row label={t('cardSales')} value={formatMoney(daily.card_total)} />
        </View>
      ) : null}

      <Pressable style={styles.linkCard} onPress={() => router.push('/expenses' as never)}>
        <Text style={styles.linkTitle}>{t('expenses')}</Text>
        <Text style={styles.linkHint}>{t('addExpense')}</Text>
      </Pressable>

      {shift ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{shift.shift_number}</Text>
          {!isOwnShift ? <Text style={styles.hint}>{t('shiftOwnedByOther')}</Text> : null}
          <Row
            label={t('shiftOpenSince')}
            value={String(shift.opened_at || '').slice(0, 16).replace('T', ' ')}
          />
          <Row label={t('openingCash')} value={formatMoney(shift.opening_cash)} />
          {summary ? (
            <>
              <Row label={t('salesTotal')} value={formatMoney(summary.totalSales)} />
              <Row label={t('cashSales')} value={formatMoney(summary.cashSales)} />
              <Row label={t('ordersCount')} value={String(summary.orders)} />
              <Row
                label={t('expectedCash')}
                value={formatMoney(summary.expectedCash)}
                bold
                danger={Number(summary.expectedCash) < 0}
              />
              {Number(summary.cashExpenses) > 0 ? (
                <Row label={t('expenses')} value={`−${formatMoney(summary.cashExpenses)}`} />
              ) : null}
              {Number(summary.cashRefundsOut ?? summary.totalRefunds) > 0 ? (
                <Row
                  label={t('refunds')}
                  value={`−${formatMoney(summary.cashRefundsOut ?? summary.totalRefunds)}`}
                />
              ) : null}
            </>
          ) : null}

          {isOwnShift ? (
            <>
              <Text style={styles.inputLabel}>{t('closingCash')}</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={cashInput}
                onChangeText={setCashInput}
                placeholder={t('closingCashHint')}
              />
              {diffPreview != null ? (
                <Row
                  label={t('cashDifference')}
                  value={formatMoney(diffPreview)}
                  bold
                  danger={diffPreview !== 0}
                />
              ) : null}
              <Pressable
                style={[styles.btn, styles.btnDanger, acting && styles.btnDisabled]}
                onPress={requestClose}
                disabled={acting}
              >
                <Text style={styles.btnText}>{acting ? t('processing') : t('closeShift')}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('noOpenShift')}</Text>
          <Text style={styles.inputLabel}>{t('openingCash')}</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={cashInput}
            onChangeText={setCashInput}
            placeholder="0"
          />
          <Pressable
            style={[styles.btn, acting && styles.btnDisabled]}
            onPress={handleOpen}
            disabled={acting}
          >
            <Text style={styles.btnText}>{acting ? t('processing') : t('openShift')}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    marginBottom: 12,
  },
  dailyCard: { borderColor: '#bbf7d0' },
  dailyDate: { fontSize: 13, color: '#64748b', marginBottom: 8 },
  linkCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    marginBottom: 12,
  },
  linkTitle: { fontSize: 16, fontWeight: '700', color: '#166534' },
  linkHint: { fontSize: 13, color: '#64748b', marginTop: 4 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 12 },
  hint: { fontSize: 13, color: '#b45309', marginBottom: 10, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { fontSize: 14, color: '#64748b' },
  rowValue: { fontSize: 14, color: '#0f172a', fontWeight: '500' },
  rowValueBold: { fontWeight: '700', color: '#166534' },
  rowValueDanger: { fontWeight: '700', color: '#dc2626' },
  inputLabel: { fontSize: 13, color: '#475569', marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  btn: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  btnDanger: { backgroundColor: '#dc2626' },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  error: { color: '#dc2626', marginBottom: 10, textAlign: 'center' },
  info: { color: '#166534', marginBottom: 10, textAlign: 'center', fontWeight: '600' },
});
