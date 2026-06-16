import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { searchCustomers } from '@/api/client';
import { SearchSpinnerSlot } from '@/components/SearchSpinnerSlot';
import { useDebouncedSearch } from '@/hooks/useDebouncedSearch';
import { formatCustomerBalance, t } from '@/i18n';
import type { CustomerSummary } from '@/types/customers';

const LIST_SCROLL_CONFIG = { minIndexForVisible: 0, autoscrollToTopThreshold: 10 };

export default function CustomersScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const searchFetcher = useCallback(async (q: string) => {
    try {
      const rows = await searchCustomers(q, 40);
      setError(null);
      return rows.filter((c) => c.id !== 'default-customer-001');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
      throw e;
    }
  }, []);

  const { results, searching } = useDebouncedSearch(query, searchFetcher);

  const listHeader = useMemo(
    () => (
      <View>
        <TextInput
          style={styles.search}
          placeholder={t('searchCustomers')}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
        <SearchSpinnerSlot visible={searching} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    ),
    [query, searching, error],
  );

  const renderItem = useCallback(
    ({ item }: { item: CustomerSummary }) => {
      const bal = Number(item.balance_uzs ?? item.balance ?? 0);
      return (
        <Pressable
          style={styles.row}
          onPress={() => router.push({ pathname: '/customers/[id]', params: { id: item.id } })}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.meta}>{item.phone || item.email || '—'}</Text>
          </View>
          <Text style={[styles.balance, bal < 0 && styles.debt]}>
            {formatCustomerBalance(bal)}
          </Text>
        </Pressable>
      );
    },
    [router],
  );

  return (
    <View style={styles.root}>
      <Pressable style={styles.fab} onPress={() => router.push('/customers/create')}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={listHeader}
        maintainVisibleContentPosition={LIST_SCROLL_CONFIG}
        ListEmptyComponent={
          !searching && !error ? <Text style={styles.empty}>{t('noCustomers')}</Text> : null
        }
        renderItem={renderItem}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  search: {
    margin: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  name: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  meta: { fontSize: 13, color: '#64748b', marginTop: 2 },
  balance: { fontSize: 12, fontWeight: '600', color: '#166534', maxWidth: 130, textAlign: 'right' },
  debt: { color: '#dc2626' },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 24 },
  error: { color: '#dc2626', marginHorizontal: 12, marginBottom: 8 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  fabText: { color: '#fff', fontSize: 28, fontWeight: '300', lineHeight: 30 },
});
