import { memo, useCallback, useState } from 'react';
import { AppState, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { completeSale, fetchCurrentShift } from '@/api/client';
import { CustomerPickerBanner } from '@/components/CustomerPicker';
import { t } from '@/i18n';
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
  useCart,
  useCartTotal,
  useSelectedCustomer,
} from '@/store/cart';
import type { CartLine, PaymentMethod } from '@/types/sales';

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

const CartLineRow = memo(function CartLineRow({
  line,
  onChangeQty,
}: {
  line: CartLine;
  onChangeQty: (productId: string, delta: number) => void;
}) {
  const productId = line.product.id;
  return (
    <View style={styles.cartLine}>
      <Text style={styles.cartName} numberOfLines={2}>
        {line.product.name}
      </Text>
      <View style={styles.qtyControls}>
        <Pressable style={styles.qtyBtn} onPress={() => onChangeQty(productId, -1)}>
          <Text style={styles.qtyBtnText}>−</Text>
        </Pressable>
        <Text style={styles.qtyValue}>{line.quantity}</Text>
        <Pressable style={styles.qtyBtn} onPress={() => onChangeQty(productId, 1)}>
          <Text style={styles.qtyBtnText}>+</Text>
        </Pressable>
      </View>
      <Text style={styles.cartLineTotal}>
        {formatMoney(Number(line.product.sale_price || 0) * line.quantity)}
      </Text>
    </View>
  );
});

export default function CartScreen() {
  const router = useRouter();
  const cart = useCart();
  const total = useCartTotal();
  const selectedCustomer = useSelectedCustomer();
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [customerNote, setCustomerNote] = useState('');
  const [amountTendered, setAmountTendered] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasShift, setHasShift] = useState<boolean | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const offlineSyncing = useOfflineSyncing();

  const refreshPending = useCallback(() => {
    void getOfflineQueueCount().then(setPendingSync);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchCurrentShift()
        .then((s) => setHasShift(!!s))
        .catch(() => setHasShift(false));
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

  const handleChangeQty = useCallback((productId: string, delta: number) => {
    changeQty(productId, delta);
  }, []);

  const renderCartLine = useCallback(
    ({ item }: { item: CartLine }) => (
      <CartLineRow line={item} onChangeQty={handleChangeQty} />
    ),
    [handleChangeQty],
  );

  async function handleCheckout() {
    if (submitting || cart.length === 0) return;
    if (hasShift === false) {
      setError(t('openShiftFirst'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: Parameters<typeof completeSale>[0] = {
      items: cart.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
      payment_method: paymentMethod,
      notes: customerNote.trim() || undefined,
      order_uuid: genUuid(),
    };
    if (selectedCustomer) payload.customer_id = selectedCustomer.id;
    if (paymentMethod !== 'credit' && amountTendered.trim() !== '') {
      const tendered = Number(amountTendered.replace(/\s/g, ''));
      if (Number.isFinite(tendered) && tendered >= 0) payload.amount_tendered = tendered;
    }
    try {
      const res = await completeSale(payload);
      clearCart();
      setCustomerNote('');
      setAmountTendered('');
      router.push({ pathname: '/sell/receipt', params: { id: res.data.id } });
    } catch (e) {
      if (isNetworkError(e)) {
        await enqueueSale(payload);
        clearCart();
        setCustomerNote('');
        setAmountTendered('');
        refreshPending();
        setError(t('offlineSaved'));
      } else {
        setError(e instanceof Error ? e.message : t('saleFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (cart.length === 0) {
    return (
      <View style={styles.emptyRoot}>
        <Text style={styles.emptyTitle}>{t('emptyCart')}</Text>
        <Pressable style={styles.emptyBtn} onPress={() => router.push('/(tabs)/sell')}>
          <Text style={styles.emptyBtnText}>{t('sell')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {hasShift === false ? (
        <Pressable style={styles.shiftBanner} onPress={() => router.push('/(tabs)/shift')}>
          <Text style={styles.shiftBannerText}>{t('openShiftFirst')}</Text>
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
      />

      <View style={styles.footer}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
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
        {selectedCustomer && paymentMethod !== 'credit' ? (
          <>
            {Number(selectedCustomer.balance_uzs ?? selectedCustomer.balance ?? 0) > 0 ? (
              <Text style={styles.prepaidHint}>{t('prepaidAutoApply')}</Text>
            ) : null}
            <TextInput
              style={styles.note}
              placeholder={`${t('partialPayment')} (${t('amountTendered')})`}
              value={amountTendered}
              onChangeText={setAmountTendered}
              keyboardType="numeric"
            />
          </>
        ) : null}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('total')}</Text>
          <Text style={styles.totalValue}>{formatMoney(total)}</Text>
        </View>
        <Pressable
          style={[styles.checkout, submitting && styles.checkoutDisabled]}
          onPress={handleCheckout}
          disabled={submitting}
        >
          <Text style={styles.checkoutText}>
            {submitting ? t('processing') : t('completeSale')}
          </Text>
        </Pressable>
      </View>
    </View>
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
  emptyTitle: { fontSize: 16, color: '#94a3b8', marginBottom: 16 },
  emptyBtn: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  shiftBanner: {
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  shiftBannerText: { color: '#92400e', fontWeight: '600', textAlign: 'center' },
  syncBanner: {
    backgroundColor: '#dbeafe',
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  syncBannerText: { color: '#1e40af', fontWeight: '600', textAlign: 'center', fontSize: 13 },
  syncSpinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    padding: 10,
    marginHorizontal: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  syncSpinnerText: { color: '#1e40af', fontWeight: '600', fontSize: 13 },
  cartList: { flex: 1 },
  cartListContent: { paddingHorizontal: 14, paddingVertical: 8, paddingBottom: 16 },
  cartLine: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cartName: { flex: 1, fontSize: 14, color: '#0f172a', marginRight: 8 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 4 },
  qtyBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnText: { fontSize: 18, color: '#166534', fontWeight: '700' },
  qtyValue: { minWidth: 28, textAlign: 'center', fontSize: 15, fontWeight: '600' },
  cartLineTotal: { minWidth: 84, textAlign: 'right', fontSize: 14, color: '#166534', fontWeight: '600' },
  footer: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    padding: 14,
  },
  note: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  payRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  payBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  payBtnActive: { backgroundColor: '#166534' },
  payBtnDisabled: { opacity: 0.4 },
  payText: { fontWeight: '600', color: '#334155', fontSize: 12 },
  payTextActive: { color: '#fff' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  totalLabel: { fontSize: 16, color: '#475569' },
  totalValue: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  checkout: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  checkoutDisabled: { opacity: 0.6 },
  checkoutText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  error: { color: '#dc2626', marginBottom: 8, textAlign: 'center' },
  prepaidHint: { fontSize: 12, color: '#166534', marginBottom: 6, fontWeight: '600' },
});
