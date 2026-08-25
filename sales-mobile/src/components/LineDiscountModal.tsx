import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '@/i18n';
import { lineGross } from '@/store/cart';
import type { CartLine } from '@/types/sales';

function formatMoney(n: number): string {
  return `${Math.round(n).toLocaleString('uz-UZ')} so'm`;
}

export function LineDiscountModal({
  line,
  visible,
  onClose,
  onSave,
}: {
  line: CartLine | null;
  visible: boolean;
  onClose: () => void;
  onSave: (amount: number) => void;
}) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible && line) {
      const d = Number(line.discount_amount || 0);
      setText(d > 0 ? String(Math.round(d)) : '');
    }
  }, [visible, line]);

  if (!line) return null;

  const gross = lineGross(line);
  const maxDiscount = Math.max(0, gross - 1);

  function handleSave() {
    const raw = Number(String(text).replace(/\s/g, ''));
    const amount = Number.isFinite(raw) && raw > 0 ? Math.min(raw, maxDiscount) : 0;
    onSave(amount);
    onClose();
  }

  function handleClear() {
    onSave(0);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('lineDiscount')}</Text>
          <Text style={styles.meta} numberOfLines={2}>
            {line.product.name}
          </Text>
          <Text style={styles.meta}>
            {t('subtotal')}: {formatMoney(gross)}
          </Text>
          <Text style={styles.hint}>{t('discountHint')}</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={(v) => setText(v.replace(/[^\d]/g, ''))}
            keyboardType="number-pad"
            placeholder="0"
            selectTextOnFocus
          />
          <Text style={styles.maxHint}>
            {t('maxDiscount')}: {formatMoney(maxDiscount)}
          </Text>
          <View style={styles.actions}>
            <Pressable style={styles.secondary} onPress={handleClear}>
              <Text style={styles.secondaryText}>{t('clearDiscount')}</Text>
            </Pressable>
            <Pressable style={styles.primary} onPress={handleSave}>
              <Text style={styles.primaryText}>{t('save')}</Text>
            </Pressable>
          </View>
          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </Pressable>
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
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  title: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  meta: { fontSize: 13, color: '#64748b', marginTop: 4 },
  hint: { fontSize: 12, color: '#94a3b8', marginTop: 12, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  maxHint: { fontSize: 12, color: '#94a3b8', marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  secondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  secondaryText: { fontWeight: '600', color: '#64748b' },
  primary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#166534',
    alignItems: 'center',
  },
  primaryText: { fontWeight: '700', color: '#fff' },
  cancel: { alignItems: 'center', marginTop: 12, padding: 8 },
  cancelText: { color: '#64748b', fontWeight: '600' },
});
