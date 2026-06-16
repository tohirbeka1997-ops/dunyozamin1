import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '@/i18n';
import { addToCart, getCartQuantity } from '@/store/cart';
import type { PosProduct } from '@/types/sales';

function formatMoney(n: number): string {
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

function clampQty(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function AddToCartModal({
  product,
  visible,
  onClose,
  onAdded,
}: {
  product: PosProduct | null;
  visible: boolean;
  onClose: () => void;
  onAdded?: (product: PosProduct, quantity: number) => void;
}) {
  const [qtyText, setQtyText] = useState('1');

  const stock = Number(product?.current_stock ?? 0);
  const inCart = product ? getCartQuantity(product.id) : 0;
  const maxAdd = Math.max(0, stock - inCart);

  const qty = useMemo(() => clampQty(Number(qtyText.replace(/\s/g, '')), 1, maxAdd || 1), [qtyText, maxAdd]);

  useEffect(() => {
    if (visible && product) setQtyText('1');
  }, [visible, product?.id]);

  function handleClose() {
    setQtyText('1');
    onClose();
  }

  function handleConfirm() {
    if (!product || maxAdd <= 0) return;
    const amount = clampQty(Number(qtyText.replace(/\s/g, '')), 1, maxAdd);
    addToCart(product, amount);
    onAdded?.(product, amount);
    handleClose();
  }

  function adjust(delta: number) {
    setQtyText(String(clampQty(qty + delta, 1, maxAdd || 1)));
  }

  if (!product) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title} numberOfLines={2}>
            {product.name}
          </Text>
          <Text style={styles.meta}>
            {formatMoney(Number(product.sale_price || 0))} · {t('inStock')}: {stock}
          </Text>
          {inCart > 0 ? (
            <Text style={styles.inCartHint}>
              {t('alreadyInCart')}: {inCart}
            </Text>
          ) : null}
          {maxAdd <= 0 ? (
            <Text style={styles.stockError}>{t('stockLimitReached')}</Text>
          ) : (
            <>
              <Text style={styles.qtyLabel}>{t('selectQuantity')}</Text>
              <View style={styles.qtyRow}>
                <Pressable
                  style={[styles.qtyBtn, qty <= 1 && styles.qtyBtnDisabled]}
                  onPress={() => adjust(-1)}
                  disabled={qty <= 1}
                >
                  <Text style={styles.qtyBtnText}>−</Text>
                </Pressable>
                <TextInput
                  style={styles.qtyInput}
                  value={qtyText}
                  onChangeText={(text) => setQtyText(text.replace(/[^\d]/g, ''))}
                  keyboardType="number-pad"
                  selectTextOnFocus
                />
                <Pressable
                  style={[styles.qtyBtn, qty >= maxAdd && styles.qtyBtnDisabled]}
                  onPress={() => adjust(1)}
                  disabled={qty >= maxAdd}
                >
                  <Text style={styles.qtyBtnText}>+</Text>
                </Pressable>
              </View>
              <Text style={styles.maxHint}>
                {t('maxAddable')}: {maxAdd}
              </Text>
            </>
          )}
          <View style={styles.actions}>
            <Pressable style={styles.cancelBtn} onPress={handleClose}>
              <Text style={styles.cancelText}>{t('cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.addBtn, maxAdd <= 0 && styles.addBtnDisabled]}
              onPress={handleConfirm}
              disabled={maxAdd <= 0}
            >
              <Text style={styles.addText}>{t('addToCartConfirm')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
  },
  title: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  meta: { fontSize: 13, color: '#64748b', marginTop: 4 },
  inCartHint: { fontSize: 13, color: '#166534', marginTop: 8, fontWeight: '600' },
  stockError: { fontSize: 13, color: '#dc2626', marginTop: 12, textAlign: 'center' },
  qtyLabel: { fontSize: 14, fontWeight: '600', color: '#334155', marginTop: 16, marginBottom: 8 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  qtyBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnDisabled: { opacity: 0.35 },
  qtyBtnText: { fontSize: 22, fontWeight: '700', color: '#166534' },
  qtyInput: {
    minWidth: 72,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  maxHint: { fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  cancelText: { fontWeight: '600', color: '#64748b' },
  addBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#166534',
    alignItems: 'center',
  },
  addBtnDisabled: { opacity: 0.45 },
  addText: { fontWeight: '700', color: '#fff' },
});
