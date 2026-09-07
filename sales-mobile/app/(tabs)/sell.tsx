import { memo, useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchCurrentShift } from '@/api/client';
import { AddToCartModal } from '@/components/AddToCartModal';
import { BarcodeScanModal } from '@/components/BarcodeScanModal';
import { CustomerPickerBanner } from '@/components/CustomerPicker';
import { SearchSpinnerSlot } from '@/components/SearchSpinnerSlot';
import { SearchWithScan } from '@/components/SearchWithScan';
import { useDebouncedSearch } from '@/hooks/useDebouncedSearch';
import { t } from '@/i18n';
import {
  lookupProductByCodeWithCache,
  searchProductsWithCache,
} from '@/lib/productSearch';
import {
  changeQty,
  useCartItemCount,
  useCartQuantity,
} from '@/store/cart';
import type { PosProduct } from '@/types/sales';

const LIST_SCROLL_CONFIG = { minIndexForVisible: 0, autoscrollToTopThreshold: 10 };

function formatMoney(n: number): string {
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

function isOwnOpenShift(data: Awaited<ReturnType<typeof fetchCurrentShift>>): boolean {
  return !!(data?.shift && data.is_own_shift !== false);
}

const ProductRow = memo(function ProductRow({
  item,
  onAdd,
  canSell,
  blockedMessage,
}: {
  item: PosProduct;
  onAdd: (product: PosProduct) => void;
  canSell: boolean;
  blockedMessage: string;
}) {
  const stock = Number(item.current_stock ?? 0);
  const out = stock <= 0;
  const inCart = useCartQuantity(item.id);
  const atStockCap = stock > 0 && inCart >= stock;
  const imageUrl = typeof item.image_url === 'string' ? item.image_url.trim() : '';

  return (
    <Pressable
      style={[styles.product, out && styles.productOut]}
      onPress={() => {
        if (!canSell) {
          Alert.alert(t('sell'), blockedMessage);
          return;
        }
        if (!out) onAdd(item);
      }}
      disabled={out}
    >
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.thumb} />
      ) : (
        <View style={styles.thumbPlaceholder}>
          <Text style={styles.thumbPlaceholderText}>◇</Text>
        </View>
      )}
      <View style={styles.productInfo}>
        <Text style={styles.productName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.productMeta} numberOfLines={1}>
          {formatMoney(Number(item.sale_price || 0))} ·{' '}
          {out ? t('outOfStock') : `${t('inStock')}: ${stock}`}
          {inCart > 0 ? ` · ${t('alreadyInCart')}: ${inCart}` : ''}
        </Text>
      </View>
      {!out && inCart > 0 ? (
        <View style={styles.qtyControls}>
          <Pressable
            style={styles.qtyBtn}
            onPress={(e) => {
              e?.stopPropagation?.();
              changeQty(item.id, -1);
            }}
            hitSlop={8}
          >
            <Text style={styles.qtyBtnText}>−</Text>
          </Pressable>
          <Text style={styles.qtyValue}>{inCart}</Text>
          <Pressable
            style={[styles.qtyBtn, (!canSell || atStockCap) && styles.qtyBtnDisabled]}
            onPress={(e) => {
              e?.stopPropagation?.();
              if (!canSell) {
                Alert.alert(t('sell'), blockedMessage);
                return;
              }
              if (!atStockCap) changeQty(item.id, 1);
            }}
            disabled={!canSell || atStockCap}
            hitSlop={8}
          >
            <Text style={styles.qtyBtnText}>+</Text>
          </Pressable>
        </View>
      ) : !out ? (
        <Text style={[styles.addBtn, !canSell && styles.addBtnMuted]}>+ {t('addToCart')}</Text>
      ) : null}
    </Pressable>
  );
});

