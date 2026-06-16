import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { t } from '@/i18n';

export type BarcodeScanModalProps = {
  visible: boolean;
  onClose: () => void;
  onScan: (code: string) => void | Promise<void>;
  busy?: boolean;
};

export function ManualBarcodeForm({
  onSubmit,
  onClose,
  busy,
  showWebNote,
}: {
  onSubmit: (code: string) => void;
  onClose: () => void;
  busy?: boolean;
  showWebNote?: boolean;
}) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!busy) setValue('');
  }, [busy]);

  return (
    <View style={styles.manualBox}>
      <Text style={styles.hint}>{t('scanHint')}</Text>
      {showWebNote ? <Text style={styles.webNote}>{t('enterBarcodeManually')}</Text> : null}
      <TextInput
        style={styles.manualInput}
        placeholder={t('searchProducts')}
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => {
          const code = value.trim();
          if (code) onSubmit(code);
        }}
        editable={!busy}
      />
      <View style={styles.manualActions}>
        <Pressable style={styles.secondaryBtn} onPress={onClose} disabled={busy}>
          <Text style={styles.secondaryBtnText}>{t('cancel')}</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
          onPress={() => {
            const code = value.trim();
            if (code) onSubmit(code);
          }}
          disabled={busy || !value.trim()}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>{t('scanBarcode')}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

export const scanModalStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 48,
    paddingBottom: 12,
    backgroundColor: '#0f172a',
  },
  title: { color: '#f8fafc', fontSize: 18, fontWeight: '700' },
  closeText: { color: '#94a3b8', fontSize: 15, fontWeight: '600' },
  hint: { color: '#cbd5e1', fontSize: 14, textAlign: 'center', marginBottom: 12 },
  webNote: { color: '#94a3b8', fontSize: 12, textAlign: 'center', marginBottom: 12 },
  manualBox: { flex: 1, padding: 20, justifyContent: 'center' },
  manualInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginTop: 8,
  },
  manualActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  secondaryBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#475569',
  },
  secondaryBtnText: { color: '#e2e8f0', fontWeight: '600' },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
});

const styles = scanModalStyles;
