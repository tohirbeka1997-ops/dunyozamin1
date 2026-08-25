import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '@/i18n';

export default function PrivacyScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('privacyPolicy')}</Text>
      <Text style={styles.body}>{t('privacyBody')}</Text>
      <View style={styles.box}>
        <Text style={styles.item}>• Login / JWT sessiyasi</Text>
        <Text style={styles.item}>• Biometrika (ixtiyoriy)</Text>
        <Text style={styles.item}>• Kamera — shtrix-kod</Text>
        <Text style={styles.item}>• Qurilma push tokeni (ixtiyoriy)</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a', marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 22, color: '#334155' },
  box: {
    marginTop: 20,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
  },
  item: { fontSize: 14, color: '#475569' },
});
