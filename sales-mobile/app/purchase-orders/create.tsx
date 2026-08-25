import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  createPurchaseOrder,
  fetchLatestExchangeRate,
  searchProducts,
  searchSuppliers,
} from '@/api/client';
import { SearchSpinnerSlot } from '@/components/SearchSpinnerSlot';
import { useDebouncedSearch } from '@/hooks/useDebouncedSearch';
import { useRequireStaffAccess } from '@/hooks/useRequireStaffAccess';
import { t } from '@/i18n';
import type { SupplierSummary } from '@/types/customers';
import type { PosProduct } from '@/types/sales';

const LIST_SCROLL_CONFIG = { minIndexForVisible: 0, autoscrollToTopThreshold: 10 };

interface PoLine {
  product: PosProduct;
  qty: string;
  unitCost: string;
}

function isUsdSupplier(s: SupplierSummary | null): boolean {
  return String(s?.settlement_currency || 'UZS').toUpperCase() === 'USD';
}

export default function CreatePurchaseOrderScreen() {
  const allowed = useRequireStaffAccess('purchasing');
  const router = useRouter();
  const [supplierQuery, setSupplierQuery] = useState('');
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [supplierSearchError, setSupplierSearchError] = useState<string | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierSummary | null>(null);
  const [productQuery, setProductQuery] = useState('');
  const [lines, setLines] = useState<PoLine[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const [fxRate, setFxRate] = useState('');
  const [fxLoadError, setFxLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addedFlash, setAddedFlash] = useState<string | null>(null);

  const usdMode = isUsdSupplier(selectedSupplier);

  useEffect(() => {
    let active = true;
    const handle = setTimeout(() => {
      void searchSuppliers(supplierQuery, 15)
        .then((rows) => {
          if (!active) return;
          setSuppliers(rows);
          setSupplierSearchError(null);
        })
        .catch((e) => {
          if (!active) return;
          setSuppliers([]);
          setSupplierSearchError(e instanceof Error ? e.message : t('networkError'));
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [supplierQuery]);

  const productFetcher = useCallback((q: string) => searchProducts(q, 30), []);
  const { results: products, searching: productSearching } = useDebouncedSearch(
    productQuery,
    productFetcher,
  );

  useEffect(() => {
    if (!usdMode) {
      setFxRate('');
      setFxLoadError(null);
      return;
    }
    let active = true;
    setFxLoadError(null);
    void fetchLatestExchangeRate()
      .then((row) => {
        if (!active) return;
        if (row?.rate) {
          setFxRate(String(row.rate));
          setFxLoadError(null);
        } else {
          setFxLoadError(t('fxRateRequired'));
        }
      })
      .catch((e) => {
        if (!active) return;
        setFxLoadError(e instanceof Error ? e.message : t('networkError'));
      });
    return () => {
      active = false;
    };
  }, [usdMode, selectedSupplier?.id]);

  useEffect(() => {
    if (!addedFlash) return;
    const timer = setTimeout(() => setAddedFlash(null), 1200);
    return () => clearTimeout(timer);
  }, [addedFlash]);

  const addLine = useCallback(
    (product: PosProduct) => {
      if (addedIds.has(product.id)) return;
      const uzsCost = Number(product.purchase_price || product.cost_price || 0);
      const rate = Number(fxRate) || 0;
      const defaultCost =
        usdMode && rate > 0
          ? String(Math.round((uzsCost / rate) * 100) / 100)
          : String(uzsCost || 0);
      setAddedIds((ids) => new Set(ids).add(product.id));
      setAddedFlash(product.name);
      setLines((prev) => [...prev, { product, qty: '1', unitCost: defaultCost }]);
    },
    [addedIds, fxRate, usdMode],
  );

  async function handleSave() {
    if (saving) return;
    if (!selectedSupplier) {
      Alert.alert(t('savePoError'), t('supplierRequired'));
      return;
    }
    if (lines.length === 0) {
      Alert.alert(t('savePoError'), t('poItemsRequired'));
      return;
    }
    const parsedFx = Number(fxRate);
    if (usdMode && (!Number.isFinite(parsedFx) || parsedFx <= 0)) {
      Alert.alert(t('savePoError'), t('fxRateRequired'));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        supplier_id: selectedSupplier.id,
        items: lines.map((l) => {
          const qty = Number(l.qty) || 1;
          const cost = Number(l.unitCost) || 0;
          if (usdMode) {
            return {
              product_id: l.product.id,
              ordered_qty: qty,
              unit_cost_usd: cost,
              unit_cost: cost * parsedFx,
            };
          }
          return {
            product_id: l.product.id,
            ordered_qty: qty,
            unit_cost: cost,
          };
        }),
        ...(usdMode ? { currency: 'USD' as const, fx_rate: parsedFx } : {}),
      };
      const po = await createPurchaseOrder(payload);
      Alert.alert(t('poCreated'), po.po_number);
      router.replace({ pathname: '/purchase-orders/[id]', params: { id: po.id } });
    } catch (e) {
      Alert.alert(t('savePoError'), e instanceof Error ? e.message : t('networkError'));
    } finally {
      setSaving(false);
    }
  }

  const canSave =
    !!selectedSupplier &&
    lines.length > 0 &&
    (!usdMode || (Number(fxRate) > 0 && Number.isFinite(Number(fxRate))));

  const addedKey = [...addedIds].sort().join(',');

  const listHeader = useMemo(
    () => (
      <View>
        <Text style={styles.label}>{t('supplier')}</Text>
        {selectedSupplier ? (
          <Pressable style={styles.chip} onPress={() => setSelectedSupplier(null)}>
            <Text style={styles.chipText}>
              {selectedSupplier.name}
              {usdMode ? ' (USD)' : ''} ×
            </Text>
          </Pressable>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder={t('searchSuppliers')}
              value={supplierQuery}
              onChangeText={setSupplierQuery}
            />
            {supplierSearchError ? <Text style={styles.fxError}>{supplierSearchError}</Text> : null}
            {suppliers.slice(0, 5).map((s) => (
              <Pressable key={s.id} style={styles.pickRow} onPress={() => setSelectedSupplier(s)}>
                <Text>
                  {s.name}
                  {isUsdSupplier(s) ? ' (USD)' : ''}
                </Text>
              </Pressable>
            ))}
          </>
        )}

        {usdMode ? (
          <>
            <Text style={styles.hint}>{t('usdSupplierHint')}</Text>
            <Text style={styles.label}>{t('fxRate')}</Text>
            <TextInput
              style={styles.input}
              value={fxRate}
              onChangeText={setFxRate}
              keyboardType="numeric"
              placeholder="12800"
            />
            {fxLoadError ? <Text style={styles.fxError}>{fxLoadError}</Text> : null}
          </>
        ) : null}

        <Text style={styles.label}>{t('items')}</Text>
        <TextInput
          style={styles.input}
          placeholder={t('searchProducts')}
          value={productQuery}
          onChangeText={setProductQuery}
        />
        <SearchSpinnerSlot visible={productSearching} />
        <View style={styles.addedFlashSlot}>
          {addedFlash ? (
            <Text style={styles.addedFlashText}>
              {addedFlash} — {t('addedToCart')}
            </Text>
          ) : null}
        </View>
        {products.map((p) => {
          const already = addedIds.has(p.id);
          return (
            <Pressable
              key={p.id}
              style={[styles.pickRow, already && styles.pickRowDisabled]}
              onPress={() => !already && addLine(p)}
              disabled={already}
            >
              <Text style={already ? styles.pickRowMuted : undefined}>{p.name}</Text>
            </Pressable>
          );
        })}
      </View>
    ),
    [
      selectedSupplier,
      usdMode,
      supplierQuery,
      suppliers,
      fxRate,
      productQuery,
      productSearching,
      products,
      addedKey,
      addedFlash,
      addLine,
    ],
  );

  const renderLine = useCallback(
    ({ item, index }: { item: PoLine; index: number }) => (
      <View style={styles.line}>
        <Text style={styles.lineName} numberOfLines={1}>
          {item.product.name}
        </Text>
        <View style={styles.lineInputs}>
          <TextInput
            style={styles.qtyInput}
            value={item.qty}
            onChangeText={(v) => {
              setLines((prev) => {
                const next = [...prev];
                next[index] = { ...item, qty: v };
                return next;
              });
            }}
            keyboardType="numeric"
            placeholder={t('quantity')}
          />
          <TextInput
            style={styles.qtyInput}
            value={item.unitCost}
            onChangeText={(v) => {
              setLines((prev) => {
                const next = [...prev];
                next[index] = { ...item, unitCost: v };
                return next;
              });
            }}
            keyboardType="numeric"
            placeholder={usdMode ? 'USD' : t('unitCost')}
          />
        </View>
      </View>
    ),
    [usdMode],
  );

  const listFooter = useMemo(
    () => (
      <Pressable
        style={[styles.saveBtn, (saving || !canSave) && styles.saveDisabled]}
        onPress={handleSave}
        disabled={saving || !canSave}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveText}>{t('savePO')}</Text>
        )}
      </Pressable>
    ),
    [saving, canSave],
  );

  if (!allowed) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' }}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={lines}
        keyExtractor={(item) => item.product.id}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        renderItem={renderLine}
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={LIST_SCROLL_CONFIG}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  listContent: { padding: 12, paddingBottom: 24 },
  label: { fontSize: 14, fontWeight: '700', color: '#334155', marginTop: 8, marginBottom: 6 },
  hint: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  fxError: { fontSize: 12, color: '#dc2626', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  pickRow: {
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 6,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  pickRowDisabled: { opacity: 0.45 },
  pickRowMuted: { color: '#94a3b8' },
  addedFlashSlot: {
    minHeight: 28,
    justifyContent: 'center',
    marginBottom: 4,
  },
  addedFlashText: { color: '#166534', fontWeight: '600', fontSize: 12, textAlign: 'center' },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 8,
  },
  chipText: { color: '#166534', fontWeight: '600' },
  line: {
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  lineName: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  lineInputs: { flexDirection: 'row', gap: 8 },
  qtyInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#f8fafc',
  },
  saveBtn: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  saveDisabled: { opacity: 0.6 },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
