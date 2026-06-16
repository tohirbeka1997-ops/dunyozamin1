import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { createCustomer } from '@/api/client';
import { t } from '@/i18n';

export default function CreateCustomerScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+998');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSave() {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('nameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const created = await createCustomer({
        name: trimmed,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
      });
      setInfo(t('customerCreated'));
      router.replace({ pathname: '/customers/[id]', params: { id: created.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('networkError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.label}>{t('customerName')} *</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} autoFocus />
      <Text style={styles.label}>{t('customerPhone')}</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoCapitalize="none"
      />
      <Text style={styles.label}>{t('customerNotes')}</Text>
      <TextInput
        style={[styles.input, styles.notes]}
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={3}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {info ? <Text style={styles.info}>{info}</Text> : null}
      <Pressable style={[styles.btn, saving && styles.btnDisabled]} onPress={handleSave} disabled={saving}>
        <Text style={styles.btnText}>{saving ? t('processing') : t('save')}</Text>
      </Pressable>
      <Pressable style={styles.cancelBtn} onPress={() => router.back()}>
        <Text style={styles.cancelText}>{t('cancel')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  label: { fontSize: 13, color: '#475569', marginBottom: 6, marginTop: 8, fontWeight: '600' },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  notes: { minHeight: 80, textAlignVertical: 'top' },
  btn: {
    backgroundColor: '#166534',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  cancelBtn: { alignItems: 'center', marginTop: 12, padding: 8 },
  cancelText: { color: '#64748b', fontWeight: '600' },
  error: { color: '#dc2626', marginTop: 10 },
  info: { color: '#166534', marginTop: 10, fontWeight: '600' },
});
