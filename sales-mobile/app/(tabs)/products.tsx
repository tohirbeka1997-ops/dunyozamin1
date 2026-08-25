import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BarcodeScanModal } from '@/components/BarcodeScanModal';
import { SearchSpinnerSlot } from '@/components/SearchSpinnerSlot';
import { SearchWithScan } from '@/components/SearchWithScan';
import { useDebouncedSearch } from '@/hooks/useDebouncedSearch';
import { t } from '@/i18n';
import {
  lookupProductByCodeWithCache,
  searchProductsWithCache,
} from '@/lib/productSearch';
import type { PosProduct } from '@/types/sales';

const LIST_SCROLL_CONFIG = { minIndexForVisible: 0, autoscrollToTopThreshold: 10 };

function formatMoney(n?: number | null): string {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

export default function ProductsScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);

  const searchFetcher = useCallback(async (q: string) => {
    try {
      const rows = await searchProductsWithCache(q, 30);
      setError(null);
      return rows;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
      throw e;
    }
  }, []);

  const { results, searching } = useDebouncedSearch(query, searchFetcher);

  const handleBarcodeScan = useCallback(
    async (code: string) => {
      setScanBusy(true);
      try {
        const product = await lookupProductByCodeWithCache(code);
        if (!product) {
          Alert.alert(t('scanBarcode'), t('barcodeNotFound'));
          return;
        }
        setScanOpen(false);
        setQuery(code);
        router.push({ pathname: '/products/[id]', params: { id: product.id } });
      } catch (e) {
        Alert.alert(t('scanBarcode'), e instanceof Error ? e.message : t('networkError'));
      } finally {
        setScanBusy(false);
      }
    },
    [router],
  );

  const listHeader = useMemo(
    () => (
      <View>
        <SearchWithScan
          value={query}
          onChangeText={setQuery}
          onScanPress={() => setScanOpen(true)}
        />
        <SearchSpinnerSlot visible={searching} />
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.errorHint}>{t('reloginHint')}</Text>
          </View>
        ) : null}
      </View>
    ),
    [query, searching, error],
  );

  const renderItem = useCallback(
    ({ item }: { item: PosProduct }) => {
      const stock = Number(item.current_stock ?? 0);
      const cost = item.cost_price;
      return (
        <Pressable
          style={styles.product}
          onPress={() => router.push({ pathname: '/products/[id]', params: { id: item.id } })}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.productName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.productMeta}>
              {item.sku ? `${item.sku} · ` : ''}
              {`${t('inStock')}: ${stock}`}
            </Text>
            <View style={styles.priceRow}>
              <Text style={styles.sellPrice}>{formatMoney(Number(item.sale_price || 0))}</Text>
            </View>
          </View>
          <View style={styles.costBox}>
            <Text style={styles.costLabel}>{t('costPrice')}</Text>
            <Text style={styles.costValue}>
              {cost == null ? t('costHidden') : formatMoney(cost)}
            </Text>
          </View>
        </Pressable>
      );
    },
    [router],
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={listHeader}
        renderItem={renderItem}
        maintainVisibleContentPosition={LIST_SCROLL_CONFIG}
        ListEmptyComponent={
          !searching && !error ? <Text style={styles.empty}>{t('noOrders')}</Text> : null
        }
        contentContainerStyle={styles.listContent}
      />

      <BarcodeScanModal
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={handleBarcodeScan}
        busy={scanBusy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  listContent: { padding: 12, paddingBottom: 24 },
  product: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginTop: 8,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  productName: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  productMeta: { fontSize: 13, color: '#64748b', marginTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  sellPrice: { fontSize: 13, color: '#475569' },
  costBox: {
    alignItems: 'flex-end',
    marginLeft: 10,
    backgroundColor: '#ecfdf5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 110,
  },
  costLabel: { fontSize: 11, color: '#047857', fontWeight: '600' },
  costValue: { fontSize: 15, color: '#065f46', fontWeight: '700', marginTop: 2 },
  empty: { textAlign: 'center', color: '#94a3b8', fontSize: 15, marginTop: 24 },
  errorBanner: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  errorText: { color: '#b91c1c', fontWeight: '600' },
  errorHint: { color: '#7f1d1d', fontSize: 12, marginTop: 4 },
});
