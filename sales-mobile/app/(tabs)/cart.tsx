import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { completeSale, fetchCurrentShift, holdSale } from '@/api/client';
import { loadUser } from '@/auth/session';
import { CustomerPickerBanner } from '@/components/CustomerPicker';
import { LineDiscountModal } from '@/components/LineDiscountModal';
import { t } from '@/i18n';
import { getOrCreateDeviceId } from '@/lib/device';
import {
  enqueueSale,
  getOfflineQueueCount,
  isNetworkError,
} from '@/lib/offlineQueue';
import { syncWithFeedback } from '@/lib/syncFeedback';
import { useOfflineSyncing } from '@/hooks/useOfflineSyncing';
import {
  changeQty,
  clearCart,
  lineDiscount,
  lineNet,
  removeLine,
  setLineDiscount,
  setQty,
  useCart,
  useCartDiscountTotal,
  useCartSubtotal,
  useCartTotal,
  useSelectedCustomer,
} from '@/store/cart';
import type { CartLine, PaymentMethod, SaleItemInput } from '@/types/sales';

function formatMoney(n: number): string {
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

function genUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function mapCartItems(cart: CartLine[]): SaleItemInput[] {
  return cart.map((l) => {
    const d = lineDiscount(l);
    return {
      product_id: l.product.id,
      quantity: l.quantity,
      ...(d > 0 ? { discount_amount: d } : {}),
    };
  });
}

function isOwnOpenShift(data: Awaited<ReturnType<typeof fetchCurrentShift>>): boolean {
  return !!(data?.shift && data.is_own_shift !== false);
}

function QtyEditModal({
  line,
  visible,
  onClose,
}: {
  line: CartLine | null;
  visible: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState('1');
  const stock = Number(line?.product.current_stock ?? 0);

  useEffect(() => {
    if (visible && line) setText(String(line.quantity));
  }, [visible, line]);

  if (!line) return null;

  function handleSave() {
    const raw = Math.floor(Number(String(text).replace(/\s/g, '')) || 0);
    setQty(line!.product.id, raw);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{t('editQuantity')}</Text>
          <Text style={styles.modalMeta} numberOfLines={2}>
            {line.product.name}
          </Text>
          <TextInput
            style={styles.modalInput}
            value={text}
            onChangeText={(v) => setText(v.replace(/[^\d]/g, ''))}
            keyboardType="number-pad"
            selectTextOnFocus
            autoFocus
          />
          {stock > 0 ? (
            <Text style={styles.modalHint}>
              {t('inStock')}: {stock}
            </Text>
          ) : null}
          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>{t('cancel')}</Text>
            </Pressable>
            <Pressable style={styles.modalSave} onPress={handleSave}>
              <Text style={styles.modalSaveText}>{t('save')}</Text>
            </Pressable>
          </View>
          <Text style={styles.modalHintMuted}>0 = {t('removeLine')}</Text>
        </View>
      </View>
    </Modal>
  );
}

const CartLineRow = memo(function CartLineRow({
  line,
  onChangeQty,
  onEditDiscount,
  onEditQty,
  onRemove,
}: {
  line: CartLine;
  onChangeQty: (productId: string, delta: number) => void;
  onEditDiscount: (line: CartLine) => void;
  onEditQty: (line: CartLine) => void;
  onRemove: (productId: string) => void;
}) {
  const productId = line.product.id;
  const unit = Number(line.product.sale_price || 0);
  const discount = lineDiscount(line);
  const net = lineNet(line);
  const stock = Number(line.product.current_stock ?? 0);
  const atStockCap = stock > 0 && line.quantity >= stock;

  return (
    <View style={styles.cartLine}>
      <View style={styles.cartLineMain}>
        <View style={styles.cartLineInfo}>
          <Text style={styles.cartName} numberOfLines={1}>
            {line.product.name}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.unitPrice} numberOfLines={1}>
              {formatMoney(unit)} × {line.quantity}
              {discount > 0 ? ` · -${formatMoney(discount)}` : ''}
            </Text>
            <Pressable hitSlop={8} onPress={() => onEditDiscount(line)}>
              <Text style={styles.discountLinkText}>
                {discount > 0 ? t('discount') : `+${t('discount')}`}
              </Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.qtyControls}>
          <Pressable style={styles.qtyBtn} onPress={() => onChangeQty(productId, -1)} hitSlop={4}>
            <Text style={styles.qtyBtnText}>−</Text>
          </Pressable>
          <Pressable style={styles.qtyValueBtn} onPress={() => onEditQty(line)} hitSlop={4}>
            <Text style={styles.qtyValue}>{line.quantity}</Text>
          </Pressable>
          <Pressable
            style={[styles.qtyBtn, atStockCap && styles.qtyBtnDisabled]}
            onPress={() => {
              if (!atStockCap) onChangeQty(productId, 1);
            }}
            disabled={atStockCap}
            hitSlop={4}
          >
            <Text style={styles.qtyBtnText}>+</Text>
          </Pressable>
        </View>
        <Text style={styles.cartLineTotal}>{formatMoney(net)}</Text>
        <Pressable style={styles.removeBtn} onPress={() => onRemove(productId)} hitSlop={8}>
          <Text style={styles.removeBtnText}>×</Text>
        </Pressable>
      </View>
    </View>
  );
});

