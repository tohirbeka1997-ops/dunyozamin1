import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { searchSuppliers } from '@/api/client';
import { SearchSpinnerSlot } from '@/components/SearchSpinnerSlot';
import { useDebouncedSearch } from '@/hooks/useDebouncedSearch';
import { useRequireStaffAccess } from '@/hooks/useRequireStaffAccess';
import { t } from '@/i18n';
import type { SupplierSummary } from '@/types/customers';

const LIST_SCROLL_CONFIG = { minIndexForVisible: 0, autoscrollToTopThreshold: 10 };

function formatMoney(n?: number | null): string {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

export default function SuppliersScreen() {
  const allowed = useRequireStaffAccess('suppliers');
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const searchFetcher = useCallback(async (q: string) => {
    try {
      const rows = await searchSuppliers(q, 40);
      setError(null);
      return rows;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
      throw e;
    }
  }, []);

  const { results, searching } = useDebouncedSearch(allowed ? query : '', searchFetcher);

  const listHeader = useMemo(
    () => (
      <View>
        <TextInput
          style={styles.search}
          placeholder={t('searchSuppliers')}
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
    ({ item }: { item: SupplierSummary }) => (
      <Pressable
        style={styles.row}
        onPress={() => router.push({ pathname: '/suppliers/[id]', params: { id: item.id } })}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.meta}>{item.phone || item.contact_person || '—'}</Text>
        </View>
        <Text style={styles.balance}>{formatMoney(Number(item.balance ?? 0))}</Text>
      </Pressable>
    ),
    [router],
  );

  if (!allowed) {
    return (
      <View style={styles.gate}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={listHeader}
        maintainVisibleContentPosition={LIST_SCROLL_CONFIG}
        ListEmptyComponent={
          !searching && !error ? <Text style={styles.empty}>{t('noSuppliers')}</Text> : null
        }
        renderItem={renderItem}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  gate: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
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
  balance: { fontSize: 12, fontWeight: '600', color: '#166534' },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 24 },
  error: { color: '#dc2626', marginHorizontal: 12, marginBottom: 8 },
});
