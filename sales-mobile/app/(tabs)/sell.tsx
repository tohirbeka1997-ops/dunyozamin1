import { memo, useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchCurrentShift, searchProducts } from '@/api/client';
import { AddToCartModal } from '@/components/AddToCartModal';
import { BarcodeScanModal } from '@/components/BarcodeScanModal';
import { CustomerPickerBanner } from '@/components/CustomerPicker';
import { SearchSpinnerSlot } from '@/components/SearchSpinnerSlot';
import { SearchWithScan } from '@/components/SearchWithScan';
import { useDebouncedSearch } from '@/hooks/useDebouncedSearch';
import { t } from '@/i18n';
import { lookupProductByCode } from '@/lib/barcodeLookup';
import { useCartItemCount } from '@/store/cart';
import type { PosProduct } from '@/types/sales';

const LIST_SCROLL_CONFIG = { minIndexForVisible: 0, autoscrollToTopThreshold: 10 };

function formatMoney(n: number): string {
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

const ProductRow = memo(function ProductRow({
  item,
  onAdd,
}: {
  item: PosProduct;
  onAdd: (product: PosProduct) => void;
}) {
  const stock = Number(item.current_stock ?? 0);
  const out = stock <= 0;
  return (
    <Pressable
      style={[styles.product, out && styles.productOut]}
      onPress={() => !out && onAdd(item)}
      disabled={out}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.productName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.productMeta}>
          {formatMoney(Number(item.sale_price || 0))} ·{' '}
          {out ? t('outOfStock') : `${t('inStock')}: ${stock}`}
        </Text>
      </View>
      {!out ? <Text style={styles.addBtn}>+ {t('addToCart')}</Text> : null}
    </Pressable>
  );
});

export default function SellScreen() {
  const router = useRouter();
  const cartCount = useCartItemCount();
  const [query, setQuery] = useState('');
  const [hasShift, setHasShift] = useState<boolean | null>(null);
  const [addedFlash, setAddedFlash] = useState<string | null>(null);
  const [pickProduct, setPickProduct] = useState<PosProduct | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);

  const searchFetcher = useCallback((q: string) => searchProducts(q), []);
  const { results, searching } = useDebouncedSearch(query, searchFetcher);

  useFocusEffect(
    useCallback(() => {
      void fetchCurrentShift()
        .then((s) => setHasShift(!!s))
        .catch(() => setHasShift(false));
    }, []),
  );

  useEffect(() => {
    if (!addedFlash) return;
    const timer = setTimeout(() => setAddedFlash(null), 1500);
    return () => clearTimeout(timer);
  }, [addedFlash]);

  const handleProductPress = useCallback((product: PosProduct) => {
    setPickProduct(product);
  }, []);

  const handleAdded = useCallback((product: PosProduct, quantity: number) => {
    setAddedFlash(`${product.name} × ${quantity}`);
  }, []);

  const handleBarcodeScan = useCallback(async (code: string) => {
    setScanBusy(true);
    try {
      const product = await lookupProductByCode(code);
      if (!product) {
        Alert.alert(t('scanBarcode'), t('barcodeNotFound'));
        return;
      }
      const stock = Number(product.current_stock ?? 0);
      if (stock <= 0) {
        Alert.alert(t('scanBarcode'), t('outOfStock'));
        return;
      }
      setScanOpen(false);
      setQuery(code);
      setPickProduct(product);
    } catch (e) {
      Alert.alert(t('scanBarcode'), e instanceof Error ? e.message : t('networkError'));
    } finally {
      setScanBusy(false);
    }
  }, []);

  const renderProduct = useCallback(
    ({ item }: { item: PosProduct }) => <ProductRow item={item} onAdd={handleProductPress} />,
    [handleProductPress],
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {hasShift === false ? (
          <Pressable style={styles.shiftBanner} onPress={() => router.push('/(tabs)/shift')}>
            <Text style={styles.shiftBannerText}>{t('openShiftFirst')}</Text>
          </Pressable>
        ) : null}
        <CustomerPickerBanner />
        <SearchWithScan
          value={query}
          onChangeText={setQuery}
          onScanPress={() => setScanOpen(true)}
        />
        <SearchSpinnerSlot visible={searching} />
      </View>

      <View style={styles.listWrap}>
        {addedFlash ? (
          <View style={styles.addedToast} pointerEvents="none">
            <Text style={styles.addedBannerText}>
              {addedFlash} — {t('addedToCart')}
            </Text>
          </View>
        ) : null}
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={renderProduct}
          keyboardShouldPersistTaps="handled"
          style={styles.productList}
          contentContainerStyle={styles.productListContent}
          maintainVisibleContentPosition={LIST_SCROLL_CONFIG}
          ListEmptyComponent={
            !searching && query.trim() ? (
              <Text style={styles.emptyResults}>{t('noProducts')}</Text>
            ) : null
          }
        />
      </View>

      <View style={styles.cartBar}>
        <Pressable style={styles.cartBarBtn} onPress={() => router.push('/(tabs)/cart')}>
          <Text style={styles.cartBarText}>
            {t('goToCart')}
            {cartCount > 0 ? ` (${cartCount})` : ''}
          </Text>
        </Pressable>
      </View>

      <AddToCartModal
        product={pickProduct}
        visible={!!pickProduct}
        onClose={() => setPickProduct(null)}
        onAdded={handleAdded}
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
  header: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
    backgroundColor: '#f8fafc',
  },
  shiftBanner: {
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  shiftBannerText: { color: '#92400e', fontWeight: '600', textAlign: 'center' },
  listWrap: { flex: 1, position: 'relative' },
  addedToast: {
    position: 'absolute',
    top: 8,
    left: 12,
    right: 12,
    zIndex: 2,
    backgroundColor: '#dcfce7',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#86efac',
  },
  addedBannerText: { color: '#166534', fontWeight: '600', fontSize: 13, textAlign: 'center' },
  productList: { flex: 1 },
  productListContent: { paddingHorizontal: 12, paddingBottom: 8 },
  emptyResults: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 14,
    paddingVertical: 24,
  },
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
  productOut: { opacity: 0.5 },
  productName: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  productMeta: { fontSize: 13, color: '#64748b', marginTop: 2 },
  addBtn: { color: '#166534', fontWeight: '700', fontSize: 13 },
  cartBar: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    padding: 12,
  },
  cartBarBtn: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cartBarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
