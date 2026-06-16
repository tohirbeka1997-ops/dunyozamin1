import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchProduct, fetchProductBatches } from '@/api/client';
import { t } from '@/i18n';
import type { CostSummary, ProductBatch, ProductDetail } from '@/types/sales';

function formatMoney(n?: number | null): string {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

function formatDate(s?: string | null): string {
  if (!s) return '—';
  return String(s).slice(0, 10);
}

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [detail, batchRes] = await Promise.all([
        fetchProduct(id),
        fetchProductBatches(id).catch(() => ({ data: [], summary: null as CostSummary | null })),
      ]);
      setProduct(detail);
      setBatches(batchRes.data || []);
      setSummary(batchRes.summary ?? detail.cost_summary ?? null);
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

  if (loading && !product) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || t('productNotFound')}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>{t('back')}</Text>
        </Pressable>
      </View>
    );
  }

  const stock = Number(product.current_stock ?? 0);
  const costHidden = product.cost_price == null;
  const minCost = summary?.min_cost ?? null;
  const maxCost = summary?.max_cost ?? null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.name}>{product.name}</Text>
      <Text style={styles.sub}>
        {product.sku ? `${product.sku} · ` : ''}
        {`${t('inStock')}: ${stock}${product.unit ? ' ' + product.unit : ''}`}
      </Text>

      {/* Cost summary — the point of this screen for market price comparison. */}
      <View style={styles.costCard}>
        <View style={styles.costHeadRow}>
          <Text style={styles.costHeadLabel}>{t('costPrice')}</Text>
          <Text style={styles.costHeadValue}>
            {costHidden ? t('costHidden') : formatMoney(product.cost_price)}
          </Text>
        </View>
        {!costHidden ? (
          <View style={styles.costGrid}>
            <View style={styles.costCell}>
              <Text style={styles.cellLabel}>{t('latestCost')}</Text>
              <Text style={styles.cellValue}>{formatMoney(summary?.latest_cost)}</Text>
            </View>
            <View style={styles.costCell}>
              <Text style={styles.cellLabel}>{t('avgCost')}</Text>
              <Text style={styles.cellValue}>{formatMoney(summary?.avg_cost)}</Text>
            </View>
            <View style={styles.costCell}>
              <Text style={styles.cellLabel}>{t('minCost')}</Text>
              <Text style={[styles.cellValue, styles.minValue]}>{formatMoney(minCost)}</Text>
            </View>
            <View style={styles.costCell}>
              <Text style={styles.cellLabel}>{t('maxCost')}</Text>
              <Text style={[styles.cellValue, styles.maxValue]}>{formatMoney(maxCost)}</Text>
            </View>
          </View>
        ) : null}
        <View style={styles.sellRow}>
          <Text style={styles.sellLabel}>{t('sellPrice')}</Text>
          <Text style={styles.sellValue}>{formatMoney(Number(product.sale_price || 0))}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t('batchHistory')}</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {batches.length === 0 ? (
        <Text style={styles.empty}>{t('noBatches')}</Text>
      ) : (
        batches.map((b) => {
          const isMin = minCost != null && Number(b.unit_cost) === minCost;
          const isMax = maxCost != null && Number(b.unit_cost) === maxCost && minCost !== maxCost;
          return (
            <View key={b.batch_id} style={styles.batchRow}>
              <View style={styles.batchMain}>
                <Text style={styles.batchDate}>{formatDate(b.received_at)}</Text>
                <Text style={styles.batchMeta}>
                  {`${t('batchQty')}: ${b.quantity} · ${t('remaining')}: ${b.remaining_quantity}`}
                </Text>
                {b.supplier_name ? (
                  <Text style={styles.batchSupplier}>
                    {t('supplier')}: {b.supplier_name}
                  </Text>
                ) : null}
              </View>
              <View
                style={[
                  styles.batchCost,
                  isMin && styles.batchCostMin,
                  isMax && styles.batchCostMax,
                ]}
              >
                <Text style={styles.batchCostLabel}>{t('unitCost')}</Text>
                <Text
                  style={[
                    styles.batchCostValue,
                    isMin && styles.batchCostValueMin,
                    isMax && styles.batchCostValueMax,
                  ]}
                >
                  {formatMoney(b.unit_cost)}
                </Text>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  name: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  sub: { fontSize: 13, color: '#64748b', marginTop: 4, marginBottom: 14 },
  costCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  costHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  costHeadLabel: { fontSize: 14, fontWeight: '600', color: '#047857' },
  costHeadValue: { fontSize: 22, fontWeight: '800', color: '#065f46' },
  costGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, gap: 10 },
  costCell: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
  },
  cellLabel: { fontSize: 11, color: '#64748b', fontWeight: '600' },
  cellValue: { fontSize: 15, color: '#0f172a', fontWeight: '700', marginTop: 2 },
  minValue: { color: '#047857' },
  maxValue: { color: '#b91c1c' },
  sellRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  sellLabel: { fontSize: 13, color: '#64748b' },
  sellValue: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginTop: 20, marginBottom: 8 },
  empty: { textAlign: 'center', color: '#94a3b8', fontSize: 14, marginTop: 16 },
  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  batchMain: { flex: 1 },
  batchDate: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  batchMeta: { fontSize: 13, color: '#64748b', marginTop: 2 },
  batchSupplier: { fontSize: 13, color: '#64748b', marginTop: 2 },
  batchCost: {
    alignItems: 'flex-end',
    marginLeft: 10,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 110,
    backgroundColor: '#f1f5f9',
  },
  batchCostMin: { backgroundColor: '#dcfce7' },
  batchCostMax: { backgroundColor: '#fee2e2' },
  batchCostLabel: { fontSize: 11, color: '#64748b', fontWeight: '600' },
  batchCostValue: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginTop: 2 },
  batchCostValueMin: { color: '#047857' },
  batchCostValueMax: { color: '#b91c1c' },
  error: { color: '#dc2626', marginVertical: 8 },
  link: { color: '#166534', marginTop: 12, fontWeight: '600' },
});