export default function CartScreen() {
  const router = useRouter();
  const cart = useCart();
  const subtotal = useCartSubtotal();
  const discountTotal = useCartDiscountTotal();
  const total = useCartTotal();
  const selectedCustomer = useSelectedCustomer();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [customerNote, setCustomerNote] = useState('');
  const [amountTendered, setAmountTendered] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [hasOwnShift, setHasOwnShift] = useState<boolean | null>(null);
  const [shiftOwnedByOther, setShiftOwnedByOther] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);
  const [discountLine, setDiscountLine] = useState<CartLine | null>(null);
  const [qtyLine, setQtyLine] = useState<CartLine | null>(null);
  const offlineSyncing = useOfflineSyncing();

  const tenderedNum = useMemo(() => {
    const n = Number(String(amountTendered).replace(/\s/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }, [amountTendered]);

  const changeDue = useMemo(() => {
    if (paymentMethod !== 'cash' || tenderedNum == null) return null;
    if (tenderedNum <= total) return null;
    return tenderedNum - total;
  }, [paymentMethod, tenderedNum, total]);

  const remainderDue = useMemo(() => {
    if (!selectedCustomer || paymentMethod === 'credit' || tenderedNum == null) return null;
    if (tenderedNum >= total) return null;
    return total - tenderedNum;
  }, [selectedCustomer, paymentMethod, tenderedNum, total]);

  const refreshPending = useCallback(() => {
    void getOfflineQueueCount().then(setPendingSync);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchCurrentShift()
        .then((s) => {
          setHasOwnShift(isOwnOpenShift(s));
          setShiftOwnedByOther(!!(s?.shift && s.is_own_shift === false));
        })
        .catch(() => {
          setHasOwnShift(false);
          setShiftOwnedByOther(false);
        });
      refreshPending();
      void syncWithFeedback({ router }).then(() => refreshPending());
    }, [refreshPending, router]),
  );

  useFocusEffect(
    useCallback(() => {
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          void syncWithFeedback({ router }).then(() => refreshPending());
        }
      });
      return () => sub.remove();
    }, [refreshPending, router]),
  );

  useEffect(() => {
    if (!selectedCustomer && paymentMethod === 'credit') {
      setPaymentMethod('cash');
    }
  }, [selectedCustomer, paymentMethod]);

  const handleChangeQty = useCallback((productId: string, delta: number) => {
    changeQty(productId, delta);
  }, []);

  const handleRemove = useCallback((productId: string) => {
    removeLine(productId);
  }, []);

  const handleClearCart = useCallback(() => {
    Alert.alert(t('clearCart'), t('clearCartConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('clearCart'),
        style: 'destructive',
        onPress: () => {
          clearCart();
          setAmountTendered('');
          setCustomerNote('');
          setDueDate('');
          setPaymentMethod('cash');
          setError(null);
          setInfo(null);
        },
      },
    ]);
  }, []);

  const renderCartLine = useCallback(
    ({ item }: { item: CartLine }) => (
      <CartLineRow
        line={item}
        onChangeQty={handleChangeQty}
        onEditDiscount={setDiscountLine}
        onEditQty={setQtyLine}
        onRemove={handleRemove}
      />
    ),
    [handleChangeQty, handleRemove],
  );

  function resetForm() {
    setCustomerNote('');
    setAmountTendered('');
    setDueDate('');
    setPaymentMethod('cash');
    setInfo(null);
  }

  async function handleCheckout() {
    if (submitting || cart.length === 0) return;
    if (hasOwnShift === false) {
      setError(shiftOwnedByOther ? t('shiftOwnedByOther') : t('openShiftFirst'));
      return;
    }
    if (paymentMethod === 'credit' && !selectedCustomer) {
      setError(t('creditNeedsCustomer'));
      setPaymentMethod('cash');
      return;
    }
    if (total <= 0) {
      setError(t('saleFailed'));
      return;
    }
    setSubmitting(true);
    setError(null);
    setInfo(null);
    const payload: Parameters<typeof completeSale>[0] = {
      items: mapCartItems(cart),
      payment_method: paymentMethod,
      notes: customerNote.trim() || undefined,
      order_uuid: genUuid(),
    };
    if (selectedCustomer) payload.customer_id = selectedCustomer.id;
    if (paymentMethod !== 'credit' && amountTendered.trim() !== '') {
      const tendered = Number(amountTendered.replace(/\s/g, ''));
      if (Number.isFinite(tendered) && tendered >= 0) payload.amount_tendered = tendered;
    }
    if (paymentMethod === 'credit' && dueDate.trim()) {
      payload.due_date = dueDate.trim().slice(0, 10);
    }
    try {
      const res = await completeSale(payload);
      clearCart();
      resetForm();
      router.push({ pathname: '/sell/receipt', params: { id: res.data.id } });
    } catch (e) {
      if (isNetworkError(e)) {
        await enqueueSale(payload);
        clearCart();
        resetForm();
        refreshPending();
        setInfo(t('offlineSaved'));
      } else {
        setError(e instanceof Error ? e.message : t('saleFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendToCashier() {
    if (holding || submitting || cart.length === 0) return;
    if (hasOwnShift === false) {
      setError(shiftOwnedByOther ? t('shiftOwnedByOther') : t('openShiftFirst'));
      return;
    }
    setHolding(true);
    setError(null);
    setInfo(null);
    try {
      const shift = await fetchCurrentShift();
      if (!isOwnOpenShift(shift)) {
        setError(
          shift?.shift && shift.is_own_shift === false
            ? t('shiftOwnedByOther')
            : t('openShiftFirst'),
        );
        return;
      }
      const user = await loadUser();
      const deviceId = await getOrCreateDeviceId();
      const sellerName = user?.full_name || user?.username || user?.id || '';
      const payload: Parameters<typeof holdSale>[0] = {
        items: mapCartItems(cart),
        order_uuid: genUuid(),
        device_id: deviceId,
        notes: sellerName ? `Mobil: ${sellerName}` : undefined,
      };
      if (selectedCustomer) payload.customer_id = selectedCustomer.id;
      if (shift?.shift?.id) payload.shift_id = shift.shift.id;
      if (customerNote.trim()) {
        payload.notes = [payload.notes, customerNote.trim()].filter(Boolean).join(' | ');
      }

      const res = await holdSale(payload);
      const orderNo = res.data.order_number || res.data.id;
      clearCart();
      resetForm();
      Alert.alert(
        t('orderSentToCashier'),
        t('holdOrderNumber').replace('{n}', String(orderNo)),
      );
    } catch (e) {
      setError(
        isNetworkError(e) ? t('holdNeedsOnline') : e instanceof Error ? e.message : t('holdFailed'),
      );
    } finally {
      setHolding(false);
    }
  }

  if (cart.length === 0) {
    return (
      <View style={styles.emptyRoot}>
        <Text style={styles.emptyTitle}>{t('emptyCart')}</Text>
        {info ? <Text style={styles.infoEmpty}>{info}</Text> : null}
        <Pressable style={styles.emptyBtn} onPress={() => router.push('/(tabs)/sell')}>
          <Text style={styles.emptyBtnText}>{t('sell')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      {hasOwnShift === false ? (
        <Pressable style={styles.shiftBanner} onPress={() => router.push('/(tabs)/shift')}>
          <Text style={styles.shiftBannerText}>
            {shiftOwnedByOther ? t('shiftOwnedByOther') : t('openShiftFirst')}
          </Text>
        </Pressable>
      ) : null}

      {offlineSyncing ? (
        <View style={styles.syncSpinnerRow}>
          <ActivityIndicator size="small" color="#1e40af" />
          <Text style={styles.syncSpinnerText}>{t('syncingSales')}</Text>
        </View>
      ) : null}

      {pendingSync > 0 ? (
        <Pressable
          style={styles.syncBanner}
          onPress={() => {
            if (offlineSyncing) return;
            void syncWithFeedback({ router }).then(() => refreshPending());
          }}
        >
          <Text style={styles.syncBannerText}>
            {t('pendingSyncCount').replace('{n}', String(pendingSync))}
            {offlineSyncing ? ` · ${t('processing')}` : ''}
          </Text>
        </Pressable>
      ) : null}

      <FlatList
        data={cart}
        keyExtractor={(item) => item.product.id}
        renderItem={renderCartLine}
        keyboardShouldPersistTaps="handled"
        style={styles.cartList}
        contentContainerStyle={styles.cartListContent}
        ListHeaderComponent={
          <Pressable style={styles.clearCartBtn} onPress={handleClearCart}>
            <Text style={styles.clearCartText}>{t('clearCart')}</Text>
          </Pressable>
        }
      />

      <View style={styles.footer}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {info ? <Text style={styles.info}>{info}</Text> : null}
        <CustomerPickerBanner />
        <TextInput
          style={styles.note}
          placeholder={t('customerNote')}
          value={customerNote}
          onChangeText={setCustomerNote}
        />
        <View style={styles.payRow}>
          {(['cash', 'card', 'credit'] as PaymentMethod[]).map((m) => {
            const disabled = m === 'credit' && !selectedCustomer;
            return (
              <Pressable
                key={m}
                style={[
                  styles.payBtn,
                  paymentMethod === m && styles.payBtnActive,
                  disabled && styles.payBtnDisabled,
                ]}
                onPress={() => !disabled && setPaymentMethod(m)}
                disabled={disabled}
              >
                <Text style={[styles.payText, paymentMethod === m && styles.payTextActive]}>
                  {m === 'credit' ? t('creditSale') : t(m)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {paymentMethod === 'credit' && selectedCustomer ? (
          <TextInput
            style={[styles.note, { marginTop: 8 }]}
            placeholder={t('dueDateHint')}
            value={dueDate}
            onChangeText={(v) => setDueDate(v.replace(/[^\d-]/g, '').slice(0, 10))}
            keyboardType="numbers-and-punctuation"
          />
        ) : null}
        {paymentMethod !== 'credit' ? (
          <>
            {selectedCustomer &&
            Number(selectedCustomer.balance_uzs ?? selectedCustomer.balance ?? 0) > 0 ? (
              <Text style={styles.prepaidHint} numberOfLines={1}>
                {t('prepaidAutoApply')}
              </Text>
            ) : null}
            <TextInput
              style={styles.note}
              placeholder={
                paymentMethod === 'cash'
                  ? t('amountTendered')
                  : `${t('partialPayment')} (${t('amountTendered')})`
              }
              value={amountTendered}
              onChangeText={setAmountTendered}
              keyboardType="numeric"
            />
            {changeDue != null ? (
              <View style={styles.changeRow}>
                <Text style={styles.changeLabel}>{t('change')}</Text>
                <Text style={styles.changeValue}>{formatMoney(changeDue)}</Text>
              </View>
            ) : null}
            {remainderDue != null ? (
              <View style={styles.remainderRow}>
                <Text style={styles.remainderLabel}>{t('partialPayment')}</Text>
                <Text style={styles.remainderValue}>{formatMoney(remainderDue)}</Text>
              </View>
            ) : null}
          </>
        ) : null}
        <View style={styles.totalsBlock}>
          {discountTotal > 0 ? (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{t('subtotal')}</Text>
                <Text style={styles.metaValue}>{formatMoney(subtotal)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{t('discount')}</Text>
                <Text style={styles.discountValue}>-{formatMoney(discountTotal)}</Text>
              </View>
            </>
          ) : null}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabelBold}>{t('total')}</Text>
            <Text style={styles.totalValue}>{formatMoney(total)}</Text>
          </View>
        </View>
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.holdBtn, (holding || submitting) && styles.checkoutDisabled]}
            onPress={handleSendToCashier}
            disabled={holding || submitting}
          >
            <Text style={styles.holdBtnText}>
              {holding ? t('processing') : t('sendToCashier')}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.checkout, submitting && styles.checkoutDisabled]}
            onPress={handleCheckout}
            disabled={submitting || holding}
          >
            <Text style={styles.checkoutText}>
              {submitting ? t('processing') : t('completeSale')}
            </Text>
          </Pressable>
        </View>
      </View>

      <LineDiscountModal
        line={discountLine}
        visible={!!discountLine}
        onClose={() => setDiscountLine(null)}
        onSave={(amount) => {
          if (discountLine) setLineDiscount(discountLine.product.id, amount);
        }}
      />
      <QtyEditModal line={qtyLine} visible={!!qtyLine} onClose={() => setQtyLine(null)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  emptyRoot: {
    flex: 1,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyTitle: { fontSize: 15, color: '#94a3b8', marginBottom: 12 },
  infoEmpty: {
    color: '#166534',
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  emptyBtn: {
    backgroundColor: '#166534',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  shiftBanner: {
    backgroundColor: '#fef3c7',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginHorizontal: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  shiftBannerText: { color: '#92400e', fontWeight: '600', textAlign: 'center', fontSize: 12 },
  syncBanner: {
    backgroundColor: '#dbeafe',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginHorizontal: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  syncBannerText: { color: '#1e40af', fontWeight: '600', textAlign: 'center', fontSize: 12 },
  syncSpinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#eff6ff',
    borderRadius: 6,
    paddingVertical: 6,
    marginHorizontal: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  syncSpinnerText: { color: '#1e40af', fontWeight: '600', fontSize: 12 },
  cartList: { flex: 1 },
  cartListContent: { paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8 },
  clearCartBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  clearCartText: { color: '#dc2626', fontWeight: '600', fontSize: 11 },
  cartLine: {
    backgroundColor: '#fff',
    marginBottom: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  cartLineMain: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cartLineInfo: { flex: 1, minWidth: 0, marginRight: 2 },
  cartName: { fontSize: 13, color: '#0f172a', fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  unitPrice: { fontSize: 11, color: '#64748b', flexShrink: 1 },
  qtyControls: { flexDirection: 'row', alignItems: 'center' },
  qtyBtn: {
    width: 26,
    height: 26,
    borderRadius: 5,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnDisabled: { opacity: 0.35 },
  qtyBtnText: { fontSize: 15, fontWeight: '700', color: '#166534', lineHeight: 16 },
  qtyValueBtn: {
    minWidth: 28,
    paddingHorizontal: 2,
    paddingVertical: 2,
    alignItems: 'center',
  },
  qtyValue: {
    minWidth: 20,
    textAlign: 'center',
    fontWeight: '700',
    fontSize: 13,
    color: '#0f172a',
    textDecorationLine: 'underline',
  },
  cartLineTotal: {
    fontWeight: '700',
    color: '#0f172a',
    fontSize: 12,
    minWidth: 64,
    textAlign: 'right',
  },
  discountLinkText: { fontSize: 11, color: '#166534', fontWeight: '600' },
  removeBtn: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  removeBtnText: { fontSize: 18, color: '#dc2626', fontWeight: '600', lineHeight: 20 },
  footer: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
  },
  error: { color: '#dc2626', marginBottom: 4, fontSize: 12 },
  info: { color: '#166534', marginBottom: 4, fontSize: 12, fontWeight: '600' },
  note: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 6,
    backgroundColor: '#f8fafc',
    fontSize: 13,
  },
  payRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  payBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  payBtnActive: { backgroundColor: '#166534' },
  payBtnDisabled: { opacity: 0.4 },
  payText: { fontWeight: '600', color: '#475569', fontSize: 12 },
  payTextActive: { color: '#fff' },
  prepaidHint: { fontSize: 11, color: '#64748b', marginTop: 4 },
  changeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    backgroundColor: '#ecfdf5',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  changeLabel: { color: '#166534', fontWeight: '600', fontSize: 12 },
  changeValue: { color: '#166534', fontWeight: '800', fontSize: 13 },
  remainderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    backgroundColor: '#fff7ed',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  remainderLabel: { color: '#9a3412', fontWeight: '600', fontSize: 12 },
  remainderValue: { color: '#9a3412', fontWeight: '700', fontSize: 12 },
  totalsBlock: { marginTop: 6, gap: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { color: '#64748b', fontSize: 12 },
  totalLabelBold: { color: '#0f172a', fontWeight: '700', fontSize: 14 },
  metaValue: { color: '#334155', fontSize: 12 },
  discountValue: { color: '#b45309', fontSize: 12 },
  totalValue: { color: '#166534', fontWeight: '800', fontSize: 15 },
  actionRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  holdBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
  },
  holdBtnText: { color: '#334155', fontWeight: '700', fontSize: 12, textAlign: 'center' },
  checkout: {
    flex: 1.2,
    backgroundColor: '#166534',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  checkoutDisabled: { opacity: 0.6 },
  checkoutText: { color: '#fff', fontWeight: '700', fontSize: 13, textAlign: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  modalMeta: { fontSize: 12, color: '#64748b', marginTop: 4, marginBottom: 10 },
  modalInput: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    backgroundColor: '#f8fafc',
  },
  modalHint: { fontSize: 11, color: '#64748b', textAlign: 'center', marginTop: 6 },
  modalHintMuted: { fontSize: 10, color: '#94a3b8', textAlign: 'center', marginTop: 8 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  modalCancel: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  modalCancelText: { fontWeight: '600', color: '#64748b', fontSize: 13 },
  modalSave: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#166534',
    alignItems: 'center',
  },
  modalSaveText: { fontWeight: '700', color: '#fff', fontSize: 13 },
});
