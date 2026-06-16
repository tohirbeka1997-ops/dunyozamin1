import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fetchSupplier, fetchSupplierLedger, paySupplier } from '@/api/client';
import { ledgerTypeLabel, t } from '@/i18n';
import type { SupplierLedgerEntry, SupplierSummary } from '@/types/customers';

type PayMethod = 'cash' | 'card' | 'transfer';

function formatMoney(n?: number | null, currency = 'UZS'): string {
  if (n == null) return '—';
  const suffix = currency === 'USD' ? ' $' : " so'm";
  return `${Math.round(n).toLocaleString('uz-UZ')}${suffix}`;
}

function ledgerAmount(entry: SupplierLedgerEntry, currency: string): string {
  const debit = Number(entry.debit || 0);
  const credit = Number(entry.credit || 0);
  const net = debit - credit;
  const sign = net > 0 ? '+' : net < 0 ? '−' : '';
  return `${sign}${formatMoney(Math.abs(net), currency)}`;
}

export default function SupplierDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [supplier, setSupplier] = useState<SupplierSummary | null>(null);
  const [ledger, setLedger] = useState<SupplierLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');
  const [payNotes, setPayNotes] = useState('');
  const [paying, setPaying] = useState(false);
  const [payMsg, setPayMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [s, l] = await Promise.all([fetchSupplier(id), fetchSupplierLedger(id)]);
      setSupplier(s);
      setLedger(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function handlePay() {
    if (!id || paying) return;
    const amount = Number(payAmount.replace(/\s/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return;
    setPaying(true);
    setPayMsg(null);
    try {
      const result = await paySupplier(id, amount, payMethod, payNotes.trim() || undefined);
      setSupplier(result.supplier);
      setPayAmount('');
      setPayNotes('');
      setPayMsg(t('paymentSent'));
      setLedger(await fetchSupplierLedger(id));
    } catch (e) {
      setPayMsg(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setPaying(false);
    }
  }

  if (loading && !supplier) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (!supplier) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || t('noSuppliers')}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>{t('back')}</Text>
        </Pressable>
      </View>
    );
  }

  const currency = String(supplier.settlement_currency || 'UZS').toUpperCase();
  const balance = Number(supplier.balance ?? 0);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.name}>{supplier.name}</Text>
      {supplier.contact_person ? (
        <Text style={styles.sub}>
          {t('contactPerson')}: {supplier.contact_person}
        </Text>
      ) : null}
      <Text style={styles.sub}>{supplier.phone || supplier.email || '—'}</Text>

      <View style={styles.card}>
        <Text style={styles.label}>{t('balance')}</Text>
        <Text style={[styles.value, balance > 0 && styles.debt]}>{formatMoney(balance, currency)}</Text>
        <Text style={styles.meta}>
          {t('total')}: {formatMoney(Number(supplier.total_debt ?? 0), currency)}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('makePayment')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('paymentAmount')}
          value={payAmount}
          onChangeText={setPayAmount}
          keyboardType="numeric"
        />
        <View style={styles.methodRow}>
          {(['cash', 'card', 'transfer'] as PayMethod[]).map((m) => (
            <Pressable
              key={m}
              style={[styles.methodBtn, payMethod === m && styles.methodBtnActive]}
              onPress={() => setPayMethod(m)}
            >
              <Text style={[styles.methodText, payMethod === m && styles.methodTextActive]}>
                {m === 'transfer' ? t('transfer') : t(m)}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          style={styles.input}
          placeholder={t('paymentNotes')}
          value={payNotes}
          onChangeText={setPayNotes}
        />
        <Pressable
          style={[styles.btn, paying && styles.btnDisabled]}
          onPress={handlePay}
          disabled={paying}
        >
          <Text style={styles.btnText}>{paying ? t('processing') : t('makePayment')}</Text>
        </Pressable>
        {payMsg ? <Text style={styles.payMsg}>{payMsg}</Text> : null}
      </View>

      <Text style={styles.sectionTitle}>{t('history')}</Text>
      {ledger.length === 0 ? (
        <Text style={styles.emptyLedger}>—</Text>
      ) : (
        <FlatList
          data={ledger}
          scrollEnabled={false}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.ledgerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.ledgerType}>{ledgerTypeLabel(item.type)}</Text>
                <Text style={styles.ledgerMeta}>
                  {String(item.date || '').slice(0, 10)}
                  {item.reference ? ` · ${item.reference}` : ''}
                </Text>
              </View>
              <View style={styles.ledgerRight}>
                <Text style={styles.ledgerAmt}>{ledgerAmount(item, currency)}</Text>
                <Text style={styles.ledgerBal}>
                  {t('balanceAfter')}: {formatMoney(Number(item.balance || 0), currency)}
                </Text>
              </View>
            </View>
          )}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  name: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  sub: { fontSize: 14, color: '#64748b', marginTop: 4 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  label: { fontSize: 13, color: '#64748b' },
  value: { fontSize: 20, fontWeight: '700', color: '#166534', marginTop: 4 },
  debt: { color: '#dc2626' },
  meta: { fontSize: 13, color: '#475569', marginTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 10, marginTop: 16 },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 10,
  },
  methodRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  methodBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  methodBtnActive: { backgroundColor: '#166534' },
  methodText: { fontWeight: '600', color: '#334155', fontSize: 12 },
  methodTextActive: { color: '#fff' },
  btn: {
    backgroundColor: '#166534',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700' },
  payMsg: { marginTop: 8, textAlign: 'center', color: '#166534' },
  ledgerRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  ledgerType: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  ledgerMeta: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  ledgerRight: { alignItems: 'flex-end' },
  ledgerAmt: { fontSize: 14, fontWeight: '600', color: '#334155' },
  ledgerBal: { fontSize: 11, color: '#64748b', marginTop: 2 },
  emptyLedger: { color: '#94a3b8', marginBottom: 16 },
  error: { color: '#dc2626', marginBottom: 12 },
  link: { color: '#166534', fontWeight: '600' },
});