export default function SellScreen() {
  const router = useRouter();
  const cartCount = useCartItemCount();
  const [query, setQuery] = useState('');
  const [hasOwnShift, setHasOwnShift] = useState<boolean | null>(null);
  const [shiftOwnedByOther, setShiftOwnedByOther] = useState(false);
  const [addedFlash, setAddedFlash] = useState<string | null>(null);
  const [pickProduct, setPickProduct] = useState<PosProduct | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);

  const searchFetcher = useCallback((q: string) => searchProductsWithCache(q), []);
  const { results, searching, error: searchError } = useDebouncedSearch(query, searchFetcher);
  const canSell = hasOwnShift === true;
  const blockedMessage = shiftOwnedByOther ? t('shiftOwnedByOther') : t('openShiftFirst');

  useFocusEffect(
    useCallback(() => {
      void fetchCurrentShift()
        .then((s) => {
          const own = isOwnOpenShift(s);
          setHasOwnShift(own);
          setShiftOwnedByOther(!!(s?.shift && s.is_own_shift === false));
        })
        .catch(() => {
          setHasOwnShift(false);
          setShiftOwnedByOther(false);
        });
    }, []),
  );

  useEffect(() => {
    if (!addedFlash) return;
    const timer = setTimeout(() => setAddedFlash(null), 1500);
    return () => clearTimeout(timer);
  }, [addedFlash]);

  const handleProductPress = useCallback(
    (product: PosProduct) => {
      if (!canSell) {
        Alert.alert(t('sell'), blockedMessage);
        return;
      }
      setPickProduct(product);
    },
    [canSell, blockedMessage],
  );

  const handleAdded = useCallback((product: PosProduct, quantity: number) => {
    setAddedFlash(`${product.name} × ${quantity}`);
  }, []);

  const handleBarcodeScan = useCallback(
    async (code: string) => {
      if (!canSell) {
        Alert.alert(t('sell'), blockedMessage);
        return;
      }
      setScanBusy(true);
      try {
        const product = await lookupProductByCodeWithCache(code);
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
    },
    [canSell, blockedMessage],
  );

  const renderProduct = useCallback(
    ({ item }: { item: PosProduct }) => (
      <ProductRow
        item={item}
        onAdd={handleProductPress}
        canSell={canSell}
        blockedMessage={blockedMessage}
      />
    ),
    [handleProductPress, canSell, blockedMessage],
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {hasOwnShift === false ? (
          <Pressable style={styles.shiftBanner} onPress={() => router.push('/(tabs)/shift')}>
            <Text style={styles.shiftBannerText}>
              {shiftOwnedByOther ? t('shiftOwnedByOther') : t('openShiftFirst')}
            </Text>
          </Pressable>
        ) : null}
        <CustomerPickerBanner />
        <SearchWithScan
          value={query}
          onChangeText={setQuery}
          onScanPress={() => {
            if (!canSell) {
              Alert.alert(t('sell'), blockedMessage);
              return;
            }
            setScanOpen(true);
          }}
        />
        <SearchSpinnerSlot visible={searching} />
        {searchError ? <Text style={styles.searchError}>{searchError}</Text> : null}
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
            !searching ? (
              <Text style={styles.emptyResults}>
                {searchError
                  ? searchError
                  : query.trim()
                    ? t('noProducts')
                    : t('searchProductsHint')}
              </Text>
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
  searchError: {
    color: '#dc2626',
    fontSize: 13,
    marginTop: 6,
    marginBottom: 2,
  },
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
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    marginTop: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  productOut: { opacity: 0.5 },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  thumbPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPlaceholderText: { fontSize: 18, fontWeight: '700', color: '#94a3b8' },
  productInfo: { flex: 1, minWidth: 0, paddingRight: 4 },
  productName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    lineHeight: 19,
  },
  productMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  addBtn: { color: '#166534', fontWeight: '700', fontSize: 13, marginTop: 10 },
  addBtnMuted: { color: '#94a3b8' },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnDisabled: { opacity: 0.35 },
  qtyBtnText: { fontSize: 18, fontWeight: '700', color: '#166534', lineHeight: 20 },
  qtyValue: {
    minWidth: 22,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  cartBar: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
  },
  cartBarBtn: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cartBarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
