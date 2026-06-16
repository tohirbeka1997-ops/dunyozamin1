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
import { fetchCustomer, fetchCustomerLedger, receiveCustomerPayment } from '@/api/client';
import { formatCustomerBalance, ledgerTypeLabel, t } from '@/i18n';
import type { CustomerLedgerEntry, CustomerSummary } from '@/types/customers';

function formatMoney(n: number): string {
  const sign = n < 0 ? '−' : n > 0 ? '+' : '';
  return `${sign}${Math.abs(Math.round(n)).toLocaleString('uz-UZ')} so'm`;
}

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [ledger, setLedger] = useState<CustomerLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [payMsg, setPayMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [c, l] = await Promise.all([fetchCustomer(id), fetchCustomerLedger(id)]);
      setCustomer(c);
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

  async function handleReceivePayment() {
    if (!id || paying) return;
    const amount = Number(payAmount.replace(/\s/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return;
    setPaying(true);
    setPayMsg(null);
    try {
      await receiveCustomerPayment(id, amount, 'cash');
      setPayAmount('');
      setPayMsg(t('paymentReceived'));
      await load();
    } catch (e) {
      setPayMsg(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setPaying(false);
    }
  }

  if (loading && !customer) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (!customer) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || t('noCustomers')}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>{t('back')}</Text>
        </Pressable>
      </View>
    );
  }

  const balUzs = Number(customer.balance_uzs ?? customer.balance ?? 0);
  const balUsd = Number(customer.balance_usd ?? 0);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{customer.name}</Text>
          <Text style={styles.sub}>{customer.phone || customer.email || '—'}</Text>
        </View>
        <Pressable
          style={styles.editBtn}
          onPress={() => router.push({ pathname: '/customers/edit', params: { id: customer.id } })}
        >
          <Text style={styles.editBtnText}>{t('editCustomer')}</Text>
        </Pressable>
      </View>
      {customer.notes ? <Text style={styles.notes}>{customer.notes}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>{t('balance')}</Text>
        <Text style={[styles.balance, balUzs < 0 && styles.debt]}>{formatCustomerBalance(balUzs)}</Text>
        {balUsd !== 0 ? (
          <Text style={styles.balanceUsd}>{formatCustomerBalance(balUsd, 'USD')}</Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('receivePayment')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('paymentAmount')}
          value={payAmount}
          onChangeText={setPayAmount}
          keyboardType="numeric"
        />
        <Pressable
          style={[styles.btn, paying && styles.btnDisabled]}
          onPress={handleReceivePayment}
          disabled={paying}
        >
          <Text style={styles.btnText}>{paying ? t('processing') : t('receivePayment')}</Text>
        </Pressable>
        {payMsg ? <Text style={styles.payMsg}>{payMsg}</Text> : null}
      </View>

      <Text style={styles.sectionTitle}>{t('ledger')}</Text>
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
                  {item.ref_no || item.note || ''} · {String(item.created_at || '').slice(0, 16)}
                </Text>
              </View>
              <Text style={styles.ledgerAmt}>{formatMoney(Number(item.amount || 0))}</Text>
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
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  name: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  sub: { fontSize: 14, color: '#64748b', marginTop: 4 },
  notes: { fontSize: 13, color: '#475569', marginBottom: 16, fontStyle: 'italic' },
  editBtn: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#166534',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 8,
  },
  editBtnText: { color: '#166534', fontWeight: '700', fontSize: 13 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardLabel: { fontSize: 13, color: '#64748b' },
  balance: { fontSize: 20, fontWeight: '700', color: '#166534', marginTop: 4 },
  balanceUsd: { fontSize: 14, color: '#475569', marginTop: 4 },
  debt: { color: '#dc2626' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 8, marginTop: 8 },
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
  btn: {
    backgroundColor: '#166534',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
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
  ledgerAmt: { fontSize: 14, fontWeight: '600', color: '#334155' },
  emptyLedger: { color: '#94a3b8', marginBottom: 16 },
  error: { color: '#dc2626', marginBottom: 12 },
  link: { color: '#166534', fontWeight: '600' },
});
